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
import { UpdateReportDto } from './dto/update-report.dto';

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
}
