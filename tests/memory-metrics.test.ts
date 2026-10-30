import { describe, expect, it } from 'vitest';
import { parseProcessMemory, sumProcessTree } from '../src/utils/memory-metrics.js';

describe('application RAM accounting', () => {
  it('counts desktop/cluster siblings and encoding grandchildren while excluding measurement helpers and unrelated processes', () => {
    const processes = parseProcessMemory(
      `
      100 1 1000
      101 100 2000
      102 100 3000
      103 101 4000
      104 103 5000
      105 101 90000
      106 105 80000
      200 1 99999
    `,
      1
    );
    expect(sumProcessTree(processes, 100, 105)).toBe(15000);
    expect(sumProcessTree(processes, 101, 105)).toBe(11000);
  });

  it('normalizes Unix KiB readings and skips malformed process records', () => {
    const records = parseProcessMemory(
      '10 1 128\n11 10 256\ninvalid\n12 10 NaN\n0 0 1\n13 10 -20',
      1024
    );
    expect(sumProcessTree(records, 10, 0)).toBe(384 * 1024);
  });

  it('fails rather than reporting zero when the application process cannot be found', () => {
    expect(() => sumProcessTree([], 100, 0)).toThrow('Application process is unavailable');
  });

  it('does not double-count a malformed cyclic process tree', () => {
    expect(sumProcessTree(parseProcessMemory('10 11 100\n11 10 200', 1), 10, 0)).toBe(300);
  });
});
