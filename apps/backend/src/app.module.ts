import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AnnouncementsModule } from './announcements/announcements.module';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './common/config/app-config.module';
import { HashingModule } from './common/hashing/hashing.module';
import { MailModule } from './common/mail/mail.module';
import { RealtimeSessionsModule } from './common/realtime/realtime-sessions.module';
import { projectEnvSchema } from './config/env.schema';
import { buildThrottlerOptions } from './config/throttle.config';
import { CommunitiesModule } from './communities/communities.module';
import { HealthModule } from './health/health.module';
import { MembershipsModule } from './memberships/memberships.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule.forProject(projectEnvSchema),
    HashingModule,
    MailModule,
    RealtimeSessionsModule,
    // Named tiers from env (BR-80, deviation L-5).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildThrottlerOptions(config),
    }),
    PrismaModule,
    AnnouncementsModule,
    AuthModule,
    CommunitiesModule,
    MembershipsModule,
    HealthModule,
    NotificationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
