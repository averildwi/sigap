import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../notifications/realtime.gateway';
import {
  REPORT_NOT_FOUND_MESSAGE,
  ReportsService,
  reportSelect,
} from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { QueryMyReportsDto } from './dto/query-my-reports.dto';
import { QueryReportsDto } from './dto/query-reports.dto';
import { RejectReportDto } from './dto/reject-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';

const COMMUNITY_ID = '5f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
const REPORTER_ID = '6f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
const ADMIN_ID = '7f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
const REPORT_ID = '8f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
const NOW = new Date('2026-10-20T08:05:00Z');

const REPORT_ROW = {
  id: REPORT_ID,
  communityId: COMMUNITY_ID,
  title: 'Lampu jalan mati',
  description: 'Lampu di depan blok C mati sejak Senin.',
  category: 'INFRASTRUCTURE',
  status: 'PENDING',
  responseNote: null,
  respondedAt: null,
  respondedBy: null,
  reporter: { id: REPORTER_ID, name: 'Budi' },
  createdAt: NOW,
  updatedAt: NOW,
};

const membershipRow = (role: string) => ({
  id: 'membership-1',
  userId: REPORTER_ID,
  communityId: COMMUNITY_ID,
  status: 'ACTIVE',
  role,
  houseBlock: 'B-12',
  requestedAt: NOW,
  decidedAt: NOW,
  joinedAt: NOW,
});

const notificationRow = (userId: string) => ({
  id: `notification-${userId}`,
  userId,
  type: 'REPORT_NEW',
  title: 'Laporan warga baru',
  body: `Budi: Lampu jalan mati`,
  communityId: COMMUNITY_ID,
  entityType: 'REPORT',
  entityId: REPORT_ID,
  readAt: null,
  createdAt: NOW,
});

interface AdminTxMock {
  report: { create: jest.Mock };
  membership: { findFirst: jest.Mock; findMany: jest.Mock };
  user: { findUnique: jest.Mock };
}

/** NotificationView as emitted: the row minus the routing field. */
const withoutRecipient = (row: Record<string, unknown>) => {
  const view = { ...row };
  delete view.userId;
  return view;
};

const buildModule = async (
  prismaMock: Record<string, unknown>,
): Promise<{
  service: ReportsService;
  notifications: { createMany: jest.Mock };
  realtime: { emitToUsers: jest.Mock };
}> => {
  const notifications = {
    createMany: jest.fn().mockImplementation((...args: unknown[]) => {
      const input = args[1] as { userIds: string[] };
      return Promise.resolve(input.userIds.map((id) => notificationRow(id)));
    }),
  };
  const realtime = { emitToUsers: jest.fn() };
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      ReportsService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: NotificationsService, useValue: notifications },
      { provide: RealtimeGateway, useValue: realtime },
    ],
  }).compile();
  return { service: moduleRef.get(ReportsService), notifications, realtime };
};

const interactiveTx = (
  tx: Record<string, unknown>,
): Record<string, unknown> => ({
  $transaction: jest.fn((cb: (client: unknown) => Promise<unknown>) => cb(tx)),
});

