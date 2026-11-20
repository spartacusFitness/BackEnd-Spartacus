// Autoverificación del generador de rutinas con el catálogo base (sin BD): node test/rutinas.check.mjs (tras npm run build)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { generarRutina } = await import('../dist/gym/rutinas.js');
const { rutinaSchema } = await import('../dist/gym/coach.schemas.js');

// Catálogo base: las filas de EJERCICIOS en el script de seed.
const src = readFileSync(new URL('../src/scripts/seed-catalogo.ts', import.meta.url), 'utf8');
const bloque = src.slice(src.indexOf('const EJERCICIOS'), src.indexOf('];', src.indexOf('const EJERCICIOS')));
const catalogo = [...bloque.matchAll(/\['([^']+)', '([a-z_]+)', '([a-z_]+)', (?:'[^']*'|null), \d+, '([^']+)'/g)].map((m, i) => ({ id: i + 1, nombre: m[1], categoria: m[2], equipo: m[3], repeticiones: m[4] }));
assert.ok(catalogo.length > 60, `catálogo leído: ${catalogo.length}`);
const nombre = new Map(catalogo.map((e) => [e.id, e.nombre]));

const casos = [
  { objetivo: 'volumen', edad: 25, visitasSemana: 4, condiciones: null },
  { objetivo: 'fuerza', edad: 30, visitasSemana: 3, condiciones: null },
  { objetivo: 'deficit', edad: 40, visitasSemana: 0, condiciones: 'Lesión de rodilla izquierda' },
  { objetivo: 'recomposicion', edad: 35, visitasSemana: 5, condiciones: 'hernia lumbar' },
  { objetivo: null, edad: 68, visitasSemana: 2, condiciones: 'hipertensión' },
  { objetivo: 'condicion', edad: 22, visitasSemana: 6, condiciones: null, dias: 6 },
  { objetivo: 'volumen', edad: 28, visitasSemana: 1, condiciones: null, dias: 2 },
];
for (const c of casos) {
  const g = generarRutina(c, catalogo);
  const ok = rutinaSchema.safeParse(g.rutina);
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));
  assert.equal(g.rutina.dias.length, c.dias ?? Math.min(5, Math.max(3, Math.round(c.visitasSemana) || 3)));
  for (const d of g.rutina.dias) {
    const ids = d.ejercicios.map((e) => e.ejercicioId);
    assert.equal(new Set(ids).size, ids.length, 'sin repetir en el día');
    if (/rodilla/.test(c.condiciones ?? '')) assert.ok(!ids.some((i) => /sentadilla libre|zancada|desplante|b[uú]lgara|burpee/i.test(nombre.get(i))), 'rodilla');
    if (/lumbar/.test(c.condiciones ?? '')) assert.ok(!ids.some((i) => /peso muerto|buenos d/i.test(nombre.get(i))), 'lumbar');
    if (/hipertensi/.test(c.condiciones ?? '')) assert.ok(!d.ejercicios.some((e) => /al fallo/i.test(e.repeticiones)), 'nada al fallo');
  }
  console.log(`OK ${g.rutina.nombre}: ${g.rutina.dias.map((d) => `${d.notas} (${d.ejercicios.length})`).join(', ')}`);
}
const ej = generarRutina(casos[0], catalogo).rutina.dias[0];
console.log('\nEjemplo, ' + ej.notas + ':\n' + ej.ejercicios.map((e) => `  ${nombre.get(e.ejercicioId)} — ${e.series}×${e.repeticiones}, ${e.descansoSeg ?? '-'} s`).join('\n'));
