import { SocketSessionsRegistry } from './socket-sessions.registry';

describe('SocketSessionsRegistry (BR-77/E-39)', () => {
  let registry: SocketSessionsRegistry;

  beforeEach(() => {
    registry = new SocketSessionsRegistry();
  });

  it('is a no-op before the gateway binds a server', () => {
    expect(() => registry.disconnectUser('u1')).not.toThrow();
  });

  it("drops every socket of that user's room", () => {
    const disconnectSockets = jest.fn();
    const server = { in: jest.fn(() => ({ disconnectSockets })) };

    registry.bind(server);
    registry.disconnectUser('u1');

    expect(server.in).toHaveBeenCalledWith('user:u1');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });
});
