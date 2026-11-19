import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { authCache } from '../auth/auth-cache.js';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { parse } from '../auth/auth.schemas.js';
import { BitacoraService } from '../common/bitacora.service.js';
import { exigirRolEn, tieneRolEn } from '../common/permisos.js';
import { crearUsuario, enviarCorreoContrasena, SupabaseAdminError } from '../common/supabase-admin.js';
import { config } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CATEGORIAS,
  coachCrearSchema,
  EQUIPOS,
  ejercicioCrearSchema,
  ejercicioEditarSchema,
  fisicoSchema,
  maquinaCrearSchema,
  maquinaEditarSchema,
  medicionSchema,
  OBJETIVOS,
  rutinaSchema,
  saludSchema,
} from './coach.schemas.js';
import { CoachService } from './coach.service.js';

const GESTION = ['admin', 'encargado'] as const;
/** Quién trabaja con rutinas y catálogo: coaches y quien administra la sede. */
const ENTRENA = ['admin', 'encargado', 'coach'] as const;

@Controller()
@UseGuards(AuthGuard)
export class CoachController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coach: CoachService,
    private readonly bitacora: BitacoraService,
  ) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  /** Catálogos fijos (grupos musculares, equipo, objetivos) para los formularios. */
  @Get('catalogos/entrenamiento')
  catalogos() {
    return { categorias: CATEGORIAS, equipos: EQUIPOS, objetivos: OBJETIVOS };
  }

  /* ================= Coaches de una sede (admin / encargado) ================= */

  @Get('sedes/:id/coaches')
  async coaches(@Req() req: AuthedRequest, @Param('id') id: string) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const roles = await this.orm.RolAsignado.where({ sedeId: id, rol: 'coach' }).select('perfilId').all();
    const ids = roles.map((r) => r.perfilId);
    if (!ids.length) return [];
    const [perfiles, rutinas] = await Promise.all([
      this.orm.Perfil.where((p) => p.id.in(ids)).select('id', 'nombre', 'email', 'fotoUrl').orderBy((p) => p.nombre.asc()).all(),
      this.orm.Rutina.where({ sedeId: id, activa: true }).where((r) => r.coachPerfilId.in(ids)).select('coachPerfilId').all(),
    ]);
    return perfiles.map((p) => ({ ...p, rutinasActivas: rutinas.filter((r) => r.coachPerfilId === p.id).length }));
  }

  /** Da de alta a un coach: crea su cuenta (o usa la que ya tiene) y le manda el correo para su contraseña. */
  @Post('sedes/:id/coaches')
  async crearCoach(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const { nombre, email } = parse(coachCrearSchema, body);
    const sede = await this.orm.Sede.where({ id }).select('id').first();
    if (!sede) throw new NotFoundException('No existe esa sede.');

    let perfil = await this.orm.Perfil.where({ email }).first();
    if (perfil) {
      const otra = await this.orm.RolAsignado.where({ perfilId: perfil.id, rol: 'coach' }).select('sedeId').first();
      if (otra?.sedeId === id) throw new ConflictException('Ya es coach de esta sede.');
      if (otra) throw new ConflictException('Ya es coach de otra sede. Un coach trabaja en una sola sede.');
    } else {
      let userId: string;
      try {
        userId = (await crearUsuario(email, undefined, nombre)).id;
      } catch (err) {
        if (err instanceof SupabaseAdminError && (err.code === 'email_exists' || err.status === 422)) {
          throw new ConflictException('Ese correo ya tiene cuenta. Pide a la persona que inicie sesión una vez y vuelve a intentarlo.');
        }
        throw err;
      }
      perfil = await this.orm.Perfil.create({ userId, email, nombre, sedeId: id, verificado: true });
    }
    await this.orm.RolAsignado.create({ perfilId: perfil.id, rol: 'coach', sedeId: id });
    authCache.invalidarPerfil(perfil.id);
    const correoEnviado = await enviarCorreoContrasena(email, `${config.frontendUrls[0]}/restablecer`);
    void this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'coach.alta', entidad: 'Perfil', entidadId: perfil.id, datos: { email } });
    return { id: perfil.id, nombre: perfil.nombre ?? nombre, email, correoEnviado };
  }

  /** Quita el rol de coach (la cuenta y sus rutinas quedan). */
  @Delete('sedes/:id/coaches/:perfilId')
  @HttpCode(204)
  async quitarCoach(@Req() req: AuthedRequest, @Param('id') id: string, @Param('perfilId') perfilId: string) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const n = await this.orm.RolAsignado.where({ perfilId, sedeId: id, rol: 'coach' }).deleteAll();
    authCache.invalidarPerfil(perfilId);
    void this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'coach.baja', entidad: 'Perfil', entidadId: perfilId, datos: { quitados: n } });
  }

  /* ================= Panel del coach ================= */

  /** GET /coach/:sedeId/socios?q= — socios con racha semanal/consecutiva, objetivo y si tienen rutina. */
  @Get('coach/:sedeId/socios')
  socios(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Query('q') q = '') {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    return this.coach.socios(sedeId, q);
  }

  @Get('coach/:sedeId/socios/:perfilId')
  async ficha(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('perfilId') perfilId: string) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    await this.coach.exigirSocio(perfilId, sedeId);
    // Salud: solo coaches de la sede (privado; ni recepción ni administración).
    return this.coach.ficha(perfilId, sedeId, tieneRolEn(req.auth, sedeId, ['coach']));
  }

  @Patch('coach/:sedeId/socios/:perfilId')
  async fisico(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('perfilId') perfilId: string, @Body() body: unknown) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    await this.coach.exigirSocio(perfilId, sedeId);
    await this.coach.actualizarFisico({ perfilId: req.auth.perfilId }, perfilId, parse(fisicoSchema, body));
    return { ok: true };
  }

  @Put('coach/:sedeId/socios/:perfilId/salud')
  async salud(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('perfilId') perfilId: string, @Body() body: unknown) {
    if (!tieneRolEn(req.auth, sedeId, ['coach'])) throw new ForbiddenException('Solo los coaches de la sede ven y editan los datos de salud.');
    await this.coach.exigirSocio(perfilId, sedeId);
    return this.coach.guardarSalud({ perfilId: req.auth.perfilId }, perfilId, parse(saludSchema, body));
  }

  @Post('coach/:sedeId/socios/:perfilId/mediciones')
  async medicion(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('perfilId') perfilId: string, @Body() body: unknown) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    await this.coach.exigirSocio(perfilId, sedeId);
    return this.coach.registrarMedicion({ perfilId: req.auth.perfilId }, perfilId, parse(medicionSchema, body));
  }

  /** PUT …/rutina — guarda la rutina nueva (la anterior queda en el historial). */
  @Put('coach/:sedeId/socios/:perfilId/rutina')
  async rutina(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('perfilId') perfilId: string, @Body() body: unknown) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    const input = parse(rutinaSchema, body);
    await this.coach.exigirSocio(perfilId, sedeId);
    return this.coach.guardarRutina({ perfilId: req.auth.perfilId }, sedeId, perfilId, input);
  }

  @Delete('coach/:sedeId/socios/:perfilId/rutina')
  @HttpCode(204)
  async quitarRutina(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('perfilId') perfilId: string) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    await this.coach.exigirSocio(perfilId, sedeId);
    await this.coach.quitarRutina({ perfilId: req.auth.perfilId }, sedeId, perfilId);
  }

  /* ---------- Catálogo: máquinas y ejercicios ---------- */

  @Get('coach/:sedeId/catalogo')
  catalogo(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    return this.coach.catalogo(sedeId);
  }

  @Post('coach/:sedeId/maquinas')
  async crearMaquina(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Body() body: unknown) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    const input = parse(maquinaCrearSchema, body);
    const m = await this.orm.Maquina.create({ ...input, sedeId });
    void this.bitacora.registrar({ sedeId, actorPerfilId: req.auth.perfilId, accion: 'maquina.crear', entidad: 'Maquina', entidadId: m.id, datos: input });
    return { id: m.id, nombre: m.nombre, categoria: m.categoria, activa: m.activa };
  }

  @Patch('coach/:sedeId/maquinas/:id')
  async editarMaquina(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    const input = parse(maquinaEditarSchema, body);
    const antes = await this.orm.Maquina.first({ id });
    if (!antes || antes.sedeId !== sedeId) throw new NotFoundException('Máquina no encontrada.');
    const m = (await this.orm.Maquina.where({ id }).update(input))!;
    void this.bitacora.registrar({ sedeId, actorPerfilId: req.auth.perfilId, accion: 'maquina.editar', entidad: 'Maquina', entidadId: id, datos: input });
    return { id: m.id, nombre: m.nombre, categoria: m.categoria, activa: m.activa };
  }

  @Post('coach/:sedeId/ejercicios')
  async crearEjercicio(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Body() body: unknown) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    const input = parse(ejercicioCrearSchema, body);
    const maquinaId = input.equipo === 'maquina' ? (input.maquinaId ?? null) : null;
    await this.coach.validarMaquina(sedeId, maquinaId);
    const e = await this.orm.Ejercicio.create({ ...input, maquinaId, indicaciones: input.indicaciones ?? null, sedeId });
    void this.bitacora.registrar({ sedeId, actorPerfilId: req.auth.perfilId, accion: 'ejercicio.crear', entidad: 'Ejercicio', entidadId: e.id, datos: { nombre: e.nombre } });
    return e;
  }

  @Patch('coach/:sedeId/ejercicios/:id')
  async editarEjercicio(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    exigirRolEn(req.auth, sedeId, [...ENTRENA]);
    const input = parse(ejercicioEditarSchema, body);
    const antes = await this.orm.Ejercicio.first({ id });
    if (!antes || antes.sedeId !== sedeId) throw new NotFoundException('Ejercicio no encontrado.');
    const equipo = input.equipo ?? antes.equipo;
    const maquinaId = equipo === 'maquina' ? (input.maquinaId !== undefined ? input.maquinaId : antes.maquinaId) : null;
    if (equipo === 'maquina' && !maquinaId) throw new BadRequestException('Elige la máquina.');
    await this.coach.validarMaquina(sedeId, maquinaId);
    const e = await this.orm.Ejercicio.where({ id }).update({ ...input, maquinaId });
    void this.bitacora.registrar({ sedeId, actorPerfilId: req.auth.perfilId, accion: 'ejercicio.editar', entidad: 'Ejercicio', entidadId: id, datos: input });
    return e;
  }

  /* ================= El propio socio ================= */

  private sedeSocio(req: AuthedRequest) {
    const sedeId = req.auth.roles.find((r) => r.rol === 'socio')?.sedeId;
    if (!sedeId) throw new BadRequestException('Primero detecta tu sede.');
    return sedeId;
  }

  /** GET /yo/entrenamiento — su ficha (con salud), racha, avance y rutina. */
  @Get('yo/entrenamiento')
  miFicha(@Req() req: AuthedRequest) {
    return this.coach.ficha(req.auth.perfilId, this.sedeSocio(req), true);
  }

  @Patch('yo/fisico')
  async miFisico(@Req() req: AuthedRequest, @Body() body: unknown) {
    await this.coach.actualizarFisico({ perfilId: req.auth.perfilId }, req.auth.perfilId, parse(fisicoSchema, body));
    return { ok: true };
  }

  @Put('yo/salud')
  miSalud(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.coach.guardarSalud({ perfilId: req.auth.perfilId }, req.auth.perfilId, parse(saludSchema, body));
  }

  @Post('yo/mediciones')
  miMedicion(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.coach.registrarMedicion({ perfilId: req.auth.perfilId }, req.auth.perfilId, parse(medicionSchema, body));
  }
}
