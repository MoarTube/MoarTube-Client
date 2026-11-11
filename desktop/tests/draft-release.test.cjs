const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const commit = 'a'.repeat(40);
const repo = 'MoarTube/MoarTube-Client';
const tag = 'v1.1.0';
const hash = (text) => createHash('sha256').update(text).digest('hex');
async function fixture(t, target = 'win32-x64') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-draft-'));
  t.after(() => {
    if (
      path.dirname(directory) !== path.resolve(os.tmpdir()) ||
      !path.basename(directory).startsWith('moartube-draft-')
    )
      throw new Error('Unexpected test directory');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const windows = target === 'win32-x64';
  const binaries = windows
    ? [
        'MoarTube-Client-1.1.0-windows-x64-setup.exe',
        'MoarTube-Client-1.1.0-windows-x64-portable.zip',
        'MoarTube-Client-Node-1.1.0-windows-x64-setup.exe',
        'MoarTube-Client-Node-1.1.0-windows-x64-portable.zip',
      ]
    : target.startsWith('linux')
      ? [`MoarTube-Client-1.1.0-${target}.deb`, `MoarTube-Client-1.1.0-${target}-portable.tar.gz`]
      : [`MoarTube-Client-1.1.0-${target}.dmg`, `MoarTube-Client-1.1.0-${target}.zip`];
  const source = windows
    ? 'MoarTube-FFmpeg-test-build-sources.zip'
    : `9.0.2-moartube-${target}-test-sources.tar.xz`;
  const checksum = windows ? 'SHA256SUMS.txt' : `SHA256SUMS-${target}.txt`;
  const notes = windows ? 'RELEASE-NOTES.md' : `RELEASE-NOTES-${target}.md`;
  // Artifacts can retain arbitrary leading directories; discover by checksum.
  const output = path.join(directory, 'nested artifact', target, '1.1.0');
  fs.mkdirSync(output, { recursive: true });
  const files = [
    ...binaries,
    source,
    ...(windows ? ['MoarTube-Client-Node-1.1.0-windows-x64-123456abcdef-sources.zip'] : []),
  ];
  for (const name of files) fs.writeFileSync(path.join(output, name), name);
  fs.writeFileSync(
    path.join(output, checksum),
    files.map((name) => `${hash(name)}  ${name}`).join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(output, notes),
    files
      .filter((name) => name.includes('-sources.'))
      .map((name) => `Sources: https://github.com/${repo}/releases/download/${tag}/${name}\n`)
      .join('')
  );
  return { directory, output, files, checksum, notes, target, repo, tag, commit, version: '1.1.0' };
}

function github({
  draft = true,
  sha = commit,
  tagged = false,
  target = 'project-refactor',
  assets = [],
} = {}) {
  const release = { id: 123, tag_name: tag, draft, target_commitish: target };
  const writes = [];
  const uploads = [];
  const api = async (resource, options = {}) => {
    if (resource === 'releases') return [[release]];
    if (resource === 'releases/123/assets') return [assets];
    if (resource === 'releases/123') {
      if (options.method === 'PATCH') {
        writes.push(options.fields);
        Object.assign(release, options.fields);
      }
      return release;
    }
    if (resource.startsWith('git/matching-refs/'))
      return tagged ? [{ ref: `refs/tags/${tag}` }] : [];
    if (resource.startsWith('commits/')) return { sha };
    throw new Error(`Unexpected API request: ${resource}`);
  };
  return {
    release,
    writes,
    uploads,
    api,
    upload: async (selected, file) => {
      uploads.push({ tag: selected, file });
      const name = path.basename(file);
      const record = { name, state: 'uploaded', digest: `sha256:${hash(fs.readFileSync(file))}` };
      const index = assets.findIndex((asset) => asset.name === name);
      if (index < 0) assets.push(record);
      else assets[index] = record;
    },
  };
}

test('accepts either complete Windows variant alone and rejects an incomplete bundled pair', async (t) => {
  const { collectReleaseAssets } = await import('../../scripts/lib/draft-release.mjs');
  for (const prefix of ['MoarTube-Client-1.1.0-', 'MoarTube-Client-Node-1.1.0-']) {
    const local = await fixture(t);
    const files = local.files.filter((name) => name.startsWith(prefix) || name.includes('FFmpeg'));
    fs.writeFileSync(
      path.join(local.output, local.checksum),
      files.map((name) => `${hash(name)}  ${name}`).join('\n') + '\n'
    );
    const assets = await collectReleaseAssets(local);
    assert.equal(assets.length, prefix.startsWith('MoarTube-Client-Node-') ? 6 : 5);
  }
  const local = await fixture(t);
  const files = local.files.filter(
    (name) => name !== 'MoarTube-Client-Node-1.1.0-windows-x64-portable.zip'
  );
  fs.writeFileSync(
    path.join(local.output, local.checksum),
    files.map((name) => `${hash(name)}  ${name}`).join('\n') + '\n'
  );
  await assert.rejects(collectReleaseAssets(local), /incomplete/);
});

test('separate Windows workflows contribute disjoint assets to the same draft', async (t) => {
  const { collectReleaseAssets } = await import('../../scripts/lib/draft-release.mjs');
  const names = [];
  for (const variant of ['client', 'bundled']) {
    const local = await fixture(t);
    const prefix = variant === 'bundled' ? 'MoarTube-Client-Node-' : 'MoarTube-Client-1.1.0-';
    const source = `MoarTube-FFmpeg-test-build-${variant}-sources.zip`;
    fs.writeFileSync(path.join(local.output, source), source);
    const files = [...local.files.filter((name) => name.startsWith(prefix)), source];
    const checksum = `SHA256SUMS-windows-${variant}.txt`;
    const notes = `RELEASE-NOTES-windows-${variant}.md`;
    fs.writeFileSync(
      path.join(local.output, checksum),
      files.map((name) => `${hash(name)}  ${name}`).join('\n') + '\n'
    );
    fs.writeFileSync(
      path.join(local.output, notes),
      files
        .filter((name) => name.endsWith('-sources.zip'))
        .map((name) => `Sources: https://github.com/${repo}/releases/download/${tag}/${name}\n`)
        .join('')
    );
    const assets = await collectReleaseAssets({ ...local, target: `win32-x64-${variant}` });
    assert.equal(assets.length, variant === 'bundled' ? 6 : 5);
    names.push(assets.map((asset) => asset.name));
  }
  assert.deepEqual(
    names[0].filter((name) => names[1].includes(name)),
    []
  );
});

test('a bundled Windows release requires its matching application sources and download link', async (t) => {
  const { collectReleaseAssets } = await import('../../scripts/lib/draft-release.mjs');
  const local = await fixture(t);
  const source = local.files.find(
    (name) => name.startsWith('MoarTube-Client-Node-') && name.endsWith('-sources.zip')
  );
  fs.writeFileSync(
    path.join(local.output, local.checksum),
    local.files
      .filter((name) => name !== source)
      .map((name) => `${hash(name)}  ${name}`)
      .join('\n') + '\n'
  );
  await assert.rejects(collectReleaseAssets(local), /incomplete/);
  fs.writeFileSync(
    path.join(local.output, local.checksum),
    local.files.map((name) => `${hash(name)}  ${name}`).join('\n') + '\n'
  );
  const notes = fs.readFileSync(path.join(local.output, local.notes), 'utf8');
  fs.writeFileSync(
    path.join(local.output, local.notes),
    notes
      .split('\n')
      .filter((line) => !line.includes(source))
      .join('\n')
  );
  await assert.rejects(collectReleaseAssets(local), /requested draft tag/);
});

test('uploads each target allowlist, pins an untagged draft and never publishes it', async (t) => {
  const { uploadToDraft } = await import('../../scripts/lib/draft-release.mjs');
  for (const target of ['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']) {
    const local = await fixture(t, target);
    const remote = github();
    const result = await uploadToDraft({ ...local, ...remote });
    assert.equal(result.assets.length, local.files.length + 2);
    assert.equal(remote.uploads.length, local.files.length + 2);
    assert.deepEqual(remote.writes, [{ target_commitish: commit }]);
    assert.equal(remote.release.draft, true);
    assert.ok(
      remote.uploads.some(
        (item) =>
          path.basename(item.file).endsWith('-sources.zip') ||
          path.basename(item.file).endsWith('-sources.tar.xz')
      )
    );
  }
});

test('rejects absent/published drafts and mismatched tagged or untagged commits before uploads', async (t) => {
  const { uploadToDraft } = await import('../../scripts/lib/draft-release.mjs');
  const local = await fixture(t);
  for (const options of [
    { draft: false },
    { sha: 'b'.repeat(40) },
    { sha: 'b'.repeat(40), tagged: true },
  ]) {
    const remote = github(options);
    await assert.rejects(uploadToDraft({ ...local, ...remote }), /draft release|targets/);
    assert.equal(remote.uploads.length, 0);
    assert.equal(remote.writes.length, 0);
  }
  const remote = github();
  await assert.rejects(
    uploadToDraft({
      ...local,
      ...remote,
      api: async (resource) => (resource === 'releases' ? [[]] : remote.api(resource)),
    }),
    /existing draft/
  );
});

test('rejects altered downloads and wrong embedded tag links before changing the draft', async (t) => {
  const { uploadToDraft } = await import('../../scripts/lib/draft-release.mjs');
  const local = await fixture(t);
  const remote = github();
  fs.appendFileSync(path.join(local.output, local.files[0]), 'changed');
  await assert.rejects(uploadToDraft({ ...local, ...remote }), /checksum mismatch/);
  assert.equal(remote.writes.length, 0);
  fs.writeFileSync(path.join(local.output, local.files[0]), local.files[0]);
  fs.writeFileSync(
    path.join(local.output, local.notes),
    'https://github.com/wrong/repo/releases/download/wrong/source.zip'
  );
  await assert.rejects(uploadToDraft({ ...local, ...remote }), /requested draft tag/);
  assert.equal(remote.writes.length, 0);
});

test('skips identical assets and stops if the draft is published while contributing', async (t) => {
  const { uploadToDraft } = await import('../../scripts/lib/draft-release.mjs');
  const local = await fixture(t);
  const remote = github({
    target: commit,
    assets: [{ name: local.files[0], state: 'uploaded', digest: `sha256:${hash(local.files[0])}` }],
  });
  await uploadToDraft({ ...local, ...remote });
  assert.equal(remote.uploads.length, local.files.length + 1);
  const changing = github({ target: commit });
  await assert.rejects(
    uploadToDraft({
      ...local,
      ...changing,
      upload: async () => {
        changing.release.draft = false;
      },
    }),
    /no longer/
  );
});

test('refuses to report success when GitHub does not confirm uploaded hashes', async (t) => {
  const { uploadToDraft } = await import('../../scripts/lib/draft-release.mjs');
  const local = await fixture(t);
  const remote = github({ target: commit });
  await assert.rejects(
    uploadToDraft({ ...local, ...remote, upload: async () => {} }),
    /confirm the uploaded checksum/
  );
  assert.equal(remote.release.draft, true);
});
