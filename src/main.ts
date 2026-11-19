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
  await app.listen(config.port);
}
await bootstrap();
