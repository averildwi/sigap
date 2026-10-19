import { ConfigService } from '@nestjs/config';
import { baseEnvSchema } from '../common/config/base-env.schema';
import { ConsoleOtpSender } from '../common/mail/console-otp-sender';
import { projectEnvSchema } from './env.schema';

// Same schema AppConfigModule.forProject(projectEnvSchema) validates at boot.
const schema = baseEnvSchema.concat(projectEnvSchema);
const valid = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_SECRET: 'x'.repeat(32),
  APP_URL: 'https://wargakita.example.com',
  JOIN_TOKEN_SECRET: 'y'.repeat(32),
  RESEND_API_KEY: 're_123',
  MAIL_FROM: 'WargaKita <no-reply@example.com>',
};

describe('env schema', () => {
  it('accepts a complete environment', () => {
    expect(schema.validate(valid).error).toBeUndefined();
  });

  it('fills every tier default from API_SPEC 11 (L-5)', () => {
    const { value } = schema.validate(valid) as {
      value: Record<string, unknown>;
    };
    expect(value.OTP_SENDER).toBe('resend');
    expect(value.OTP_TTL_MINUTES).toBe(10);
    expect(value.OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(value.THROTTLE_TTL).toBe(60);
    expect(value.THROTTLE_LIMIT).toBe(100);
    expect(value.AUTH_THROTTLE_LIMIT).toBe(5);
    expect(value.SEND_CODE_THROTTLE_LIMIT).toBe(3);
    expect(value.JOIN_THROTTLE_LIMIT).toBe(10);
    expect(value.SOS_THROTTLE_LIMIT).toBe(5);
  });

  it.each(['JWT_SECRET', 'APP_URL', 'JOIN_TOKEN_SECRET'])(
    'fails boot without %s',
    (key) => {
      const env: Record<string, string> = { ...valid };
      delete env[key];
      expect(schema.validate(env).error?.message).toContain(key);
    },
  );

  it.each(['RESEND_API_KEY', 'MAIL_FROM'])(
    'fails boot without %s while OTP_SENDER=resend',
    (key) => {
      const env: Record<string, string> = { ...valid };
      delete env[key];
      expect(schema.validate(env).error?.message).toContain(key);
    },
  );

  it('does not require the mail vars when OTP_SENDER=console', () => {
    const env: Record<string, string> = { ...valid };
    delete env.RESEND_API_KEY;
    delete env.MAIL_FROM;
    expect(
      schema.validate({ ...env, OTP_SENDER: 'console' }).error,
    ).toBeUndefined();
  });

  it('rejects a short JWT_SECRET', () => {
    expect(
      schema.validate({ ...valid, JWT_SECRET: 'secret' }).error,
    ).toBeDefined();
  });

  it('rejects a short JOIN_TOKEN_SECRET', () => {
    expect(
      schema.validate({ ...valid, JOIN_TOKEN_SECRET: 'z'.repeat(31) }).error,
    ).toBeDefined();
  });

  it('rejects a non-uri APP_URL', () => {
    expect(
      schema.validate({ ...valid, APP_URL: 'not a url' }).error,
    ).toBeDefined();
  });

  it('rejects an unknown OTP_SENDER', () => {
    expect(
      schema.validate({ ...valid, OTP_SENDER: 'smtp' }).error,
    ).toBeDefined();
  });
});

describe('ConsoleOtpSender', () => {
  const config = (nodeEnv: string) =>
    ({ getOrThrow: () => nodeEnv }) as unknown as ConfigService;

  it('refuses to start in production', () => {
    expect(() => new ConsoleOtpSender(config('production'))).toThrow(
      'OTP_SENDER=console is not allowed in production',
    );
  });

  it('starts in development', () => {
    expect(() => new ConsoleOtpSender(config('development'))).not.toThrow();
  });
});
