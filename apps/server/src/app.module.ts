import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CoreModule } from './core/core.module';
import { HealthModule } from './health/health.module';
import { PersistenceModule } from './persistence/persistence.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HttpExceptionFilter } from './shared/http-exception.filter';

@Module({
  imports: [CoreModule, PersistenceModule, HealthModule, RealtimeModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
