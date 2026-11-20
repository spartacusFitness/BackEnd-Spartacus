/**
 * Generador heurístico de rutinas (mientras llega la IA). Función pura: recibe el perfil del socio y el
 * catálogo activo de la sede y devuelve una semana completa que el coach revisa, cambia y acepta.
 *
 * Criterios (guías generales de entrenamiento de fuerza para población general):
 * - División según días por semana: cuerpo completo (2–3), torso/pierna (4), empuje/jalón/pierna (5–6).
 * - Básicos multiarticulares primero, accesorios después; cada grupo grande ~2 veces por semana.
 * - Series, repeticiones y descansos según el objetivo (fuerza, volumen, recomposición, déficit…).
 * - Principiantes, mayores de 55 y objetivo "salud": menos volumen y más máquinas guiadas.
 * - Datos de salud: se excluyen ejercicios de riesgo para la zona indicada (rodilla, espalda, hombro…).
 * - Variedad: no repite ejercicio en el mismo día y evita repetirlo en la semana si hay alternativas.
 */
import type { RutinaInput } from './coach.service.js';

export interface EjercicioCatalogo {
  id: number;
  nombre: string;
  categoria: string;
  equipo: string;
  repeticiones: string;
}

export interface DatosRutina {
  objetivo: string | null;
  edad: number | null;
  /** visitas por semana en las últimas 4 semanas */
  visitasSemana: number;
  condiciones: string | null;
  /** días que el coach quiere (2–6); si no, se calcula con sus visitas */
  dias?: number;
}

export interface RutinaGenerada {
  rutina: RutinaInput;
  /** por qué se eligió así (para que el coach lo revise) */
  razones: string[];
  /** razones que mencionan datos de salud (solo se muestran a coaches) */
  razonesSalud: string[];
}

type Tipo = 'C' | 'A';
type Slot = [categoria: string, tipo: Tipo];

const SESIONES: Record<string, { nombre: string; slots: Slot[] }> = {
  fullA: { nombre: 'Cuerpo completo A', slots: [['pierna', 'C'], ['pecho', 'C'], ['espalda', 'C'], ['hombro', 'C'], ['gluteo', 'C'], ['bicep', 'A'], ['abdomen', 'A']] },
  fullB: { nombre: 'Cuerpo completo B', slots: [['gluteo', 'C'], ['espalda', 'C'], ['pecho', 'C'], ['pierna', 'A'], ['hombro', 'A'], ['tricep', 'A'], ['abdomen', 'A']] },
  empuje: { nombre: 'Empuje', slots: [['pecho', 'C'], ['hombro', 'C'], ['pecho', 'C'], ['pecho', 'A'], ['hombro', 'A'], ['tricep', 'A'], ['tricep', 'A']] },
  jalon: { nombre: 'Jalón', slots: [['espalda', 'C'], ['espalda', 'C'], ['espalda', 'A'], ['hombro', 'A'], ['bicep', 'A'], ['bicep', 'A'], ['abdomen', 'A']] },
  pierna: { nombre: 'Pierna', slots: [['pierna', 'C'], ['gluteo', 'C'], ['pierna', 'C'], ['pierna', 'A'], ['pierna', 'A'], ['pantorrilla', 'A'], ['abdomen', 'A']] },
  torso: { nombre: 'Torso', slots: [['pecho', 'C'], ['espalda', 'C'], ['hombro', 'C'], ['espalda', 'C'], ['pecho', 'A'], ['bicep', 'A'], ['tricep', 'A']] },
  inferior: { nombre: 'Pierna y glúteo', slots: [['pierna', 'C'], ['gluteo', 'C'], ['pierna', 'C'], ['pierna', 'A'], ['pantorrilla', 'A'], ['abdomen', 'A']] },
};

const DIVISION: Record<number, { sesiones: string[]; dias: number[]; texto: string }> = {
  2: { sesiones: ['fullA', 'fullB'], dias: [1, 4], texto: 'cuerpo completo A/B' },
  3: { sesiones: ['fullA', 'fullB', 'fullA'], dias: [1, 3, 5], texto: 'cuerpo completo A/B/A' },
  4: { sesiones: ['torso', 'inferior', 'torso', 'inferior'], dias: [1, 2, 4, 5], texto: 'torso / pierna, dos veces' },
  5: { sesiones: ['empuje', 'jalon', 'pierna', 'torso', 'inferior'], dias: [1, 2, 3, 4, 5], texto: 'empuje / jalón / pierna + torso / pierna' },
  6: { sesiones: ['empuje', 'jalon', 'pierna', 'empuje', 'jalon', 'pierna'], dias: [1, 2, 3, 4, 5, 6], texto: 'empuje / jalón / pierna, dos veces' },
};

