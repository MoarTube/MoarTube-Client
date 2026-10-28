const fs = require('node:fs');

function identity(pid) {
  try {
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return undefined;
    if (fs.statSync(`/proc/${pid}`).uid !== process.getuid()) return undefined;
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; // field 22: starttime
  } catch {
    return undefined;
  }
}

// Called only after our backend misses its graceful shutdown deadline. Validate
// ownership and start time so a recycled PID can never target an unrelated job.
function terminateOwnedTree(pid, expectedIdentity) {
  if (!expectedIdentity || identity(pid) !== expectedIdentity) return;
  try {
    process.kill(pid, 'SIGSTOP');
  } catch {
    return;
  }
  const children = [];
  const visit = (parent) => {
    let ids;
    try {
      ids = fs
        .readFileSync(`/proc/${parent}/task/${parent}/children`, 'utf8')
        .trim()
        .split(/\s+/)
        .map(Number);
    } catch {
      return;
    }
    for (const child of ids) {
      const started = identity(child);
      if (!started) continue;
      children.push({ pid: child, started });
      try {
        process.kill(child, 'SIGSTOP');
      } catch {
        continue;
      }
      visit(child);
    }
  };
  visit(pid);
  for (const entry of [...children.reverse(), { pid, started: expectedIdentity }]) {
    if (identity(entry.pid) === entry.started) {
      try {
        process.kill(entry.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    }
  }
}
module.exports = { identity, terminateOwnedTree };
