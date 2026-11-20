import { z } from 'zod';

const fecha = z.iso.date({ error: 'Escribe una fecha válida.' });

/** Grupos musculares (máquinas, ejercicios y días de rutina). */
export const CATEGORIAS = [
  'pecho',
  'espalda',
  'hombro',
  'bicep',
  'tricep',
  'antebrazo',
  'pierna',
  'gluteo',
  'pantorrilla',
  'abdomen',
  'cardio',
  'cuerpo_completo',
] as const;

export const EQUIPOS = ['maquina', 'mancuernas', 'barra', 'ligas', 'kettlebell', 'polea', 'peso_corporal', 'otro'] as const;

/** Catálogo de objetivos del socio. */
export const OBJETIVOS = ['deficit', 'volumen', 'recomposicion', 'condicion', 'fuerza', 'salud'] as const;

const texto = (min: number, max: number, msg: string) => z.string().trim().min(min, { error: msg }).max(max);
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v ? v : null))
    .nullable()
    .optional();

const categoria = z.enum(CATEGORIAS, { error: 'Elige un grupo muscular del catálogo.' });
const repeticiones = z
  .string()
  .trim()
  .regex(/^[0-9]{1,3}(\s*-\s*[0-9]{1,3})?(\s*(s|seg|min))?$|^al fallo$/i, { error: 'Repeticiones: un número, un rango (10-12), tiempo (30 s) o "al fallo".' });
const series = z.number().int().min(1, { error: 'Al menos 1 serie.' }).max(20);

/* ---------- Coaches (admin / encargado) ---------- */

export const coachCrearSchema = z.object({
  nombre: texto(2, 80, 'Escribe el nombre del coach.'),
  email: z.email({ error: 'Escribe un correo válido.' }).trim().toLowerCase(),
});

/* ---------- Catálogo ---------- */

export const maquinaCrearSchema = z.object({ nombre: texto(2, 80, 'Escribe el nombre de la máquina.'), categoria });
export const maquinaEditarSchema = maquinaCrearSchema.extend({ activa: z.boolean() }).partial();

const ejercicioBase = z.object({
  nombre: texto(2, 80, 'Escribe el nombre del ejercicio.'),
  categoria,
  equipo: z.enum(EQUIPOS, { error: 'Elige con qué se hace.' }),
  maquinaId: z.number().int().positive().nullable().optional(),
  series,
  repeticiones,
  indicaciones: opcional(500),
});
const conMaquina = (v: { equipo?: string; maquinaId?: number | null }) => v.equipo !== 'maquina' || !!v.maquinaId;
export const ejercicioCrearSchema = ejercicioBase.refine(conMaquina, { error: 'Elige la máquina.', path: ['maquinaId'] });
export const ejercicioEditarSchema = ejercicioBase
  .extend({ activo: z.boolean() })
  .partial()
  .refine((v) => v.equipo === undefined || conMaquina(v), { error: 'Elige la máquina.', path: ['maquinaId'] });

/* ---------- Rutinas ---------- */

export const generarRutinaSchema = z.object({ dias: z.number().int().min(2, { error: 'Entre 2 y 6 días.' }).max(6, { error: 'Entre 2 y 6 días.' }).optional() });

export const rutinaSchema = z
  .object({
    nombre: texto(2, 80, 'Ponle nombre a la rutina (ej. Hipertrofia 4 días).'),
    notas: opcional(1000),
    dias: z
      .array(
        z.object({
          diaSemana: z.number().int().min(0).max(6),
          categorias: z.array(categoria).max(6).default([]),
          notas: opcional(500),
          ejercicios: z
            .array(
              z.object({
                ejercicioId: z.number().int().positive(),
                series,
                repeticiones,
                descansoSeg: z.number().int().min(0).max(900).nullable().optional(),
                indicaciones: opcional(500),
              }),
            )
            .min(1, { error: 'Cada día necesita al menos un ejercicio.' })
            .max(20),
        }),
      )
      .min(1, { error: 'Agrega al menos un día.' })
      .max(7),
  })
  .refine((r) => new Set(r.dias.map((d) => d.diaSemana)).size === r.dias.length, { error: 'Un día de la semana aparece dos veces.', path: ['dias'] });

/* ---------- Perfil físico, salud y avance ---------- */

export const fisicoSchema = z
  .object({
    alturaCm: z.number().int().min(80, { error: 'La estatura va en centímetros (ej. 170).' }).max(250).nullable(),
    objetivo: z.enum(OBJETIVOS, { error: 'Elige un objetivo del catálogo.' }).nullable(),
    sexo: z.enum(['mujer', 'hombre'], { error: 'Elige mujer u hombre.' }).nullable(),
  })
  .partial();

export const saludSchema = z.object({ condiciones: opcional(1000), alergias: opcional(500) });

export const medicionSchema = z.object({
  pesoKg: z.number({ error: 'Escribe el peso en kg.' }).min(20).max(350),
  fecha: fecha.optional(),
  notas: opcional(300),
});