describe('ReportsService.create', () => {
  const dto = (extra: Partial<{ title: string; category: string }> = {}) =>
    plainToInstance(CreateReportDto, {
      title: 'Lampu jalan mati',
      description: 'Lampu di depan blok C mati sejak Senin.',
      category: 'INFRASTRUCTURE',
      ...extra,
    });

  let tx: AdminTxMock;
  let notifications: { createMany: jest.Mock };
  let realtime: { emitToUsers: jest.Mock };
  let service: ReportsService;

  beforeEach(async () => {
    tx = {
      report: { create: jest.fn().mockResolvedValue(REPORT_ROW) },
      membership: {
        // The reporter's own ACTIVE row: assertMember reads it.
        findFirst: jest.fn().mockResolvedValue(membershipRow('MEMBER')),
        // The reporter plus one admin: the reporter is filtered out.
        findMany: jest
          .fn()
          .mockResolvedValue([
            { userId: ADMIN_ID },
            { userId: REPORTER_ID },
            { userId: 'admin-2' },
          ]),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Budi' }) },
    };
    ({ service, notifications, realtime } = await buildModule(
      interactiveTx(tx),
    ));
  });

  it('rejects a caller who is not an ACTIVE member (BR-31) before any write', async () => {
    tx.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.create(COMMUNITY_ID, dto(), REPORTER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.report.create).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('creates a PENDING report with the documented view shape (F-REPORTS-1, BR-48)', async () => {
    const view = await service.create(COMMUNITY_ID, dto(), REPORTER_ID);

    const [createCall] = tx.report.create.mock.calls[0] as [
      { data: Record<string, unknown>; select: typeof reportSelect },
    ];
    expect(createCall.data).toEqual({
      communityId: COMMUNITY_ID,
      reporterId: REPORTER_ID,
      title: 'Lampu jalan mati',
      description: 'Lampu di depan blok C mati sejak Senin.',
      category: 'INFRASTRUCTURE',
      status: 'PENDING',
    });
    expect(createCall.select).toEqual(reportSelect);
    expect(view.reporter.houseBlock).toBe('B-12');
    expect(view.status).toBe('PENDING');
  });

  it('notifies every ACTIVE ADMIN except the reporter in one bulk insert (BR-52)', async () => {
    await service.create(COMMUNITY_ID, dto(), REPORTER_ID);

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
    expect(input.userIds.sort()).toEqual([ADMIN_ID, 'admin-2']);
    expect(input.communityId).toBe(COMMUNITY_ID);
    expect(input.type).toBe('REPORT_NEW');
    expect(input.entityId).toBe(REPORT_ID);
    expect(input.context).toEqual({
      userName: 'Budi',
      title: 'Lampu jalan mati',
    });
  });

  it('emits notification:new to the recipients only after the commit (BR-69)', async () => {
    await service.create(COMMUNITY_ID, dto(), REPORTER_ID);

    expect(realtime.emitToUsers).toHaveBeenCalledTimes(2);
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      [ADMIN_ID],
      'notification:new',
      withoutRecipient(notificationRow(ADMIN_ID)),
    );
  });
});

describe('ReportsService.findAllMine', () => {
  let prisma: {
    $transaction: jest.Mock;
    report: { findMany: jest.Mock; count: jest.Mock };
    membership: { findFirst: jest.Mock };
  };
  let service: ReportsService;

  const query = (status?: string) =>
    plainToInstance(QueryMyReportsDto, status ? { status } : {});

  beforeEach(async () => {
    prisma = {
      // Array transaction: both reads race inside one batch.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      report: {
        findMany: jest.fn().mockResolvedValue([REPORT_ROW]),
        count: jest.fn().mockResolvedValue(1),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue(membershipRow('MEMBER')),
      },
    };
    ({ service } = await buildModule(prisma));
  });

  it('rejects a caller who is not an ACTIVE member (BR-31)', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.findAllMine(COMMUNITY_ID, REPORTER_ID, query()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.report.findMany).not.toHaveBeenCalled();
  });

  it("lists only the caller's reports, newest first, with the status filter (BR-49)", async () => {
    const result = await service.findAllMine(
      COMMUNITY_ID,
      REPORTER_ID,
      query('PENDING'),
    );

    expect(prisma.report.findMany).toHaveBeenCalledWith({
      where: {
        communityId: COMMUNITY_ID,
        reporterId: REPORTER_ID,
        status: 'PENDING',
      },
      select: reportSelect,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(prisma.report.count).toHaveBeenCalledWith({
      where: {
        communityId: COMMUNITY_ID,
        reporterId: REPORTER_ID,
        status: 'PENDING',
      },
    });
    expect(result.data[0].reporter).toEqual({
      id: REPORTER_ID,
      name: 'Budi',
      houseBlock: 'B-12',
    });
  });

  it('runs without the status filter when none is sent', async () => {
    await service.findAllMine(COMMUNITY_ID, REPORTER_ID, query());

    expect(prisma.report.findMany).toHaveBeenCalledWith({
      where: { communityId: COMMUNITY_ID, reporterId: REPORTER_ID },
      select: reportSelect,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
  });
});

describe('ReportsService.findOne', () => {
  let prisma: {
    report: { findFirst: jest.Mock };
    membership: { findFirst: jest.Mock };
  };
  let service: ReportsService;

  beforeEach(async () => {
    prisma = {
      report: { findFirst: jest.fn().mockResolvedValue(REPORT_ROW) },
      membership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ role: 'ADMIN', houseBlock: 'B-12' }),
      },
    };
    ({ service } = await buildModule(prisma));
  });

  it('answers 404 for a missing or foreign-community id (BR-33, BR-49)', async () => {
    prisma.report.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne(COMMUNITY_ID, REPORT_ID, REPORTER_ID),
    ).rejects.toEqual(new NotFoundException(REPORT_NOT_FOUND_MESSAGE));
  });

  it("answers 404 for another member's report (BR-49)", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: 'MEMBER' });

    await expect(
      service.findOne(COMMUNITY_ID, REPORT_ID, 'warga-1'),
    ).rejects.toEqual(new NotFoundException(REPORT_NOT_FOUND_MESSAGE));
  });

  it("shows the reporter's house block to an ADMIN of the community (F-REPORTS-3)", async () => {
    const view = await service.findOne(COMMUNITY_ID, REPORT_ID, ADMIN_ID);

    expect(view.reporter).toEqual({
      id: REPORTER_ID,
      name: 'Budi',
      houseBlock: 'B-12',
    });
  });

  it("hides the reporter's house block from the caller who is no admin (BR-31, F-REPORTS-3)", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: 'MEMBER' });

    const view = await service.findOne(COMMUNITY_ID, REPORT_ID, REPORTER_ID);

    expect(view.reporter.houseBlock).toBeNull();
  });
});

