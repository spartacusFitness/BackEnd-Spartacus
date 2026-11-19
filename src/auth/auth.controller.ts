import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from './auth.guard.js';
import { dispositivoSchema, fotoSchema, parse, perfilSchema, sedeSchema } from './auth.schemas.js';
import { DispositivosService } from './dispositivos.service.js';
import { PerfilesService } from './perfiles.service.js';
import { verifyRequestSignature, type RawRequest } from './signature.js';
import { bearer, verifySupabaseToken } from './supabase-jwt.js';

/**
 * El inicio de sesión (correo, Google, verificación, recuperar contraseña) lo hace Supabase Auth
 * en el navegador. Aquí: el dispositivo registra su llave de firma y la persona gestiona su perfil.
 * Todas las rutas exigen petición firmada.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly perfiles: PerfilesService,
    private readonly dispositivos: DispositivosService,
  ) {}

  /**
   * POST /auth/dispositivo { publicKey, remember }
   * Bearer de Supabase + firmada con la llave que se registra (prueba de que la tiene).
   * Crea el perfil la primera vez. Se llama justo después de iniciar sesión.
   */
  @Post('dispositivo')
  @HttpCode(200)
  async dispositivo(@Req() req: RawRequest, @Body() body: unknown) {
    const claims = await verifySupabaseToken(bearer(req.header('authorization')));
    const input = parse(dispositivoSchema, body);
    verifyRequestSignature(req, input.publicKey);
    const perfil = await this.perfiles.ensure(claims);
    await this.dispositivos.registrar(claims.sessionId, perfil.id, input.publicKey, input.remember, req.header('user-agent'));
    return this.perfiles.yo(perfil.id);
  }

  /** GET /auth/me */
  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest) {
    return this.perfiles.yo(req.auth.perfilId);
  }

  /** PATCH /auth/me { nombre?, apodo?, fechaNacimiento? } */
  @Patch('me')
  @UseGuards(AuthGuard)
  actualizar(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.perfiles.actualizar(req.auth.perfilId, parse(perfilSchema, body));
  }

  /** PATCH /auth/me/sede { location } → sede más cercana. */
  @Patch('me/sede')
  @UseGuards(AuthGuard)
  sede(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { location } = parse(sedeSchema, body);
    return this.perfiles.asignarSede(req.auth.perfilId, location.lat, location.lng);
  }

  /** PATCH /auth/me/foto { path } → foto ya subida a Storage (bucket avatars). */
  @Patch('me/foto')
  @UseGuards(AuthGuard)
  foto(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { path } = parse(fotoSchema, body);
    return this.perfiles.guardarFoto(req.auth.perfilId, req.auth.userId, path);
  }

  /** POST /auth/logout → este dispositivo deja de servir de inmediato (aunque el JWT siga vigente). */
  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Req() req: AuthedRequest) {
    await this.dispositivos.revocar(req.auth.sessionId);
  }
}
