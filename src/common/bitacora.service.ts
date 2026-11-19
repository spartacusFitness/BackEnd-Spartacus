import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface EntradaBitacora {
  sedeId?: string | null;
  actorPerfilId?: string | null;
  recepcionistaId?: number | null;
  accion: string;
  entidad: string;
  entidadId: string | number;
  datos?: unknown;
}

/** Registro de auditoría: quién hizo qué y cuándo. Solo se agregan filas. */
@Injectable()
export class BitacoraService {
  private readonly log = new Logger('Bitacora');
  constructor(private readonly prisma: PrismaService) {}

  async registrar(e: EntradaBitacora) {
    try {
      await this.prisma.db.orm.public.Bitacora.create({
        sedeId: e.sedeId ?? null,
        actorPerfilId: e.actorPerfilId ?? null,
        recepcionistaId: e.recepcionistaId ?? null,
        accion: e.accion,
        entidad: e.entidad,
        entidadId: String(e.entidadId),
        datos: e.datos === undefined ? null : JSON.stringify(e.datos),
      });
    } catch (err) {
      // La bitácora nunca debe tumbar la operación, pero sí dejar rastro en los logs.
      this.log.error(`No se pudo registrar "${e.accion}" ${e.entidad}#${e.entidadId}: ${(err as Error).message}`);
    }
  }

  listar(sedeId: string | null, limite = 100) {
    const q = this.prisma.db.orm.public.Bitacora;
    return (sedeId ? q.where({ sedeId }) : q)
      .orderBy((b) => b.id.desc())
      .limit(Math.min(limite, 500))
      .all();
  }
}
