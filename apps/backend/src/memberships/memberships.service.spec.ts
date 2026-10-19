import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { formatLabel } from '../common/helpers/format-label.helper';
import {
  communitySelect,
  toCommunitySummary,
} from '../communities/communities.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../notifications/realtime.gateway';
import {
  ALREADY_MEMBER_MESSAGE,
  MembershipsService,
  INVALID_CODE_MESSAGE,
} from './memberships.service';
import { computeJoinToken, currentWindow } from './join-token';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { PreviewMembershipDto } from './dto/preview-membership.dto';
import { QueryJoinRequestsDto } from './dto/query-join-requests.dto';
import { QueryMembersDto } from './dto/query-members.dto';
import { ChangeMembershipRoleDto } from './dto/change-membership-role.dto';

const roleDto = (
  role: ChangeMembershipRoleDto['role'],
): ChangeMembershipRoleDto =>
  plainToInstance(ChangeMembershipRoleDto, { role });

const SECRET = 'x'.repeat(32);
const COMMUNITY_ID = '3f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
const USER_ID = '4f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
const NOW = new Date('2026-10-19T08:05:00Z');

const COMMUNITY_ROW = {
  id: COMMUNITY_ID,
  rt: 1,
  rw: 6,
  province: 'Jawa Barat',
  city: 'Kota Cimahi',
  district: 'Cimahi Tengah',
  village: 'Kel. Suka Maju',
  name: 'Griya Asri',
};

const CURRENT_TOKEN = () =>
  computeJoinToken(COMMUNITY_ID, currentWindow(new Date()), SECRET);

