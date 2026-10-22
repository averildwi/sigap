import {
  JOIN_TOKEN_LENGTH,
  WINDOW_SECONDS,
  buildQrContent,
  computeJoinToken,
  createJoinToken,
  isJoinTokenValid,
  joinTokenMessage,
  currentWindow,
  windowExpiresInSeconds,
} from './join-token';

const SECRET = 'x'.repeat(32);
const COMMUNITY_ID = '3f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
// A moment with 12 s left in minute 10 000.
const NOW = new Date(10_000 * WINDOW_SECONDS * 1000 + 48_000);

describe('join-token (BR-19/BR-20)', () => {
  describe('currentWindow', () => {
    it('floors the unix seconds into 60 s buckets (BR-19)', () => {
      expect(currentWindow(new Date(0))).toBe(0);
      expect(currentWindow(NOW)).toBe(10_000);
      expect(currentWindow(new Date(10_001 * WINDOW_SECONDS * 1000 - 1))).toBe(
        10_000,
      );
      expect(currentWindow(new Date(10_001 * WINDOW_SECONDS * 1000))).toBe(
        10_001,
      );
    });
  });

  describe('joinTokenMessage', () => {
    it('names the community and the window', () => {
      expect(joinTokenMessage(COMMUNITY_ID, 42)).toBe(`qr:${COMMUNITY_ID}:42`);
    });
  });

  describe('computeJoinToken', () => {
    it('is a 22 character base64url HMAC unique per window and secret (BR-19)', () => {
      const token = computeJoinToken(COMMUNITY_ID, 10_000, SECRET);
      expect(token).toHaveLength(JOIN_TOKEN_LENGTH);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      // Deterministic for the same window, different for the next.
      expect(computeJoinToken(COMMUNITY_ID, 10_000, SECRET)).toBe(token);
      expect(computeJoinToken(COMMUNITY_ID, 9_999, SECRET)).not.toBe(token);
      expect(computeJoinToken(COMMUNITY_ID, 10_000, 'y'.repeat(32))).not.toBe(
        token,
      );
    });
  });

  describe('createJoinToken', () => {
    it('derives the token for the window of now (BR-19)', () => {
      // Zero tolerance for clock reasoning: now and its token come from the
      // same moment, so the pure parts must agree.
      expect(createJoinToken(COMMUNITY_ID, SECRET, NOW)).toBe(
        computeJoinToken(COMMUNITY_ID, currentWindow(NOW), SECRET),
      );
    });
  });

  describe('buildQrContent', () => {
    it('is the sigap:join payload the frontend parses (API_SPEC 4)', () => {
      expect(buildQrContent(COMMUNITY_ID, 'token22')).toBe(
        `sigap:join:${COMMUNITY_ID}:token22`,
      );
    });
  });

  describe('isJoinTokenValid', () => {
    it('accepts the token of the current window (BR-20)', () => {
      expect(
        isJoinTokenValid(
          COMMUNITY_ID,
          computeJoinToken(COMMUNITY_ID, currentWindow(NOW), SECRET),
          SECRET,
          NOW,
        ),
      ).toBe(true);
    });

    it('accepts the token of the previous window (BR-20)', () => {
      expect(
        isJoinTokenValid(
          COMMUNITY_ID,
          computeJoinToken(COMMUNITY_ID, currentWindow(NOW) - 1, SECRET),
          SECRET,
          NOW,
        ),
      ).toBe(true);
    });

    it('rejects a token from two windows ago (BR-20)', () => {
      expect(
        isJoinTokenValid(
          COMMUNITY_ID,
          computeJoinToken(COMMUNITY_ID, currentWindow(NOW) - 2, SECRET),
          SECRET,
          NOW,
        ),
      ).toBe(false);
    });

    it('rejects a token of another community (BR-20)', () => {
      const otherCommunity = '9f0c6c1e-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
      expect(
        isJoinTokenValid(
          otherCommunity,
          computeJoinToken(COMMUNITY_ID, currentWindow(NOW), SECRET),
          SECRET,
          NOW,
        ),
      ).toBe(false);
    });

    it('rejects a token computed with another secret (BR-20)', () => {
      expect(
        isJoinTokenValid(
          COMMUNITY_ID,
          computeJoinToken(COMMUNITY_ID, currentWindow(NOW), 'y'.repeat(32)),
          SECRET,
          NOW,
        ),
      ).toBe(false);
    });

    it('rejects a non-22 character token without crashing (E-11)', () => {
      // Shorter and longer wrong tokens hit the length guard of
      // timingSafeEqual instead of throwing.
      [
        'tooshort',
        'a'.repeat(JOIN_TOKEN_LENGTH - 1),
        'a'.repeat(JOIN_TOKEN_LENGTH + 1),
        '',
      ].forEach((token) => {
        expect(isJoinTokenValid(COMMUNITY_ID, token, SECRET, NOW)).toBe(false);
      });
    });
  });

  describe('windowExpiresInSeconds', () => {
    it('counts down to the window change', () => {
      // now is 48 s into its minute -> 12 s left.
      expect(windowExpiresInSeconds(NOW)).toBe(12);
      expect(
        windowExpiresInSeconds(new Date(10_001 * WINDOW_SECONDS * 1000)),
      ).toBe(WINDOW_SECONDS);
    });
  });
});
