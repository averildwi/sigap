import { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { THROTTLE_TIER_KEY } from './throttle-tier.decorator';
import { buildThrottlerOptions, throttleTierOf } from './throttle.config';

function contextFor(
  handler: () => unknown,
  klass?: new () => unknown,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => klass ?? class {},
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('throttleTierOf', () => {
  it('returns the tier set on the handler metadata', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(THROTTLE_TIER_KEY, 'auth', handler);
    expect(throttleTierOf(contextFor(handler))).toBe('auth');
  });

  it('returns undefined for a handler without a tier', () => {
    expect(throttleTierOf(contextFor(() => undefined))).toBeUndefined();
  });

  it('ignores tier metadata set on the class, so the tier is per handler only', () => {
    const handler = () => undefined;
    class Controller {}
    Reflect.defineMetadata(THROTTLE_TIER_KEY, 'auth', Controller);
    expect(throttleTierOf(contextFor(handler, Controller))).toBeUndefined();
  });

  it('reads the handler value, not a class value, when both exist', () => {
    const handler = () => undefined;
    class Controller {}
    Reflect.defineMetadata(THROTTLE_TIER_KEY, 'sos', handler);
    Reflect.defineMetadata(THROTTLE_TIER_KEY, 'auth', Controller);
    expect(throttleTierOf(contextFor(handler, Controller))).toBe('sos');
  });
});

describe('buildThrottlerOptions', () => {
  const settings: Record<string, number> = {
    THROTTLE_TTL: 60,
    THROTTLE_LIMIT: 100,
    AUTH_THROTTLE_LIMIT: 5,
    SEND_CODE_THROTTLE_LIMIT: 3,
    JOIN_THROTTLE_LIMIT: 10,
    SOS_THROTTLE_LIMIT: 5,
  };
  const config = {
    getOrThrow: (key: string) => settings[key],
  } as unknown as ConfigService;

  it('pins the five tier defaults to the skill rule 10 values (L-5)', () => {
    const options = buildThrottlerOptions(config);
    expect(options.map((o) => [o.name, o.limit])).toEqual([
      ['default', 100],
      ['auth', 5],
      ['sendCode', 3],
      ['join', 10],
      ['sos', 5],
    ]);
  });

  it('converts THROTTLE_TTL seconds to milliseconds (BR-80)', () => {
    for (const option of buildThrottlerOptions(config)) {
      expect(option.ttl).toBe(60_000);
    }
  });

  it('reads every tier limit from env, not from literals', () => {
    const raised: Record<string, number> = {
      ...settings,
      AUTH_THROTTLE_LIMIT: 50,
    };
    const options = buildThrottlerOptions({
      getOrThrow: (key: string) => raised[key],
    } as unknown as ConfigService);
    expect(options.find((o) => o.name === 'auth')?.limit).toBe(50);
  });

  it('applies default to every route and skips the strict tiers elsewhere', () => {
    const options = buildThrottlerOptions(config);
    expect(options[0].skipIf).toBeUndefined();

    const plain = contextFor(() => undefined);
    for (const tier of options.slice(1)) {
      expect(tier.skipIf?.(plain)).toBe(true);
    }

    const authHandler = () => undefined;
    Reflect.defineMetadata(THROTTLE_TIER_KEY, 'auth', authHandler);
    const authContext = contextFor(authHandler);
    for (const tier of options.slice(1)) {
      expect(tier.skipIf?.(authContext)).toBe(tier.name !== 'auth');
    }
  });
});
