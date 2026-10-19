import { Module } from '@nestjs/common';
import { CommunityMembershipsController } from './community-memberships.controller';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // Notification writes and the after-commit emits (BR-66/69) come from here.
  imports: [NotificationsModule],
  controllers: [MembershipsController, CommunityMembershipsController],
  providers: [MembershipsService],
})
export class MembershipsModule {}
