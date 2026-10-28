import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const build = path.join(root, 'build/ffmpeg');
const inspect = path.join(build, 'toolchains/win32-x64/msys64/clang64/bin/llvm-objdump.exe');
const directory = path.join(build, 'reports/win32-x64');
mkdirSync(directory, { recursive: true });
const osLibraries = new Set([
  'advapi32.dll',
  'avicap32.dll',
  'bcrypt.dll',
  'cfgmgr32.dll',
  'comdlg32.dll',
  'crypt32.dll',
  'd3d9.dll',
  'd3d11.dll',
  'd3d12.dll',
  'dxgi.dll',
  'gdi32.dll',
  'imm32.dll',
  'kernel32.dll',
  'mf.dll',
  'mfplat.dll',
  'mfuuid.dll',
  'msvcrt.dll',
  'ncrypt.dll',
  'ntdll.dll',
  'ole32.dll',
  'oleaut32.dll',
  'psapi.dll',
  'secur32.dll',
  'setupapi.dll',
  'shell32.dll',
  'shlwapi.dll',
  'strmiids.dll',
  'ucrtbase.dll',
  'user32.dll',
  'userenv.dll',
  'uuid.dll',
  'version.dll',
  'vfw32.dll',
  'winmm.dll',
  'ws2_32.dll',
]);
const results = [];
for (const name of ['ffmpeg', 'ffprobe']) {
  const executable = path.join(build, 'install/win32-x64/bin', `${name}.exe`);
  const report = execFileSync(inspect, ['-p', executable], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  writeFileSync(path.join(directory, `${name}-pe.txt`), report);
  const imports = [...report.matchAll(/DLL Name:\s*(\S+)/g)].map((match) => match[1].toLowerCase());
  if (!imports.length) throw new Error(`No PE imports found for ${name}`);
  const unexpected = imports.filter(
    (dll) => !osLibraries.has(dll) && !/^api-ms-win-[a-z0-9-]+\.dll$/.test(dll)
  );
  results.push({
    name,
    imports,
    unexpected,
    sha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
  });
}
writeFileSync(path.join(directory, 'dependencies.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some((result) => result.unexpected.length))
  throw new Error(`Unpackaged non-OS DLLs detected: ${JSON.stringify(results)}`);
console.log(
  'PE import inspection passed: only Windows OS imports. GPU runtimes are loaded dynamically and require separate hardware tests.'
);
