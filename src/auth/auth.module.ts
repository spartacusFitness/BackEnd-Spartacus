import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { DispositivosService } from './dispositivos.service.js';
import { PerfilesService } from './perfiles.service.js';

@Module({
  controllers: [AuthController],
  providers: [PerfilesService, DispositivosService, AuthGuard],
  exports: [PerfilesService, DispositivosService, AuthGuard],
})
export class AuthModule {}
