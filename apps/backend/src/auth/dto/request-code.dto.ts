import { IsAccountEmail } from '../decorators/auth-fields.decorator';

/** Body of resend-otp and forgot-password. */
export class RequestCodeDto {
  @IsAccountEmail()
  email: string;
}
