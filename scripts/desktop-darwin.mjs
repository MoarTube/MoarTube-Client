import { fileURLToPath } from 'node:url';
import { requireDarwinTarget, run } from '../tooling/ffmpeg/scripts/darwin-native.mjs';
import { parseDarwinDesktopArgs } from '../desktop/darwin-variant.cjs';

const {
  arch,
  variant: requestedVariant,
  variants,
  dir,
} = parseDarwinDesktopArgs(process.argv.slice(2));
requireDarwinTarget([`--arch=${arch}`]);
const archArgs = [`--arch=${arch}`];
const cwd = fileURLToPath(new URL('../', import.meta.url));
run('npm', ['run', 'build'], { cwd });
run(process.execPath, ['scripts/prepare-desktop-darwin.mjs', ...archArgs], { cwd });
if (variants.includes('bundled'))
  run(process.execPath, ['scripts/prepare-desktop-node.mjs'], { cwd });
run(process.execPath, ['scripts/prepare-desktop-javascript.mjs', `--variant=${requestedVariant}`], {
  cwd,
});
for (const variant of variants) {
  const env = {
    ...process.env,
    MOARTUBE_DESKTOP_VARIANT: variant,
    ELECTRON_BUILDER_COMPRESSION_LEVEL: process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ?? '6',
  };
  run(
    process.execPath,
    [
      'node_modules/electron-builder/cli.js',
      '--config',
      'desktop/electron-builder-darwin.cjs',
      '--mac',
      `--${arch}`,
      ...(dir ? ['--dir'] : []),
      '--publish',
      'never',
    ],
    { cwd, env }
  );
  run(
    process.execPath,
    [
      'scripts/verify-desktop-darwin-package.mjs',
      ...archArgs,
      `--variant=${variant}`,
      ...(dir ? ['--dir'] : []),
    ],
    { cwd, env }
  );
  if (!dir)
    run(
      process.execPath,
      ['scripts/desktop-checksums.mjs', '--darwin', ...archArgs, `--variant=${variant}`],
      { cwd, env }
    );
}
