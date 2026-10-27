import { Module } from '@nestjs/common';
import { SimulationModule } from '../simulation/simulation.module';
import { WorldPositionService } from './world-position.service';
import { WorldPresenceService } from './world-presence.service';
import { WorldRepository } from './world.repository';
import { WorldService } from './world.service';

@Module({
  imports: [SimulationModule],
  providers: [
    WorldPositionService,
    WorldPresenceService,
    WorldRepository,
    WorldService,
  ],
  exports: [WorldPresenceService, WorldService],
})
export class WorldModule {}
