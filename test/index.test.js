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

    mockDispatcher.mockImplementation((file, registry) => {
      ctorSpy(file, registry);
      return { run: runSpy };
    });

    await expect(import('../index.js')).rejects.toThrow('exit 1');
    expect(logSpy).toHaveBeenCalledWith('altd <file> -w <commands...>');
  });

  it('builds a registry and runs the dispatcher', async () => {
    process.argv = ['node', 'index.js', '/tmp/access.log', '-w', 'echo,ls'];
    process.exit = vi.fn();

    mockDispatcher.mockImplementation((file, registry) => {
      ctorSpy(file, registry);
      return { run: runSpy };
    });

    await import('../index.js');

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    const [, registry] = ctorSpy.mock.calls[0];
    expect(registry.echo.execPath).toBe('echo');
    expect(registry.echo.buildArgs(['a'])).toEqual(['a']);
    expect(registry.ls.execPath).toBe('ls');
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(process.exit).not.toHaveBeenCalled();
  });
});
