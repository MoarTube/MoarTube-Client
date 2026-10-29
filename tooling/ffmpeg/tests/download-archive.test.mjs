import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadArchive } from '../scripts/download-archive.mjs';

const content = Buffer.from('locked archive bytes');
const sha256 = createHash('sha256').update(content).digest('hex');
const options = {
  offline: false,
  attempts: 3,
  connectTimeoutMs: 500,
  transferTimeoutMs: 2000,
  backoffMs: 0,
  log: () => {},
};
async function fixture(t, handler) {
  const directory = await mkdtemp(path.join(tmpdir(), 'moartube-download-'));
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (
      path.dirname(directory) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith('moartube-download-')
    )
      throw new Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    source: {
      archive: 'source.tar.gz',
      sha256,
      url: `http://127.0.0.1:${server.address().port}/source`,
    },
  };
}

test('retries HTTP 503 and connection reset, then caches only checksum-verified bytes', async (t) => {
  let requests = 0;
  const { directory, source } = await fixture(t, (request, response) => {
    requests++;
    if (requests === 1) {
      response.writeHead(503);
      response.end('temporary failure');
    } else if (requests === 2) request.socket.destroy();
    else response.end(content);
  });
  const file = await downloadArchive(source, directory, options);
  assert.equal(requests, 3);
  assert.deepEqual(await readFile(file), content);
  assert.deepEqual(await readdir(directory), [source.archive]);
  assert.equal(await downloadArchive(source, directory, options), file);
  assert.equal(requests, 3);
});

test('discards an interrupted response and starts the next transfer from zero', async (t) => {
  let requests = 0;
  const { directory, source } = await fixture(t, (request, response) => {
    if (++requests === 1) {
      response.writeHead(200, { 'Content-Length': 1000 });
      response.write('partial');
      setTimeout(() => response.destroy(), 10);
    } else response.end(content);
  });
  const file = await downloadArchive(source, directory, options);
  assert.equal(requests, 2);
  assert.deepEqual(await readFile(file), content);
  assert.deepEqual(await readdir(directory), [source.archive]);
});

test('permanent HTTP failures and checksum mismatches fail without retrying or caching', async (t) => {
  for (const status of [404, 200]) {
    let requests = 0;
    const { directory, source } = await fixture(t, (request, response) => {
      requests++;
      response.writeHead(status);
      response.end('wrong bytes');
    });
    await assert.rejects(
      downloadArchive(source, directory, options),
      status === 404 ? /HTTP 404/ : /checksum mismatch/
    );
    assert.equal(requests, 1);
    assert.deepEqual(await readdir(directory), []);
  }
});

test('a corrupt cached archive is rejected without silently downloading a replacement', async (t) => {
  let requests = 0;
  const { directory, source } = await fixture(t, (request, response) => {
    requests++;
    response.end(content);
  });
  await writeFile(path.join(directory, source.archive), 'tampered');
  await assert.rejects(
    downloadArchive(source, directory, options),
    /Cached archive checksum mismatch/
  );
  assert.equal(requests, 0);
});

test('compilation offline mode refuses a missing dependency without making a request', async (t) => {
  let requests = 0;
  const { directory, source } = await fixture(t, (request, response) => {
    requests++;
    response.end(content);
  });
  await assert.rejects(
    downloadArchive(source, directory, { ...options, offline: true }),
    /Missing predownloaded archive/
  );
  assert.equal(requests, 0);
});

test('bounded transfer timeouts exhaust retries and leave no partial archive', async (t) => {
  let requests = 0;
  const { directory, source } = await fixture(t, () => {
    requests++;
  });
  await assert.rejects(
    downloadArchive(source, directory, { ...options, attempts: 2, transferTimeoutMs: 40 }),
    /after 2 attempt/
  );
  assert.equal(requests, 2);
  assert.deepEqual(await readdir(directory), []);
});

test('TLS connection timeout is separate from the archive transfer budget', async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const { directory, source } = await fixture(t, (request, response) => response.end(content));
  source.url = `https://127.0.0.1:${server.address().port}/source`;
  await assert.rejects(
    downloadArchive(source, directory, { ...options, attempts: 2, connectTimeoutMs: 40 }),
    /Connection timed out/
  );
  assert.deepEqual(await readdir(directory), []);
});

test('a stalled response body is retried without waiting for the total transfer budget', async (t) => {
  let requests = 0;
  const { directory, source } = await fixture(t, (request, response) => {
    requests++;
    response.writeHead(200, { 'Content-Length': 1000 });
    response.write('partial');
  });
  await assert.rejects(
    downloadArchive(source, directory, { ...options, attempts: 2, idleTimeoutMs: 40 }),
    /after 2 attempt/
  );
  assert.equal(requests, 2);
  assert.deepEqual(await readdir(directory), []);
});

test('redirects retain checksum enforcement and reject insecure remote destinations', async (t) => {
  const { directory, source } = await fixture(t, (request, response) => {
    if (request.url === '/source') {
      response.writeHead(302, { Location: '/archive' });
      response.end();
    } else if (request.url === '/insecure') {
      response.writeHead(302, { Location: 'http://example.com/source.tar.gz' });
      response.end();
    } else response.end(content);
  });
  await downloadArchive(source, directory, options);
  await assert.rejects(
    downloadArchive(
      { ...source, archive: 'other.tar.gz', url: source.url.replace('/source', '/insecure') },
      directory,
      options
    ),
    /must use HTTPS/
  );
  assert.deepEqual(await readdir(directory), [source.archive]);
});
