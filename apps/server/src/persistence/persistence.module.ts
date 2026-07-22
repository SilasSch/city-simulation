import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global registriert, damit fachliche Module den PrismaService nutzen können,
 * ohne PersistenceModule wiederholt importieren zu müssen.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PersistenceModule {}
