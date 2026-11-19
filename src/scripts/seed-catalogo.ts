// Carga el catálogo base de cada sede: máquinas y ejercicios comunes (los que casi todo gimnasio
// tiene) y productos típicos de mostrador.
// Idempotente: solo agrega lo que falta por nombre; nunca borra ni cambia lo que ya se ajustó.
// - Si una sede no tiene alguna máquina, el coach la marca "Fuera de servicio".
// - Los productos entran DESACTIVADOS, con stock 0 y precio sugerido: administración revisa el precio,
//   los activa y registra la entrada de mercancía. Así no aparecen ventas ni inventario inventados.
// Uso:  npm run seed:catalogo               (todas las sedes activas)
//       npm run seed:catalogo -- dolores     (una o varias sedes)
import { db, supabaseDb } from '../prisma/db.js';

type Grupo = 'pecho' | 'espalda' | 'hombro' | 'bicep' | 'tricep' | 'antebrazo' | 'pierna' | 'gluteo' | 'pantorrilla' | 'abdomen' | 'cardio' | 'cuerpo_completo';
type Equipo = 'maquina' | 'mancuernas' | 'barra' | 'ligas' | 'kettlebell' | 'polea' | 'peso_corporal' | 'otro';

const MAQUINAS: [string, Grupo][] = [
  ['Prensa de pierna', 'pierna'],
  ['Hack squat', 'pierna'],
  ['Extensión de cuádriceps', 'pierna'],
  ['Curl femoral acostado', 'pierna'],
  ['Curl femoral sentado', 'pierna'],
  ['Aductores', 'pierna'],
  ['Abductores', 'gluteo'],
  ['Pantorrilla sentado', 'pantorrilla'],
  ['Multipower (Smith)', 'cuerpo_completo'],
  ['Press de pecho', 'pecho'],
  ['Pec deck', 'pecho'],
  ['Crossover de poleas', 'pecho'],
  ['Jalón al pecho', 'espalda'],
  ['Remo sentado en polea', 'espalda'],
  ['Remo en máquina', 'espalda'],
  ['Dominadas asistidas', 'espalda'],
  ['Press de hombro', 'hombro'],
  ['Caminadora', 'cardio'],
  ['Bicicleta fija', 'cardio'],
  ['Elíptica', 'cardio'],
  ['Escaladora', 'cardio'],
];

