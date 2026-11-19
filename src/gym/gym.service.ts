import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { BitacoraService } from '../common/bitacora.service.js';
import { aFecha, Calendario, finDelDia, hoy, sumarDias, ymd } from '../common/fechas.js';
import { hashSecret, verifySecret } from '../common/hash.js';
import { crearUsuario, cambiarContrasena, enviarCorreoContrasena, SupabaseAdminError } from '../common/supabase-admin.js';
import { config } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PIN_MAX_INTENTOS = 5;
const PIN_BLOQUEO_MS = 15 * 60 * 1000;
/** Días hábiles para presentarse cuando eligió pagar en el gym. */
const DIAS_SOLICITUD_MOSTRADOR = 3;
/** Si pagó en línea, la solicitud vive lo mismo que su mes. */
const DIAS_SOLICITUD_TARJETA = 30;

export interface Actor {
  perfilId: string;
}

/** Reglas de negocio de la operación diaria (fase 1). */
@Injectable()
export class GymService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
  ) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  /* ---------------- Sedes y calendario ---------------- */

  async sede(sedeId: string) {
    const s = await this.orm.Sede.first({ id: sedeId });
    if (!s) throw new NotFoundException('No existe esa sede.');
    return s;
  }

  async calendario(sedeId: string) {
    const s = await this.sede(sedeId);
    const desde = aFecha(sumarDias(hoy(), -400));
    const cerrados = await this.orm.DiaCerrado.where({ sedeId })
      .where((d) => d.fecha.gte(desde))
      .select('fecha')
      .all();
    return new Calendario(s.diasSinServicio, cerrados.map((d) => ymd(d.fecha)));
  }

  /* ---------------- Membresías ---------------- */

  /** Membresía vigente hoy en esa sede (la que termina más tarde), o null. */
  async membresiaVigente(perfilId: string, sedeId: string, dia = hoy()) {
    const d = aFecha(dia);
    return this.orm.Membresia.where({ perfilId, sedeId })
      .where((m) => m.inicio.lte(d))
      .where((m) => m.fin.gte(d))
      .where((m) => m.canceladaEn.isNull())
      .orderBy((m) => m.fin.desc())
      .first();
  }

  /**
   * Periodo de una membresía nueva. Si ya tiene una vigente, la nueva empieza al día siguiente de
   * que termine (renovación anticipada). Si el último día cae en día sin servicio, se recorre al
   * siguiente día abierto (días de gracia).
   */
  async periodo(perfilId: string, sedeId: string, duracionDias: number) {
    const cal = await this.calendario(sedeId);
    const vigente = await this.membresiaVigente(perfilId, sedeId);
    const inicio = vigente ? sumarDias(ymd(vigente.fin), 1) : hoy();
    const fin = cal.siguienteAbierto(sumarDias(inicio, Math.max(1, duracionDias) - 1));
    return { inicio, fin };
  }

  /* ---------------- Solicitudes (registro en línea) ---------------- */

  /** Marca como vencidas las solicitudes de pago en mostrador que ya pasaron su plazo. */
  async vencerSolicitudes(sedeId?: string) {
    const q = this.orm.Solicitud.where({ estado: 'pendiente_pago' }).where((s) => s.venceEn.lt(new Date()));
    await (sedeId ? q.where({ sedeId }) : q).updateAll({ estado: 'vencida' });
  }

  async crearSolicitud(perfilId: string, planId: number, metodo: 'mostrador' | 'tarjeta') {
    const perfil = await this.orm.Perfil.first({ id: perfilId });
    if (!perfil?.sedeId) throw new BadRequestException('Primero detecta tu sede.');
    const plan = await this.orm.Plan.first({ id: planId });
    if (!plan || plan.sedeId !== perfil.sedeId || !plan.activo) throw new NotFoundException('Ese plan no está disponible en tu sede.');
    if (metodo === 'tarjeta') {
      if (!plan.pagoEnLinea) throw new BadRequestException('Este plan se paga en recepción.');
      throw new BadRequestException('El pago con tarjeta en línea llega muy pronto. Por ahora elige pagar en el gym.');
    }
    await this.vencerSolicitudes(perfil.sedeId);
    const abierta = await this.orm.Solicitud.where({ perfilId, estado: 'pendiente_pago' }).first();
    if (abierta) throw new ConflictException('Ya tienes una solicitud pendiente. Preséntate en recepción para completarla.');

    const cal = await this.calendario(perfil.sedeId);
    const venceEn =
      metodo === 'mostrador'
        ? finDelDia(cal.diasHabilesDespues(hoy(), DIAS_SOLICITUD_MOSTRADOR))
        : finDelDia(sumarDias(hoy(), DIAS_SOLICITUD_TARJETA));
    const sol = await this.orm.Solicitud.create({
      perfilId,
      sedeId: perfil.sedeId,
      planId,
      metodo,
      estado: 'pendiente_pago',
      venceEn,
    });
    await this.bitacora.registrar({ sedeId: perfil.sedeId, actorPerfilId: perfilId, accion: 'solicitud.crear', entidad: 'Solicitud', entidadId: sol.id, datos: { planId, metodo } });
    return sol;
  }

  /* ---------------- Recepcionistas y PIN ---------------- */

  async crearRecepcionista(actor: Actor, sedeId: string, nombre: string, pin: string) {
    await this.sede(sedeId);
    const r = await this.orm.Recepcionista.create({ sedeId, nombre, pinHash: await hashSecret(pin) });
    await this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, accion: 'recepcionista.crear', entidad: 'Recepcionista', entidadId: r.id, datos: { nombre } });
    return { id: r.id, nombre: r.nombre, activo: r.activo };
  }

  /** Comprueba el PIN con bloqueo tras varios intentos fallidos. */
  async verificarPin(sedeId: string, recepcionistaId: number, pin: string) {
    const r = await this.orm.Recepcionista.first({ id: recepcionistaId });
    if (!r || r.sedeId !== sedeId || !r.activo) throw new ForbiddenException('Recepcionista no válido.');
    if (r.bloqueadoHasta && r.bloqueadoHasta.getTime() > Date.now()) {
      const min = Math.ceil((r.bloqueadoHasta.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`PIN bloqueado por intentos fallidos. Intenta en ${min} min o pide al encargado que lo restablezca.`);
    }
    if (!(await verifySecret(pin, r.pinHash))) {
      const intentos = r.intentosFallidos + 1;
      const bloquear = intentos >= PIN_MAX_INTENTOS;
      await this.orm.Recepcionista.where({ id: r.id }).update({
        intentosFallidos: bloquear ? 0 : intentos,
        bloqueadoHasta: bloquear ? new Date(Date.now() + PIN_BLOQUEO_MS) : null,
      });
      throw new ForbiddenException(bloquear ? 'PIN incorrecto. Se bloqueó 15 minutos.' : `PIN incorrecto. Te quedan ${PIN_MAX_INTENTOS - intentos} intentos.`);
    }
    if (r.intentosFallidos || r.bloqueadoHasta) {
      await this.orm.Recepcionista.where({ id: r.id }).update({ intentosFallidos: 0, bloqueadoHasta: null });
    }
    return r;
  }

  /** Cuenta compartida de recepción de la sede: usuario "<sede>@recepcion". Crea o restablece la contraseña. */
  async cuentaRecepcion(actor: Actor, sedeId: string) {
    const sede = await this.sede(sedeId);
    const usuario = `${sedeId}@recepcion`;
    const email = `${sedeId}@recepcion.spartacus.app`;
    const contrasena = randomBytes(12).toString('base64url');

    const perfil = await this.orm.Perfil.where({ email }).first();
    if (perfil) {
      await cambiarContrasena(perfil.userId, contrasena);
    } else {
      const user = await crearUsuario(email, contrasena, `Recepción ${sede.nombre}`);
      const p = await this.orm.Perfil.create({ userId: user.id, email, nombre: `Recepción ${sede.nombre}`, sedeId, verificado: true });
      await this.orm.RolAsignado.create({ perfilId: p.id, rol: 'recepcion', sedeId });
    }
    await this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, accion: perfil ? 'recepcion.restablecer' : 'recepcion.crear', entidad: 'CuentaRecepcion', entidadId: sedeId });
    return { usuario, contrasena, nueva: !perfil };
  }

  /* ---------------- Turnos ---------------- */

  turnoAbierto(sedeId: string) {
    return this.orm.Turno.where({ sedeId }).where((t) => t.cerradoEn.isNull()).first();
  }

  async abrirTurno(actor: Actor, sedeId: string, recepcionistaId: number, pin: string, efectivoInicial: number) {
    const r = await this.verificarPin(sedeId, recepcionistaId, pin);
    const abierto = await this.turnoAbierto(sedeId);
    if (abierto) throw new ConflictException('Ya hay un turno abierto en esta sede. Ciérralo primero.');
    const t = await this.orm.Turno.create({ sedeId, recepcionistaId: r.id, efectivoInicial });
    await this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, recepcionistaId: r.id, accion: 'turno.abrir', entidad: 'Turno', entidadId: t.id, datos: { efectivoInicial } });
    return t;
  }

  async resumenTurno(turnoId: number) {
    const pagos = await this.orm.Pago.where({ turnoId }).select('id', 'metodo', 'total', 'perfilId', 'createdAt').orderBy((p) => p.id.asc()).all();
    const total = (m: string) => pagos.filter((p) => p.metodo === m).reduce((s, p) => s + p.total, 0);
    return { pagos, efectivo: total('efectivo'), terminal: total('terminal'), cobros: pagos.length };
  }

  async cerrarTurno(actor: Actor, sedeId: string, pin: string, efectivoContado: number, notas?: string) {
    const t = await this.turnoAbierto(sedeId);
    if (!t) throw new BadRequestException('No hay turno abierto.');
    await this.verificarPin(sedeId, t.recepcionistaId, pin);
    const { efectivo } = await this.resumenTurno(t.id);
    const esperado = t.efectivoInicial + efectivo;
    const cerrado = await this.orm.Turno.where({ id: t.id }).update({
      cerradoEn: new Date(),
      efectivoEsperado: esperado,
      efectivoContado,
      diferencia: efectivoContado - esperado,
      notas: notas ?? null,
    });
    await this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, recepcionistaId: t.recepcionistaId, accion: 'turno.cerrar', entidad: 'Turno', entidadId: t.id, datos: { esperado, efectivoContado, diferencia: efectivoContado - esperado } });
    return cerrado;
  }

  private async exigirTurno(sedeId: string) {
    const t = await this.turnoAbierto(sedeId);
    if (!t) throw new BadRequestException('Abre tu turno con tu PIN antes de registrar cobros.');
    return t;
  }

  /* ---------------- Socios en mostrador ---------------- */

  /** Alta en recepción: crea la cuenta (confirmada, porque se verificó en persona) y la deja como socia de la sede. */
  async altaSocio(actor: Actor, sedeId: string, nombre: string, email: string, fechaNacimiento?: string) {
    await this.exigirTurno(sedeId);
    let perfil = await this.orm.Perfil.where({ email }).first();
    if (!perfil) {
      let userId: string;
      try {
        userId = (await crearUsuario(email, undefined, nombre)).id;
      } catch (err) {
        if (err instanceof SupabaseAdminError && (err.code === 'email_exists' || err.status === 422)) {
          throw new ConflictException('Ese correo ya tiene cuenta. Pide a la persona que inicie sesión una vez y búscala.');
        }
        throw err;
      }
      perfil = await this.orm.Perfil.create({
        userId,
        email,
        nombre,
        sedeId,
        verificado: true,
        fechaNacimiento: fechaNacimiento ? aFecha(fechaNacimiento) : null,
      });
    } else {
      // Ya tenía cuenta (p. ej. viene de otra sede): se inscribe aquí y conserva su historial.
      perfil = (await this.orm.Perfil.where({ id: perfil.id }).update({ sedeId, verificado: true }))!;
    }
    await this.orm.RolAsignado.where({ perfilId: perfil.id, rol: 'socio' }).deleteAll();
    await this.orm.RolAsignado.create({ perfilId: perfil.id, rol: 'socio', sedeId });
    const correoEnviado = await enviarCorreoContrasena(email, `${config.frontendUrls[0]}/restablecer`);
    await this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, accion: 'socio.alta', entidad: 'Perfil', entidadId: perfil.id, datos: { email } });
    return { perfil, correoEnviado };
  }

  /* ---------------- Cobro de membresía ---------------- */

  async cobrarMembresia(
    actor: Actor,
    sedeId: string,
    input: { perfilId: string; planId: number; metodo: 'efectivo' | 'terminal'; solicitudId?: number; credencialValidada?: boolean },
  ) {
    const turno = await this.exigirTurno(sedeId);
    const perfil = await this.orm.Perfil.first({ id: input.perfilId });
    if (!perfil || perfil.sedeId !== sedeId) throw new NotFoundException('Esa persona no es socia de esta sede.');
    const plan = await this.orm.Plan.first({ id: input.planId });
    if (!plan || plan.sedeId !== sedeId || !plan.activo) throw new NotFoundException('Ese plan no está disponible en esta sede.');
    if (plan.requiereValidacion && !input.credencialValidada) {
      throw new BadRequestException(`El plan "${plan.nombre}" requiere revisar la credencial o documento. Márcalo como revisado.`);
    }

    let solicitud = null;
    if (input.solicitudId) {
      await this.vencerSolicitudes(sedeId);
      solicitud = await this.orm.Solicitud.first({ id: input.solicitudId });
      if (!solicitud || solicitud.perfilId !== perfil.id || solicitud.sedeId !== sedeId) throw new NotFoundException('Solicitud no encontrada.');
      if (solicitud.estado !== 'pendiente_pago') throw new BadRequestException(`La solicitud está ${solicitud.estado.replace('_', ' ')}.`);
    }

    const { inicio, fin } = await this.periodo(perfil.id, sedeId, plan.duracionDias);
    const resultado = await this.prisma.db.transaction(async (tx) => {
      const pago = await tx.orm.public.Pago.create({
        sedeId,
        turnoId: turno.id,
        perfilId: perfil.id,
        metodo: input.metodo,
        total: plan.precio,
        registradoPor: actor.perfilId,
      });
      await tx.orm.public.PagoDetalle.create({
        pagoId: pago.id,
        tipo: 'membresia',
        refId: String(plan.id),
        descripcion: plan.nombre,
        cantidad: 1,
        precioUnitario: plan.precio,
      });
      const membresia = await tx.orm.public.Membresia.create({
        perfilId: perfil.id,
        sedeId,
        planId: plan.id,
        inicio: aFecha(inicio),
        fin: aFecha(fin),
        pagoId: pago.id,
      });
      if (solicitud) await tx.orm.public.Solicitud.where({ id: solicitud.id }).update({ estado: 'completada', pagoId: pago.id });
      if (!perfil.verificado) await tx.orm.public.Perfil.where({ id: perfil.id }).update({ verificado: true });
      return { pago, membresia };
    });

    await this.bitacora.registrar({
      sedeId,
      actorPerfilId: actor.perfilId,
      recepcionistaId: turno.recepcionistaId,
      accion: 'cobro.membresia',
      entidad: 'Pago',
      entidadId: resultado.pago.id,
      datos: { perfilId: perfil.id, plan: plan.nombre, total: plan.precio, metodo: input.metodo, inicio, fin, solicitudId: solicitud?.id },
    });
    return { pagoId: resultado.pago.id, total: plan.precio, inicio, fin };
  }

  /* ---------------- Asistencia ---------------- */

  /** Registra una entrada. Rechaza sin membresía vigente o si volvió a entrar dentro del anti-passback. */
  async registrarAsistencia(actor: Actor | null, sedeId: string, perfilId: string, origen: 'recepcion' | 'facial') {
    const sede = await this.sede(sedeId);
    const perfil = await this.orm.Perfil.first({ id: perfilId });
    if (!perfil) throw new NotFoundException('Socio no encontrado.');
    const turno = await this.turnoAbierto(sedeId);

    let resultado: 'permitida' | 'rechazada_passback' | 'rechazada_sin_membresia' = 'permitida';
    const vigente = await this.membresiaVigente(perfilId, sedeId);
    if (!vigente) {
      resultado = 'rechazada_sin_membresia';
    } else {
      const desde = new Date(Date.now() - sede.antipassbackMin * 60 * 1000);
      const reciente = await this.orm.Asistencia.where({ perfilId, sedeId, resultado: 'permitida' })
        .where((a) => a.createdAt.gte(desde))
        .first();
      if (reciente) resultado = 'rechazada_passback';
    }

    const a = await this.orm.Asistencia.create({ perfilId, sedeId, origen, resultado, turnoId: turno?.id ?? null });
    if (resultado !== 'permitida') {
      await this.bitacora.registrar({ sedeId, actorPerfilId: actor?.perfilId ?? null, recepcionistaId: turno?.recepcionistaId ?? null, accion: `asistencia.${resultado}`, entidad: 'Asistencia', entidadId: a.id, datos: { perfilId } });
    }
    return {
      id: a.id,
      resultado,
      fin: vigente ? ymd(vigente.fin) : null,
      antipassbackMin: sede.antipassbackMin,
    };
  }
}
