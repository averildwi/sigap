import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * F-MEMBERSHIPS-4: search the queue by requester name or house block
 * (`mode: 'insensitive'`, PostgreSQL). Every requester is verified (BR-3),
 * so no verified badge exists.
 */
export class QueryJoinRequestsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'budi', description: 'Name or house block' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
