import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = path.join(root, 'build/ffmpeg');
const cache = path.join(base, 'cache');
const work = path.join(base, 'work');
const msys = path.join(work, 'msys64');
const bash = path.join(msys, 'usr/bin/bash.exe');
const readJson = async (name) =>
  JSON.parse(
    (await readFile(new URL(`../${name}`, import.meta.url), 'utf8')).replace(/^\uFEFF/, '')
  );
const exists = async (name) =>
  access(name).then(
    () => true,
    () => false
  );
const hash = async (name) => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(name)) digest.update(chunk);
  return digest.digest('hex');
};
const posix = (name) =>
  name.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

async function run(executable, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${executable} failed (${signal ?? code})`))
    );
  });
}

async function download(input) {
  if (!/^[a-zA-Z0-9_.+~\-]+$/.test(input.archive) || !/^[a-f0-9]{64}$/.test(input.sha256))
    throw new Error('Invalid source lock entry');
  const target = path.join(cache, input.archive);
  if (await exists(target)) {
    if ((await hash(target)) !== input.sha256)
      throw new Error(`Cached archive checksum mismatch: ${target}`);
    return target;
  }
  console.log(`Fetching ${input.archive}`);
  const response = await fetch(input.url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body)
    throw new Error(`Download failed: ${input.url} (${response.status})`);
  const temporary = `${target}.partial`;
  try {
    await pipeline(response.body, createWriteStream(temporary));
    if ((await hash(temporary)) !== input.sha256)
      throw new Error(`Downloaded archive checksum mismatch: ${input.archive}`);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return target;
}

async function shell(command) {
  await run(bash, ['-lc', command], {
    env: { ...process.env, MSYSTEM: 'CLANG64', CHERE_INVOKING: '1', MSYS2_PATH_TYPE: 'minimal' },
  });
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Build requires native Windows x64 Node.js');
  const sources = await readJson('sources.lock.json');
  const toolchain = await readJson('toolchain.lock.json');
  await mkdir(cache, { recursive: true });
  await mkdir(work, { recursive: true });
  const bootstrap = await download(toolchain.bootstrap);
  if (!(await exists(bash))) await run('tar.exe', ['-xf', bootstrap, '-C', work]);
  const identity = createHash('sha256').update(JSON.stringify(toolchain)).digest('hex');
  const stamp = path.join(work, 'toolchain.identity');
  if (!(await exists(stamp)) || (await readFile(stamp, 'utf8')) !== identity) {
    const packages = [];
    for (const input of toolchain.packages) packages.push(await download(input));
    // Install only checksum-locked archives, never synchronize a rolling repository.
    await shell(
      `pacman-key --init && pacman-key --populate msys2 && pacman -U --noconfirm --needed ${packages.map((name) => quote(posix(name))).join(' ')}`
    );
    await writeFile(stamp, identity);
  }
  await shell(`pacman -Q > ${quote(posix(path.join(work, 'installed-packages.txt')))}`);
  const installed = (await readFile(path.join(work, 'installed-packages.txt'), 'utf8'))
    .trim()
    .split(/\r?\n/)
    .sort();
  if (JSON.stringify(installed) !== JSON.stringify([...toolchain.installed].sort()))
    throw new Error(
      'Installed toolchain differs from lock. Use a fresh build/ffmpeg/work directory.'
    );
  for (const input of sources.sources) {
    const archive = await download(input);
    const destination = path.join(work, 'sources', input.id);
    const marker = path.join(destination, '.moartube-source-sha256');
    if (await exists(marker)) {
      if ((await readFile(marker, 'utf8')) !== input.sha256)
        throw new Error(`Source changed for ${input.id}; use a fresh work directory`);
      continue;
    }
    await mkdir(destination, { recursive: true });
    await run('tar.exe', [
      '-xf',
      archive,
      '-C',
      destination,
      '--strip-components=1',
      ...(input.extract ?? []),
    ]);
    await writeFile(marker, input.sha256);
  }
  for (const name of sources.patches) {
    const patch = await readJson(`patches/${name}`);
    const file = path.join(work, 'sources', patch.source, patch.file);
    const contents = await readFile(file, 'utf8');
    if (contents.includes(patch.after)) continue;
    if (contents.split(patch.before).length !== 2)
      throw new Error(`Patch context mismatch: ${patch.id}`);
    await writeFile(file, contents.replace(patch.before, patch.after));
  }
  if (process.argv.includes('--prepare-only')) {
    console.log('Locked toolchain and sources prepared.');
    return;
  }
  await shell(
    `bash ${quote(posix(path.join(root, 'tooling/ffmpeg/platforms/windows/build.sh')))} ${quote(posix(root))}`
  );
  const bin = path.join(base, 'install/win32-x64/bin');
  await run(process.execPath, [
    path.join(root, 'tooling/ffmpeg/scripts/verify-features.mjs'),
    path.join(bin, 'ffmpeg.exe'),
    path.join(bin, 'ffprobe.exe'),
  ]);
  await run(process.execPath, [path.join(root, 'tooling/ffmpeg/scripts/inspect-windows.mjs')]);
  await run(process.execPath, [
    path.join(root, 'tooling/ffmpeg/scripts/verify-software.mjs'),
    path.join(bin, 'ffmpeg.exe'),
    path.join(bin, 'ffprobe.exe'),
  ]);
  console.log(
    `Built and checked Windows candidate in ${bin}. Hardware and clean-host qualification are still required.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
