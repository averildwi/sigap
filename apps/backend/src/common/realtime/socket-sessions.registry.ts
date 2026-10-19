import { Injectable } from '@nestjs/common';
import { SocketSessions, userRoom } from './socket-sessions';

/** The part of the Socket.IO server this layer needs. */
export interface RealtimeServer {
  in(room: string): { disconnectSockets(close: boolean): void };
}

/**
 * Holds the Socket.IO server once the gateway is initialised, so modules
 * that must drop sockets (auth) do not import the gateway and create a
 * module cycle.
 */
@Injectable()
export class SocketSessionsRegistry implements SocketSessions {
  private server?: RealtimeServer;

  bind(server: RealtimeServer): void {
    this.server = server;
  }

  /** No-op until a server is bound (unit tests, HTTP-only boot). */
  disconnectUser(userId: string): void {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }
}