// [nombre, grupo, equipo, máquina (si es en máquina), series, repeticiones, indicaciones]
const EJERCICIOS: [string, Grupo, Equipo, string | null, number, string, string | null][] = [
  // Pecho
  ['Press de banca plano', 'pecho', 'barra', null, 4, '8-10', 'Baja la barra a la mitad del pecho; pies firmes en el piso.'],
  ['Press inclinado con barra', 'pecho', 'barra', null, 4, '8-10', null],
  ['Press plano con mancuernas', 'pecho', 'mancuernas', null, 3, '10-12', null],
  ['Press inclinado con mancuernas', 'pecho', 'mancuernas', null, 3, '10-12', null],
  ['Aperturas con mancuernas', 'pecho', 'mancuernas', null, 3, '12-15', 'Codos ligeramente flexionados todo el recorrido.'],
  ['Press de pecho en máquina', 'pecho', 'maquina', 'Press de pecho', 3, '10-12', null],
  ['Aperturas en pec deck', 'pecho', 'maquina', 'Pec deck', 3, '12-15', null],
  ['Cruce de poleas', 'pecho', 'maquina', 'Crossover de poleas', 3, '12-15', 'Junta las manos frente al pecho y aprieta 1 s.'],
  ['Press inclinado en Smith', 'pecho', 'maquina', 'Multipower (Smith)', 3, '10', null],
  ['Lagartijas', 'pecho', 'peso_corporal', null, 3, 'al fallo', 'Cuerpo recto de cabeza a talones.'],
  // Espalda
  ['Jalón al pecho', 'espalda', 'maquina', 'Jalón al pecho', 4, '10-12', 'Lleva la barra a la parte alta del pecho, sin balancearte.'],
  ['Jalón agarre cerrado', 'espalda', 'maquina', 'Jalón al pecho', 3, '10-12', null],
  ['Remo sentado en polea', 'espalda', 'maquina', 'Remo sentado en polea', 4, '10-12', 'Pecho arriba; junta los omóplatos al final.'],
  ['Remo en máquina', 'espalda', 'maquina', 'Remo en máquina', 3, '10-12', null],
  ['Dominadas asistidas', 'espalda', 'maquina', 'Dominadas asistidas', 3, '8-12', null],
  ['Dominadas', 'espalda', 'peso_corporal', null, 3, 'al fallo', null],
  ['Remo con barra', 'espalda', 'barra', null, 4, '8-10', 'Espalda neutra, torso inclinado unos 45°.'],
  ['Remo con mancuerna a una mano', 'espalda', 'mancuernas', null, 3, '10-12', 'Apoya rodilla y mano en el banco.'],
  ['Peso muerto', 'espalda', 'barra', null, 4, '6-8', 'Espalda neutra; empuja el piso con las piernas.'],
  ['Pullover en polea', 'espalda', 'polea', null, 3, '12-15', null],
  ['Hiperextensiones', 'espalda', 'peso_corporal', null, 3, '12-15', null],
  // Hombro
  ['Press militar con barra', 'hombro', 'barra', null, 4, '8-10', 'Abdomen firme; no arquees la espalda baja.'],
  ['Press de hombro con mancuernas', 'hombro', 'mancuernas', null, 3, '10-12', null],
  ['Press de hombro en máquina', 'hombro', 'maquina', 'Press de hombro', 3, '10-12', null],
  ['Elevaciones laterales', 'hombro', 'mancuernas', null, 3, '12-15', 'Sube hasta la altura de los hombros, sin impulso.'],
  ['Elevaciones frontales', 'hombro', 'mancuernas', null, 3, '12', null],
  ['Pájaros (deltoide posterior)', 'hombro', 'mancuernas', null, 3, '12-15', null],
  ['Face pull', 'hombro', 'polea', null, 3, '12-15', 'Jala la cuerda hacia la cara separando las manos.'],
  ['Encogimientos con mancuernas', 'hombro', 'mancuernas', null, 3, '12-15', null],
  // Bíceps
  ['Curl con barra', 'bicep', 'barra', null, 3, '10-12', 'Codos fijos; sin balancear el torso.'],
  ['Curl alternado con mancuernas', 'bicep', 'mancuernas', null, 3, '10-12', null],
  ['Curl martillo', 'bicep', 'mancuernas', null, 3, '12', null],
  ['Curl en polea', 'bicep', 'polea', null, 3, '12-15', null],
  ['Curl concentrado', 'bicep', 'mancuernas', null, 3, '12', null],
  ['Curl predicador', 'bicep', 'barra', null, 3, '10-12', null],
  // Tríceps
  ['Extensión de tríceps en polea', 'tricep', 'polea', null, 3, '12-15', 'Codos pegados al cuerpo.'],
  ['Extensión con cuerda', 'tricep', 'polea', null, 3, '12-15', null],
  ['Press francés', 'tricep', 'barra', null, 3, '10-12', null],
  ['Extensión sobre la cabeza con mancuerna', 'tricep', 'mancuernas', null, 3, '12', null],
  ['Fondos en banco', 'tricep', 'peso_corporal', null, 3, 'al fallo', null],
  ['Patada de tríceps', 'tricep', 'mancuernas', null, 3, '12-15', null],
  // Antebrazo
  ['Curl de muñeca', 'antebrazo', 'barra', null, 3, '15-20', null],
  ['Curl inverso', 'antebrazo', 'barra', null, 3, '12', null],
  // Pierna
  ['Sentadilla con barra', 'pierna', 'barra', null, 4, '8-10', 'Baja hasta paralelo; rodillas en dirección de las puntas.'],
  ['Sentadilla goblet', 'pierna', 'kettlebell', null, 3, '12', null],
  ['Prensa de pierna', 'pierna', 'maquina', 'Prensa de pierna', 4, '10-12', 'No bloquees las rodillas al extender.'],
  ['Hack squat', 'pierna', 'maquina', 'Hack squat', 4, '10-12', null],
  ['Sentadilla en Smith', 'pierna', 'maquina', 'Multipower (Smith)', 4, '10', null],
  ['Extensión de cuádriceps', 'pierna', 'maquina', 'Extensión de cuádriceps', 3, '12-15', null],
  ['Curl femoral acostado', 'pierna', 'maquina', 'Curl femoral acostado', 3, '10-12', null],
  ['Curl femoral sentado', 'pierna', 'maquina', 'Curl femoral sentado', 3, '10-12', null],
  ['Peso muerto rumano', 'pierna', 'barra', null, 4, '8-10', 'Cadera hacia atrás, rodillas ligeramente flexionadas.'],
  ['Zancadas con mancuernas', 'pierna', 'mancuernas', null, 3, '10', '10 por pierna.'],
  ['Sentadilla búlgara', 'pierna', 'mancuernas', null, 3, '10', '10 por pierna; pie de atrás sobre el banco.'],
  ['Aductores en máquina', 'pierna', 'maquina', 'Aductores', 3, '15', null],
  // Glúteo
  ['Hip thrust con barra', 'gluteo', 'barra', null, 4, '10-12', 'Pausa de 1 s arriba apretando el glúteo.'],
  ['Abductores en máquina', 'gluteo', 'maquina', 'Abductores', 3, '15-20', null],
  ['Patada de glúteo en polea', 'gluteo', 'polea', null, 3, '12-15', '12-15 por pierna.'],
  ['Puente de glúteo', 'gluteo', 'peso_corporal', null, 3, '15', null],
  ['Caminata lateral con liga', 'gluteo', 'ligas', null, 3, '15', '15 pasos por lado.'],
  // Pantorrilla
  ['Elevación de talones de pie', 'pantorrilla', 'mancuernas', null, 4, '15-20', null],
  ['Pantorrilla sentado', 'pantorrilla', 'maquina', 'Pantorrilla sentado', 4, '15-20', null],
  ['Pantorrilla en prensa', 'pantorrilla', 'maquina', 'Prensa de pierna', 4, '15-20', null],
  // Abdomen
  ['Crunch abdominal', 'abdomen', 'peso_corporal', null, 3, '15-20', null],
  ['Plancha', 'abdomen', 'peso_corporal', null, 3, '45 s', 'Cadera alineada; no la dejes caer.'],
  ['Elevación de piernas colgado', 'abdomen', 'peso_corporal', null, 3, '12', null],
  ['Crunch en polea', 'abdomen', 'polea', null, 3, '15', null],
  ['Giros rusos', 'abdomen', 'mancuernas', null, 3, '20', null],
  ['Rueda abdominal', 'abdomen', 'otro', null, 3, '10', null],
  // Cardio
  ['Caminadora', 'cardio', 'maquina', 'Caminadora', 1, '20 min', null],
  ['Bicicleta fija', 'cardio', 'maquina', 'Bicicleta fija', 1, '20 min', null],
  ['Elíptica', 'cardio', 'maquina', 'Elíptica', 1, '20 min', null],
  ['Escaladora', 'cardio', 'maquina', 'Escaladora', 1, '15 min', null],
  ['Saltar la cuerda', 'cardio', 'otro', null, 3, '1 min', null],
  // Cuerpo completo
  ['Burpees', 'cuerpo_completo', 'peso_corporal', null, 3, '12', null],
  ['Swing con kettlebell', 'cuerpo_completo', 'kettlebell', null, 3, '15', 'El impulso sale de la cadera, no de los brazos.'],
];

