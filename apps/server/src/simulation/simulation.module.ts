import { Module } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import {
  SIMULATION_TIME_SOURCE,
  SystemSimulationTimeSource,
} from './simulation-time';

@Module({
  providers: [
    SimulationService,
    {
      provide: SIMULATION_TIME_SOURCE,
      useClass: SystemSimulationTimeSource,
    },
  ],
  exports: [SimulationService],
})
export class SimulationModule {}
