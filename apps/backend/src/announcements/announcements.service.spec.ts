import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../notifications/realtime.gateway';
import {
  ANNOUNCEMENT_NOT_FOUND_MESSAGE,
  AnnouncementsService,
  announcementSelect,
} from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto';

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
  announcement: {
    updateMany: jest.Mock;
    create: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    deleteMany: jest.Mock;
  };
  membership: { findFirst: jest.Mock; findMany: jest.Mock };
  notification: { deleteMany: jest.Mock };
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
        findUniqueOrThrow: jest.fn().mockResolvedValue(ANNOUNCEMENT_ROW),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
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

describe('AnnouncementsService.update', () => {
  let service: AnnouncementsService;
  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };
  let notifications: { createMany: jest.Mock };
  let realtime: { emitToUsers: jest.Mock };

  const dto = (): UpdateAnnouncementDto =>
    plainToInstance(UpdateAnnouncementDto, { title: 'Kerja bakti Senin' });

  beforeEach(async () => {
    tx = {
      announcement: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(ANNOUNCEMENT_ROW),
        deleteMany: jest.fn(),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
        findMany: jest.fn(),
      },
      notification: { deleteMany: jest.fn() },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: TxMock) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    notifications = { createMany: jest.fn() };
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

  it('answers 404 for a missing id, with the notification rows untouched (BR-33)', async () => {
    tx.announcement.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(COMMUNITY_ID, 'announcement-1', dto(), ADMIN_ID),
    ).rejects.toEqual(new NotFoundException(ANNOUNCEMENT_NOT_FOUND_MESSAGE));
    expect(tx.notification.deleteMany).not.toHaveBeenCalled();
  });

  it('answers 404 for an id of another community, identical to a missing id (BR-33)', async () => {
    tx.announcement.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(COMMUNITY_ID, 'announcement-1', dto(), ADMIN_ID),
    ).rejects.toEqual(new NotFoundException(ANNOUNCEMENT_NOT_FOUND_MESSAGE));
    expect(tx.announcement.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('answers 403 for a caller who is not an ACTIVE ADMIN (BR-31/32)', async () => {
    tx.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.update(COMMUNITY_ID, 'announcement-1', dto(), 'warga-1'),
    ).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(tx.announcement.updateMany).not.toHaveBeenCalled();
  });

  it('clears the old highlight before setting the new one on edit (BR-36)', async () => {
    const highlight = plainToInstance(UpdateAnnouncementDto, {
      isHighlight: true,
    });

    await service.update(COMMUNITY_ID, 'announcement-1', highlight, ADMIN_ID);

    const clearOrder = tx.announcement.updateMany.mock.invocationCallOrder[0];
    const setOrder = tx.announcement.updateMany.mock.invocationCallOrder[1];
    expect(clearOrder).toBeLessThan(setOrder);
    const [clearCall] = tx.announcement.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(clearCall.where).toEqual({
      communityId: COMMUNITY_ID,
      isHighlight: true,
    });
    const [setCall] = tx.announcement.updateMany.mock.calls[1] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(setCall.where).toEqual({
      id: 'announcement-1',
      communityId: COMMUNITY_ID,
    });
    expect(setCall.data).toEqual({ isHighlight: true });
  });

  it('edits without touching notifications (BR-36, no re-announce)', async () => {
    await service.update(COMMUNITY_ID, 'announcement-1', dto(), ADMIN_ID);

    expect(notifications.createMany).not.toHaveBeenCalled();
    expect(tx.announcement.updateMany).toHaveBeenCalledWith({
      where: { id: 'announcement-1', communityId: COMMUNITY_ID },
      data: { title: 'Kerja bakti Senin' },
    });
    expect(realtime.emitToUsers).not.toHaveBeenCalled();
  });
});