/** Dosis por objetivo: [series, repeticiones, descanso s] para básicos (C) y accesorios (A). */
const DOSIS: Record<string, { nombre: string; C: [number, string, number]; A: [number, string, number]; cardio?: string; texto: string }> = {
  fuerza: { nombre: 'Fuerza', C: [5, '4-6', 180], A: [3, '8-10', 90], texto: 'básicos pesados a 4-6 repeticiones con descansos largos' },
  volumen: { nombre: 'Volumen', C: [4, '6-10', 120], A: [3, '10-12', 75], texto: 'rango de hipertrofia (6-12 repeticiones) con buen volumen' },
  recomposicion: { nombre: 'Recomposición', C: [4, '8-10', 90], A: [3, '12-15', 60], cardio: '15 min', texto: 'hipertrofia con descansos medios y cardio corto' },
  deficit: { nombre: 'Definición', C: [3, '10-12', 60], A: [3, '12-15', 45], cardio: '20 min', texto: 'conservar músculo con descansos cortos y cardio al final' },
  condicion: { nombre: 'Condición', C: [3, '12-15', 45], A: [3, '15', 30], cardio: '20 min', texto: 'resistencia: más repeticiones, poco descanso y cardio' },
  salud: { nombre: 'Salud', C: [3, '10-12', 90], A: [2, '12-15', 60], cardio: '20 min', texto: 'intensidad moderada, técnica y cardio suave' },
};

const ISOLA_GRUPO = new Set(['bicep', 'tricep', 'antebrazo', 'pantorrilla', 'abdomen']);
const AISLA = /apertura|curl|extensi[oó]n|elevaci[oó]n|patada|cruce|pec ?deck|face ?pull|encogimiento|abducci|aducci|crunch|pull ?over|plancha|vuelos?|posterior en/i;
const COMPUESTO = /press|sentadilla|peso muerto|remo|dominad|jal[oó]n|zancada|desplante|hip thrust|empuje de cadera|puente|fondos|prensa|militar|arnold|swing|step|burpee|lagartija|hack|b[uú]lgara|buenos d[ií]as|thruster/i;
const esCompuesto = (e: EjercicioCatalogo) => !ISOLA_GRUPO.has(e.categoria) && !AISLA.test(e.nombre) && COMPUESTO.test(e.nombre);

/** Zonas de salud: palabras en "condiciones" → ejercicios que se evitan. */
const RIESGOS: { zona: RegExp; evita: RegExp; texto: string }[] = [
  { zona: /rodilla|menisco|ligamento|r[oó]tula/i, evita: /sentadilla (libre|con barra)|sentadilla$|zancada|desplante|salto|burpee|b[uú]lgara|step|pistol|thruster/i, texto: 'rodilla: sin sentadilla libre, zancadas ni saltos; se prefieren máquinas' },
  { zona: /espalda|lumbar|columna|hernia|ci[aá]tic/i, evita: /peso muerto|buenos d[ií]as|remo con barra|sentadilla (libre|con barra)|swing|good morning/i, texto: 'espalda: sin peso muerto, buenos días ni remo/sentadilla con barra' },
  { zona: /hombro|manguito|rotador/i, evita: /tras nuca|fondos|al ment[oó]n|militar con barra|press militar/i, texto: 'hombro: sin press tras nuca, fondos ni remo al mentón' },
  { zona: /mu[ñn]eca|t[uú]nel carpiano/i, evita: /curl con barra|press de banca|lagartija/i, texto: 'muñeca: sin barra recta ni lagartijas' },
];
const CARDIACO = /hipertensi|presi[oó]n alta|card[ií]ac|coraz[oó]n|arritmia/i;
const EMBARAZO = /embaraz/i;

