import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { parse } from '../auth/auth.schemas.js';
import { exigirRolEn, tieneRolEn } from '../common/permisos.js';
import { CoachService } from './coach.service.js';
import { mensajeSchema, rankingSchema, retoCrearSchema, retoEditarSchema } from './comunidad.schemas.js';
import { ComunidadService } from './comunidad.service.js';

const GESTION = ['admin', 'encargado'] as const;

@Controller()
@UseGuards(AuthGuard)
export class ComunidadController {
  constructor(
    private readonly comunidad: ComunidadService,
    private readonly coach: CoachService,
  ) {}

  /** Sede del socio + membresía vigente (sin ella la app queda bloqueada). */
  private async socioActivo(req: AuthedRequest) {
    const sedeId = req.auth.roles.find((r) => r.rol === 'socio')?.sedeId;
    if (!sedeId) throw new BadRequestException('Primero detecta tu sede.');
    await this.coach.exigirMembresia(req.auth.perfilId, sedeId);
    return sedeId;
  }

  /** Los mensajes son entre el socio y los coaches de la sede: solo el rol coach los lee y contesta. */
  private exigirCoach(req: AuthedRequest, sedeId: string) {
    if (!tieneRolEn(req.auth, sedeId, ['coach'])) throw new ForbiddenException('Solo los coaches de la sede atienden los mensajes.');
  }

  /* ---------------- Socio ---------------- */

  /** GET /yo/comunidad — logros, ranking del mes y retos de su sede. */
  @Get('yo/comunidad')
  async miComunidad(@Req() req: AuthedRequest) {
    return this.comunidad.comunidad(req.auth.perfilId, await this.socioActivo(req));
  }

  /** PUT /yo/ranking — aparecer o no en el ranking (opcional). */
  @Put('yo/ranking')
  @HttpCode(204)
  async miRanking(@Req() req: AuthedRequest, @Body() body: unknown) {
    await this.socioActivo(req);
    await this.comunidad.participarRanking(req.auth.perfilId, parse(rankingSchema, body).participar);
  }

  @Post('yo/retos/:id')
  @HttpCode(204)
  async inscribirme(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    await this.comunidad.inscribir(req.auth.perfilId, await this.socioActivo(req), id);
  }

  @Delete('yo/retos/:id')
  @HttpCode(204)
  async salirme(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    await this.comunidad.salir(req.auth.perfilId, await this.socioActivo(req), id);
  }

  /** GET /yo/mensajes — su conversación con los coaches (marca como leído lo que le contestaron). */
  @Get('yo/mensajes')
  async misMensajes(@Req() req: AuthedRequest) {
    return this.comunidad.conversacion(req.auth.perfilId, await this.socioActivo(req), 'socio');
  }

  @Get('yo/mensajes/sin-leer')
  async misSinLeer(@Req() req: AuthedRequest) {
    return { n: await this.comunidad.sinLeerSocio(req.auth.perfilId, await this.socioActivo(req)) };
  }

  @Post('yo/mensajes')
  async escribir(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { texto } = parse(mensajeSchema, body);
    return this.comunidad.enviar(req.auth.perfilId, await this.socioActivo(req), req.auth.perfilId, false, texto);
  }

  /* ---------------- Coach ---------------- */

  @Get('coach/:sedeId/mensajes')
  bandeja(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string) {
    this.exigirCoach(req, sedeId);
    return this.comunidad.bandeja(sedeId);
  }

  @Get('coach/:sedeId/socios/:perfilId/mensajes')
  async conversacion(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('perfilId') perfilId: string) {
    this.exigirCoach(req, sedeId);
    await this.coach.exigirSocio(perfilId, sedeId);
    return this.comunidad.conversacion(perfilId, sedeId, 'coach');
  }

  @Post('coach/:sedeId/socios/:perfilId/mensajes')
  async contestar(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('perfilId') perfilId: string, @Body() body: unknown) {
    this.exigirCoach(req, sedeId);
    const { texto } = parse(mensajeSchema, body);
    await this.coach.exigirSocio(perfilId, sedeId);
    return this.comunidad.enviar(perfilId, sedeId, req.auth.perfilId, true, texto);
  }

  /* ---------------- Administración de retos ---------------- */

  @Get('sedes/:id/retos')
  retos(@Req() req: AuthedRequest, @Param('id') id: string) {
    exigirRolEn(req.auth, id, [...GESTION]);
    return this.comunidad.retosAdmin(id);
  }

  @Post('sedes/:id/retos')
  crearReto(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    return this.comunidad.crearReto({ perfilId: req.auth.perfilId }, id, parse(retoCrearSchema, body));
  }

  @Patch('sedes/:id/retos/:rid')
  @HttpCode(204)
  async editarReto(@Req() req: AuthedRequest, @Param('id') id: string, @Param('rid', ParseIntPipe) rid: number, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    await this.comunidad.editarReto({ perfilId: req.auth.perfilId }, id, rid, parse(retoEditarSchema, body));
  }
}
