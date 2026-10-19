import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import { AuthService } from './auth.service';
import { ThrottleTier } from '../config/throttle-tier.decorator';
import { RegisterDto } from './dto/register.dto';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

const CODE_SENT = 'If the account can receive a code, it has been sent';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ThrottleTier('auth')
  @ApiOperation({ summary: '[PUBLIC] Register and send a verification code' })
  async register(@Body() dto: RegisterDto) {
    await this.authService.register(dto);
    return new MessageResponse(
      null,
      'Registered, check your email for the code',
    );
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ThrottleTier('auth')
  @ApiOperation({ summary: '[PUBLIC] Verify the email with a code' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return new MessageResponse(
      await this.authService.verifyEmail(dto),
      'Email verified',
    );
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ThrottleTier('sendCode')
  @ApiOperation({ summary: '[PUBLIC] Send a new verification code' })
  async resendOtp(@Body() dto: RequestCodeDto) {
    await this.authService.resendVerification(dto);
    return new MessageResponse(null, CODE_SENT);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '[AUTH] Get my profile' })
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }
}