type Categoria = 'suplementos' | 'bebidas' | 'snacks' | 'accesorios' | 'ropa' | 'otro';
// [nombre, categoría, ícono, precio sugerido en pesos, stock mínimo para avisar]
const PRODUCTOS: [string, Categoria, string, number, number][] = [
  ['Proteína whey (scoop)', 'suplementos', 'proteina', 35, 10],
  ['Preentreno (toma)', 'suplementos', 'preentreno', 25, 10],
  ['Creatina (toma)', 'suplementos', 'creatina', 15, 10],
  ['BCAA (toma)', 'suplementos', 'vitaminas', 20, 10],
  ['Proteína whey 2 lb', 'suplementos', 'proteina', 899, 2],
  ['Creatina monohidratada 300 g', 'suplementos', 'creatina', 449, 2],
  ['Multivitamínico 60 cápsulas', 'suplementos', 'vitaminas', 299, 2],
  ['Agua natural 600 ml', 'bebidas', 'agua', 12, 12],
  ['Agua natural 1 L', 'bebidas', 'agua', 18, 12],
  ['Bebida isotónica 600 ml', 'bebidas', 'bebida', 25, 12],
  ['Bebida energética', 'bebidas', 'bebida', 35, 6],
  ['Café americano', 'bebidas', 'cafe', 25, 0],
  ['Batido de proteína preparado', 'bebidas', 'shaker', 55, 0],
  ['Barra de proteína', 'snacks', 'barra', 40, 6],
  ['Barra de avena', 'snacks', 'barra', 20, 6],
  ['Mix de nueces', 'snacks', 'snack', 30, 6],
  ['Shaker Spartacus', 'accesorios', 'shaker', 120, 3],
  ['Toalla de entrenamiento', 'accesorios', 'toalla', 150, 3],
  ['Guantes de entrenamiento', 'accesorios', 'guantes', 250, 2],
  ['Cinturón de levantamiento', 'accesorios', 'cinturon', 450, 1],
  ['Ligas de resistencia (juego)', 'accesorios', 'otro', 180, 2],
  ['Playera Spartacus', 'ropa', 'playera', 250, 3],
  ['Gorra Spartacus', 'ropa', 'gorra', 220, 2],
];

