import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import {
  assertAdmin,
  assertMember,
  NOT_MEMBER_MESSAGE,
} from '../common/helpers/community-access.helper';
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
import { QueryMembersDto } from './dto/query-members.dto';
import { ChangeMembershipRoleDto } from './dto/change-membership-role.dto';

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

/** Admin operation messages (BR-27..30). */
export const MEMBER_NOT_FOUND_MESSAGE = 'Member not found';
export const MEMBER_NOT_ACTIVE_MESSAGE = 'Member is not active';
export const NEEDS_ADMIN_MESSAGE = 'A community needs at least one admin';
export const REMOVE_SELF_MESSAGE = 'You cannot remove yourself, leave instead';
export const PROMOTE_FIRST_MESSAGE = 'Promote another admin first';

/** A member row of the member list (API_SPEC 4). */
export const memberListSelect = {
  id: true,
  houseBlock: true,
  role: true,
  status: true,
  joinedAt: true,
  user: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.MembershipSelect;

export type MemberListRow = Prisma.MembershipGetPayload<{
  select: typeof memberListSelect;
}>;

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

  /**
   * F-MEMBERSHIPS-10 / BR-32: the member list, ADMIN first then by name,
   * filterable by status (default ACTIVE) and role, searchable.
   */
  async listMembers(
    communityId: string,
    userId: string,
    query: QueryMembersDto,
  ): Promise<PaginatedResult<MemberListRow>> {
    await assertAdmin(this.prisma, userId, communityId);
    const search = query.search;
    const where: Prisma.MembershipWhereInput = {
      communityId,
      status: query.status ?? 'ACTIVE',
      ...(query.role ? { role: query.role } : {}),
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
        select: memberListSelect,
        orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.membership.count({ where }),
    ]);
    return paginate(rows, total, query.page, query.limit);
  }

  /**
   * F-MEMBERSHIPS-11 / BR-27/29: role change on an ACTIVE member. A demotion
   * must keep at least one other ACTIVE ADMIN; the conditional update lets
   * a race lose with 400 (G-L2: two admins demoting each other at once can
   * both pass the count). Demoting to the same role answers unchanged.
   */
  async changeRole(
    communityId: string,
    membershipId: string,
    adminUserId: string,
    dto: ChangeMembershipRoleDto,
  ): Promise<MembershipViewWithUser> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, adminUserId, communityId);
      const target = await tx.membership.findUnique({
        where: { id: membershipId },
        select: { id: true, communityId: true, status: true, role: true },
      });
      if (!target || target.communityId !== communityId) {
        throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
      }
      if (target.status !== 'ACTIVE') {
        throw new BadRequestException(MEMBER_NOT_ACTIVE_MESSAGE);
      }
      if (target.role === 'ADMIN' && dto.role === 'WARGA') {
        await this.assertOtherAdmin(tx, communityId);
      }
      const result = await tx.membership.updateMany({
        where: { id: membershipId, communityId, status: 'ACTIVE' },
        data: { role: dto.role },
      });
      if (result.count === 0) {
        throw new BadRequestException(MEMBER_NOT_ACTIVE_MESSAGE);
      }
      return tx.membership.findUnique({
        where: { id: membershipId },
        select: membershipUserSelect,
      });
    });
    if (!updated) throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
    return { ...toMembershipView(updated), user: updated.user };
  }

  /**
   * F-MEMBERSHIPS-9 / BR-27/28/30: an admin removes any ACTIVE member but
   * never themselves (use leave) and never the last ACTIVE ADMIN. Removal
   * sets REMOVED with role WARGA and decidedAt.
   */
  async remove(
    communityId: string,
    membershipId: string,
    adminUserId: string,
  ): Promise<MembershipViewWithUser> {
    const now = new Date();
    const removed = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, adminUserId, communityId);
      const target = await tx.membership.findUnique({
        where: { id: membershipId },
        select: {
          id: true,
          communityId: true,
          status: true,
          role: true,
          userId: true,
        },
      });
      if (!target || target.communityId !== communityId) {
        throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
      }
      // Removing yourself is answered by the leave endpoint instead (BR-28).
      if (target.userId === adminUserId) {
        throw new BadRequestException(REMOVE_SELF_MESSAGE);
      }
      if (target.status !== 'ACTIVE') {
        throw new BadRequestException(MEMBER_NOT_ACTIVE_MESSAGE);
      }
      if (target.role === 'ADMIN') {
        await this.assertOtherAdmin(tx, communityId);
      }
      const result = await tx.membership.updateMany({
        where: { id: membershipId, communityId, status: 'ACTIVE' },
        data: { status: 'REMOVED', role: 'WARGA', decidedAt: now },
      });
      if (result.count === 0) {
        throw new BadRequestException(MEMBER_NOT_ACTIVE_MESSAGE);
      }
      return tx.membership.findUnique({
        where: { id: membershipId },
        select: membershipUserSelect,
      });
    });
    if (!removed) throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
    return { ...toMembershipView(removed), user: removed.user };
  }

  /**
   * F-MEMBERSHIPS-8 / BR-27/30: an ACTIVE member leaves; LEFT resets the
   * role to WARGA. The last ACTIVE ADMIN cannot leave, even when they are
   * the only member (G-L14): promote another admin first.
   */
  async leave(communityId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const myMembership = await assertMember(tx, userId, communityId);
      if (myMembership.role === 'ADMIN') {
        const admins = await tx.membership.count({
          where: { communityId, status: 'ACTIVE', role: 'ADMIN' },
        });
        if (admins <= 1) {
          throw new BadRequestException(PROMOTE_FIRST_MESSAGE);
        }
      }
      const result = await tx.membership.updateMany({
        where: { userId, communityId, status: 'ACTIVE' },
        data: { status: 'LEFT', role: 'WARGA' },
      });
      if (result.count === 0) {
        throw new ForbiddenException(NOT_MEMBER_MESSAGE);
      }
    });
  }

  /** BR-27 helper: refuse when `communityId` has exactly one ACTIVE ADMIN. */
  private async assertOtherAdmin(
    tx: MembershipClient,
    communityId: string,
  ): Promise<void> {
    const admins = await tx.membership.count({
      where: { communityId, status: 'ACTIVE', role: 'ADMIN' },
    });
    if (admins <= 1) {
      throw new BadRequestException(NEEDS_ADMIN_MESSAGE);
    }
  }
}
