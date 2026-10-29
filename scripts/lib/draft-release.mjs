import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';

export const digest = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

export async function collectReleaseAssets({ directory, target, version, repo, tag }) {
  const platforms = {
    'win32-x64': {
      checksum: 'SHA256SUMS.txt',
      notes: 'RELEASE-NOTES.md',
      binaries: [
        `MoarTube-Client-${version}-windows-x64-setup.exe`,
        `MoarTube-Client-${version}-windows-x64.zip`,
      ],
      source: /^MoarTube-FFmpeg-[a-zA-Z0-9._-]+-sources\.zip$/,
    },
    'linux-x64': {
      binaries: [
        `MoarTube-Client-${version}-linux-x64.deb`,
        `MoarTube-Client-${version}-linux-x64.tar.gz`,
      ],
    },
    'linux-arm64': {
      binaries: [
        `MoarTube-Client-${version}-linux-arm64.deb`,
        `MoarTube-Client-${version}-linux-arm64.tar.gz`,
      ],
    },
    'darwin-arm64': {
      binaries: [
        `MoarTube-Client-${version}-darwin-arm64.dmg`,
        `MoarTube-Client-${version}-darwin-arm64.zip`,
      ],
    },
    'darwin-x64': {
      binaries: [
        `MoarTube-Client-${version}-darwin-x64.dmg`,
        `MoarTube-Client-${version}-darwin-x64.zip`,
      ],
    },
  };
  const platform = platforms[target];
  if (!platform) throw new Error(`Unsupported draft release target: ${target}`);
  const checksum = platform.checksum ?? `SHA256SUMS-${target}.txt`;
  const notes = platform.notes ?? `RELEASE-NOTES-${target}.md`;
  const candidates = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === checksum)
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
  if (candidates.length !== 1)
    throw new Error(`Expected exactly one ${checksum} under ${directory}`);
  const root = realpathSync(path.dirname(candidates[0]));
  function asset(name) {
    const file = path.join(root, name);
    if (
      path.basename(name) !== name ||
      name.includes('\\') ||
      !lstatSync(file).isFile() ||
      realpathSync(file) !== file
    )
      throw new Error(`Invalid release asset path: ${name}`);
    return file;
  }
  const entries = readFileSync(asset(checksum), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const match = /^([a-f0-9]{64})  ([a-zA-Z0-9._+-]+)$/.exec(line);
      if (!match) throw new Error('Invalid release checksum entry');
      return { name: match[2], sha256: match[1] };
    });
  const sources = entries.filter((entry) =>
    (
      platform.source ??
      new RegExp(`^[a-zA-Z0-9._-]+-${target}-[a-zA-Z0-9._-]+-sources\\.tar\\.xz$`)
    ).test(entry.name)
  );
  const names = new Set(entries.map((entry) => entry.name));
  if (
    entries.length !== 3 ||
    names.size !== 3 ||
    sources.length !== 1 ||
    !platform.binaries.every((name) => names.has(name))
  )
    throw new Error(`Release downloads are incomplete or do not match ${target} ${version}`);
  const assets = [];
  for (const entry of entries) {
    const file = asset(entry.name);
    if ((await digest(file)) !== entry.sha256)
      throw new Error(`Release checksum mismatch: ${entry.name}`);
    assets.push({ ...entry, file });
  }
  const notesFile = asset(notes);
  const sourceUrl = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${sources[0].name}`;
  if (!readFileSync(notesFile, 'utf8').includes(sourceUrl))
    throw new Error(
      'Release notes do not match the requested draft tag/repository. Rebuild with the correct Draft release tag.'
    );
  for (const name of [checksum, notes])
    assets.push({ name, file: asset(name), sha256: await digest(asset(name)) });
  return assets;
}

// api and upload are injected so draft checks and failure handling can be tested
// without creating, changing or publishing a real release.
export async function uploadToDraft({
  repo,
  tag,
  commit,
  target,
  version,
  directory,
  api,
  upload,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[a-f0-9]{40}$/.test(commit ?? ''))
    throw new Error('A valid repository and build commit are required');
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(tag ?? '') ||
    tag.includes('..') ||
    tag.endsWith('/') ||
    tag.endsWith('.lock')
  )
    throw new Error('A valid explicit draft release tag is required');
  const releases = (await api('releases', { paginate: true })).flat();
  const matches = releases.filter((release) => release.tag_name === tag);
  if (matches.length !== 1 || !matches[0].draft)
    throw new Error(
      `Create an existing draft release for ${tag} first. Published releases cannot be changed by this uploader.`
    );
  const release = matches[0];
  async function checkDraft() {
    const current = await api(`releases/${release.id}`);
    if (!current.draft || current.tag_name !== tag)
      throw new Error('The release is no longer the selected draft; stopping uploads');
    const refs = await api(`git/matching-refs/tags/${encodeURIComponent(tag)}`);
    const tagged = refs.some((ref) => ref.ref === `refs/tags/${tag}`);
    const resolved = await api(
      `commits/${encodeURIComponent(tagged ? tag : current.target_commitish)}`
    );
    if (resolved.sha !== commit)
      throw new Error(
        `Draft ${tag} targets ${resolved.sha}, but this build is ${commit}. Select the same commit for all platform builds.`
      );
    return { current, tagged };
  }
  await checkDraft();
  const assets = await collectReleaseAssets({ directory, target, version, repo, tag });
  const { current, tagged } = await checkDraft();
  if (!tagged && current.target_commitish !== commit)
    await api(`releases/${release.id}`, { method: 'PATCH', fields: { target_commitish: commit } });
  await checkDraft();
  const existing = (await api(`releases/${release.id}/assets`, { paginate: true })).flat();
  for (const item of assets) {
    await checkDraft();
    const previous = existing.find((asset) => asset.name === item.name);
    if (previous?.state === 'uploaded' && previous.digest === `sha256:${item.sha256}`) {
      console.log(`Already uploaded: ${item.name}`);
      continue;
    }
    // Only this target's validated allowlist is replaced. Other platforms and
    // the manually written release title/body remain untouched.
    await upload(tag, item.file);
    console.log(`Uploaded ${item.name} to draft ${tag}`);
  }
  await checkDraft();
  const uploaded = (await api(`releases/${release.id}/assets`, { paginate: true })).flat();
  for (const item of assets)
    if (
      !uploaded.some(
        (asset) =>
          asset.name === item.name &&
          asset.state === 'uploaded' &&
          asset.digest === `sha256:${item.sha256}`
      )
    )
      throw new Error(`GitHub did not confirm the uploaded checksum for ${item.name}`);
  return {
    releaseId: release.id,
    tag,
    commit,
    target,
    assets: assets.map(({ name, sha256 }) => ({ name, sha256 })),
    draft: true,
  };
}