const o = db.orm.public;
const pedidas = process.argv.slice(2);
try {
  const sedes = pedidas.length
    ? await o.Sede.where((s) => s.id.in(pedidas)).select('id', 'nombre').all()
    : await o.Sede.where({ activa: true }).select('id', 'nombre').all();
  if (pedidas.length && sedes.length !== pedidas.length) throw new Error(`No existen todas estas sedes: ${pedidas.join(', ')}`);
  const norm = (t: string) => t.trim().toLowerCase();

  for (const sede of sedes) {
    const [maqs, ejs, prods] = await Promise.all([
      o.Maquina.where({ sedeId: sede.id }).select('id', 'nombre').all(),
      o.Ejercicio.where({ sedeId: sede.id }).select('nombre').all(),
      o.Producto.where({ sedeId: sede.id }).select('nombre').all(),
    ]);
    const maqId = new Map(maqs.map((m) => [norm(m.nombre), m.id]));
    const faltanMaq = MAQUINAS.filter(([n]) => !maqId.has(norm(n)));
    if (faltanMaq.length) {
      const nuevas = await o.Maquina.createAll(faltanMaq.map(([nombre, categoria]) => ({ sedeId: sede.id, nombre, categoria })));
      for (const m of nuevas) maqId.set(norm(m.nombre), m.id);
    }
    const ejYa = new Set(ejs.map((e) => norm(e.nombre)));
    const faltanEj = EJERCICIOS.filter(([n]) => !ejYa.has(norm(n)));
    if (faltanEj.length) {
      await o.Ejercicio.createAll(
        faltanEj.map(([nombre, categoria, equipo, maquina, series, repeticiones, indicaciones]) => ({
          sedeId: sede.id,
          nombre,
          categoria,
          equipo,
          maquinaId: maquina ? (maqId.get(norm(maquina)) ?? null) : null,
          series,
          repeticiones,
          indicaciones,
        })),
      );
    }
    const prodYa = new Set(prods.map((p) => norm(p.nombre)));
    const faltanProd = PRODUCTOS.filter(([n]) => !prodYa.has(norm(n)));
    if (faltanProd.length) {
      await o.Producto.createAll(
        faltanProd.map(([nombre, categoria, icono, pesos, stockMinimo]) => ({ sedeId: sede.id, nombre, categoria, icono, precio: pesos * 100, stock: 0, stockMinimo, activo: false })),
      );
    }
    console.log(`✔ ${sede.nombre}: +${faltanMaq.length} máquinas, +${faltanEj.length} ejercicios, +${faltanProd.length} productos desactivados (ya tenía ${maqs.length}, ${ejs.length} y ${prods.length})`);
  }
} catch (err) {
  console.error('✘', (err as Error).message);
  process.exitCode = 1;
} finally {
  await supabaseDb.close();
}
