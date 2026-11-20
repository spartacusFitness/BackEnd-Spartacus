// Uso (backend corriendo en :3000): node test/e2e/fase5.mjs — comunidad: logros, ranking opcional, retos y mensajes con el coach.
// AISLADA: crea una sede temporal "prueba-…" y cuentas @ejemplo.com; al final borra la sede, todo lo
// suyo y esas cuentas. No toca las sedes reales.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const { db } = await import('../../dist/prisma/db.js');

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
  // ---------- Preparación ----------
  const adminEmail = `admin.f5.${T}@ejemplo.com`;
  creados.push(await nuevaCuenta(adminEmail, { full_name: 'Admin F5' }));
  await persona(adminEmail, 'Fuerte-1234');
  execSync(`npm run rol -- ${adminEmail} admin`, { cwd: new URL('../..', import.meta.url), stdio: 'pipe' });
  const A = await persona(adminEmail, 'Fuerte-1234');
  check('crear sede temporal aislada', (await A.call('POST', '/sedes', { id: SEDE, nombre: 'Prueba E2E', ciudad: 'Prueba', direccion: 'Temporal', ...COORDS })).status === 201, SEDE);
  const coachEmail = `coach.f5.${T}@ejemplo.com`;
  creados.push(await nuevaCuenta(coachEmail, { full_name: 'Coach Ana' }));
  await persona(coachEmail, 'Fuerte-1234');
  await A.call('POST', `/sedes/${SEDE}/coaches`, { nombre: 'Coach Ana', email: coachEmail });
  const C = await persona(coachEmail, 'Fuerte-1234');
  const plan = await A.call('POST', `/sedes/${SEDE}/planes`, { nombre: 'Mes', tipo: 'mes', duracionDias: 30, precio: 45000 });
  const socias = [];
  for (const [n, dias] of [['Daniela Ramírez', 6], ['Lupita Mendoza', 3], ['Sin Membresía', 0]]) {
    const e = `${n.split(' ')[0].toLowerCase()}.f5.${T}@ejemplo.com`;
    creados.push(await nuevaCuenta(e, { full_name: n, ubicacion: COORDS }));
    const p = await persona(e, 'Fuerte-1234');
    if (n !== 'Sin Membresía') await o.Membresia.create({ perfilId: p.yo.id, sedeId: SEDE, planId: plan.body.id, inicio: new Date(`${menos(40)}T12:00:00Z`), fin: new Date(`${menos(-20)}T12:00:00Z`) });
    // Visitas en días distintos de este mes (hacia atrás desde hoy, sin salir del mes).
    const fechas = [];
    for (let i = 0; fechas.length < dias && i < 40; i++) if (menos(i).slice(0, 7) === hoyMx.slice(0, 7)) fechas.push(menos(i));
    if (fechas.length) await o.Asistencia.createAll(fechas.map((d) => ({ perfilId: p.yo.id, sedeId: SEDE, origen: 'recepcion', resultado: 'permitida', createdAt: new Date(`${d}T12:00:00-06:00`) })));
    socias.push({ ...p, visitas: fechas.length });
  }
  const [D, L, X] = socias;

  // ---------- Membresía ----------
  check('sin membresía: comunidad bloqueada', (await X.call('GET', '/yo/comunidad')).status === 403);
  check('sin membresía: mensajes bloqueados', (await X.call('POST', '/yo/mensajes', { texto: 'hola' })).status === 403);

  // ---------- Logros ----------
  const c1 = await D.call('GET', '/yo/comunidad');
  const logro = (c, k) => c.body.logros.find((l) => l.clave === k);
  check('logros: primer día obtenido', c1.status === 200 && logro(c1, 'primera').obtenido === true, c1.status);
  check('logros: 10 visitas aún no, con su avance', logro(c1, 'visitas10').obtenido === false && logro(c1, 'visitas10').actual === D.visitas, `${logro(c1, 'visitas10')?.actual}/${D.visitas}`);

  // ---------- Ranking opcional ----------
  check('ranking: apagado por defecto (nadie aparece)', c1.body.ranking.participo === false && c1.body.ranking.top.length === 0);
  check('activar ranking', (await D.call('PUT', '/yo/ranking', { participar: true })).status === 204);
  await L.call('PUT', '/yo/ranking', { participar: true });
  const c2 = await L.call('GET', '/yo/comunidad');
  const top = c2.body.ranking.top;
  check('ranking ordenado por días del mes', top.length === 2 && top[0].dias === D.visitas && top[1].soyYo === true, JSON.stringify(top));
  check('ranking muestra nombre público, no el correo', top[0].nombre === 'Daniela R.' && !JSON.stringify(c2.body.ranking).includes('@'), top[0]?.nombre);
  await D.call('PUT', '/yo/ranking', { participar: false });
  check('desactivar ranking la quita', (await L.call('GET', '/yo/comunidad')).body.ranking.top.every((x) => x.nombre !== 'Daniela R.'));

  // ---------- Retos ----------
  const mesIni = hoyMx.slice(0, 8) + '01';
  check('recepción/coach NO crean retos', (await C.call('POST', `/sedes/${SEDE}/retos`, { nombre: 'X', meta: 1, desde: mesIni, hasta: hoyMx })).status === 403);
  check('fechas al revés → 400', (await A.call('POST', `/sedes/${SEDE}/retos`, { nombre: 'Malo', meta: 1, desde: hoyMx, hasta: mesIni === hoyMx ? menos(1) : mesIni })).status === 400);
  const reto = await A.call('POST', `/sedes/${SEDE}/retos`, { nombre: 'Reto del mes', meta: 4, desde: mesIni, hasta: menos(-10), premio: 'Una proteína' });
  check('admin crea un reto', reto.status === 201, reto.status);
  check('inscribirse', (await D.call('POST', `/yo/retos/${reto.body.id}`)).status === 204);
  check('inscribirse dos veces → 409', (await D.call('POST', `/yo/retos/${reto.body.id}`)).status === 409);
  await L.call('POST', `/yo/retos/${reto.body.id}`);
  const rd = (await D.call('GET', '/yo/comunidad')).body.retos.find((r) => r.id === reto.body.id);
  check('progreso del reto con sus entradas', rd.inscrito && rd.dias === D.visitas && rd.cumplido === D.visitas >= 4, JSON.stringify(rd));
  const ra = (await A.call('GET', `/sedes/${SEDE}/retos`)).body.find((r) => r.id === reto.body.id);
  check('admin ve inscritos y quién cumplió', ra.inscritos === 2 && ra.cumplieron.length === [D, L].filter((x) => x.visitas >= 4).length, JSON.stringify(ra.cumplieron));
  check('logro "Reto cumplido"', logro(await D.call('GET', '/yo/comunidad'), 'reto').obtenido === D.visitas >= 4);
  check('salir del reto', (await L.call('DELETE', `/yo/retos/${reto.body.id}`)).status === 204);
  check('admin oculta el reto', (await A.call('PATCH', `/sedes/${SEDE}/retos/${reto.body.id}`, { activo: false })).status === 204);
  check('reto oculto ya no aparece al socio', !(await D.call('GET', '/yo/comunidad')).body.retos.some((r) => r.id === reto.body.id));
  const ra2 = (await A.call('GET', `/sedes/${SEDE}/retos`)).body.find((r) => r.id === reto.body.id);
  check('ocultar no cambia sus fechas ni meta', ra2.meta === 4 && ra2.desde === mesIni && ra2.premio === 'Una proteína', JSON.stringify(ra2).slice(0, 160));

  // ---------- Mensajes con el coach ----------
  check('mensaje vacío → 400', (await D.call('POST', '/yo/mensajes', { texto: '   ' })).status === 400);
  check('socia escribe a su coach', (await D.call('POST', '/yo/mensajes', { texto: '¿Con qué sustituyo la prensa?' })).status === 201);
  const bandeja = await C.call('GET', `/coach/${SEDE}/mensajes`);
  check('coach ve la conversación con 1 sin leer', bandeja.status === 200 && bandeja.body[0]?.socioId === D.yo.id && bandeja.body[0].sinLeer === 1, JSON.stringify(bandeja.body).slice(0, 120));
  check('admin NO lee los mensajes', (await A.call('GET', `/coach/${SEDE}/mensajes`)).status === 403);
  const conv = await C.call('GET', `/coach/${SEDE}/socios/${D.yo.id}/mensajes`);
  check('coach abre la conversación (queda leída)', conv.status === 200 && conv.body.length === 1 && (await C.call('GET', `/coach/${SEDE}/mensajes`)).body[0].sinLeer === 0);
  check('coach contesta', (await C.call('POST', `/coach/${SEDE}/socios/${D.yo.id}/mensajes`, { texto: 'Usa sentadilla en Smith.' })).status === 201);
  check('la socia tiene 1 sin leer', (await D.call('GET', '/yo/mensajes/sin-leer')).body.n === 1);
  const mios = await D.call('GET', '/yo/mensajes');
  check('la socia ve la respuesta con el nombre del coach', mios.body.length === 2 && mios.body[1].deCoach && mios.body[1].autor === 'Coach Ana', JSON.stringify(mios.body[1]));
  check('…y ya no tiene sin leer', (await D.call('GET', '/yo/mensajes/sin-leer')).body.n === 0);
  check('otra socia no ve esa conversación', (await L.call('GET', '/yo/mensajes')).body.length === 0);
  check('el coach no escribe a alguien de otra sede', (await C.call('POST', `/coach/${SEDE}/socios/00000000-0000-0000-0000-000000000000/mensajes`, { texto: 'hola' })).status >= 400);
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
