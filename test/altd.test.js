import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tailInstances = [];

class TailMock {
  constructor(file, options) {
    this.file = file;
    this.options = options;
    this.handlers = {};
    this.watch = vi.fn();
    this.unwatch = vi.fn();
    tailInstances.push(this);
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  emit(event, payload) {
    if (this.handlers[event]) {
      this.handlers[event](payload);
    }
  }
}

const spawnMock = vi.fn();

vi.mock('nodejs-tail', () => ({
  default: TailMock,
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

let AccessLogTailDispatcher;

beforeEach(async () => {
  tailInstances.length = 0;
  spawnMock.mockReset();
  vi.resetModules();
  ({ default: AccessLogTailDispatcher } = await import('../src/altd.js'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AccessLogTailDispatcher', () => {
  it('initializes with expected defaults', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);

    expect(altd.file).toBe('/path/to/dir');
    expect(altd.registry).toBe(registry);
    expect(altd.windowMs).toBe(1000);
    expect(altd.maxPerWindow).toBe(5);
    expect(altd.timeoutMs).toBe(10_000);
    expect(altd.maxStdoutBytes).toBe(64 * 1024);
  });

  it('extracts a pathname from log lines', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);

    expect(altd.extractPath({})).toBe('');
    expect(altd.extractPath('')).toBe('');
    expect(altd.extractPath('x'.repeat(10_001))).toBe('');
    expect(altd.extractPath('POST /not-a-get HTTP/1.1')).toBe('/not-a-get');
    expect(
      altd.extractPath(
        '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /bad%ZZ HTTP/1.1" 200 0 "-" "UA"'
      )
    ).toBe('');
    expect(
      altd.extractPath(
        '133.237.7.76 - - [16/Dec/2017:12:47:44 +0900] "GET '
          + '/google-home-notifier/Hello%20World '
          + 'HTTP/1.1" 404 580 "-" "Mozilla/5.0"'
      )
    ).toBe('/google-home-notifier/Hello%20World');
    expect(
      altd.extractPath(
        '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET '
          + 'https://example.com/hello?x=1#frag HTTP/1.1" 200 0 "-" "UA"'
      )
    ).toBe('/hello');
  });

  it('parses command and args safely', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);

    expect(altd.parseCommand()).toEqual([]);
    expect(altd.parseCommand('')).toEqual([]);
    expect(altd.parseCommand('no-slash')).toEqual([]);
    expect(altd.parseCommand('/')).toEqual([]);
    expect(altd.parseCommand('/' + 'a'.repeat(2049))).toEqual([]);
    expect(altd.parseCommand('/tool/' + 'b'.repeat(257))).toEqual([]);
    expect(altd.parseCommand('/google-home-notifier/Hello%20World')).toEqual([
      'google-home-notifier',
      'Hello World',
    ]);
    expect(altd.parseCommand('/test/%E0%A4%A')).toEqual([]);
  });

  it('rate limits execution', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry, {
      windowMs: 1000,
      maxPerWindow: 2,
    });

    expect(altd.allowByRateLimit()).toBe(true);
    expect(altd.allowByRateLimit()).toBe(true);
    expect(altd.allowByRateLimit()).toBe(false);

    vi.setSystemTime(new Date('2024-01-01T00:00:02Z'));
    expect(altd.allowByRateLimit()).toBe(true);
    vi.useRealTimers();
  });

  it('resolves execution via registry', () => {
    const registry = {
      echo: { execPath: '/bin/echo', buildArgs: (args) => args.slice(0, 1) },
      bad: { execPath: '/bin/bad', buildArgs: () => 'nope' },
      fail: { execPath: '/bin/fail', buildArgs: () => { throw new Error('no'); } },
    };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);

    expect(altd.resolveExecution(['echo', 'hello'])).toEqual({
      execPath: '/bin/echo',
      args: ['hello'],
    });
    expect(altd.resolveExecution('nope')).toBeNull();
    expect(altd.resolveExecution(['missing'])).toBeNull();
    expect(altd.resolveExecution(['bad', 'x'])).toBeNull();
    expect(altd.resolveExecution(['fail', 'x'])).toBeNull();
    expect(altd.resolveExecution([])).toBeNull();
  });

  it('spawns with limits and handles output', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const stderrWriteSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handlers = {};
    const stdoutHandlers = {};
    const stderrHandlers = {};
    const proc = {
      stdout: {
        on: vi.fn((event, handler) => {
          stdoutHandlers[event] = handler;
        }),
      },
      stderr: {
        on: vi.fn((event, handler) => {
          stderrHandlers[event] = handler;
        }),
      },
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
      kill: vi.fn(),
    };

    spawnMock.mockReturnValue(proc);

    const altd = new AccessLogTailDispatcher('/path/to/dir', registry, {
      spawnImpl: spawnMock,
      timeoutMs: 1,
      maxStdoutBytes: 3,
    });

    altd.spawnLimited('/bin/echo', ['hello']);

    expect(spawnMock).toHaveBeenCalledWith('/bin/echo', ['hello'], expect.any(Object));

    stdoutHandlers.data(Buffer.from('ok'));
    expect(stdoutWriteSpy).toHaveBeenCalledWith(Buffer.from('ok'));

    stdoutHandlers.data(Buffer.from('toolong'));
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

    stderrHandlers.data(Buffer.from('err'));
    expect(stderrWriteSpy).toHaveBeenCalledWith(Buffer.from('err'));

    handlers.error(new Error('boom'));
    expect(errorSpy).toHaveBeenCalled();

    handlers.exit();
  });

  it('wires tail events and dispatches on matching lines', () => {
    const registry = {
      command1: { execPath: '/bin/echo', buildArgs: (args) => args },
    };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);
    const spawnSpy = vi.spyOn(altd, 'spawnLimited').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    altd.run();

    expect(tailInstances).toHaveLength(1);

    const tailInstance = tailInstances[0];
    expect(tailInstance.file).toBe('/path/to/dir');
    expect(tailInstance.options).toEqual({
      alwaysStat: true,
      ignoreInitial: true,
      persistent: true,
    });

    tailInstance.emit(
      'line',
      '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /command1/arg1 HTTP/1.1" 200 0 "-" "UA"'
    );
    tailInstance.emit('close');

    expect(spawnSpy).toHaveBeenCalledWith('/bin/echo', ['arg1']);
    expect(logSpy).toHaveBeenCalledWith('watching stopped');
    expect(tailInstance.watch).toHaveBeenCalled();
  });

  it('stops watching safely', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);

    altd.stop();
    expect(tailInstances[0].unwatch).toHaveBeenCalled();
  });

  it('ignores rate-limited or invalid commands', () => {
    const registry = {
      command1: { execPath: '/bin/echo', buildArgs: (args) => args },
    };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry, {
      maxPerWindow: 0,
    });
    const spawnSpy = vi.spyOn(altd, 'spawnLimited').mockImplementation(() => {});

    altd.run();

    const tailInstance = tailInstances[0];
    tailInstance.emit(
      'line',
      '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /command1/arg1 HTTP/1.1" 200 0 "-" "UA"'
    );
    tailInstance.emit(
      'line',
      '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /missing/arg1 HTTP/1.1" 200 0 "-" "UA"'
    );

    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('stops safely when tail has no unwatch', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const tail = { on: vi.fn(), watch: vi.fn() };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry, { tail });

    expect(() => altd.stop()).not.toThrow();
  });
});
