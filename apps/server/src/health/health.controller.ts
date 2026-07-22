import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthResponseDto } from '@city/shared-types';
import { HealthService } from './health.service';

/**
 * Transport-Schicht: kehrt lediglich das Ergebnis des HealthService aus.
 * Keine Geschäftslogik, kein Datenbankzugriff.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponseDto> {
    const health = await this.healthService.getHealth();
    response.status(
      health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return health;
  }
}
