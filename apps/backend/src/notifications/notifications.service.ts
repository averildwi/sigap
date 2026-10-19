import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '../../generated/prisma/client';
import { paginate, PaginatedResult } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildNotificationText,
  NotificationTextContext,
} from './notification-templates';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

/** NotificationView of API_SPEC 0.3; no other column ever leaves the service. */
export const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  communityId: true,
  entityType: true,
  entityId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

/** The Prisma client a notification write runs on (inside a caller's transaction). */
export type NotificationTxClient = Pick<
  Prisma.TransactionClient,
  'notification'
>;

/** One event fanned out to its recipients (BR-66). */
export interface NotificationFanoutInput {
  userIds: string[];
  communityId: string | null;
  type: NotificationType;
  entityId: string | null;
  context: NotificationTextContext;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write side (BR-65/66): one event -> one row per recipient, written
   * inside the caller's transaction with `tx`. The texts come from the
   * pure template function; no service writes literal texts (API_SPEC 8).
   */
  async createMany(
    tx: NotificationTxClient,
    input: NotificationFanoutInput,
  ): Promise<void> {
    if (input.userIds.length === 0) return;

    const { title, body, entityType } = buildNotificationText(
      input.type,
      input.context,
    );
    await tx.notification.createMany({
      data: input.userIds.map((userId) => ({
        userId,
        communityId: input.communityId,
        type: input.type,
        title,
        body,
        entityType,
        entityId: input.entityId,
      })),
    });
  }

  /**
   * F-NOTIFICATIONS-1 / BR-65: the caller's rows only, newest first,
   * filterable by unread and by community.
   */
  async findAll(
    query: QueryNotificationsDto,
    userId: string,
  ): Promise<PaginatedResult<NotificationRow>> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread ? { readAt: null } : {}),
      ...(query.communityId ? { communityId: query.communityId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginate(rows, total, query.page, query.limit);
  }

  /** F-NOTIFICATIONS-1: the unread badge count. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  /**
   * F-NOTIFICATIONS-2 / BR-65: only the caller's unread rows are written
   * (`updateMany` where `userId` and `readAt: null`); a foreign id and a
   * missing id give the same 404, an already-read id answers as is.
   */
  async markRead(id: string, userId: string): Promise<NotificationRow> {
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    // Already-read rows are answered as is; a foreign or missing id is 404.
    const row = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: notificationSelect,
    });
    if (updated.count === 0 && !row) {
      throw new NotFoundException('Notification not found');
    }
    return row as NotificationRow;
  }

  /** F-NOTIFICATIONS-2 / BR-65: mark-all touches only the caller's rows. */
  async readAll(userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }
}
