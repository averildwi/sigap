import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { assertAdmin } from '../common/helpers/community-access.helper';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  REALTIME_EVENTS,
  RealtimeGateway,
} from '../notifications/realtime.gateway';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

/** AnnouncementView of API_SPEC 0.3; no other column ever leaves the service. */
export const announcementSelect = {
  id: true,
  communityId: true,
  title: true,
  body: true,
  isHighlight: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.AnnouncementSelect;

export type AnnouncementRow = Prisma.AnnouncementGetPayload<{
  select: typeof announcementSelect;
}>;

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * F-ANNOUNCEMENTS-1 / BR-35/36/37: publish inside one transaction. BR-36
   * clears the current highlight first, then sets the new one (G-L4: without
   * a unique column two parallel highlights can both end up true; accepted,
   * the next highlight fixes it). BR-37 notifies every ACTIVE member except
   * the author with one bulk insert; the `notification:new` events go out
   * after the commit (BR-69).
   */
  async create(
    communityId: string,
    dto: CreateAnnouncementDto,
    userId: string,
  ): Promise<AnnouncementRow> {
    const result = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, userId, communityId);

      // BR-36: clear-then-set — at most one highlight per community.
      if (dto.isHighlight === true) {
        await tx.announcement.updateMany({
          where: { communityId, isHighlight: true },
          data: { isHighlight: false },
        });
      }

      const announcement = await tx.announcement.create({
        data: {
          communityId,
          authorId: userId,
          title: dto.title,
          body: dto.body,
          isHighlight: dto.isHighlight ?? false,
        },
        select: announcementSelect,
      });

      const members = await tx.membership.findMany({
        where: { communityId, status: 'ACTIVE' },
        select: { userId: true },
      });
      const createdNotifications = await this.notifications.createMany(tx, {
        userIds: members
          .map((member) => member.userId)
          .filter((id) => id !== userId),
        communityId,
        type: 'ANNOUNCEMENT',
        entityId: announcement.id,
        context: { title: dto.title },
      });
      return { announcement, createdNotifications };
    });

    // After the commit (BR-69): one event per recipient.
    for (const notification of result.createdNotifications) {
      const { userId: recipientId, ...view } = notification;
      this.realtime.emitToUsers(
        [recipientId],
        REALTIME_EVENTS.notificationNew,
        view,
      );
    }
    return result.announcement;
  }
}
