import { z } from 'zod';
import { fecha, parcial } from './gym.schemas.js';

const opcional = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();

export const retoCrearSchema = z.object({
  nombre: z.string().trim().min(3, { error: 'Ponle nombre al reto (ej. Noviembre: 16 visitas).' }).max(80),
  descripcion: opcional(300),
  meta: z.number().int().min(1, { error: 'La meta es de al menos 1 día.' }).max(366),
  desde: fecha,
  hasta: fecha,
  premio: opcional(120),
});
export const retoEditarSchema = parcial(retoCrearSchema.extend({ activo: z.boolean() }));

export const mensajeSchema = z.object({
  texto: z.string().trim().min(1, { error: 'Escribe tu mensaje.' }).max(1000, { error: 'Máximo 1000 caracteres.' }),
});

export const rankingSchema = z.object({ participar: z.boolean() });
