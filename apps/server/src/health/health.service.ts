import { Injectable } from '@nestjs/common';
import { HealthResponseDto } from '@city/shared-types';
import { PrismaService } from '../persistence/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<HealthResponseDto> {
    const databaseUp = await this.prisma.checkDatabase();
    return {
      status: databaseUp ? 'ok' : 'error',
      server: 'up',
      database: databaseUp ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }
}
