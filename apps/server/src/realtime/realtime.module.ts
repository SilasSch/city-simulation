import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SimulationModule } from '../simulation/simulation.module';
import { WorldModule } from '../world/world.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeMessageService } from './realtime-message.service';

@Module({
  imports: [AuthModule, SimulationModule, WorldModule],
  providers: [RealtimeGateway, RealtimeMessageService],
})
export class RealtimeModule {}
