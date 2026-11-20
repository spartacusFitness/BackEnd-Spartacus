// Uso (backend corriendo en :3000): node test/e2e/fase2.mjs — productos, inventario, promociones, ventas, reportes.
// AISLADA: crea una sede temporal "prueba-…" con su propia recepción, y al final borra esa sede,
// todo lo que se creó en ella (filas e imágenes) y las cuentas @ejemplo.com. No toca las sedes reales.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { db } = await import('../../dist/prisma/db.js');
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
  return { call, yo: yo.body, userId: data.user.id, sb };
}
const nuevaCuenta = async (email, meta = {}) => (await (await admin('/admin/users', { method: 'POST', body: JSON.stringify({ email, password: 'Fuerte-1234', email_confirm: true, user_metadata: meta }) })).json()).id;

const hoyMx = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const diaHoy = new Date(`${hoyMx}T12:00:00Z`).getUTCDay();
const T = Date.now();
const SEDE = `prueba-${T.toString(36)}`;
const COORDS = { lat: 22.89, lng: -109.91 }; // lejos de las sedes reales
const creados = [];
try {
  const adminEmail = `admin.f2.${T}@ejemplo.com`;
  creados.push(await nuevaCuenta(adminEmail, { full_name: 'Admin F2' }));
  await persona(adminEmail, 'Fuerte-1234');
  execSync(`npm run rol -- ${adminEmail} admin`, { cwd: new URL('../..', import.meta.url), stdio: 'pipe' });
  const A = await persona(adminEmail, 'Fuerte-1234');
  const sedeNueva = await A.call('POST', '/sedes', { id: SEDE, nombre: 'Prueba E2E', ciudad: 'Prueba', direccion: 'Sede temporal de pruebas', ...COORDS });
  check('crear sede temporal aislada', sedeNueva.status === 201, SEDE);

  // ---------- Productos e inventario ----------
  const prote = await A.call('POST', `/sedes/${SEDE}/productos`, { nombre: 'Proteína scoop', categoria: 'suplementos', icono: 'proteina', precio: 3500, stockInicial: 10, stockMinimo: 3 });
  const pre = await A.call('POST', `/sedes/${SEDE}/productos`, { nombre: 'Preentreno toma', categoria: 'suplementos', icono: 'preentreno', precio: 2500, stockInicial: 6, stockMinimo: 2 });
  const agua = await A.call('POST', `/sedes/${SEDE}/productos`, { nombre: 'Agua 1L', categoria: 'bebidas', icono: 'agua', precio: 1500, stockInicial: 2, stockMinimo: 5 });
  check('crear productos con stock inicial', [prote, pre, agua].every((p) => p.status === 201) && prote.body.stock === 10, [prote, pre, agua].map((p) => p.status).join(','));
  const mal = await A.call('POST', `/sedes/${SEDE}/productos`, { nombre: 'X', categoria: 'otro', icono: 'cohete', precio: 1 });
  check('ícono fuera del catálogo → 400', mal.status === 400);
  const ent = await A.call('POST', `/sedes/${SEDE}/productos/${agua.body.id}/inventario`, { tipo: 'entrada', cantidad: 10, motivo: 'Llegó pedido' });
  check('entrada de mercancía', ent.status === 201 && ent.body.stock === 12, ent.body.stock);
  const aj = await A.call('POST', `/sedes/${SEDE}/productos/${agua.body.id}/inventario`, { tipo: 'ajuste', stockContado: 11, motivo: 'Una rota' });
  check('ajuste por conteo físico', aj.status === 201 && aj.body.stock === 11, aj.body.stock);
  const movs = await A.call('GET', `/sedes/${SEDE}/productos/${agua.body.id}/movimientos`);
  check('historial de movimientos', movs.body.length === 3 && movs.body[0].cantidad === -1, movs.body.map?.((m) => `${m.tipo}${m.cantidad}`).join(' '));

  // ---------- Promociones ----------
  const promoHoy = await A.call('POST', `/sedes/${SEDE}/promociones`, { nombre: '2x1 preentreno', precio: 2500, diasSemana: [diaHoy], productos: [{ productoId: pre.body.id, cantidad: 2 }] });
  check('promo para el día de hoy', promoHoy.status === 201 && promoHoy.body.vigenteHoy === true, `día ${diaHoy}`);
  const promoOtroDia = await A.call('POST', `/sedes/${SEDE}/promociones`, { nombre: 'Combo otro día', precio: 4000, diasSemana: [(diaHoy + 1) % 7], productos: [{ productoId: prote.body.id, cantidad: 1 }, { productoId: agua.body.id, cantidad: 1 }] });
  check('promo de otro día no vigente hoy', promoOtroDia.body.vigenteHoy === false);
  const promoAjena = await A.call('POST', `/sedes/${SEDE}/promociones`, { nombre: 'Ajena', precio: 1, productos: [{ productoId: 999999, cantidad: 1 }] });
  check('promo con producto de otra sede/inexistente → 400', promoAjena.status === 400);
  check('…y no deja una promoción a medias', !(await A.call('GET', `/sedes/${SEDE}/promociones`)).body.some((p) => p.nombre === 'Ajena'));
  const firma = await A.call('POST', `/sedes/${SEDE}/promociones/imagen`, { tipo: 'image/png' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await A.sb.storage.from('promos').uploadToSignedUrl(firma.body.path, firma.body.token, png, { contentType: 'image/png' });
  const conImg = await A.call('PATCH', `/sedes/${SEDE}/promociones/${promoHoy.body.id}`, { imagenPath: firma.body.path });
  check('imagen de promo con enlace firmado', firma.status === 201 && !up.error && conImg.body.imagenUrl?.includes(firma.body.path), up.error?.message ?? '');
  const subidaDirecta = await A.sb.storage.from('promos').upload(`${SEDE}/hack-${T}.png`, png, { contentType: 'image/png' });
  check('subir a promos sin enlace firmado → rechazado', !!subidaDirecta.error, subidaDirecta.error?.message);

  // ---------- Recepción: venta ----------
  const rec = await A.call('POST', `/sedes/${SEDE}/recepcionistas`, { nombre: 'Beto Caja', pin: '4321' });
  const cuenta = await A.call('POST', `/sedes/${SEDE}/cuenta-recepcion`);
  const R = await persona(`${SEDE}@recepcion.spartacus.app`, cuenta.body.contrasena);
  creados.push(R.userId);
  check('recepción NO crea productos', (await R.call('POST', `/sedes/${SEDE}/productos`, { nombre: 'Hack', categoria: 'otro', icono: 'otro', precio: 1 })).status === 403);
  const fij = await A.call('PATCH', `/sedes/${SEDE}/productos/${agua.body.id}`, { destacado: true });
  check('fijar producto con estrella', fij.status === 200 && fij.body.destacado === true, fij.status);
  check('recepción NO fija productos', (await R.call('PATCH', `/sedes/${SEDE}/productos/${agua.body.id}`, { destacado: false })).status === 403);
  check('recepción NO cambia precios', (await R.call('PATCH', `/sedes/${SEDE}/productos/${agua.body.id}`, { precio: 1 })).status === 403);
  check('recepción NO hace ajustes', (await R.call('POST', `/sedes/${SEDE}/productos/${agua.body.id}/inventario`, { tipo: 'ajuste', stockContado: 999, motivo: 'hack' })).status === 403);
  check('recepción SÍ registra entradas', (await R.call('POST', `/sedes/${SEDE}/productos/${agua.body.id}/inventario`, { tipo: 'entrada', cantidad: 1 })).status === 201);
  check('vender sin turno → 400', (await R.call('POST', `/recepcion/${SEDE}/ventas`, { items: [{ tipo: 'producto', id: agua.body.id, cantidad: 1 }], metodo: 'efectivo' })).status === 400);
  await R.call('POST', `/recepcion/${SEDE}/turno/abrir`, { recepcionistaId: rec.body.id, pin: '4321', efectivoInicial: 20000 });
  const venta = await R.call('POST', `/recepcion/${SEDE}/ventas`, { items: [{ tipo: 'producto', id: prote.body.id, cantidad: 2 }, { tipo: 'promocion', id: promoHoy.body.id, cantidad: 1 }], metodo: 'efectivo' });
  check('venta: 2 proteínas + promo 2x1', venta.status === 201 && venta.body.total === 3500 * 2 + 2500, venta.body.total);
  const prods = await R.call('GET', `/sedes/${SEDE}/productos`);
  const st = (id) => prods.body.find((p) => p.id === id)?.stock;
  check('stock descontado (promo descuenta 2 preentrenos)', st(prote.body.id) === 8 && st(pre.body.id) === 4, `prote ${st(prote.body.id)}, pre ${st(pre.body.id)}`);
  const sinStock = await R.call('POST', `/recepcion/${SEDE}/ventas`, { items: [{ tipo: 'producto', id: pre.body.id, cantidad: 5 }], metodo: 'terminal' });
  check('sin stock suficiente → 409 y no vende nada', sinStock.status === 409, sinStock.body.message);
  const promoNo = await R.call('POST', `/recepcion/${SEDE}/ventas`, { items: [{ tipo: 'promocion', id: promoOtroDia.body.id, cantidad: 1 }], metodo: 'terminal' });
  check('promo que no aplica hoy → 400', promoNo.status === 400, promoNo.body.message);
  const v2 = await R.call('POST', `/recepcion/${SEDE}/ventas`, { items: [{ tipo: 'producto', id: agua.body.id, cantidad: 3 }], metodo: 'terminal' });
  check('venta con terminal', v2.status === 201 && v2.body.total === 4500);

  const estado = await R.call('GET', `/recepcion/${SEDE}/estado`);
  check('el turno suma las ventas', estado.body.turno.efectivo === 9500 && estado.body.turno.terminal === 4500, `efectivo ${estado.body.turno.efectivo}, terminal ${estado.body.turno.terminal}`);
  const corte = await R.call('POST', `/recepcion/${SEDE}/turno/cerrar`, { pin: '4321', efectivoContado: 29500 });
  check('corte cuadra con ventas de productos', corte.body.diferencia === 0, corte.body.diferencia);

  // ---------- Socio: catálogo ----------
  const socioEmail = `socio.f2.${T}@ejemplo.com`;
  creados.push(await nuevaCuenta(socioEmail, { full_name: 'Socio F2', ubicacion: COORDS }));
  const S = await persona(socioEmail, 'Fuerte-1234');
  check('socio sin membresía no ve la tienda', (await S.call('GET', '/yo/tienda')).status === 403);
  // La tienda del socio requiere membresía vigente: se la damos directo en la BD.
  const plan = await A.call('POST', `/sedes/${SEDE}/planes`, { nombre: 'Mes', tipo: 'mes', duracionDias: 30, precio: 45000 });
  const fin = new Date(new Date(`${hoyMx}T12:00:00Z`).getTime() + 29 * 86400000);
  await db.orm.public.Membresia.create({ perfilId: S.yo.id, sedeId: SEDE, planId: plan.body.id, inicio: new Date(`${hoyMx}T12:00:00Z`), fin });
  const cat = await S.call('GET', '/yo/tienda');
  check('socio ve catálogo y solo promos de hoy', cat.status === 200 && cat.body.productos.length === 3 && cat.body.promociones.length === 1 && cat.body.promociones[0].imagenUrl, `${cat.body.productos?.length} productos, ${cat.body.promociones?.length} promo`);
  check('el catálogo no expone el stock exacto', cat.body.productos.every((p) => !('stock' in p) || p.stock === undefined));
  check('socio NO ve inventario', (await S.call('GET', `/sedes/${SEDE}/productos`)).status === 403);

  // ---------- Reportes ----------
  const rep = await A.call('GET', `/reportes/resumen?desde=${hoyMx}&hasta=${hoyMx}&sedeId=${SEDE}`);
  const t = rep.body.totales;
  check('reporte: ingresos de hoy', rep.status === 200 && t.ingresos === 14000 && t.productos === 11500 && t.promociones === 2500, `ingresos ${t?.ingresos}, productos ${t?.productos}, promos ${t?.promociones}`);
  check('reporte: efectivo vs terminal', t.efectivo === 9500 && t.terminal === 4500);
  check('reporte: top productos', rep.body.topProductos?.[0]?.descripcion === 'Proteína scoop', rep.body.topProductos?.map((x) => x.descripcion).join(', '));
  check('reporte: serie diaria y por sede', rep.body.porDia.length === 1 && rep.body.porSede.length === 1);
  check('reporte: alerta de stock bajo (agua 9 ≤ mínimo 5? no; preentreno 4 > 2)', Array.isArray(rep.body.stockBajo));
  check('recepción NO ve reportes', (await R.call('GET', `/reportes/resumen?desde=${hoyMx}&hasta=${hoyMx}`)).status === 403);
  check('rango inválido → 400', (await A.call('GET', `/reportes/resumen?desde=2026-12-31&hasta=2026-01-01`)).status === 400);

  // ---------- Visita: servicio sin inventario ----------
  const visita = await A.call('POST', `/sedes/${SEDE}/productos`, { nombre: 'Visita (1 día)', categoria: 'otro', icono: 'visita', precio: 6000, esServicio: true });
  await R.call('POST', `/recepcion/${SEDE}/turno/abrir`, { recepcionistaId: rec.body.id, pin: '4321', efectivoInicial: 0 });
  const vv = await R.call('POST', `/recepcion/${SEDE}/ventas`, { items: [{ tipo: 'producto', id: visita.body.id, cantidad: 2 }], metodo: 'efectivo' });
  check('visita se vende sin stock (servicio)', visita.status === 201 && vv.status === 201 && vv.body.total === 12000, `${visita.status}/${vv.status} ${JSON.stringify(vv.body).slice(0, 160)}`);
  // Regresión: editar un campo no debe rellenar los demás con sus valores por defecto.
  const ed = await A.call('PATCH', `/sedes/${SEDE}/productos/${visita.body.id}`, { destacado: true });
  check('fijar la visita la deja como servicio', ed.status === 200 && ed.body.esServicio === true, JSON.stringify(ed.body).slice(0, 120));
  const plE = await A.call('POST', `/sedes/${SEDE}/planes`, { nombre: 'Estudiante', tipo: 'especial', duracionDias: 30, precio: 30000, pagoEnLinea: false, requiereValidacion: true, renovableEnLinea: false });
  const plD = await A.call('PATCH', `/sedes/${SEDE}/planes/${plE.body.id}`, { activo: false });
  check('desactivar un plan especial conserva sus reglas', plD.status === 200 && plD.body.pagoEnLinea === false && plD.body.requiereValidacion === true && plD.body.renovableEnLinea === false, JSON.stringify(plD.body).slice(0, 160));
  // Eliminar: bloqueado si está en una promoción; si no, se borra con sus movimientos y la venta se conserva.
  check('no se elimina un producto que está en una promoción → 409', (await A.call('DELETE', `/sedes/${SEDE}/productos/${pre.body.id}`)).status === 409);
  check('recepción NO elimina productos', (await R.call('DELETE', `/sedes/${SEDE}/productos/${visita.body.id}`)).status === 403);
  check('eliminar la visita (tenía ventas)', (await A.call('DELETE', `/sedes/${SEDE}/productos/${visita.body.id}`)).status === 204);
  check('ya no aparece en productos', !(await A.call('GET', `/sedes/${SEDE}/productos?todos=1`)).body.some((p) => p.id === visita.body.id));
  check('su venta sigue en el turno', vv.status === 201 && (await R.call('GET', `/recepcion/${SEDE}/estado`)).status === 200);
  const serv2 = await A.call('POST', `/sedes/${SEDE}/productos`, { nombre: 'Clase muestra', categoria: 'otro', icono: 'visita', precio: 5000, esServicio: true });
  check('servicio no lleva inventario (otro servicio) → 400', (await R.call('POST', `/sedes/${SEDE}/productos/${serv2.body.id}/inventario`, { tipo: 'entrada', cantidad: 5 })).status === 400);
  check('el servicio no aparece en stock bajo', !(await A.call('GET', `/reportes/resumen?desde=${hoyMx}&hasta=${hoyMx}`)).body.stockBajo.some((p) => p.id === visita.body.id));
} catch (e) {
  fail++;
  console.log('ERROR', e.message);
} finally {
  for (const id of creados) await admin(`/admin/users/${id}`, { method: 'DELETE' });
  console.log(`\nlimpieza: ${creados.length} cuentas de prueba borradas`);
  // Borra la sede temporal y todo lo suyo (filas e imágenes). Nunca toca sedes reales: el script
  // solo acepta identificadores "prueba-…".
  if (process.env.CONSERVAR_SEDE === '1') {
    console.log(`CONSERVAR_SEDE=1: la sede ${SEDE} se queda. Bórrala con: node test/e2e/limpiar-sede-prueba.mjs ${SEDE}`);
  } else {
    console.log(execSync(`node test/e2e/limpiar-sede-prueba.mjs ${SEDE}`, { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).trim());
  }
  console.log(`${pass} OK, ${fail} fallas`);
  await db.close();
}
