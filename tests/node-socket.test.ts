import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeSocketService } from '../src/services/node-socket.js';
import type { Logger } from '../src/utils/logger.js';
import type { Config } from '../src/config/index.js';
import type { SocketService } from '../src/services/socket.js';
import type { VideoPublishService } from '../src/services/video-publish.js';
import type { LiveStreamService } from '../src/services/live-stream.js';
import type { VideoImportService } from '../src/services/video-import.js';

interface TestSocket {
  emit(event: string, ...args: unknown[]): boolean;
  send: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

const { sockets } = vi.hoisted(() => ({ sockets: [] as TestSocket[] }));

function socketAt(index: number): TestSocket {
  const socket = sockets[index];
  if (!socket) {
    throw new Error('Expected a WebSocket connection');
  }
  return socket;
}

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    send = vi.fn();
    terminate = vi.fn(() => {
      this.readyState = 3;
      this.emit('close');
    });

    constructor() {
      super();
      sockets.push(this);
    }
  }
  return { default: FakeWebSocket };
});

describe('Node WebSocket authentication and reconnects', () => {
  let service: NodeSocketService;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const rejectRegistration = (socket: TestSocket): void => {
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          eventName: 'error',
          errorType: 'register',
          message: 'Invalid JWT token. Please re-authenticate.',
        })
      )
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sockets.length = 0;
    service = new NodeSocketService(
      logger as unknown as Logger,
      {
        clientSettings: { nodeWebsocketProtocol: 'ws', nodeIp: '127.0.0.1', nodePort: 80 },
      } as Config,
      {} as SocketService,
      {} as VideoPublishService,
      {} as LiveStreamService,
      {} as VideoImportService
    );
  });

  afterEach(() => {
    service.disconnect();
    vi.useRealTimers();
  });

  it('stops reconnecting and heartbeat timers when Node rejects registration', () => {
    service.connect('rejected-token');
    const socket = socketAt(0);
    socket.emit('open');
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(2);

    rejectRegistration(socket);

    expect(service.isConnected).toBe(false);
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'Node rejected WebSocket registration; sign in again to reconnect'
    );
    socket.emit('close');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('continues reconnecting after an ordinary connection loss', () => {
    service.connect('valid-token');
    socketAt(0).emit('open');
    socketAt(0).emit('close');
    expect(service.isConnected).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    socketAt(1).emit('open');
    expect(socketAt(1).send).toHaveBeenCalledWith(
      JSON.stringify({
        eventName: 'register',
        socketType: 'moartube_client',
        jwtToken: 'valid-token',
      })
    );
  });

  it('stops a reconnect loop when the replacement Node rejects the old token', () => {
    service.connect('old-token');
    socketAt(0).emit('open');
    socketAt(0).emit('close');
    vi.advanceTimersByTime(1000);
    socketAt(1).emit('open');
    rejectRegistration(socketAt(1));
    vi.advanceTimersByTime(60_000);
    expect(service.isConnected).toBe(false);
    expect(sockets).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows a new sign-in to connect with a fresh token and resume normal reconnects', () => {
    service.connect('old-token');
    const old = socketAt(0);
    old.emit('open');
    rejectRegistration(old);
    service.connect('fresh-token');
    const current = socketAt(1);
    current.emit('open');
    current.emit('message', Buffer.from('{"eventName":"registered"}'));
    expect(service.isConnected).toBe(true);
    expect(current.send).toHaveBeenCalledWith(
      JSON.stringify({
        eventName: 'register',
        socketType: 'moartube_client',
        jwtToken: 'fresh-token',
      })
    );
    // Late events from the rejected socket cannot disconnect the new session.
    rejectRegistration(old);
    old.emit('close');
    expect(service.isConnected).toBe(true);
    expect(current.terminate).not.toHaveBeenCalled();
    current.emit('close');
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(3);
  });

  it('keeps reconnects enabled for errors unrelated to registration', () => {
    service.connect('valid-token');
    const socket = socketAt(0);
    socket.emit('open');
    socket.emit('message', Buffer.from('{"eventName":"error","errorType":"message"}'));
    expect(socket.terminate).not.toHaveBeenCalled();
    socket.emit('close');
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
  });
});
