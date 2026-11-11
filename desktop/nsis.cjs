const fs = require('node:fs');
const path = require('node:path');
const { nsisEscapeString } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');

function prepareNsisInclude(root, state) {
  const template = path.join(
    path.dirname(require.resolve('app-builder-lib/package.json')),
    'templates/nsis/include/installer.nsh'
  );
  const original = fs.readFileSync(template, 'utf8');
  const copy = '!insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\\${APP_INSTALLER_STORE_FILE}"';
  if (original.split(copy).length !== 2)
    throw new Error(
      'Review the NSIS installer cache customization for this electron-builder version.'
    );
  const directory = path.join(state, 'nsis');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'installer.nsh'),
    original.replace(
      copy,
      '; MoarTube installs full setup releases without caching another setup copy.'
    )
  );
  const include = path.join(directory, 'moartube.nsh');
  fs.writeFileSync(
    include,
    // Switch after the builder's initial includes have resolved, so its
    // multiUser.nsh takes precedence over NSIS's unrelated MultiUser.nsh.
    // The working directory then selects our installer.nsh for the section.
    '!macro customHeader\n' +
      `  !addincludedir "${nsisEscapeString(path.dirname(path.dirname(template)))}"\n` +
      `  !cd "${nsisEscapeString(directory)}"\n` +
      '!macroend\n' +
      `!include "${nsisEscapeString(path.join(root, 'desktop/autostart-installer.nsh'))}"\n`
  );
  return include;
}

module.exports = { prepareNsisInclude };
