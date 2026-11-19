import { ForbiddenException } from '@nestjs/common';
import type { Auth } from '../auth/auth.guard.js';
import type { RolNombre } from '../auth/perfiles.service.js';

/** ¿Tiene la persona alguno de esos roles en esa sede? (admin aplica a todas). */
export function tieneRolEn(auth: Auth, sedeId: string, permitidos: RolNombre[]) {
  return auth.roles.some(
    (r) => permitidos.includes(r.rol) && (r.rol === 'admin' ? r.sedeId === null : r.sedeId === sedeId),
  );
}

export function exigirRolEn(auth: Auth, sedeId: string, permitidos: RolNombre[]) {
  if (!tieneRolEn(auth, sedeId, permitidos)) {
    throw new ForbiddenException('No tienes permiso en esta sede.');
  }
}

export const esAdmin = (auth: Auth) => auth.roles.some((r) => r.rol === 'admin' && r.sedeId === null);

/** Sedes donde la persona tiene alguno de esos roles (null = todas, por ser admin). */
export function sedesCon(auth: Auth, permitidos: RolNombre[]): string[] | null {
  if (permitidos.includes('admin') && esAdmin(auth)) return null;
  return [...new Set(auth.roles.filter((r) => permitidos.includes(r.rol) && r.sedeId).map((r) => r.sedeId!))];
}
