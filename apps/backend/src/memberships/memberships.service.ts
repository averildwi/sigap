import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MembershipStatus,
  NotificationType,
} from '../../generated/prisma/client';
import { Prisma } from '../../generated/prisma/client';
import { formatLabel } from '../common/helpers/format-label.helper';
import {
  communitySelect,
  membershipViewSelect,
  toCommunitySummary,
  toMembershipView,
} from '../communities/communities.service';
import type {
  CommunitySummary,
  MembershipView,
} from '../common/helpers/community-view.helper';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  REALTIME_EVENTS,
  RealtimeGateway,
} from '../notifications/realtime.gateway';
import {
  buildQrContent,
  createJoinToken,
  isJoinTokenValid,
  currentWindow,
  windowExpiresInSeconds,
} from './join-token';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { PreviewMembershipDto } from './dto/preview-membership.dto';

/** Transaction subset the membership writes run on (helper reuse, nest-prisma). */
type MembershipClient = Pick<Prisma.TransactionClient, 'membership'>;

/** BR-20: unknown community and wrong/older token are the same 400 (E-11). */
export const INVALID_CODE_MESSAGE = 'Invalid or expired code';
/** BR-23: a PENDING or ACTIVE row already owns (user, community). */
export const ALREADY_MEMBER_MESSAGE =
  'You already have a request or membership in this community';

/** Payload of `join-request:new` after a join request was created (BR-69). */
export interface JoinRequestEvent {
  id: string;
  user: { id: string; name: string; email: string };
  houseBlock: string;
  requestedAt: Date;
}

