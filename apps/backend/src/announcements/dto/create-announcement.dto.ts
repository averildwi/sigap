import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** F-ANNOUNCEMENTS-1 / BR-35: title 3-150 (trimmed), body 1-5000. */
export class CreateAnnouncementDto {
  @ApiProperty({ example: 'Kerja bakti Minggu' })
  @Transform(trim)
  @IsString()
  @Length(3, 150)
  title: string;

  @ApiProperty({ example: 'Kumpul jam 07.00 di pos ronda.' })
  @IsString()
  @Length(1, 5000)
  body: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean() // JSON body, no ToBoolean needed (API_SPEC 5)
  isHighlight?: boolean;
}
