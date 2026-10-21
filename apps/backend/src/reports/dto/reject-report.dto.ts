import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** F-REPORTS-7 / BR-51: a rejection always carries a 5-1000 char note. */
export class RejectReportDto {
  @ApiProperty({
    example: 'Duplikat laporan nomor 12.',
    minLength: 5,
    maxLength: 1000,
  })
  @Transform(trim)
  @IsString()
  @Length(5, 1000)
  note: string;
}
