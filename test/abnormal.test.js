import { describe, expect, it, vi } from 'vitest';
import AccessLogTailDispatcher from '../src/altd.js';

// Abnormal-case tests: the input from outside is the HTTP request line as
// it lands in the access log, plus the operator-supplied rules/registry
// shapes the dispatcher boundary can be handed. A malformed request must
// get a clean refusal, never crash the dispatcher or wedge its state.

const capturingTail = () => {
  const handlers = {};
  return {
    handlers,
    on: (event, handler) => {
      handlers[event] = handler;
    },
    watch: vi.fn(),
    unwatch: vi.fn(),
  };
};

const makeRegistry = (overrides = {}) => ({
  echo: { execPath: '/bin/echo', buildArgs: (args) => args },
  ...overrides,
});

const makeDispatcher = (opts = {}, registryOverrides = {}) =>
  new AccessLogTailDispatcher('/path/to/access.log', makeRegistry(registryOverrides), {
    tail: capturingTail(),
    ...opts,
  });

const logLine = (target, method = 'GET', version = 'HTTP/1.1') =>
  `127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "${method} ${target} ${version}" 200 0 "-" "UA"`;

describe('abnormal percent-encoding and decoding', () => {
  it('rejects malformed percent-encoding wherever it appears', () => {
    const altd = makeDispatcher();

    for (const bad of ['%ZZ', '%', '%1', '%G1', 'abc%']) {
      expect(altd.parseCommand(`/echo/${bad}`)).toEqual([]);
      expect(altd.parseCommand(`/${bad}/x`)).toEqual([]);
      expect(altd.parseCommand(`/echo/ok/${bad}`)).toEqual([]);
    }
  });

  it('rejects truncated and overlong UTF-8 sequences', () => {
    const altd = makeDispatcher();

    // Truncated multibyte sequences and overlong encodings (an overlong
    // "/" must never decode into a smuggled separator).
    for (const bad of ['%C3', '%E3%81', '%F0%9F%8E', '%C0%AF', '%C1%BF']) {
      expect(altd.parseCommand(`/echo/${bad}`)).toEqual([]);
    }
  });

  it('rejects percent-encoded surrogate halves', () => {
    const altd = makeDispatcher();

    expect(altd.parseCommand('/echo/%ED%A0%80')).toEqual([]);
    expect(altd.parseCommand('/echo/%ED%BF%BF')).toEqual([]);
  });

  it('rejects legacy %u escapes and a NUL in the command segment', () => {
    const altd = makeDispatcher();

    expect(altd.parseCommand('/echo/%u1234')).toEqual([]);
    expect(altd.parseCommand('/%00/x')).toEqual([]);
  });

  it('keeps control characters other than NUL as argument data', () => {
    const altd = makeDispatcher();

    // Only NUL is rejected: it is the one byte spawn() cannot accept.
    // Other control bytes are inert argument data.
    expect(altd.parseCommand('/echo/%01')).toEqual(['echo', '']);
    expect(altd.parseCommand('/echo/%1F')).toEqual(['echo', '']);
    expect(altd.parseCommand('/echo/%7F')).toEqual(['echo', '']);
  });
});

describe('abnormal sizes', () => {
  it('enforces the decoded segment limit at the boundary', () => {
    const altd = makeDispatcher();

    expect(altd.parseCommand(`/echo/${'a'.repeat(1024)}`)).toHaveLength(2);
    expect(altd.parseCommand(`/echo/${'a'.repeat(1025)}`)).toEqual([]);
  });

  it('enforces the raw segment limit even when the decoded value is short', () => {
    const altd = makeDispatcher();

    // Raw length 1024, decoded 342: passes.
    expect(altd.parseCommand(`/echo/${'%61'.repeat(341)}a`)).toHaveLength(2);
    // Raw length 1026, decoded 342: the raw form alone is over the limit.
    expect(altd.parseCommand(`/echo/${'%61'.repeat(342)}`)).toEqual([]);
  });

  it('enforces the segment-count limit at the boundary', () => {
    const altd = makeDispatcher();

    expect(altd.parseCommand(`/echo${'/a'.repeat(63)}`)).toHaveLength(64);
    expect(altd.parseCommand(`/echo${'/a'.repeat(64)}`)).toEqual([]);
  });

  it('enforces the whole-path limit at the boundary', () => {
    const altd = makeDispatcher();

    const exact = `/${'a'.repeat(8191)}`;
    const over = `/${'a'.repeat(8192)}`;
    expect(altd.extractPath(logLine(exact))).toBe(exact);
    expect(altd.extractPath(logLine(over))).toBe('');
  });
});

