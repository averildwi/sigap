import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { GlobalRole, Prisma } from '../../generated/prisma/client';
import { HashingService } from '../common/hashing/hashing.service';
import type { AuthUser, JwtPayload } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestCodeDto } from './dto/request-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { INVALID_CODE, OtpService } from './otp/otp.service';

/** App-wide role of self-registered accounts. Privileged accounts come from the seed. */
export const DEFAULT_ROLE: GlobalRole = 'USER';
const INVALID_CREDENTIALS = 'Invalid credentials';

const tokenUserSelect = {
  id: true,
  email: true,
  name: true,
  globalRole: true,
  isActive: true,
  tokenVersion: true,
} satisfies Prisma.UserSelect;

/**
 * Profile responses (BR-83): one explicit select, so passwordHash,
 * tokenVersion and isActive never leave the service (skill rule 17).
 */
export const profileSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  globalRole: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService implements OnModuleInit {
  // Unknown emails are checked against this, so they cost the same scrypt run.
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hashing.hash(randomBytes(16).toString('hex'));
  }

  async login({ email, password }: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { ...tokenUserSelect, passwordHash: true, emailVerifiedAt: true },
    });
    const passwordOk = await this.hashing.verify(
      password,
      user?.passwordHash ?? this.dummyHash,
    );
    if (!user?.passwordHash || !passwordOk) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Status only after the password: it is revealed to the owner, never to a guesser.
    if (!user.isActive) throw new ForbiddenException('Account is disabled');
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException('Email is not verified');
    }
    return { accessToken: await this.signToken(user) };
  }

  async register({ email, password, name }: RegisterDto): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    // Conscious exception to the identical-messages rule (UX), throttled.
    // Never update the existing row: that would let anyone replace the
    // password of an unverified account (skill rule 19).
    if (existing) throw new ConflictException('Email is already registered');

    // The user row and the first code live or die together: a registered
    // account always has exactly one live code (API_SPEC auth register).
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash: await this.hashing.hash(password),
          name,
          globalRole: DEFAULT_ROLE,
        },
        select: { id: true, email: true },
      });
      await this.otp.issue(user, 'EMAIL_VERIFICATION', tx);
    });
  }

  async verifyEmail({
    email,
    code,
  }: VerifyOtpDto): Promise<{ accessToken: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) throw new BadRequestException(INVALID_CODE);

    const verified = await this.otp.consume(
      user.id,
      'EMAIL_VERIFICATION',
      code,
      (tx) =>
        tx.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: new Date() },
          select: tokenUserSelect,
        }),
    );
    // Auto-login only for self-registered accounts.
    if (verified.globalRole !== DEFAULT_ROLE || !verified.isActive) return null;
    return { accessToken: await this.signToken(verified) };
  }

  async resendVerification({ email }: RequestCodeDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (user && !user.emailVerifiedAt) {
      await this.otp.issue(user, 'EMAIL_VERIFICATION');
    }
  }

  async forgotPassword({ email }: RequestCodeDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, isActive: true },
    });
    if (user?.isActive) await this.otp.issue(user, 'PASSWORD_RESET');
  }

  async resetPassword({
    email,
    code,
    newPassword,
  }: ResetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!user) throw new BadRequestException(INVALID_CODE);

    const passwordHash = await this.hashing.hash(newPassword);
    await this.otp.consume(user.id, 'PASSWORD_RESET', code, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          // Ends every session, including one an attacker may hold (E-39).
          tokenVersion: { increment: 1 },
          // The code proves the inbox, so the email counts as verified.
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
        select: { id: true },
      }),
    );
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  /** Returns a fresh token: the caller logs in again on every device otherwise. */
  async changePassword(
    user: AuthUser,
    { currentPassword, newPassword }: ChangePasswordDto,
  ): Promise<{ accessToken: string }> {
    const found = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        ...tokenUserSelect,
        passwordHash: true,
        emailVerifiedAt: true,
      },
    });
    const passwordOk = await this.hashing.verify(
      currentPassword,
      found?.passwordHash ?? this.dummyHash,
    );
    if (!found?.passwordHash || !passwordOk) {
      // 400, not 401: the session is valid, only the field is wrong.
      throw new BadRequestException('Current password is incorrect');
    }
    const passwordHash = await this.hashing.hash(newPassword);
    // BR-5: change-password invalidates every token and re-issues one.
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
      select: tokenUserSelect,
    });
    return { accessToken: await this.signToken(updated) };
  }

  async logoutAll(user: AuthUser): Promise<void> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true },
    });
  }

  private signToken(user: {
    id: string;
    email: string;
    tokenVersion: number;
  }): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
    };
    return this.jwt.signAsync(payload);
  }
}
