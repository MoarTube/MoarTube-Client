import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  openSync,
  closeSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopPaths } from '../tooling/build-paths.cjs';

if (process.argv.length > 2) throw new Error('Usage: npm run desktop:verify:linux:arm64');

// Full-system emulation provides an ARM64 kernel. Docker's user-mode emulator
// cannot implement the namespace clone calls used by Chromium's sandbox.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const version = read(path.join(root, 'package.json')).version;
const layout = desktopPaths(root, 'linux-arm64', version);
const token = `${Date.now()}-${process.pid}`;
const work = path.join(layout.work, 'qemu-vm', token);
const reports = path.join(layout.reports, 'vm-trixie', token);
const logs = path.join(layout.logs, 'vm-trixie', token);
for (const directory of [work, reports, logs]) mkdirSync(directory, { recursive: true });
const guestName = `moartube-arm64-vm-guest-${token}`;
const vmName = `moartube-arm64-vm-run-${token}`;
const volume = `moartube-arm64-vm-${token}`;
const hostImage = 'moartube-desktop-vm-host:ubuntu24';
const guestImage = 'moartube-desktop-runtime-arm64:debian-trixie';
const recipe = path.join(root, 'desktop/linux/vm');

function docker(args, { log, capture = false, timeout = 20 * 60 * 1000 } = {}) {
  const fd = log ? openSync(path.join(logs, log), 'w') : undefined;
  let result;
  try {
    result = spawnSync('docker', args, {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      stdio:
        fd !== undefined ? ['ignore', fd, fd] : capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (result.error || result.status !== 0)
    throw new Error(
      `docker ${args[0]} failed (${result.status}): ${result.error?.message ?? result.stderr ?? ''}. Logs: ${logs}`
    );
  return result.stdout?.trim();
}
async function digest(file) {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
const engine = JSON.parse(docker(['info', '--format', '{{json .}}'], { capture: true }));
if (engine.OSType !== 'linux' || engine.MemTotal < 6 * 1024 ** 3)
  throw new Error('Use Docker Linux containers with at least 6 GiB RAM for the ARM64 VM.');
const artifacts = [];
for (const line of readFileSync(path.join(layout.release, 'SHA256SUMS-linux-arm64.txt'), 'utf8')
  .trim()
  .split(/\r?\n/)) {
  const [sha256, name] = line.trim().split(/\s+/);
  if (
    path.basename(name) !== name ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    (await digest(path.join(layout.release, name))) !== sha256
  )
    throw new Error(`Release checksum mismatch: ${name}`);
  artifacts.push({ name, sha256 });
}
const names = [
  `MoarTube-Client-${version}-linux-arm64.deb`,
  `MoarTube-Client-${version}-linux-arm64.tar.gz`,
];
if (names.some((name) => !artifacts.some((file) => file.name === name)))
  throw new Error('Build the ARM64 desktop release before VM verification.');
const images = read(path.join(root, 'desktop/linux/arm64-runtime-images.json'));
let success = false,
  vmCreated = false;
try {
  console.log('Preparing native QEMU host and ARM64 Trixie runtime images...');
  docker(['build', '-f', 'desktop/linux/vm/Dockerfile', '-t', hostImage, 'desktop/linux/vm'], {
    log: 'host-image.log',
  });
  docker(
    [
      'build',
      '--platform',
      'linux/arm64',
      '-f',
      'desktop/linux/runtime.Dockerfile',
      '--build-arg',
      `UBUNTU_IMAGE=${images['debian-trixie']}`,
      '-t',
      guestImage,
      'desktop/linux',
    ],
    { log: 'guest-image.log' }
  );
  docker([
    'create',
    '--platform',
    'linux/arm64',
    '--name',
    guestName,
    guestImage,
    'bash',
    '/workspace/prepare-guest.sh',
  ]);
  for (const file of ['prepare-guest.sh', 'guest-init.sh'])
    docker(['cp', path.join(recipe, file), `${guestName}:/workspace/${file}`]);
  for (const directory of ['scripts', 'tooling'])
    docker([
      'cp',
      path.join(root, directory) + path.sep + '.',
      `${guestName}:/workspace/${directory}`,
    ]);
  for (const name of names)
    docker(['cp', path.join(layout.release, name), `${guestName}:/workspace/${name}`]);
  const checksums = path.join(work, 'asset-checksums.txt');
  writeFileSync(
    checksums,
    artifacts
      .filter((file) => names.includes(file.name))
      .map((file) => `${file.sha256}  ${file.name}`)
      .join('\n') + '\n'
  );
  docker(['cp', checksums, `${guestName}:/workspace/asset-checksums.txt`]);
  console.log('Installing the ARM64 guest kernel and app; exporting its filesystem...');
  docker(['start', '-a', guestName], { log: 'prepare-guest.log' });
  mkdirSync(path.join(work, 'boot'), { recursive: true });
  docker(['cp', `${guestName}:/boot/.`, path.join(work, 'boot')]);
  docker(['cp', `${guestName}:/qa/guest-packages.txt`, path.join(reports, 'guest-packages.txt')]);
  const kernels = readdirSync(path.join(work, 'boot')).filter((file) =>
    file.startsWith('vmlinuz-')
  );
  if (kernels.length !== 1) throw new Error('Expected one ARM64 guest kernel.');
  const kernelVersion = kernels[0].slice('vmlinuz-'.length);
  copyFileSync(path.join(work, 'boot', kernels[0]), path.join(work, 'vmlinuz'));
  copyFileSync(
    path.join(work, 'boot', `initrd.img-${kernelVersion}`),
    path.join(work, 'initrd.img')
  );
  for (const file of ['make-disk.sh', 'boot-vm.sh'])
    copyFileSync(path.join(recipe, file), path.join(work, file));
  docker(['export', '--output', path.join(work, 'guest-rootfs.tar'), guestName], {
    log: 'export.log',
  });
  docker(['volume', 'create', '--label', 'com.moartube.qa=arm64-full-system', volume]);
  const inputMount = `type=bind,source=${work},target=/inputs,readonly`;
  const diskMount = `type=volume,source=${volume},target=/work`;
  console.log('Creating a private file-backed test disk...');
  docker(
    [
      'run',
      '--rm',
      '--mount',
      inputMount,
      '--mount',
      diskMount,
      hostImage,
      'bash',
      '/inputs/make-disk.sh',
    ],
    { log: 'make-disk.log' }
  );
  docker([
    'create',
    '--name',
    vmName,
    '--memory',
    '6g',
    '--mount',
    inputMount,
    '--mount',
    diskMount,
    '--mount',
    `type=bind,source=${reports},target=/results`,
    hostImage,
    'bash',
    '/inputs/boot-vm.sh',
  ]);
  vmCreated = true;
  console.log('Booting the full ARM64 VM and running sandboxed installed/portable GUI tests...');
  docker(['start', '-a', vmName], { log: 'console.log' });
  const consoleOutput = readFileSync(path.join(logs, 'console.log'), 'utf8');
  if (
    !consoleOutput.includes('MOARTUBE_ARM64_VM_DONE') ||
    !consoleOutput.includes('Power down') ||
    consoleOutput.includes('Kernel panic')
  )
    throw new Error('ARM64 guest did not finish and power off cleanly; see console.log');
  const status = read(path.join(reports, 'status.json'));
  if (status.testExitCode !== 0 || status.sandboxDisabled !== false)
    throw new Error(`VM desktop tests failed: ${JSON.stringify(status)}. See ${reports}`);
  mkdirSync(path.join(reports, 'evidence'), { recursive: true });
  docker(
    [
      'run',
      '--rm',
      '--mount',
      `type=bind,source=${reports},target=/results`,
      hostImage,
      'tar',
      '-xzf',
      '/results/guest-evidence.tar.gz',
      '-C',
      '/results/evidence',
      'reports/linux-arm64',
    ],
    { log: 'extract.log' }
  );
  const evidence = path.join(reports, 'evidence/reports/linux-arm64');
  const gui = {};
  for (const mode of ['installed', 'portable']) {
    const result = read(path.join(evidence, `${mode}-smoke.json`));
    if (
      !result.sandbox ||
      !result.chromiumSandbox ||
      !result.contextIsolation ||
      result.kernelSandbox?.seccomp !== 2 ||
      result.kernelSandbox?.noNewPrivs !== 1
    )
      throw new Error(`${mode}: renderer sandbox evidence missing`);
    gui[mode] = result;
  }
  const result = {
    passed: true,
    target: 'linux-arm64',
    version,
    distribution: 'Debian Trixie',
    execution: 'full-system-qemu',
    cleanShutdown: true,
    cpu: 'cortex-a76',
    guestKernel: kernelVersion,
    pageSize: Number(readFileSync(path.join(reports, 'page-size.txt'), 'utf8').trim()),
    hostEngineArchitecture: engine.Architecture,
    baseImage: images['debian-trixie'],
    hostImageId: docker(['image', 'inspect', hostImage, '--format', '{{.Id}}'], { capture: true }),
    artifacts,
    gui,
    checkedAt: new Date().toISOString(),
    scope:
      'ARM64 guest kernel, Xvfb/software graphics; no physical Pi, Wayland or GPU qualification',
  };
  writeFileSync(path.join(reports, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(
    path.join(layout.reports, 'vm-trixie/latest.json'),
    JSON.stringify({ reports, result: path.join(reports, 'result.json') }, null, 2) + '\n'
  );
  success = true;
  console.log(
    `ARM64 Trixie installed and standalone GUI tests passed with kernel sandbox active. Reports: ${reports}`
  );
} finally {
  if (success) {
    docker(['rm', guestName, vmName]);
    docker(['volume', 'rm', volume]);
    rmSync(path.join(work, 'guest-rootfs.tar'));
  } else {
    if (vmCreated) {
      const state = spawnSync('docker', ['inspect', vmName, '--format', '{{.State.Running}}'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (state.stdout?.trim() === 'true')
        spawnSync('docker', ['stop', '-t', '5', vmName], { windowsHide: true, stdio: 'inherit' });
    }
    console.error(
      `VM diagnostics retained. Guest: ${guestName}; VM: ${vmName}; volume: ${volume}; reports: ${reports}; logs: ${logs}`
    );
  }
}