describe('abnormal request targets', () => {
  it('rejects targets with no dispatchable path', () => {
    const altd = makeDispatcher();

    expect(altd.extractPath(logLine('*', 'OPTIONS'))).toBe('');
    expect(altd.extractPath(logLine('?a=b'))).toBe('');
    expect(altd.extractPath(logLine('#frag'))).toBe('');
    expect(altd.extractPath('127.0.0.1 - - [x] "GET /echo/x" 200 0 "-" "UA"')).toBe('');
    expect(altd.extractPath(logLine('/echo/x', 'GET', 'HTTP/10'))).toBe('');
    expect(altd.extractPath(logLine('example.com:443', 'CONNECT'))).toBe('');
  });

  it('rejects targets that URL parsing would rewrite', () => {
    const altd = makeDispatcher();

    // Protocol-relative targets would silently change the host.
    expect(altd.extractPath(logLine('//evil.example/echo/x'))).toBe('');
    // A trailing encoded dot segment normalizes the path away.
    expect(altd.extractPath(logLine('/echo/%2e%2e'))).toBe('');
    // Raw unencoded non-ASCII bytes are rewritten by URL parsing into
    // percent-encoded form, so the target is rejected like every other
    // rewrite: clients must percent-encode (as browsers and the
    // production nginx log show).
    expect(altd.extractPath(logLine('/echo/こんにちは'))).toBe('');
  });

  it('accepts absolute-form targets and discards query and fragment', () => {
    const altd = makeDispatcher();

    expect(altd.extractPath(logLine('HTTP://EXAMPLE.COM/hi'))).toBe('/hi');
    expect(altd.extractPath(logLine('/echo/arg?/evil'))).toBe('/echo/arg');
    expect(altd.extractPath(logLine('/echo/arg#frag'))).toBe('/echo/arg');
    expect(altd.extractPath(logLine('/echo/%c3%a9'))).toBe('/echo/%c3%a9');
  });

  it('keeps an encoded slash inside a single argument value', () => {
    const altd = makeDispatcher();

    // Arguments are data, never paths altd itself resolves: an encoded
    // slash decodes into the argument string, as the ogp URL argument
    // relies on. Rules, not the parser, decide if it may run.
    expect(altd.parseCommand('/echo/..%2f..%2fetc')).toEqual(['echo', '../../etc']);
    expect(altd.parseCommand('/echo/a%2fb')).toEqual(['echo', 'a/b']);
  });

  it('treats + as data, not as a space', () => {
    const altd = makeDispatcher();

    expect(altd.parseCommand('/echo/a+b')).toEqual(['echo', 'a+b']);
  });
});

describe('abnormal rules and registry shapes', () => {
  it('blocks instead of throwing when a patterns value is not an array', () => {
    const altd = makeDispatcher({ argRules: { echo: 'not-an-array' } });

    expect(altd.resolveExecution(['echo', 'x'])).toBeNull();
  });

  it('ignores non-RegExp pattern entries and lets real patterns decide', () => {
    const altd = makeDispatcher({
      argRules: { echo: ['junk', null, 42, /^ok$/] },
    });

    expect(altd.resolveExecution(['echo', 'ok'])).toEqual({
      execPath: '/bin/echo',
      args: ['ok'],
    });
    expect(altd.resolveExecution(['echo', 'nope'])).toBeNull();
  });

  it('gives the same verdict on repeated resolutions with a global pattern', () => {
    const altd = makeDispatcher({ argRules: { echo: [/^x$/g] } });

    // RegExp#test is stateful for global patterns (lastIndex); a rules
    // check must not alternate allow/block for identical requests.
    const verdicts = [0, 1, 2, 3].map(
      () => altd.resolveExecution(['echo', 'x']) !== null
    );
    expect(verdicts).toEqual([true, true, true, true]);
  });

  it('gives the same verdict on repeated resolutions with a sticky pattern', () => {
    const altd = makeDispatcher({ argRules: { echo: [/^x$/y] } });

    const verdicts = [0, 1, 2, 3].map(
      () => altd.resolveExecution(['echo', 'x']) !== null
    );
    expect(verdicts).toEqual([true, true, true, true]);
  });

  it('blocks when buildArgs returns non-string arguments', () => {
    // Node's spawn only accepts string arguments; a registry whose
    // buildArgs produces anything else must fail closed, not throw or
    // pass the value through.
    for (const badArgs of [[null], [undefined], [42], [{}], ['ok', null]]) {
      const altd = makeDispatcher(
        {},
        { echo: { execPath: '/bin/echo', buildArgs: () => badArgs } }
      );
      expect(altd.resolveExecution(['echo', 'x'])).toBeNull();
    }
  });

  it('resolves a null registry entry to null', () => {
    const altd = makeDispatcher({}, { echo: null });

    expect(altd.resolveExecution(['echo'])).toBeNull();
  });
});

