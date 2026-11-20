import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import AccessLogTailDispatcher from '../src/altd.js';

// Property-based tests over the pure decision surface: path decoding,
// request-target extraction, rules matching and spawn bookkeeping.
// Generators stay inside the documented input domain: request segments
// are whole code points (a lone surrogate cannot appear in a decoded
// segment — decodeURIComponent itself rejects encoded surrogates), and
// rule patterns are RegExps, as loadArgRules produces from the file.

const fakeTail = () => ({ on: vi.fn(), watch: vi.fn(), unwatch: vi.fn() });

const makeRegistry = (overrides = {}) => ({
  echo: { execPath: '/bin/echo', buildArgs: (args) => args },
  ...overrides,
});

const makeDispatcher = (opts = {}, registryOverrides = {}) =>
  new AccessLogTailDispatcher('/path/to/access.log', makeRegistry(registryOverrides), {
    tail: fakeTail(),
    ...opts,
  });

// Whole code points only: ASCII (including characters that are special
// in paths and encodings), Japanese text, an astral character and a
// combining mark. Joined segments are the values a client would encode
// into a request path.
const segmentChar = fc.constantFrom(
  'a', 'b', 'Z', '0', ' ', '/', '%', ':', '?', '#', '+', '.', '-', '_', '~',
  "'", '(', ')', 'é', 'あ', '🎉', '́'
);
const segment = fc
  .array(segmentChar, { minLength: 1, maxLength: 24 })
  .map((chars) => chars.join(''));

const rawPathChar = fc.constantFrom(
  '%', '/', 'a', 'Z', '0', '9', 'G', '.', '\\', '?', '#', 'é', '🎉'
);
const rawPath = fc
  .array(rawPathChar, { minLength: 0, maxLength: 200 })
  .map((chars) => chars.join(''));

