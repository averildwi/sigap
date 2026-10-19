import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule],
  providers: [JwtStrategy],
  // A WebSocket gateway reuses the same checks (BR-77).
  exports: [JwtStrategy],
})
export class AuthModule {}
