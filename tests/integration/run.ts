/* eslint-disable no-console -- This executable prints integration progress and evidence paths. */
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FfmpegService, type GpuCapability } from '../../src/services/ffmpeg.js';
import { Logger } from '../../src/utils/logger.js';
import type { Config } from '../../src/config/index.js';
import checkNode from '../e2e/support/check-node.js';
import { selectRequiredGpus } from './gpu-policy.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const mode = process.argv[2] ?? 'all';
if (!['all', 'preflight', 'gpu', 'gpu-e2e'].includes(mode) || process.argv.length > 3) {
  throw new Error('Usage: run.ts [all|preflight|gpu|gpu-e2e]');
}
const requested = process.env['MOARTUBE_INTEGRATION_GPU_BACKEND'] ?? 'all';
const runId = `${Date.now().toString()}-${String(process.pid)}`;
const reportRoot = path.join(root, 'build/integration/reports');
const reports = path.join(reportRoot, 'runs', runId);
mkdirSync(reports, { recursive: true });
const stages: { name: string; passed: boolean; status: number | null }[] = [];
const summary: {
  runId: string;
  mode: string;
  requested: string;
  host: string;
  platform: string;
  node: string;
  startedAt: string;
  finishedAt?: string;
  passed: boolean;
  error?: string;
  binaries?: { ffmpeg: string; ffprobe: string; sha256: Record<string, string>; version: string };
  devices?: GpuCapability[];
  nodeSourceDirectory?: string;
  selected?: GpuCapability[];
  stages: typeof stages;
  evidenceDirectory: string;
} = {
  runId,
  mode,
  requested,
  host: os.hostname(),
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  startedAt: new Date().toISOString(),
  passed: false,
  stages,
  evidenceDirectory: reports,
};
const record = (): void => {
  const contents = JSON.stringify(summary, null, 2) + '\n';
  writeFileSync(path.join(reports, 'integration.json'), contents);
  writeFileSync(path.join(reportRoot, 'integration.json'), contents);
};
const hash = async (file: string): Promise<string> => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk as Buffer);
  }
  return digest.digest('hex');
};
function run(name: string, args: string[], environment: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n${name}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  stages.push({
    name,
    passed: result.status === 0 && result.error === undefined,
    status: result.status,
  });
  record();
  if (result.error !== undefined || result.status !== 0) {
    throw result.error ?? new Error(`${name} failed (${String(result.status ?? result.signal)}).`);
  }
}
async function requireFreeClientPort(): Promise<void> {
  // Match the application's localhost listener and never reuse a developer's Client.
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => {
      reject(
        new Error(
          'Client port 8080 is occupied. Stop the existing Client before managed integration testing.'
        )
      );
    });
    server.listen(8080, 'localhost', resolve);
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    })
  );
}

