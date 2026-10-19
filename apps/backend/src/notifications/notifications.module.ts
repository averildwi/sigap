import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  // The gateway reuses JwtStrategy (BR-77), which AuthModule exports.
  imports: [AuthModule],
  providers: [NotificationsService, RealtimeGateway],
  // Feature modules emit after commit through the gateway (BR-69).
  exports: [NotificationsService, RealtimeGateway],
})
export class NotificationsModule {}
