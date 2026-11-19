// Fechas "de calendario" del gym, siempre en hora del centro de México.
// En la base, un día se guarda como DateTime a las 12:00 UTC de ese día (así nunca cambia de fecha
// al convertir zonas horarias). Aquí se trabaja con cadenas "AAAA-MM-DD".

export const TZ = 'America/Mexico_City';
const DAY = 86_400_000;

/** Hoy en México, "AAAA-MM-DD". */
export const hoy = (ahora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);

/** "AAAA-MM-DD" → DateTime para guardar (12:00 UTC). */
export const aFecha = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

/** DateTime guardado → "AAAA-MM-DD". */
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const sumarDias = (dia: string, n: number) => ymd(new Date(aFecha(dia).getTime() + n * DAY));

/** 0 = domingo … 6 = sábado */
export const diaSemana = (dia: string) => aFecha(dia).getUTCDay();

/** Fin de un día en hora de México (México no usa horario de verano desde 2022: UTC-6). */
export const finDelDia = (dia: string) => new Date(`${dia}T23:59:59.999-06:00`);

/** Calendario de una sede: qué días da servicio. */
export class Calendario {
  private readonly sinServicio: Set<number>;
  private readonly cerrados: Set<string>;

  constructor(diasSinServicio: string, diasCerrados: Iterable<string>) {
    this.sinServicio = new Set(
      diasSinServicio
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    );
    this.cerrados = new Set(diasCerrados);
  }

  abierto(dia: string) {
    return !this.sinServicio.has(diaSemana(dia)) && !this.cerrados.has(dia);
  }

  /** El mismo día si abre; si no, el siguiente día que abra (días de gracia). */
  siguienteAbierto(dia: string) {
    let d = dia;
    for (let i = 0; i < 60 && !this.abierto(d); i++) d = sumarDias(d, 1);
    return d;
  }

  /** El n-ésimo día hábil DESPUÉS de `dia`. */
  diasHabilesDespues(dia: string, n: number) {
    let d = dia;
    let cuenta = 0;
    for (let i = 0; i < 120 && cuenta < n; i++) {
      d = sumarDias(d, 1);
      if (this.abierto(d)) cuenta++;
    }
    return d;
  }
}
