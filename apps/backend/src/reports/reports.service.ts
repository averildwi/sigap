import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ReportCategory,
  ReportStatus,
} from '../../generated/prisma/client';
import { assertMember } from '../common/helpers/community-access.helper';
import { paginate, PaginatedResult } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  REALTIME_EVENTS,
  RealtimeGateway,
} from '../notifications/realtime.gateway';
import { CreateReportDto } from './dto/create-report.dto';
import { QueryMyReportsDto } from './dto/query-my-reports.dto';

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
