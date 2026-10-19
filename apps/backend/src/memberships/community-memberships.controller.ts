import {
  Body,
  Controller,
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
import type { AuthUser } from '../common/types/auth-user';
import { MembershipsService } from './memberships.service';
import { QueryJoinRequestsDto } from './dto/query-join-requests.dto';
import { QueryMembersDto } from './dto/query-members.dto';
import { ChangeMembershipRoleDto } from './dto/change-membership-role.dto';

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

  @Get('memberships')
  @ApiOperation({
    summary: '[AUTH] List members',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin).',
  })
  async listMembers(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
    @Query() query: QueryMembersDto,
  ) {
    const result = await this.membershipsService.listMembers(
      communityId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Patch('memberships/:membershipId/role')
  @ApiOperation({
    summary: "[AUTH] Change a member's role",
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Setting the last ACTIVE ADMIN to WARGA is refused with 400 (BR-27).',
  })
  async changeRole(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangeMembershipRoleDto,
  ) {
    return new MessageResponse(
      await this.membershipsService.changeRole(
        communityId,
        membershipId,
        user.id,
        dto,
      ),
      'Role updated',
    );
  }

  @Post('memberships/:membershipId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[AUTH] Remove a member',
    description:
      'Caller must be an ACTIVE ADMIN of :communityId (service check, assertAdmin). Removing yourself or the last ACTIVE ADMIN is refused with 400 (BR-28, BR-27).',
  })
  async remove(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser('id') userId: string,
  ) {
    return new MessageResponse(
      await this.membershipsService.remove(communityId, membershipId, userId),
      'Member removed',
    );
  }

  @Post('leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[AUTH] Leave a community',
    description:
      'Any ACTIVE member (service check). The last ACTIVE ADMIN cannot leave (BR-27), even as the only member (G-L14).',
  })
  async leave(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.membershipsService.leave(communityId, userId);
    return new MessageResponse(null, 'You left the community');
  }
}
