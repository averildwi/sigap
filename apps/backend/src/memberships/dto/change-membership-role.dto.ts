import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import type { MembershipRole } from '../../../generated/prisma/client';
import { MembershipRole as MembershipRoleEnum } from '../../../generated/prisma/client';

/**
 * PATCH .../memberships/:membershipId/role. The membership `role` here is
 * the action of the admin-only endpoint, not a privileged field (G-L7).
 */
export class ChangeMembershipRoleDto {
  @ApiProperty({ enum: MembershipRoleEnum, example: 'ADMIN' })
  @IsEnum(MembershipRoleEnum)
  role: MembershipRole;
}
