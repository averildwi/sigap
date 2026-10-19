import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationsService,
  createdNotificationSelect,
  notificationSelect,
} from './notifications.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

interface TxMock {
  notification: { createManyAndReturn: jest.Mock };
}

const NOTIFICATION_ROW = {
  id: 'notification-1',
  type: 'JOIN_REQUEST',
  title: 'Permintaan bergabung baru',
  body: 'Siti (Blok A1) ingin bergabung ke RT001/RW006.',
  communityId: 'community-1',
  entityType: 'MEMBERSHIP',
  entityId: 'membership-1',
  readAt: null,
  createdAt: new Date('2026-10-19T08:00:00Z'),
};

const createdRow = (userId: string) => ({
  ...NOTIFICATION_ROW,
  id: `notification-${userId}`,
  userId,
});

describe('NotificationsService.createMany', () => {
  let service: NotificationsService;
  let tx: TxMock;

  beforeEach(async () => {
    tx = {
      notification: {
        createManyAndReturn: jest
          .fn()
          .mockResolvedValue([createdRow('admin-1'), createdRow('admin-2')]),
      },
    };
    const prisma = { $transaction: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('writes one row per recipient with the text from the template fn', async () => {
    const rows = await service.createMany(tx, {
      userIds: ['admin-1', 'admin-2'],
      communityId: 'community-1',
      type: 'JOIN_REQUEST',
      entityId: 'membership-1',
      context: {
        userName: 'Siti',
        houseBlock: 'Blok A1',
        label: 'RT001/RW006',
      },
    });

    expect(tx.notification.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        {
          userId: 'admin-1',
          communityId: 'community-1',
          type: 'JOIN_REQUEST',
          title: 'Permintaan bergabung baru',
          body: 'Siti (Blok A1) ingin bergabung ke RT001/RW006.',
          entityType: 'MEMBERSHIP',
          entityId: 'membership-1',
        },
        {
          userId: 'admin-2',
          communityId: 'community-1',
          type: 'JOIN_REQUEST',
          title: 'Permintaan bergabung baru',
          body: 'Siti (Blok A1) ingin bergabung ke RT001/RW006.',
          entityType: 'MEMBERSHIP',
          entityId: 'membership-1',
        },
      ],
      select: createdNotificationSelect,
    });
    // The recipient is on the row so the caller can route the event.
    expect(rows).toEqual([createdRow('admin-1'), createdRow('admin-2')]);
    expect(createdNotificationSelect).toMatchObject({ userId: true });
    expect(createdNotificationSelect).toMatchObject(notificationSelect);
  });

  it('writes nothing without recipients (an admin list can be empty)', async () => {
    const rows = await service.createMany(tx, {
      userIds: [],
      communityId: 'community-1',
      type: 'JOIN_REQUEST',
      entityId: 'membership-1',
      context: {
        userName: 'Siti',
        houseBlock: 'Blok A1',
        label: 'RT001/RW006',
      },
    });

    expect(tx.notification.createManyAndReturn).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
});

describe('NotificationsService.findAll', () => {
  let service: NotificationsService;
  let prisma: {
    $transaction: jest.Mock;
    notification: { findMany: jest.Mock; count: jest.Mock };
  };

  const query = (data: Record<string, unknown> = {}): QueryNotificationsDto =>
    plainToInstance(QueryNotificationsDto, data);

  beforeEach(async () => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([NOTIFICATION_ROW]),
        count: jest.fn().mockResolvedValue(1),
      },
      // Batch variant of $transaction: findMany + count (nest-testing rule 4).
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it("lists only the caller's rows, newest first, paginated (BR-65)", async () => {
    const result = await service.findAll(query(), 'user-1');

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: notificationSelect,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(result.data[0]).toEqual(NOTIFICATION_ROW);
  });

  it('filters unread and community when they are set', async () => {
    await service.findAll(
      query({
        unread: true,
        communityId: '0b8b7d1e-2b3f-4c5d-8e9f-102030405060',
      }),
      'user-1',
    );

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          readAt: null,
          communityId: '0b8b7d1e-2b3f-4c5d-8e9f-102030405060',
        },
      }),
    );
  });

  it('rejects a communityId that is not a uuid', () => {
    const errors = validateSync(
      plainToInstance(QueryNotificationsDto, { communityId: 'not-a-uuid' }),
    );
    expect(errors).not.toEqual([]);
  });
});

describe('NotificationsService.unreadCount', () => {
  it('counts only the unread rows of the caller (BR-65)', async () => {
    const prisma = {
      notification: { count: jest.fn().mockResolvedValue(4) },
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const service = moduleRef.get(NotificationsService);

    await expect(service.unreadCount('user-1')).resolves.toEqual({ count: 4 });
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', readAt: null },
    });
  });
});

describe('NotificationsService.markRead', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      updateMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      notification: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({
          ...NOTIFICATION_ROW,
          readAt: new Date('2026-10-19T09:00:00Z'),
        }),
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it("answers the same 404 for a missing and another user's id (BR-65)", async () => {
    prisma.notification.updateMany.mockResolvedValue({
      count: 0,
    });
    prisma.notification.findFirst.mockResolvedValue(null);

    await expect(
      service.markRead('foreign-id', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns an already-read row untouched (count 0, row exists)', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const row = await service.markRead('notification-1', 'user-1');

    expect(row.readAt).toBeInstanceOf(Date);
  });

  it('sets readAt through an update scoped to the caller and its id', async () => {
    await service.markRead('notification-1', 'user-1');

    const [call] = prisma.notification.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: { readAt: Date } },
    ];
    expect(call.where).toEqual({
      id: 'notification-1',
      userId: 'user-1',
      readAt: null,
    });
    expect(call.data.readAt).toBeInstanceOf(Date);
  });
});

describe('NotificationsService.readAll', () => {
  let service: NotificationsService;
  let prisma: { notification: { updateMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      notification: { updateMany: jest.fn().mockResolvedValue({ count: 7 }) },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('touches only the unread rows of the caller (BR-65)', async () => {
    await expect(service.readAll('user-1')).resolves.toEqual({ updated: 7 });

    const [call] = prisma.notification.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: { readAt: Date } },
    ];
    // userId in the where clause: no foreign row can be marked (BR-65).
    expect(call.where).toEqual({ userId: 'user-1', readAt: null });
    expect(call.data.readAt).toBeInstanceOf(Date);
  });
});
