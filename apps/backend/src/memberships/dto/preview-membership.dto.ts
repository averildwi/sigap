import { ApiProperty } from '@nestjs/swagger';
import { Length, IsString, IsUUID } from 'class-validator';

/** Length of the QR token (BR-19). A token alone is not enough; the
 * community id of the scanned target travels with it (GAPS G-L6). */
export class PreviewMembershipDto {
  @ApiProperty({ example: '3f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d' })
  @IsUUID('4')
  communityId: string;

  @ApiProperty({
    example: 'pX2fK9abC3deF5ghI7jkL4',
    maxLength: 22,
    minLength: 22,
  })
  @IsString()
  @Length(22, 22)
  token: string;
}
