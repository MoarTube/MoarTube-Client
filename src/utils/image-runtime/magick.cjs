const fs = require('node:fs');
const magick = require('@imagemagick/magick-wasm');

function initialize() {
  const configuration = magick.ConfigurationFiles.default;
  // The internal MSVG renderer translates SVG into MVG drawing commands.
  // Permit that internal reader while keeping MSL, indirect files and pipes
  // blocked by the upstream policy. No external programs/delegates are allowed.
  configuration.policy.data = configuration.policy.data
    .replace(/rights="none" pattern="MVG"/, 'rights="read" pattern="MVG"')
    .replace(
      '</policymap>',
      '<policy domain="delegate" rights="none" pattern="*"/>' +
        '<policy domain="filter" rights="none" pattern="*"/></policymap>'
    );
  return magick.initializeImageMagick(
    fs.readFileSync(require.resolve('@imagemagick/magick-wasm/magick.wasm')),
    configuration
  );
}
module.exports = { ...magick, initialize };
