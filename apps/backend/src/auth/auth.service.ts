import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GlobalRole, Prisma } from '../../generated/prisma/client';
import { HashingService } from '../common/hashing/hashing.service';
import type { JwtPayload } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { INVALID_CODE, OtpService } from './otp/otp.service';

/** App-wide role of self-registered accounts. Privileged accounts come from the seed. */
export const DEFAULT_ROLE: GlobalRole = 'USER';

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
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

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

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
    if (!user) throw new UnauthorizedException();
    return user;
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
