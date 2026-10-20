import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

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
}
