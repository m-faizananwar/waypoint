import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const port = app.get(ConfigService<Env, true>).get('PORT', { infer: true });
  await app.listen(port);
}

void bootstrap();
