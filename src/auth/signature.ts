import { UnauthorizedException } from '@nestjs/common';
import { createHash, createPublicKey, verify } from 'node:crypto';
import type { Request } from 'express';
import { calculateJwkThumbprint, type JWK } from 'jose';
import { z } from 'zod';

/**
 * Peticiones firmadas.
 *
 * Cada dispositivo genera un par de llaves ECDSA P-256 en el navegador (WebCrypto, llave privada
 * no exportable) y registra la pública al iniciar sesión. Cada petición lleva:
 *
 *   X-Signature-Timestamp: milisegundos epoch
 *   X-Signature-Nonce:     valor aleatorio de un solo uso
 *   X-Signature:           ECDSA-SHA256 (IEEE P1363, base64url) sobre
 *
 *     METHOD \n /ruta?query \n timestamp \n nonce \n base64url(SHA-256(body))
 *
 * El servidor rechaza firmas inválidas, fuera de la ventana de tiempo o con nonce repetido.
 */

export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

/** JWK pública ECDSA P-256. */
export const publicJwkSchema = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .transform(({ kty, crv, x, y }) => ({ kty, crv, x, y }));

export type PublicJwk = z.infer<typeof publicJwkSchema>;

export const thumbprint = (jwk: PublicJwk) => calculateJwkThumbprint(jwk as JWK, 'sha256');

const b64urlSha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('base64url');

/** Nonces vistos en la ventana de tiempo (memoria del proceso; con varias instancias, usar Redis). */
const seenNonces = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [nonce, exp] of seenNonces) if (exp < now) seenNonces.delete(nonce);
}, 60_000).unref();

export type RawRequest = Request & { rawBody?: Buffer };

export function canonicalString(req: RawRequest, timestamp: string, nonce: string) {
  const body = req.rawBody && req.rawBody.length ? req.rawBody : Buffer.alloc(0);
  return [req.method.toUpperCase(), req.originalUrl, timestamp, nonce, b64urlSha256(body)].join('\n');
}

/** Verifica la firma de la petición con la llave pública dada. Lanza 401 si algo no cuadra. */
export function verifyRequestSignature(req: RawRequest, jwk: PublicJwk): void {
  const timestamp = req.header('x-signature-timestamp');
  const nonce = req.header('x-signature-nonce');
  const signature = req.header('x-signature');
  if (!timestamp || !nonce || !signature) {
    throw new UnauthorizedException({ message: 'La petición no está firmada.', code: 'signature_missing' });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > SIGNATURE_WINDOW_MS) {
    throw new UnauthorizedException({
      message: 'La hora de tu dispositivo no coincide. Revisa la fecha y hora e inténtalo de nuevo.',
      code: 'signature_expired',
    });
  }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) {
    throw new UnauthorizedException({ message: 'Firma de la petición inválida.', code: 'signature_invalid' });
  }

  let ok = false;
  try {
    ok = verify(
      'sha256',
      Buffer.from(canonicalString(req, timestamp, nonce)),
      { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    ok = false;
  }
  if (!ok) throw new UnauthorizedException({ message: 'Firma de la petición inválida.', code: 'signature_invalid' });

  // Solo después de una firma válida se "gasta" el nonce (evita que un atacante los queme).
  const key = `${jwk.x}.${nonce}`;
  if (seenNonces.has(key)) {
    throw new UnauthorizedException({ message: 'Petición repetida.', code: 'signature_replayed' });
  }
  seenNonces.set(key, Date.now() + SIGNATURE_WINDOW_MS * 2);
}
