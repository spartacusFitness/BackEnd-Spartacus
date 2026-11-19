import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BitacoraService } from '../common/bitacora.service.js';
import { AdminController } from './admin.controller.js';
import { CoachController } from './coach.controller.js';
import { CoachService } from './coach.service.js';
import { GymService } from './gym.service.js';
import { RecepcionController } from './recepcion.controller.js';
import { ReportesController } from './reportes.controller.js';
import { ReportesService } from './reportes.service.js';
import { SocioController } from './socio.controller.js';
import { TiendaController } from './tienda.controller.js';
import { TiendaService } from './tienda.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminController, CoachController, RecepcionController, SocioController, TiendaController, ReportesController],
  providers: [GymService, CoachService, BitacoraService, TiendaService, ReportesService],
  exports: [GymService, BitacoraService, TiendaService],
})
export class GymModule {}
