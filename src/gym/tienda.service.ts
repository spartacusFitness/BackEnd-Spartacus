import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BitacoraService } from '../common/bitacora.service.js';
import { aFecha, diaSemana, hoy, ymd } from '../common/fechas.js';
import { config } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Actor } from './gym.service.js';

export const ICONOS = [
  'proteina', 'bebida', 'agua', 'cafe', 'barra', 'snack', 'vitaminas', 'creatina',
  'preentreno', 'toalla', 'guantes', 'shaker', 'playera', 'gorra', 'cinturon', 'otro',
] as const;

type Promo = { activa: boolean; diasSemana: string; desde: Date | null; hasta: Date | null };

/** ¿La promoción aplica hoy? (activa, día de la semana y rango de fechas). */
export function promoVigente(p: Promo, dia = hoy()) {
  if (!p.activa) return false;
  const dias = p.diasSemana.split(',').filter(Boolean).map(Number);
  if (dias.length && !dias.includes(diaSemana(dia))) return false;
  if (p.desde && ymd(p.desde) > dia) return false;
  if (p.hasta && ymd(p.hasta) < dia) return false;
  return true;
}

export const urlPromo = (path: string | null) => (path ? `${config.supabase.url}/storage/v1/object/public/promos/${path}` : null);

export interface ItemVenta {
  tipo: 'producto' | 'promocion';
  id: number;
  cantidad: number;
}

