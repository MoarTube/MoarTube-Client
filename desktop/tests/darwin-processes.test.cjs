const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDarwinProcesses } = require('../darwin-processes.cjs');

function fixture(onSignal = () => {}) {
  const entries = new Map([
    [100, { parent: 99, uid: 501, started: 'Wed Nov 11 10:00:00 2026' }],
    [101, { parent: 100, uid: 501, started: 'Wed Nov 11 10:00:01 2026' }],
    [102, { parent: 101, uid: 501, started: 'Wed Nov 11 10:00:02 2026' }],
    [103, { parent: 100, uid: 0, started: 'Wed Nov 11 10:00:03 2026' }],
    [104, { parent: 1, uid: 501, started: 'Wed Nov 11 10:00:04 2026' }],
  ]);
  const signals = [];
  const processes = createDarwinProcesses({
    uid: 501,
    self: 99,
    list: () =>
      [...entries]
        .map(([pid, entry]) => `  ${pid}  ${entry.parent}  ${entry.uid}  ${entry.started}`)
        .join('\n'),
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      onSignal(entries, pid, signal);
      if (signal === 'SIGKILL') entries.delete(pid);
    },
  });
  return { processes, entries, signals };
}

test('Mac shutdown stops the owned tree and kills descendants before parents', () => {
  const { processes, entries, signals } = fixture();
  processes.terminateOwnedTree(100, processes.identity(100));
  assert.deepEqual(signals, [
    [100, 'SIGSTOP'],
    [101, 'SIGSTOP'],
    [102, 'SIGSTOP'],
    [102, 'SIGKILL'],
    [101, 'SIGKILL'],
    [100, 'SIGKILL'],
  ]);
  assert.deepEqual([...entries.keys()], [103, 104]);
});

test('Mac shutdown refuses stale identities, other users and the supervisor itself', () => {
  const { processes, signals } = fixture();
  assert.equal(processes.identity(1), undefined);
  assert.equal(processes.identity(99), undefined);
  assert.equal(processes.identity(103), undefined);
  processes.terminateOwnedTree(100, 'stale identity');
  processes.terminateOwnedTree(100, undefined);
  assert.deepEqual(signals, []);
  const unavailable = createDarwinProcesses({
    uid: 501,
    self: 99,
    list: () => {
      throw new Error('ps unavailable');
    },
    kill: () => {
      throw new Error('must not signal an unverified process');
    },
  });
  assert.equal(unavailable.identity(100), undefined);
  unavailable.terminateOwnedTree(100, 'previous identity');
});

test('Mac shutdown does not kill a PID that changed identity during cleanup', () => {
  const { processes, signals } = fixture((entries, pid, signal) => {
    if (pid === 101 && signal === 'SIGSTOP') entries.get(pid).started = 'Wed Nov 11 11:00:00 2026';
  });
  processes.terminateOwnedTree(100, processes.identity(100));
  assert(!signals.some(([pid, signal]) => pid === 101 && signal === 'SIGKILL'));
});
