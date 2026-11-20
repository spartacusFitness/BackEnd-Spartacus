// Autoverificación de logros y rachas (sin BD): node test/logros.check.mjs (tras npm run build)
import assert from 'node:assert/strict';
const { mejorRacha, mejorSemana, calcularLogros, nombrePublico } = await import('../dist/gym/logros.js');
const cal = { abierto: (d) => d !== '2026-11-17' }; // martes 17 cerrado (festivo)
// lun 9, mar 10, mié 11, jue 12, vie 13, (sáb/dom), lun 16, (mar 17 cerrado), mié 18 → racha 7 sin romperse
const dias = new Set(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-18']);
assert.equal(mejorRacha(dias, cal), 7);
assert.equal(mejorRacha(new Set(['2026-11-09', '2026-11-11']), cal), 1, 'faltar el martes 10 rompe la racha');
assert.equal(mejorSemana(dias), 5);
const l = calcularLogros({ dias, cal, objetivo: 'deficit', pesoInicial: 80, pesoActual: 77.5, retosCumplidos: 0 });
const de = (k) => l.find((x) => x.clave === k);
assert.equal(de('primera').obtenido, true);
assert.equal(de('racha5').obtenido, true);
assert.equal(de('racha10').obtenido, false);
assert.equal(de('semana5').obtenido, true);
assert.equal(de('peso2').obtenido, true);
assert.equal(de('peso5').actual, 2.5);
assert.equal(de('reto').obtenido, false);
assert.ok(!calcularLogros({ dias, cal, objetivo: 'salud', pesoInicial: 80, pesoActual: 70, retosCumplidos: 0 }).some((x) => x.clave === 'peso2'), 'peso solo para déficit/volumen');
assert.equal(nombrePublico(null, 'Daniela Ramírez López'), 'Daniela R.');
assert.equal(nombrePublico('dani.fit', 'Daniela'), 'dani.fit');
console.log('ok: logros y rachas');
