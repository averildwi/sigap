import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { buildRegionKey } from '../common/helpers/region-key.helper';
import { formatLabel } from '../common/helpers/format-label.helper';
import type {
  MembershipView,
  CommunitySummary,
} from '../common/helpers/community-view.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommunityDto } from './dto/create-community.dto';

export const COMMUNITY_EXISTS_MESSAGE =
  'Community already registered, join with its QR code';

export const communitySelect = {
  id: true,
  rt: true,
  rw: true,
  province: true,
  city: true,
  district: true,
  village: true,
  name: true,
} satisfies Prisma.CommunitySelect;

export const membershipViewSelect = {
  id: true,
  status: true,
  role: true,
  houseBlock: true,
  requestedAt: true,
  decidedAt: true,
  joinedAt: true,
} satisfies Prisma.MembershipSelect;

export function toCommunitySummary(
  community: Prisma.CommunityGetPayload<{ select: typeof communitySelect }>,
): CommunitySummary {
  return {
    id: community.id,
    label: formatLabel(community.rt, community.rw),
    name: community.name,
    rt: community.rt,
    rw: community.rw,
    village: community.village,
    district: community.district,
    city: community.city,
    province: community.province,
  };
}

export type MembershipRow = Prisma.MembershipGetPayload<{
  select: typeof membershipViewSelect;
}>;

export function toMembershipView(membership: MembershipRow): MembershipView {
  return {
    id: membership.id,
    status: membership.status,
    role: membership.role,
    houseBlock: membership.houseBlock,
    requestedAt: membership.requestedAt,
    decidedAt: membership.decidedAt,
    joinedAt: membership.joinedAt,
  };
}

@Injectable()
export class CommunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * F-COMMUNITIES-1, BR-14/16: the community and the creator's ACTIVE ADMIN
   * membership live or die together, so both writes run in one transaction.
   * A duplicate region key race (E-5) surfaces as P2002 -> 409 BR-14.
   */
  async create(
    dto: CreateCommunityDto,
    creatorId: string,
  ): Promise<{ community: CommunitySummary; membership: MembershipView }> {
    const now = new Date();
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const community = await tx.community.create({
          data: {
            rt: dto.rt,
            rw: dto.rw,
            province: dto.province,
            city: dto.city,
            district: dto.district,
            village: dto.village,
            name: dto.name,
            regionKey: buildRegionKey(dto),
          },
          select: communitySelect,
        });
        const membership = await tx.membership.create({
          data: {
            userId: creatorId,
            communityId: community.id,
            status: 'ACTIVE',
            role: 'ADMIN',
            houseBlock: dto.houseBlock,
            requestedAt: now,
            decidedAt: now,
            joinedAt: now,
          },
          select: membershipViewSelect,
        });
        return { community, membership };
      });
      return {
        community: toCommunitySummary(result.community),
        membership: toMembershipView(result.membership),
      };
    } catch (error) {
      // Two racing creates for one region key: only the first wins (BR-14).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(COMMUNITY_EXISTS_MESSAGE);
      }
      throw error;
    }
  }
}
