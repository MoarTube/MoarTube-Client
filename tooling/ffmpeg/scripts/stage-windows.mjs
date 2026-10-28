import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) throw new Error('Usage: stage-windows.mjs <unpacked candidate directory>');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const input = path.resolve(process.argv[2]);
const text = readFileSync(path.join(input, 'manifest.json'), 'utf8');
const manifest = JSON.parse(text);
if (
  manifest.schemaVersion !== 1 ||
  manifest.target !== 'win32-x64' ||
  typeof manifest.buildId !== 'string' ||
  !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.buildId) ||
  manifest.qualification?.compiledFeatures !== 'passed' ||
  manifest.qualification?.softwareSmoke !== 'passed'
)
  throw new Error('Expected a checked Windows candidate manifest');
const destination = path.join(root, 'resources/ffmpeg/win32-x64');
const version = path.join(destination, manifest.buildId);
for (const name of ['ffmpeg', 'ffprobe']) {
  const entry = manifest.files?.[name];
  if (entry?.path !== `${manifest.buildId}/${name}.exe`)
    throw new Error(`Invalid candidate ${name} path`);
  const bytes = readFileSync(path.join(input, entry.path));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(`Candidate ${name} checksum mismatch`);
}
if (existsSync(version))
  throw new Error(
    `Immutable build already staged: ${version}. No active executable was overwritten.`
  );
mkdirSync(destination, { recursive: true });
cpSync(path.join(input, manifest.buildId), version, {
  recursive: true,
  force: false,
  errorOnExist: true,
});
for (const name of ['sources', 'licenses', 'recipe'])
  cpSync(path.join(input, name), path.join(version, name), { recursive: true });
for (const name of ['NOTICES.txt', 'provenance.json'])
  copyFileSync(path.join(input, name), path.join(version, name));
writeFileSync(path.join(destination, 'manifest.json.partial'), text);
renameSync(
  path.join(destination, 'manifest.json.partial'),
  path.join(destination, 'manifest.json')
);
console.log(
  `Staged ${manifest.buildId} for packaged use. Source checkouts prefer their local compilation; existing build directories remain intact. Hardware qualification: ${JSON.stringify(manifest.qualification)}`
);