describe('AnnouncementsService.remove', () => {
  let service: AnnouncementsService;
  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };
  let notifications: { createMany: jest.Mock };
  let realtime: { emitToUsers: jest.Mock };

  beforeEach(async () => {
    tx = {
      announcement: {
        updateMany: jest.fn(),
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
        findMany: jest.fn(),
      },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: TxMock) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    notifications = { createMany: jest.fn() };
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

  it('answers 404 for a missing id and deletes nothing (BR-33, BR-38)', async () => {
    tx.announcement.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.remove(COMMUNITY_ID, 'announcement-1', ADMIN_ID),
    ).rejects.toEqual(new NotFoundException(ANNOUNCEMENT_NOT_FOUND_MESSAGE));
    // The conditional delete rolls the notification delete back.
    expect(tx.notification.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('answers 403 for a caller who is not an ACTIVE ADMIN (BR-31/32)', async () => {
    tx.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.remove(COMMUNITY_ID, 'announcement-1', 'warga-1'),
    ).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(tx.notification.deleteMany).not.toHaveBeenCalled();
    expect(tx.announcement.deleteMany).not.toHaveBeenCalled();
  });

  it('removes the notifications of the announcement in the same transaction (BR-38)', async () => {
    await service.remove(COMMUNITY_ID, 'announcement-1', ADMIN_ID);

    expect(tx.notification.deleteMany).toHaveBeenCalledWith({
      where: { entityType: 'ANNOUNCEMENT', entityId: 'announcement-1' },
    });
    const notificationOrder =
      tx.notification.deleteMany.mock.invocationCallOrder[0];
    const announcementOrder =
      tx.announcement.deleteMany.mock.invocationCallOrder[0];
    expect(notificationOrder).toBeLessThan(announcementOrder);
    expect(tx.announcement.deleteMany).toHaveBeenCalledWith({
      where: { id: 'announcement-1', communityId: COMMUNITY_ID },
    });
  });
});

describe('AnnouncementsService.findAll', () => {
  let service: AnnouncementsService;
  let prisma: {
    membership: { findFirst: jest.Mock; findMany: jest.Mock };
    announcement: { findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  const query = (): QueryAnnouncementsDto =>
    plainToInstance(QueryAnnouncementsDto, {});

  beforeEach(async () => {
    prisma = {
      // Batch variant of $transaction: findMany + count (nest-testing rule 4).
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          role: 'WARGA',
          status: 'ACTIVE',
        }),
        findMany: jest.fn(),
      },
      announcement: {
        findMany: jest.fn().mockResolvedValue([ANNOUNCEMENT_ROW]),
        count: jest.fn().mockResolvedValue(1),
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: RealtimeGateway, useValue: { emitToUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AnnouncementsService);
  });

  it('answers 403 for a non-member without reading anything (BR-31)', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.findAll(COMMUNITY_ID, 'stranger-1', query()),
    ).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(prisma.announcement.findMany).not.toHaveBeenCalled();
  });

  it('orders highlighted first, then newest (BR-39)', async () => {
    const result = await service.findAll(COMMUNITY_ID, 'warga-1', query());

    const [findManyCall] = prisma.announcement.findMany.mock.calls[0] as [
      { where: Record<string, unknown>; orderBy: unknown },
    ];
    expect(findManyCall.where).toEqual({ communityId: COMMUNITY_ID });
    expect(findManyCall.orderBy).toEqual([
      { isHighlight: 'desc' },
      { createdAt: 'desc' },
    ]);
    expect(result.data[0]?.isHighlight).toBe(true);
    expect(result.meta.total).toBe(1);
  });

  it('searches the title case-insensitively (F-ANNOUNCEMENTS-4)', async () => {
    const search = plainToInstance(QueryAnnouncementsDto, {
      search: 'kerja',
    });

    await service.findAll(COMMUNITY_ID, 'warga-1', search);

    expect(prisma.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          communityId: COMMUNITY_ID,
          title: { contains: 'kerja', mode: 'insensitive' },
        },
      }),
    );
  });
});

describe('AnnouncementsService.findOne', () => {
  let service: AnnouncementsService;
  let prisma: {
    membership: { findFirst: jest.Mock; findMany: jest.Mock };
    announcement: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          role: 'WARGA',
          status: 'ACTIVE',
        }),
        findMany: jest.fn(),
      },
      announcement: {
        findFirst: jest.fn().mockResolvedValue(ANNOUNCEMENT_ROW),
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: RealtimeGateway, useValue: { emitToUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AnnouncementsService);
  });

  it('answers 403 for a non-member (BR-31)', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne(COMMUNITY_ID, 'announcement-1', 'stranger-1'),
    ).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(prisma.announcement.findFirst).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing or foreign id, identical bodies (BR-33)', async () => {
    prisma.announcement.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne(COMMUNITY_ID, 'announcement-1', 'warga-1'),
    ).rejects.toEqual(new NotFoundException(ANNOUNCEMENT_NOT_FOUND_MESSAGE));
  });

  it('returns the documented announcement view (F-ANNOUNCEMENTS-5)', async () => {
    const announcement = await service.findOne(
      COMMUNITY_ID,
      'announcement-1',
      'warga-1',
    );

    expect(prisma.announcement.findFirst).toHaveBeenCalledWith({
      where: { id: 'announcement-1', communityId: COMMUNITY_ID },
      select: announcementSelect,
    });
    expect(announcement.author).toEqual({ id: ADMIN_ID, name: 'Siti' });
  });
});

describe('UpdateAnnouncementDto / QueryAnnouncementsDto (BR-35, BR-39)', () => {
  it('accepts any subset of the create fields', () => {
    expect(
      validateSync(
        plainToInstance(UpdateAnnouncementDto, { isHighlight: true }),
      ),
    ).toEqual([]);
    const wrong = validateSync(
      plainToInstance(UpdateAnnouncementDto, { title: 'no' }),
    );
    expect(wrong).not.toEqual([]);
  });

  it('keeps the announce query to an optional 100 character search', () => {
    expect(
      validateSync(plainToInstance(QueryAnnouncementsDto, { search: 'budi' })),
    ).toEqual([]);
    const tooLong = validateSync(
      plainToInstance(QueryAnnouncementsDto, { search: 'a'.repeat(101) }),
    );
    expect(tooLong).not.toEqual([]);
  });
});
