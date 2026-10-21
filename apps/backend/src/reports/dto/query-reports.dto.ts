import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  ReportCategory,
  ReportStatus,
} from '../../../generated/prisma/client';
import {
  ReportCategory as ReportCategoryEnum,
  ReportStatus as ReportStatusEnum,
} from '../../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** F-REPORTS-6 / BR-32: the admin list filters, searched by title. */
export class QueryReportsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ReportStatusEnum, example: 'PENDING' })
  @IsOptional()
  @IsEnum(ReportStatusEnum)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportCategoryEnum, example: 'INFRASTRUCTURE' })
  @IsOptional()
  @IsEnum(ReportCategoryEnum)
  category?: ReportCategory;

  @ApiPropertyOptional({ example: 'lampu' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