interface TxMock {
  community: { findUnique: jest.Mock };
  membership: {
    updateMany: jest.Mock;
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  user: { findUnique: jest.Mock };
}

describe('MembershipsService.preview', () => {
  let service: MembershipsService;
  let prisma: {
    community: { findUnique: jest.Mock };
    membership: { findUnique: jest.Mock };
  };

  const dto = (): PreviewMembershipDto =>
    plainToInstance(PreviewMembershipDto, {
      communityId: COMMUNITY_ID,
      token: CURRENT_TOKEN(),
    });

  beforeEach(async () => {
    prisma = {
      community: { findUnique: jest.fn().mockResolvedValue(COMMUNITY_ROW) },
      membership: { findUnique: jest.fn() },
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: RealtimeGateway, useValue: { emitToUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MembershipsService);
  });

  it('answers 400 for an unknown community, without touching the membership (BR-20)', async () => {
    prisma.community.findUnique.mockResolvedValue(null);

    await expect(service.preview(dto(), USER_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('answers the same 400 for a wrong token (BR-20, E-11)', async () => {
    const wrong = plainToInstance(PreviewMembershipDto, {
      communityId: COMMUNITY_ID,
      token: 'a'.repeat(22),
    });

    await expect(service.preview(wrong, USER_ID)).rejects.toEqual(
      new BadRequestException(INVALID_CODE_MESSAGE),
    );
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('returns the community summary and no status when never a member', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);

    const result = await service.preview(dto(), USER_ID);

    expect(result.community).toEqual(toCommunitySummary(COMMUNITY_ROW));
    expect(result.community.label).toBe(formatLabel(1, 6));
    expect(result.myMembershipStatus).toBeNull();
    expect(prisma.community.findUnique).toHaveBeenCalledWith({
      where: { id: COMMUNITY_ID },
      select: communitySelect,
    });
  });

  it('reports the current membership status', async () => {
    prisma.membership.findUnique.mockResolvedValue({ status: 'ACTIVE' });

    const result = await service.preview(dto(), USER_ID);

    expect(result.myMembershipStatus).toBe('ACTIVE');
  });
});

describe('MembershipsService.join', () => {
  let service: MembershipsService;
  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };
  let notifications: { createMany: jest.Mock };
  let realtime: { emitToUsers: jest.Mock };

  const dto = (): CreateMembershipDto =>
    plainToInstance(CreateMembershipDto, {
      communityId: COMMUNITY_ID,
      token: CURRENT_TOKEN(),
      houseBlock: ' Blok C2 No. 14 ',
    });

  beforeEach(async () => {
    tx = {
      community: { findUnique: jest.fn().mockResolvedValue(COMMUNITY_ROW) },
      membership: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: 'membership-1',
          communityId: COMMUNITY_ID,
          status: 'PENDING',
          role: 'WARGA',
          houseBlock: 'Blok C2 No. 14',
          requestedAt: NOW,
          decidedAt: null,
          joinedAt: null,
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'membership-2',
          communityId: COMMUNITY_ID,
          status: 'PENDING',
          role: 'WARGA',
          houseBlock: 'Blok C2 No. 14',
          requestedAt: NOW,
          decidedAt: null,
          joinedAt: null,
        }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: 'admin-1' }, { userId: 'admin-2' }]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: USER_ID,
          name: 'Budi',
          email: 'budi@example.com',
        }),
      },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: TxMock) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    notifications = { createMany: jest.fn() };
    realtime = { emitToUsers: jest.fn() };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: notifications },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();
    service = moduleRef.get(MembershipsService);
  });

  it('answers 400 and writes nothing for an unknown community (BR-20)', async () => {
    tx.community.findUnique.mockResolvedValue(null);

    await expect(service.join(dto(), USER_ID)).rejects.toEqual(
      new BadRequestException(INVALID_CODE_MESSAGE),
    );
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
    expect(tx.membership.create).not.toHaveBeenCalled();
  });

  it('answers the same 400 and writes nothing for a wrong token (BR-20)', async () => {
    const wrong = plainToInstance(CreateMembershipDto, {
      communityId: COMMUNITY_ID,
      token: 'a'.repeat(22),
      houseBlock: 'Blok C2 No. 14',
    });

    await expect(service.join(wrong, USER_ID)).rejects.toEqual(
      new BadRequestException(INVALID_CODE_MESSAGE),
    );
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
    expect(tx.membership.create).not.toHaveBeenCalled();
  });

  it('reuses the row from a rejected attempt as PENDING WARGA (BR-23)', async () => {
    tx.membership.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.join(dto(), USER_ID);

    const [reuseCall] = tx.membership.updateMany.mock.calls[0] as [
      {
        where: Record<string, unknown>;
        data: {
          status: string;
          role: string;
          houseBlock: string;
          requestedAt: unknown;
          decidedAt: unknown;
          joinedAt: unknown;
        };
      },
    ];
    expect(reuseCall.where).toEqual({
      userId: USER_ID,
      communityId: COMMUNITY_ID,
      status: { in: ['REJECTED', 'LEFT', 'REMOVED'] },
    });
    expect(reuseCall.data.status).toBe('PENDING');
    expect(reuseCall.data.role).toBe('WARGA');
    expect(reuseCall.data.houseBlock).toBe('Blok C2 No. 14');
    expect(reuseCall.data.requestedAt).toBeInstanceOf(Date);
    expect(reuseCall.data.decidedAt).toBeNull();
    expect(reuseCall.data.joinedAt).toBeNull();
    expect(tx.membership.create).not.toHaveBeenCalled();
    expect(result.membership.status).toBe('PENDING');
    expect(result.community.id).toBe(COMMUNITY_ID);
  });

  it('creates a new PENDING row when there is nothing to reuse', async () => {
    await service.join(dto(), USER_ID);

    const [createCall] = tx.membership.create.mock.calls[0] as [
      {
        data: Record<string, unknown>;
      },
    ];
    // The trimmed house block of the DTO is stored (BR-24).
    expect(createCall.data.userId).toBe(USER_ID);
    expect(createCall.data.communityId).toBe(COMMUNITY_ID);
    expect(createCall.data.houseBlock).toBe('Blok C2 No. 14');
    expect(createCall.data.requestedAt).toBeInstanceOf(Date);
  });

  it('answers 409 when the row is already PENDING or ACTIVE (E-8, BR-23)', async () => {
    tx.membership.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    await expect(service.join(dto(), USER_ID)).rejects.toEqual(
      new ConflictException(ALREADY_MEMBER_MESSAGE),
    );
    // The loser of the race never notifies anyone (exactly one winner).
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('rethrows errors that are not a membership collision', async () => {
    tx.membership.create.mockRejectedValue(new Error('boom'));

    await expect(service.join(dto(), USER_ID)).rejects.toBeInstanceOf(Error);
  });

  it('notifies only the ACTIVE admins of the community (BR-23, BR-66)', async () => {
    await service.join(dto(), USER_ID);

    const [txArg, input] = notifications.createMany.mock.calls[0] as [
      unknown,
      {
        userIds: string[];
        communityId: string;
        type: string;
        entityId: string;
        context: Record<string, string>;
      },
    ];
    expect(txArg).toBe(tx);
    expect(input.userIds).toEqual(['admin-1', 'admin-2']);
    expect(input.type).toBe('JOIN_REQUEST');
    expect(input.entityId).toBe('membership-1');
    expect(input.context).toEqual({
      userName: 'Budi',
      houseBlock: 'Blok C2 No. 14',
      label: formatLabel(1, 6),
    });
    // After the commit: both realtime events go to the admins only (BR-69).
    expect(realtime.emitToUsers).toHaveBeenCalledTimes(2);
    expect(realtime.emitToUsers).toHaveBeenNthCalledWith(
      1,
      ['admin-1', 'admin-2'],
      'join-request:new',
      expect.objectContaining({
        id: 'membership-1',
        houseBlock: 'Blok C2 No. 14',
      }),
    );
    expect(realtime.emitToUsers).toHaveBeenNthCalledWith(
      2,
      ['admin-1', 'admin-2'],
      'notification:new',
      {
        type: 'JOIN_REQUEST',
        communityId: COMMUNITY_ID,
        entityId: 'membership-1',
      },
    );
  });
});

