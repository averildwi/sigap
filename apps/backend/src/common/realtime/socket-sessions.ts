/** Room of a user's sockets; the only rooms the realtime layer uses (BR-69/77). */
export const USER_ROOM_PREFIX = 'user:';

export function userRoom(userId: string): string {
  return `${USER_ROOM_PREFIX}${userId}`;
}

/** Injection token of the port that drops a user's open sockets (BR-77/E-39). */
export const SOCKET_SESSIONS = Symbol('SOCKET_SESSIONS');

/**
 * BR-77/E-39: when `tokenVersion` is bumped (reset, change-password,
 * logout-all), every socket of that user is dropped at once, not only the
 * next handshake.
 */
export interface SocketSessions {
  disconnectUser(userId: string): void;
}
