import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { db } from './db.js';

/** Cada 4 min una consulta mínima: así la primera acción tras un rato sin uso no paga la reconexión. */
const LATIDO_MS = 4 * 60 * 1000;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly db = db;
  private latido?: NodeJS.Timeout;
  private readonly log = new Logger('Base de datos');

  async onModuleInit() {
    // Abre la conexión al arrancar (≈1 s) para que no la pague la primera petición.
    const ping = () => db.orm.public.Sede.select('id').first();
    await ping().catch((e: unknown) => this.log.warn(`no se pudo precalentar: ${String(e)}`));
    this.latido = setInterval(() => void ping().catch(() => undefined), LATIDO_MS);
    this.latido.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.latido);
    await db.close();
  }
}
