import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config';

/**
 * Technische Grundlage der Anwendung: validierte Konfiguration.
 * Fachliche Querschnittslogik gehört nicht hierher.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
})
export class CoreModule {}
