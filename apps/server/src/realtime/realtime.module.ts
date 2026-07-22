import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeMessageService } from './realtime-message.service';

@Module({
  providers: [RealtimeGateway, RealtimeMessageService],
})
export class RealtimeModule {}
