import type {
  MembershipRole,
  MembershipStatus,
} from '../../../generated/prisma/client.js';

/**
 * Shared response shapes (API_SPEC 0.3). `regionKey` never leaves the
 * service; the label is computed with formatLabel (BR-13).
 */
export interface CommunitySummary {
  id: string;
  label: string;
  name: string | null;
  rt: number;
  rw: number;
  village: string;
  district: string;
  city: string;
  province: string;
}

export interface MembershipView {
  id: string;
  status: MembershipStatus;
  role: MembershipRole;
  houseBlock: string;
  requestedAt: Date;
  decidedAt: Date | null;
  joinedAt: Date | null;
}
