import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { config } from './config.js';

async function bootstrap() {
  // rawBody: la firma de cada petición se calcula sobre el cuerpo exacto que envió el cliente.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: config.frontendUrls,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Signature', 'X-Signature-Timestamp', 'X-Signature-Nonce'],
  });
  if (process.env['LOG_TIEMPOS'] === '1') {
    // Diagnóstico: cuánto tarda cada petición (solo con LOG_TIEMPOS=1).
    app.use((req: { method: string; originalUrl: string }, res: { statusCode: number; on: (e: string, f: () => void) => void }, next: () => void) => {
      const t0 = performance.now();
      res.on('finish', () => console.log(`[t] ${Math.round(performance.now() - t0)}ms ${res.statusCode} ${req.method} ${req.originalUrl}`));
      next();
    });
  }
  await app.listen(config.port);
}
await bootstrap();