describe('PreviewMembershipDto / CreateMembershipDto (BR-19, BR-24)', () => {
  const previewBase = {
    communityId: COMMUNITY_ID,
    token: 'pX2fK9abC3deF5ghI7jkL4',
  };

  it('requires a uuid community id and a 22 character token', () => {
    expect(
      validateSync(plainToInstance(PreviewMembershipDto, previewBase)),
    ).toEqual([]);

    const shortToken = validateSync(
      plainToInstance(PreviewMembershipDto, {
        ...previewBase,
        token: 'too-short',
      }),
    );
    expect(shortToken).not.toEqual([]);

    const communityId = validateSync(
      plainToInstance(PreviewMembershipDto, {
        ...previewBase,
        communityId: 'nope',
      }),
    );
    expect(communityId).not.toEqual([]);
  });

  it('trims the house block and keeps it between 1 and 50 characters', () => {
    const dto = plainToInstance(CreateMembershipDto, {
      ...previewBase,
      houseBlock: '  Blok C2 No. 14  ',
    });
    expect(dto.houseBlock).toBe('Blok C2 No. 14');
    expect(validateSync(dto)).toEqual([]);

    const empty = plainToInstance(CreateMembershipDto, {
      ...previewBase,
      houseBlock: ' ',
    });
    expect(validateSync(empty)).not.toEqual([]);
  });
});

