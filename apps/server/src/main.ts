import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './core/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get('SERVER_PORT', { infer: true });

  await app.listen(port);
  Logger.log(
    `Server is running on: http://localhost:${port}/${globalPrefix}`,
    'Bootstrap',
  );
}

void bootstrap();
