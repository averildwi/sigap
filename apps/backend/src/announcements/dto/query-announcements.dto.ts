import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** F-ANNOUNCEMENTS-4: list query, searched by title (BR-39). */
export class QueryAnnouncementsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'kerja bakti' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
