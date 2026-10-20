import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  assertAdmin,
  assertMember,
} from '../common/helpers/community-access.helper';
import { paginate, PaginatedResult } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  REALTIME_EVENTS,
  RealtimeGateway,
} from '../notifications/realtime.gateway';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto';

/** BR-33: missing id and an id of another community are the same 404. */
export const ANNOUNCEMENT_NOT_FOUND_MESSAGE = 'Announcement not found';

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

  /**
   * F-ANNOUNCEMENTS-2 / BR-33/35/36: any ADMIN of the community may edit.
   * BR-36: the same clear-then-set when the edit sets a highlight. No new
   * notification. A missing id and a foreign id answer the same 404 (BR-33).
   */
  async update(
    communityId: string,
    announcementId: string,
    dto: UpdateAnnouncementDto,
    userId: string,
  ): Promise<AnnouncementRow> {
    return this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, userId, communityId);

      // BR-36: clear before set, inside the same transaction.
      if (dto.isHighlight === true) {
        await tx.announcement.updateMany({
          where: { communityId, isHighlight: true },
          data: { isHighlight: false },
        });
      }

      const data: { title?: string; body?: string; isHighlight?: boolean } = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.body !== undefined) data.body = dto.body;
      if (dto.isHighlight !== undefined) data.isHighlight = dto.isHighlight;

      // Conditional update: 0 rows means missing or another community (BR-33).
      const updated = await tx.announcement.updateMany({
        where: { id: announcementId, communityId },
        data,
      });
      if (updated.count === 0) {
        throw new NotFoundException(ANNOUNCEMENT_NOT_FOUND_MESSAGE);
      }
      return tx.announcement.findUniqueOrThrow({
        where: { id: announcementId },
        select: announcementSelect,
      });
    });
  }

  /**
   * F-ANNOUNCEMENTS-3 / BR-38: the announcement's notifications are removed
   * in the same transaction, before the conditional delete (count 0 -> 404)
   * rolls everything back, so notifications never outlive the announcement.
   */
  async remove(
    communityId: string,
    announcementId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, userId, communityId);
      await tx.notification.deleteMany({
        where: { entityType: 'ANNOUNCEMENT', entityId: announcementId },
      });
      const deleted = await tx.announcement.deleteMany({
        where: { id: announcementId, communityId },
      });
      if (deleted.count === 0) {
        throw new NotFoundException(ANNOUNCEMENT_NOT_FOUND_MESSAGE);
      }
    });
  }

  /**
   * F-ANNOUNCEMENTS-4 / BR-31/39: any ACTIVE member lists; the community
   * highlight sorts first, then newest first (BR-39), searchable by title.
   */
  async findAll(
    communityId: string,
    userId: string,
    query: QueryAnnouncementsDto,
  ): Promise<PaginatedResult<AnnouncementRow>> {
    await assertMember(this.prisma, userId, communityId);
    const where: Prisma.AnnouncementWhereInput = {
      communityId,
      ...(query.search
        ? { title: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        select: announcementSelect,
        orderBy: [{ isHighlight: 'desc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.announcement.count({ where }),
    ]);
    return paginate(rows, total, query.page, query.limit);
  }

  /**
   * F-ANNOUNCEMENTS-5 / BR-31/33: any ACTIVE member reads; a missing id and
   * an id of another community answer the same 404 (BR-33).
   */
  async findOne(
    communityId: string,
    announcementId: string,
    userId: string,
  ): Promise<AnnouncementRow> {
    await assertMember(this.prisma, userId, communityId);
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: announcementId, communityId },
      select: announcementSelect,
    });
    if (!announcement) {
      throw new NotFoundException(ANNOUNCEMENT_NOT_FOUND_MESSAGE);
    }
    return announcement;
  }
}
