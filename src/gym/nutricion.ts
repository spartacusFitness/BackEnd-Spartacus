// Recomendación nutricional ORIENTATIVA a partir del perfil del socio (sin IA; la IA llega en la fase 5).
// Gasto: Mifflin-St Jeor × factor de actividad según sus visitas reales al gym.
// No sustituye a un nutriólogo: con condiciones de salud registradas se pide confirmarlo con el coach o médico.

export type Sexo = 'mujer' | 'hombre';
type Alergeno = 'huevo' | 'lacteos' | 'gluten' | 'nuez' | 'cacahuate' | 'mariscos' | 'pescado' | 'soya';

export interface DatosNutricion {
  pesoKg: number | null;
  alturaCm: number | null;
  edad: number | null;
  sexo: Sexo | null;
  objetivo: string | null;
  /** días que vino por semana (promedio de las últimas 4) */
  diasPorSemana: number;
  alergias: string | null;
  condiciones: string | null;
}

export interface PlanNutricion {
  faltan: string[];
  calorias: number | null;
  proteinaG: number | null;
  grasaG: number | null;
  carbohidratosG: number | null;
  aguaL: number | null;
  actividad: string;
  enfoque: string;
  comidas: { momento: string; opciones: string[] }[];
  consejos: string[];
  avisos: string[];
  alergenosEvitados: string[];
}

const OBJ: Record<string, { factor: number; proteina: number; enfoque: string; consejos: string[] }> = {
  deficit: {
    factor: 0.8,
    proteina: 2.0,
    enfoque: 'Comer un poco menos de lo que gastas, con mucha proteína para no perder músculo.',
    consejos: ['Llena la mitad del plato con verduras.', 'Evita bebidas azucaradas: el refresco suma mucho sin llenar.', 'Prefiere asado, a la plancha u horneado sobre frito.'],
  },
  volumen: {
    factor: 1.1,
    proteina: 1.8,
    enfoque: 'Comer un poco más de lo que gastas para construir músculo, sin excederte.',
    consejos: ['No te saltes comidas; agrega una colación más si te cuesta llegar.', 'Porciones generosas de arroz, tortilla, avena o papa alrededor del entrenamiento.', 'Sube de peso poco a poco: 0.25–0.5 kg por semana.'],
  },
  recomposicion: {
    factor: 0.9,
    proteina: 2.2,
    enfoque: 'Un déficit pequeño con proteína alta: bajar grasa mientras ganas músculo.',
    consejos: ['Proteína en cada comida.', 'Los carbohidratos, de preferencia antes y después de entrenar.', 'Duerme 7–8 horas: ahí se recupera el músculo.'],
  },
  fuerza: {
    factor: 1.05,
    proteina: 2.0,
    enfoque: 'Energía suficiente para rendir y recuperarte de entrenamientos pesados.',
    consejos: ['Come carbohidratos 1–2 horas antes de entrenar.', 'Proteína y carbohidrato después de entrenar.'],
  },
  condicion: {
    factor: 1.0,
    proteina: 1.6,
    enfoque: 'Mantener tu peso con energía estable para entrenar mejor.',
    consejos: ['Hidrátate antes, durante y después del cardio.', 'Carbohidratos de buena calidad: avena, frijol, fruta, tortilla de maíz.'],
  },
  salud: {
    factor: 1.0,
    proteina: 1.4,
    enfoque: 'Comer variado y suficiente para sentirte bien.',
    consejos: ['Frutas y verduras de colores todos los días.', 'Menos ultraprocesados y azúcar.'],
  },
};
const OBJ_DEFAULT = { factor: 1.0, proteina: 1.6, enfoque: 'Mantener tu peso mientras eliges tu objetivo.', consejos: ['Elige tu objetivo en tu perfil para ajustar esta recomendación.'] };

/** Palabras con que la gente escribe sus alergias → alérgeno. */
const SINONIMOS: [RegExp, Alergeno][] = [
  [/huevo/, 'huevo'],
  [/lact|leche|lacteo|queso|yogur/, 'lacteos'],
  [/gluten|trigo|celiac/, 'gluten'],
  [/nuez|nueces|almendra|avellana|pistach|nuts/, 'nuez'],
  [/cacahuate|mani\b|crema de cacahuate/, 'cacahuate'],
  [/marisco|camaron|crustace|ostion|pulpo|calamar/, 'mariscos'],
  [/pescado|atun|salmon|tilapia|sardina/, 'pescado'],
  [/soya|soja/, 'soya'],
];
const NOMBRE: Record<Alergeno, string> = { huevo: 'huevo', lacteos: 'lácteos', gluten: 'gluten', nuez: 'nueces', cacahuate: 'cacahuate', mariscos: 'mariscos', pescado: 'pescado', soya: 'soya' };