describe('MembershipsService.getJoinQr', () => {
  let service: MembershipsService;
  let prisma: {
    membership: { findFirst: jest.Mock };
    community: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      membership: { findFirst: jest.fn() },
      community: { findUnique: jest.fn().mockResolvedValue(COMMUNITY_ROW) },
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: RealtimeGateway, useValue: { emitToUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MembershipsService);
  });

  it('answers 403 for a non-member before any other check (BR-31)', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(service.getJoinQr(COMMUNITY_ID, USER_ID)).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(prisma.community.findUnique).not.toHaveBeenCalled();
  });

  it('answers 403 for a member without the ADMIN role (BR-32)', async () => {
    prisma.membership.findFirst.mockResolvedValue({
      id: 'membership-1',
      role: 'WARGA',
      status: 'ACTIVE',
    });

    await expect(service.getJoinQr(COMMUNITY_ID, USER_ID)).rejects.toEqual(
      new ForbiddenException('Admin access required'),
    );
    expect(prisma.community.findUnique).not.toHaveBeenCalled();
  });

  it('returns the QR of the current window (F-MEMBERSHIPS-1, BR-19)', async () => {
    prisma.membership.findFirst.mockResolvedValue({
      id: 'membership-1',
      role: 'ADMIN',
      status: 'ACTIVE',
    });

    const view = await service.getJoinQr(COMMUNITY_ID, USER_ID);

    expect(view.token).toBe(CURRENT_TOKEN());
    expect(view.communityId).toBe(COMMUNITY_ID);
    expect(view.label).toBe('RT001/RW006');
    expect(view.qrContent).toBe(`wargakita:join:${COMMUNITY_ID}:${view.token}`);
    expect(view.window).toBe(currentWindow(new Date()));
    // The dashed window always has seconds left for the refresh.
    expect(view.expiresInSeconds).toBeGreaterThanOrEqual(1);
    expect(view.expiresInSeconds).toBeLessThanOrEqual(60);
  });
});

