import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import {
  IsAccountEmail,
  IsNewPassword,
} from '../decorators/auth-fields.decorator';

export class RegisterDto {
  @IsAccountEmail()
  email: string;

  @IsNewPassword()
  password: string;

  @ApiProperty({ example: 'Siti Aminah' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  name: string;
}
