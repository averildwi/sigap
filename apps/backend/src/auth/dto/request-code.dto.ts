import { IsAccountEmail } from '../decorators/auth-fields.decorator';

/** Body of resend-otp (this step) and forgot-password (next commit). */
export class RequestCodeDto {
  @IsAccountEmail()
  email: string;
}
