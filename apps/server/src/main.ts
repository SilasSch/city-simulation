import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './core/config';
import {
  configureApplication,
  GLOBAL_PREFIX,
} from './core/configure-application';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get('SERVER_PORT', { infer: true });

  await app.listen(port);
  Logger.log(
    `Server is running on: http://localhost:${port}/${GLOBAL_PREFIX}`,
    'Bootstrap',
  );
}

void bootstrap();
