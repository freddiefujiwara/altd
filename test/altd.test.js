import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tailInstances = [];

class TailMock {
  constructor(file, options) {
    this.file = file;
    this.options = options;
    this.handlers = {};
    this.watch = vi.fn();
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

vi.mock('child_process', () => ({
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
  it('initializes with expected properties', () => {
    const altd = new AccessLogTailDispatcher('/path/to/dir', [
      'command1',
      'command2',
    ]);

    expect(altd).toMatchObject({
      file: '/path/to/dir',
      whitelist: ['command1', 'command2'],
      spawn: undefined,
      tail: undefined,
    });
  });

  it('extracts a path from a log line', () => {
    const altd = new AccessLogTailDispatcher('/path/to/dir', [
      'command1',
      'command2',
    ]);

    expect(altd.path({})).toBe('');
    expect(altd.path('')).toBe('');
    expect(
      altd.path(
        '133.237.7.76 - - [16/Dec/2017:12:47:44 +0900] "GET '
          + '/google-home-notifier/Hello%20World '
          + 'HTTP/1.1" 404 580 "-" "Mozilla/5.0"'
      )
    ).toBe('/google-home-notifier/Hello%20World');
  });

  it('parses commands and args from a path', () => {
    const altd = new AccessLogTailDispatcher('/path/to/dir', [
      'command1',
      'command2',
    ]);

    expect(altd.commandWithArgs()).toEqual([]);
    expect(altd.commandWithArgs('/google-home-notifier/Hello%20World')).toEqual([
      'google-home-notifier',
      'Hello World',
    ]);
  });

  it('handles malformed URI components while parsing command args', () => {
    const altd = new AccessLogTailDispatcher('/path/to/dir', ['command1']);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(altd.commandWithArgs('/test/%E0%A4%A')).toEqual([
      'test',
      '%E0%A4%A',
    ]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('filters commands with a whitelist', () => {
    const altd = new AccessLogTailDispatcher('/path/to/dir', [
      'command1',
      'command2',
    ]);

    expect(altd.filterByWhitelist(undefined, undefined)).toEqual([]);
    expect(altd.filterByWhitelist(['command1', 'arg1', 'arg2'], undefined)).toEqual(
      []
    );
    expect(altd.filterByWhitelist(undefined, ['command1', 'command2'])).toEqual([]);
    expect(
      altd.filterByWhitelist(['command1', 'arg1', 'arg2'], [
        'command3',
        'command4',
      ])
    ).toEqual([]);
    expect(
      altd.filterByWhitelist(['command1', 'arg1', 'arg2'], [
        'command1',
        'command2',
      ])
    ).toEqual(['command1', 'arg1', 'arg2']);
  });

  it('detects arrays correctly', () => {
    const altd = new AccessLogTailDispatcher('/path/to/dir', [
      'command1',
      'command2',
    ]);

    expect(altd.isArray(undefined)).toBe(false);
    expect(altd.isArray({})).toBe(false);
    expect(altd.isArray(1)).toBe(false);
    expect(altd.isArray('1')).toBe(false);
    expect(altd.isArray(['command1', 'arg1', 'arg2'])).toBe(true);
  });

  it('dispatches commands and handles output', () => {
    const altd = new AccessLogTailDispatcher('/path/to/dir', ['command1']);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const proc = {
      on: vi.fn((event, handler) => {
        if (event === 'error') {
          handler(new Error('spawn error'));
        }
      }),
      stdout: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('ok'));
          }
        }),
      },
    };

    altd.spawn = vi.fn(() => proc);

    altd.dispatch(['command', 'arg1', 'arg2']);
    expect(altd.spawn).toHaveBeenCalledWith('command', ['arg1', 'arg2']);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('ok');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('skips dispatch when command list is empty', () => {
    const altd = new AccessLogTailDispatcher('/path/to/dir', ['command1']);
    altd.spawn = vi.fn();

    altd.dispatch([]);
    expect(altd.spawn).not.toHaveBeenCalled();
  });

  it('wires tail events and dispatches on matching lines', () => {
    const altd = new AccessLogTailDispatcher('/path/to/dir', ['command1']);
    const dispatchSpy = vi.spyOn(altd, 'dispatch').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    altd.run();

    expect(spawnMock).toBe(altd.spawn);
    expect(tailInstances).toHaveLength(1);

    const tailInstance = tailInstances[0];
    tailInstance.emit(
      'line',
      '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /command1/arg1 HTTP/1.1" 200 0 "-" "UA"'
    );
    tailInstance.emit('close');

    expect(dispatchSpy).toHaveBeenCalledWith(['command1', 'arg1']);
    expect(logSpy).toHaveBeenCalledWith('watching stopped');
    expect(tailInstance.watch).toHaveBeenCalled();
  });
});
