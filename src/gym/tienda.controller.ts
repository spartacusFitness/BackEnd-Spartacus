import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { parse } from '../auth/auth.schemas.js';
import { BitacoraService } from '../common/bitacora.service.js';
import { aFecha } from '../common/fechas.js';
import { exigirRolEn, sedesCon, tieneRolEn } from '../common/permisos.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GymService } from './gym.service.js';
import { imagenSchema, movimientoSchema, productoCrearSchema, productoEditarSchema, promocionCrearSchema, promocionEditarSchema, ventaSchema } from './tienda.schemas.js';
import { TiendaService } from './tienda.service.js';

const GESTION = ['admin', 'encargado'] as const;
const STAFF = ['admin', 'encargado', 'recepcion'] as const;

const diasTexto = (d?: number[]) => (d ? [...new Set(d)].sort().join(',') : undefined);

@Controller()
@UseGuards(AuthGuard)
export class TiendaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tienda: TiendaService,
    private readonly gym: GymService,
    private readonly bitacora: BitacoraService,
  ) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  /* ---------------- Productos ---------------- */

  /** GET /sedes/:id/productos — staff (con ?todos=1 incluye desactivados). */
  @Get('sedes/:id/productos')
  async productos(@Req() req: AuthedRequest, @Param('id') id: string, @Query('todos') todos?: string) {
    exigirRolEn(req.auth, id, [...STAFF]);
    const q = this.orm.Producto.where({ sedeId: id });
    return (todos === '1' ? q : q.where({ activo: true })).orderBy((p) => p.nombre.asc()).all();
  }

  @Post('sedes/:id/productos')
  async crearProducto(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const { stockInicial, ...input } = parse(productoCrearSchema, body);
    await this.gym.sede(id);
    const p = await this.orm.Producto.create({ ...input, sedeId: id, stock: 0 });
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'producto.crear', entidad: 'Producto', entidadId: p.id, datos: { ...input, stockInicial } });
    if (stockInicial > 0 && !input.esServicio) await this.tienda.movimiento({ perfilId: req.auth.perfilId }, id, p.id, { tipo: 'entrada', cantidad: stockInicial, motivo: 'Inventario inicial' });
    return { ...p, stock: input.esServicio ? 0 : stockInicial };
  }

  /** PATCH — precio, nombre, ícono, mínimo, activo. El stock solo cambia con movimientos. */
  @Patch('sedes/:id/productos/:pid')
  async editarProducto(@Req() req: AuthedRequest, @Param('id') id: string, @Param('pid', ParseIntPipe) pid: number, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const input = parse(productoEditarSchema, body);
    const antes = await this.orm.Producto.first({ id: pid });
    if (!antes || antes.sedeId !== id) throw new NotFoundException('Producto no encontrado.');
    const p = await this.orm.Producto.where({ id: pid }).update(input);
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'producto.editar', entidad: 'Producto', entidadId: pid, datos: { antes: { nombre: antes.nombre, precio: antes.precio, activo: antes.activo }, cambios: input } });
    return p;
  }

  /**
   * DELETE — borra el producto por completo con sus movimientos de inventario. Las ventas no se pierden:
   * cada venta guarda su propia copia del nombre y precio. Si está en una promoción, primero hay que quitarlo de ella.
   */
  @Delete('sedes/:id/productos/:pid')
  @HttpCode(204)
  async eliminarProducto(@Req() req: AuthedRequest, @Param('id') id: string, @Param('pid', ParseIntPipe) pid: number) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const p = await this.orm.Producto.first({ id: pid });
    if (!p || p.sedeId !== id) throw new NotFoundException('Producto no encontrado.');
    const enPromos = await this.orm.PromocionProducto.where({ productoId: pid }).select('promocionId').all();
    if (enPromos.length) {
      const nombres = (await this.orm.Promocion.where({ sedeId: id }).select('id', 'nombre').all()).filter((x) => enPromos.some((e) => e.promocionId === x.id)).map((x) => `"${x.nombre}"`);
      throw new ConflictException(`"${p.nombre}" está en la promoción ${nombres.join(', ')}. Quítalo de ahí (o borra la promoción) antes de eliminarlo.`);
    }
    await this.prisma.db.transaction(async (tx) => {
      await tx.orm.public.MovimientoInventario.where({ productoId: pid }).deleteAll();
      await tx.orm.public.Producto.where({ id: pid }).deleteAll();
    });
    void this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'producto.eliminar', entidad: 'Producto', entidadId: pid, datos: { nombre: p.nombre, precio: p.precio, stock: p.stock } });
  }

  /** POST /sedes/:id/productos/:pid/inventario — entrada (staff) o ajuste por conteo (gestión). */
  @Post('sedes/:id/productos/:pid/inventario')
  async inventario(@Req() req: AuthedRequest, @Param('id') id: string, @Param('pid', ParseIntPipe) pid: number, @Body() body: unknown) {
    const mov = parse(movimientoSchema, body);
    exigirRolEn(req.auth, id, mov.tipo === 'entrada' ? [...STAFF] : [...GESTION]);
    const turno = await this.gym.turnoAbierto(id);
    return this.tienda.movimiento({ perfilId: req.auth.perfilId }, id, pid, mov, turno?.recepcionistaId);
  }

  @Get('sedes/:id/productos/:pid/movimientos')
  async movimientos(@Req() req: AuthedRequest, @Param('id') id: string, @Param('pid', ParseIntPipe) pid: number) {
    exigirRolEn(req.auth, id, [...STAFF]);
    return this.orm.MovimientoInventario.where({ productoId: pid, sedeId: id }).orderBy((m) => m.id.desc()).limit(50).all();
  }

  /* ---------------- Promociones ---------------- */

  @Get('sedes/:id/promociones')
  promociones(@Req() req: AuthedRequest, @Param('id') id: string) {
    exigirRolEn(req.auth, id, [...STAFF]);
    return this.tienda.promociones(id, false);
  }

  @Post('sedes/:id/promociones')
  async crearPromo(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const { productos, diasSemana, desde, hasta, imagenPath, ...input } = parse(promocionCrearSchema, body);
    if (desde && hasta && desde > hasta) throw new BadRequestException('La fecha "desde" debe ser antes de "hasta".');
    await this.tienda.validarProductosPromo(id, productos);
    if (imagenPath) await this.tienda.verificarImagenPromo(id, imagenPath);
    const p = await this.orm.Promocion.create({
      ...input,
      descripcion: input.descripcion ?? null,
      sedeId: id,
      diasSemana: diasTexto(diasSemana) ?? '',
      desde: desde ? aFecha(desde) : null,
      hasta: hasta ? aFecha(hasta) : null,
      imagenPath: imagenPath ?? null,
    });
    await this.tienda.guardarProductosPromo(p.id, id, productos);
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'promocion.crear', entidad: 'Promocion', entidadId: p.id, datos: { nombre: p.nombre, precio: p.precio, diasSemana, desde, hasta } });
    return (await this.tienda.promociones(id, false)).find((x) => x.id === p.id);
  }

  @Patch('sedes/:id/promociones/:pid')
  async editarPromo(@Req() req: AuthedRequest, @Param('id') id: string, @Param('pid', ParseIntPipe) pid: number, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const { productos, diasSemana, desde, hasta, imagenPath, ...input } = parse(promocionEditarSchema, body);
    const antes = await this.orm.Promocion.first({ id: pid });
    if (!antes || antes.sedeId !== id) throw new NotFoundException('Promoción no encontrada.');
    if (productos) await this.tienda.validarProductosPromo(id, productos);
    if (imagenPath) await this.tienda.verificarImagenPromo(id, imagenPath);
    await this.orm.Promocion.where({ id: pid }).update({
      ...input,
      ...(diasSemana !== undefined ? { diasSemana: diasTexto(diasSemana)! } : {}),
      ...(desde !== undefined ? { desde: aFecha(desde) } : {}),
      ...(hasta !== undefined ? { hasta: aFecha(hasta) } : {}),
      ...(imagenPath !== undefined ? { imagenPath } : {}),
    });
    if (productos) await this.tienda.guardarProductosPromo(pid, id, productos);
    await this.bitacora.registrar({ sedeId: id, actorPerfilId: req.auth.perfilId, accion: 'promocion.editar', entidad: 'Promocion', entidadId: pid, datos: { cambios: { ...input, diasSemana, desde, hasta } } });
    return (await this.tienda.promociones(id, false)).find((x) => x.id === pid);
  }

  /** POST /sedes/:id/promociones/imagen { tipo } → enlace firmado para subir la imagen directo a Storage. */
  @Post('sedes/:id/promociones/imagen')
  imagen(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    exigirRolEn(req.auth, id, [...GESTION]);
    const { tipo } = parse(imagenSchema, body);
    return this.tienda.urlSubidaPromo(id, tipo);
  }

  /* ---------------- Mostrador ---------------- */

  /** POST /recepcion/:sedeId/ventas — venta de productos y promociones (requiere turno abierto). */
  @Post('recepcion/:sedeId/ventas')
  async vender(@Req() req: AuthedRequest, @Param('sedeId') sedeId: string, @Body() body: unknown) {
    exigirRolEn(req.auth, sedeId, [...STAFF]);
    const input = parse(ventaSchema, body);
    const turno = this.gym.turnoAbierto(sedeId).then((t) => {
      if (!t) throw new BadRequestException('Abre tu turno con tu PIN antes de vender.');
      return t;
    });
    return this.tienda.vender({ perfilId: req.auth.perfilId }, sedeId, turno, input);
  }

  /* ---------------- App del socio ---------------- */

  /** GET /yo/tienda — productos y promociones de hoy en su sede (se pagan en mostrador). */
  @Get('yo/tienda')
  async catalogo(@Req() req: AuthedRequest) {
    // La sede del socio ya viene en sus roles (caché de sesión): sin consulta extra.
    const sedeSocio = req.auth.roles.find((r) => r.rol === 'socio')?.sedeId;
    const sedeId = sedeSocio ?? sedesCon(req.auth, [...STAFF])?.[0];
    if (!sedeId) return { productos: [], promociones: [], hoy: null };
    // Un socio sin membresía vigente no ve la tienda (la app queda bloqueada).
    if (sedeSocio && !tieneRolEn(req.auth, sedeId, [...STAFF]) && !(await this.gym.membresiaVigente(req.auth.perfilId, sedeId))) {
      throw new ForbiddenException({ message: 'Necesitas una membresía activa para usar esta función.', code: 'sin_membresia' });
    }
    return this.tienda.catalogo(sedeId);
  }
}
