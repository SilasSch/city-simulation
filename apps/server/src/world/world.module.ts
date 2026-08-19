import { Module } from '@nestjs/common';
import { WorldPresenceService } from './world-presence.service';
import { WorldRepository } from './world.repository';
import { WorldService } from './world.service';

@Module({
  providers: [WorldPresenceService, WorldRepository, WorldService],
  exports: [WorldPresenceService, WorldService],
})
export class WorldModule {}