describe('ReportsService.update', () => {
  let tx: {
    membership: { findMany: jest.Mock };
    report: {
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let prisma: { $transaction: jest.Mock; membership: { findFirst: jest.Mock } };
  let service: ReportsService;

  const dto = (extra: Partial<{ title: string; category: string }> = {}) =>
    plainToInstance(UpdateReportDto, {
      title: 'Lampu jalan mati (blok C)',
      ...extra,
    });

  beforeEach(async () => {
    tx = {
      membership: {
        // The reporter's membership row: read back for the house block.
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: REPORTER_ID, houseBlock: 'B-12' }]),
      },
      report: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({
          reporterId: REPORTER_ID,
          status: 'RESOLVED',
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(REPORT_ROW),
      },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
      membership: {
        findFirst: jest.fn().mockResolvedValue(membershipRow('MEMBER')),
      },
    };
    ({ service } = await buildModule(prisma));
  });

  it('rejects a caller who is not an ACTIVE member (BR-31) before any write', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.update(COMMUNITY_ID, REPORT_ID, dto(), REPORTER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.report.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the write away when a status change raced in (400 only after the re-read, BR-50)', async () => {
    // The conditional update missed: another request moved the report.
    tx.report.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(COMMUNITY_ID, REPORT_ID, dto(), REPORTER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.report.updateMany).toHaveBeenCalledWith({
      where: {
        id: REPORT_ID,
        communityId: COMMUNITY_ID,
        reporterId: REPORTER_ID,
        status: 'PENDING',
      },
      data: { title: 'Lampu jalan mati (blok C)' },
    });
  });

  it("answers 404 when the report is missing, foreign or not the caller's (BR-49)", async () => {
    tx.report.updateMany.mockResolvedValue({ count: 0 });
    tx.report.findFirst.mockResolvedValue(null);

    await expect(
      service.update(COMMUNITY_ID, REPORT_ID, dto(), REPORTER_ID),
    ).rejects.toEqual(new NotFoundException(REPORT_NOT_FOUND_MESSAGE));

    tx.report.findFirst.mockResolvedValue({
      reporterId: 'someone-else',
      status: 'PENDING',
    });
    await expect(
      service.update(COMMUNITY_ID, REPORT_ID, dto(), REPORTER_ID),
    ).rejects.toEqual(new NotFoundException(REPORT_NOT_FOUND_MESSAGE));
  });

  it("updates the caller's PENDING report and reads the view back (F-REPORTS-4)", async () => {
    const view = await service.update(
      COMMUNITY_ID,
      REPORT_ID,
      dto(),
      REPORTER_ID,
    );

    expect(tx.report.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: REPORT_ID },
      select: reportSelect,
    });
    expect(view.reporter.houseBlock).toBe('B-12');
  });
});

