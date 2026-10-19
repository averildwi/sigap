import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  // The gateway reuses JwtStrategy (BR-77), which AuthModule exports.
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, RealtimeGateway],
  // Feature modules emit after commit through the gateway (BR-69).
  exports: [NotificationsService, RealtimeGateway],
})
export class NotificationsModule {}
