const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareNsisInclude } = require('../nsis.cjs');

test('NSIS customization removes only the cached setup copy from the installed builder template', (t) => {
  const temporary = path.resolve('build/test');
  fs.mkdirSync(temporary, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporary, 'moartube-nsis-'));
  t.after(() => {
    assert.equal(path.dirname(directory), temporary);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const template = path.join(
    path.dirname(require.resolve('app-builder-lib/package.json')),
    'templates/nsis/include/installer.nsh'
  );
  const original = fs.readFileSync(template, 'utf8');
  const header = prepareNsisInclude(process.cwd(), directory);
  const customized = fs.readFileSync(path.join(directory, 'nsis/installer.nsh'), 'utf8');
  const copy = '!insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\\${APP_INSTALLER_STORE_FILE}"';
  assert.equal(
    customized,
    original.replace(
      copy,
      '; MoarTube installs full setup releases without caching another setup copy.'
    )
  );
  assert.equal(fs.readFileSync(template, 'utf8'), original);
  assert(customized.includes('!insertmacro extractEmbeddedAppPackage'));
  assert(customized.includes('File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"'));
  assert(fs.readFileSync(header, 'utf8').includes('autostart-installer.nsh'));
});
