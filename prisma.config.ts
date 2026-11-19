import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import supabasePack from '@prisma/orm-extension-supabase/pack';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/prisma/contract.prisma',
    // Supabase: roles (anon/authenticated/service_role), esquemas auth/storage y políticas RLS.
    extensions: [supabasePack],
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
