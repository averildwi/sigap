import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../notifications/realtime.gateway';
import {
  AnnouncementsService,
  announcementSelect,
} from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

const COMMUNITY_ID = '3f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
const ADMIN_ID = '4f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
const NOW = new Date('2026-10-19T08:05:00Z');

const ANNOUNCEMENT_ROW = {
  id: 'announcement-1',
  communityId: COMMUNITY_ID,
  title: 'Kerja bakti Minggu',
  body: 'Kumpul jam 07.00 di pos ronda.',
  isHighlight: true,
  createdAt: NOW,
  updatedAt: NOW,
  author: { id: ADMIN_ID, name: 'Siti' },
};

const notificationRow = (userId: string) => ({
  id: `notification-${userId}`,
  userId,
  type: 'ANNOUNCEMENT',
  title: 'Pengumuman baru',
  body: 'Kerja bakti Minggu',
  communityId: COMMUNITY_ID,
  entityType: 'ANNOUNCEMENT',
  entityId: 'announcement-1',
  readAt: null,
  createdAt: NOW,
});

interface TxMock {
  announcement: { updateMany: jest.Mock; create: jest.Mock };
  membership: { findFirst: jest.Mock; findMany: jest.Mock };
}

/** NotificationView as emitted: the row minus the routing field. */
const withoutRecipient = (row: Record<string, unknown>) => {
  const view = { ...row };
  delete view.userId;
  return view;
};

describe('AnnouncementsService.create', () => {
  let service: AnnouncementsService;
  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };
  let notifications: { createMany: jest.Mock };
  let realtime: { emitToUsers: jest.Mock };

  const dto = (extra: Partial<{ isHighlight: boolean }> = {}) =>
    plainToInstance(CreateAnnouncementDto, {
      title: 'Kerja bakti Minggu',
      body: 'Kumpul jam 07.00 di pos ronda.',
      ...extra,
    });

  beforeEach(async () => {
    tx = {
      announcement: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(ANNOUNCEMENT_ROW),
      },
      membership: {
        // One ACTIVE ADMIN row so assertAdmin passes by default.
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
        // The author plus one warga: the author is filtered out in the fanout.
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: ADMIN_ID }, { userId: 'warga-1' }]),
      },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: TxMock) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    notifications = {
      createMany: jest.fn().mockImplementation((...args: unknown[]) => {
        const input = args[1] as { userIds: string[] };
        return Promise.resolve(input.userIds.map((id) => notificationRow(id)));
      }),
    };
    realtime = { emitToUsers: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();
    service = moduleRef.get(AnnouncementsService);
  });

  it('answers 403 for a caller who is not an ACTIVE ADMIN (BR-31/32)', async () => {
    // A non-member caller: assertAdmin rejects before any write has a chance.
    tx.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.create(COMMUNITY_ID, dto(), 'warga-1'),
    ).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(tx.announcement.updateMany).not.toHaveBeenCalled();
    expect(tx.announcement.create).not.toHaveBeenCalled();
  });

  it('clears the old highlight before creating the new one (BR-36, N-3)', async () => {
    await service.create(COMMUNITY_ID, dto({ isHighlight: true }), ADMIN_ID);

    expect(tx.announcement.updateMany).toHaveBeenCalledWith({
      where: { communityId: COMMUNITY_ID, isHighlight: true },
      data: { isHighlight: false },
    });
    const clearOrder = tx.announcement.updateMany.mock.invocationCallOrder[0];
    const createOrder = tx.announcement.create.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(createOrder);
    const [createCall] = tx.announcement.create.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(createCall.data.isHighlight).toBe(true);
  });

  it('publishes without touching the highlight column of others (BR-35)', async () => {
    await service.create(COMMUNITY_ID, dto(), ADMIN_ID);

    expect(tx.announcement.updateMany).not.toHaveBeenCalled();
    const [createCall] = tx.announcement.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(createCall.data).toEqual({
      communityId: COMMUNITY_ID,
      authorId: ADMIN_ID,
      title: 'Kerja bakti Minggu',
      body: 'Kumpul jam 07.00 di pos ronda.',
      isHighlight: false,
    });
  });

  it('notifies every ACTIVE member except the author in one bulk insert (BR-37)', async () => {
    await service.create(COMMUNITY_ID, dto(), ADMIN_ID);

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
    expect(input.userIds).toEqual(['warga-1']);
    expect(input.communityId).toBe(COMMUNITY_ID);
    expect(input.type).toBe('ANNOUNCEMENT');
    expect(input.entityId).toBe('announcement-1');
    expect(input.context).toEqual({ title: 'Kerja bakti Minggu' });
  });

  it('emits notification:new to the recipients only after the commit (BR-69)', async () => {
    await service.create(COMMUNITY_ID, dto(), ADMIN_ID);

    expect(realtime.emitToUsers).toHaveBeenCalledTimes(1);
    const view = withoutRecipient(notificationRow('warga-1'));
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      ['warga-1'],
      'notification:new',
      view,
    );
  });

  it('reads the announcement back with the documented view shape', async () => {
    await service.create(COMMUNITY_ID, dto(), ADMIN_ID);

    const [createCall] = tx.announcement.create.mock.calls[0] as [
      { select: typeof announcementSelect },
    ];
    expect(createCall.select).toEqual(announcementSelect);
  });
});

describe('CreateAnnouncementDto (BR-35)', () => {
  it('accepts a full announcement and trims the title', () => {
    const dto = plainToInstance(CreateAnnouncementDto, {
      title: '  Kerja bakti Minggu  ',
      body: 'Kumpul jam 07.00 di pos ronda.',
    });
    expect(dto.title).toBe('Kerja bakti Minggu');
    expect(dto.isHighlight).toBeUndefined();
    expect(validateSync(dto)).toEqual([]);
  });

  it('rejects a short title and an empty body (BR-35)', () => {
    const shortTitle = validateSync(
      plainToInstance(CreateAnnouncementDto, {
        title: 'no',
        body: 'x',
      }),
    );
    expect(shortTitle).not.toEqual([]);

    const emptyBody = validateSync(
      plainToInstance(CreateAnnouncementDto, {
        title: 'Kerja bakti Minggu',
        body: '',
      }),
    );
    expect(emptyBody).not.toEqual([]);
  });

  it('rejects a non-boolean highlight', () => {
    const bad = validateSync(
      plainToInstance(CreateAnnouncementDto, {
        title: 'Kerja bakti Minggu',
        body: 'Kumpul jam 07.00 di pos ronda.',
        isHighlight: 'yes',
      }),
    );
    expect(bad).not.toEqual([]);
  });
});
