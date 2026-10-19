import { BadRequestException, ConflictException } from '@nestjs/common';
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
