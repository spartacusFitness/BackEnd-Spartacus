// Da un rol a una cuenta que ya inició sesión al menos una vez.
// Uso:  npm run rol -- correo@ejemplo.com admin
//       npm run rol -- correo@ejemplo.com encargado dolores
//       npm run rol -- correo@ejemplo.com coach san-luis
import { db, supabaseDb } from '../prisma/db.js';

const ROLES = ['admin', 'encargado', 'recepcion', 'coach', 'socio'] as const;
type Rol = (typeof ROLES)[number];

const [email, rol, sedeId] = process.argv.slice(2);

try {
  if (!email || !ROLES.includes(rol as Rol)) {
    throw new Error(`Uso: npm run rol -- <correo> <${ROLES.join('|')}> [sede]`);
  }
  if (rol === 'admin' && sedeId) throw new Error('El rol admin aplica a todas las sedes; no lleva sede.');
  if (rol !== 'admin' && !sedeId) throw new Error(`El rol ${rol} necesita una sede (dolores, san-felipe, san-luis).`);

  const perfil = await db.orm.public.Perfil.where({ email: email.toLowerCase() }).first();
  if (!perfil) throw new Error(`No existe un perfil con ${email}. La persona debe iniciar sesión una vez antes.`);
  if (sedeId && !(await db.orm.public.Sede.first({ id: sedeId }))) throw new Error(`No existe la sede "${sedeId}".`);

  const ya = await db.orm.public.RolAsignado.where({ perfilId: perfil.id, rol: rol as Rol, sedeId: sedeId ?? null }).first();
  if (ya) {
    console.log(`= ${email} ya era ${rol}${sedeId ? ` en ${sedeId}` : ''}`);
  } else {
    await db.orm.public.RolAsignado.create({ perfilId: perfil.id, rol: rol as Rol, sedeId: sedeId ?? null });
    console.log(`✔ ${email} ahora es ${rol}${sedeId ? ` en ${sedeId}` : ' (todas las sedes)'}`);
  }
} catch (err) {
  console.error(`✘ ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await supabaseDb.close();
}
