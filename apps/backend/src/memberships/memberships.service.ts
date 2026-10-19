import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MembershipStatus,
  NotificationType,
} from '../../generated/prisma/client';
import { Prisma } from '../../generated/prisma/client';
import { formatLabel } from '../common/helpers/format-label.helper';
import { assertAdmin } from '../common/helpers/community-access.helper';
import { paginate, PaginatedResult } from '../common/helpers/paginate.helper';
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
import { QueryJoinRequestsDto } from './dto/query-join-requests.dto';

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

/** The join QR as GET /communities/:communityId/join-qr answers it (API_SPEC 4). */
export interface JoinQrView {
  communityId: string;
  label: string;
  qrContent: string;
  token: string;
  window: number;
  expiresInSeconds: number;
}

/** A row of the join request queue (API_SPEC 4, oldest first). */
export const joinRequestSelect = {
  id: true,
  houseBlock: true,
  requestedAt: true,
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.MembershipSelect;

export type JoinRequestRow = Prisma.MembershipGetPayload<{
  select: typeof joinRequestSelect;
}>;

/** A decided or role-changed membership plus its user ref (API_SPEC 4). */
export const membershipUserSelect = {
  ...membershipViewSelect,
  user: { select: { id: true, name: true } },
} satisfies Prisma.MembershipSelect;

export type MembershipWithUser = Prisma.MembershipGetPayload<{
  select: typeof membershipUserSelect;
}>;

/** MembershipView plus the user ref the decision endpoints answer with. */
export type MembershipViewWithUser = MembershipView & {
  user: { id: string; name: string };
};

/** BR-25 messages. */
export const NOT_PENDING_MESSAGE = 'Join request is no longer pending';
export const JOIN_REQUEST_NOT_FOUND_MESSAGE = 'Join request not found';

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

  /**
   * F-MEMBERSHIPS-1 / BR-19/32: the refreshed QR of the current window.
   * ADMIN first (assertAdmin), then the token; no write happens.
   */
  async getJoinQr(communityId: string, userId: string): Promise<JoinQrView> {
    await assertAdmin(this.prisma, userId, communityId);
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: communitySelect,
    });
    if (!community) throw new NotFoundException('Community not found');
    const now = new Date();
    const token = createJoinToken(communityId, this.joinTokenSecret(), now);
    return {
      communityId,
      label: formatLabel(community.rt, community.rw),
      qrContent: buildQrContent(communityId, token),
      token,
      window: currentWindow(now),
      expiresInSeconds: windowExpiresInSeconds(now),
    };
  }

  /**
   * F-MEMBERSHIPS-4 / BR-32: the PENDING queue, oldest first, searchable
   * by requester name or house block. Every requester is verified (BR-3).
   */
  async listJoinRequests(
    communityId: string,
    userId: string,
    query: QueryJoinRequestsDto,
  ): Promise<PaginatedResult<JoinRequestRow>> {
    await assertAdmin(this.prisma, userId, communityId);
    const search = query.search;
    const where: Prisma.MembershipWhereInput = {
      communityId,
      status: 'PENDING',
      ...(search
        ? {
            OR: [
              { user: { name: { contains: search, mode: 'insensitive' } } },
              { houseBlock: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.membership.findMany({
        where,
        select: joinRequestSelect,
        orderBy: { requestedAt: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.membership.count({ where }),
    ]);
    return paginate(rows, total, query.page, query.limit);
  }

  /**
   * F-MEMBERSHIPS-5 / F-MEMBERSHIPS-6 / BR-25: approve or reject works only
   * on PENDING via a conditional `updateMany`; a lost race (another admin
   * decided first) re-reads to answer 404 (missing or foreign row, BR-33)
   * vs 400. BR-66: JOIN_APPROVED / JOIN_REJECTED are in-app only (R-35).
   */
  async approve(
    communityId: string,
    membershipId: string,
    adminUserId: string,
  ): Promise<MembershipViewWithUser> {
    return this.decideJoinRequest(
      communityId,
      membershipId,
      adminUserId,
      'JOIN_APPROVED',
    );
  }

  async reject(
    communityId: string,
    membershipId: string,
    adminUserId: string,
  ): Promise<MembershipViewWithUser> {
    return this.decideJoinRequest(
      communityId,
      membershipId,
      adminUserId,
      'JOIN_REJECTED',
    );
  }

  /** Shared conditional update of BR-25; approve sets ACTIVE, reject REJECTED. */
  private async decideJoinRequest(
    communityId: string,
    membershipId: string,
    adminUserId: string,
    type: NotificationType,
  ): Promise<MembershipViewWithUser> {
    const now = new Date();
    const membership = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, adminUserId, communityId);
      const community = await tx.community.findUnique({
        where: { id: communityId },
        select: communitySelect,
      });
      if (!community) throw new NotFoundException('Community not found');

      const updated = await tx.membership.updateMany({
        where: { id: membershipId, communityId, status: 'PENDING' },
        data:
          type === 'JOIN_APPROVED'
            ? { status: 'ACTIVE', role: 'WARGA', decidedAt: now, joinedAt: now }
            : { status: 'REJECTED', role: 'WARGA', decidedAt: now },
      });
      if (updated.count === 0) {
        const row: { communityId: string } | null =
          await tx.membership.findUnique({
            where: { id: membershipId },
            select: { communityId: true },
          });
        // A foreign or missing row is 404, exactly like a missing id (BR-33).
        if (!row || row.communityId !== communityId) {
          throw new NotFoundException(JOIN_REQUEST_NOT_FOUND_MESSAGE);
        }
        throw new BadRequestException(NOT_PENDING_MESSAGE);
      }

      const decidedMembership = await tx.membership.findUnique({
        where: { id: membershipId },
        select: membershipUserSelect,
      });
      if (!decidedMembership) {
        throw new NotFoundException(JOIN_REQUEST_NOT_FOUND_MESSAGE);
      }
      await this.notifications.createMany(tx, {
        userIds: [decidedMembership.user.id],
        communityId,
        type,
        entityId: membershipId,
        context: { label: formatLabel(community.rt, community.rw) },
      });
      return decidedMembership;
    });

    // After the commit (BR-69): the requester gets the decision in-app.
    this.realtime.emitToUsers(
      [membership.user.id],
      REALTIME_EVENTS.notificationNew,
      { type, communityId, entityId: membershipId } satisfies NotificationEvent,
    );
    return {
      ...toMembershipView(membership),
      user: membership.user,
    };
  }
}
