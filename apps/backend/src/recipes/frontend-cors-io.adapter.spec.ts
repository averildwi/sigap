import { IoAdapter } from '@nestjs/platform-socket.io';
import {
  parseCorsOrigins,
  FrontendCorsIoAdapter,
} from './frontend-cors-io.adapter';

describe('parseCorsOrigins (BR-81)', () => {
  it('trims each origin and drops empty entries', () => {
    expect(parseCorsOrigins('https://a.com, https://b.com ,,')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('allows no origin when FRONTEND_URL is empty', () => {
    expect(parseCorsOrigins('')).toEqual([]);
    expect(parseCorsOrigins(' ,, ')).toEqual([]);
  });
});

describe('FrontendCorsIoAdapter.createIOServer', () => {
  it('passes the parsed FRONTEND_URL allowlist as the socket CORS origin', () => {
    const app = {
      get: (): { getOrThrow: (key: string) => string } => ({
        getOrThrow: (key: string): string =>
          key === 'FRONTEND_URL' ? 'https://a.com ,https://b.com' : '',
      }),
    };
    const adapter = new FrontendCorsIoAdapter(app);

    const createIOServer = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue({});
    try {
      adapter.createIOServer(3000);

      expect(createIOServer).toHaveBeenCalledWith(
        3000,
        expect.objectContaining({
          cors: { origin: ['https://a.com', 'https://b.com'] },
        }),
      );
    } finally {
      createIOServer.mockRestore();
    }
  });
});
