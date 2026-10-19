import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import type { AuthUser } from '../common/types/auth-user';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';

@ApiTags('Communities')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Post()
  @ApiOperation({
    summary: '[AUTH] Create a community and become its admin',
    description: 'Region-key duplicates are refused with 409 (BR-14).',
  })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateCommunityDto) {
    return new MessageResponse(
      await this.communitiesService.create(dto, user.id),
      'Community created',
    );
  }
}