/** Productos, inventario, promociones y ventas en mostrador. */
@Injectable()
export class TiendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
  ) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  /* ---------------- Inventario ---------------- */

  /** Entrada de mercancía (suma) o ajuste por conteo físico (deja el stock en lo contado). */
  async movimiento(
    actor: Actor,
    sedeId: string,
    productoId: number,
    mov: { tipo: 'entrada'; cantidad: number; motivo?: string } | { tipo: 'ajuste'; stockContado: number; motivo: string },
    recepcionistaId?: number | null,
  ) {
    return this.prisma.db.transaction(async (tx) => {
      const p = await tx.orm.public.Producto.where({ id: productoId }).forUpdate().first();
      if (!p || p.sedeId !== sedeId) throw new NotFoundException('Producto no encontrado en esta sede.');
      const cantidad = mov.tipo === 'entrada' ? mov.cantidad : mov.stockContado - p.stock;
      if (mov.tipo === 'ajuste' && cantidad === 0) throw new BadRequestException('El stock contado es igual al registrado; no hay nada que ajustar.');
      const stock = p.stock + cantidad;
      await tx.orm.public.Producto.where({ id: p.id }).update({ stock });
      const m = await tx.orm.public.MovimientoInventario.create({
        productoId: p.id,
        sedeId,
        tipo: mov.tipo,
        cantidad,
        stockResultante: stock,
        motivo: mov.motivo ?? null,
        actorPerfilId: actor.perfilId,
        recepcionistaId: recepcionistaId ?? null,
      });
      await this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, recepcionistaId, accion: `inventario.${mov.tipo}`, entidad: 'Producto', entidadId: p.id, datos: { producto: p.nombre, cantidad, stock, motivo: mov.motivo } });
      return { movimientoId: m.id, stock };
    });
  }

  /* ---------------- Promociones ---------------- */

  /** Se llama ANTES de guardar la promoción, para no dejar promociones a medias. */
  async validarProductosPromo(sedeId: string, productos: { productoId: number; cantidad: number }[]) {
    const ids = [...new Set(productos.map((p) => p.productoId))];
    if (ids.length !== productos.length) throw new BadRequestException('Un producto aparece dos veces en la promoción.');
    const existentes = ids.length ? await this.orm.Producto.where((p) => p.id.in(ids)).select('id', 'sedeId').all() : [];
    if (existentes.length !== ids.length || existentes.some((p) => p.sedeId !== sedeId)) {
      throw new BadRequestException('Todos los productos de la promoción deben ser de esta sede.');
    }
  }

  async guardarProductosPromo(promocionId: number, sedeId: string, productos: { productoId: number; cantidad: number }[]) {
    await this.validarProductosPromo(sedeId, productos);
    await this.orm.PromocionProducto.where({ promocionId }).deleteAll();
    for (const p of productos) await this.orm.PromocionProducto.create({ promocionId, productoId: p.productoId, cantidad: p.cantidad });
  }

  /** Promociones con sus productos; `soloVigentes` = las que aplican hoy. */
  async promociones(sedeId: string, soloVigentes: boolean) {
    // Los productos de una promoción son siempre de su sede: se piden en paralelo con las promos.
    const [promos, prodsSede] = await Promise.all([
      this.orm.Promocion.where({ sedeId }).orderBy((p) => p.id.desc()).all(),
      this.orm.Producto.where({ sedeId }).select('id', 'nombre', 'icono', 'precio', 'stock').all(),
    ]);
    const lista = soloVigentes ? promos.filter((p) => promoVigente(p)) : promos;
    if (!lista.length) return [];
    const items = await this.orm.PromocionProducto.where((pp) => pp.promocionId.in(lista.map((p) => p.id))).all();
    const prods = new Map(prodsSede.map((p) => [p.id, p]));
    return lista.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precio: p.precio,
      diasSemana: p.diasSemana,
      desde: p.desde ? ymd(p.desde) : null,
      hasta: p.hasta ? ymd(p.hasta) : null,
      activa: p.activa,
      vigenteHoy: promoVigente(p),
      imagenUrl: urlPromo(p.imagenPath),
      productos: items
        .filter((i) => i.promocionId === p.id)
        .map((i) => ({ productoId: i.productoId, cantidad: i.cantidad, nombre: prods.get(i.productoId)?.nombre ?? '', icono: prods.get(i.productoId)?.icono ?? 'otro', precio: prods.get(i.productoId)?.precio ?? 0 })),
    }));
  }

  /** Enlace firmado para que el navegador suba la imagen de una promoción directo a Storage. */
  async urlSubidaPromo(sedeId: string, mime: string) {
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `${sedeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const res = await fetch(`${config.supabase.url}/storage/v1/object/upload/sign/promos/${path}`, {
      method: 'POST',
      headers: { apikey: config.supabase.secretKey, Authorization: `Bearer ${config.supabase.secretKey}` },
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    const token = data.url ? new URL(data.url, 'http://x').searchParams.get('token') : null;
    if (!res.ok || !token) throw new BadRequestException('No se pudo preparar la subida de la imagen.');
    return { path, token };
  }

  async verificarImagenPromo(sedeId: string, path: string) {
    if (!path.startsWith(`${sedeId}/`)) throw new BadRequestException('Imagen inválida.');
    const head = await fetch(urlPromo(path)!, { method: 'HEAD' });
    if (!head.ok) throw new BadRequestException('No encontramos la imagen. Súbela de nuevo.');
  }

  /* ---------------- Venta en mostrador ---------------- */

  /** `turnoP` llega como promesa para buscar el turno en paralelo con lo demás. */
  async vender(actor: Actor, sedeId: string, turnoP: Promise<{ id: number; recepcionistaId: number }>, input: { items: ItemVenta[]; metodo: 'efectivo' | 'terminal'; perfilId?: string }) {
    turnoP.catch(() => undefined); // se maneja abajo; evita "rechazo no manejado" si fallamos antes
    if (!input.items.length) throw new BadRequestException('Agrega al menos un producto.');
    const prodIds = [...new Set(input.items.filter((i) => i.tipo === 'producto').map((i) => i.id))];
    const promoIds = [...new Set(input.items.filter((i) => i.tipo === 'promocion').map((i) => i.id))];

    const perfilId = input.perfilId;
    const [turno, promos, promoItems, perfil] = await Promise.all([
      turnoP,
      promoIds.length ? this.orm.Promocion.where((p) => p.id.in(promoIds)).all() : Promise.resolve([]),
      promoIds.length ? this.orm.PromocionProducto.where((pp) => pp.promocionId.in(promoIds)).all() : Promise.resolve([]),
      perfilId ? this.orm.Perfil.where({ id: perfilId }).select('id', 'sedeId').first() : Promise.resolve(null),
    ]);
    for (const id of promoIds) {
      const p = promos.find((x) => x.id === id);
      if (!p || p.sedeId !== sedeId) throw new NotFoundException('Promoción no encontrada en esta sede.');
      if (!promoVigente(p)) throw new BadRequestException(`La promoción "${p.nombre}" no aplica hoy.`);
    }
    if (perfilId && (!perfil || perfil.sedeId !== sedeId)) throw new NotFoundException('Socio no encontrado en esta sede.');

    // Cuánto sale de cada producto (sueltos + los que vienen dentro de promociones).
    const salida = new Map<number, number>();
    for (const it of input.items) {
      if (it.tipo === 'producto') salida.set(it.id, (salida.get(it.id) ?? 0) + it.cantidad);
      else for (const pp of promoItems.filter((x) => x.promocionId === it.id)) salida.set(pp.productoId, (salida.get(pp.productoId) ?? 0) + pp.cantidad * it.cantidad);
    }

    const resultado = await this.prisma.db.transaction(async (tx) => {
      // Bloquea las filas para que dos cajas no vendan el mismo último producto.
      // Una sola consulta bloquea todos los productos (en orden de id, para no cruzarse con otra caja).
      const ids = [...salida.keys()];
      const filas = await tx.orm.public.Producto.where((p) => p.id.in(ids)).orderBy((p) => p.id.asc()).forUpdate().all();
      const productos = new Map(filas.map((p) => [p.id, p]));
      for (const id of ids) {
        const p = productos.get(id);
        if (!p || p.sedeId !== sedeId) throw new NotFoundException('Producto no encontrado en esta sede.');
        if (prodIds.includes(id) && !p.activo) throw new BadRequestException(`"${p.nombre}" está desactivado.`);
        if (p.stock < salida.get(id)!) throw new ConflictException(`No hay suficiente "${p.nombre}": quedan ${p.stock}.`);
      }

      const detalles = input.items.map((it) => {
        if (it.tipo === 'producto') {
          const p = productos.get(it.id)!;
          return { tipo: 'producto', refId: String(p.id), descripcion: p.nombre, cantidad: it.cantidad, precioUnitario: p.precio };
        }
        const p = promos.find((x) => x.id === it.id)!;
        return { tipo: 'promocion', refId: String(p.id), descripcion: p.nombre, cantidad: it.cantidad, precioUnitario: p.precio };
      });
      const total = detalles.reduce((s, d) => s + d.cantidad * d.precioUnitario, 0);

      const pago = await tx.orm.public.Pago.create({
        sedeId,
        turnoId: turno.id,
        perfilId: input.perfilId ?? null,
        metodo: input.metodo,
        total,
        registradoPor: actor.perfilId,
      });
      // Detalles y movimientos en lote (1 consulta cada uno); el stock, uno por producto.
      await tx.orm.public.PagoDetalle.createAll(detalles.map((d) => ({ ...d, pagoId: pago.id })));
      const movs = [...salida].map(([id, cant]) => ({ id, cant, stock: productos.get(id)!.stock - cant }));
      for (const m of movs) await tx.orm.public.Producto.where({ id: m.id }).update({ stock: m.stock });
      await tx.orm.public.MovimientoInventario.createAll(
        movs.map((m) => ({
          productoId: m.id,
          sedeId,
          tipo: 'venta',
          cantidad: -m.cant,
          stockResultante: m.stock,
          pagoId: pago.id,
          actorPerfilId: actor.perfilId,
          recepcionistaId: turno.recepcionistaId,
        })),
      );
      return { pagoId: pago.id, total, detalles };
    });

    await this.bitacora.registrar({ sedeId, actorPerfilId: actor.perfilId, recepcionistaId: turno.recepcionistaId, accion: 'venta.productos', entidad: 'Pago', entidadId: resultado.pagoId, datos: { total: resultado.total, metodo: input.metodo, items: resultado.detalles.map((d) => `${d.cantidad}× ${d.descripcion}`) } });
    return resultado;
  }

  /** Catálogo para la app del socio: productos activos y promociones vigentes hoy. */
  async catalogo(sedeId: string) {
    const [productos, promociones] = await Promise.all([
      this.orm.Producto.where({ sedeId, activo: true }).select('id', 'nombre', 'categoria', 'icono', 'precio', 'stock').orderBy((p) => p.nombre.asc()).all(),
      this.promociones(sedeId, true),
    ]);
    return {
      productos: productos.map((p) => ({ ...p, disponible: p.stock > 0, stock: undefined })),
      promociones,
      hoy: hoy(),
    };
  }

  aFechaOpcional(v: string | null | undefined) {
    return v ? aFecha(v) : null;
  }
}
