import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService.check', () => {
  let service: HealthService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(HealthService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('throws ServiceUnavailableException when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('does not leak the database error in the response', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('password authentication failed for user "postgres"'),
    );
    const error = (await service.check().catch((e: unknown) => e)) as
      ServiceUnavailableException | undefined;
    expect(JSON.stringify(error?.getResponse())).not.toContain('postgres');
    expect(error?.message).toBe('Service unavailable');
  });

  it('returns { status: ok } after SELECT 1 succeeds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(service.check()).resolves.toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [sql] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sql.join('')).toBe('SELECT 1');
  });
});
