import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('build script', () => {
  it('writes dist output with updated import paths', async () => {
    await import('../scripts/build.js');

    const distIndex = await readFile(join(process.cwd(), 'dist', 'index.js'), 'utf8');
    const distAltd = await readFile(join(process.cwd(), 'dist', 'altd.js'), 'utf8');

    expect(distIndex).toContain('./altd.js');
    expect(distIndex).toContain('../package.json');
    expect(distAltd).toContain('AccessLogTailDispatcher');
  });
});