/** Payload of `notification:new` for a fresh notification (BR-69). */
export interface NotificationEvent {
  type: NotificationType;
  communityId: string | null;
  entityId: string | null;
}

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** The HMAC key of the QR tokens (BR-19), read per call like every env var. */
  private joinTokenSecret(): string {
    return this.config.getOrThrow<string>('JOIN_TOKEN_SECRET');
  }

  /** BR-20: invalid or outdated token -> the shared 400 (E-11). */
  private assertTokenValid(
    communityId: string,
    token: string,
    now: Date,
  ): void {
    if (!isJoinTokenValid(communityId, token, this.joinTokenSecret(), now)) {
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }
  }

  /**
   * F-MEMBERSHIPS-2 / BR-19/20/80: read-only look at the community of a
   * scanned QR plus the caller's membership status. Unknown community and
   * a bad token answer the same 400 (BR-20); nothing is written.
   */
  async preview(
    dto: PreviewMembershipDto,
    userId: string,
  ): Promise<{
    community: CommunitySummary;
    myMembershipStatus: MembershipStatus | null;
  }> {
    const now = new Date();
    const community = await this.prisma.community.findUnique({
      where: { id: dto.communityId },
      select: communitySelect,
    });
    if (!community) throw new BadRequestException(INVALID_CODE_MESSAGE);
    this.assertTokenValid(dto.communityId, dto.token, now);
    const myMembership = await this.prisma.membership.findUnique({
      where: { userId_communityId: { userId, communityId: dto.communityId } },
      select: { status: true },
    });
    return {
      community: toCommunitySummary(community),
      myMembershipStatus: myMembership?.status ?? null,
    };
  }

  /**
   * F-MEMBERSHIPS-3 / BR-19/20/23/24: one PENDING row per
   * (user, community). BR-23 reuses a row from REJECTED/LEFT/REMOVED with
   * a conditional `updateMany`, otherwise creates; the unique index then
   * turns a PENDING/ACTIVE owner (e.g. the double-submit loser, E-8) into
   * P2002 -> 409. Only the winning request notifies the ACTIVE admins.
   */
  async join(
    dto: CreateMembershipDto,
    userId: string,
  ): Promise<{ membership: MembershipView; community: CommunitySummary }> {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const community = await tx.community.findUnique({
        where: { id: dto.communityId },
        select: communitySelect,
      });
      // Unknown community and bad token are one message (BR-20).
      if (!community) throw new BadRequestException(INVALID_CODE_MESSAGE);
      this.assertTokenValid(dto.communityId, dto.token, now);

      const reused = await tx.membership.updateMany({
        where: {
          userId,
          communityId: dto.communityId,
          status: { in: ['REJECTED', 'LEFT', 'REMOVED'] as const },
        },
        data: {
          status: 'PENDING',
          role: 'WARGA',
          houseBlock: dto.houseBlock,
          requestedAt: now,
          decidedAt: null,
          joinedAt: null,
        },
      });

      const membership =
        reused.count === 1
          ? await tx.membership.findUnique({
              where: {
                userId_communityId: { userId, communityId: dto.communityId },
              },
              select: membershipViewSelect,
            })
          : await this.createMembership(tx, dto, userId, now);
      if (!membership) throw new BadRequestException(INVALID_CODE_MESSAGE);

      // Only the request that changed a row notifies the admins (BR-23, E-8).
      const requester = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      });
      const admins = await tx.membership.findMany({
        where: {
          communityId: dto.communityId,
          status: 'ACTIVE',
          role: 'ADMIN',
        },
        select: { userId: true },
      });
      await this.notifications.createMany(tx, {
        userIds: admins.map((admin) => admin.userId),
        communityId: dto.communityId,
        type: 'JOIN_REQUEST',
        entityId: membership.id,
        context: {
          userName: requester?.name ?? '',
          houseBlock: dto.houseBlock,
          label: formatLabel(community.rt, community.rw),
        },
      });
      return {
        membership,
        community,
        requester,
        adminIds: admins.map((admin) => admin.userId),
      };
    });

    // After the commit (BR-69): the admin queue refreshes and the badge pops.
    this.realtime.emitToUsers(result.adminIds, REALTIME_EVENTS.joinRequestNew, {
      id: result.membership.id,
      user: {
        id: result.requester?.id ?? userId,
        name: result.requester?.name ?? '',
        email: result.requester?.email ?? '',
      },
      houseBlock: result.membership.houseBlock,
      requestedAt: result.membership.requestedAt,
    } satisfies JoinRequestEvent);
    this.realtime.emitToUsers(
      result.adminIds,
      REALTIME_EVENTS.notificationNew,
      {
        type: 'JOIN_REQUEST',
        communityId: dto.communityId,
        entityId: result.membership.id,
      } satisfies NotificationEvent,
    );

    return {
      membership: toMembershipView(result.membership),
      community: toCommunitySummary(result.community),
    };
  }

  /** New row; a PENDING/ACTIVE owner (double submit) loses the race (E-8). */
  private async createMembership(
    tx: MembershipClient,
    dto: CreateMembershipDto,
    userId: string,
    now: Date,
  ): Promise<MembershipView> {
    try {
      return await tx.membership.create({
        data: {
          userId,
          communityId: dto.communityId,
          houseBlock: dto.houseBlock,
          requestedAt: now,
        },
        select: membershipViewSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(ALREADY_MEMBER_MESSAGE);
      }
      throw error;
    }
  }
}

/** The join QR as GET /communities/:communityId/join-qr answers it (API_SPEC 4). */
export { buildJoinQrView };

/** Exposed for the controller additions of the next commits. */
function buildJoinQrView(
  communityId: string,
  rt: number,
  rw: number,
  secret: string,
  now: Date,
): {
  communityId: string;
  label: string;
  qrContent: string;
  token: string;
  window: number;
  expiresInSeconds: number;
} {
  const token = createJoinToken(communityId, secret, now);
  return {
    communityId,
    label: formatLabel(rt, rw),
    qrContent: buildQrContent(communityId, token),
    token,
    window: currentWindow(now),
    expiresInSeconds: windowExpiresInSeconds(now),
  };
}