export function generarRutina(datos: DatosRutina, catalogo: EjercicioCatalogo[]): RutinaGenerada {
  const razones: string[] = [];
  const razonesSalud: string[] = [];
  const obj = DOSIS[datos.objetivo ?? ''] ? datos.objetivo! : 'salud';
  const dosis = DOSIS[obj];
  const principiante = datos.visitasSemana < 1.5;
  const mayor = (datos.edad ?? 0) >= 55;
  const cond = datos.condiciones ?? '';
  const riesgos = RIESGOS.filter((r) => r.zona.test(cond));
  const cardiaco = CARDIACO.test(cond);
  const embarazo = EMBARAZO.test(cond);
  const suave = principiante || mayor || obj === 'salud' || cardiaco || embarazo;

  // Días: los que pide el coach o los que realmente viene (3 a 5 por defecto).
  const nDias = datos.dias ?? Math.min(5, Math.max(3, Math.round(datos.visitasSemana) || 3));
  const division = nDias === 3 && !principiante && !suave && obj !== 'fuerza' ? { sesiones: ['empuje', 'jalon', 'pierna'], dias: [1, 3, 5], texto: 'empuje / jalón / pierna' } : DIVISION[nDias];
  razones.push(`${dosis.nombre}: ${dosis.texto}.`);
  razones.push(`${nDias} días por semana${datos.dias ? '' : ` (según sus visitas: ${datos.visitasSemana.toFixed(1)} por semana)`}: ${division.texto}.`);
  if (principiante) razones.push('Nivel principiante: menos series, máquinas guiadas y técnica antes que peso.');
  if (mayor) razones.push('Mayor de 55: volumen moderado, repeticiones de 10 o más y máquinas guiadas.');

  const prohibido = (e: EjercicioCatalogo) => riesgos.some((r) => r.evita.test(e.nombre));
  if (riesgos.length) razonesSalud.push(...riesgos.map((r) => `Salud — ${r.texto}.`));
  if (cardiaco) razonesSalud.push('Salud — presión/corazón: nada al fallo, descansos de 90 s o más y cardio moderado.');
  if (embarazo) razonesSalud.push('Salud — embarazo: requiere visto bueno médico; intensidad baja y sin abdominales intensos.');

  const usos = new Map<number, number>();
  const faltan = new Set<string>();

  const puntaje = (e: EjercicioCatalogo, tipo: Tipo) => {
    const comp = esCompuesto(e);
    let p = (tipo === 'C') === comp ? 3 : -2;
    const eq = e.equipo;
    if (suave) p += { maquina: 2, polea: 1, mancuernas: 0.5, barra: -1 }[eq] ?? 0;
    else if (obj === 'fuerza') p += { barra: 2.5, mancuernas: 1 }[eq] ?? 0;
    else if (obj === 'deficit' || obj === 'condicion') p += { kettlebell: 1.5, mancuernas: 1, peso_corporal: 1, maquina: 1 }[eq] ?? 0;
    else p += (comp ? ({ barra: 1, mancuernas: 1, maquina: 0.5 } as Record<string, number>) : ({ polea: 1, maquina: 1, mancuernas: 0.5 } as Record<string, number>))[eq] ?? 0;
    if (riesgos.some((r) => /rodilla/.test(r.texto)) && e.categoria === 'pierna' && eq === 'maquina') p += 1;
    if ((cardiaco || embarazo) && /al fallo/i.test(e.repeticiones)) p -= 2;
    p -= 3 * (usos.get(e.id) ?? 0);
    return p;
  };

  const elegir = (categoria: string, tipo: Tipo, hoy: Set<number>) => {
    const candidatos = catalogo.filter((e) => e.categoria === categoria && !hoy.has(e.id) && !prohibido(e));
    if (!candidatos.length) {
      faltan.add(categoria);
      return null;
    }
    return candidatos.reduce((mejor, e) => (puntaje(e, tipo) > puntaje(mejor, tipo) || (puntaje(e, tipo) === puntaje(mejor, tipo) && e.id < mejor.id) ? e : mejor));
  };

  const maxSlots = suave ? 5 : obj === 'deficit' || obj === 'condicion' ? 6 : 7;
  const dosisDe = (e: EjercicioCatalogo, tipo: Tipo) => {
    let [series, reps, descanso] = dosis[tipo];
    if (principiante || mayor) series = Math.min(series, 3);
    if (mayor && /^(4-6|6-10|8-10)$/.test(reps)) reps = '10-12';
    if (cardiaco) descanso = Math.max(descanso, 90);
    // Planchas y similares se miden en tiempo; "al fallo" se respeta salvo riesgo cardiaco.
    if (/\d\s*(s|seg|min)$/i.test(e.repeticiones) || (/al fallo/i.test(e.repeticiones) && !cardiaco && !embarazo)) reps = e.repeticiones;
    return { series, repeticiones: reps, descansoSeg: descanso };
  };

  const dias: RutinaInput['dias'] = division.sesiones.map((clave, i) => {
    const sesion = SESIONES[clave];
    const hoy = new Set<number>();
    const ejercicios: RutinaInput['dias'][number]['ejercicios'] = [];
    for (const [categoria, tipo] of sesion.slots.slice(0, maxSlots)) {
      const e = elegir(categoria, tipo, hoy);
      if (!e) continue;
      hoy.add(e.id);
      usos.set(e.id, (usos.get(e.id) ?? 0) + 1);
      ejercicios.push({ ejercicioId: e.id, ...dosisDe(e, tipo), indicaciones: null });
    }
    if (dosis.cardio) {
      const c = elegir('cardio', 'A', hoy);
      if (c) {
        usos.set(c.id, (usos.get(c.id) ?? 0) + 1);
        ejercicios.push({ ejercicioId: c.id, series: 1, repeticiones: cardiaco || embarazo ? '20 min' : dosis.cardio, descansoSeg: null, indicaciones: cardiaco || embarazo ? 'Ritmo en el que puedas platicar.' : null });
      }
    }
    // Cuerpo completo se etiqueta así; las demás, con los grupos que sí quedaron (máx. 6).
    const categorias = clave.startsWith('full') ? ['cuerpo_completo'] : [...new Set(sesion.slots.map(([c]) => c).filter((c) => catalogo.some((e) => e.categoria === c)))].slice(0, 6);
    return { diaSemana: division.dias[i], categorias, notas: sesion.nombre, ejercicios };
  }).filter((d) => d.ejercicios.length > 0);

  if (faltan.size) razones.push(`No hay ejercicios disponibles de: ${[...faltan].join(', ')}. Agrégalos al catálogo o sustituye a mano.`);

  return {
    rutina: {
      nombre: `${dosis.nombre} ${nDias} días`,
      notas: 'Calienta 5-10 minutos antes de empezar. Sube el peso cuando completes todas las repeticiones con buena técnica.',
      dias,
    },
    razones,
    razonesSalud,
  };
}
