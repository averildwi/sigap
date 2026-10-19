import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Socket, Server } from 'socket.io';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import type { AuthUser, JwtPayload } from '../common/types/auth-user';

/** Room of a user's sockets; the only rooms this gateway uses (BR-69/77). */
export const USER_ROOM_PREFIX = 'user:';

export interface AuthedSocket extends Socket {
  data: { user?: AuthUser };
}

/**
 * Namespace `/realtime` (PRD 8.6). The token comes from `handshake.auth.token`
 * (BR-77), never the query string: URLs end up in proxy and access logs. The
 * handshake reuses JwtStrategy.validate, so the same checks as HTTP apply
 * (isActive, emailVerifiedAt, tokenVersion). CORS comes from
 * FrontendCorsIoAdapter (BR-81).
 */
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server?: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly strategy: JwtStrategy,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token: unknown = client.handshake.auth?.token;
      if (typeof token !== 'string') throw new UnauthorizedException();
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      // Same checks as HTTP: isActive, emailVerifiedAt, tokenVersion (BR-77).
      client.data.user = await this.strategy.validate(payload);
      // Each socket joins only its own user room (BR-77).
      await client.join(`${USER_ROOM_PREFIX}${client.data.user.id}`);
    } catch {
      this.logger.debug(`Rejected socket ${client.id}`);
      client.disconnect(true);
    }
  }

  /**
   * After-commit emit helper (BR-69): call this only after the writing
   * transaction has committed, with recipients computed from the database at
   * send time. Emits to `user:<id>` rooms only, so a REMOVED member's room
   * stops receiving community events.
   */
  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    if (userIds.length === 0) return;
    const rooms = userIds.map((id) => `${USER_ROOM_PREFIX}${id}`);
    this.server?.to(rooms).emit(event, payload);
  }
}
