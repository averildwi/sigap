import { SetMetadata } from '@nestjs/common';

// Metadata key for the throttle tier a handler opts into (deviation L-5).
export const THROTTLE_TIER_KEY = 'THROTTLE_TIER';

// The named throttlers registered in app.module.ts (BR-80).
export type ThrottleTierName = 'default' | 'auth' | 'sendCode' | 'join' | 'sos';

/**
 * Marks a handler with a named throttle tier. The strict tiers use
 * `skipIf` in ThrottlerModule.forRootAsync and only run for the handler
 * that carries this decorator; `default` applies to every route.
 * Handler level only, never the class (BR-80, deviation L-5).
 */
export function ThrottleTier(name: ThrottleTierName): MethodDecorator {
  return SetMetadata(THROTTLE_TIER_KEY, name);
}
