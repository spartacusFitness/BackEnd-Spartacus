import { Logger } from '@nestjs/common';
import { config } from '../config.js';

// Supabase Auth Admin (solo backend, con la llave secreta). Docs: /auth/v1/admin/*
const log = new Logger('SupabaseAdmin');

const headers = () => ({ apikey: config.supabase.secretKey, 'Content-Type': 'application/json' });

export class SupabaseAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.supabase.url}/auth/v1${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new SupabaseAdminError(String(data.msg ?? data.message ?? res.statusText), res.status, data.error_code as string | undefined);
  }
  return data as T;
}

export interface AuthUser {
  id: string;
  email: string;
}

/** Crea una cuenta ya confirmada (la persona la verificó en persona o es una cuenta interna). */
export const crearUsuario = (email: string, password: string | undefined, nombre: string) =>
  call<AuthUser>('POST', '/admin/users', {
    email,
    ...(password ? { password } : {}),
    email_confirm: true,
    user_metadata: { full_name: nombre },
  });

export const cambiarContrasena = (userId: string, password: string) =>
  call<AuthUser>('PUT', `/admin/users/${userId}`, { password });

/**
 * Manda el correo para que la persona cree su contraseña. Con el SMTP de prueba de Supabase solo
 * llega a correos del equipo; por eso devuelve false en vez de fallar.
 */
export async function enviarCorreoContrasena(email: string, redirectTo: string): Promise<boolean> {
  try {
    await call('POST', `/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email });
    return true;
  } catch (err) {
    log.warn(`No se pudo enviar el correo de contraseña a ${email}: ${(err as Error).message}`);
    return false;
  }
}
