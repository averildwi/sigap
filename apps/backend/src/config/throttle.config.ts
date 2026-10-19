import { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ThrottleTierName } from './throttle-tier.decorator.js';
import { THROTTLE_TIER_KEY } from './throttle-tier.decorator.js';

export type ThrottlerOptions = {
  name: ThrottleTierName;
  ttl: number;
  limit: number;
  skipIf?: (context: ExecutionContext) => boolean;
};

/**
 * Reads the @ThrottleTier metadata of the handler only (never the class),
 * so a tier is switched on per handler (BR-80, deviation L-5).
 */
export function throttleTierOf(
  context: ExecutionContext,
): ThrottleTierName | undefined {
  const handler = context.getHandler();
  return Reflect.getMetadata(THROTTLE_TIER_KEY, handler) as
    ThrottleTierName | undefined;
}

/**
 * Builds the five named throttlers of BR-80 from env with the
 * nest-auth-and-security rule 10 defaults. `default` applies to every
 * route; the strict tiers only run for handlers carrying
 * @ThrottleTier('<name>').
 */
export function buildThrottlerOptions(
  config: ConfigService,
): ThrottlerOptions[] {
  const ttl = config.getOrThrow<number>('THROTTLE_TTL') * 1000;
  const tiers: { name: ThrottleTierName; limitEnv: string }[] = [
    { name: 'default', limitEnv: 'THROTTLE_LIMIT' },
    { name: 'auth', limitEnv: 'AUTH_THROTTLE_LIMIT' },
    { name: 'sendCode', limitEnv: 'SEND_CODE_THROTTLE_LIMIT' },
    { name: 'join', limitEnv: 'JOIN_THROTTLE_LIMIT' },
    { name: 'sos', limitEnv: 'SOS_THROTTLE_LIMIT' },
  ];

  return tiers.map(({ name, limitEnv }) => ({
    name,
    ttl,
    limit: config.getOrThrow<number>(limitEnv),
    ...(name !== 'default'
      ? {
          skipIf: (context: ExecutionContext) =>
            throttleTierOf(context) !== name,
        }
      : {}),
  }));
}
