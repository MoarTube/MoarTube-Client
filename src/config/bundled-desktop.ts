// Set only by the Electron supervisor, never by saved Client preferences.
let automaticLogin = false;

export function setBundledAutoLogin(enabled: boolean): void {
  automaticLogin = enabled;
}

export function bundledAutoLoginEnabled(): boolean {
  return automaticLogin;
}

export function bundledNodePort(): number | undefined {
  const value = process.env['MOARTUBE_BUNDLED_NODE_PORT'];
  if (value === undefined) {
    return undefined;
  }
  const port = Number(value);
  if (
    process.env['MOARTUBE_DESKTOP_MODE'] === undefined ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('Invalid bundled desktop Node configuration');
  }
  return port;
}
