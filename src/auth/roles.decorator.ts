import { SetMetadata } from '@nestjs/common';
import type { RolNombre } from './perfiles.service.js';

export const ROLES_KEY = 'roles';

/** Restringe una ruta a ciertos roles (se revisa en AuthGuard). Ej.: @Roles('admin', 'encargado') */
export const Roles = (...roles: RolNombre[]) => SetMetadata(ROLES_KEY, roles);
