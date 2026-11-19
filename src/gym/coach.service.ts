import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BitacoraService } from '../common/bitacora.service.js';
import { aFecha, diaSemana, hoy, sumarDias, ymd, type Calendario } from '../common/fechas.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Actor } from './gym.service.js';
import { GymService } from './gym.service.js';

export interface Racha {
  /** días distintos que vino esta semana (lunes a domingo) */
  semana: number;
  /** "AAAA-MM-DD" de los días que vino esta semana */
  diasSemana: string[];
  /** días hábiles seguidos; perdona fines de semana, días sin servicio y días cerrados */
  consecutiva: number;
  ultimaVisita: string | null;
}

export interface RutinaInput {
  nombre: string;
  notas?: string | null;
  dias: {
    diaSemana: number;
    categorias: string[];
    notas?: string | null;
    ejercicios: { ejercicioId: number; series: number; repeticiones: string; descansoSeg?: number | null; indicaciones?: string | null }[];
  }[];
}

/** Días hacia atrás que se leen para calcular rachas. */
const VENTANA_RACHA = 120;

/** Edad cumplida a hoy (México). */
export function edad(nacimiento: Date | null) {
  if (!nacimiento) return null;
  const [a, m, d] = hoy().split('-').map(Number);
  const n = nacimiento;
  let e = a - n.getUTCFullYear();
  if (m < n.getUTCMonth() + 1 || (m === n.getUTCMonth() + 1 && d < n.getUTCDate())) e--;
  return e;
}

/** Racha a partir de los días que vino ("AAAA-MM-DD"). Pura: fácil de probar. */
export function calcularRacha(dias: Set<string>, cal: Calendario, hoyDia = hoy()): Racha {
  const lunes = sumarDias(hoyDia, -((diaSemana(hoyDia) + 6) % 7));
  const diasSemana: string[] = [];
  for (let d = lunes; d <= hoyDia; d = sumarDias(d, 1)) if (dias.has(d)) diasSemana.push(d);

  // Hoy todavía no rompe la racha: si no ha venido, se empieza a contar desde ayer.
  let d = dias.has(hoyDia) ? hoyDia : sumarDias(hoyDia, -1);
  let consecutiva = 0;
  for (let i = 0; i < VENTANA_RACHA; i++, d = sumarDias(d, -1)) {
    if (dias.has(d)) consecutiva++;
    else if (diaSemana(d) === 0 || diaSemana(d) === 6 || !cal.abierto(d)) continue; // perdonado
    else break;
  }
  const ultima = [...dias].sort().at(-1) ?? null;
  return { semana: diasSemana.length, diasSemana, consecutiva, ultimaVisita: ultima };
}

