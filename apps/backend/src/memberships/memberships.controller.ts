import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import type { AuthUser } from '../common/types/auth-user';
import { ThrottleTier } from '../config/throttle-tier.decorator';
import { MembershipsService } from './memberships.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { PreviewMembershipDto } from './dto/preview-membership.dto';

@ApiTags('Memberships')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ThrottleTier('join')
  @ApiOperation({
    summary: '[AUTH] Preview the community of a scanned QR',
    description:
      'Any logged-in user; read-only. Unknown community and a wrong or older token answer the same 400 (BR-20).',
  })
  async preview(
    @CurrentUser() user: AuthUser,
    @Body() dto: PreviewMembershipDto,
  ) {
    return new MessageResponse(
      await this.membershipsService.preview(dto, user.id),
      'Code accepted',
    );
  }

  @Post()
  @ThrottleTier('join')
  @ApiOperation({
    summary: '[AUTH] Submit a join request from a scanned QR',
    description:
      'Any logged-in user; the QR token is the authority (BR-20). A row from REJECTED/LEFT/REMOVED is reused; one PENDING row per user wins, the double-submit loser gets 409 (BR-23).',
  })
  async join(@CurrentUser() user: AuthUser, @Body() dto: CreateMembershipDto) {
    return new MessageResponse(
      await this.membershipsService.join(dto, user.id),
      'Join request sent',
    );
  }
}
