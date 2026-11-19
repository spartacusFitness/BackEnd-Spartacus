// Uso (backend corriendo en :3000): node test/e2e/fase3.mjs — coaches, catálogo, rutinas, rachas, salud y avance.
// AISLADA: crea una sede temporal "prueba-…" y cuentas @ejemplo.com; al final borra la sede, todo lo
// suyo y esas cuentas. No toca las sedes reales.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const { db } = await import('../../dist/prisma/db.js');
const { calcularRacha } = await import('../../dist/gym/coach.service.js');
const { Calendario } = await import('../../dist/common/fechas.js');

const SB = process.env.SUPABASE_URL, PUB = process.env.SUPABASE_PUBLISHABLE_KEY, SECRET = process.env.SUPABASE_SECRET_KEY;
const API = 'http://localhost:3000';
for (let i = 0; i < 40; i++) { try { await fetch(API); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'OK ' : 'FALLA'}  ${name}${extra !== '' ? '  → ' + extra : ''}`); };
const admin = (path, init = {}) => fetch(`${SB}/auth/v1${path}`, { ...init, headers: { apikey: SECRET, 'Content-Type': 'application/json' } });
const b64url = (b) => Buffer.from(b).toString('base64url');
const sha = async (t) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const jwk = async (k) => { const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', k.publicKey); return { kty, crv, x, y }; };

async function persona(email, password) {
  const sb = createClient(SB, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const token = data.session.access_token;
  const call = async (method, path, body) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const ts = String(Date.now()), nonce = crypto.randomUUID();
    const sig = b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode([method, path, ts, nonce, await sha(payload)].join('\n'))));
    const r = await fetch(API + path, { method, body: payload || undefined, headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, 'X-Signature-Timestamp': ts, 'X-Signature-Nonce': nonce, 'X-Signature': sig } });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
  const yo = await call('POST', '/auth/dispositivo', { publicKey: await jwk(keys), remember: false });
  return { call, yo: yo.body, userId: data.user.id };
}
const nuevaCuenta = async (email, meta = {}) => (await (await admin('/admin/users', { method: 'POST', body: JSON.stringify({ email, password: 'Fuerte-1234', email_confirm: true, user_metadata: meta }) })).json()).id;

const hoyMx = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const menos = (n) => new Date(new Date(`${hoyMx}T12:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);
const T = Date.now();
const SEDE = `prueba-${T.toString(36)}`;
const COORDS = { lat: 22.89, lng: -109.91 }; // lejos de las sedes reales
const creados = [];
const o = db.orm.public;
try {
  // ---------- Preparación: admin, sede temporal, socio ----------
  const adminEmail = `admin.f3.${T}@ejemplo.com`;
  creados.push(await nuevaCuenta(adminEmail, { full_name: 'Admin F3' }));
  await persona(adminEmail, 'Fuerte-1234');
  execSync(`npm run rol -- ${adminEmail} admin`, { cwd: new URL('../..', import.meta.url), stdio: 'pipe' });
  const A = await persona(adminEmail, 'Fuerte-1234');
  check('crear sede temporal aislada', (await A.call('POST', '/sedes', { id: SEDE, nombre: 'Prueba E2E', ciudad: 'Prueba', direccion: 'Sede temporal de pruebas', ...COORDS })).status === 201, SEDE);

  const socioEmail = `socio.f3.${T}@ejemplo.com`;
  creados.push(await nuevaCuenta(socioEmail, { full_name: 'Socia Fuerte', ubicacion: COORDS }));
  const S = await persona(socioEmail, 'Fuerte-1234');
  check('la socia queda en la sede temporal', S.yo.sede?.id === SEDE, S.yo.sede?.id);

  // ---------- Coaches ----------
  const coachEmail = `coach.f3.${T}@ejemplo.com`;
  creados.push(await nuevaCuenta(coachEmail, { full_name: 'Coach Ana' }));
  await persona(coachEmail, 'Fuerte-1234'); // ya tenía cuenta
  const alta = await A.call('POST', `/sedes/${SEDE}/coaches`, { nombre: 'Coach Ana', email: coachEmail });
  check('admin da de alta a un coach con cuenta existente', alta.status === 201, alta.status);
  check('mismo coach otra vez → 409', (await A.call('POST', `/sedes/${SEDE}/coaches`, { nombre: 'Coach Ana', email: coachEmail })).status === 409);
  const nuevoEmail = `coach2.f3.${T}@ejemplo.com`;
  const alta2 = await A.call('POST', `/sedes/${SEDE}/coaches`, { nombre: 'Coach Beto', email: nuevoEmail });
  check('alta de coach sin cuenta: la crea', alta2.status === 201 && typeof alta2.body.correoEnviado === 'boolean', `${alta2.status} correo=${alta2.body.correoEnviado}`);
  const p2 = alta2.body.id ? await o.Perfil.where({ id: alta2.body.id }).select('userId').first() : null;
  if (p2) creados.push(p2.userId);
  const C = await persona(coachEmail, 'Fuerte-1234');
  check('el coach ve su rol', C.yo.roles?.some((r) => r.rol === 'coach' && r.sedeId === SEDE));

  // ---------- Permisos ----------
  check('socio NO entra al panel de coach', (await S.call('GET', `/coach/${SEDE}/socios`)).status === 403);
  check('coach NO da de alta coaches', (await C.call('POST', `/sedes/${SEDE}/coaches`, { nombre: 'X', email: `x.${T}@ejemplo.com` })).status === 403);

  // ---------- Catálogo ----------
  const maq = await C.call('POST', `/coach/${SEDE}/maquinas`, { nombre: 'Press de pecho', categoria: 'pecho' });
  check('coach crea máquina', maq.status === 201, maq.body.id);
  check('categoría fuera del catálogo → 400', (await C.call('POST', `/coach/${SEDE}/maquinas`, { nombre: 'Rara', categoria: 'orejas' })).status === 400);
  const e1 = await C.call('POST', `/coach/${SEDE}/ejercicios`, { nombre: 'Press en máquina', categoria: 'pecho', equipo: 'maquina', maquinaId: maq.body.id, series: 4, repeticiones: '10-12' });
  const e2 = await C.call('POST', `/coach/${SEDE}/ejercicios`, { nombre: 'Curl con mancuernas', categoria: 'bicep', equipo: 'mancuernas', series: 3, repeticiones: '12', indicaciones: 'Codos pegados' });
  const e3 = await C.call('POST', `/coach/${SEDE}/ejercicios`, { nombre: 'Sentadilla', categoria: 'pierna', equipo: 'barra', series: 5, repeticiones: '5' });
  check('coach crea ejercicios (máquina y libres)', [e1, e2, e3].every((e) => e.status === 201), [e1, e2, e3].map((e) => e.status).join(','));
  check('ejercicio "en máquina" sin máquina → 400', (await C.call('POST', `/coach/${SEDE}/ejercicios`, { nombre: 'Sin máquina', categoria: 'pecho', equipo: 'maquina', series: 3, repeticiones: '10' })).status === 400);
  check('repeticiones inválidas → 400', (await C.call('POST', `/coach/${SEDE}/ejercicios`, { nombre: 'Malo', categoria: 'pecho', equipo: 'barra', series: 3, repeticiones: 'muchas' })).status === 400);
  const cat = await C.call('GET', `/coach/${SEDE}/catalogo`);
  check('catálogo con nombre de máquina', cat.body.ejercicios?.find((e) => e.id === e1.body.id)?.maquina === 'Press de pecho');

  // ---------- Rachas ----------
  const visitas = [0, 1, 2, 4].map(menos);
  await o.Asistencia.createAll(visitas.map((d) => ({ perfilId: S.yo.id, sedeId: SEDE, origen: 'recepcion', resultado: 'permitida', createdAt: new Date(`${d}T12:00:00-06:00`) })));
  const esperada = calcularRacha(new Set(visitas), new Calendario('', []), hoyMx);
  const lista = await C.call('GET', `/coach/${SEDE}/socios`);
  const yoLista = lista.body.find?.((s) => s.id === S.yo.id);
  check('coach ve la lista de socios', lista.status === 200 && !!yoLista, lista.status);
  check('racha semanal y consecutiva correctas', yoLista?.racha.semana === esperada.semana && yoLista?.racha.consecutiva === esperada.consecutiva, `semana ${yoLista?.racha.semana}/${esperada.semana}, seguidos ${yoLista?.racha.consecutiva}/${esperada.consecutiva}`);
  check('buscar por nombre', (await C.call('GET', `/coach/${SEDE}/socios?q=fuerte`)).body.length === 1);

  // ---------- Perfil físico, avance y salud ----------
  check('coach registra estatura y objetivo', (await C.call('PATCH', `/coach/${SEDE}/socios/${S.yo.id}`, { alturaCm: 165, objetivo: 'recomposicion' })).status === 200);
  check('objetivo fuera del catálogo → 400', (await C.call('PATCH', `/coach/${SEDE}/socios/${S.yo.id}`, { objetivo: 'ser famoso' })).status === 400);
  check('coach registra peso', (await C.call('POST', `/coach/${SEDE}/socios/${S.yo.id}/mediciones`, { pesoKg: 62.4 })).status === 201);
  check('peso con fecha futura → 400', (await C.call('POST', `/coach/${SEDE}/socios/${S.yo.id}/mediciones`, { pesoKg: 62, fecha: '2099-01-01' })).status === 400);
  const salud = await C.call('PUT', `/coach/${SEDE}/socios/${S.yo.id}/salud`, { condiciones: 'Lesión de rodilla izquierda', alergias: 'Nuez' });
  check('coach guarda condiciones y alergias', salud.status === 200 && salud.body.alergias === 'Nuez');
  const fichaC = await C.call('GET', `/coach/${SEDE}/socios/${S.yo.id}`);
  check('ficha del coach: peso, estatura, objetivo y salud', fichaC.body.pesoKg === 62.4 && fichaC.body.alturaCm === 165 && fichaC.body.objetivo === 'recomposicion' && fichaC.body.salud?.condiciones === 'Lesión de rodilla izquierda');
  const fichaA = await A.call('GET', `/coach/${SEDE}/socios/${S.yo.id}`);
  check('admin ve la ficha SIN datos de salud', fichaA.status === 200 && fichaA.body.salud === null);
  check('admin NO edita la salud', (await A.call('PUT', `/coach/${SEDE}/socios/${S.yo.id}/salud`, { alergias: 'x' })).status === 403);
  const bit = await o.Bitacora.where({ accion: 'salud.actualizar', entidadId: S.yo.id }).select('datos').first();
  check('la bitácora no guarda el contenido de salud', bit && bit.datos === null);

  // ---------- Rutinas ----------
  const rutina = {
    nombre: 'Fuerza 2 días',
    notas: 'Calienta 10 min',
    dias: [
      { diaSemana: 1, categorias: ['pecho', 'bicep'], ejercicios: [
        { ejercicioId: e1.body.id, series: 4, repeticiones: '8-10', descansoSeg: 90 },
        { ejercicioId: e2.body.id, series: 3, repeticiones: '12', indicaciones: 'Lento al bajar' },
      ] },
      { diaSemana: 4, categorias: ['pierna'], notas: 'Cuida la rodilla', ejercicios: [{ ejercicioId: e3.body.id, series: 5, repeticiones: '5' }] },
    ],
  };
  const r1 = await C.call('PUT', `/coach/${SEDE}/socios/${S.yo.id}/rutina`, rutina);
  check('coach asigna rutina', r1.status === 200 && r1.body.dias?.length === 2 && r1.body.dias[0].ejercicios[0].nombre === 'Press en máquina' && r1.body.coach === 'Coach Ana', r1.status);
  check('día repetido → 400', (await C.call('PUT', `/coach/${SEDE}/socios/${S.yo.id}/rutina`, { ...rutina, dias: [rutina.dias[0], rutina.dias[0]] })).status === 400);
  check('ejercicio de otra sede → 400', (await C.call('PUT', `/coach/${SEDE}/socios/${S.yo.id}/rutina`, { ...rutina, dias: [{ diaSemana: 2, categorias: [], ejercicios: [{ ejercicioId: 99999999, series: 3, repeticiones: '10' }] }] })).status === 400);
  const r2 = await C.call('PUT', `/coach/${SEDE}/socios/${S.yo.id}/rutina`, { ...rutina, nombre: 'Fuerza v2' });
  const rutinas = await o.Rutina.where({ perfilId: S.yo.id }).select('activa').all();
  check('nueva rutina: la anterior queda en el historial', r2.body.nombre === 'Fuerza v2' && rutinas.length === 2 && rutinas.filter((r) => r.activa).length === 1, `${rutinas.length} rutinas, ${rutinas.filter((r) => r.activa).length} activa`);
  check('la lista marca que tiene rutina', (await C.call('GET', `/coach/${SEDE}/socios`)).body.find((s) => s.id === S.yo.id)?.tieneRutina === true);

  // ---------- La socia ----------
  const mia = await S.call('GET', '/yo/entrenamiento');
  check('socia ve su rutina, racha, peso y su salud', mia.status === 200 && mia.body.rutina?.nombre === 'Fuerza v2' && mia.body.racha.consecutiva === esperada.consecutiva && mia.body.pesoKg === 62.4 && mia.body.salud?.alergias === 'Nuez');
  check('socia actualiza su salud', (await S.call('PUT', '/yo/salud', { condiciones: null, alergias: 'Nuez, mariscos' })).body.alergias === 'Nuez, mariscos');
  check('socia registra su peso', (await S.call('POST', '/yo/mediciones', { pesoKg: 61.9 })).status === 201);
  check('socia cambia su objetivo', (await S.call('PATCH', '/yo/fisico', { objetivo: 'deficit' })).status === 200);
  const fichaC2 = await C.call('GET', `/coach/${SEDE}/socios/${S.yo.id}`);
  check('el coach ve los cambios de la socia', fichaC2.body.pesoKg === 61.9 && fichaC2.body.objetivo === 'deficit' && fichaC2.body.salud?.alergias === 'Nuez, mariscos');

  // ---------- Nutrición (fase 4) ----------
  await o.Perfil.where({ id: S.yo.id }).update({ fechaNacimiento: new Date('1995-03-10T12:00:00Z') });
  check('socia indica su sexo', (await S.call('PATCH', '/yo/fisico', { sexo: 'mujer' })).status === 200);
  const nut = await S.call('GET', '/yo/nutricion');
  const ideas = (nut.body.comidas ?? []).flatMap((c) => c.opciones).join(' ');
  check('nutrición: calorías y macros calculados', nut.status === 200 && nut.body.calorias > 1000 && nut.body.proteinaG > 0 && nut.body.faltan.length === 0, `${nut.body.calorias} kcal, ${nut.body.proteinaG} g proteína`);
  check('nutrición: sin sus alérgenos (nuez, mariscos)', nut.body.alergenosEvitados?.includes('nueces') && !/nuez|nueces|camar/i.test(ideas));
  check('coach ve la nutrición de su socia', (await C.call('GET', `/coach/${SEDE}/socios/${S.yo.id}/nutricion`)).body.calorias === nut.body.calorias);
  check('admin NO ve la nutrición (usa datos de salud)', (await A.call('GET', `/coach/${SEDE}/socios/${S.yo.id}/nutricion`)).status === 403);

  // ---------- Coaches de la sede ----------
  const cs = await A.call('GET', `/sedes/${SEDE}/coaches`);
  check('admin ve sus coaches con rutinas activas', cs.status === 200 && cs.body.length === 2 && cs.body.find((c) => c.email === coachEmail)?.rutinasActivas === 1);
  check('quitar la rutina', (await C.call('DELETE', `/coach/${SEDE}/socios/${S.yo.id}/rutina`)).status === 204 && (await S.call('GET', '/yo/entrenamiento')).body.rutina === null);
  check('admin quita a un coach', (await A.call('DELETE', `/sedes/${SEDE}/coaches/${C.yo.id}`)).status === 204);
  check('…y pierde el acceso al instante (caché invalidada)', (await C.call('GET', `/coach/${SEDE}/socios`)).status === 403);
} catch (e) {
  fail++;
  console.log('ERROR', e.stack ?? e.message);
} finally {
  for (const id of creados) await admin(`/admin/users/${id}`, { method: 'DELETE' });
  console.log(`\nlimpieza: ${creados.length} cuentas de prueba borradas`);
  await db.close();
  if (process.env.CONSERVAR_SEDE === '1') {
    console.log(`CONSERVAR_SEDE=1: la sede ${SEDE} se queda. Bórrala con: node test/e2e/limpiar-sede-prueba.mjs ${SEDE}`);
  } else {
    console.log(execSync(`node test/e2e/limpiar-sede-prueba.mjs ${SEDE}`, { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).trim());
  }
  console.log(`${pass} OK, ${fail} fallas`);
}