/** Reglas de la fase 3: coaches, catálogo de ejercicios, rutinas, rachas y salud. */
@Injectable()
export class CoachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gym: GymService,
    private readonly bitacora: BitacoraService,
  ) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  /* ---------------- Rachas ---------------- */

  /** Rachas de varios socios con UNA consulta de asistencias. */
  async rachas(perfilIds: string[], sedeId: string): Promise<Map<string, Racha>> {
    const out = new Map<string, Racha>();
    if (!perfilIds.length) return out;
    const desde = new Date(`${sumarDias(hoy(), -VENTANA_RACHA)}T00:00:00-06:00`);
    const [cal, filas] = await Promise.all([
      this.gym.calendario(sedeId),
      this.orm.Asistencia.where({ resultado: 'permitida' })
        .where((a) => a.perfilId.in(perfilIds))
        .where((a) => a.createdAt.gte(desde))
        .select('perfilId', 'createdAt')
        .all(),
    ]);
    const porPerfil = new Map<string, Set<string>>();
    for (const f of filas) {
      let s = porPerfil.get(f.perfilId);
      if (!s) porPerfil.set(f.perfilId, (s = new Set()));
      s.add(hoy(f.createdAt)); // día en hora de México
    }
    for (const id of perfilIds) out.set(id, calcularRacha(porPerfil.get(id) ?? new Set(), cal));
    return out;
  }

  /* ---------------- Socios para el coach ---------------- */

  /** Socios de la sede con su racha, objetivo y si tienen rutina. */
  async socios(sedeId: string, q: string) {
    const roles = await this.orm.RolAsignado.where({ sedeId, rol: 'socio' }).select('perfilId').all();
    const ids = roles.map((r) => r.perfilId);
    if (!ids.length) return [];
    const term = q.trim().replace(/[%_\\]/g, '');
    const base = this.orm.Perfil.where((p) => p.id.in(ids));
    const filtro = term.length >= 2 ? base.where((p) => p.nombre.ilike(`%${term}%`)) : base;
    const perfiles = await filtro.select('id', 'nombre', 'fotoUrl', 'fechaNacimiento', 'objetivo').orderBy((p) => p.nombre.asc()).limit(200).all();
    const pids = perfiles.map((p) => p.id);
    const [rachas, rutinas] = await Promise.all([
      this.rachas(pids, sedeId),
      pids.length ? this.orm.Rutina.where({ activa: true }).where((r) => r.perfilId.in(pids)).select('perfilId').all() : Promise.resolve([]),
    ]);
    const conRutina = new Set(rutinas.map((r) => r.perfilId));
    return perfiles.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      fotoUrl: p.fotoUrl,
      edad: edad(p.fechaNacimiento),
      objetivo: p.objetivo,
      racha: rachas.get(p.id)!,
      tieneRutina: conRutina.has(p.id),
    }));
  }

  /** El perfil debe ser socio de esa sede. */
  async exigirSocio(perfilId: string, sedeId: string) {
    const r = await this.orm.RolAsignado.where({ perfilId, sedeId, rol: 'socio' }).select('id').first();
    if (!r) throw new NotFoundException('Socio no encontrado en esta sede.');
  }

  /**
   * Ficha completa. `verSalud` solo cuando quien pide es coach de la sede o la propia persona:
   * condiciones y alergias son privadas (ni recepción ni administración las ven).
   */
  async ficha(perfilId: string, sedeId: string, verSalud: boolean) {
    const [p, salud, mediciones, rachas, rutina] = await Promise.all([
      this.orm.Perfil.first({ id: perfilId }),
      verSalud ? this.orm.Salud.first({ perfilId }) : Promise.resolve(null),
      this.orm.Medicion.where({ perfilId }).orderBy([(m) => m.fecha.desc(), (m) => m.id.desc()]).limit(24).all(),
      this.rachas([perfilId], sedeId),
      this.rutinaActiva(perfilId),
    ]);
    if (!p) throw new NotFoundException('Socio no encontrado.');
    return {
      id: p.id,
      nombre: p.nombre,
      fotoUrl: p.fotoUrl,
      edad: edad(p.fechaNacimiento),
      alturaCm: p.alturaCm,
      objetivo: p.objetivo,
      pesoKg: mediciones[0] ? mediciones[0].pesoGr / 1000 : null,
      mediciones: mediciones.map((m) => ({ id: m.id, fecha: ymd(m.fecha), pesoKg: m.pesoGr / 1000, notas: m.notas })),
      salud: verSalud ? { condiciones: salud?.condiciones ?? null, alergias: salud?.alergias ?? null } : null,
      racha: rachas.get(perfilId)!,
      rutina,
    };
  }

  async actualizarFisico(actor: Actor, perfilId: string, input: { alturaCm?: number | null; objetivo?: string | null }) {
    if (input.alturaCm === undefined && input.objetivo === undefined) throw new BadRequestException('No hay nada que cambiar.');
    await this.orm.Perfil.where({ id: perfilId }).update(input);
    void this.bitacora.registrar({ actorPerfilId: actor.perfilId, accion: 'perfil.fisico', entidad: 'Perfil', entidadId: perfilId, datos: input });
  }

  async guardarSalud(actor: Actor, perfilId: string, input: { condiciones?: string | null; alergias?: string | null }) {
    const datos = { condiciones: input.condiciones ?? null, alergias: input.alergias ?? null };
    const existe = await this.orm.Salud.where({ perfilId }).select('perfilId').first();
    if (existe) await this.orm.Salud.where({ perfilId }).update(datos);
    else await this.orm.Salud.create({ perfilId, ...datos });
    // La bitácora no guarda el contenido (es privado): solo que cambió.
    void this.bitacora.registrar({ actorPerfilId: actor.perfilId, accion: 'salud.actualizar', entidad: 'Salud', entidadId: perfilId });
    return datos;
  }

  async registrarMedicion(actor: Actor, perfilId: string, input: { pesoKg: number; fecha?: string; notas?: string | null }) {
    const dia = input.fecha ?? hoy();
    if (dia > hoy()) throw new BadRequestException('La fecha no puede ser futura.');
    const m = await this.orm.Medicion.create({
      perfilId,
      fecha: aFecha(dia),
      pesoGr: Math.round(input.pesoKg * 1000),
      notas: input.notas ?? null,
      registradoPor: actor.perfilId,
    });
    return { id: m.id, fecha: dia, pesoKg: m.pesoGr / 1000, notas: m.notas };
  }

  /* ---------------- Catálogo de la sede ---------------- */

  async catalogo(sedeId: string, soloActivos = false) {
    const [maquinas, ejercicios] = await Promise.all([
      this.orm.Maquina.where({ sedeId }).orderBy((m) => m.nombre.asc()).all(),
      this.orm.Ejercicio.where({ sedeId }).orderBy((e) => e.nombre.asc()).all(),
    ]);
    const nombreMaq = new Map(maquinas.map((m) => [m.id, m.nombre]));
    return {
      maquinas: (soloActivos ? maquinas.filter((m) => m.activa) : maquinas).map((m) => ({ id: m.id, nombre: m.nombre, categoria: m.categoria, activa: m.activa })),
      ejercicios: (soloActivos ? ejercicios.filter((e) => e.activo) : ejercicios).map((e) => ({
        id: e.id,
        nombre: e.nombre,
        categoria: e.categoria,
        equipo: e.equipo,
        maquinaId: e.maquinaId,
        maquina: e.maquinaId ? (nombreMaq.get(e.maquinaId) ?? null) : null,
        series: e.series,
        repeticiones: e.repeticiones,
        indicaciones: e.indicaciones,
        activo: e.activo,
      })),
    };
  }

  /** La máquina (si hay) debe ser de la sede. */
  async validarMaquina(sedeId: string, maquinaId: number | null | undefined) {
    if (!maquinaId) return;
    const m = await this.orm.Maquina.where({ id: maquinaId }).select('sedeId').first();
    if (!m || m.sedeId !== sedeId) throw new BadRequestException('Esa máquina no es de esta sede.');
  }

  /* ---------------- Rutinas ---------------- */

  /** Rutina activa con sus días y ejercicios (nombres incluidos), o null. */
  async rutinaActiva(perfilId: string) {
    const r = await this.orm.Rutina.where({ perfilId, activa: true }).orderBy((x) => x.id.desc()).first();
    if (!r) return null;
    const [dias, cat, coach] = await Promise.all([
      this.orm.RutinaDia.where({ rutinaId: r.id }).orderBy((d) => d.diaSemana.asc()).all(),
      this.catalogo(r.sedeId),
      r.coachPerfilId ? this.orm.Perfil.where({ id: r.coachPerfilId }).select('nombre').first() : Promise.resolve(null),
    ]);
    const items = dias.length ? await this.orm.RutinaEjercicio.where((e) => e.rutinaDiaId.in(dias.map((d) => d.id))).orderBy((e) => e.orden.asc()).all() : [];
    const ej = new Map(cat.ejercicios.map((e) => [e.id, e]));
    return {
      id: r.id,
      nombre: r.nombre,
      notas: r.notas,
      coach: coach?.nombre ?? null,
      actualizada: r.updatedAt ?? r.createdAt,
      dias: dias.map((d) => ({
        diaSemana: d.diaSemana,
        categorias: d.categorias ? d.categorias.split(',') : [],
        notas: d.notas,
        ejercicios: items
          .filter((i) => i.rutinaDiaId === d.id)
          .map((i) => {
            const e = ej.get(i.ejercicioId);
            return {
              ejercicioId: i.ejercicioId,
              nombre: e?.nombre ?? '',
              categoria: e?.categoria ?? '',
              equipo: e?.equipo ?? '',
              maquina: e?.maquina ?? null,
              series: i.series,
              repeticiones: i.repeticiones,
              descansoSeg: i.descansoSeg,
              indicaciones: i.indicaciones,
              indicacionesEjercicio: e?.indicaciones ?? null,
            };
          }),
      })),
    };
  }

  /**
   * Guarda una rutina nueva para el socio. La anterior queda como historial (inactiva).
   * Todo en una transacción: o se guarda completa o nada.
   */
  async guardarRutina(actor: Actor, sedeId: string, perfilId: string, input: RutinaInput) {
    const ids = [...new Set(input.dias.flatMap((d) => d.ejercicios.map((e) => e.ejercicioId)))];
    const validos = await this.orm.Ejercicio.where((e) => e.id.in(ids)).select('id', 'sedeId').all();
    if (validos.length !== ids.length || validos.some((e) => e.sedeId !== sedeId)) {
      throw new BadRequestException('Todos los ejercicios deben ser del catálogo de esta sede.');
    }
    const rutinaId = await this.prisma.db.transaction(async (tx) => {
      const t = tx.orm.public;
      await t.Rutina.where({ perfilId, activa: true }).updateAll({ activa: false });
      const r = await t.Rutina.create({ perfilId, sedeId, coachPerfilId: actor.perfilId, nombre: input.nombre, notas: input.notas ?? null });
      const filas = [];
      for (const d of input.dias) {
        const dia = await t.RutinaDia.create({ rutinaId: r.id, diaSemana: d.diaSemana, categorias: [...new Set(d.categorias)].join(','), notas: d.notas ?? null });
        filas.push(
          ...d.ejercicios.map((e, orden) => ({
            rutinaDiaId: dia.id,
            ejercicioId: e.ejercicioId,
            orden,
            series: e.series,
            repeticiones: e.repeticiones,
            descansoSeg: e.descansoSeg ?? null,
            indicaciones: e.indicaciones ?? null,
          })),
        );
      }
      await t.RutinaEjercicio.createAll(filas);
      return r.id;
    });
    void this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, accion: 'rutina.guardar', entidad: 'Rutina', entidadId: rutinaId, datos: { perfilId, nombre: input.nombre, dias: input.dias.length } });
    return this.rutinaActiva(perfilId);
  }

  async quitarRutina(actor: Actor, sedeId: string, perfilId: string) {
    await this.orm.Rutina.where({ perfilId, activa: true }).updateAll({ activa: false });
    void this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, accion: 'rutina.quitar', entidad: 'Perfil', entidadId: perfilId });
  }
}
