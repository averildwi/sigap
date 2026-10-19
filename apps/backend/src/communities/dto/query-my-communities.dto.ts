import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { MembershipStatus } from '../../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryMyCommunitiesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: MembershipStatus, example: 'ACTIVE' })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}
