// Carga (o actualiza) las sedes. Uso: npm run seed:sedes
// Coordenadas: enlaces de Google Maps del gimnasio. Direcciones: aproximadas (OpenStreetMap), confirmar.
import { db, supabaseDb } from '../prisma/db.js';

const SEDES = [
  {
    id: 'dolores',
    nombre: 'Dolores',
    ciudad: 'Dolores Hidalgo, Gto.',
    direccion: 'Calle Nayarit 54, Col. Mariano Balleza, 37803 Dolores Hidalgo, Gto.',
    lat: 21.1588342,
    lng: -100.9303548,
    mapsUrl: 'https://maps.app.goo.gl/vz48B85iWDDCfwaL8',
  },
  {
    id: 'san-felipe',
    nombre: 'San Felipe',
    ciudad: 'San Felipe, Gto.',
    direccion: 'Calle Leona Vicario 306, La Huerta de San Agustín, 37600 San Felipe, Gto.',
    lat: 21.4858429,
    lng: -101.2223491,
    mapsUrl: 'https://maps.app.goo.gl/8foGwfjfe3DUJpS5A',
  },
  {
    id: 'san-luis',
    nombre: 'San Luis',
    ciudad: 'San Luis de la Paz, Gto.',
    direccion: 'Av. Ferrocarril, Col. Vista Hermosa, 37900 San Luis de la Paz, Gto.',
    lat: 21.2915606,
    lng: -100.5145921,
    mapsUrl: 'https://maps.app.goo.gl/xeEA4xWACmcW2VEa8',
  },
];

try {
  for (const s of SEDES) {
    const { id, ...rest } = s;
    await db.orm.public.Sede.upsert({ create: { id, ...rest }, update: rest });
    console.log(`✔ sede ${s.nombre}`);
  }
} finally {
  await supabaseDb.close();
}