describe('ReportsService.remove', () => {
  let tx: {
    notification: { deleteMany: jest.Mock };
    report: { deleteMany: jest.Mock; findFirst: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock; membership: { findFirst: jest.Mock } };
  let service: ReportsService;

  beforeEach(async () => {
    tx = {
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      report: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({
          reporterId: REPORTER_ID,
          status: 'RESOLVED',
        }),
      },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
      membership: {
        findFirst: jest.fn().mockResolvedValue(membershipRow('MEMBER')),
      },
    };
    ({ service } = await buildModule(prisma));
  });

  it('rejects a caller who is not an ACTIVE member (BR-31) before any write', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(
      service.remove(COMMUNITY_ID, REPORT_ID, REPORTER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.report.deleteMany).not.toHaveBeenCalled();
    expect(tx.notification.deleteMany).not.toHaveBeenCalled();
  });

  it('answers 400 when the report is no longer PENDING (BR-50)', async () => {
    tx.report.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.remove(COMMUNITY_ID, REPORT_ID, REPORTER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.report.deleteMany).toHaveBeenCalledWith({
      where: {
        id: REPORT_ID,
        communityId: COMMUNITY_ID,
        reporterId: REPORTER_ID,
        status: 'PENDING',
      },
    });
  });

  it('answers 404 for a missing or foreign report (BR-49)', async () => {
    tx.report.deleteMany.mockResolvedValue({ count: 0 });
    tx.report.findFirst.mockResolvedValue(null);

    await expect(
      service.remove(COMMUNITY_ID, REPORT_ID, REPORTER_ID),
    ).rejects.toEqual(new NotFoundException(REPORT_NOT_FOUND_MESSAGE));
  });

  it('removes the notifications in the same transaction before the delete (BR-50)', async () => {
    await service.remove(COMMUNITY_ID, REPORT_ID, REPORTER_ID);

    expect(tx.notification.deleteMany).toHaveBeenCalledWith({
      where: { entityType: 'REPORT', entityId: REPORT_ID },
    });
    const notificationOrder =
      tx.notification.deleteMany.mock.invocationCallOrder[0];
    const reportOrder = tx.report.deleteMany.mock.invocationCallOrder[0];
    expect(notificationOrder).toBeLessThan(reportOrder);
  });
});

