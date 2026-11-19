import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { authCache } from './auth-cache.js';
import { publicJwkSchema, thumbprint, type PublicJwk } from './signature.js';

/** "Recordarme": 30 días. Sin él: 12 horas fijas. */
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_MS = 12 * 60 * 60 * 1000;

export interface DispositivoActivo {
  id: string;
  perfilId: string;
  publicKey: PublicJwk;
  remember: boolean;
  /** ms epoch */
  expiresAt: number;
}

const fuera = (code: string, message = 'Tu sesión terminó en este dispositivo. Inicia sesión de nuevo.') =>
  new UnauthorizedException({ message, code });

@Injectable()
export class DispositivosService {
  constructor(private readonly prisma: PrismaService) {}

  private get rows() {
    return this.prisma.db.orm.public.Dispositivo;
  }

  /**
   * Liga la llave pública de este dispositivo a la sesión de Supabase (session_id).
   * Es idempotente: volver a registrarlo con la misma llave solo actualiza "último uso".
   */
  async registrar(sessionId: string, perfilId: string, publicKey: PublicJwk, remember: boolean, userAgent?: string) {
    const jkt = await thumbprint(publicKey);
    const existing = await this.rows.first({ id: sessionId });
    if (existing) {
      if (existing.perfilId !== perfilId || existing.jkt !== jkt) throw fuera('device_mismatch');
      if (existing.revokedAt) throw fuera('device_revoked');
      if (existing.expiresAt.getTime() < Date.now()) throw fuera('device_expired');
      await this.rows.where({ id: sessionId }).update({ lastUsedAt: new Date() });
      return;
    }
    await this.rows.create({
      id: sessionId,
      perfilId,
      publicKey: JSON.stringify(publicKey),
      jkt,
      remember,
      expiresAt: new Date(Date.now() + (remember ? REMEMBER_MS : SHORT_MS)),
      userAgent: userAgent?.slice(0, 200) ?? null,
    });
  }

  /** Dispositivo vivo de una sesión; "Recordarme" se renueva con el uso. */
  async activo(sessionId: string): Promise<DispositivoActivo> {
    const row = await this.rows.first({ id: sessionId });
    if (!row) throw fuera('device_unknown', 'Este dispositivo no está registrado. Inicia sesión de nuevo.');
    if (row.revokedAt) throw fuera('device_revoked');
    if (row.expiresAt.getTime() < Date.now()) throw fuera('device_expired');
    // Renovación deslizante de "Recordarme", como mucho una escritura por hora.
    let expiresAt = row.expiresAt.getTime();
    if (row.remember && (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60 * 60 * 1000)) {
      expiresAt = Date.now() + REMEMBER_MS;
      // No hace falta esperar esta escritura para responder.
      void this.rows.where({ id: sessionId }).update({ lastUsedAt: new Date(), expiresAt: new Date(expiresAt) }).catch(() => undefined);
    }
    return {
      id: row.id,
      perfilId: row.perfilId,
      publicKey: publicJwkSchema.parse(JSON.parse(row.publicKey)),
      remember: row.remember,
      expiresAt,
    };
  }

  async revocar(sessionId: string) {
    authCache.invalidarSesion(sessionId);
    await this.rows.where({ id: sessionId }).update({ revokedAt: new Date() });
  }
}
