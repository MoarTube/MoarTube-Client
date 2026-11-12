const { execFileSync } = require('node:child_process');

// Utility processes do not own a detached POSIX process group. Track their
// actual descendants, user and start time instead of signalling a negative PID.
function createDarwinProcesses({
  list = () =>
    execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,uid=,lstart='], {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    }),
  kill = (pid, signal) => process.kill(pid, signal),
  uid = process.getuid?.(),
  self = process.pid,
} = {}) {
  function snapshot() {
    try {
      return list()
        .split(/\r?\n/)
        .flatMap((line) => {
          const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
          return match
            ? [
                {
                  pid: Number(match[1]),
                  parent: Number(match[2]),
                  uid: Number(match[3]),
                  started: match[4].replace(/\s+/g, ' '),
                },
              ]
            : [];
        });
    } catch {
      return [];
    }
  }
  function identity(pid) {
    if (!Number.isInteger(pid) || pid <= 1 || pid === self) return undefined;
    const entry = snapshot().find((entry) => entry.pid === pid && entry.uid === uid);
    return entry ? `${entry.parent}:${entry.started}` : undefined;
  }
  function terminateOwnedTree(pid, expectedIdentity) {
    if (!expectedIdentity || identity(pid) !== expectedIdentity) return;
    const stopped = [];
    const visited = new Set();
    function stop(current, started) {
      if (visited.has(current) || identity(current) !== started) return;
      visited.add(current);
      try {
        kill(current, 'SIGSTOP');
      } catch {
        return;
      }
      stopped.push({ pid: current, started });
      if (identity(current) !== started) return;
      for (const child of snapshot().filter(
        (entry) => entry.parent === current && entry.uid === uid
      ))
        stop(child.pid, `${child.parent}:${child.started}`);
    }
    stop(pid, expectedIdentity);
    for (const entry of stopped.reverse()) {
      if (identity(entry.pid) !== entry.started) continue;
      try {
        kill(entry.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    }
  }
  return { identity, terminateOwnedTree };
}

module.exports = { ...createDarwinProcesses(), createDarwinProcesses };