describe('MembershipsService.listJoinRequests', () => {
  let service: MembershipsService;
  let prisma: {
    membership: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  const query = (): QueryJoinRequestsDto =>
    plainToInstance(QueryJoinRequestsDto, {});
  const adminRow = () => ({ id: 'm1', role: 'ADMIN', status: 'ACTIVE' });

  beforeEach(async () => {
    prisma = {
      // Batch variant of $transaction: findMany + count (nest-testing rule 4).
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      membership: {
        findFirst: jest.fn().mockImplementation(adminRow),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm2',
            houseBlock: 'Blok C2 No. 14',
            requestedAt: new Date('2026-10-19T08:00:00Z'),
            user: { id: USER_ID, name: 'Budi', email: 'budi@example.com' },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: RealtimeGateway, useValue: { emitToUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MembershipsService);
  });

  it('answers 403 when the caller is no ACTIVE ADMIN (BR-31/32)', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.listJoinRequests(COMMUNITY_ID, USER_ID, query()),
    ).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
  });

  it('lists PENDING rows oldest first (F-MEMBERSHIPS-4)', async () => {
    const result = await service.listJoinRequests(
      COMMUNITY_ID,
      USER_ID,
      query(),
    );

    const [findManyCall] = prisma.membership.findMany.mock.calls[0] as [
      {
        where: Record<string, unknown>;
        orderBy: unknown;
        skip: number;
        take: number;
      },
    ];
    expect(findManyCall.where).toEqual({
      communityId: COMMUNITY_ID,
      status: 'PENDING',
    });
    expect(findManyCall.orderBy).toEqual({ requestedAt: 'asc' });
    expect(findManyCall.skip).toBe(0);
    expect(findManyCall.take).toBe(20);
    expect(result.data[0]?.user.name).toBe('Budi');
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('searches by requester name or house block (F-MEMBERSHIPS-4)', async () => {
    const search = plainToInstance(QueryJoinRequestsDto, { search: 'budi' });

    await service.listJoinRequests(COMMUNITY_ID, USER_ID, search);

    expect(prisma.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          communityId: COMMUNITY_ID,
          status: 'PENDING',
          OR: [
            { user: { name: { contains: 'budi', mode: 'insensitive' } } },
            { houseBlock: { contains: 'budi', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });
});

describe('MembershipsService.approve / reject', () => {
  let service: MembershipsService;
  let tx: {
    membership: {
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    community: { findUnique: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };
  let notifications: { createMany: jest.Mock };
  let realtime: { emitToUsers: jest.Mock };

  const requesterUser = () => ({ id: USER_ID, name: 'Budi' });
  const activeRow = () => ({
    id: 'membership-1',
    communityId: COMMUNITY_ID,
    status: 'ACTIVE',
    role: 'WARGA',
    houseBlock: 'Blok C2 No. 14',
    requestedAt: NOW,
    decidedAt: NOW,
    joinedAt: NOW,
    user: requesterUser(),
  });

  beforeEach(async () => {
    tx = {
      // One ACTIVE ADMIN row so assertAdmin passes by default.
      membership: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockImplementation(activeRow),
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-admin',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
      },
      community: { findUnique: jest.fn().mockResolvedValue(COMMUNITY_ROW) },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    notifications = { createMany: jest.fn() };
    realtime = { emitToUsers: jest.fn() };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: notifications },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();
    service = moduleRef.get(MembershipsService);
  });

  it('answers 403 when the caller is no ACTIVE ADMIN (BR-31/32)', async () => {
    tx.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.approve(COMMUNITY_ID, 'membership-1', USER_ID),
    ).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing join request (BR-25, BR-33)', async () => {
    tx.membership.updateMany.mockResolvedValue({ count: 0 });
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(
      service.approve(COMMUNITY_ID, 'membership-1', USER_ID),
    ).rejects.toEqual(new NotFoundException('Join request not found'));
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a join request of another community (BR-33)', async () => {
    tx.membership.updateMany.mockResolvedValue({ count: 0 });
    tx.membership.findUnique.mockResolvedValue({
      communityId: '9f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d',
    });

    await expect(
      service.approve(COMMUNITY_ID, 'membership-1', USER_ID),
    ).rejects.toEqual(new NotFoundException('Join request not found'));
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('answers 400 when the request is no longer pending (BR-25, E-1)', async () => {
    tx.membership.updateMany.mockResolvedValue({ count: 0 });
    tx.membership.findUnique.mockResolvedValue({ communityId: COMMUNITY_ID });

    await expect(
      service.reject(COMMUNITY_ID, 'membership-1', USER_ID),
    ).rejects.toEqual(
      new BadRequestException('Join request is no longer pending'),
    );
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('approves to ACTIVE WARGA and notifies the requester (BR-25, BR-66)', async () => {
    const result = await service.approve(
      COMMUNITY_ID,
      'membership-1',
      'admin-1',
    );

    expect(result.status).toBe('ACTIVE');
    expect(result.role).toBe('WARGA');
    expect(result.user).toEqual(requesterUser());
    const [updateCall] = tx.membership.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(updateCall.where).toEqual({
      id: 'membership-1',
      communityId: COMMUNITY_ID,
      status: 'PENDING',
    });
    expect(updateCall.data.status).toBe('ACTIVE');
    expect(updateCall.data.role).toBe('WARGA');
    expect(updateCall.data.decidedAt).toBeInstanceOf(Date);
    expect(updateCall.data.joinedAt).toBeInstanceOf(Date);
    expect(notifications.createMany).toHaveBeenCalledWith(tx, {
      userIds: [USER_ID],
      communityId: COMMUNITY_ID,
      type: 'JOIN_APPROVED',
      entityId: 'membership-1',
      context: { label: 'RT001/RW006' },
    });
    // After the commit: the in-app event reaches the requester only (BR-69).
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      [USER_ID],
      'notification:new',
      {
        type: 'JOIN_APPROVED',
        communityId: COMMUNITY_ID,
        entityId: 'membership-1',
      },
    );
  });

  it('rejects to REJECTED WARGA without touching joinedAt (BR-25)', async () => {
    // The re-read after the conditional update mirrors the new status.
    tx.membership.findUnique.mockResolvedValue({
      ...activeRow(),
      status: 'REJECTED',
    });
    const result = await service.reject(
      COMMUNITY_ID,
      'membership-1',
      'admin-1',
    );

    expect(result.status).toBe('REJECTED');
    const [updateCall] = tx.membership.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(updateCall.where).toEqual({
      id: 'membership-1',
      communityId: COMMUNITY_ID,
      status: 'PENDING',
    });
    expect(updateCall.data.status).toBe('REJECTED');
    expect(updateCall.data.role).toBe('WARGA');
    expect(updateCall.data.decidedAt).toBeInstanceOf(Date);
    expect(updateCall.data).not.toHaveProperty('joinedAt');
    expect(notifications.createMany).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'JOIN_REJECTED', userIds: [USER_ID] }),
    );
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      [USER_ID],
      'notification:new',
      {
        type: 'JOIN_REJECTED',
        communityId: COMMUNITY_ID,
        entityId: 'membership-1',
      },
    );
  });
});

describe('MembershipsService.listMembers', () => {
  let service: MembershipsService;
  let prisma: {
    membership: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  const query = (): QueryMembersDto => plainToInstance(QueryMembersDto, {});

  beforeEach(async () => {
    prisma = {
      // Batch variant of $transaction: findMany + count (nest-testing rule 4).
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-admin',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm2',
            houseBlock: 'Blok C2 No. 14',
            role: 'WARGA',
            status: 'ACTIVE',
            joinedAt: NOW,
            user: { id: USER_ID, name: 'Budi', phone: '+628123456789' },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: RealtimeGateway, useValue: { emitToUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MembershipsService);
  });

  it('answers 403 when the caller is no ACTIVE ADMIN (BR-31/32)', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.listMembers(COMMUNITY_ID, USER_ID, query()),
    ).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
  });

  it('reads ACTIVE members by default, admins first then by name (F-MEMBERSHIPS-10)', async () => {
    const result = await service.listMembers(COMMUNITY_ID, USER_ID, query());

    const [findManyCall] = prisma.membership.findMany.mock.calls[0] as [
      {
        where: Record<string, unknown>;
        orderBy: unknown;
        skip: number;
        take: number;
      },
    ];
    expect(findManyCall.where).toEqual({
      communityId: COMMUNITY_ID,
      status: 'ACTIVE',
    });
    expect(findManyCall.orderBy).toEqual([
      { role: 'asc' },
      { user: { name: 'asc' } },
    ]);
    expect(result.data[0]?.user.phone).toBe('+628123456789');
    expect(result.meta.total).toBe(1);
  });

  it('filters by status, role and search when named (F-MEMBERSHIPS-10)', async () => {
    const filtered = plainToInstance(QueryMembersDto, {
      status: 'LEFT',
      role: 'ADMIN',
      search: 'budi',
    });

    await service.listMembers(COMMUNITY_ID, USER_ID, filtered);

    expect(prisma.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          communityId: COMMUNITY_ID,
          status: 'LEFT',
          role: 'ADMIN',
          OR: [
            { user: { name: { contains: 'budi', mode: 'insensitive' } } },
            { houseBlock: { contains: 'budi', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });
});

describe('MembershipsService.changeRole', () => {
  let service: MembershipsService;
  let tx: {
    membership: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
    };
  };
  let prisma: { $transaction: jest.Mock };

  const adminTarget = () => ({
    id: 'membership-1',
    communityId: COMMUNITY_ID,
    status: 'ACTIVE',
    role: 'ADMIN',
  });

  beforeEach(async () => {
    tx = {
      membership: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(2),
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-admin',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
      },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: RealtimeGateway, useValue: { emitToUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MembershipsService);
  });

  it('answers 404 for a missing or foreign member (BR-33)', async () => {
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(
      service.changeRole(
        COMMUNITY_ID,
        'membership-1',
        'admin-1',
        roleDto('WARGA'),
      ),
    ).rejects.toEqual(new NotFoundException('Member not found'));
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it('answers 400 when the member is not ACTIVE (BR-29)', async () => {
    tx.membership.findUnique.mockResolvedValue({
      ...adminTarget(),
      status: 'PENDING',
    });

    await expect(
      service.changeRole(
        COMMUNITY_ID,
        'membership-1',
        'admin-1',
        roleDto('WARGA'),
      ),
    ).rejects.toEqual(new BadRequestException('Member is not active'));
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it('answers 400 when demoting the last ACTIVE ADMIN (BR-27)', async () => {
    tx.membership.findUnique.mockImplementation(adminTarget);
    tx.membership.count.mockResolvedValue(1);

    await expect(
      service.changeRole(
        COMMUNITY_ID,
        'membership-1',
        'admin-1',
        roleDto('WARGA'),
      ),
    ).rejects.toEqual(
      new BadRequestException('A community needs at least one admin'),
    );
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it('accepts demoting an ADMIN while another stays ACTIVE (BR-27)', async () => {
    tx.membership.findUnique
      .mockImplementationOnce(adminTarget)
      .mockResolvedValueOnce({
        id: 'membership-1',
        status: 'ACTIVE',
        role: 'WARGA',
        houseBlock: 'Blok C2 No. 14',
        requestedAt: NOW,
        decidedAt: NOW,
        joinedAt: NOW,
        user: { id: USER_ID, name: 'Budi' },
      });

    const result = await service.changeRole(
      COMMUNITY_ID,
      'membership-1',
      'admin-1',
      roleDto('WARGA'),
    );

    expect(result.role).toBe('WARGA');
    expect(tx.membership.count).toHaveBeenCalledWith({
      where: { communityId: COMMUNITY_ID, status: 'ACTIVE', role: 'ADMIN' },
    });
    expect(tx.membership.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'membership-1',
        communityId: COMMUNITY_ID,
        status: 'ACTIVE',
      },
      data: { role: 'WARGA' },
    });
  });

  it('answers 400 when the conditional update loses the race (G-L2)', async () => {
    tx.membership.findUnique
      .mockImplementationOnce(adminTarget)
      .mockResolvedValueOnce({
        id: 'membership-1',
        status: 'ACTIVE',
        role: 'WARGA',
        houseBlock: 'Blok C2 No. 14',
        requestedAt: NOW,
        decidedAt: NOW,
        joinedAt: NOW,
        user: { id: USER_ID, name: 'Budi' },
      });
    tx.membership.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.changeRole(
        COMMUNITY_ID,
        'membership-1',
        'admin-1',
        roleDto('WARGA'),
      ),
    ).rejects.toEqual(new BadRequestException('Member is not active'));
  });
});

describe('ChangeMembershipRoleDto (G-L7)', () => {
  it('accepts the two membership roles and nothing else', () => {
    expect(validateSync(roleDto('ADMIN'))).toEqual([]);
    expect(validateSync(roleDto('WARGA'))).toEqual([]);
    expect(validateSync(roleDto('OWNER' as 'ADMIN'))).not.toEqual([]);
  });
});

describe('MembershipsService.remove', () => {
  let service: MembershipsService;
  let tx: {
    membership: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
    };
  };
  let prisma: { $transaction: jest.Mock };

  const target = () => ({
    id: 'membership-1',
    communityId: COMMUNITY_ID,
    status: 'ACTIVE',
    role: 'WARGA',
    userId: '5f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d',
  });
  const removedRow = () => ({
    id: 'membership-1',
    status: 'REMOVED',
    role: 'WARGA',
    houseBlock: 'Blok C2 No. 14',
    requestedAt: NOW,
    decidedAt: NOW,
    joinedAt: null,
    user: { id: '5f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d', name: 'Sinta' },
  });

  beforeEach(async () => {
    tx = {
      membership: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(2),
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-admin',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
      },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: RealtimeGateway, useValue: { emitToUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MembershipsService);
  });

  it('answers 400 when an admin removes themselves (BR-28)', async () => {
    tx.membership.findUnique.mockImplementation(() => ({
      ...target(),
      userId: 'admin-1',
    }));

    await expect(
      service.remove(COMMUNITY_ID, 'membership-1', 'admin-1'),
    ).rejects.toEqual(
      new BadRequestException('You cannot remove yourself, leave instead'),
    );
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it('answers 400 when removing the last ACTIVE ADMIN (BR-27)', async () => {
    tx.membership.findUnique.mockImplementation(() => ({
      ...target(),
      role: 'ADMIN',
    }));
    tx.membership.count.mockResolvedValue(1);

    await expect(
      service.remove(COMMUNITY_ID, 'membership-1', 'admin-1'),
    ).rejects.toEqual(
      new BadRequestException('A community needs at least one admin'),
    );
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it('answers 400 when the member is not ACTIVE (BR-28)', async () => {
    tx.membership.findUnique.mockImplementation(() => ({
      ...target(),
      status: 'LEFT',
    }));

    await expect(
      service.remove(COMMUNITY_ID, 'membership-1', 'admin-1'),
    ).rejects.toEqual(new BadRequestException('Member is not active'));
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it('removes to REMOVED WARGA with decidedAt (BR-28, BR-30)', async () => {
    tx.membership.findUnique
      .mockImplementationOnce(target)
      .mockResolvedValueOnce(removedRow());

    const result = await service.remove(
      COMMUNITY_ID,
      'membership-1',
      'admin-1',
    );

    expect(result.status).toBe('REMOVED');
    expect(result.role).toBe('WARGA');
    const [removeCall] = tx.membership.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(removeCall.where).toEqual({
      id: 'membership-1',
      communityId: COMMUNITY_ID,
      status: 'ACTIVE',
    });
    expect(removeCall.data.status).toBe('REMOVED');
    expect(removeCall.data.role).toBe('WARGA');
    expect(removeCall.data.decidedAt).toBeInstanceOf(Date);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('MembershipsService.leave', () => {
  let service: MembershipsService;
  let tx: {
    membership: {
      findFirst: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let prisma: { $transaction: jest.Mock };

  beforeEach(async () => {
    tx = {
      membership: {
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: RealtimeGateway, useValue: { emitToUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MembershipsService);
  });

  it('answers 403 for a non-member of the community (BR-31)', async () => {
    tx.membership.findFirst.mockResolvedValue(null);

    await expect(service.leave(COMMUNITY_ID, USER_ID)).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it('answers 400 for the last ACTIVE ADMIN and refuses even as the only member (BR-27, G-L14)', async () => {
    tx.membership.findFirst.mockResolvedValue({
      id: 'm-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    tx.membership.count.mockResolvedValue(1);

    await expect(service.leave(COMMUNITY_ID, USER_ID)).rejects.toEqual(
      new BadRequestException('Promote another admin first'),
    );
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it('rejects any write when the update lost the row (stale member)', async () => {
    tx.membership.findFirst.mockResolvedValue({
      id: 'm-admin',
      role: 'WARGA',
      status: 'ACTIVE',
    });
    tx.membership.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.leave(COMMUNITY_ID, USER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('leaves to LEFT WARGA (F-MEMBERSHIPS-8, BR-30)', async () => {
    tx.membership.findFirst.mockResolvedValue({
      id: 'm-admin',
      role: 'WARGA',
      status: 'ACTIVE',
    });

    await service.leave(COMMUNITY_ID, USER_ID);

    expect(tx.membership.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, communityId: COMMUNITY_ID, status: 'ACTIVE' },
      data: { status: 'LEFT', role: 'WARGA' },
    });
  });

  it('lets a WARGA leave without the admin count check (F-MEMBERSHIPS-8)', async () => {
    tx.membership.findFirst.mockResolvedValue({
      id: 'm-admin',
      role: 'WARGA',
      status: 'ACTIVE',
    });

    await service.leave(COMMUNITY_ID, USER_ID);

    expect(tx.membership.count).not.toHaveBeenCalled();
  });
});