export function alergenosDe(texto: string | null): Alergeno[] {
  if (!texto) return [];
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return SINONIMOS.filter(([re]) => re.test(t)).map(([, a]) => a);
}

// [idea, alérgenos que contiene]
const COMIDAS: { momento: string; ideas: [string, Alergeno[]][] }[] = [
  {
    momento: 'Desayuno',
    ideas: [
      ['Huevos a la mexicana con 2 tortillas de maíz y frijoles', ['huevo']],
      ['Avena cocida con leche, plátano y canela', ['lacteos']],
      ['Chilaquiles horneados con pollo deshebrado y salsa verde', []],
      ['Licuado de proteína con avena y fresas', ['lacteos']],
      ['Molletes de frijol con pico de gallo (pan integral)', ['gluten']],
    ],
  },
  {
    momento: 'Colación',
    ideas: [
      ['Yogur griego con fruta', ['lacteos']],
      ['Pepino, jícama y zanahoria con limón, y 3 rebanadas de pechuga de pavo', []],
      ['Manzana con un puño de nueces', ['nuez']],
      ['Plátano con crema de cacahuate', ['cacahuate']],
      ['Fruta picada con chile y limón', []],
    ],
  },
  {
    momento: 'Comida',
    ideas: [
      ['Pechuga de pollo a la plancha con arroz y verduras', []],
      ['Carne asada magra con nopales, frijoles y tortillas de maíz', []],
      ['Filete de pescado con ensalada y papa cocida', ['pescado']],
      ['Tacos de pollo deshebrado con salsa y aguacate', []],
      ['Caldo de pollo con verduras y arroz', []],
    ],
  },
  {
    momento: 'Cena',
    ideas: [
      ['Tostadas horneadas de pollo con aguacate y lechuga', []],
      ['Quesadillas de tortilla de maíz con queso panela y champiñones', ['lacteos']],
      ['Omelette de claras con espinaca y una tortilla', ['huevo']],
      ['Ensalada de atún con aguacate y galletas habaneras', ['pescado', 'gluten']],
      ['Bowl de frijoles, arroz, pollo y pico de gallo', []],
    ],
  },
];

const redondear = (n: number, a: number) => Math.round(n / a) * a;

export function planNutricion(d: DatosNutricion): PlanNutricion {
  const evitar = alergenosDe(d.alergias);
  const obj = (d.objetivo && OBJ[d.objetivo]) || OBJ_DEFAULT;
  const actividad =
    d.diasPorSemana >= 5 ? 'Muy activo (5 o más días por semana)' : d.diasPorSemana >= 3 ? 'Activo (3–4 días por semana)' : d.diasPorSemana >= 1 ? 'Poco activo (1–2 días por semana)' : 'Sin visitas recientes';
  const factorActividad = d.diasPorSemana >= 5 ? 1.725 : d.diasPorSemana >= 3 ? 1.55 : d.diasPorSemana >= 1 ? 1.375 : 1.2;

  const comidas = COMIDAS.map((c) => ({
    momento: c.momento,
    opciones: c.ideas.filter(([, al]) => !al.some((a) => evitar.includes(a))).slice(0, 3).map(([idea]) => idea),
  }));
  const avisos = ['Es una guía orientativa; no sustituye a un nutriólogo.'];
  if (d.condiciones) avisos.unshift('Tienes condiciones de salud registradas: confirma este plan con tu coach o tu médico.');
  if (!d.sexo) avisos.push('Agrega tu sexo en tu perfil para afinar el cálculo de calorías.');

  const faltan = [d.pesoKg ? null : 'tu peso', d.alturaCm ? null : 'tu estatura', d.edad ? null : 'tu fecha de nacimiento'].filter((x): x is string => !!x);
  const base = { actividad, enfoque: obj.enfoque, comidas, consejos: obj.consejos, avisos, alergenosEvitados: evitar.map((a) => NOMBRE[a]) };
  if (faltan.length) return { ...base, faltan, calorias: null, proteinaG: null, grasaG: null, carbohidratosG: null, aguaL: null };

  const peso = d.pesoKg!;
  const ajusteSexo = d.sexo === 'hombre' ? 5 : d.sexo === 'mujer' ? -161 : -78;
  const bmr = 10 * peso + 6.25 * d.alturaCm! - 5 * d.edad! + ajusteSexo;
  const calorias = redondear(bmr * factorActividad * obj.factor, 50);
  const proteinaG = Math.round(peso * obj.proteina);
  const grasaG = Math.round(peso * 0.8);
  const carbohidratosG = Math.max(0, Math.round((calorias - proteinaG * 4 - grasaG * 9) / 4));
  const aguaL = Math.round((peso * 0.035 + (d.diasPorSemana > 0 ? 0.5 : 0)) * 10) / 10;
  return { ...base, faltan: [], calorias, proteinaG, grasaG, carbohidratosG, aguaL };
}
