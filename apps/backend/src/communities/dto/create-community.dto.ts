import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// BR-12: "Kota Cimahi", "Kab. Bandung"; "Kotabaru" alone is refused.
const CITY_PREFIX = {
  message: 'City must start with Kota or Kabupaten',
} as const;

export class CreateCommunityDto {
  @ApiProperty({ example: 1, minimum: 1, maximum: 999 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  rt: number;

  @ApiProperty({ example: 6, minimum: 1, maximum: 999 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  rw: number;

  @ApiProperty({ example: 'Jawa Barat' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  province: string;

  @ApiProperty({ example: 'Kota Cimahi' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  @Matches(/^(kota|kabupaten|kab)\b/i, CITY_PREFIX)
  city: string;

  @ApiProperty({ example: 'Cimahi Tengah' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  district: string;

  @ApiProperty({ example: 'Kel. Suka Maju' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  village: string;

  @ApiPropertyOptional({ example: 'Griya Asri' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 100)
  name?: string;

  @ApiProperty({ example: 'Blok A1 No. 1' })
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  houseBlock: string;
}
