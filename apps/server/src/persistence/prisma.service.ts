import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Einziger Zugangspunkt zur Datenbank. Controller, Gateways und andere
 * Transport-Schichten greifen niemals direkt auf Prisma zu.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Trennt erst nach `beforeApplicationShutdown`, damit dort noch letzte
   * Weltpositionen geschrieben werden können (ADR 0015).
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }

  /** Technischer Verbindungsnachweis ohne fachliche Tabellen. */
  async checkDatabase(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(
        'Database health check failed',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
