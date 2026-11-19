import { z } from 'zod';
import { ICONOS } from './tienda.service.js';
import { centavos, fecha } from './gym.schemas.js';

const texto = (min: number, max: number, msg: string) => z.string().trim().min(min, { error: msg }).max(max);
const cantidad = z.number().int().min(1, { error: 'La cantidad debe ser al menos 1.' }).max(10_000);

export const productoCrearSchema = z.object({
  nombre: texto(2, 80, 'Escribe el nombre del producto.'),
  categoria: z.enum(['suplementos', 'bebidas', 'snacks', 'accesorios', 'ropa', 'otro'], { error: 'Elige una categoría.' }),
  icono: z.enum(ICONOS, { error: 'Elige un ícono.' }),
  precio: centavos,
  stockInicial: z.number().int().min(0).max(100_000).default(0),
  stockMinimo: z.number().int().min(0).max(100_000).default(0),
  /** servicio sin inventario, p. ej. Visita */
  esServicio: z.boolean().default(false),
});

export const productoEditarSchema = productoCrearSchema
  .omit({ stockInicial: true })
  .extend({ activo: z.boolean() })
  .partial();

export const movimientoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('entrada'), cantidad, motivo: z.string().trim().max(200).optional() }),
  z.object({
    tipo: z.literal('ajuste'),
    stockContado: z.number().int().min(0).max(100_000),
    motivo: texto(3, 200, 'Escribe el motivo del ajuste (ej. conteo físico, merma).'),
  }),
]);

const productosPromo = z
  .array(z.object({ productoId: z.number().int().positive(), cantidad }))
  .min(1, { error: 'Agrega al menos un producto a la promoción.' })
  .max(20);

export const promocionCrearSchema = z.object({
  nombre: texto(2, 80, 'Escribe el nombre de la promoción.'),
  descripcion: z.string().trim().max(300).optional(),
  precio: centavos,
  diasSemana: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  productos: productosPromo,
  imagenPath: z.string().max(200).optional(),
});

export const promocionEditarSchema = promocionCrearSchema.extend({ activa: z.boolean(), imagenPath: z.string().max(200).nullable() }).partial();

export const imagenSchema = z.object({ tipo: z.enum(['image/jpeg', 'image/png', 'image/webp'], { error: 'La imagen debe ser JPG, PNG o WebP.' }) });

export const ventaSchema = z.object({
  items: z
    .array(z.object({ tipo: z.enum(['producto', 'promocion']), id: z.number().int().positive(), cantidad }))
    .min(1, { error: 'Agrega al menos un producto.' })
    .max(50),
  metodo: z.enum(['efectivo', 'terminal']),
  perfilId: z.uuid().optional(),
});

export const rangoSchema = z.object({
  desde: fecha,
  hasta: fecha,
  sedeId: z.string().max(40).optional(),
});
