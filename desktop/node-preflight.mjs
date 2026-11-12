import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import './bin/check-node-version.js';

const require = createRequire(import.meta.url);
const db = new Database(':memory:');
db.exec('CREATE TABLE desktop_preflight (value TEXT)');
db.prepare('INSERT INTO desktop_preflight VALUES (?)').run('ready');
if (db.prepare('SELECT value FROM desktop_preflight').get().value !== 'ready')
  throw new Error('SQLite preflight read/write failed');
const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
db.close();
const cloudflared = await promisify(execFile)(
  process.env.MOARTUBE_CLOUDFLARED_PATH,
  ['--version'],
  {
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 8192,
  }
);
const cloudflaredVersion = /cloudflared version (\d+\.\d+\.\d+)/.exec(cloudflared.stdout)?.[1];
if (!cloudflaredVersion) throw new Error('Cloudflared preflight failed');
const result = {
  cloudflaredVersion,
  electronVersion: process.versions.electron,
  runtimeVersion: process.version,
  sqlitePackageVersion: require('better-sqlite3/package.json').version,
  sqliteVersion,
};
if (process.parentPort) process.parentPort.postMessage(result);
else console.log('MOARTUBE_NODE_PREFLIGHT ' + JSON.stringify(result));
