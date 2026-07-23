import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeMessageService } from './realtime-message.service';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RealtimeMessageService],
})
export class RealtimeModule {}
