import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildNotificationText,
  NotificationTextContext,
} from './notification-templates';

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
}
