// Prueba de punta a punta de la fase 0 (Supabase Auth + backend firmado + Storage + RLS).
// Uso (backend corriendo en :3000): node test/e2e/fase0.mjs   — crea cuentas de prueba en Supabase y las borra al final.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const SB = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const API = 'http://localhost:3000';
for (let i = 0; i < 40; i++) { try { await fetch(API); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'OK ' : 'FALLA'}  ${name}${extra ? '  → ' + extra : ''}`); };
const admin = (path, init = {}) => fetch(`${SB}/auth/v1${path}`, { ...init, headers: { apikey: SECRET, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

// --- llaves y firma (igual que el navegador) ---
const b64url = (b) => Buffer.from(b).toString('base64url');
const sha = async (t) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const newKeys = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
const jwk = async (k) => { const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', k.publicKey); return { kty, crv, x, y }; };
async function call(keys, method, path, body, bearer, { sign = true } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const headers = {};
  if (payload) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (sign) {
    const ts = String(Date.now()), nonce = crypto.randomUUID();
    const canon = [method, path, ts, nonce, await sha(payload)].join('\n');
    headers['X-Signature-Timestamp'] = ts; headers['X-Signature-Nonce'] = nonce;
    headers['X-Signature'] = b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(canon)));
  }
  const r = await fetch(API + path, { method, headers, body: payload || undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}

const email = `fase0.${Date.now()}@ejemplo.com`;
const password = 'Fuerte-1234';
let userId;
try {
  // 1) Cuenta confirmada creada por admin, con la ubicación en San Luis de la Paz.
  const created = await (await admin('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'Fase Cero', ubicacion: { lat: 21.29, lng: -100.51 } } }),
  })).json();
  userId = created.id;
  check('crear cuenta en Supabase Auth (admin)', !!userId);

  // 2) Iniciar sesión como lo hace el navegador.
  const sb = createClient(SB, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: login, error: loginErr } = await sb.auth.signInWithPassword({ email, password });
  check('signInWithPassword con supabase-js', !loginErr && !!login.session, loginErr?.message);
  const token = login.session.access_token;

  // 3) Registrar dispositivo (crea perfil + sede + rol socio).
  const keys = await newKeys();
  const dev = await call(keys, 'POST', '/auth/dispositivo', { publicKey: await jwk(keys), remember: true }, token);
  check('registrar dispositivo → perfil creado', dev.status === 200 && dev.body.email === email, `${dev.status} ${JSON.stringify(dev.body).slice(0, 80)}`);
  check('sede asignada por cercanía (San Luis)', dev.body.sede?.id === 'san-luis', dev.body.sede?.id);
  check('rol socio en su sede', dev.body.roles?.some((r) => r.rol === 'socio' && r.sedeId === 'san-luis'));
  const again = await call(keys, 'POST', '/auth/dispositivo', { publicKey: await jwk(keys), remember: true }, token);
  check('registrar de nuevo es idempotente', again.status === 200);
  const other = await newKeys();
  const hijack = await call(other, 'POST', '/auth/dispositivo', { publicKey: await jwk(other), remember: true }, token);
  check('mismo JWT con otra llave → 401', hijack.status === 401, hijack.body.code);

  // 4) Rutas protegidas.
  check('GET /auth/me firmado', (await call(keys, 'GET', '/auth/me', undefined, token)).status === 200);
  const unsigned = await call(keys, 'GET', '/auth/me', undefined, token, { sign: false });
  check('sin firma → 401', unsigned.status === 401, unsigned.body.code);
  const stolen = await call(other, 'GET', '/auth/me', undefined, token);
  check('JWT robado firmado con otra llave → 401', stolen.status === 401, stolen.body.code);
  const fake = await call(keys, 'GET', '/auth/me', undefined, token.slice(0, -4) + 'AAAA');
  check('JWT alterado → 401', fake.status === 401, fake.body.code);

  const upd = await call(keys, 'PATCH', '/auth/me', { apodo: 'fase_cero', fechaNacimiento: '1995-04-20' }, token);
  check('actualizar perfil', upd.status === 200 && upd.body.apodo === 'fase_cero' && upd.body.fechaNacimiento === '1995-04-20');
  const sede = await call(keys, 'PATCH', '/auth/me/sede', { location: { lat: 21.16, lng: -100.93 } }, token);
  check('re-detectar sede → Dolores', sede.status === 200 && sede.body.sede?.id === 'dolores');

  // 5) Storage con RLS.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const path = `${userId}/foto-test.png`;
  const up = await sb.storage.from('avatars').upload(path, png, { contentType: 'image/png' });
  check('subir foto a SU carpeta', !up.error, up.error?.message);
  const foreign = await sb.storage.from('avatars').upload(`00000000-0000-0000-0000-000000000000/x.png`, png, { contentType: 'image/png' });
  check('subir a carpeta AJENA → rechazado por RLS', !!foreign.error, foreign.error?.message);
  const foto = await call(keys, 'PATCH', '/auth/me/foto', { path }, token);
  check('guardar foto en perfil', foto.status === 200 && foto.body.fotoUrl?.endsWith(path));
  const fotoAjena = await call(keys, 'PATCH', '/auth/me/foto', { path: `00000000-0000-0000-0000-000000000000/x.png` }, token);
  check('guardar foto de otra persona → 400', fotoAjena.status === 400);

  // 6) API pública de Supabase: nuestras tablas NO deben ser accesibles.
  const rest = await fetch(`${SB}/rest/v1/Perfil?select=*`, { headers: { apikey: PUB, Authorization: `Bearer ${token}` } });
  check('Data API: tabla Perfil no accesible con la llave pública', rest.status >= 400, String(rest.status));

  // 7) Rol de admin con el script.
  execSync(`npm run rol -- ${email} admin`, { cwd: new URL('../..', import.meta.url), stdio: 'pipe' });
  const me = await call(keys, 'GET', '/auth/me', undefined, token);
  check('asignar rol admin (script)', me.body.roles?.some((r) => r.rol === 'admin' && r.sedeId === null));

  // 8) Cerrar sesión: el JWT sigue "vigente" pero el dispositivo ya no sirve.
  check('logout', (await call(keys, 'POST', '/auth/logout', undefined, token)).status === 204);
  const after = await call(keys, 'GET', '/auth/me', undefined, token);
  check('después de logout → 401', after.status === 401, after.body.code);
} finally {
  if (userId) {
    await fetch(`${SB}/storage/v1/object/avatars`, { method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [`${userId}/foto-test.png`] }) });
    const del = await admin(`/admin/users/${userId}`, { method: 'DELETE' });
    console.log(`\nlimpieza: usuario de prueba borrado (HTTP ${del.status})`);
  }
  console.log(`${pass} OK, ${fail} fallas`);
}
