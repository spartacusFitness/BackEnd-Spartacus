import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BitacoraService } from '../common/bitacora.service.js';
import { aFecha, finDelDia, hoy, sumarDias, ymd } from '../common/fechas.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GymService, type Actor } from './gym.service.js';
import { calcularLogros, nombrePublico } from './logros.js';

const inicioDelDia = (dia: string) => new Date(`${dia}T00:00:00-06:00`);

/** Fase 5: logros, ranking opcional por sede, retos de asistencia y mensajes socio ↔ coaches. */
@Injectable()
export class ComunidadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gym: GymService,
    private readonly bitacora: BitacoraService,
  ) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  /** Días (hora de México) con entrada permitida, por socio, opcionalmente dentro de un rango. */
  private async dias(perfilIds: string[], desde?: string, hasta?: string) {
    const out = new Map<string, Set<string>>(perfilIds.map((id) => [id, new Set<string>()]));
    if (!perfilIds.length) return out;
    let q = this.orm.Asistencia.where({ resultado: 'permitida' }).where((a) => a.perfilId.in(perfilIds));
    if (desde) q = q.where((a) => a.createdAt.gte(inicioDelDia(desde)));
    if (hasta) q = q.where((a) => a.createdAt.lte(finDelDia(hasta)));
    for (const f of await q.select('perfilId', 'createdAt').all()) out.get(f.perfilId)!.add(hoy(f.createdAt));
    return out;
  }

  /* ---------------- Socio: todo lo de Comunidad en una llamada ---------------- */

  async comunidad(perfilId: string, sedeId: string) {
    const [perfil, cal, mediciones, diasTodos, retos, ranking] = await Promise.all([
      this.orm.Perfil.where({ id: perfilId }).select('objetivo', 'enRanking', 'apodo', 'nombre').first(),
      this.gym.calendario(sedeId),
      this.orm.Medicion.where({ perfilId }).orderBy([(m) => m.fecha.asc(), (m) => m.id.asc()]).select('pesoGr').all(),
      this.dias([perfilId]),
      this.retosDelSocio(perfilId, sedeId),
      this.ranking(sedeId, perfilId),
    ]);
    if (!perfil) throw new NotFoundException('Perfil no encontrado.');
    const logros = calcularLogros({
      dias: diasTodos.get(perfilId)!,
      cal,
      objetivo: perfil.objetivo,
      pesoInicial: mediciones.length ? mediciones[0].pesoGr / 1000 : null,
      pesoActual: mediciones.length ? mediciones.at(-1)!.pesoGr / 1000 : null,
      retosCumplidos: retos.filter((r) => r.cumplido).length,
    });
    return { logros, ranking: { ...ranking, participo: perfil.enRanking, nombrePublico: nombrePublico(perfil.apodo, perfil.nombre) }, retos };
  }

  /** Aparecer o no en el ranking (opcional, apagado por defecto). */
  async participarRanking(perfilId: string, si: boolean) {
    await this.orm.Perfil.where({ id: perfilId }).update({ enRanking: si });
  }

  /** Ranking del mes: días que vino cada socio que aceptó aparecer. Top 10 + su lugar. */
  async ranking(sedeId: string, perfilId: string) {
    const mes = hoy().slice(0, 8) + '01';
    const socios = await this.orm.RolAsignado.where({ sedeId, rol: 'socio' }).select('perfilId').all();
    const perfiles = socios.length
      ? await this.orm.Perfil.where((p) => p.id.in(socios.map((s) => s.perfilId))).where({ enRanking: true }).select('id', 'apodo', 'nombre').all()
      : [];
    const dias = await this.dias(perfiles.map((p) => p.id), mes, hoy());
    const tabla = perfiles
      .map((p) => ({ id: p.id, nombre: nombrePublico(p.apodo, p.nombre), dias: dias.get(p.id)!.size }))
      .filter((x) => x.dias > 0)
      .sort((a, b) => b.dias - a.dias || a.nombre.localeCompare(b.nombre));
    // Mismo número de días = mismo lugar.
    let lugar = 0;
    const conLugar = tabla.map((x, i) => ({ ...x, lugar: i > 0 && x.dias === tabla[i - 1].dias ? lugar : (lugar = i + 1) }));
    const yo = conLugar.find((x) => x.id === perfilId) ?? null;
    return {
      mes,
      participantes: conLugar.length,
      top: conLugar.slice(0, 10).map(({ id, ...x }) => ({ ...x, soyYo: id === perfilId })),
      miLugar: yo ? { lugar: yo.lugar, dias: yo.dias } : null,
    };
  }

  /* ---------------- Retos ---------------- */

  private async progreso(retos: { id: number; desde: Date; hasta: Date }[], perfilIds: string[]) {
    const out = new Map<string, number>(); // `${retoId}:${perfilId}` → días
    for (const r of retos) {
      const dias = await this.dias(perfilIds, ymd(r.desde), ymd(r.hasta));
      for (const [p, s] of dias) out.set(`${r.id}:${p}`, s.size);
    }
    return out;
  }

  /** Retos vigentes (o recién terminados, 7 días) de su sede, con su avance si está inscrito. */
  async retosDelSocio(perfilId: string, sedeId: string) {
    const retos = (await this.orm.Reto.where({ sedeId, activo: true }).orderBy((r) => r.hasta.asc()).all()).filter((r) => ymd(r.hasta) >= sumarDias(hoy(), -7));
    if (!retos.length) return [];
    const inscritos = await this.orm.RetoInscripcion.where({ perfilId }).where((i) => i.retoId.in(retos.map((r) => r.id))).select('retoId').all();
    const mios = new Set(inscritos.map((i) => i.retoId));
    const prog = await this.progreso(retos.filter((r) => mios.has(r.id)), [perfilId]);
    return retos.map((r) => {
      const dias = prog.get(`${r.id}:${perfilId}`) ?? 0;
      return {
        id: r.id,
        nombre: r.nombre,
        descripcion: r.descripcion,
        meta: r.meta,
        desde: ymd(r.desde),
        hasta: ymd(r.hasta),
        premio: r.premio,
        terminado: ymd(r.hasta) < hoy(),
        inscrito: mios.has(r.id),
        dias,
        cumplido: mios.has(r.id) && dias >= r.meta,
      };
    });
  }

  private async retoDeSede(retoId: number, sedeId: string) {
    const r = await this.orm.Reto.first({ id: retoId });
    if (!r || r.sedeId !== sedeId || !r.activo) throw new NotFoundException('Reto no encontrado.');
    return r;
  }

  async inscribir(perfilId: string, sedeId: string, retoId: number) {
    const r = await this.retoDeSede(retoId, sedeId);
    if (ymd(r.hasta) < hoy()) throw new BadRequestException('Ese reto ya terminó.');
    if (await this.orm.RetoInscripcion.where({ retoId, perfilId }).select('id').first()) throw new ConflictException('Ya estás inscrito en este reto.');
    await this.orm.RetoInscripcion.create({ retoId, perfilId });
  }

  async salir(perfilId: string, sedeId: string, retoId: number) {
    await this.retoDeSede(retoId, sedeId);
    await this.orm.RetoInscripcion.where({ retoId, perfilId }).deleteAll();
  }

  /** Administración: retos con inscritos y quién ya lo cumplió (para entregar el premio). */
  async retosAdmin(sedeId: string) {
    const retos = await this.orm.Reto.where({ sedeId }).orderBy((r) => r.desde.desc()).all();
    if (!retos.length) return [];
    const ins = await this.orm.RetoInscripcion.where((i) => i.retoId.in(retos.map((r) => r.id))).select('retoId', 'perfilId').all();
    const ids = [...new Set(ins.map((i) => i.perfilId))];
    const [perfiles, prog] = await Promise.all([
      ids.length ? this.orm.Perfil.where((p) => p.id.in(ids)).select('id', 'nombre', 'email').all() : Promise.resolve([]),
      this.progreso(retos, ids),
    ]);
    const nombre = new Map(perfiles.map((p) => [p.id, p.nombre ?? p.email]));
    return retos.map((r) => {
      const inscritos = ins.filter((i) => i.retoId === r.id).map((i) => ({ nombre: nombre.get(i.perfilId) ?? '—', dias: prog.get(`${r.id}:${i.perfilId}`) ?? 0 }));
      return {
        id: r.id,
        nombre: r.nombre,
        descripcion: r.descripcion,
        meta: r.meta,
        desde: ymd(r.desde),
        hasta: ymd(r.hasta),
        premio: r.premio,
        activo: r.activo,
        inscritos: inscritos.length,
        cumplieron: inscritos.filter((x) => x.dias >= r.meta).sort((a, b) => b.dias - a.dias),
      };
    });
  }

  async crearReto(actor: Actor, sedeId: string, x: { nombre: string; descripcion?: string | null; meta: number; desde: string; hasta: string; premio?: string | null }) {
    if (x.hasta < x.desde) throw new BadRequestException('La fecha final debe ser después de la inicial.');
    const r = await this.orm.Reto.create({ sedeId, nombre: x.nombre, descripcion: x.descripcion ?? null, meta: x.meta, desde: aFecha(x.desde), hasta: aFecha(x.hasta), premio: x.premio ?? null });
    void this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, accion: 'reto.crear', entidad: 'Reto', entidadId: r.id, datos: x });
    return r;
  }

  async editarReto(actor: Actor, sedeId: string, retoId: number, x: { nombre?: string; descripcion?: string | null; meta?: number; desde?: string; hasta?: string; premio?: string | null; activo?: boolean }) {
    const r = await this.orm.Reto.first({ id: retoId });
    if (!r || r.sedeId !== sedeId) throw new NotFoundException('Reto no encontrado.');
    const desde = x.desde ?? ymd(r.desde);
    const hasta = x.hasta ?? ymd(r.hasta);
    if (hasta < desde) throw new BadRequestException('La fecha final debe ser después de la inicial.');
    const { desde: _d, hasta: _h, ...resto } = x;
    await this.orm.Reto.where({ id: retoId }).update({ ...resto, ...(x.desde ? { desde: aFecha(x.desde) } : {}), ...(x.hasta ? { hasta: aFecha(x.hasta) } : {}) });
    void this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, accion: 'reto.editar', entidad: 'Reto', entidadId: retoId, datos: x });
  }

  /* ---------------- Mensajes socio ↔ coaches de la sede ---------------- */

  /** Conversación del socio (las últimas 100); marca como leído lo que le escribieron los coaches. */
  async conversacion(socioId: string, sedeId: string, lector: 'socio' | 'coach') {
    const msgs = await this.orm.Mensaje.where({ socioId, sedeId }).orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()]).limit(100).all();
    // Lo que escribió la otra parte queda leído.
    const otraParte = lector === 'socio';
    if (msgs.some((m) => m.deCoach === otraParte && !m.leido)) await this.orm.Mensaje.where({ socioId, sedeId, deCoach: otraParte, leido: false }).update({ leido: true });
    const coaches = [...new Set(msgs.filter((m) => m.deCoach).map((m) => m.autorId))];
    const nombres = coaches.length ? new Map((await this.orm.Perfil.where((p) => p.id.in(coaches)).select('id', 'nombre').all()).map((p) => [p.id, p.nombre])) : new Map();
    return msgs.reverse().map((m) => ({ id: m.id, texto: m.texto, deCoach: m.deCoach, autor: m.deCoach ? (nombres.get(m.autorId) ?? 'Coach') : null, fecha: m.createdAt, leido: m.leido }));
  }

  async enviar(socioId: string, sedeId: string, autorId: string, deCoach: boolean, texto: string) {
    const m = await this.orm.Mensaje.create({ socioId, sedeId, autorId, deCoach, texto });
    return { id: m.id, texto: m.texto, deCoach, fecha: m.createdAt };
  }

  /** Mensajes de coaches que el socio no ha leído. */
  async sinLeerSocio(socioId: string, sedeId: string) {
    return (await this.orm.Mensaje.where({ socioId, sedeId, deCoach: true, leido: false }).select('id').all()).length;
  }

  /** Bandeja del coach: una fila por socio con su último mensaje y cuántos no ha leído. */
  async bandeja(sedeId: string) {
    const msgs = await this.orm.Mensaje.where({ sedeId }).orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()]).limit(500).select('socioId', 'texto', 'deCoach', 'leido', 'createdAt').all();
    const porSocio = new Map<string, { ultimo: string; fecha: Date; deCoach: boolean; sinLeer: number }>();
    for (const m of msgs) {
      const x = porSocio.get(m.socioId) ?? { ultimo: m.texto, fecha: m.createdAt, deCoach: m.deCoach, sinLeer: 0 };
      if (!m.deCoach && !m.leido) x.sinLeer++;
      porSocio.set(m.socioId, x);
    }
    const ids = [...porSocio.keys()];
    const perfiles = ids.length ? await this.orm.Perfil.where((p) => p.id.in(ids)).select('id', 'nombre', 'email', 'fotoUrl').all() : [];
    return perfiles
      .map((p) => ({ socioId: p.id, nombre: p.nombre ?? p.email, fotoUrl: p.fotoUrl, ...porSocio.get(p.id)! }))
      .sort((a, b) => b.sinLeer - a.sinLeer || +b.fecha - +a.fecha);
  }
}
