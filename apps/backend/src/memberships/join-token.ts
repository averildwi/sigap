import { createHmac, timingSafeEqual } from 'node:crypto';

/** Length of a join token: base64url digest cut to 22 characters (BR-19). */
export const JOIN_TOKEN_LENGTH = 22;

/** Window size in seconds: `w = floor(unixSeconds / 60)` (BR-19). */
export const WINDOW_SECONDS = 60;

/** The HMAC message of one window: `qr:<communityId>:<w>` (BR-19). */
export function joinTokenMessage(communityId: string, w: number): string {
  return `qr:${communityId}:${w}`;
}

/**
 * The time window of a moment: one 60 s bucket of unix seconds (BR-19).
 */
export function currentWindow(now: Date): number {
  return Math.floor(now.getTime() / 1000 / WINDOW_SECONDS);
}

/**
 * Seconds left before the window (and with it the token) changes; the
 * frontend refreshes the QR then. At the boundary itself the full window
 * is still ahead.
 */
export function windowExpiresInSeconds(now: Date): number {
  const unixSeconds = Math.floor(now.getTime() / 1000);
  const remainder = unixSeconds % WINDOW_SECONDS;
  return remainder === 0 ? WINDOW_SECONDS : WINDOW_SECONDS - remainder;
}

/** Token of one window: `base64url(HMAC-SHA256(secret, message))` cut to 22 (BR-19). */
export function computeJoinToken(
  communityId: string,
  w: number,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(joinTokenMessage(communityId, w))
    .digest('base64url')
    .slice(0, JOIN_TOKEN_LENGTH);
}

/** The current token for a community, computed for `now` (BR-19). */
export function createJoinToken(
  communityId: string,
  secret: string,
  now: Date,
): string {
  return computeJoinToken(communityId, currentWindow(now), secret);
}

/** The QR payload of API_SPEC 4: `sigap:join:<communityId>:<token>`. */
export function buildQrContent(communityId: string, token: string): string {
  return `sigap:join:${communityId}:${token}`;
}

/**
 * BR-20: a token is valid only for window `w` or `w - 1` of the community
 * named in the request. The comparison runs on equal-length buffers with
 * `timingSafeEqual` (length mismatch -> false), so a wrong token never
 * leaks where the difference is.
 */
export function isJoinTokenValid(
  communityId: string,
  token: string,
  secret: string,
  now: Date,
): boolean {
  const w = currentWindow(now);
  for (const window of [w, w - 1]) {
    const expected = computeJoinToken(communityId, window, secret);
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const tokenBuffer = Buffer.from(token, 'utf8');
    if (
      tokenBuffer.length === expectedBuffer.length &&
      timingSafeEqual(tokenBuffer, expectedBuffer)
    ) {
      return true;
    }
  }
  return false;
}
