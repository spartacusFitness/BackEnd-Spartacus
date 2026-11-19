import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { parse } from '../auth/auth.schemas.js';
import { Roles } from '../auth/roles.decorator.js';
import { ReportesService } from './reportes.service.js';
import { rangoSchema } from './tienda.schemas.js';

@Controller('reportes')
@UseGuards(AuthGuard)
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  /** GET /reportes/resumen?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&sedeId=] — admin: todas; encargado: las suyas. */
  @Get('resumen')
  @Roles('admin', 'encargado')
  resumen(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { desde, hasta, sedeId } = parse(rangoSchema, query);
    return this.reportes.resumen(req.auth, desde, hasta, sedeId);
  }
}
