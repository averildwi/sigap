import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { OtpService } from './otp/otp.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: { user: { create: jest.Mock; update: jest.Mock } };
  let otp: { issue: jest.Mock; consume: jest.Mock };
  const hashing = new HashingService();
  const jwt = new JwtService({ secret: 'x'.repeat(32) });

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
    };
    tx = {
      user: {
        create: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@x.com' }),
        update: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
    };
    otp = {
      issue: jest.fn(),
      consume: jest.fn(
        (_u: string, _p: string, _c: string, cb: (t: typeof tx) => unknown) =>
          cb(tx),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: HashingService, useValue: hashing },
        { provide: JwtService, useValue: jwt },
        { provide: OtpService, useValue: otp },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('AuthService.register', () => {
    it('never touches an existing account, verified or not', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(
        service.register({
          email: 'a@x.com',
          password: 'new password',
          name: 'Siti Aminah',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(tx.user.create).not.toHaveBeenCalled();
      expect(otp.issue).not.toHaveBeenCalled();
    });

    it('creates the user and issues the first code in one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await service.register({
        email: 'a@x.com',
        password: 'new password',
        name: 'Siti Aminah',
      });

      expect(tx.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'a@x.com',
          name: 'Siti Aminah',
          globalRole: 'USER',
        }) as unknown,
        select: { id: true, email: true },
      });
      const [{ data }] = tx.user.create.mock.calls[0] as unknown as [
        { data: { passwordHash: string } },
      ];
      await expect(
        hashing.verify('new password', data.passwordHash),
      ).resolves.toBe(true);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(otp.issue).toHaveBeenCalledWith(
        { id: 'u1', email: 'a@x.com' },
        'EMAIL_VERIFICATION',
        tx,
      );
    });
  });

  describe('AuthService.verifyEmail', () => {
    it('rejects an unknown email without running a code check', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.verifyEmail({ email: 'nobody@x.com', code: '123456' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(otp.consume).not.toHaveBeenCalled();
    });

    it('consumes the code, sets emailVerifiedAt and returns a token for self-registration', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      tx.user.update.mockResolvedValue({
        id: 'u1',
        email: 'a@x.com',
        globalRole: 'USER',
        isActive: true,
        tokenVersion: 0,
      });

      const result = await service.verifyEmail({
        email: 'a@x.com',
        code: '123456',
      });

      expect(otp.consume).toHaveBeenCalledWith(
        'u1',
        'EMAIL_VERIFICATION',
        '123456',
        expect.any(Function),
      );
      const [{ where, data }] = tx.user.update.mock.calls[0] as unknown as [
        { where: { id: string }; data: { emailVerifiedAt: unknown } },
      ];
      expect(where).toEqual({ id: 'u1' });
      expect(data.emailVerifiedAt).toBeInstanceOf(Date);
      const claims =
        jwt.decode<Record<string, unknown>>(result!.accessToken) ?? {};
      expect(claims).toMatchObject({ sub: 'u1', email: 'a@x.com', tv: 0 });
      expect(claims).not.toHaveProperty('role');
    });

    it('returns no token for a non-default role or an inactive account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      tx.user.update.mockResolvedValue({
        id: 'u1',
        email: 'a@x.com',
        globalRole: 'ADMIN',
        isActive: true,
        tokenVersion: 0,
      });
      await expect(
        service.verifyEmail({ email: 'a@x.com', code: '123456' }),
      ).resolves.toBeNull();
    });
  });

  describe('AuthService.resendVerification', () => {
    it('issues a new code only for an unverified account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@x.com',
        emailVerifiedAt: null,
      });
      await service.resendVerification({ email: 'a@x.com' });
      expect(otp.issue).toHaveBeenCalledWith(
        { id: 'u1', email: 'a@x.com', emailVerifiedAt: null },
        'EMAIL_VERIFICATION',
      );
    });

    it('stays silent for a verified or unknown email', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'u1',
          email: 'a@x.com',
          emailVerifiedAt: new Date(),
        })
        .mockResolvedValueOnce(null);
      await service.resendVerification({ email: 'a@x.com' });
      await service.resendVerification({ email: 'nobody@x.com' });
      expect(otp.issue).not.toHaveBeenCalled();
    });
  });

  describe('AuthService.me', () => {
    it('returns the profile of the caller', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@x.com',
        name: 'Siti',
        phone: null,
        globalRole: 'USER',
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
      });
      const profile = await service.me('u1');
      expect(profile).toMatchObject({ id: 'u1' });
      const [arg] = prisma.user.findUnique.mock.calls[0] as [
        { select: Record<string, unknown> },
      ];
      expect(Object.keys(arg.select)).toEqual([
        'id',
        'email',
        'name',
        'phone',
        'globalRole',
        'emailVerifiedAt',
        'createdAt',
      ]);
    });

    it('rejects a missing user with 401', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.me('u1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
