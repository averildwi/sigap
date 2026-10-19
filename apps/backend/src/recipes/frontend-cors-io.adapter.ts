import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Parses the FRONTEND_URL allowlist for the Socket.IO server: split on
 * commas, trimmed, empty entries dropped. An empty value allows no origin
 * (BR-81), never '*'.
 */
export function parseCorsOrigins(frontendUrl: string): string[] {
  return frontendUrl
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Socket.IO with the same CORS allowlist as HTTP (FRONTEND_URL), instead of a
 * hardcoded `cors: { origin: '*' }` on the gateway. main.ts:
 *   app.useWebSocketAdapter(new FrontendCorsIoAdapter(app));
 */
export class FrontendCorsIoAdapter extends IoAdapter {
  private readonly origins: string[];

  constructor(app: INestApplicationContext) {
    super(app);
    this.origins = parseCorsOrigins(
      app.get(ConfigService).getOrThrow<string>('FRONTEND_URL'),
    );
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins },
    });
  }
}
