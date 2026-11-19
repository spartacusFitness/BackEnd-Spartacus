import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { publicJwkSchema } from './signature.js';

const location = z.object(
  {
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  },
  { error: 'Detecta tu sede más cercana para continuar.' },
);

/** POST /auth/dispositivo — registra la llave de este dispositivo para la sesión de Supabase. */
export const dispositivoSchema = z.object({
  publicKey: z.unknown().transform((value, ctx) => {
    const parsed = publicJwkSchema.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        message: 'Tu navegador no pudo generar la llave de seguridad. Actualízalo e inténtalo de nuevo.',
      });
      return z.NEVER;
    }
    return parsed.data;
  }),
  remember: z.boolean().default(false),
});

/** PATCH /auth/me/sede — solo la ubicación; la sede la calcula el servidor. */
export const sedeSchema = z.object({ location });

/** PATCH /auth/me — datos que la persona puede editar de su perfil. */
export const perfilSchema = z
  .object({
    nombre: z.string().trim().min(2, { error: 'Escribe tu nombre.' }).max(80),
    apodo: z
      .string()
      .trim()
      .min(3, { error: 'El apodo debe tener al menos 3 caracteres.' })
      .max(24, { error: 'El apodo puede tener hasta 24 caracteres.' })
      .regex(/^[\p{L}\p{N}_.]+$/u, { error: 'El apodo solo puede tener letras, números, punto y guion bajo.' }),
    fechaNacimiento: z.iso.date({ error: 'Escribe una fecha válida.' }),
  })
  .partial();

/** PATCH /auth/me/foto — ruta del archivo que el navegador ya subió a Storage. */
export const fotoSchema = z.object({
  path: z.string().regex(/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/, { error: 'Archivo inválido.' }),
});

/** Valida el body; si falla, responde 400 con los mensajes en español. */
export function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((i) => i.message));
  }
  return result.data;
}
