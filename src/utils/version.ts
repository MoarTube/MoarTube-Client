import packageInfo from '../../package.json' with { type: 'json' };

// Bundled with the application so upgrades never depend on saved user settings.
export const CLIENT_VERSION = packageInfo.version;
