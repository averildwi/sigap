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
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto';

@ApiTags('Announcements')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('communities/:communityId/announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Post()
  @ApiOperation({
    summary: '[AUTH] Publish an announcement',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Setting a highlight clears the previous one in the same transaction; active members except the author are notified.',
  })
  async create(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    const announcement = await this.announcementsService.create(
      communityId,
      dto,
      userId,
    );
    return new MessageResponse(announcement, 'Announcement published');
  }

  @Patch(':announcementId')
  @ApiOperation({
    summary: '[AUTH] Edit an announcement',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Setting a highlight clears the previous one in the same transaction (BR-36); no notification is sent. A foreign id is the same 404 as a missing one (BR-33).',
  })
  async update(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    const announcement = await this.announcementsService.update(
      communityId,
      announcementId,
      dto,
      userId,
    );
    return new MessageResponse(announcement, 'Announcement updated');
  }

  @Delete(':announcementId')
  @ApiOperation({
    summary: '[AUTH] Delete an announcement',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). The notifications of the announcement are removed in the same transaction (BR-38); a foreign id is the same 404 as a missing one.',
  })
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.announcementsService.remove(communityId, announcementId, userId);
    return new MessageResponse(null, 'Announcement deleted');
  }

  @Get()
  @ApiOperation({
    summary: '[AUTH] List announcements',
    description:
      'Any ACTIVE member (service check). Highlighted first, then newest first (BR-39); search matches the title.',
  })
  async findAll(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
    @Query() query: QueryAnnouncementsDto,
  ) {
    const result = await this.announcementsService.findAll(
      communityId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Get(':announcementId')
  @ApiOperation({
    summary: '[AUTH] Get an announcement',
    description:
      'Any ACTIVE member (service check). A foreign id is the same 404 as a missing one (BR-33).',
  })
  findOne(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.announcementsService.findOne(
      communityId,
      announcementId,
      userId,
    );
  }
}
