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
    const perfil = await orm.Perfil.first({ id: req.auth.perfilId });
    if (!perfil?.sedeId) return { sedeId: null, vigente: null, solicitudes: [] };
    await this.gym.vencerSolicitudes(perfil.sedeId);
    const vigente = await this.gym.membresiaVigente(perfil.id, perfil.sedeId);
    const plan = vigente ? await orm.Plan.first({ id: vigente.planId }) : null;
    const solicitudes = await orm.Solicitud.where({ perfilId: perfil.id }).orderBy((s) => s.id.desc()).limit(5).all();
    const planes = new Map((await orm.Plan.where({ sedeId: perfil.sedeId }).select('id', 'nombre', 'precio').all()).map((p) => [p.id, p]));
    return {
      sedeId: perfil.sedeId,
      vigente: vigente ? { plan: plan?.nombre ?? '', inicio: ymd(vigente.inicio), fin: ymd(vigente.fin) } : null,
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
