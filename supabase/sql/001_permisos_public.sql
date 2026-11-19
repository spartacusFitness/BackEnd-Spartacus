-- Permisos del esquema public en Supabase.
-- Desde 2026 Supabase no da permisos automáticos a tablas nuevas. Nuestras tablas solo las usa
-- el backend (rol service_role); anon/authenticated no tienen acceso. Además todas llevan RLS
-- (@@rls en contract.prisma) sin políticas = deny-all.
-- Ejecutar una vez por proyecto, ANTES de `prisma db init`/`db update`.

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Tablas/secuencias futuras creadas por postgres (las migraciones de Prisma):
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;

-- anon/authenticated traían TRUNCATE/TRIGGER/REFERENCES por defecto (TRUNCATE se salta RLS):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