describe('property: path decoding', () => {
  it('round-trips well-formed percent-encoded segments', () => {
    const altd = makeDispatcher();

    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 1, maxLength: 8 }),
        (segments) => {
          const pathname = `/${segments.map((s) => encodeURIComponent(s)).join('/')}`;
          expect(altd.parseCommand(pathname)).toEqual(segments);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('never throws and bounds its output for arbitrary raw paths', () => {
    const altd = makeDispatcher();
    const limited = makeDispatcher({ maxParts: 4, maxPartLength: 16 });

    fc.assert(
      fc.property(rawPath, (path) => {
        for (const [dispatcher, maxParts, maxPartLength] of [
          [altd, 64, 1024],
          [limited, 4, 16],
        ]) {
          const parts = dispatcher.parseCommand(path);
          expect(Array.isArray(parts)).toBe(true);
          expect(parts.length).toBeLessThanOrEqual(maxParts);
          for (const part of parts) {
            expect(typeof part).toBe('string');
            expect(part.length).toBeLessThanOrEqual(maxPartLength);
            expect(part.includes('\0')).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('never throws for non-string pathnames', () => {
    const altd = makeDispatcher();

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.integer(),
          fc.boolean(),
          fc.array(fc.string()),
          fc.object()
        ),
        (value) => {
          expect(altd.parseCommand(value)).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('property: request-target extraction', () => {
  it('never throws and only returns bounded slash-prefixed paths', () => {
    const altd = makeDispatcher();
    const method = fc.constantFrom('GET', 'get', 'POST', 'HEAD', 'OPTIONS', 'CONNECT', 'BREW');
    const version = fc.constantFrom('HTTP/1.1', 'HTTP/2', 'HTTP/10', 'XYZ', '');

    fc.assert(
      fc.property(method, rawPath, version, fc.string({ maxLength: 300 }), (m, target, v, junk) => {
        for (const line of [`" ${m} ${target} ${v} "`, junk]) {
          const pathname = altd.extractPath(line);
          expect(typeof pathname).toBe('string');
          if (pathname !== '') {
            expect(pathname.startsWith('/')).toBe(true);
            expect(pathname.length).toBeLessThanOrEqual(8192);
          }
          // Whatever was extracted must stay decodable without throwing.
          expect(() => altd.parseCommand(pathname)).not.toThrow();
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('property: rules matching', () => {
  const patternPool = [
    /^a$/,
    /^b c$/,
    /^https?:\/\/\S+$/,
    /^\d+$/,
    /^x$/g,
    /^x$/y,
  ];
  const argString = fc.constantFrom('a', 'b c', 'x', '123', 'https://example.com', 'nope', '');

  it('is deterministic and matches exactly the documented join semantics', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...patternPool), { minLength: 1, maxLength: 3 }),
        fc.array(argString, { minLength: 0, maxLength: 3 }),
        (patterns, args) => {
          const altd = makeDispatcher({ argRules: { echo: patterns } });
          const joined = args.join(' ');
          // Expectation computed with fresh RegExps: a pattern matches
          // when it matches from a zero lastIndex.
          const expected = patterns.some((p) =>
            new RegExp(p.source, p.flags).test(joined)
          );
          const verdicts = [0, 1, 2].map(
            () => altd.resolveExecution(['echo', ...args]) !== null
          );
          expect(verdicts).toEqual([expected, expected, expected]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('never throws and fails closed for deformed rules values', () => {
    const junkPatterns = fc.oneof(
      fc.string(),
      fc.constant(null),
      fc.integer(),
      fc.boolean(),
      fc.array(
        fc.oneof(
          fc.constantFrom(/^a$/, /^x$/),
          fc.string(),
          fc.constant(null),
          fc.integer()
        ),
        { maxLength: 4 }
      )
    );

    fc.assert(
      fc.property(junkPatterns, fc.array(argString, { maxLength: 3 }), (patterns, args) => {
        const altd = makeDispatcher({ argRules: { echo: patterns } });
        let result;
        expect(() => {
          result = altd.resolveExecution(['echo', ...args]);
        }).not.toThrow();
        if (result !== null) {
          expect(result.execPath).toBe('/bin/echo');
          expect(result.args.every((arg) => typeof arg === 'string')).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('never throws and fails closed for deformed buildArgs results', () => {
    const junkArg = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.boolean(),
      fc.object(),
      fc.string()
    );

    fc.assert(
      fc.property(fc.array(junkArg, { maxLength: 4 }), (builtArgs) => {
        const altd = makeDispatcher(
          {},
          { echo: { execPath: '/bin/echo', buildArgs: () => builtArgs } }
        );
        let result;
        expect(() => {
          result = altd.resolveExecution(['echo', 'x']);
        }).not.toThrow();
        if (result !== null) {
          expect(result.args.every((arg) => typeof arg === 'string')).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('property: spawn bookkeeping', () => {
  it('keeps activeCount equal to the number of processes holding a slot', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Each spawned process has an event script: exit-then-close, or
    // error-then-close (Node emits 'close' after either). A process
    // holds its slot from spawn until the first of exit/close.
    const op = fc.oneof(
      fc.record({ kind: fc.constant('spawn'), script: fc.constantFrom(0, 1) }),
      fc.record({ kind: fc.constant('advance') })
    );

    fc.assert(
      fc.property(
        fc.constantFrom(1, 2),
        fc.array(op, { minLength: 10, maxLength: 40 }),
        (maxConcurrent, ops) => {
          const procs = [];
          const spawnImpl = () => {
            const handlers = {};
            const proc = {
              pending: [],
              ended: false,
              on: (event, handler) => {
                handlers[event] = handler;
              },
              fire: (event) => {
                if (handlers[event]) handlers[event](event === 'error' ? new Error('x') : undefined);
              },
            };
            procs.push(proc);
            return proc;
          };
          const altd = makeDispatcher({ spawnImpl, maxConcurrent });
          let live = 0;

          for (const step of ops) {
            if (step.kind === 'spawn') {
              const before = procs.length;
              altd.spawnCommand('/bin/echo', ['x']);
              if (procs.length > before) {
                // A new process may only start while a slot is free.
                expect(live).toBeLessThan(maxConcurrent);
                live += 1;
                const proc = procs[procs.length - 1];
                proc.pending = step.script === 0 ? ['exit', 'close'] : ['error', 'close'];
              }
            } else {
              const proc = procs.find((p) => p.pending.length > 0);
              if (proc) {
                const event = proc.pending.shift();
                proc.fire(event);
                if ((event === 'exit' || event === 'close') && !proc.ended) {
                  proc.ended = true;
                  live -= 1;
                }
              }
            }
            expect(altd.activeCount).toBe(live);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
