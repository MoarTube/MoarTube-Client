import { request } from '@playwright/test';

export const NODE_URL = 'http://localhost:9090';

export default async function checkNode(): Promise<void> {
  const api = await request.newContext({ timeout: 5000 });
  try {
    const response = await api.get(`${NODE_URL}/status/heartbeat`);
    if (!response.ok()) {
      throw new Error(`HTTP ${String(response.status())}`);
    }
    const body: unknown = await response.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('isError' in body) ||
      body.isError !== false ||
      !('timestamp' in body) ||
      typeof body.timestamp !== 'number'
    ) {
      throw new Error('Unexpected MoarTube Node heartbeat response');
    }
  } catch (error) {
    throw new Error(
      `A real MoarTube Node must already be running at ${NODE_URL}. Start and prepare it yourself, then rerun Playwright. Tests never provision, start, reset, or replace the Node. ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await api.dispose();
  }
}
