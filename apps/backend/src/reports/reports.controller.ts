import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  MessageResponse,
  Paginated,
} from '../common/interceptors/transform.interceptor';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { QueryMyReportsDto } from './dto/query-my-reports.dto';
import { QueryReportsDto } from './dto/query-reports.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ProcessReportDto } from './dto/process-report.dto';
import { RejectReportDto } from './dto/reject-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';

/**
 * Route order per API_SPEC 6: `reports/me` before `reports/:reportId`.
 */
@ApiTags('Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('communities/:communityId/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiOperation({
    summary: '[AUTH] Submit a report',
    description:
      'Any ACTIVE member (service check). Creates a PENDING report visible only to the reporter and the community admins; every ACTIVE admin except the reporter is notified.',
  })
  async create(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReportDto,
  ) {
    const report = await this.reportsService.create(communityId, dto, userId);
    return new MessageResponse(report, 'Report submitted');
  }

  @Get('me')
  @ApiOperation({
    summary: '[AUTH] List my reports',
    description:
      "Any ACTIVE member (service check); only the caller's own reports are returned (BR-49). Filterable by status, newest first.",
  })
  async findAllMine(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
    @Query() query: QueryMyReportsDto,
  ) {
    const result = await this.reportsService.findAllMine(
      communityId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Patch(':reportId')
  @ApiOperation({
    summary: '[AUTH] Edit my pending report',
    description:
      'Any ACTIVE member (service check); edit is restricted to the reporter while PENDING (service checks). A foreign report is the same 404 as a missing one; not PENDING is 400 (BR-50).',
  })
  async update(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateReportDto,
  ) {
    const report = await this.reportsService.update(
      communityId,
      reportId,
      dto,
      userId,
    );
    return new MessageResponse(report, 'Report updated');
  }

  @Delete(':reportId')
  @ApiOperation({
    summary: '[AUTH] Delete my pending report',
    description:
      'Any ACTIVE member (service check); delete is restricted to the reporter while PENDING (service checks). Its notifications are removed in the same transaction (BR-50).',
  })
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.reportsService.remove(communityId, reportId, userId);
    return new MessageResponse(null, 'Report deleted');
  }

  @Get()
  @ApiOperation({
    summary: '[AUTH] List all reports of the community',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Filterable by status and category, searchable by title, newest first (BR-32).',
  })
  async findAll(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
    @Query() query: QueryReportsDto,
  ) {
    const result = await this.reportsService.findAll(
      communityId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Get(':reportId')
  @ApiOperation({
    summary: '[AUTH] Get a report',
    description:
      "Reporter or ADMIN (service check). A foreign report is the same 404 as a missing one (BR-49); only an ADMIN sees the reporter's house block.",
  })
  findOne(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reportsService.findOne(communityId, reportId, userId);
  }

  @Post(':reportId/process')
  @ApiOperation({
    summary: '[AUTH] Mark a report as in progress',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Allowed from PENDING only (BR-51); the reporter is notified unless they are the caller (BR-52).',
  })
  @HttpCode(HttpStatus.OK)
  async process(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ProcessReportDto,
  ) {
    const report = await this.reportsService.changeStatus(
      'IN_PROGRESS',
      communityId,
      reportId,
      dto.note,
      userId,
    );
    return new MessageResponse(report, 'Report marked as in progress');
  }

  @Post(':reportId/resolve')
  @ApiOperation({
    summary: '[AUTH] Resolve a report',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Allowed from PENDING or IN_PROGRESS (BR-51); the notification rule matches process (BR-52).',
  })
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ResolveReportDto,
  ) {
    const report = await this.reportsService.changeStatus(
      'RESOLVED',
      communityId,
      reportId,
      dto.note,
      userId,
    );
    return new MessageResponse(report, 'Report resolved');
  }

  @Post(':reportId/reject')
  @ApiOperation({
    summary: '[AUTH] Reject a report',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Allowed from PENDING or IN_PROGRESS and always carries a 5-1000 char note (BR-51).',
  })
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectReportDto,
  ) {
    const report = await this.reportsService.changeStatus(
      'REJECTED',
      communityId,
      reportId,
      dto.note,
      userId,
    );
    return new MessageResponse(report, 'Report rejected');
  }
}
