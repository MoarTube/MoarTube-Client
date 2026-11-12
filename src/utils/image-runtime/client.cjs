const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { spawn } = require('node:child_process');
const { inspectInput, MAX_BYTES } = require('./input.cjs');

let worker;
let active;
let sequence = 0;
let pending = 0;
let tail = Promise.resolve();
let closing = false;
const children = new Set();

async function resetWorker() {
  const previous = worker;
  worker = undefined;
  if (previous) await previous.terminate();
}
function normalize(input, signal) {
  if (!worker) {
    // Worker bootstrapping needs a physical path even when this module was
    // required through Electron's virtual ASAR filesystem.
    const physical = __dirname.replace(/\.asar([\\/])/g, '.asar.unpacked$1');
    worker = new Worker(path.join(physical, 'worker.cjs'), { execArgv: [] });
    const instance = worker;
    instance.on('message', (message) => {
      if (active?.id === message.id) {
        if (message.error) active.reject(new Error(message.error));
        else
          active.resolve({
            width: message.width,
            height: message.height,
            data: Buffer.from(
              message.data.buffer,
              message.data.byteOffset,
              message.data.byteLength
            ),
          });
      }
    });
    instance.on('error', (error) => {
      if (worker === instance) {
        worker = undefined;
        active?.reject(error);
      }
    });
    instance.on('exit', (code) => {
      if (worker === instance) {
        worker = undefined;
        active?.reject(new Error(`Image worker exited (${code})`));
      }
    });
    instance.unref();
  }
  const instance = worker;
  instance.ref();
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      if (active?.id !== id) return;
      active = undefined;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      instance.unref();
      callback(value);
    };
    const id = ++sequence;
    const abort = () => {
      finish(reject, new Error('Image processing cancelled'));
      void resetWorker();
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('Image colour conversion timed out'));
      void resetWorker();
    }, 45_000);
    active = {
      id,
      resolve: (value) => finish(resolve, value),
      reject: (error) => finish(reject, error),
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    instance.postMessage({ id, input });
  });
}

function encode(input, header, output, options) {
  const { ffmpegPath, signal, onProcess } = options;
  let filter = `scale=${output.width}:${output.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${output.width}:${output.height},setsar=1`;
  if (header.alpha)
    filter =
      'format=gbrap16le,premultiply=inplace=1,' +
      filter +
      (output.format === 'png' ? ',unpremultiply=inplace=1,format=rgba' : ',format=rgb24');
  // map_metadata does not remove per-frame EXIF/ICC side data. Leaving EXIF
  // would make an unrotated output rotate later in a browser or image viewer.
  filter += ',sidedata=mode=delete';
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-threads',
    '1',
    ...(header.raw
      ? [
          '-f',
          'rawvideo',
          '-pixel_format',
          'rgba',
          '-video_size',
          `${header.width}x${header.height}`,
        ]
      : []),
    '-noautorotate',
    '-max_pixels',
    '40000000',
    '-i',
    'pipe:0',
    '-vf',
    filter,
    '-frames:v',
    '1',
    '-threads',
    '1',
    '-map_metadata',
    '-1',
    ...(output.format === 'png'
      ? ['-c:v', 'png', '-pix_fmt', 'rgba', '-compression_level', '9']
      : ['-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p', '-qmin', '1', '-q:v', '1']),
    '-f',
    'image2pipe',
    'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: 'pipe',
      ...(signal ? { signal } : {}),
    });
    children.add(child);
    onProcess?.(child);
    let stderr = '',
      length = 0,
      failure;
    const chunks = [];
    const timer = setTimeout(() => {
      failure = new Error('Image encoding timed out');
      child.kill('SIGKILL');
    }, 45_000);
    child.stdout.on('data', (chunk) => {
      length += chunk.length;
      if (length > 32 * 1024 ** 2) {
        failure = new Error('Encoded image is too large');
        child.kill('SIGKILL');
      } else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.stdin.on('error', (error) => {
      // A decoder may finish its first image before consuming trailing data.
      // The exit status and output still decide success for an EPIPE.
      if (error.code !== 'EPIPE') failure ??= error;
    });
    child.once('error', (error) => {
      failure = error;
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      children.delete(child);
      if (failure || code !== 0 || !length)
        reject(failure ?? new Error(`Image encoding failed: ${stderr}`));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

function renderImages(input, outputs, options) {
  if (closing) return Promise.reject(new Error('Image processing is shutting down'));
  if (pending >= 4)
    return Promise.reject(new Error('Image processing is busy; please retry shortly'));
  if (
    !Array.isArray(outputs) ||
    !outputs.length ||
    outputs.length > 6 ||
    outputs.some(
      (output) =>
        !Number.isInteger(output.width) ||
        !Number.isInteger(output.height) ||
        output.width < 1 ||
        output.height < 1 ||
        output.width > 4096 ||
        output.height > 4096 ||
        !['png', 'jpeg'].includes(output.format)
    )
  )
    return Promise.reject(new Error('Invalid image output dimensions or format'));
  pending++;
  const task = tail.then(async () => {
    if (closing || options.signal?.aborted) throw new Error('Image processing cancelled');
    let data;
    if (typeof input === 'string') {
      const file = await fs.open(input, 'r');
      try {
        const size = (await file.stat()).size;
        if (size < 1 || size > MAX_BYTES) throw new Error('Image file exceeds the 20 MiB limit');
        // Bound the read even if a file grows after stat (e.g. a live frame).
        data = Buffer.alloc(size + 1);
        let offset = 0;
        while (offset < data.length) {
          const { bytesRead } = await file.read(data, offset, data.length - offset, null);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        data = data.subarray(0, offset);
      } finally {
        await file.close();
      }
    } else data = input;
    let header = inspectInput(data);
    if (header.normalize) {
      const normalized = await normalize(data, options.signal);
      data = normalized.data;
      header = { width: normalized.width, height: normalized.height, alpha: true, raw: true };
    }
    const results = [];
    for (const output of outputs) {
      if (closing || options.signal?.aborted) throw new Error('Image processing cancelled');
      results.push(await encode(data, header, output, options));
    }
    return results;
  });
  tail = task.catch(() => {});
  return task.finally(() => {
    pending--;
  });
}
async function stopImages() {
  closing = true;
  active?.reject(new Error('Image processing is shutting down'));
  for (const child of children) child.kill('SIGKILL');
  await resetWorker();
  await tail;
}
module.exports = { renderImages, stopImages };
