// Prueba de punta a punta de la fase 1 contra Supabase. Se ejecuta desde backend/.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const SB = process.env.SUPABASE_URL, PUB = process.env.SUPABASE_PUBLISHABLE_KEY, SECRET = process.env.SUPABASE_SECRET_KEY;
const API = 'http://localhost:3000';
for (let i = 0; i < 40; i++) { try { await fetch(API); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'OK ' : 'FALLA'}  ${name}${extra !== '' ? '  → ' + extra : ''}`); };
const admin = (path, init = {}) => fetch(`${SB}/auth/v1${path}`, { ...init, headers: { apikey: SECRET, 'Content-Type': 'application/json' } });

const b64url = (b) => Buffer.from(b).toString('base64url');
const sha = async (t) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const jwk = async (k) => { const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', k.publicKey); return { kty, crv, x, y }; };

/** Una "persona" con su sesión de Supabase y su dispositivo firmado. */
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
const nuevaCuenta = async (email, meta = {}) => {
  const u = await (await admin('/admin/users', { method: 'POST', body: JSON.stringify({ email, password: 'Fuerte-1234', email_confirm: true, user_metadata: meta }) })).json();
  return u.id;
};

const T = Date.now();
const creados = [];
try {
  // ---------- Admin ----------
  const adminEmail = `admin.${T}@ejemplo.com`;
  creados.push(await nuevaCuenta(adminEmail, { full_name: 'Dueña Prueba' }));
  await persona(adminEmail, 'Fuerte-1234'); // crea el perfil
  execSync(`npm run rol -- ${adminEmail} admin`, { cwd: new URL('../..', import.meta.url), stdio: 'pipe' });
  const A = await persona(adminEmail, 'Fuerte-1234');
  check('admin entra con rol admin', A.yo.roles?.some((r) => r.rol === 'admin'));

  const sed = await A.call('PATCH', '/sedes/dolores', { diasSinServicio: [0], antipassbackMin: 5 });
  check('editar sede (domingo sin servicio, anti-passback 5)', sed.status === 200 && sed.body.diasSinServicio === '0', sed.body.diasSinServicio);
  const dia = await A.call('POST', '/sedes/dolores/dias-cerrados', { fecha: '2026-12-25', motivo: 'Navidad' });
  check('agregar día cerrado', dia.status === 201, dia.status);
  const mes = await A.call('POST', '/sedes/dolores/planes', { nombre: 'Mes', tipo: 'mes', duracionDias: 30, precio: 45000 });
  const visita = await A.call('POST', '/sedes/dolores/planes', { nombre: 'Visita', tipo: 'visita', duracionDias: 1, precio: 6000 });
  const est = await A.call('POST', '/sedes/dolores/planes', { nombre: 'Convenio prepa', tipo: 'especial', duracionDias: 30, precio: 35000, requiereValidacion: true, pagoEnLinea: false });
  check('crear 3 planes', [mes, visita, est].every((p) => p.status === 201), [mes, visita, est].map((p) => p.status).join(','));
  const rec = await A.call('POST', '/sedes/dolores/recepcionistas', { nombre: 'Ana López', pin: '1234' });
  check('crear recepcionista con PIN', rec.status === 201 && !('pinHash' in rec.body));
  const cuenta = await A.call('POST', '/sedes/dolores/cuenta-recepcion');
  check('generar cuenta de recepción', cuenta.status === 200 && cuenta.body.usuario === 'dolores@recepcion', cuenta.body.usuario);

  // ---------- Recepción ----------
  const R = await persona('dolores@recepcion.spartacus.app', cuenta.body.contrasena);
  creados.push(R.userId);
  check('recepción entra con su cuenta y rol', R.yo.roles?.some((r) => r.rol === 'recepcion' && r.sedeId === 'dolores'));
  const sinTurno = await R.call('POST', '/recepcion/dolores/socios', { nombre: 'Xochitl Prueba', email: `x.${T}@ejemplo.com` });
  check('sin turno no se puede operar', sinTurno.status === 400 && /turno/.test(sinTurno.body.message), sinTurno.body.message);
  const pinMal = await R.call('POST', '/recepcion/dolores/turno/abrir', { recepcionistaId: rec.body.id, pin: '9999', efectivoInicial: 50000 });
  check('PIN incorrecto → 403', pinMal.status === 403, pinMal.body.message);
  const turno = await R.call('POST', '/recepcion/dolores/turno/abrir', { recepcionistaId: rec.body.id, pin: '1234', efectivoInicial: 50000 });
  check('abrir turno con PIN', turno.status === 201);
  const otroTurno = await R.call('POST', '/recepcion/dolores/turno/abrir', { recepcionistaId: rec.body.id, pin: '1234', efectivoInicial: 0 });
  check('no puede haber dos turnos abiertos', otroTurno.status === 409);

  // ---------- Socio (registro en línea) ----------
  const socioEmail = `socio.${T}@ejemplo.com`;
  creados.push(await nuevaCuenta(socioEmail, { full_name: 'Luis Socio', ubicacion: { lat: 21.16, lng: -100.93 } }));
  const S = await persona(socioEmail, 'Fuerte-1234');
  check('socio con sede Dolores', S.yo.sede?.id === 'dolores');
  check('socio NO puede ver recepción', (await S.call('GET', '/recepcion/dolores/estado')).status === 403);
  check('socio NO puede crear planes', (await S.call('POST', '/sedes/dolores/planes', { nombre: 'Hack', tipo: 'mes', duracionDias: 30, precio: 1 })).status === 403);
  const tarjeta = await S.call('POST', '/yo/solicitudes', { planId: mes.body.id, metodo: 'tarjeta' });
  check('solicitud con tarjeta: aún no disponible', tarjeta.status === 400, tarjeta.body.message);
  const sol = await S.call('POST', '/yo/solicitudes', { planId: mes.body.id, metodo: 'mostrador' });
  check('solicitud "pagar en el gym"', sol.status === 201 && sol.body.estado === 'pendiente_pago', new Date(sol.body.venceEn).toISOString());
  check('no se duplica la solicitud', (await S.call('POST', '/yo/solicitudes', { planId: mes.body.id, metodo: 'mostrador' })).status === 409);

  // ---------- Recepción: cobro, asistencia ----------
  const lista = await R.call('GET', '/recepcion/dolores/solicitudes');
  check('recepción ve la solicitud pendiente', lista.body.some?.((s) => s.id === sol.body.id && s.estado === 'pendiente_pago'));
  const sinMem = await R.call('POST', '/recepcion/dolores/asistencias', { perfilId: S.yo.id });
  check('entrada sin membresía → rechazada', sinMem.body.resultado === 'rechazada_sin_membresia');
  const cobro = await R.call('POST', '/recepcion/dolores/cobros', { perfilId: S.yo.id, planId: mes.body.id, metodo: 'efectivo', solicitudId: sol.body.id });
  check('cobrar solicitud en efectivo', cobro.status === 201 && cobro.body.total === 45000, `${cobro.body.inicio} → ${cobro.body.fin}`);
  const mem = await S.call('GET', '/yo/membresia');
  check('socio ve su membresía vigente y la solicitud completada', mem.body.vigente?.plan === 'Mes' && mem.body.solicitudes?.[0]?.estado === 'completada');
  const ent = await R.call('POST', '/recepcion/dolores/asistencias', { perfilId: S.yo.id });
  check('entrada con membresía → permitida', ent.body.resultado === 'permitida');
  const pb = await R.call('POST', '/recepcion/dolores/asistencias', { perfilId: S.yo.id });
  check('volver a entrar en < 5 min → anti-passback', pb.body.resultado === 'rechazada_passback');
  const sinCred = await R.call('POST', '/recepcion/dolores/cobros', { perfilId: S.yo.id, planId: est.body.id, metodo: 'terminal' });
  check('plan especial sin credencial → 400', sinCred.status === 400, sinCred.body.message);
  const conCred = await R.call('POST', '/recepcion/dolores/cobros', { perfilId: S.yo.id, planId: est.body.id, metodo: 'terminal', credencialValidada: true });
  check('renovar: empieza al día siguiente del fin anterior', conCred.status === 201 && conCred.body.inicio > cobro.body.fin, `${conCred.body.inicio} → ${conCred.body.fin}`);
  check('la gracia evita terminar en domingo', new Date(`${conCred.body.fin}T12:00:00Z`).getUTCDay() !== 0 && new Date(`${cobro.body.fin}T12:00:00Z`).getUTCDay() !== 0);

  const altaEmail = `mostrador.${T}@ejemplo.com`;
  const alta = await R.call('POST', '/recepcion/dolores/socios', { nombre: 'Carla Mostrador', email: altaEmail, fechaNacimiento: '2000-01-15' });
  check('alta de socio en mostrador', alta.status === 201, `correoEnviado=${alta.body.correoEnviado}`);
  if (alta.body.id) {
    const busq = await R.call('GET', `/recepcion/dolores/socios?q=${encodeURIComponent('Carla')}`);
    check('buscar socio por nombre', busq.body.some?.((p) => p.id === alta.body.id));
    const u = await (await admin(`/admin/users?per_page=200`)).json();
    const nuevo = u.users?.find((x) => x.email === altaEmail);
    if (nuevo) creados.push(nuevo.id);
    const visitaCobro = await R.call('POST', '/recepcion/dolores/cobros', { perfilId: alta.body.id, planId: visita.body.id, metodo: 'terminal' });
    check('cobrar visita con terminal', visitaCobro.status === 201 && visitaCobro.body.inicio === visitaCobro.body.fin);
  }
  check('recepción de Dolores NO opera San Luis', (await R.call('GET', '/recepcion/san-luis/estado')).status === 403);
  check('recepción NO crea planes', (await R.call('POST', '/sedes/dolores/planes', { nombre: 'X', tipo: 'mes', duracionDias: 30, precio: 1 })).status === 403);

  // ---------- Corte ----------
  const estado = await R.call('GET', '/recepcion/dolores/estado');
  check('estado del turno con totales', estado.body.turno?.efectivo === 45000 && estado.body.turno?.terminal === 41000, `efectivo ${estado.body.turno?.efectivo} terminal ${estado.body.turno?.terminal}`);
  check('cerrar turno con PIN incorrecto → 403', (await R.call('POST', '/recepcion/dolores/turno/cerrar', { pin: '0000', efectivoContado: 0 })).status === 403);
  const corte = await R.call('POST', '/recepcion/dolores/turno/cerrar', { pin: '1234', efectivoContado: 94000, notas: 'faltaron 10 pesos' });
  check('corte: esperado = inicial + efectivo, diferencia', corte.status === 200 && corte.body.efectivoEsperado === 95000 && corte.body.diferencia === -1000, `esperado ${corte.body.efectivoEsperado}, contado ${corte.body.efectivoContado}, dif ${corte.body.diferencia}`);

  const bit = await A.call('GET', '/sedes/dolores/bitacora');
  const acciones = new Set(bit.body.map?.((b) => b.accion));
  check('bitácora registra todo', ['turno.abrir', 'cobro.membresia', 'socio.alta', 'turno.cerrar', 'plan.crear', 'asistencia.rechazada_passback'].every((a) => acciones.has(a)), [...acciones].join(', '));
  check('recepción NO ve la bitácora', (await R.call('GET', '/sedes/dolores/bitacora')).status === 403);
} catch (e) {
  fail++;
  console.log('ERROR', e.message);
} finally {
  for (const id of creados) await admin(`/admin/users/${id}`, { method: 'DELETE' });
  console.log(`\nlimpieza: ${creados.length} cuentas de prueba borradas`);
  console.log(`${pass} OK, ${fail} fallas`);
}
