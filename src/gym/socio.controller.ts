import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { parse } from '../auth/auth.schemas.js';
import { ymd } from '../common/fechas.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GymService } from './gym.service.js';
import { solicitudSchema } from './gym.schemas.js';

/** Lo que ve y hace el propio socio desde la app. */
@Controller('yo')
@UseGuards(AuthGuard)
export class SocioController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gym: GymService,
  ) {}

  /** GET /yo/membresia — membresía vigente y solicitudes recientes. */
  @Get('membresia')
  async membresia(@Req() req: AuthedRequest) {
    const orm = this.prisma.db.orm.public;
    const perfilId = req.auth.perfilId;
    // La sede del socio viene en sus roles (caché de sesión).
    const sedeId = req.auth.roles.find((r) => r.rol === 'socio')?.sedeId;
    if (!sedeId) return { sedeId: null, vigente: null, solicitudes: [] };
    const [vigente, solicitudes, planesFilas] = await Promise.all([
      this.gym.membresiaVigente(perfilId, sedeId),
      this.gym.vencerSolicitudes(sedeId).then(() => orm.Solicitud.where({ perfilId }).orderBy((s) => s.id.desc()).limit(5).all()),
      orm.Plan.select('id', 'nombre', 'precio').all(), // incluye el plan de la membresía aunque sea de otra sede
    ]);
    const planes = new Map(planesFilas.map((p) => [p.id, p]));
    return {
      sedeId,
      vigente: vigente ? { plan: planes.get(vigente.planId)?.nombre ?? '', inicio: ymd(vigente.inicio), fin: ymd(vigente.fin) } : null,
      solicitudes: solicitudes.map((s) => ({
        id: s.id,
        plan: planes.get(s.planId)?.nombre ?? '',
        precio: planes.get(s.planId)?.precio ?? 0,
        metodo: s.metodo,
        estado: s.estado,
        venceEn: s.venceEn,
      })),
    };
  }

  /** POST /yo/solicitudes { planId, metodo } — registro en línea, se completa en recepción. */
  @Post('solicitudes')
  async solicitar(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { planId, metodo } = parse(solicitudSchema, body);
    const s = await this.gym.crearSolicitud(req.auth.perfilId, planId, metodo);
    return { id: s.id, estado: s.estado, venceEn: s.venceEn };
  }
}
