import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { ToBoolean } from '../../common/decorators/to-boolean.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryNotificationsDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Only unread notifications',
    example: true,
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by community',
    format: 'uuid',
    example: '0b8b7d1e-2b3f-4c5d-8e9f-102030405060',
  })
  @IsOptional()
  @IsUUID('4')
  communityId?: string;
}
