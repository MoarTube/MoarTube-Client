const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { identity, terminateOwnedTree } = require('../linux-processes.cjs');

test(
  'Linux fallback kills only the identified backend tree and refuses a stale identity',
  { skip: process.platform !== 'linux' },
  async () => {
    const backend = spawn(
      process.execPath,
      [
        '-e',
        `
    const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    process.send({pid:child.pid}); setInterval(()=>{},1000);
  `,
      ],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
    );
    let grandchild;
    try {
      [{ pid: grandchild }] = await once(backend, 'message', { signal: AbortSignal.timeout(5000) });
      const started = identity(backend.pid);
      assert.ok(started);
      terminateOwnedTree(backend.pid, `${started}-stale`);
      process.kill(backend.pid, 0);
      process.kill(grandchild, 0);
      const closed = once(backend, 'close');
      terminateOwnedTree(backend.pid, started);
      await closed;
      // An exited grandchild may briefly remain as a zombie under container PID 1.
      if (fs.existsSync(`/proc/${grandchild}/stat`)) {
        const stat = fs.readFileSync(`/proc/${grandchild}/stat`, 'utf8');
        assert.equal(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0], 'Z');
      }
      assert.equal(identity(process.pid), undefined);
    } finally {
      for (const pid of [grandchild, backend.pid]) {
        if (pid)
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* exited */
          }
      }
    }
  }
);
