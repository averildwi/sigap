import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length } from 'class-validator';
import type { ReportCategory } from '../../../generated/prisma/client';
import { ReportCategory as ReportCategoryEnum } from '../../../generated/prisma/client';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** F-REPORTS-1 / BR-48: title 3-150, description 10-5000, JSON only (no photo). */
export class CreateReportDto {
  @ApiProperty({ example: 'Lampu jalan mati' })
  @Transform(trim)
  @IsString()
  @Length(3, 150)
  title: string;

  @ApiProperty({ example: 'Lampu di depan blok C mati sejak Senin.' })
  @IsString()
  @Length(10, 5000)
  description: string;

  @ApiProperty({ enum: ReportCategoryEnum, example: 'INFRASTRUCTURE' })
  @IsEnum(ReportCategoryEnum)
  category: ReportCategory;
}
