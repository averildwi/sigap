import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { NotificationsService } from './notifications.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: '[AUTH] List my notifications, newest first',
    description:
      'Ownership filter userId = me (BR-65); unread and community are filters.',
  })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: QueryNotificationsDto,
  ) {
    const result = await this.notificationsService.findAll(query, userId);
    return new Paginated(result.data, result.meta);
  }

  // `unread-count` and `read-all` are matched before `:notificationId`.
  @Get('unread-count')
  @ApiOperation({ summary: '[AUTH] Count my unread notifications' })
  async unreadCount(@CurrentUser('id') userId: string) {
    return this.notificationsService.unreadCount(userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[AUTH] Mark all my notifications as read',
    description:
      'updateMany where userId = me: nobody else is touched (BR-65).',
  })
  async readAll(@CurrentUser('id') userId: string) {
    const { updated } = await this.notificationsService.readAll(userId);
    return new MessageResponse({ updated }, 'All notifications marked as read');
  }

  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[AUTH] Mark a notification as read',
    description:
      "Another user's id is the same 404 as a missing one (BR-65); an already-read id answers as is.",
  })
  async read(
    @CurrentUser('id') userId: string,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    const notification = await this.notificationsService.markRead(
      notificationId,
      userId,
    );
    return new MessageResponse(notification, 'Notification marked as read');
  }
}
