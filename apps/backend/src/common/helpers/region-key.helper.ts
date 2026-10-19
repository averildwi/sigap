import { normaliseRegionPart } from './region-normalise.helper';

/** The region fields of a community, before normalisation. */
export interface RegionInput {
  province: string;
  city: string;
  district: string;
  village: string;
}

/**
 * Region key of a community (BR-12, DATA_MODEL N-7): the tenant identity
 * "one RT/RW pair in one village". At most one community per key, enforced
 * by the unique index on Community.regionKey (BR-14). Stored once on
 * create, never returned by an endpoint (API_SPEC 0.3).
 */
export function buildRegionKey(
  input: { rt: number; rw: number } & RegionInput,
): string {
  return [
    String(input.rt),
    String(input.rw),
    normaliseRegionPart('village', input.village),
    normaliseRegionPart('district', input.district),
    normaliseRegionPart('city', input.city),
    normaliseRegionPart('province', input.province),
  ].join(':');
}
