import {
  Body,
  Controller,
  Get,
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
import type { AuthUser } from '../common/types/auth-user';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { QueryMyCommunitiesDto } from './dto/query-my-communities.dto';

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

  // `mine` is matched before `:communityId` (API_SPEC 3).
  @Get('mine')
  @ApiOperation({ summary: '[AUTH] List my communities and memberships' })
  async findMine(
    @CurrentUser('id') userId: string,
    @Query() query: QueryMyCommunitiesDto,
  ) {
    const result = await this.communitiesService.findMine(query, userId);
    return new Paginated(result.data, result.meta);
  }

  @Get(':communityId')
  @ApiOperation({
    summary: '[AUTH] Get a community card',
    description: 'Caller must be an ACTIVE member (service check).',
  })
  getCard(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.communitiesService.getCard(communityId, userId);
  }
}
