import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';

type MembershipClient = Pick<Prisma.TransactionClient, 'membership'>;

/** BR-31: unknown community or non-ACTIVE membership are the same 403. */
export const NOT_MEMBER_MESSAGE = 'You are not a member of this community';
/** BR-32: member, but not an ADMIN of that community. */
export const ADMIN_REQUIRED_MESSAGE = 'Admin access required';

/**
 * The row every community check returns. Later modules read `houseBlock`,
 * `role` and the timestamps from it; nothing secret is selected.
 */
export const membershipRowSelect = {
  id: true,
  userId: true,
  communityId: true,
  status: true,
  role: true,
  houseBlock: true,
  requestedAt: true,
  decidedAt: true,
  joinedAt: true,
} satisfies Prisma.MembershipSelect;

export type MembershipRow = Prisma.MembershipGetPayload<{
  select: typeof membershipRowSelect;
}>;

/**
 * ACTIVE membership of `userId` in `communityId`, else 403 (BR-31). Takes
 * the PrismaService or a transaction client, so a check inside a
 * transaction reads the same state it writes.
 */
export async function assertMember(
  client: MembershipClient,
  userId: string,
  communityId: string,
): Promise<MembershipRow> {
  const membership = await client.membership.findFirst({
    where: { userId, communityId, status: 'ACTIVE' },
    select: membershipRowSelect,
  });
  if (!membership) throw new ForbiddenException(NOT_MEMBER_MESSAGE);
  return membership;
}

/** As assertMember, plus the ADMIN role (BR-32). */
export async function assertAdmin(
  client: MembershipClient,
  userId: string,
  communityId: string,
): Promise<MembershipRow> {
  const membership = await assertMember(client, userId, communityId);
  if (membership.role !== 'ADMIN') {
    throw new ForbiddenException(ADMIN_REQUIRED_MESSAGE);
  }
  return membership;
}