describe('spawn bookkeeping under abnormal event orders', () => {
  const makeProc = () => {
    const handlers = {};
    return {
      on: (event, handler) => {
        handlers[event] = handler;
      },
      fire: (event) => {
        if (handlers[event]) handlers[event]();
      },
    };
  };

  it('counts a finished process once even when its close arrives after a later spawn', () => {
    const procs = [];
    const spawnImpl = vi.fn(() => {
      const proc = makeProc();
      procs.push(proc);
      return proc;
    });
    const altd = makeDispatcher({ spawnImpl, maxConcurrent: 1 });

    altd.spawnCommand('/bin/echo', ['a']);
    procs[0].fire('exit');
    altd.spawnCommand('/bin/echo', ['b']);
    // The first process's 'close' fires after 'exit' (Node emits both);
    // it must not free the slot the second process is using.
    procs[0].fire('close');

    expect(altd.activeCount).toBe(1);
    altd.spawnCommand('/bin/echo', ['c']);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it('frees the slot exactly once after an error followed by close', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const procs = [];
    const spawnImpl = vi.fn(() => {
      const proc = makeProc();
      procs.push(proc);
      return proc;
    });
    const altd = makeDispatcher({ spawnImpl, maxConcurrent: 1 });

    altd.spawnCommand('/bin/echo', ['a']);
    procs[0].fire('error');
    procs[0].fire('close');

    expect(altd.activeCount).toBe(0);
    altd.spawnCommand('/bin/echo', ['b']);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it('never lets activeCount go negative under repeated end events', () => {
    const procs = [];
    const spawnImpl = vi.fn(() => {
      const proc = makeProc();
      procs.push(proc);
      return proc;
    });
    const altd = makeDispatcher({ spawnImpl, maxConcurrent: 1 });

    altd.spawnCommand('/bin/echo', ['a']);
    procs[0].fire('exit');
    procs[0].fire('close');
    procs[0].fire('exit');

    expect(altd.activeCount).toBe(0);
  });
});

describe('daemon survival', () => {
  it('keeps dispatching after a run of malformed and blocked lines', () => {
    const logger = { error: vi.fn() };
    const altd = makeDispatcher({
      argRules: { echo: [/^ok$/] },
      logger,
    });
    const spawnSpy = vi.spyOn(altd, 'spawnCommand').mockImplementation(() => {});

    altd.run();
    const { handlers } = altd.tail;

    const lines = [
      logLine('/echo/%ZZ'),
      logLine('/echo/%E0%A4%A'),
      logLine('/ogp/%2e%2e/echo/ok'),
      logLine('/echo/a%00b'),
      logLine('/missing/ok'),
      logLine('/echo/nope'),
      logLine(`/${'a'.repeat(9000)}`),
      logLine('/echo/ok'),
    ];
    for (const line of lines) {
      expect(() => handlers.line(line)).not.toThrow();
    }

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy).toHaveBeenCalledWith('/bin/echo', ['ok']);
  });

  it('ignores non-string log lines without throwing', () => {
    const altd = makeDispatcher();
    const spawnSpy = vi.spyOn(altd, 'spawnCommand').mockImplementation(() => {});

    altd.run();
    const { handlers } = altd.tail;

    for (const line of [undefined, null, 42, {}, [], Buffer.from('GET /echo/x HTTP/1.1')]) {
      expect(() => handlers.line(line)).not.toThrow();
    }
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});
