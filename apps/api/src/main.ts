import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const configService = app.get(ConfigService<AppConfig, true>);
  const globalPrefix = configService.get('globalPrefix', { infer: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('HospitalOS API')
    .setDescription('HospitalOS hospital operating platform — Phase 1 foundation')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, swaggerDocument);

  const port = configService.get('port', { infer: true });
  await app.listen(port);
  Logger.log(`HospitalOS API listening on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger docs at http://localhost:${port}/${globalPrefix}/docs`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(
    'Failed to bootstrap HospitalOS API',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
