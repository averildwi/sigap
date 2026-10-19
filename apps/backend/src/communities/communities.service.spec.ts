import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMMUNITY_EXISTS_MESSAGE,
  CommunitiesService,
  toCommunitySummary,
} from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { QueryMyCommunitiesDto } from './dto/query-my-communities.dto';

interface TxMock {
  community: { create: jest.Mock };
  membership: { create: jest.Mock };
}

const COMMUNITY_ROW = {
  id: 'community-1',
  rt: 1,
  rw: 6,
  province: 'Jawa Barat',
  city: 'Kota Cimahi',
  district: 'Cimahi Tengah',
  village: 'Kel. Suka Maju',
  name: 'Griya Asri',
};

describe('CommunitiesService.create', () => {
  let service: CommunitiesService;
  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };

  const dto = (): CreateCommunityDto =>
    plainToInstance(CreateCommunityDto, {
      rt: 1,
      rw: 6,
      province: 'Jawa Barat',
      city: 'Kota Cimahi',
      district: 'Cimahi Tengah',
      village: 'Kel. Suka Maju',
      name: 'Griya Asri',
      houseBlock: 'Blok A1 No. 1',
    });

  beforeEach(async () => {
    tx = {
      community: { create: jest.fn().mockResolvedValue(COMMUNITY_ROW) },
      membership: {
        create: jest.fn().mockResolvedValue({
          id: 'membership-1',
          status: 'ACTIVE',
          role: 'ADMIN',
          houseBlock: 'Blok A1 No. 1',
          requestedAt: new Date('2026-10-19T00:00:00Z'),
          decidedAt: new Date('2026-10-19T00:00:00Z'),
          joinedAt: new Date('2026-10-19T00:00:00Z'),
        }),
      },
    };
    prisma = {
      $transaction: jest.fn((cb: (client: TxMock) => Promise<unknown>) =>
        cb(tx),
      ),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitiesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(CommunitiesService);
  });

  it('answers 409 with the BR-14 message on a duplicate region key (E-5)', async () => {
    tx.community.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    await expect(service.create(dto(), 'user-1')).rejects.toEqual(
      new ConflictException(COMMUNITY_EXISTS_MESSAGE),
    );
    // The community and the membership live or die together (BR-16).
    expect(tx.membership.create).not.toHaveBeenCalled();
  });

  it('rethrows errors that are not a region-key collision', async () => {
    tx.community.create.mockRejectedValue(new Error('boom'));
    await expect(service.create(dto(), 'user-1')).rejects.toBeInstanceOf(Error);
  });

  it('creates the community with the normalised region key', async () => {
    await service.create(dto(), 'user-1');

    expect(tx.community.create).toHaveBeenCalledTimes(1);
    const [communityCall] = tx.community.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(communityCall.data.regionKey).toBe(
      '1:6:sukamaju:cimahitengah:kota:cimahi:jawabarat',
    );
  });

  it('makes the creator an ACTIVE ADMIN with every timestamp set (BR-16)', async () => {
    await service.create(dto(), 'user-1');

    const [membershipCall] = tx.membership.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    const { data } = membershipCall;
    expect(data.userId).toBe('user-1');
    expect(data.communityId).toBe('community-1');
    expect(data.status).toBe('ACTIVE');
    expect(data.role).toBe('ADMIN');
    expect(data.houseBlock).toBe('Blok A1 No. 1');
    expect(data.requestedAt).toBe(data.decidedAt);
    expect(data.requestedAt).toBe(data.joinedAt);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('CreateCommunityDto (BR-12, BR-15)', () => {
  it('accepts Kota and Kab. cities', () => {
    expect(
      validateSync(
        plainToInstance(CreateCommunityDto, {
          rt: 1,
          rw: 6,
          province: 'Jawa Barat',
          city: 'Kota Cimahi',
          district: 'Cimahi Tengah',
          village: 'Kel. Suka Maju',
          houseBlock: 'Blok A1 No. 1',
        }),
      ),
    ).toEqual([]);
    expect(
      validateSync(
        plainToInstance(CreateCommunityDto, {
          rt: 1,
          rw: 6,
          province: 'Jawa Barat',
          city: 'kab Bandung',
          district: 'Bandung',
          village: 'Desa Sukamaju',
          houseBlock: 'Blok C2 No. 14',
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a city that does not start with Kota or Kabupaten', () => {
    const errors = validateSync(
      plainToInstance(CreateCommunityDto, {
        rt: 1,
        rw: 6,
        province: 'Jawa Barat',
        city: 'Cimahi',
        district: 'Cimahi Tengah',
        village: 'Kel. Suka Maju',
        houseBlock: 'Blok A1 No. 1',
      }),
    );
    expect(
      errors.some((e) =>
        Object.values(e.constraints ?? {}).includes(
          'City must start with Kota or Kabupaten',
        ),
      ),
    ).toBe(true);
  });

  it('rejects a city whose prefix is not a whole word', () => {
    const errors = validateSync(
      plainToInstance(CreateCommunityDto, {
        rt: 1,
        rw: 6,
        province: 'Jawa Barat',
        city: 'Kotabaru',
        district: 'Cimahi Tengah',
        village: 'Kel. Suka Maju',
        houseBlock: 'Blok A1 No. 1',
      }),
    );
    expect(errors).not.toEqual([]);
  });
});

describe('CommunitiesService.findMine', () => {
  let service: CommunitiesService;
  let prisma: {
    $transaction: jest.Mock;
    membership: { findMany: jest.Mock; count: jest.Mock };
  };

  const query = (): QueryMyCommunitiesDto =>
    plainToInstance(QueryMyCommunitiesDto, {});

  const membershipRow = () => ({
    id: 'membership-1',
    status: 'ACTIVE',
    role: 'ADMIN',
    houseBlock: 'Blok A1 No. 1',
    requestedAt: new Date('2026-10-19T08:00:00Z'),
    decidedAt: new Date('2026-10-19T08:05:00Z'),
    joinedAt: new Date('2026-10-19T08:05:00Z'),
  });

  beforeEach(async () => {
    prisma = {
      membership: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...membershipRow(),
            community: { ...COMMUNITY_ROW },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      // Batch variant of $transaction: findMany + count (nest-testing rule 4).
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitiesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(CommunitiesService);
  });

  it('reads only the memberships of the user, newest decision first', async () => {
    await service.findMine(query(), 'user-1');

    const [findManyCall] = prisma.membership.findMany.mock.calls[0] as [
      {
        where: Record<string, unknown>;
        orderBy: unknown;
        skip: number;
        take: number;
      },
    ];
    expect(findManyCall.where).toEqual({ userId: 'user-1' });
    expect(findManyCall.orderBy).toEqual([
      { status: 'asc' },
      { updatedAt: 'desc' },
    ]);
    expect(findManyCall.skip).toBe(0);
    expect(findManyCall.take).toBe(20);
    expect(prisma.membership.count).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('filters by the requested status when one is named', async () => {
    const queryWithStatus = plainToInstance(QueryMyCommunitiesDto, {
      status: 'PENDING',
    });

    await service.findMine(queryWithStatus, 'user-1');

    expect(prisma.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: 'PENDING' },
      }),
    );
  });

  it('returns one item per membership, with the label computed (BR-13)', async () => {
    const result = await service.findMine(query(), 'user-1');

    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(result.data[0]?.community).toEqual(
      toCommunitySummary(COMMUNITY_ROW),
    );
    expect(result.data[0]?.membership.id).toBe('membership-1');
    expect(result.data[0]?.membership.requestedAt).toBeInstanceOf(Date);
    expect(result.data[0]).not.toHaveProperty('regionKey');
  });
});

describe('CommunitiesService.getCard', () => {
  let service: CommunitiesService;
  let prisma: {
    membership: { findFirst: jest.Mock; count: jest.Mock };
    community: { findUnique: jest.Mock };
  };

  const myMembership = () => ({
    id: 'membership-1',
    userId: 'user-1',
    communityId: 'community-1',
    status: 'ACTIVE',
    role: 'ADMIN',
    houseBlock: 'Blok A1 No. 1',
    requestedAt: new Date('2026-10-19T08:00:00Z'),
    decidedAt: new Date('2026-10-19T08:05:00Z'),
    joinedAt: new Date('2026-10-19T08:05:00Z'),
  });

  beforeEach(async () => {
    prisma = {
      membership: {
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(3),
      },
      community: { findUnique: jest.fn().mockResolvedValue(COMMUNITY_ROW) },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitiesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(CommunitiesService);
  });

  it('answers 403 for a non-member, cross-tenant or PENDING caller (BR-31)', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);

    await expect(service.getCard('community-1', 'user-9')).rejects.toEqual(
      new ForbiddenException('You are not a member of this community'),
    );
    expect(prisma.community.findUnique).not.toHaveBeenCalled();
  });

  it('returns the summary, the ACTIVE member count and my membership', async () => {
    prisma.membership.findFirst.mockResolvedValue(myMembership());

    const card = await service.getCard('community-1', 'user-1');

    expect(card).toEqual({
      ...toCommunitySummary(COMMUNITY_ROW),
      activeMemberCount: 3,
      myMembership: {
        id: 'membership-1',
        status: 'ACTIVE',
        role: 'ADMIN',
        houseBlock: 'Blok A1 No. 1',
        requestedAt: myMembership().requestedAt,
        decidedAt: myMembership().decidedAt,
        joinedAt: myMembership().joinedAt,
      },
    });
    expect(prisma.membership.count).toHaveBeenCalledWith({
      where: { communityId: 'community-1', status: 'ACTIVE' },
    });
  });
});
