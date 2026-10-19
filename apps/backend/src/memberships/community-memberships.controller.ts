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
import { MembershipsService } from './memberships.service';
import { QueryJoinRequestsDto } from './dto/query-join-requests.dto';

/**
 * The community-scoped half of the memberships module. Nothing here is
 * role-guarded: the per-resource check runs in the service and throws the
 * same 403 bodies everywhere (R-34, assertAdmin / assertMember).
 */
@ApiTags('Memberships')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('communities/:communityId')
export class CommunityMembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get('join-qr')
  @ApiOperation({
    summary: '[AUTH] Get the current join QR',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin).',
  })
  getJoinQr(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.membershipsService.getJoinQr(communityId, userId);
  }

  @Get('join-requests')
  @ApiOperation({
    summary: '[AUTH] List pending join requests',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Oldest first.',
  })
  async listJoinRequests(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
    @Query() query: QueryJoinRequestsDto,
  ) {
    const result = await this.membershipsService.listJoinRequests(
      communityId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Post('memberships/:membershipId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[AUTH] Approve a join request',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Only PENDING is settable (BR-25); a lost race is 400.',
  })
  async approve(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser('id') userId: string,
  ) {
    return new MessageResponse(
      await this.membershipsService.approve(communityId, membershipId, userId),
      'Join request approved',
    );
  }

  @Post('memberships/:membershipId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[AUTH] Reject a join request',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Only PENDING is settable (BR-25); a lost race is 400.',
  })
  async reject(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser('id') userId: string,
  ) {
    return new MessageResponse(
      await this.membershipsService.reject(communityId, membershipId, userId),
      'Join request rejected',
    );
  }
}
