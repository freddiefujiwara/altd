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
    expect(altd.maxConcurrent).toBe(Infinity);
    expect(altd.minIntervalMs).toBe(0);
    expect(altd.maxParts).toBe(64);
    expect(altd.maxPartLength).toBe(1024);
    expect(altd.maxArgLength).toBe(1024);
    expect(altd.maxPathLength).toBe(8192);
  });

  it('extracts a pathname from log lines', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);
    const limited = new AccessLogTailDispatcher('/path/to/dir', registry, { maxPathLength: 8 });

    expect(altd.extractPath({})).toBe('');
    expect(altd.extractPath('')).toBe('');
    expect(altd.extractPath('POST /not-a-get HTTP/1.1')).toBe('/not-a-get');
    expect(
      altd.extractPath(
        '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /bad%ZZ HTTP/1.1" 200 0 "-" "UA"'
      )
    ).toBe('/bad%ZZ');
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
    expect(
      altd.extractPath(
        '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET '
          + 'http://example.com/hi HTTP/1.1" 200 0 "-" "UA"'
      )
    ).toBe('/hi');
    expect(
      limited.extractPath(
        '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /too/long/path HTTP/1.1" 200 0 "-" "UA"'
      )
    ).toBe('');
    expect(
      altd.extractPath(
        '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET http://% HTTP/1.1" 200 0 "-" "UA"'
      )
    ).toBe('');
  });

  it('falls back to an empty pathname when URL has none', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);
    const originalURL = global.URL;

    global.URL = class FakeURL {
      constructor() {
        return { pathname: '' };
      }
    };

    expect(
      altd.extractPath(
        '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET http://example.com HTTP/1.1" 200 0 "-" "UA"'
      )
    ).toBe('');

    global.URL = originalURL;
  });

  it('parses command and args safely', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);
    const limited = new AccessLogTailDispatcher('/path/to/dir', registry, {
      maxParts: 2,
      maxPartLength: 3,
    });

    expect(altd.parseCommand()).toEqual([]);
    expect(altd.parseCommand('')).toEqual([]);
    expect(altd.parseCommand('no-slash')).toEqual([]);
    expect(altd.parseCommand('/')).toEqual([]);
    expect(altd.parseCommand('/google-home-notifier/Hello%20World')).toEqual([
      'google-home-notifier',
      'Hello World',
    ]);
    expect(altd.parseCommand('/test/%E0%A4%A')).toEqual([]);
    expect(limited.parseCommand('/too/many/parts')).toEqual([]);
    expect(limited.parseCommand('/toolong')).toEqual([]);
  });

  it('resolves execution via registry', () => {
    const registry = {
      echo: { execPath: '/bin/echo', buildArgs: (args) => args.slice(0, 1) },
      bad: { execPath: '/bin/bad', buildArgs: () => 'nope' },
    };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry, { maxArgLength: 2 });

    expect(altd.resolveExecution(['echo', 'hi'])).toEqual({
      execPath: '/bin/echo',
      args: ['hi'],
    });
    expect(altd.resolveExecution(['echo', 'toolong'])).toBeNull();
    expect(altd.resolveExecution('nope')).toBeNull();
    expect(altd.resolveExecution(['missing'])).toBeNull();
    expect(altd.resolveExecution(['bad', 'x'])).toBeNull();
    expect(altd.resolveExecution([])).toBeNull();
  });

  it('uses default args builder when one is not provided', () => {
    const registry = { echo: { execPath: '/bin/echo' } };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);

    expect(altd.resolveExecution(['echo', 'a', 'b'])).toEqual({
      execPath: '/bin/echo',
      args: ['a', 'b'],
    });
  });

  it('spawns commands with the configured spawn implementation', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);

    const handlers = {};
    const proc = {
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
    };

    spawnMock.mockReturnValue(proc);

    const altd = new AccessLogTailDispatcher('/path/to/dir', registry, {
      spawnImpl: spawnMock,
      maxConcurrent: 1,
      minIntervalMs: 500,
    });

    altd.spawnCommand('/bin/echo', ['hello']);
    altd.spawnCommand('/bin/echo', ['blocked']);

    expect(spawnMock).toHaveBeenCalledWith('/bin/echo', ['hello'], expect.any(Object));

    handlers.error(new Error('boom'));
    handlers.close();
    handlers.exit();
    expect(errorSpy).toHaveBeenCalled();
    expect(altd.activeCount).toBe(0);

    nowSpy.mockReturnValue(1600);
    altd.spawnCommand('/bin/echo', ['after']);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('wires tail events and dispatches on matching lines', () => {
    const registry = {
      command1: { execPath: '/bin/echo', buildArgs: (args) => args },
    };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);
    const spawnSpy = vi.spyOn(altd, 'spawnCommand').mockImplementation(() => {});
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

  it('ignores invalid commands', () => {
    const registry = {
      command1: { execPath: '/bin/echo', buildArgs: (args) => args },
    };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry);
    const spawnSpy = vi.spyOn(altd, 'spawnCommand').mockImplementation(() => {});

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

    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it('stops safely when tail has no unwatch', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const tail = { on: vi.fn(), watch: vi.fn() };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry, { tail });

    expect(() => altd.stop()).not.toThrow();
  });

  it('swallows errors when unwatch throws', () => {
    const registry = { echo: { execPath: '/bin/echo', buildArgs: (args) => args } };
    const tail = { on: vi.fn(), watch: vi.fn(), unwatch: vi.fn(() => { throw new Error('no'); }) };
    const altd = new AccessLogTailDispatcher('/path/to/dir', registry, { tail });

    expect(() => altd.stop()).not.toThrow();
  });
});
