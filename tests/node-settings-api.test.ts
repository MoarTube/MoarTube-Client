import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { gzipSync } from 'node:zlib';
import { NodeApiService } from '../src/services/node-api.js';

async function withNodeResponse(
  payload: unknown,
  check: (api: NodeApiService) => Promise<void>,
  compressed = false
): Promise<void> {
  const app = Fastify();
  app.get('/settings', (_request, reply) => {
    reply.type('application/json');
    if (compressed) {
      return reply.header('Content-Encoding', 'gzip').send(gzipSync(JSON.stringify(payload)));
    }
    return reply.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as { port: number };
  const api = new NodeApiService(
    { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as never,
    {
      clientSettings: { nodeHttpProtocol: 'http', nodeIp: '127.0.0.1', nodePort: address.port },
    } as never
  );
  try {
    await check(api);
  } finally {
    api.close();
    await app.close();
  }
}

it.each(['', null, {}, { isError: false }, { nodeSettings: null }, { nodeSettings: [] }])(
  'rejects missing settings before rendering a page: %j',
  async (payload) => {
    await withNodeResponse(payload, async (api) => {
      await expect(api.getNodeSettings('token')).rejects.toThrow('Invalid Node settings response');
    });
  }
);

it.each([false, true])('returns a complete settings object (compressed=%s)', async (compressed) => {
  const nodeSettings = {
    publicNodeAddress: 'localhost',
    publicNodePort: 9090,
    publicNodeProtocol: 'http',
  };
  await withNodeResponse(
    { isError: false, nodeSettings },
    async (api) => {
      expect(await api.getNodeSettings('token')).toEqual(nodeSettings);
    },
    compressed
  );
});
