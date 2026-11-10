import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const targets = ['data', 'dist', 'playwright-report', 'temp', 'test-results'];
const fixtures: string[] = [];

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'moartube-startup-'));
  fixtures.push(root);
  mkdirSync(path.join(root, 'bin'));
  copyFileSync('bin/check-node-version.js', path.join(root, 'bin/check-node-version.js'));
  copyFileSync('bin/moartube-client-start', path.join(root, 'bin/moartube-client-start'));
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  for (const name of targets) {
    mkdirSync(path.join(root, name));
    writeFileSync(path.join(root, name, 'old'), 'old data');
  }
  return root;
}

function builder(root: string, content: string): void {
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'src/config'));
  copyFileSync('src/config/data-layout.cjs', path.join(root, 'src/config/data-layout.cjs'));
  writeFileSync(path.join(root, 'src/moartube-client.ts'), '');
  const dir = path.join(root, 'node_modules/tsup/dist');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'cli-default.js'), content);
}

function start(
  root: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {}
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [path.join(root, 'bin/moartube-client-start'), ...args], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      MOARTUBE_DATA_DIR: undefined,
      MOARTUBE_DATA_ROOT: path.join(root, 'user-data'),
      ...env,
    },
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    // Only remove direct children created by mkdtempSync for this suite.
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('moartube-startup-')
    ) {
      throw new Error(`Unexpected fixture path: ${root}`);
    }
    rmSync(root, { recursive: true, force: true });
  }
});

describe('startup launcher', () => {
  it('cleans and starts checkout data even when the installed data is locked', () => {
    const root = fixture();
    const productionRoot = path.join(root, 'production');
    const production = path.join(productionRoot, 'MoarTube/client');
    mkdirSync(production, { recursive: true });
    const lock = JSON.stringify({ pid: process.pid, token: 'production' });
    writeFileSync(path.join(production, '.moartube-process.lock'), lock);
    writeFileSync(path.join(production, '_client_settings.json'), '{}');
    builder(root, `
      const fs = require('node:fs');
      if (fs.existsSync('data/old')) throw new Error('Local data was not cleaned');
      fs.mkdirSync('dist');
      fs.writeFileSync('dist/moartube-client.js', \`
        import layout from '../src/config/data-layout.cjs';
        import { fileURLToPath } from 'node:url';
        const options = { projectRoot: fileURLToPath(new URL('../', import.meta.url)) };
        const release = await layout.prepareData('client', options);
        console.log(layout.componentDirectory('client', options));
        release();
      \`);
    `);
    const result = start(root, ['--clean'], {
      MOARTUBE_DATA_ROOT: undefined,
      IS_DOCKER_ENVIRONMENT: undefined,
      APPDATA: productionRoot,
      HOME: productionRoot,
      XDG_DATA_HOME: productionRoot,
    });
    expect(result.status, String(result.stderr)).toBe(0);
    expect(String(result.stdout)).toContain(path.join(root, 'data'));
    expect(existsSync(path.join(root, 'data/old'))).toBe(false);
    expect(readFileSync(path.join(production, '_client_settings.json'), 'utf8')).toBe('{}');
    expect(readFileSync(path.join(production, '.moartube-process.lock'), 'utf8')).toBe(lock);
  });

  it('cleans before building and starting with --clean', () => {
    const root = fixture();
    rmSync(path.join(root, 'temp'), { recursive: true });
    builder(
      root,
      `
      const fs = require('node:fs');
      for (const name of ${JSON.stringify(targets)}) {
        if (fs.existsSync(name)) throw new Error('Build started before cleanup: ' + name);
      }
      fs.mkdirSync('dist');
      fs.writeFileSync('dist/moartube-client.js', "console.log('client started');");
    `
    );
    const result = start(root, ['--clean']);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(String(result.stdout)).toContain('client started');
    for (const name of targets) {
      expect(existsSync(path.join(root, name, 'old'))).toBe(false);
    }
  });

  it.each([[], ['clean']])('keeps existing directories without --clean (%j)', (args) => {
    const root = fixture();
    writeFileSync(path.join(root, 'dist/moartube-client.js'), "console.log('client started');");
    expect(start(root, args).status).toBe(0);
    for (const name of targets) {
      expect(existsSync(path.join(root, name, 'old'))).toBe(true);
    }
  });

  it('does not start when the build fails', () => {
    const root = fixture();
    builder(root, 'process.exit(2);');
    const result = start(root, ['--clean']);
    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain('Client build failed (2)');
  });

  it('rejects clean without sources before deleting data', () => {
    const root = fixture();
    expect(start(root, ['--clean']).status).toBe(1);
    for (const name of targets) {
      expect(existsSync(path.join(root, name, 'old'))).toBe(true);
    }
  });
});
