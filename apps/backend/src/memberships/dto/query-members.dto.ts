import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  MembershipRole,
  MembershipStatus,
} from '../../../generated/prisma/client';
import {
  MembershipRole as MembershipRoleEnum,
  MembershipStatus as MembershipStatusEnum,
} from '../../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * F-MEMBERSHIPS-10: filter by status (default ACTIVE, applied by the
 * service) and role, search by requester name or house block.
 */
export class QueryMembersDto extends PaginationDto {
  @ApiPropertyOptional({ enum: MembershipStatusEnum, example: 'ACTIVE' })
  @IsOptional()
  @IsEnum(MembershipStatusEnum)
  status?: MembershipStatus;

  @ApiPropertyOptional({ enum: MembershipRoleEnum, example: 'ADMIN' })
  @IsOptional()
  @IsEnum(MembershipRoleEnum)
  role?: MembershipRole;

  @ApiPropertyOptional({ example: 'budi', description: 'Name or house block' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
