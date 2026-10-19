import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuthedSocket, RealtimeGateway } from './realtime.gateway';

interface GatewayClient {
  handshake: { auth: Record<string, unknown> };
  id: string;
  data: { user?: unknown };
  join: jest.Mock;
  disconnect: jest.Mock;
}

interface GatewayServer {
  to: jest.Mock;
  emit: jest.Mock;
}

describe('RealtimeGateway.handleConnection', () => {
  let gateway: RealtimeGateway;
  let jwt: { verifyAsync: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  const active = {
    id: 'u1',
    email: 'a@x.com',
    globalRole: 'USER',
    isActive: true,
    emailVerifiedAt: new Date(),
    tokenVersion: 3,
  };

  const client = (auth: Record<string, unknown> = {}): GatewayClient => ({
    handshake: { auth },
    id: 'sock-1',
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  });

  beforeEach(async () => {
    jwt = {
      verifyAsync: jest
        .fn()
        .mockResolvedValue({ sub: 'u1', email: 'a@x.com', tv: 3 }),
    };
    prisma = { user: { findUnique: jest.fn().mockResolvedValue(active) } };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: jwt },
        // JWT guard reused (BR-77): no second, weaker handshake check.
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'x'.repeat(32) },
        },
      ],
    }).compile();
    gateway = moduleRef.get(RealtimeGateway);
  });

  it('joins room user:<id> when the handshake token is valid', async () => {
    const sock = client({ token: 'jwt' });

    await gateway.handleConnection(sock as unknown as AuthedSocket);

    expect(jwt.verifyAsync).toHaveBeenCalledWith('jwt');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(sock.join).toHaveBeenCalledWith('user:u1');
    expect(sock.disconnect).not.toHaveBeenCalled();
    expect((sock as unknown as AuthedSocket).data.user).toEqual({
      id: 'u1',
      email: 'a@x.com',
      role: 'USER',
    });
  });

  it('disconnects when the handshake carries no token', async () => {
    const sock = client();

    await gateway.handleConnection(sock as unknown as AuthedSocket);

    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(sock.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects when the token is not a string', async () => {
    const sock = client({ token: 42 });

    await gateway.handleConnection(sock as unknown as AuthedSocket);

    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(sock.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects when the account is no longer usable (strategy check)', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...active, tokenVersion: 4 });
    const sock = client({ token: 'jwt' });

    await gateway.handleConnection(sock as unknown as AuthedSocket);

    expect(sock.join).not.toHaveBeenCalled();
    expect(sock.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('RealtimeGateway.emitToUsers', () => {
  let gateway: RealtimeGateway;
  let server: GatewayServer;

  const installServer = (): void => {
    server = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    Object.defineProperty(gateway, 'server', {
      value: server,
    });
  };

  beforeEach(() => {
    // The helper is a plain constructor call: no Nest DI needed for it.
    gateway = new RealtimeGateway(
      { verifyAsync: jest.fn() } as unknown as JwtService,
      {} as unknown as JwtStrategy,
    );
    installServer();
  });

  it('emits to the user:<id> rooms of the recipients only (BR-69)', () => {
    gateway.emitToUsers(['admin-1', 'admin-2'], 'join-request:new', {
      communityId: 'c1',
      membershipId: 'm1',
    });

    expect(server.to).toHaveBeenCalledWith(['user:admin-1', 'user:admin-2']);
    expect(server.emit).toHaveBeenCalledWith('join-request:new', {
      communityId: 'c1',
      membershipId: 'm1',
    });
  });

  it('emits nothing without recipients', () => {
    gateway.emitToUsers([], 'sos:new', {});

    expect(server.to).not.toHaveBeenCalled();
  });
});