describe('ReportsService.findAll', () => {
  let prisma: {
    $transaction: jest.Mock;
    report: { findMany: jest.Mock; count: jest.Mock };
    membership: { findFirst: jest.Mock; findMany: jest.Mock };
  };
  let service: ReportsService;

  const query = (extra: Record<string, string> = {}) =>
    plainToInstance(QueryReportsDto, extra);

  beforeEach(async () => {
    prisma = {
      // Array transaction: list and count share the batch.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      report: {
        findMany: jest.fn().mockResolvedValue([REPORT_ROW]),
        count: jest.fn().mockResolvedValue(1),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue(membershipRow('ADMIN')),
        // Batched house block read for every distinct reporter.
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: REPORTER_ID, houseBlock: 'B-12' }]),
      },
    };
    ({ service } = await buildModule(prisma));
  });

  it('rejects a caller who is not an ACTIVE ADMIN (BR-32) before any read', async () => {
    prisma.membership.findFirst.mockResolvedValue(membershipRow('MEMBER'));

    await expect(
      service.findAll(COMMUNITY_ID, REPORTER_ID, query()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.report.findMany).not.toHaveBeenCalled();
  });

  it('lists every report filtered by status and category with the search (F-REPORTS-6, BR-32)', async () => {
    const q = query({
      status: 'PENDING',
      category: 'INFRASTRUCTURE',
      search: 'lampu',
    });
    await service.findAll(COMMUNITY_ID, ADMIN_ID, q);

    expect(prisma.report.findMany).toHaveBeenCalledWith({
      where: {
        communityId: COMMUNITY_ID,
        status: 'PENDING',
        category: 'INFRASTRUCTURE',
        title: { contains: 'lampu', mode: 'insensitive' },
      },
      select: reportSelect,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(prisma.report.count).toHaveBeenCalledWith({
      where: {
        communityId: COMMUNITY_ID,
        status: 'PENDING',
        category: 'INFRASTRUCTURE',
        title: { contains: 'lampu', mode: 'insensitive' },
      },
    });
  });

  it("reads every reporter's house block in one batched query (no N+1)", async () => {
    const result = await service.findAll(COMMUNITY_ID, ADMIN_ID, query());

    expect(prisma.membership.findMany).toHaveBeenCalledWith({
      where: { communityId: COMMUNITY_ID, userId: { in: [REPORTER_ID] } },
      select: { userId: true, houseBlock: true },
    });
    expect(result.data[0].reporter).toEqual({
      id: REPORTER_ID,
      name: 'Budi',
      houseBlock: 'B-12',
    });
  });
});

describe('ReportsService.changeStatus', () => {
  let tx: {
    membership: { findFirst: jest.Mock; findMany: jest.Mock };
    report: {
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let prisma: { $transaction: jest.Mock };
  let notifications: { createMany: jest.Mock };
  let realtime: { emitToUsers: jest.Mock };
  let service: ReportsService;

  beforeEach(async () => {
    tx = {
      membership: {
        // One ACTIVE ADMIN row so assertAdmin passes by default.
        findFirst: jest.fn().mockResolvedValue(membershipRow('ADMIN')),
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: REPORTER_ID, houseBlock: 'B-12' }]),
      },
      report: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // Default re-read answer: the report sat on RESOLVED.
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: REPORT_ID, status: 'RESOLVED' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(REPORT_ROW),
      },
    };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    ({ service, notifications, realtime } = await buildModule(prisma));
  });

  it('rejects a caller who is not an ACTIVE ADMIN (BR-32) before any write', async () => {
    tx.membership.findFirst.mockResolvedValue(membershipRow('MEMBER'));

    await expect(
      service.changeStatus(
        'IN_PROGRESS',
        COMMUNITY_ID,
        REPORT_ID,
        undefined,
        REPORTER_ID,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.report.updateMany).not.toHaveBeenCalled();
  });

  it('answers 400 for a finished report: RESOLVED -> anything (BR-51)', async () => {
    tx.report.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.changeStatus(
        'IN_PROGRESS',
        COMMUNITY_ID,
        REPORT_ID,
        undefined,
        ADMIN_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const [call] = tx.report.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(call.where).toEqual({
      id: REPORT_ID,
      communityId: COMMUNITY_ID,
      status: { in: ['PENDING'] },
    });
    const { respondedAt, ...data } = call.data;
    expect(data).toEqual({
      status: 'IN_PROGRESS',
      responseNote: null,
      respondedById: ADMIN_ID,
    });
    expect(respondedAt).toBeInstanceOf(Date);
  });

  it('answers 400 for an IN_PROGRESS report moved through process again (BR-51)', async () => {
    tx.report.updateMany.mockResolvedValue({ count: 0 });
    tx.report.findFirst.mockResolvedValue({
      id: REPORT_ID,
      status: 'IN_PROGRESS',
    });

    await expect(
      service.changeStatus(
        'IN_PROGRESS',
        COMMUNITY_ID,
        REPORT_ID,
        undefined,
        ADMIN_ID,
      ),
    ).rejects.toEqual(new BadRequestException('Invalid status change'));
  });

  it('answers 404 for a missing or foreign-community id (BR-33)', async () => {
    tx.report.updateMany.mockResolvedValue({ count: 0 });
    tx.report.findFirst.mockResolvedValue(null);

    await expect(
      service.changeStatus(
        'IN_PROGRESS',
        COMMUNITY_ID,
        REPORT_ID,
        undefined,
        ADMIN_ID,
      ),
    ).rejects.toEqual(new NotFoundException(REPORT_NOT_FOUND_MESSAGE));
  });

  it('processes a PENDING report with a noteless change resetting the response note (F-REPORTS-7, BR-51)', async () => {
    const pending = { ...REPORT_ROW, status: 'PENDING' };
    tx.report.findUniqueOrThrow.mockResolvedValue(pending);

    await service.changeStatus(
      'IN_PROGRESS',
      COMMUNITY_ID,
      REPORT_ID,
      undefined,
      ADMIN_ID,
    );

    const [call] = tx.report.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(call.where).toEqual({
      id: REPORT_ID,
      communityId: COMMUNITY_ID,
      status: { in: ['PENDING'] },
    });
    const { respondedAt, ...data } = call.data;
    expect(data).toEqual({
      status: 'IN_PROGRESS',
      responseNote: null,
      respondedById: ADMIN_ID,
    });
    expect(respondedAt).toBeInstanceOf(Date);
  });

  it('replaces the note on a resolve so it names the latest change (BR-51)', async () => {
    await service.changeStatus(
      'RESOLVED',
      COMMUNITY_ID,
      REPORT_ID,
      'Lampu sudah dinyalakan.',
      ADMIN_ID,
    );

    const [call] = tx.report.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(call.where).toEqual({
      id: REPORT_ID,
      communityId: COMMUNITY_ID,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
    });
    const { respondedAt, ...data } = call.data;
    expect(data).toEqual({
      status: 'RESOLVED',
      responseNote: 'Lampu sudah dinyalakan.',
      respondedById: ADMIN_ID,
    });
    expect(respondedAt).toBeInstanceOf(Date);
  });

  it('notifies the reporter with REPORT_STATUS after the commit (BR-52, BR-69)', async () => {
    await service.changeStatus(
      'RESOLVED',
      COMMUNITY_ID,
      REPORT_ID,
      'Lampu sudah dinyalakan.',
      ADMIN_ID,
    );

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
    expect(input.userIds).toEqual([REPORTER_ID]);
    expect(input.type).toBe('REPORT_STATUS');
    expect(input.context).toEqual({
      title: 'Lampu jalan mati',
      reportStatus: 'RESOLVED',
    });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      [REPORTER_ID],
      'notification:new',
      withoutRecipient(notificationRow(REPORTER_ID)),
    );
  });

  it('does not notify when the caller is the reporter themselves (BR-52)', async () => {
    tx.membership.findFirst.mockResolvedValue(membershipRow('ADMIN'));

    await service.changeStatus(
      'RESOLVED',
      COMMUNITY_ID,
      REPORT_ID,
      undefined,
      REPORTER_ID,
    );

    expect(tx.report.updateMany).toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
    expect(realtime.emitToUsers).not.toHaveBeenCalled();
  });
});

