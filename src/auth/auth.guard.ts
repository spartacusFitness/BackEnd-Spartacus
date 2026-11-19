import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DispositivosService } from './dispositivos.service.js';
import { PerfilesService, type RolNombre } from './perfiles.service.js';
import { ROLES_KEY } from './roles.decorator.js';
import { verifyRequestSignature, type RawRequest } from './signature.js';
import { bearer, verifySupabaseToken } from './supabase-jwt.js';

export interface Auth {
  userId: string;
  perfilId: string;
  sessionId: string;
  roles: { rol: RolNombre; sedeId: string | null }[];
}

export type AuthedRequest = RawRequest & { auth: Auth };

/**
 * Exige, en este orden:
 *  1. `Authorization: Bearer <JWT de Supabase>` válido (firma ES256 de Supabase, vigente),
 *  2. que esa sesión tenga un dispositivo registrado, vivo y de la misma persona,
 *  3. que la petición venga firmada con la llave de ese dispositivo,
 *  4. si la ruta usa @Roles(...), que la persona tenga alguno de esos roles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly dispositivos: DispositivosService,
    private readonly perfiles: PerfilesService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const claims = await verifySupabaseToken(bearer(req.header('authorization')));

    const dispositivo = await this.dispositivos.activo(claims.sessionId);
    const perfil = await this.perfiles.ensure(claims);
    if (dispositivo.perfilId !== perfil.id) {
      throw new UnauthorizedException({ message: 'Token inválido.', code: 'token_invalid' });
    }
    verifyRequestSignature(req, dispositivo.publicKey);

    const roles = await this.perfiles.roles(perfil.id);
    const required = this.reflector.getAllAndOverride<RolNombre[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required?.length && !roles.some((r) => required.includes(r.rol))) {
      throw new ForbiddenException('No tienes permiso para hacer esto.');
    }

    req.auth = { userId: claims.userId, perfilId: perfil.id, sessionId: claims.sessionId, roles };
    return true;
  }
}
