import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashing.hash('correct horse');
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(user()),
      },
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
    await service.onModuleInit();
  });

  const user = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'a@x.com',
    name: 'Siti',
    globalRole: 'USER',
    isActive: true,
    emailVerifiedAt: new Date(),
    tokenVersion: 2,
    passwordHash,
    ...over,
  });

  describe('AuthService.login', () => {
    it('returns { accessToken } whose payload is { sub, email, tv } without role', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      const { accessToken } = await service.login({
        email: 'a@x.com',
        password: 'correct horse',
      });
      const claims = jwt.decode<Record<string, unknown>>(accessToken) ?? {};
      expect(claims).toMatchObject({ sub: 'u1', email: 'a@x.com', tv: 2 });
      expect(claims).not.toHaveProperty('role');
    });

    it('answers an unknown email and a wrong password with the same error', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const unknown = await service
        .login({ email: 'nobody@x.com', password: 'whatever1' })
        .catch((e: unknown) => e);
      prisma.user.findUnique.mockResolvedValueOnce(user());
      const wrong = await service
        .login({ email: 'a@x.com', password: 'whatever1' })
        .catch((e: unknown) => e);

      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect((unknown as Error).message).toBe((wrong as Error).message);
    });

    it('treats an account without a password as invalid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ passwordHash: null }));
      await expect(
        service.login({ email: 'a@x.com', password: 'correct horse' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('reveals a disabled account only after the password is correct (BR-3)', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ isActive: false }));
      await expect(
        service.login({ email: 'a@x.com', password: 'wrong pass' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.login({ email: 'a@x.com', password: 'correct horse' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an unverified email only after the password is correct (BR-3)', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ emailVerifiedAt: null }));
      await expect(
        service.login({ email: 'a@x.com', password: 'correct horse' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
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

  describe('AuthService.forgotPassword', () => {
    it('issues a PASSWORD_RESET code for an active user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@x.com',
        isActive: true,
      });
      await service.forgotPassword({ email: 'a@x.com' });
      expect(otp.issue).toHaveBeenCalledWith(
        { id: 'u1', email: 'a@x.com', isActive: true },
        'PASSWORD_RESET',
      );
    });

    it('stays silent for unknown or disabled accounts (BR-1)', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'u1',
          email: 'a@x.com',
          isActive: false,
        })
        .mockResolvedValueOnce(null);
      await service.forgotPassword({ email: 'a@x.com' });
      await service.forgotPassword({ email: 'nobody@x.com' });
      expect(otp.issue).not.toHaveBeenCalled();
    });
  });

  describe('AuthService.resetPassword', () => {
    it('consumes the code, stores a new hash and bumps tokenVersion (BR-5)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        emailVerifiedAt: null,
      });
      await service.resetPassword({
        email: 'a@x.com',
        code: '123456',
        newPassword: 'nice new password',
      });
      const [consumeCall] = otp.consume.mock.calls as unknown as [
        [string, string, string],
      ];
      expect(consumeCall).toEqual([
        'u1',
        'PASSWORD_RESET',
        '123456',
        expect.any(Function),
      ]);
      const [{ data }] = tx.user.update.mock.calls[0] as unknown as [
        { data: { passwordHash: string; tokenVersion: unknown } },
      ];
      await expect(
        hashing.verify('nice new password', data.passwordHash),
      ).resolves.toBe(true);
      expect(data.tokenVersion).toEqual({ increment: 1 });
    });

    it('also marks the email as verified once (E-38)', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1', emailVerifiedAt: null })
        .mockResolvedValueOnce({
          id: 'u1',
          emailVerifiedAt: new Date('2024-01-02T03:04:05Z'),
        });
      await service.resetPassword({
        email: 'a@x.com',
        code: '123456',
        newPassword: 'nice new password',
      });
      const [first] = tx.user.update.mock.calls[0] as unknown as [
        { data: { emailVerifiedAt: unknown } },
      ];
      expect(first.data.emailVerifiedAt).toBeInstanceOf(Date);
      await service.resetPassword({
        email: 'a@x.com',
        code: '654321',
        newPassword: 'nice new password',
      });
      const [second] = tx.user.update.mock.calls[1] as unknown as [
        { data: { emailVerifiedAt: unknown } },
      ];
      expect(second.data.emailVerifiedAt).toEqual(
        new Date('2024-01-02T03:04:05Z'),
      );
    });

    it('rejects an unknown email with the standard invalid-code error', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.resetPassword({
          email: 'nobody@x.com',
          code: '123456',
          newPassword: 'nice new password',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('AuthService.changePassword', () => {
    it('verifies the current password, bumps tokenVersion and returns a fresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ tokenVersion: 2 }));
      prisma.user.update.mockResolvedValue(user({ tokenVersion: 3 }));
      const { accessToken } = await service.changePassword(
        { id: 'u1', email: 'a@x.com', role: 'USER' },
        { currentPassword: 'correct horse', newPassword: 'brand new horse' },
      );
      const claims = jwt.decode<Record<string, unknown>>(accessToken) ?? {};
      expect(claims).toMatchObject({ sub: 'u1', email: 'a@x.com', tv: 3 });
      const [findFirst] = prisma.user.findUnique.mock.calls[0] as unknown as [
        { where: { id: string } },
      ];
      expect(findFirst.where).toEqual({ id: 'u1' });
      const [{ where, data }] = prisma.user.update.mock.calls[0] as unknown as [
        {
          where: { id: string };
          data: { passwordHash: string; tokenVersion: unknown };
        },
      ];
      await expect(
        hashing.verify('brand new horse', data.passwordHash),
      ).resolves.toBe(true);
      expect(data.tokenVersion).toEqual({ increment: 1 });
      expect(where).toEqual({ id: 'u1' });
    });

    it('rejects a wrong current password with the same error as unknown ids', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(user());
      const unknown = await service
        .changePassword(
          { id: 'u1', email: 'a@x.com', role: 'USER' },
          { currentPassword: 'correct horse', newPassword: 'brand new horse' },
        )
        .catch((e: unknown) => e);
      const wrong = await service
        .changePassword(
          { id: 'u1', email: 'a@x.com', role: 'USER' },
          { currentPassword: 'wrong horse', newPassword: 'brand new horse' },
        )
        .catch((e: unknown) => e);
      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect((unknown as Error).message).toBe((wrong as Error).message);
    });
  });

  describe('AuthService.logoutAll', () => {
    it('bumps tokenVersion so every issued token dies (BR-5)', async () => {
      await service.logoutAll({ id: 'u1', email: 'a@x.com', role: 'USER' });
      const [arg] = prisma.user.update.mock.calls[0] as unknown as [
        {
          data: { tokenVersion: unknown };
          select: Record<string, unknown>;
        },
      ];
      expect(arg.data.tokenVersion).toEqual({ increment: 1 });
      expect(Object.keys(arg.data)).toEqual(['tokenVersion']);
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
