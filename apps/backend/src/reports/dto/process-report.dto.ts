import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** F-REPORTS-7 / BR-51: the optional note of a non-rejected status change. */
export class ProcessReportDto {
  @ApiPropertyOptional({
    example: 'Sudah kami siapkan ke dinas terkait.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;
}
