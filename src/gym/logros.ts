/** Logros de la comunidad (fase 5). Se calculan al vuelo con su asistencia y su peso: no se guardan. */
import { diaSemana, sumarDias, type Calendario } from '../common/fechas.js';

export interface Logro {
  clave: string;
  titulo: string;
  descripcion: string;
  obtenido: boolean;
  /** avance hacia el logro (actual de meta) */
  actual: number;
  meta: number;
}

/** Mejor racha histórica: días seguidos que vino; sábados, domingos y días cerrados no la rompen. */
export function mejorRacha(dias: Set<string>, cal: Calendario): number {
  const orden = [...dias].sort();
  if (!orden.length) return 0;
  let mejor = 0;
  let actual = 0;
  for (let d = orden[0]; d <= orden.at(-1)!; d = sumarDias(d, 1)) {
    if (dias.has(d)) mejor = Math.max(mejor, ++actual);
    else if (diaSemana(d) === 0 || diaSemana(d) === 6 || !cal.abierto(d)) continue;
    else actual = 0;
  }
  return mejor;
}

/** Días que vino en su mejor semana (lunes a domingo). */
export function mejorSemana(dias: Set<string>): number {
  const porSemana = new Map<string, number>();
  for (const d of dias) {
    const lunes = sumarDias(d, -((diaSemana(d) + 6) % 7));
    porSemana.set(lunes, (porSemana.get(lunes) ?? 0) + 1);
  }
  return Math.max(0, ...porSemana.values());
}

export interface DatosLogros {
  dias: Set<string>;
  cal: Calendario;
  objetivo: string | null;
  /** primer y último peso registrados (kg) */
  pesoInicial: number | null;
  pesoActual: number | null;
  retosCumplidos: number;
}

export function calcularLogros(x: DatosLogros): Logro[] {
  const visitas = x.dias.size;
  const racha = mejorRacha(x.dias, x.cal);
  const semana = mejorSemana(x.dias);
  const l = (clave: string, titulo: string, descripcion: string, actual: number, meta: number): Logro => ({
    clave,
    titulo,
    descripcion,
    actual: Math.min(actual, meta),
    meta,
    obtenido: actual >= meta,
  });
  const out = [
    l('primera', 'Primer día', 'Tu primera visita al gym.', visitas, 1),
    l('visitas10', '10 visitas', 'Viniste 10 días.', visitas, 10),
    l('visitas50', '50 visitas', 'Viniste 50 días.', visitas, 50),
    l('visitas100', '100 visitas', 'Viniste 100 días.', visitas, 100),
    l('semana3', 'Semana activa', '3 días en una misma semana.', semana, 3),
    l('semana5', 'Semana completa', '5 días en una misma semana.', semana, 5),
    l('racha5', 'Racha de 5', '5 días seguidos (los fines de semana no la rompen).', racha, 5),
    l('racha10', 'Racha de 10', '10 días seguidos.', racha, 10),
    l('racha20', 'Racha de 20', '20 días seguidos.', racha, 20),
    l('reto', 'Reto cumplido', 'Completaste un reto de tu sede.', x.retosCumplidos, 1),
  ];
  // Peso: solo cuenta a favor de su objetivo (bajar en déficit, subir en volumen).
  if (x.pesoInicial !== null && x.pesoActual !== null && (x.objetivo === 'deficit' || x.objetivo === 'volumen')) {
    const avance = Math.round((x.objetivo === 'deficit' ? x.pesoInicial - x.pesoActual : x.pesoActual - x.pesoInicial) * 10) / 10;
    const verbo = x.objetivo === 'deficit' ? 'Bajaste' : 'Subiste';
    out.push(l('peso2', `${verbo} 2 kg`, `${verbo} 2 kg desde tu primer registro.`, Math.max(0, avance), 2));
    out.push(l('peso5', `${verbo} 5 kg`, `${verbo} 5 kg desde tu primer registro.`, Math.max(0, avance), 5));
  }
  return out;
}

/** Nombre público en el ranking: el apodo, o el nombre con la inicial del apellido. */
export function nombrePublico(apodo: string | null, nombre: string | null): string {
  if (apodo) return apodo;
  const [n, a] = (nombre ?? 'Socio').trim().split(/\s+/);
  return a ? `${n} ${a[0].toUpperCase()}.` : n;
}
