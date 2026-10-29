import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMsysScript } from '../scripts/windows-shell.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bash =
  process.platform === 'win32'
    ? [
        path.join(root, 'build/ffmpeg/toolchains/win32-x64/msys64/usr/bin/bash.exe'),
        path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe'),
      ].find(existsSync)
    : existsSync('/bin/bash')
      ? '/bin/bash'
      : undefined;
const posix = (name) =>
  name.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "moartube-shell-café's space-"));
  t.after(async () => {
    if (
      path.dirname(directory) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith('moartube-shell-')
    )
      throw new Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test(
  'preserves every locked package argument beyond the Windows long-command failure',
  { skip: !bash },
  async (t) => {
    const directory = await fixture(t);
    const lock = JSON.parse(
      await readFile(new URL('../toolchain.lock.json', import.meta.url), 'utf8')
    );
    const expected = lock.packages.map(
      (entry) =>
        `/d/a/MoarTube-Client/MoarTube-Client/build/ffmpeg/cache/toolchains/win32-x64/${entry.archive}`
    );
    expected.push("literal café's $() `backtick` value");
    const output = path.join(directory, 'received.txt');
    const command = `printf '%s\\n' ${expected.map(quote).join(' ')} > ${quote(posix(output))}`;
    assert.ok(command.length > 8192);
    await runMsysScript(bash, command, { cwd: root, directory, stdio: 'pipe' });
    assert.deepEqual((await readFile(output, 'utf8')).trimEnd().split(/\r?\n/), expected);
    assert.deepEqual(await readdir(directory), ['received.txt']);
  }
);

test(
  'stops at shell failure and retains its script for diagnostics',
  { skip: !bash },
  async (t) => {
    const directory = await fixture(t);
    const output = path.join(directory, 'must-not-exist.txt');
    const command = `false\nprintf bad > ${quote(posix(output))}`;
    await assert.rejects(
      runMsysScript(bash, command, { cwd: root, directory, stdio: 'pipe' }),
      /script retained:/
    );
    assert.equal(existsSync(output), false);
    const entries = await readdir(directory);
    assert.equal(entries.length, 1);
    const source = await readFile(path.join(directory, entries[0], 'command.sh'), 'utf8');
    assert.ok(source.includes(command));
    assert.equal(source.includes('\r'), false);
  }
);
