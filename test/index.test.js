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

describe('cli', () => {
  let originalArgv;
  let originalExit;

  const setupDispatcher = () => {
    mockDispatcher.mockImplementation(function (file, registry) {
      ctorSpy(file, registry);
      return { run: runSpy };
    });
  };

  beforeEach(() => {
    originalArgv = process.argv;
    originalExit = process.exit;
    runSpy.mockReset();
    ctorSpy.mockReset();
    mockDispatcher.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  it('exits with usage when required args are missing', async () => {
    process.argv = ['node', 'index.js', '/tmp/access.log'];
    process.exit = vi.fn((code) => {
      throw new Error(`exit ${code}`);
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    setupDispatcher();

    await expect(import('../index.js')).rejects.toThrow('exit 1');
    expect(logSpy).toHaveBeenCalledWith('altd <file> -w <commands...>');
  });

  it('builds a registry and runs the dispatcher', async () => {
    process.argv = ['node', 'index.js', '/tmp/access.log', '-w', 'echo,ls'];
    process.exit = vi.fn();

    setupDispatcher();

    await import('../index.js');

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    const [, registry] = ctorSpy.mock.calls[0];
    expect(registry.echo.execPath).toBe('echo');
    expect(registry.echo.buildArgs(['a'])).toEqual(['a']);
    expect(registry.ls.execPath).toBe('ls');
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(process.exit).not.toHaveBeenCalled();
  });
  it('loads argument rules and passes them to the dispatcher', async () => {
    const rulesPath = join(tmpdir(), 'altd-rules-test.json');
    writeFileSync(rulesPath, JSON.stringify({ echo: ['^a$', '^b c$'] }));
    process.argv = ['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', rulesPath];
    process.exit = vi.fn();

    let ctorOpts;
    mockDispatcher.mockImplementation(function (file, registry, opts) {
      ctorSpy(file, registry);
      ctorOpts = opts;
      return { run: runSpy };
    });

    await import('../index.js');

    expect(ctorOpts.argRules.echo).toHaveLength(2);
    expect(ctorOpts.argRules.echo[0]).toBeInstanceOf(RegExp);
    expect(ctorOpts.argRules.echo[0].test('a')).toBe(true);
    expect(ctorOpts.argRules.echo[0].test('nope')).toBe(false);
    expect(ctorOpts.argRules.echo[1].test('b c')).toBe(true);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('exits when the rules file cannot be loaded', async () => {
    process.argv = ['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', '/nonexistent/rules.json'];
    process.exit = vi.fn((code) => {
      throw new Error(`exit ${code}`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    setupDispatcher();

    await expect(import('../index.js')).rejects.toThrow('exit 1');
    expect(errorSpy).toHaveBeenCalled();
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('exits when the rules file holds an invalid pattern', async () => {
    const rulesPath = join(tmpdir(), 'altd-rules-invalid-test.json');
    writeFileSync(rulesPath, JSON.stringify({ echo: ['['] }));
    process.argv = ['node', 'index.js', '/tmp/access.log', '-w', 'echo', '--rules', rulesPath];
    process.exit = vi.fn((code) => {
      throw new Error(`exit ${code}`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    setupDispatcher();

    await expect(import('../index.js')).rejects.toThrow('exit 1');
    expect(errorSpy).toHaveBeenCalled();
    expect(ctorSpy).not.toHaveBeenCalled();
  });
});