describe('CreateReportDto (BR-48)', () => {
  const valid = {
    title: 'Lampu jalan mati',
    description: 'Lampu di depan blok C mati sejak Senin.',
    category: 'INFRASTRUCTURE',
  };

  it('accepts a full report and trims the title', () => {
    const dto = plainToInstance(CreateReportDto, {
      ...valid,
      title: '  Lampu jalan mati  ',
    });
    expect(dto.title).toBe('Lampu jalan mati');
    expect(validateSync(dto)).toEqual([]);
  });

  it('rejects a short title, a short description and an unknown category (BR-48)', () => {
    const bad = validateSync(
      plainToInstance(CreateReportDto, {
        title: 'no',
        description: 'too short',
        category: 'ROADS',
      }),
    );
    expect(bad).not.toEqual([]);
  });
});

describe('RejectReportDto (BR-51)', () => {
  it('requires a note of at least 5 characters', () => {
    const bad = validateSync(plainToInstance(RejectReportDto, { note: '  ' }));
    expect(bad).not.toEqual([]);

    const missing = validateSync(plainToInstance(RejectReportDto, {}));
    expect(missing).not.toEqual([]);

    const good = plainToInstance(RejectReportDto, {
      note: '  Duplikat laporan nomor 12.  ',
    });
    expect(good.note).toBe('Duplikat laporan nomor 12.');
    expect(validateSync(good)).toEqual([]);
  });
});
