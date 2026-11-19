import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Auth } from '../auth/auth.guard.js';
import { aFecha, hoy, sumarDias, TZ } from '../common/fechas.js';
import { sedesCon } from '../common/permisos.js';
import { PrismaService } from '../prisma/prisma.service.js';

const diaMx = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const MAX_DIAS = 400;

/** Dashboard y reportes semanales/mensuales (solo admin y encargados). */
@Injectable()
export class ReportesService {
  constructor(private readonly prisma: PrismaService) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  async resumen(auth: Auth, desde: string, hasta: string, sedeId?: string) {
    if (desde > hasta) throw new BadRequestException('La fecha inicial debe ser antes de la final.');
    const dias: string[] = [];
    for (let d = desde; d <= hasta && dias.length <= MAX_DIAS; d = sumarDias(d, 1)) dias.push(d);
    if (dias.length > MAX_DIAS) throw new BadRequestException('El rango máximo es de 400 días.');

    const permitidas = sedesCon(auth, ['admin', 'encargado']);
    const todas = await this.orm.Sede.select('id', 'nombre').orderBy((s) => s.nombre.asc()).all();
    let sedes = permitidas === null ? todas : todas.filter((s) => permitidas.includes(s.id));
    if (sedeId) {
      if (!sedes.some((s) => s.id === sedeId)) throw new ForbiddenException('No tienes permiso en esta sede.');
      sedes = sedes.filter((s) => s.id === sedeId);
    }
    const ids = sedes.map((s) => s.id);
    if (!ids.length) throw new ForbiddenException('No administras ninguna sede.');

    const inicio = new Date(`${desde}T00:00:00-06:00`);
    const fin = new Date(`${hasta}T23:59:59.999-06:00`);

    const hoyD = aFecha(hoy());
    // Todas las lecturas a la vez (antes, 7 seguidas); los detalles dependen de los pagos.
    const pagosP = this.orm.Pago.where((p) => p.sedeId.in(ids))
      .where((p) => p.createdAt.gte(inicio))
      .where((p) => p.createdAt.lte(fin))
      .select('id', 'sedeId', 'metodo', 'total', 'createdAt')
      .all();
    const detallesP = pagosP.then(async (pagos) => {
      const lotes = [];
      for (let i = 0; i < pagos.length; i += 500) lotes.push(pagos.slice(i, i + 500).map((p) => p.id));
      const partes = await Promise.all(lotes.map((lote) => this.orm.PagoDetalle.where((d) => d.pagoId.in(lote)).select('pagoId', 'tipo', 'descripcion', 'cantidad', 'precioUnitario').all()));
      return partes.flat();
    });
    const [pagos, detalles, asistencias, nuevas, vigentes, turnos, stockBajo] = await Promise.all([
      pagosP,
      detallesP,
      this.orm.Asistencia.where((a) => a.sedeId.in(ids))
        .where((a) => a.createdAt.gte(inicio))
        .where((a) => a.createdAt.lte(fin))
        .select('sedeId', 'resultado', 'createdAt')
        .all(),
      this.orm.Membresia.where((m) => m.sedeId.in(ids))
        .where((m) => m.createdAt.gte(inicio))
        .where((m) => m.createdAt.lte(fin))
        .select('sedeId')
        .all(),
      this.orm.Membresia.where((m) => m.sedeId.in(ids))
        .where((m) => m.inicio.lte(hoyD))
        .where((m) => m.fin.gte(hoyD))
        .where((m) => m.canceladaEn.isNull())
        .select('sedeId', 'perfilId')
        .all(),
      this.orm.Turno.where((t) => t.sedeId.in(ids))
        .where((t) => t.cerradoEn.gte(inicio))
        .where((t) => t.cerradoEn.lte(fin))
        .select('sedeId', 'diferencia')
        .all(),
      this.orm.Producto.where((p) => p.sedeId.in(ids))
        .where({ activo: true })
        .select('id', 'sedeId', 'nombre', 'icono', 'stock', 'stockMinimo')
        .all(),
    ]);

    // Importe por tipo de cada pago (membresía / producto / promoción).
    const tipoPorPago = new Map<number, Record<string, number>>();
    for (const d of detalles) {
      const m = tipoPorPago.get(d.pagoId) ?? {};
      m[d.tipo] = (m[d.tipo] ?? 0) + d.cantidad * d.precioUnitario;
      tipoPorPago.set(d.pagoId, m);
    }

    const vacio = () => ({ ingresos: 0, efectivo: 0, terminal: 0, stripe: 0, membresias: 0, productos: 0, promociones: 0, pagos: 0, entradas: 0, rechazos: 0 });
    const porSede = new Map(ids.map((id) => [id, vacio()]));
    const porDia = new Map(dias.map((d) => [d, vacio()]));
    const totales = vacio();

    for (const p of pagos) {
      const tipos = tipoPorPago.get(p.id) ?? {};
      for (const acc of [totales, porSede.get(p.sedeId), porDia.get(diaMx(p.createdAt))]) {
        if (!acc) continue;
        acc.ingresos += p.total;
        acc.pagos += 1;
        acc[p.metodo as 'efectivo' | 'terminal' | 'stripe'] += p.total;
        acc.membresias += tipos.membresia ?? 0;
        acc.productos += tipos.producto ?? 0;
        acc.promociones += tipos.promocion ?? 0;
      }
    }
    for (const a of asistencias) {
      const campo = a.resultado === 'permitida' ? 'entradas' : 'rechazos';
      for (const acc of [totales, porSede.get(a.sedeId), porDia.get(diaMx(a.createdAt))]) if (acc) acc[campo] += 1;
    }

    const sociosActivos = (sid?: string) => new Set(vigentes.filter((v) => !sid || v.sedeId === sid).map((v) => `${v.sedeId}:${v.perfilId}`)).size;

    const top = new Map<string, { descripcion: string; tipo: string; cantidad: number; importe: number }>();
    for (const d of detalles.filter((x) => x.tipo !== 'membresia')) {
      const k = `${d.tipo}:${d.descripcion}`;
      const t = top.get(k) ?? { descripcion: d.descripcion, tipo: d.tipo, cantidad: 0, importe: 0 };
      t.cantidad += d.cantidad;
      t.importe += d.cantidad * d.precioUnitario;
      top.set(k, t);
    }

    return {
      rango: { desde, hasta, dias: dias.length },
      sedes,
      totales: {
        ...totales,
        ticketPromedio: totales.pagos ? Math.round(totales.ingresos / totales.pagos) : 0,
        sociosActivos: sociosActivos(),
        nuevasMembresias: nuevas.length,
        cortes: turnos.length,
        diferenciaCortes: turnos.reduce((s, t) => s + (t.diferencia ?? 0), 0),
      },
      porSede: sedes.map((s) => ({
        sedeId: s.id,
        nombre: s.nombre,
        ...porSede.get(s.id)!,
        sociosActivos: sociosActivos(s.id),
        nuevasMembresias: nuevas.filter((n) => n.sedeId === s.id).length,
      })),
      porDia: dias.map((d) => ({ dia: d, ...porDia.get(d)! })),
      topProductos: [...top.values()].sort((a, b) => b.importe - a.importe).slice(0, 8),
      stockBajo: stockBajo.filter((p) => p.stock <= p.stockMinimo).map((p) => ({ ...p, sede: sedes.find((s) => s.id === p.sedeId)?.nombre ?? p.sedeId })),
    };
  }
}
