import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadToDraft } from './lib/draft-release.mjs';

const [target, directory] = process.argv.slice(2);
if (!target || !directory || process.argv.length !== 4)
  throw new Error('Usage: upload-desktop-draft.mjs <target> <downloaded-artifacts-directory>');
const root = fileURLToPath(new URL('../', import.meta.url));
const repo = process.env.GITHUB_REPOSITORY;
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const options = { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 };
const result = await uploadToDraft({
  repo,
  tag: process.env.MOARTUBE_RELEASE_TAG,
  commit: process.env.GITHUB_SHA,
  target,
  version,
  directory: path.resolve(directory),
  api: (resource, { paginate = false, method = 'GET', fields = {} } = {}) => {
    const args = ['api', `repos/${repo}/${resource}`, '--method', method];
    if (paginate) args.push('--paginate', '--slurp');
    for (const [key, value] of Object.entries(fields)) args.push('-f', `${key}=${value}`);
    return JSON.parse(execFileSync('gh', args, options));
  },
  upload: (tag, file) =>
    execFileSync('gh', ['release', 'upload', tag, file, '--repo', repo, '--clobber'], {
      ...options,
      stdio: 'inherit',
    }),
});
console.log(JSON.stringify(result, null, 2));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `Uploaded ${result.assets.length} ${target} assets to draft **${result.tag}** from commit \`${result.commit}\`. The release remains unpublished.\n`
  );
