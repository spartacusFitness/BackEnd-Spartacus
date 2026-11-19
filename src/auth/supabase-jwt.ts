import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { config } from '../config.js';

/**
 * Valida el access token de Supabase Auth con sus llaves públicas (ES256, JWKS).
 * jose guarda en caché las llaves y las vuelve a pedir si Supabase las rota.
 */
const jwks = createRemoteJWKSet(new URL(config.supabase.jwksUrl));

export interface SupabaseClaims {
  /** id del usuario en auth.users */
  userId: string;
  /** id de la sesión de Supabase (un inicio de sesión en un dispositivo) */
  sessionId: string;
  email: string;
  /** user_metadata: lo escribe la propia persona; NUNCA usarlo para autorizar. */
  userMetadata: Record<string, unknown>;
}

export async function verifySupabaseToken(token: string): Promise<SupabaseClaims> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.supabase.issuer,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    if (payload.role !== 'authenticated' || payload.is_anonymous === true) throw new Error('rol no permitido');
    if (!payload.sub || typeof payload.session_id !== 'string' || typeof payload.email !== 'string') {
      throw new Error('claims incompletos');
    }
    return {
      userId: payload.sub,
      sessionId: payload.session_id,
      email: payload.email.toLowerCase(),
      userMetadata: (payload.user_metadata as Record<string, unknown> | undefined) ?? {},
    };
  } catch (err) {
    throw new UnauthorizedException(
      err instanceof errors.JWTExpired
        ? { message: 'Tu acceso expiró.', code: 'token_expired' }
        : { message: 'Inicia sesión para continuar.', code: 'token_invalid' },
    );
  }
}

/** Saca el token de `Authorization: Bearer <token>`. */
export function bearer(header: string | undefined): string {
  const [scheme, token] = (header ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedException({ message: 'Inicia sesión para continuar.', code: 'token_missing' });
  }
  return token;
}
