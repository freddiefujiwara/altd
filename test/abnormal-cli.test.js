import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runSpy = vi.fn();
const ctorSpy = vi.fn();
const mockDispatcher = vi.fn();

vi.mock('../src/altd.js', () => ({
  default: mockDispatcher,
}));

// Abnormal rules files: a deformed --rules file must fail closed at
// startup (exit 1, dispatcher never constructed), never fail open.
describe('cli with abnormal rules files', () => {
  let originalArgv;
  let originalExit;
  let ctorOpts;

  const writeRules = (name, content) => {
    const path = join(tmpdir(), name);
    writeFileSync(path, content);
    return path;
  };

  const setupDispatcher = () => {
    mockDispatcher.mockImplementation(function (file, registry, opts) {
      ctorSpy(file, registry);
      ctorOpts = opts;
      return { run: runSpy };
    });
  };

  const exitWith = (argv) => {
    process.argv = argv;
    process.exit = vi.fn((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setupDispatcher();
  };

  beforeEach(() => {
    originalArgv = process.argv;
    originalExit = process.exit;
    runSpy.mockReset();
    ctorSpy.mockReset();
    mockDispatcher.mockReset();
    ctorOpts = undefined;
    vi.resetModules();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  it('exits when the rules file is not valid JSON', async () => {
    const rulesPath = writeRules('altd-rules-abnormal-json.json', '{oops');
    exitWith(['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', rulesPath]);

    await expect(import('../index.js')).rejects.toThrow('exit 1');
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('exits when the rules file top level is not a plain object', async () => {
    const shapes = ['[]', '"just a string"', '42', 'null', 'true'];
    for (const [index, shape] of shapes.entries()) {
      vi.resetModules();
      ctorSpy.mockReset();
      const rulesPath = writeRules(`altd-rules-abnormal-top-${index}.json`, shape);
      exitWith(['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', rulesPath]);

      await expect(import('../index.js')).rejects.toThrow('exit 1');
      expect(ctorSpy).not.toHaveBeenCalled();
    }
  });

  it('exits when a command patterns value is not an array', async () => {
    const rulesPath = writeRules(
      'altd-rules-abnormal-notarray.json',
      JSON.stringify({ echo: '^a$' })
    );
    exitWith(['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', rulesPath]);

    await expect(import('../index.js')).rejects.toThrow('exit 1');
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('exits when a patterns array contains a non-string', async () => {
    const rulesPath = writeRules(
      'altd-rules-abnormal-nonstr.json',
      JSON.stringify({ echo: ['^a$', 42, null] })
    );
    exitWith(['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', rulesPath]);

    await expect(import('../index.js')).rejects.toThrow('exit 1');
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('exits when the rules path is a directory', async () => {
    exitWith(['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', tmpdir()]);

    await expect(import('../index.js')).rejects.toThrow('exit 1');
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('exits when a pattern tries to set the global flag inline', async () => {
    // Inline flag modifiers cannot set g/y, so a stateful pattern can
    // never enter through the rules file: compilation itself fails.
    const rulesPath = writeRules(
      'altd-rules-abnormal-gflag.json',
      JSON.stringify({ echo: ['(?g)^x$'] })
    );
    exitWith(['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', rulesPath]);

    await expect(import('../index.js')).rejects.toThrow('exit 1');
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('loads an empty patterns array, which then blocks every argument', async () => {
    const rulesPath = writeRules(
      'altd-rules-abnormal-empty.json',
      JSON.stringify({ echo: [] })
    );
    process.argv = ['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', rulesPath];
    process.exit = vi.fn();
    setupDispatcher();

    await import('../index.js');

    expect(ctorOpts.argRules.echo).toEqual([]);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('lets the last duplicate command key win', async () => {
    const rulesPath = writeRules(
      'altd-rules-abnormal-dup.json',
      '{"echo":["^a$"],"echo":["^b$"]}'
    );
    process.argv = ['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', rulesPath];
    process.exit = vi.fn();
    setupDispatcher();

    await import('../index.js');

    expect(ctorOpts.argRules.echo).toHaveLength(1);
    expect(ctorOpts.argRules.echo[0].test('b')).toBe(true);
    expect(ctorOpts.argRules.echo[0].test('a')).toBe(false);
  });
});
