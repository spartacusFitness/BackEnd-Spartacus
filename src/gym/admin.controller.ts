import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { parse } from '../auth/auth.schemas.js';
import { BitacoraService } from '../common/bitacora.service.js';
import { aFecha, ymd } from '../common/fechas.js';
import { hashSecret } from '../common/hash.js';
import { esAdmin, exigirRolEn, sedesCon } from '../common/permisos.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GymService } from './gym.service.js';
import {
  diaCerradoSchema,
  planCrearSchema,
  planEditarSchema,
  recepcionistaCrearSchema,
  recepcionistaEditarSchema,
  sedeCrearSchema,
  sedeEditarSchema,
} from './gym.schemas.js';

const GESTION = ['admin', 'encargado'] as const;
const STAFF = ['admin', 'encargado', 'recepcion'] as const;

/** Administración: sedes, días cerrados, cuenta de recepción, recepcionistas, planes y bitácora. */
@Controller('sedes')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gym: GymService,
    private readonly bitacora: BitacoraService,
  ) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  private actor(req: AuthedRequest) {
    return { perfilId: req.auth.perfilId };
  }

  /* ---------- Sedes ---------- */

  /** GET /sedes — admin: todas; encargado/recepción: las suyas; los demás: las activas. */
  @Get()
  async listar(@Req() req: AuthedRequest) {
    const mias = sedesCon(req.auth, [...STAFF]);
    const todas = await this.orm.Sede.orderBy((s) => s.nombre.asc()).all();
    if (mias === null) return todas;
    if (mias.length) return todas.filter((s) => mias.includes(s.id));
    return todas.filter((s) => s.activa).map(({ id, nombre, ciudad, direccion, lat, lng, mapsUrl }) => ({ id, nombre, ciudad, direccion, lat, lng, mapsUrl }));
  }

  /** POST /sedes (solo admin) */
  @Post()
  async crear(@Req() req: AuthedRequest, @Body() body: unknown) {
    if (!esAdmin(req.auth)) throw new ForbiddenException('Solo un administrador puede crear sedes.');
    const input = parse(sedeCrearSchema, body);
    if (await this.orm.Sede.first({ id: input.id })) throw new ConflictException('Ya existe una sede con ese identificador.');
    const sede = await this.orm.Sede.create({ ...input, mapsUrl: input.mapsUrl ?? null });
    await this.bitacora.registrar({ sedeId: sede.id, actorPerfilId: req.auth.perfilId, accion: 'sede.crear', entidad: 'Sede', entidadId: sede.id, datos: input });
    return sede;
  }

  /** PATCH /sedes/:id — admin o encargado de esa sede (activar/desactivar: solo admin). */
  @Patch(':id')
  async editar(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const input = parse(sedeEditarSchema, body);
    if (input.activa !== undefined && !esAdmin(req.auth)) throw new ForbiddenException('Solo un administrador puede activar o desactivar sedes.');
    const antes = await this.gym.sede(id);
    const { diasSinServicio, ...rest } = input;
    const sede = await this.orm.Sede.where({ id }).update({
      ...rest,
      ...(diasSinServicio ? { diasSinServicio: [...new Set(diasSinServicio)].sort().join(',') } : {}),
    });
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'sede.editar', entidad: 'Sede', entidadId: id, datos: { antes, cambios: input } });
    return sede;
  }

  /* ---------- Días cerrados ---------- */

  @Get(':id/dias-cerrados')
  async diasCerrados(@Req() req: AuthedRequest, @Param('id') id: string) {
    exigirRolEn(req.auth, id, [...STAFF]);
    const dias = await this.orm.DiaCerrado.where({ sedeId: id }).orderBy((d) => d.fecha.asc()).all();
    return dias.map((d) => ({ id: d.id, fecha: ymd(d.fecha), motivo: d.motivo }));
  }

  @Post(':id/dias-cerrados')
  async agregarDia(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const { fecha, motivo } = parse(diaCerradoSchema, body);
    await this.gym.sede(id);
    if (await this.orm.DiaCerrado.where({ sedeId: id, fecha: aFecha(fecha) }).first()) throw new ConflictException('Ese día ya está marcado como cerrado.');
    const d = await this.orm.DiaCerrado.create({ sedeId: id, fecha: aFecha(fecha), motivo });
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'dia_cerrado.crear', entidad: 'DiaCerrado', entidadId: d.id, datos: { fecha, motivo } });
    return { id: d.id, fecha, motivo };
  }

  @Delete(':id/dias-cerrados/:diaId')
  @HttpCode(204)
  async quitarDia(@Req() req: AuthedRequest, @Param('id') id: string, @Param('diaId', ParseIntPipe) diaId: number) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const d = await this.orm.DiaCerrado.first({ id: diaId });
    if (!d || d.sedeId !== id) throw new NotFoundException('Día no encontrado.');
    await this.orm.DiaCerrado.where({ id: diaId }).delete();
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'dia_cerrado.quitar', entidad: 'DiaCerrado', entidadId: diaId, datos: { fecha: ymd(d.fecha) } });
  }

  /* ---------- Cuenta de recepción ---------- */

  /** POST /sedes/:id/cuenta-recepcion — crea la cuenta "<sede>@recepcion" o restablece su contraseña. */
  @Post(':id/cuenta-recepcion')
  @HttpCode(200)
  cuentaRecepcion(@Req() req: AuthedRequest, @Param('id') id: string) {
    exigirRolEn(req.auth, id, [...GESTION]);
    return this.gym.cuentaRecepcion(this.actor(req), id);
  }

  /* ---------- Recepcionistas (PIN) ---------- */

  @Get(':id/recepcionistas')
  async recepcionistas(@Req() req: AuthedRequest, @Param('id') id: string) {
    exigirRolEn(req.auth, id, [...STAFF]);
    const rs = await this.orm.Recepcionista.where({ sedeId: id }).orderBy((r) => r.nombre.asc()).all();
    return rs.map((r) => ({ id: r.id, nombre: r.nombre, activo: r.activo, bloqueado: !!r.bloqueadoHasta && r.bloqueadoHasta.getTime() > Date.now() }));
  }

  @Post(':id/recepcionistas')
  crearRecepcionista(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const { nombre, pin } = parse(recepcionistaCrearSchema, body);
    return this.gym.crearRecepcionista(this.actor(req), id, nombre, pin);
  }

  @Patch(':id/recepcionistas/:rid')
  async editarRecepcionista(@Req() req: AuthedRequest, @Param('id') id: string, @Param('rid', ParseIntPipe) rid: number, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const input = parse(recepcionistaEditarSchema, body);
    const r = await this.orm.Recepcionista.first({ id: rid });
    if (!r || r.sedeId !== id) throw new NotFoundException('Recepcionista no encontrado.');
    const upd = await this.orm.Recepcionista.where({ id: rid }).update({
      ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
      ...(input.activo !== undefined ? { activo: input.activo } : {}),
      // Cambiar el PIN también desbloquea.
      ...(input.pin !== undefined ? { pinHash: await hashSecret(input.pin), intentosFallidos: 0, bloqueadoHasta: null } : {}),
    });
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'recepcionista.editar', entidad: 'Recepcionista', entidadId: rid, datos: { nombre: input.nombre, activo: input.activo, pinCambiado: input.pin !== undefined } });
    return { id: upd!.id, nombre: upd!.nombre, activo: upd!.activo };
  }

  /* ---------- Planes ---------- */

  /** GET /sedes/:id/planes — staff ve todos; socios y visitantes solo los activos. */
  @Get(':id/planes')
  async planes(@Req() req: AuthedRequest, @Param('id') id: string, @Query('todos') todos?: string) {
    const staff = sedesCon(req.auth, [...STAFF]);
    const verTodos = todos === '1' && (staff === null || staff.includes(id));
    const q = this.orm.Plan.where({ sedeId: id });
    const planes = await (verTodos ? q : q.where({ activo: true })).orderBy((p) => p.precio.asc()).all();
    return planes;
  }

  @Post(':id/planes')
  async crearPlan(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const input = parse(planCrearSchema, body);
    await this.gym.sede(id);
    const plan = await this.orm.Plan.create({ ...input, sedeId: id, descripcion: input.descripcion ?? null });
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'plan.crear', entidad: 'Plan', entidadId: plan.id, datos: input });
    return plan;
  }

  @Patch(':id/planes/:pid')
  async editarPlan(@Req() req: AuthedRequest, @Param('id') id: string, @Param('pid', ParseIntPipe) pid: number, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const input = parse(planEditarSchema, body);
    const antes = await this.orm.Plan.first({ id: pid });
    if (!antes || antes.sedeId !== id) throw new NotFoundException('Plan no encontrado.');
    const plan = await this.orm.Plan.where({ id: pid }).update(input);
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'plan.editar', entidad: 'Plan', entidadId: pid, datos: { antes, cambios: input } });
    return plan;
  }

  /* ---------- Bitácora ---------- */

  @Get(':id/bitacora')
  async verBitacora(@Req() req: AuthedRequest, @Param('id') id: string, @Query('limite') limite?: string) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const filas = await this.bitacora.listar(id, Number(limite) || 100);
    return filas.map((b) => ({ ...b, datos: b.datos ? JSON.parse(b.datos) : null }));
  }
}
