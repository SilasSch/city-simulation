import { Module } from '@nestjs/common';
import { SimulationModule } from '../simulation/simulation.module';
import { WorldPresenceService } from './world-presence.service';
import { WorldRepository } from './world.repository';
import { WorldService } from './world.service';

@Module({
  imports: [SimulationModule],
  providers: [WorldPresenceService, WorldRepository, WorldService],
  exports: [WorldPresenceService, WorldService],
})
export class WorldModule {}
