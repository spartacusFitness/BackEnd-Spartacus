import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { parse } from '../auth/auth.schemas.js';
import { aFecha, hoy, sumarDias, ymd } from '../common/fechas.js';
import { exigirRolEn } from '../common/permisos.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GymService } from './gym.service.js';
import { abrirTurnoSchema, altaSocioSchema, asistenciaSchema, cerrarTurnoSchema, cobroSchema } from './gym.schemas.js';

const STAFF = ['admin', 'encargado', 'recepcion'] as const;

/** Mostrador: turnos, solicitudes, socios, cobros y asistencia de UNA sede. */
@Controller('recepcion/:sedeId')
@UseGuards(AuthGuard)
export class RecepcionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gym: GymService,
  ) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  private permiso(req: AuthedRequest, sedeId: string) {
    exigirRolEn(req.auth, sedeId, [...STAFF]);
    return { perfilId: req.auth.perfilId };
  }

  /** GET /recepcion/:sedeId/estado — turno abierto, recepcionistas y pendientes. */
  @Get('estado')
  async estado(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string) {
    this.permiso(req, sedeId);
    const sede = await this.gym.sede(sedeId);
    await this.gym.vencerSolicitudes(sedeId);
    const turno = await this.gym.turnoAbierto(sedeId);
    const recepcionistas = await this.orm.Recepcionista.where({ sedeId, activo: true }).select('id', 'nombre').orderBy((r) => r.nombre.asc()).all();
    const pendientes = await this.orm.Solicitud.where({ sedeId, estado: 'pendiente_pago' }).aggregate((a) => ({ n: a.count() }));
    const desde = new Date(`${hoy()}T00:00:00-06:00`);
    const entradas = await this.orm.Asistencia.where({ sedeId, resultado: 'permitida' })
      .where((a) => a.createdAt.gte(desde))
      .aggregate((a) => ({ n: a.count() }));
    return {
      sede: { id: sede.id, nombre: sede.nombre, antipassbackMin: sede.antipassbackMin },
      turno: turno
        ? {
            id: turno.id,
            abiertoEn: turno.abiertoEn,
            efectivoInicial: turno.efectivoInicial,
            recepcionista: recepcionistas.find((r) => r.id === turno.recepcionistaId)?.nombre ?? '',
            ...(await this.gym.resumenTurno(turno.id)),
          }
        : null,
      recepcionistas,
      solicitudesPendientes: pendientes.n,
      entradasHoy: entradas.n,
    };
  }

  @Post('turno/abrir')
  abrir(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Body() body: unknown) {
    const actor = this.permiso(req, sedeId);
    const { recepcionistaId, pin, efectivoInicial } = parse(abrirTurnoSchema, body);
    return this.gym.abrirTurno(actor, sedeId, recepcionistaId, pin, efectivoInicial);
  }

  @Post('turno/cerrar')
  @HttpCode(200)
  cerrar(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Body() body: unknown) {
    const actor = this.permiso(req, sedeId);
    const { pin, efectivoContado, notas } = parse(cerrarTurnoSchema, body);
    return this.gym.cerrarTurno(actor, sedeId, pin, efectivoContado, notas);
  }

  /** GET /recepcion/:sedeId/turnos — cortes recientes. */
  @Get('turnos')
  async turnos(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string) {
    this.permiso(req, sedeId);
    const ts = await this.orm.Turno.where({ sedeId }).orderBy((t) => t.id.desc()).limit(30).all();
    const nombres = new Map((await this.orm.Recepcionista.where({ sedeId }).select('id', 'nombre').all()).map((r) => [r.id, r.nombre]));
    return ts.map((t) => ({ ...t, recepcionista: nombres.get(t.recepcionistaId) ?? '' }));
  }

  /** GET /recepcion/:sedeId/solicitudes */
  @Get('solicitudes')
  async solicitudes(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string) {
    this.permiso(req, sedeId);
    await this.gym.vencerSolicitudes(sedeId);
    const sols = await this.orm.Solicitud.where({ sedeId })
      .where((s) => s.createdAt.gte(aFecha(sumarDias(hoy(), -45))))
      .orderBy((s) => s.id.desc())
      .limit(100)
      .all();
    const perfiles = await this.perfilesPorId(sols.map((s) => s.perfilId));
    const planes = new Map((await this.orm.Plan.where({ sedeId }).all()).map((p) => [p.id, p]));
    return sols.map((s) => ({
      id: s.id,
      estado: s.estado,
      metodo: s.metodo,
      venceEn: s.venceEn,
      creadaEn: s.createdAt,
      socio: perfiles.get(s.perfilId) ?? null,
      plan: planes.get(s.planId) ? { id: s.planId, nombre: planes.get(s.planId)!.nombre, precio: planes.get(s.planId)!.precio, requiereValidacion: planes.get(s.planId)!.requiereValidacion } : null,
    }));
  }

  private async perfilesPorId(ids: string[]) {
    const unicos = [...new Set(ids)];
    if (!unicos.length) return new Map<string, { id: string; nombre: string | null; email: string; fotoUrl: string | null }>();
    const ps = await this.orm.Perfil.where((p) => p.id.in(unicos)).select('id', 'nombre', 'email', 'fotoUrl').all();
    return new Map(ps.map((p) => [p.id, p]));
  }

  /** GET /recepcion/:sedeId/socios?q= — busca socios de la sede por nombre o correo. */
  @Get('socios')
  async buscar(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Query('q') q = '') {
    this.permiso(req, sedeId);
    const term = q.trim().replace(/[%_\\]/g, '');
    const base = this.orm.Perfil.where({ sedeId });
    const filtro = term.length >= 2 ? base.where((p) => (term.includes('@') ? p.email.ilike(`%${term}%`) : p.nombre.ilike(`%${term}%`))) : base;
    const ps = await filtro.select('id', 'nombre', 'email', 'fotoUrl', 'verificado').orderBy((p) => p.nombre.asc()).limit(30).all();
    const socios = new Set((await this.orm.RolAsignado.where({ sedeId, rol: 'socio' }).select('perfilId').all()).map((r) => r.perfilId));
    const out = [];
    for (const p of ps.filter((p) => socios.has(p.id))) {
      const m = await this.gym.membresiaVigente(p.id, sedeId);
      out.push({ ...p, vigenteHasta: m ? ymd(m.fin) : null });
    }
    return out;
  }

  /** GET /recepcion/:sedeId/socios/:perfilId — ficha para el mostrador. */
  @Get('socios/:perfilId')
  async ficha(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Param('perfilId') perfilId: string) {
    this.permiso(req, sedeId);
    const p = await this.orm.Perfil.first({ id: perfilId });
    if (!p || p.sedeId !== sedeId) throw new NotFoundException('Socio no encontrado en esta sede.');
    const vigente = await this.gym.membresiaVigente(p.id, sedeId);
    const planes = new Map((await this.orm.Plan.where({ sedeId }).select('id', 'nombre').all()).map((x) => [x.id, x.nombre]));
    const membresias = await this.orm.Membresia.where({ perfilId, sedeId }).orderBy((m) => m.fin.desc()).limit(10).all();
    const asistencias = await this.orm.Asistencia.where({ perfilId, sedeId }).orderBy((a) => a.id.desc()).limit(10).all();
    return {
      id: p.id,
      nombre: p.nombre,
      email: p.email,
      fotoUrl: p.fotoUrl,
      verificado: p.verificado,
      fechaNacimiento: p.fechaNacimiento ? ymd(p.fechaNacimiento) : null,
      vigente: vigente ? { plan: planes.get(vigente.planId) ?? '', inicio: ymd(vigente.inicio), fin: ymd(vigente.fin) } : null,
      membresias: membresias.map((m) => ({ id: m.id, plan: planes.get(m.planId) ?? '', inicio: ymd(m.inicio), fin: ymd(m.fin) })),
      asistencias: asistencias.map((a) => ({ id: a.id, resultado: a.resultado, origen: a.origen, fecha: a.createdAt })),
    };
  }

  /** POST /recepcion/:sedeId/socios — alta en mostrador. */
  @Post('socios')
  async alta(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Body() body: unknown) {
    const actor = this.permiso(req, sedeId);
    const { nombre, email, fechaNacimiento } = parse(altaSocioSchema, body);
    const { perfil, correoEnviado } = await this.gym.altaSocio(actor, sedeId, nombre, email, fechaNacimiento);
    return { id: perfil.id, nombre: perfil.nombre, email: perfil.email, correoEnviado };
  }

  /** POST /recepcion/:sedeId/cobros — cobra una membresía (efectivo o terminal) y la activa. */
  @Post('cobros')
  cobrar(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Body() body: unknown) {
    const actor = this.permiso(req, sedeId);
    return this.gym.cobrarMembresia(actor, sedeId, parse(cobroSchema, body));
  }

  /** POST /recepcion/:sedeId/asistencias — entrada registrada en mostrador (provisional hasta ZKTeco). */
  @Post('asistencias')
  asistencia(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Body() body: unknown) {
    const actor = this.permiso(req, sedeId);
    const { perfilId } = parse(asistenciaSchema, body);
    return this.gym.registrarAsistencia(actor, sedeId, perfilId, 'recepcion');
  }
}
