import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authCache, type Contexto } from './auth-cache.js';
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

    let ctxSesion = authCache.get(claims.sessionId);
    if (!ctxSesion || ctxSesion.userId !== claims.userId) ctxSesion = await this.cargar(claims);
    const { dispositivo, perfilId, roles } = ctxSesion;
    verifyRequestSignature(req, dispositivo.publicKey);

    const required = this.reflector.getAllAndOverride<RolNombre[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required?.length && !roles.some((r) => required.includes(r.rol))) {
      throw new ForbiddenException('No tienes permiso para hacer esto.');
    }

    req.auth = { userId: claims.userId, perfilId, sessionId: claims.sessionId, roles };
    return true;
  }

  /** Dispositivo y perfil en paralelo; luego los roles. Solo cuando no está en caché. */
  private async cargar(claims: Awaited<ReturnType<typeof verifySupabaseToken>>): Promise<Contexto> {
    const [dispositivo, perfil] = await Promise.all([this.dispositivos.activo(claims.sessionId), this.perfiles.ensure(claims)]);
    if (dispositivo.perfilId !== perfil.id) {
      throw new UnauthorizedException({ message: 'Token inválido.', code: 'token_invalid' });
    }
    const ctx: Contexto = { userId: claims.userId, dispositivo, perfilId: perfil.id, roles: await this.perfiles.roles(perfil.id) };
    authCache.set(claims.sessionId, ctx);
    return ctx;
  }
}
