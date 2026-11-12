#!/usr/bin/env node
// FPM's streaming tar compressor, using the pinned build Node's libzstd.
// This is a build tool only; installed applications do not need a zstd CLI.
const zlib = require('node:zlib');
const { pipeline } = require('node:stream');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log(`Zstandard ${process.versions.zstd} (Node ${process.version})`);
} else {
  if (args.some((arg) => !['-d', '--decompress', '-q', '-c'].includes(arg)))
    throw new Error('Unsupported zstd build-tool option');
  // FPM sets ZSTD_CLEVEL=-N, following its xz convention. The Node API takes N.
  const level = Math.abs(Number(process.env.ZSTD_CLEVEL ?? 3));
  if (!Number.isInteger(level) || level < 1 || level > 19) throw new Error('Invalid zstd level');
  const stream =
    args.includes('-d') || args.includes('--decompress')
      ? zlib.createZstdDecompress()
      : zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: level } });
  pipeline(process.stdin, stream, process.stdout, (error) => {
    if (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
}
