import { Injectable } from '@nestjs/common';

export interface SimulationTimeSource {
  now(): Date;
}

export const SIMULATION_TIME_SOURCE = Symbol('SIMULATION_TIME_SOURCE');

@Injectable()
export class SystemSimulationTimeSource implements SimulationTimeSource {
  now(): Date {
    return new Date();
  }
}
