// Borra UNA sede temporal de pruebas ("prueba-…") y todo lo suyo. Uso: node test/e2e/limpiar-sede-prueba.mjs prueba-xxxx
import 'dotenv/config';
const SEDE = process.argv[2];
if (!/^prueba-[a-z0-9]+$/.test(SEDE ?? '')) { console.error('solo sedes prueba-…'); process.exit(1); }
const { db, supabaseDb } = await import('../../dist/prisma/db.js');
const o = db.orm.public;
const antes = await o.Sede.first({ id: SEDE });
if (antes) {
  const pagos = (await o.Pago.where({ sedeId: SEDE }).select('id').all()).map((p) => p.id);
  if (pagos.length) await o.PagoDetalle.where((d) => d.pagoId.in(pagos)).deleteAll();
  await o.Pago.where({ sedeId: SEDE }).deleteAll();
  await o.MovimientoInventario.where({ sedeId: SEDE }).deleteAll();
  await o.Promocion.where({ sedeId: SEDE }).deleteAll();
  await o.Producto.where({ sedeId: SEDE }).deleteAll();
  await o.Rutina.where({ sedeId: SEDE }).deleteAll(); // días y ejercicios de la rutina caen en cascada
  await o.Ejercicio.where({ sedeId: SEDE }).deleteAll();
  await o.Maquina.where({ sedeId: SEDE }).deleteAll();
  await o.Asistencia.where({ sedeId: SEDE }).deleteAll();
  await o.Membresia.where({ sedeId: SEDE }).deleteAll();
  await o.Solicitud.where({ sedeId: SEDE }).deleteAll();
  await o.Turno.where({ sedeId: SEDE }).deleteAll();
  await o.Recepcionista.where({ sedeId: SEDE }).deleteAll();
  await o.Plan.where({ sedeId: SEDE }).deleteAll();
  await o.DiaCerrado.where({ sedeId: SEDE }).deleteAll();
  await o.Bitacora.where({ sedeId: SEDE }).deleteAll();
  await o.RolAsignado.where({ sedeId: SEDE }).deleteAll();
  await o.Perfil.where({ sedeId: SEDE }).updateAll({ sedeId: null });
  await o.Sede.where({ id: SEDE }).delete();
}
const SB = process.env.SUPABASE_URL, K = process.env.SUPABASE_SECRET_KEY;
const h = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const imgs = await (await fetch(`${SB}/storage/v1/object/list/promos`, { method: 'POST', headers: h, body: JSON.stringify({ prefix: `${SEDE}/` }) })).json();
if (Array.isArray(imgs) && imgs.length) await fetch(`${SB}/storage/v1/object/promos`, { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes: imgs.map((i) => `${SEDE}/${i.name}`) }) });
console.log(`sede ${SEDE}: ${antes ? 'borrada con sus datos' : 'no existía'}; imágenes borradas: ${Array.isArray(imgs) ? imgs.length : 0}`);
console.log('sedes que quedan:', (await o.Sede.select('id').all()).map((s) => s.id).join(', '));
await supabaseDb.close();
