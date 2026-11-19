import 'dotenv/config';
import { supabase } from '@prisma/orm-extension-supabase/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d.js';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

/**
 * Cliente de Supabase (Postgres por el pooler de SESIÓN).
 * Es "por rol": asUser(jwt) respeta RLS como esa persona; asServiceRole() lo omite.
 */
export const supabaseDb = await supabase({
  contract,
  url: process.env['DATABASE_URL']!,
  jwksUrl: `${process.env['SUPABASE_URL']}/auth/v1/.well-known/jwks.json`,
});

/**
 * El backend es la capa de confianza: valida sesión, firma y permisos antes de consultar,
 * así que por ahora consulta como service_role. Cuando migremos el login a Supabase Auth
 * podremos usar asUser(jwt) para que el RLS también filtre por persona.
 */
export const db = supabaseDb.asServiceRole();
