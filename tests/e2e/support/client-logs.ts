import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { open } from 'node:fs/promises';
import type { Reporter, TestCase } from '@playwright/test/reporter';

export const clientLogPath = path.resolve('temp/e2e-client.log');

export async function readClientLogTail(): Promise<Buffer> {
  const file = await open(clientLogPath, 'r');
  try {
    const { size } = await file.stat();
    const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, size - buffer.length);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

export default class ClientLogs implements Reporter {
  constructor() {
    mkdirSync(path.dirname(clientLogPath), { recursive: true });
    appendFileSync(clientLogPath, `\n--- Playwright invocation ${new Date().toISOString()} ---\n`);
  }

  onStdOut(chunk: string | Buffer, test?: TestCase): void {
    if (!test) {
      appendFileSync(clientLogPath, chunk);
    }
  }

  onStdErr(chunk: string | Buffer, test?: TestCase): void {
    if (!test) {
      appendFileSync(clientLogPath, chunk);
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}
