import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface FfmpegArtifact {
  buildId: string;
  version: string;
  ffmpeg: string;
  ffprobe: string;
}

const validated = new Map<string, { manifest: string; artifact: FfmpegArtifact }>();

/** Resolve immutable packaged binaries and verify both before first use. */
export function resolveFfmpegArtifact(
  resourceRoot: string,
  target: string
): FfmpegArtifact | undefined {
  const directory = path.join(resourceRoot, 'ffmpeg', target);
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  const text = fs.readFileSync(manifestPath, 'utf8');
  const previous = validated.get(manifestPath);
  if (previous?.manifest === text) {
    return previous.artifact;
  }
  const manifest = JSON.parse(text) as {
    schemaVersion: number;
    target: string;
    buildId: string;
    version: string;
    files?: Record<string, { path: string; sha256: string }>;
  };
  if (
    manifest.schemaVersion !== 1 ||
    manifest.target !== target ||
    typeof manifest.buildId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.buildId) ||
    typeof manifest.version !== 'string' ||
    !manifest.version
  ) {
    throw new Error(`Invalid MoarTube FFmpeg manifest: ${manifestPath}`);
  }
  const binary = (name: string): string => {
    const executableName = `${name}${target.startsWith('win32-') ? '.exe' : ''}`;
    const file = manifest.files?.[name];
    if (
      !file ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      file.path !== `${manifest.buildId}/${executableName}`
    ) {
      throw new Error(`Invalid ${name} entry in ${manifestPath}`);
    }
    const executable = path.join(directory, manifest.buildId, executableName);
    const digest = createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
    if (digest !== file.sha256) {
      throw new Error(
        `MoarTube ${name} checksum mismatch: ${executable}. Restore the packaged artifact.`
      );
    }
    return executable;
  };
  const artifact = {
    buildId: manifest.buildId,
    version: manifest.version,
    ffmpeg: binary('ffmpeg'),
    ffprobe: binary('ffprobe'),
  };
  validated.set(manifestPath, { manifest: text, artifact });
  return artifact;
}
