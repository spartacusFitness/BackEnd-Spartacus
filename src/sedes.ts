/** Distancia en km entre dos puntos (haversine). */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** La sede más cercana a un punto, entre las dadas. */
export function nearest<T extends { lat: number; lng: number }>(sedes: T[], lat: number, lng: number) {
  return sedes
    .map((s) => ({ ...s, km: distanceKm(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.km - b.km)[0];
}
