import { ForbiddenException } from '@nestjs/common';
import {
  ADMIN_REQUIRED_MESSAGE,
  assertAdmin,
  assertMember,
} from './community-access.helper';

const ACTIVE_ADMIN_ROW = {
  id: 'membership-1',
  userId: 'user-1',
  communityId: 'community-1',
  status: 'ACTIVE',
  role: 'ADMIN',
  houseBlock: 'Blok C2 No. 14',
  requestedAt: new Date('2026-10-19T08:00:00Z'),
  decidedAt: new Date('2026-10-19T08:05:00Z'),
  joinedAt: new Date('2026-10-19T08:05:00Z'),
};

describe('assertMember (BR-31)', () => {
  let membership: { findFirst: jest.Mock };

  beforeEach(() => {
    membership = { findFirst: jest.fn() };
  });

  const client = (): {
    membership: { findFirst: jest.Mock };
  } => ({
    membership,
  });

  it('throws ForbiddenException when there is no membership row', async () => {
    membership.findFirst.mockResolvedValue(null);

    await expect(
      assertMember(client(), 'user-1', 'community-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers the same 403 while the row is still PENDING', async () => {
    membership.findFirst.mockResolvedValue(null);

    await expect(
      assertMember(client(), 'user-1', 'community-1'),
    ).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    // Only ACTIVE rows count; the PENDING row must not load any feature.
    const [call] = membership.findFirst.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(call.where.status).toBe('ACTIVE');
  });

  it('returns the ACTIVE membership row with the fields later modules need', async () => {
    membership.findFirst.mockResolvedValue(ACTIVE_ADMIN_ROW);

    const row = await assertMember(client(), 'user-1', 'community-1');

    expect(row.houseBlock).toBe('Blok C2 No. 14');
    const [call] = membership.findFirst.mock.calls[0] as [
      { where: Record<string, unknown>; select: Record<string, boolean> },
    ];
    expect(call.where).toEqual({
      userId: 'user-1',
      communityId: 'community-1',
      status: 'ACTIVE',
    });
    expect(call.select).not.toHaveProperty('user');
  });
});

describe('assertAdmin (BR-32)', () => {
  let membership: { findFirst: jest.Mock };

  beforeEach(() => {
    membership = { findFirst: jest.fn() };
  });

  const client = (): {
    membership: { findFirst: jest.Mock };
  } => ({
    membership,
  });

  it('throws ForbiddenException when the ACTIVE member is a WARGA', async () => {
    membership.findFirst.mockResolvedValue({
      ...ACTIVE_ADMIN_ROW,
      role: 'WARGA',
    });

    await expect(
      assertAdmin(client(), 'user-1', 'community-1'),
    ).rejects.toEqual(new ForbiddenException(ADMIN_REQUIRED_MESSAGE));
  });

  it('passes through the ADMIN membership', async () => {
    membership.findFirst.mockResolvedValue(ACTIVE_ADMIN_ROW);

    const row = await assertAdmin(client(), 'user-1', 'community-1');
    expect(row.role).toBe('ADMIN');
  });

  it('still enforces membership first', async () => {
    membership.findFirst.mockResolvedValue(null);

    await expect(
      assertAdmin(client(), 'user-1', 'community-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(membership.findFirst).toHaveBeenCalledTimes(1);
  });
});
