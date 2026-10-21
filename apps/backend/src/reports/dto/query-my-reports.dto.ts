import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import type { ReportStatus } from '../../../generated/prisma/client';
import { ReportStatus as ReportStatusEnum } from '../../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** F-REPORTS-2: the caller's own reports, filterable by status. */
export class QueryMyReportsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ReportStatusEnum, example: 'PENDING' })
  @IsOptional()
  @IsEnum(ReportStatusEnum)
  status?: ReportStatus;
}
