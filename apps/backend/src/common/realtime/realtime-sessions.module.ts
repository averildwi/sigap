import { Global, Module } from '@nestjs/common';
import { SOCKET_SESSIONS } from './socket-sessions';
import { SocketSessionsRegistry } from './socket-sessions.registry';

/**
 * Global so AuthModule drops sockets on a token bump (BR-77) without
 * importing the notifications module that owns the gateway.
 */
@Global()
@Module({
  providers: [
    SocketSessionsRegistry,
    { provide: SOCKET_SESSIONS, useExisting: SocketSessionsRegistry },
  ],
  exports: [SOCKET_SESSIONS, SocketSessionsRegistry],
})
export class RealtimeSessionsModule {}
