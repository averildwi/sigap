import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReportCategory,
  ReportStatus,
} from '../../generated/prisma/client';
import {
  assertAdmin,
  assertMember,
} from '../common/helpers/community-access.helper';
import { paginate, PaginatedResult } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  REALTIME_EVENTS,
  RealtimeGateway,
} from '../notifications/realtime.gateway';
import { CreateReportDto } from './dto/create-report.dto';
import { QueryMyReportsDto } from './dto/query-my-reports.dto';
import { QueryReportsDto } from './dto/query-reports.dto';
import { UpdateReportDto } from './dto/update-report.dto';

/** BR-49: missing id, a foreign community and a foreign report are one 404. */
export const REPORT_NOT_FOUND_MESSAGE = 'Report not found';

/** ReportView of API_SPEC 0.3; no other column ever leaves the service. */
export const reportSelect = {
  id: true,
  communityId: true,
  title: true,
  description: true,
  category: true,
  status: true,
  responseNote: true,
  respondedAt: true,
  respondedBy: { select: { id: true, name: true } },
  reporter: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReportSelect;

export type ReportRow = Prisma.ReportGetPayload<{
  select: typeof reportSelect;
}>;

export interface ReporterRef {
  id: string;
  name: string;
  houseBlock: string | null;
}

export interface ReportView {
  id: string;
  communityId: string;
  title: string;
  description: string;
  category: ReportCategory;
  status: ReportStatus;
  responseNote: string | null;
  respondedAt: Date | null;
  respondedBy: { id: string; name: string } | null;
  reporter: ReporterRef;
  createdAt: Date;
  updatedAt: Date;
}

/** Merges the reporter's house block into ReportView. */
export function toReportView(
  report: ReportRow,
  reporterHouseBlock: string | null,
): ReportView {
  const { reporter, ...rest } = report;
  return { ...rest, reporter: { ...reporter, houseBlock: reporterHouseBlock } };
}

/**
 * BR-51: the transitions of PRD 6.4 in Lite, keyed by the target status;
 * anything else (RESOLVED/REJECTED/PENDING as target) is not an action.
 */
export const REPORT_ALLOWED_FROM: Record<
  'IN_PROGRESS' | 'RESOLVED' | 'REJECTED',
  ReportStatus[]
> = {
  IN_PROGRESS: ['PENDING'],
  RESOLVED: ['PENDING', 'IN_PROGRESS'],
  REJECTED: ['PENDING', 'IN_PROGRESS'],
};

/** The reporter's house block in one community, from one batched query. */
export async function loadReporterHouseBlocks(
  client: Pick<Prisma.TransactionClient, 'membership'>,
  communityId: string,
  reporterIds: string[],
): Promise<Map<string, string | null>> {
  const rows =
    reporterIds.length > 0
      ? await client.membership.findMany({
          where: { communityId, userId: { in: reporterIds } },
          select: { userId: true, houseBlock: true },
        })
      : [];
  return new Map(rows.map((row) => [row.userId, row.houseBlock]));
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * F-REPORTS-1 / BR-48/52: PENDING report plus the REPORT_NEW fanout to
   * every ACTIVE ADMIN except the reporter in one transaction; the
   * `notification:new` events go out only after the commit (BR-69).
   */
  async create(
    communityId: string,
    dto: CreateReportDto,
    userId: string,
  ): Promise<ReportView> {
    const result = await this.prisma.$transaction(async (tx) => {
      const membership = await assertMember(tx, userId, communityId);
      const report = await tx.report.create({
        data: {
          communityId,
          reporterId: userId,
          title: dto.title,
          description: dto.description,
          category: dto.category,
          status: 'PENDING',
        },
        select: reportSelect,
      });

      const admins = await tx.membership.findMany({
        where: { communityId, status: 'ACTIVE', role: 'ADMIN' },
        select: { userId: true },
      });
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const createdNotifications = await this.notifications.createMany(tx, {
        userIds: admins
          .map((admin) => admin.userId)
          .filter((id) => id !== userId),
        communityId,
        type: 'REPORT_NEW',
        entityId: report.id,
        context: { userName: user?.name ?? '', title: report.title },
      });
      return {
        report,
        reporterHouseBlock: membership.houseBlock,
        createdNotifications,
      };
    });

    // After the commit (BR-69): one event per recipient.
    this.emitNotifications(result.createdNotifications);
    return toReportView(result.report, result.reporterHouseBlock);
  }

  /**
   * F-REPORTS-2 / BR-31/49: the caller's own reports only (the reporter id
   * filter is the read side of BR-49), newest first, filterable by status.
   */
  async findAllMine(
    communityId: string,
    userId: string,
    query: QueryMyReportsDto,
  ): Promise<PaginatedResult<ReportView>> {
    const membership = await assertMember(this.prisma, userId, communityId);
    const where: Prisma.ReportWhereInput = {
      communityId,
      reporterId: userId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        select: reportSelect,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.report.count({ where }),
    ]);
    return {
      ...paginate(rows, total, query.page, query.limit),
      data: rows.map((row) => toReportView(row, membership.houseBlock)),
    };
  }

  /**
   * F-REPORTS-3 / BR-31/49: the reporter and the community's ADMINs see the
   * report; every other member (and a foreign id) gets the same 404. Only an
   * ADMIN sees the reporter's house block (PRD F-REPORTS-3).
   */
  async findOne(
    communityId: string,
    reportId: string,
    userId: string,
  ): Promise<ReportView> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, communityId, status: 'ACTIVE' },
      select: { role: true },
    });
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, communityId },
      select: reportSelect,
    });
    const isAdmin = membership?.role === 'ADMIN';
    if (!report || (report.reporter.id !== userId && !isAdmin)) {
      throw new NotFoundException(REPORT_NOT_FOUND_MESSAGE);
    }
    const houseBlock = isAdmin
      ? ((
          await this.prisma.membership.findFirst({
            where: { userId: report.reporter.id, communityId },
            select: { houseBlock: true },
          })
        )?.houseBlock ?? null)
      : null;
    return toReportView(report, houseBlock);
  }

  /**
   * F-REPORTS-4 / BR-50: the reporter edits only while PENDING. The
   * conditional update is both the state and the race guard; a miss is
   * re-read once to pick 404 (missing / foreign / not the caller's) or
   * 400 (no longer PENDING).
   */
  async update(
    communityId: string,
    reportId: string,
    dto: UpdateReportDto,
    userId: string,
  ): Promise<ReportView> {
    await assertMember(this.prisma, userId, communityId);
    return this.prisma.$transaction(async (tx) => {
      const data: {
        title?: string;
        description?: string;
        category?: ReportCategory;
      } = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.category !== undefined) data.category = dto.category;

      const updated = await tx.report.updateMany({
        where: {
          id: reportId,
          communityId,
          reporterId: userId,
          status: 'PENDING',
        },
        data,
      });
      if (updated.count === 0) {
        const report = await tx.report.findFirst({
          where: { id: reportId, communityId },
          select: { reporterId: true, status: true },
        });
        if (!report || report.reporterId !== userId) {
          throw new NotFoundException(REPORT_NOT_FOUND_MESSAGE);
        }
        throw new BadRequestException('Only pending reports can be changed');
      }
      const row = await tx.report.findUniqueOrThrow({
        where: { id: reportId },
        select: reportSelect,
      });
      const houseBlocks = await loadReporterHouseBlocks(tx, communityId, [
        row.reporter.id,
      ]);
      return toReportView(row, houseBlocks.get(row.reporter.id) ?? null);
    });
  }

  /**
   * F-REPORTS-5 / BR-50: the report's notifications are removed before the
   * conditional delete (count 0 -> 404/400) rolls everything back, so
   * notifications never outlive the report. Same 404-vs-400 re-read as
   * update.
   */
  async remove(
    communityId: string,
    reportId: string,
    userId: string,
  ): Promise<void> {
    await assertMember(this.prisma, userId, communityId);
    await this.prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({
        where: { entityType: 'REPORT', entityId: reportId },
      });
      const deleted = await tx.report.deleteMany({
        where: {
          id: reportId,
          communityId,
          reporterId: userId,
          status: 'PENDING',
        },
      });
      if (deleted.count === 0) {
        const report = await tx.report.findFirst({
          where: { id: reportId, communityId },
          select: { reporterId: true, status: true },
        });
        if (!report || report.reporterId !== userId) {
          throw new NotFoundException(REPORT_NOT_FOUND_MESSAGE);
        }
        throw new BadRequestException('Only pending reports can be changed');
      }
    });
  }

  /**
   * F-REPORTS-6 / BR-32: every report of the community, for ACTIVE ADMINs
   * only, filterable by status and category, searched by title, newest first.
   */
  async findAll(
    communityId: string,
    userId: string,
    query: QueryReportsDto,
  ): Promise<PaginatedResult<ReportView>> {
    await assertAdmin(this.prisma, userId, communityId);
    const where: Prisma.ReportWhereInput = {
      communityId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? { title: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        select: reportSelect,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.report.count({ where }),
    ]);
    const reporterIds = [...new Set(rows.map((row) => row.reporter.id))];
    const houseBlocks = await loadReporterHouseBlocks(
      this.prisma,
      communityId,
      reporterIds,
    );
    return {
      ...paginate(rows, total, query.page, query.limit),
      data: rows.map((row) =>
        toReportView(row, houseBlocks.get(row.reporter.id) ?? null),
      ),
    };
  }

  /**
   * F-REPORTS-7 / BR-51/52: the admin status actions in one conditional
   * update (state and race guard in the where), the allowed-from list coming
   * from REPORT_ALLOWED_FROM. BR-51: the note is overwritten per change —
   * none sent resets `responseNote` to null — with `respondedById` and
   * `respondedAt` set together. BR-52: the reporter is notified unless the
   * admin act is the reporter's own; `notification:new` goes out after the
   * commit (BR-69).
   */
  async changeStatus(
    target: 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED',
    communityId: string,
    reportId: string,
    note: string | undefined,
    userId: string,
  ): Promise<ReportView> {
    const result = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, userId, communityId);
      const updated = await tx.report.updateMany({
        where: {
          id: reportId,
          communityId,
          status: { in: REPORT_ALLOWED_FROM[target] },
        },
        data: {
          status: target,
          responseNote: note ?? null,
          respondedById: userId,
          respondedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        // Re-read: 404 for a missing or foreign id, 400 for a stale state.
        const report = await tx.report.findFirst({
          where: { id: reportId, communityId },
          select: { id: true, status: true },
        });
        if (!report) throw new NotFoundException(REPORT_NOT_FOUND_MESSAGE);
        throw new BadRequestException('Invalid status change');
      }
      const row = await tx.report.findUniqueOrThrow({
        where: { id: reportId },
        select: reportSelect,
      });
      let createdNotifications: unknown[] = [];
      if (row.reporter.id !== userId) {
        createdNotifications = await this.notifications.createMany(tx, {
          userIds: [row.reporter.id],
          communityId,
          type: 'REPORT_STATUS',
          entityId: reportId,
          context: { title: row.title, reportStatus: target },
        });
      }
      const houseBlocks = await loadReporterHouseBlocks(tx, communityId, [
        row.reporter.id,
      ]);
      return {
        view: toReportView(row, houseBlocks.get(row.reporter.id) ?? null),
        createdNotifications,
      };
    });

    // After the commit (BR-69): one event per recipient.
    this.emitNotifications(result.createdNotifications);
    return result.view;
  }

  /** After-commit emit helper shared with later commits (BR-69). */
  private emitNotifications(created: unknown[]): void {
    for (const notification of created) {
      const { userId: recipientId, ...view } = notification as Record<
        string,
        unknown
      >;
      this.realtime.emitToUsers(
        [recipientId],
        REALTIME_EVENTS.notificationNew,
        view,
      );
    }
  }
}
