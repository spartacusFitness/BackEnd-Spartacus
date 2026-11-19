import type { DispositivoActivo } from './dispositivos.service.js';
import type { RolNombre } from './perfiles.service.js';

/**
 * Caché en memoria del contexto de cada sesión (dispositivo + perfil + roles).
 * Sin él, cada petición hacía 3 consultas seguidas antes de empezar (~300 ms).
 *
 * Lo que NO se cachea: el JWT y la firma de la petición se verifican siempre.
 * Lo que se invalida al momento: cerrar sesión, cambiar de sede o de roles en este proceso.
 * Cambios hechos desde fuera (p. ej. el script `npm run rol`) tardan como mucho TTL_MS.
 */
const TTL_MS = 30_000;
const MAX = 5_000;

export interface Contexto {
  userId: string;
  dispositivo: DispositivoActivo;
  perfilId: string;
  roles: { rol: RolNombre; sedeId: string | null }[];
}

const porSesion = new Map<string, { ctx: Contexto; hasta: number }>();

export const authCache = {
  get(sessionId: string): Contexto | undefined {
    const e = porSesion.get(sessionId);
    if (!e) return undefined;
    if (e.hasta < Date.now() || e.ctx.dispositivo.expiresAt < Date.now()) {
      porSesion.delete(sessionId);
      return undefined;
    }
    return e.ctx;
  },
  set(sessionId: string, ctx: Contexto) {
    if (porSesion.size >= MAX) porSesion.clear();
    porSesion.set(sessionId, { ctx, hasta: Date.now() + TTL_MS });
  },
  invalidarSesion(sessionId: string) {
    porSesion.delete(sessionId);
  },
  /** Roles, sede o datos de la persona cambiaron: olvida todas sus sesiones. */
  invalidarPerfil(perfilId: string) {
    for (const [k, v] of porSesion) if (v.ctx.perfilId === perfilId) porSesion.delete(k);
  },
};
