import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const transientCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_STREAM_PREMATURE_CLOSE',
]);
const sha256 = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

function validateUrl(value) {
  const url = new URL(value);
  // Loopback HTTP is useful for deterministic tests; remote archives require TLS.
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  )
    throw new Error('Source archive URLs must use HTTPS without credentials');
  return url;
}

async function transfer(
  value,
  destination,
  { connectTimeoutMs, idleTimeoutMs, deadline },
  redirects = 0
) {
  const url = validateUrl(value);
  if (redirects > 5) throw new Error('Too many archive redirects');
  let connectTimer;
  let totalTimer;
  try {
    const redirect = await new Promise((resolve, reject) => {
      let streaming = false;
      const request = (url.protocol === 'https:' ? https : http).get(
        url,
        {
          headers: { 'User-Agent': 'MoarTube-FFmpeg-Builder', Accept: 'application/octet-stream' },
          autoSelectFamily: true,
        },
        (response) => {
          clearTimeout(connectTimer);
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            response.destroy();
            if (!response.headers.location) {
              reject(new Error('Archive redirect has no destination'));
              return;
            }
            let next;
            try {
              next = validateUrl(new URL(response.headers.location, url));
            } catch (error) {
              reject(error);
              return;
            }
            if (url.protocol === 'https:' && next.protocol !== 'https:') {
              reject(new Error('Archive redirect attempted to downgrade HTTPS'));
              return;
            }
            resolve(next);
            return;
          }
          if (response.statusCode !== 200) {
            response.destroy();
            const error = new Error(`HTTP ${response.statusCode} from ${url}`);
            error.retryable = transientStatuses.has(response.statusCode);
            reject(error);
            return;
          }
          streaming = true;
          pipeline(response, createWriteStream(destination, { flags: 'wx' })).then(
            () => resolve(undefined),
            reject
          );
        }
      );
      request.once('error', (error) => {
        if (!streaming) reject(error);
      });
      request.setTimeout(idleTimeoutMs, () =>
        request.destroy(
          Object.assign(
            new Error(`Archive connection stalled for ${idleTimeoutMs}ms: ${url.hostname}`),
            { code: 'ETIMEDOUT' }
          )
        )
      );
      connectTimer = setTimeout(
        () =>
          request.destroy(
            Object.assign(
              new Error(`Connection timed out after ${connectTimeoutMs}ms: ${url.hostname}`),
              { code: 'ETIMEDOUT' }
            )
          ),
        connectTimeoutMs
      );
      request.once('socket', (socket) => {
        if (!socket.connecting) clearTimeout(connectTimer);
        else
          socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () =>
            clearTimeout(connectTimer)
          );
      });
      totalTimer = setTimeout(
        () =>
          request.destroy(
            Object.assign(new Error(`Archive transfer timed out: ${url}`), { code: 'ETIMEDOUT' })
          ),
        Math.max(1, deadline - Date.now())
      );
    });
    if (redirect) {
      clearTimeout(totalTimer);
      return transfer(
        redirect,
        destination,
        { connectTimeoutMs, idleTimeoutMs, deadline },
        redirects + 1
      );
    }
  } finally {
    clearTimeout(connectTimer);
    clearTimeout(totalTimer);
  }
}

export async function downloadArchive(
  input,
  directory,
  {
    attempts = 10,
    connectTimeoutMs = 10000,
    idleTimeoutMs = 30000,
    transferTimeoutMs = 600000,
    backoffMs = 1000,
    log = console.log,
    offline = process.env.MOARTUBE_FFMPEG_OFFLINE === '1',
  } = {}
) {
  if (
    !/^[a-zA-Z0-9_.+~-]+$/.test(input.archive) ||
    ['.', '..'].includes(input.archive) ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  )
    throw new Error('Invalid source lock entry');
  validateUrl(input.url);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10)
    throw new Error('Invalid archive download attempt count');
  const target = path.resolve(directory, input.archive);
  await mkdir(directory, { recursive: true });
  const cached = await access(target).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  );
  if (cached) {
    if ((await sha256(target)) !== input.sha256)
      throw new Error(`Cached archive checksum mismatch: ${target}`);
    return target;
  }
  if (offline)
    throw new Error(
      `Missing predownloaded archive: ${input.archive}. Run the dependency preparation step first.`
    );
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const temporary = `${target}.partial-${process.pid}-${randomUUID()}`;
    try {
      log(`Fetching ${input.archive} (attempt ${attempt}/${attempts})`);
      await transfer(input.url, temporary, {
        connectTimeoutMs,
        idleTimeoutMs,
        deadline: Date.now() + transferTimeoutMs,
      });
      if ((await sha256(temporary)) !== input.sha256)
        throw new Error(`Downloaded archive checksum mismatch: ${input.archive}`);
      await rename(temporary, target);
      return target;
    } catch (error) {
      const retryable = error.retryable ?? transientCodes.has(error.code);
      if (!retryable || attempt === attempts)
        throw new Error(
          `Failed to download ${input.archive} from ${input.url} after ${attempt} attempt(s): ${error.message}`,
          { cause: error }
        );
      const wait = Math.min(backoffMs * 2 ** (attempt - 1), 8000);
      log(`${input.archive}: ${error.message}; retrying in ${wait}ms`);
      // Remove partial data before the next attempt. A checksum failure is never
      // retried and can never enter the verified cache.
      await rm(temporary, { force: true });
      await delay(wait);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
