import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { PreviewMembershipDto } from './preview-membership.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** BR-24: the house block is required, 1-50 characters (BR-11 named
 * exception: communityId here is the scanned QR target, validated against
 * the token, not a privileged field, G-L6). */
export class CreateMembershipDto extends PreviewMembershipDto {
  @ApiProperty({ example: 'Blok C2 No. 14' })
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  houseBlock: string;
}