try {
  record();
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('This local GPU integration workflow currently requires native Windows x64.');
  }
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && (minor < 22 || (minor === 22 && patch < 1)))) {
    throw new Error('Integration testing requires Node.js 24.22.1 or newer.');
  }
  const service = new FfmpegService(new Logger(), { clientSettings: {} } as Config);
  const ffmpeg = service.getPath();
  const ffprobe = service.getProbePath();
  if (!path.isAbsolute(ffmpeg) || !path.isAbsolute(ffprobe) || !existsSync(ffprobe)) {
    throw new Error(
      'Compile FFmpeg first and set FFMPEG_BIN to its absolute ffmpeg.exe path before starting the runner.'
    );
  }
  const version =
    execFileSync(ffmpeg, ['-version'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    }).split(/\r?\n/)[0] ?? '';
  execFileSync(ffprobe, ['-version'], { timeout: 10000, windowsHide: true });
  summary.binaries = {
    ffmpeg,
    ffprobe,
    version,
    sha256: { ffmpeg: await hash(ffmpeg), ffprobe: await hash(ffprobe) },
  };
  summary.devices = await service.assessGpus(true);
  record();
  const selected = selectRequiredGpus(summary.devices, requested);
  summary.selected = selected;
  record();
  if (mode !== 'gpu') {
    if (mode === 'all' || mode === 'preflight') {
      const nodeSourceDirectory = path.resolve(
        process.env['MOARTUBE_NODE_SOURCE_DIR'] ?? path.join(root, '../MoarTube-Node')
      );
      if (!existsSync(path.join(nodeSourceDirectory, 'public/views/watch.ejs'))) {
        throw new Error(
          'Viewer regression tests need MOARTUBE_NODE_SOURCE_DIR pointing to a MoarTube Node checkout containing public/views/watch.ejs.'
        );
      }
      summary.nodeSourceDirectory = nodeSourceDirectory;
      process.env['MOARTUBE_NODE_SOURCE_DIR'] = nodeSourceDirectory;
    }
    await checkNode();
    await requireFreeClientPort();
  }
  if (mode === 'preflight') {
    summary.passed = true;
    console.log(
      `Preflight passed: real Node at localhost:9090, ${String(selected.length)} required GPU(s), FFmpeg ${version}.`
    );
  } else {
    const cpuEnvironment = { ...process.env, MOARTUBE_TEST_GPU: '0' };
    if (mode === 'all') {
      for (const project of [
        'tsconfig.json',
        'tests/e2e/tsconfig.json',
        'tests/integration/tsconfig.json',
      ]) {
        run(
          `Typecheck ${project}`,
          ['node_modules/typescript/bin/tsc', '-p', project, '--noEmit'],
          cpuEnvironment
        );
      }
      run(
        'Lint browser integration tests',
        ['node_modules/eslint/bin/eslint.js', 'tests/e2e', '--ext', '.ts'],
        cpuEnvironment
      );
      run('Client unit tests', ['node_modules/vitest/vitest.mjs', 'run'], cpuEnvironment);
      // Expand patterns through Node because Windows shells do not expand globs.
      run('Desktop unit tests', ['--test', 'desktop/tests/*.test.cjs'], cpuEnvironment);
      run('FFmpeg tooling tests', ['--test', 'tooling/ffmpeg/tests/*.test.mjs'], cpuEnvironment);
    }
    for (const [index, gpu] of selected.entries()) {
      if (mode === 'gpu-e2e') {
        break;
      }
      const directory = path.join(reports, `gpu-${String(index)}`);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'adapter.json'), JSON.stringify(gpu, null, 2));
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        MOARTUBE_TEST_GPU: '1',
        MOARTUBE_TEST_GPU_BACKEND: gpu.backend,
        MOARTUBE_TEST_GPU_ID: gpu.id,
        MOARTUBE_GPU_REPORT_DIR: directory,
      };
      delete environment['MOARTUBE_TEST_GPU_VENDOR'];
      run(
        `Hardware publish, geometry and RTMP/live: ${gpu.id}`,
        [
          'node_modules/vitest/vitest.mjs',
          'run',
          'tests/gpu-hardware.test.ts',
          'tests/windows-live-hardware.test.ts',
          '--reporter=default',
          '--reporter=json',
          `--outputFile=${path.join(directory, 'hardware-results.json')}`,
        ],
        environment
      );
    }
    if (mode === 'all' || mode === 'gpu-e2e') {
      run('Build Client', ['node_modules/tsup/dist/cli-default.js'], cpuEnvironment);
      const browserEnvironment = {
        ...cpuEnvironment,
        MOARTUBE_E2E_MANAGED_CLIENT: '1',
        MOARTUBE_CLIENT_URL: 'http://localhost:8080',
        MOARTUBE_DATA_DIR: path.join(root, 'build/integration/profiles', runId, 'cpu'),
        MOARTUBE_E2E_GPU_ID: '',
      };
      if (mode === 'all') {
        run(
          'All browser E2E journeys',
          ['node_modules/@playwright/test/cli.js', 'test'],
          browserEnvironment
        );
      }
      for (const [index, gpu] of selected.entries()) {
        run(
          `Browser GPU publishing/live journeys: ${gpu.id}`,
          [
            'node_modules/@playwright/test/cli.js',
            'test',
            'tests/e2e/media.spec.ts',
            'tests/e2e/streams.spec.ts',
            '--project=chromium',
            '--grep',
            'publishes (mp4|m3u8) from|starts and stops a real RTMP',
          ],
          {
            ...browserEnvironment,
            MOARTUBE_E2E_GPU_ID: gpu.id,
            MOARTUBE_DATA_DIR: path.join(
              root,
              'build/integration/profiles',
              runId,
              `gpu-${String(index)}`
            ),
            MOARTUBE_E2E_REPORT_DIR: path.join(reports, `gpu-${String(index)}`, 'browser'),
          }
        );
      }
    }
    summary.passed = true;
  }
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  console.error(summary.error);
  process.exitCode = 1;
} finally {
  summary.finishedAt = new Date().toISOString();
  record();
  console.log(`Integration evidence: ${path.join(reports, 'integration.json')}`);
}
