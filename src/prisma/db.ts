import 'dotenv/config';
import supabaseRuntime from '@prisma/orm-extension-supabase/runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d.js';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

/**
 * Cliente de Postgres (Supabase, pooler de SESIÓN) con el que consulta el backend.
 *
 * Velocidad: antes usábamos `supabase(...).asServiceRole()`, que envuelve CADA consulta en
 * set_config(role) + set_config(claims) + consulta + RESET ALL + RESET ROLE = 5 viajes a la base
 * (~480 ms desde aquí). Este cliente hace 1 viaje (~100 ms).
 *
 * Seguridad: el backend es la única capa de confianza (valida JWT, dispositivo, firma y roles antes
 * de consultar). Se conecta como `postgres`, dueño de las tablas y con BYPASSRLS, igual que
 * service_role. RLS sigue activo y sin políticas, así que `anon`/`authenticated` (la Data API
 * pública) no pueden leer ni escribir nada.
 */
export const db = postgres({
  contract,
  url: process.env['DATABASE_URL']!,
  extensions: [supabaseRuntime],
  // Reabrir una conexión TLS a us-west-2 cuesta ~1 s: mantenlas abiertas mientras haya uso.
  poolOptions: { idleTimeoutMillis: 10 * 60 * 1000, connectionTimeoutMillis: 15_000 },
});

/** Alias conservado para scripts y pruebas que hacen `supabaseDb.close()`. */
export const supabaseDb = db;
