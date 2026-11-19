import { z } from 'zod';
import { OBJETIVOS } from './coach.schemas.js';

export const centavos = z.number({ error: 'Escribe una cantidad.' }).int().min(0).max(100_000_000);
export const pin = z.string().regex(/^\d{4,6}$/, { error: 'El PIN debe tener de 4 a 6 números.' });
export const fecha = z.iso.date({ error: 'Escribe una fecha válida.' });
const texto = (min: number, max: number, msg: string) => z.string().trim().min(min, { error: msg }).max(max);

export const sedeCrearSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: 'El identificador solo puede tener minúsculas, números y guiones (ej. san-miguel).' }).max(40),
  nombre: texto(2, 60, 'Escribe el nombre de la sede.'),
  ciudad: texto(2, 80, 'Escribe la ciudad.'),
  direccion: texto(5, 200, 'Escribe la dirección.'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  mapsUrl: z.url({ error: 'Pega un enlace de Google Maps válido.' }).optional(),
});

export const sedeEditarSchema = sedeCrearSchema
  .omit({ id: true })
  .extend({
    diasSinServicio: z.array(z.number().int().min(0).max(6)).max(7),
    antipassbackMin: z.number().int().min(0).max(240),
    activa: z.boolean(),
  })
  .partial();

export const diaCerradoSchema = z.object({ fecha, motivo: texto(2, 120, 'Escribe el motivo (ej. Navidad).') });

export const recepcionistaCrearSchema = z.object({ nombre: texto(2, 60, 'Escribe el nombre.'), pin });
export const recepcionistaEditarSchema = z
  .object({ nombre: texto(2, 60, 'Escribe el nombre.'), pin, activo: z.boolean() })
  .partial();

export const planCrearSchema = z.object({
  nombre: texto(2, 60, 'Escribe el nombre del plan.'),
  // La visita NO es un plan: se vende en mostrador como servicio (no registra al socio).
  tipo: z.enum(['semana', 'mes', 'especial'], { error: 'Las visitas se venden en Venta como servicio, no como plan.' }),
  duracionDias: z.number().int().min(1).max(400),
  precio: centavos,
  descripcion: z.string().trim().max(300).optional(),
  pagoEnLinea: z.boolean().default(true),
  requiereValidacion: z.boolean().default(false),
  renovableEnLinea: z.boolean().default(true),
});
export const planEditarSchema = planCrearSchema.extend({ activo: z.boolean() }).partial();

export const solicitudSchema = z.object({
  planId: z.number().int().positive(),
  metodo: z.enum(['mostrador', 'tarjeta']),
});

export const abrirTurnoSchema = z.object({ recepcionistaId: z.number().int().positive(), pin, efectivoInicial: centavos });
export const cerrarTurnoSchema = z.object({ pin, efectivoContado: centavos, notas: z.string().trim().max(300).optional() });

export const altaSocioSchema = z.object({
  nombre: texto(2, 80, 'Escribe el nombre completo.'),
  email: z.string().trim().toLowerCase().pipe(z.email({ error: 'Escribe un correo válido.' })),
  fechaNacimiento: fecha.optional(),
  alturaCm: z.number().int().min(80, { error: 'La estatura va en centímetros (ej. 170).' }).max(250).optional(),
  pesoKg: z.number().min(20, { error: 'El peso va en kg.' }).max(350).optional(),
  objetivo: z.enum(OBJETIVOS, { error: 'Elige un objetivo del catálogo.' }).optional(),
});

export const cobroSchema = z.object({
  perfilId: z.uuid(),
  planId: z.number().int().positive(),
  metodo: z.enum(['efectivo', 'terminal']),
  solicitudId: z.number().int().positive().optional(),
  credencialValidada: z.boolean().optional(),
});

export const asistenciaSchema = z.object({ perfilId: z.uuid() });
