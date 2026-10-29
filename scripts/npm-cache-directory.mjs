import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

// Invoke npm through Node so Windows does not need a shell to launch npm.cmd.
const npm =
  process.env.npm_execpath ||
  path.resolve(
    path.dirname(process.execPath),
    process.platform === 'win32'
      ? 'node_modules/npm/bin/npm-cli.js'
      : '../lib/node_modules/npm/bin/npm-cli.js'
  );
const directory = execFileSync(process.execPath, [npm, 'config', 'get', 'cache'], {
  encoding: 'utf8',
}).trim();
if (!path.isAbsolute(directory) || /[\r\n]/.test(directory))
  throw new Error('npm returned an invalid cache directory');
console.log(directory);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `directory=${directory}\n`);
