import { spawn as nodeSpawn } from "node:child_process";

const { default: Tail } = await import("nodejs-tail");

/**
 * @typedef {object} CommandRegistryEntry
 * @property {string} execPath
 * @property {(rawArgs: string[]) => string[]} [buildArgs]
 */

/**
 * @typedef {object} DispatcherOptions
 * @property {(command: string, args: string[], options: object) => import("node:child_process").ChildProcess} [spawnImpl]
 * @property {{ on: Function, watch: Function, unwatch?: Function }} [tail]
 * @property {number} [maxConcurrent]
 * @property {number} [minIntervalMs]
 * @property {number} [maxParts]
 * @property {number} [maxPartLength]
 * @property {number} [maxArgLength]
 * @property {number} [maxPathLength]
 */

const REQUEST_LINE_REGEX =
  /\b(GET|POST|PUT|DELETE|HEAD|OPTIONS)\s+(\S+)\s+HTTP\/\d(?:\.\d)?\b/i;

/**
 * Extract a raw request target from an access log line.
 * @param {string} line
 * @returns {string}
 */
const parseRequestTarget = (line) => {
  if (typeof line !== "string") return "";
  const match = line.match(REQUEST_LINE_REGEX);
  return match ? match[2] : "";
};

/**
 * Normalize a raw request target into a safe pathname.
 * @param {string} rawTarget
 * @param {number} maxPathLength
 * @returns {string}
 */
const toSafePathname = (rawTarget, maxPathLength) => {
  if (!rawTarget) return "";
  try {
    const base = rawTarget.startsWith("http://")
      || rawTarget.startsWith("https://")
      ? undefined
      : "http://localhost";
    const url = base ? new URL(rawTarget, base) : new URL(rawTarget);
    const { pathname } = url;
    if (!pathname || pathname.length > maxPathLength) return "";
    return pathname;
  } catch {
    return "";
  }
};

/**
 * Decode a path into command/args with size limits.
 * @param {string} pathname
 * @param {number} maxParts
 * @param {number} maxPartLength
 * @returns {string[]}
 */
const decodePathParts = (pathname, maxParts, maxPartLength) => {
  if (typeof pathname !== "string" || pathname === "") return [];
  if (!pathname.startsWith("/")) return [];

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > maxParts) return [];

  const decoded = [];
  for (const part of parts) {
    try {
      const value = decodeURIComponent(part);
      if (value.length > maxPartLength) return [];
      if (part.length > maxPartLength) return [];
      decoded.push(value);
    } catch {
      return [];
    }
  }
  return decoded;
};

/**
 * Resolve a parsed command into an exec path and args.
 * @param {string[]} parsed
 * @param {Record<string, CommandRegistryEntry>} registry
 * @param {number} maxArgLength
 * @returns {{execPath: string, args: string[]} | null}
 */
const resolveExecutionFromRegistry = (parsed, registry, maxArgLength) => {
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const [cmd, ...rawArgs] = parsed;
  const entry = registry[cmd];
  if (!entry) return null;

  const { execPath, buildArgs = (args) => args } = entry;
  const args = buildArgs(rawArgs);
  if (!Array.isArray(args)) return null;
  if (args.some((arg) => arg.length > maxArgLength)) return null;

  return { execPath, args };
};

export default class AccessLogTailDispatcher {
  /**
   * @param {string} file access_log
   * @param {Record<string, CommandRegistryEntry>} commandRegistry
   * @param {DispatcherOptions} [opts]
   */
  constructor(file, commandRegistry, opts = {}) {
    this.file = file;
    this.registry = commandRegistry;

    const {
      spawnImpl = nodeSpawn,
      tail = new Tail(file, {
        alwaysStat: true,
        ignoreInitial: true,
        persistent: true,
      }),
      maxConcurrent = Infinity,
      minIntervalMs = 0,
      maxParts = 64,
      maxPartLength = 1024,
      maxArgLength = maxPartLength,
      maxPathLength = 8192,
    } = opts;

    this.spawnImpl = spawnImpl;
    this.tail = tail;
    this.maxConcurrent = maxConcurrent;
    this.minIntervalMs = minIntervalMs;
    this.maxParts = maxParts;
    this.maxPartLength = maxPartLength;
    this.maxArgLength = maxArgLength;
    this.maxPathLength = maxPathLength;
    this.activeCount = 0;
    this.lastExecAt = Number.NEGATIVE_INFINITY;
  }

  /**
   * Extract request path from a typical access log line.
   * More robust: parse "METHOD <url> HTTP/..."
   * @param {string} line
   * @returns {string} pathname like "/a/b"
   */
  extractPath(line) {
    // Find something like: GET /foo/bar HTTP/1.1
    const rawTarget = parseRequestTarget(line);
    return toSafePathname(rawTarget, this.maxPathLength);
  }

  /**
   * "/cmd/a/b" -> ["cmd","a","b"] (safe decode, size limits)
   * @param {string} pathname
   * @returns {string[]}
   */
  parseCommand(pathname) {
    return decodePathParts(pathname, this.maxParts, this.maxPartLength);
  }

  /**
   * Validate + build exec + args using registry
   * @param {string[]} parsed ["cmd", ...rawArgs]
   * @returns {{execPath:string,args:string[]}|null}
   */
  resolveExecution(parsed) {
    return resolveExecutionFromRegistry(parsed, this.registry, this.maxArgLength);
  }

  /**
   * Spawn a whitelisted command if concurrency/interval limits allow it.
   * @param {string} execPath
   * @param {string[]} args
   * @returns {void}
   */
  spawnCommand(execPath, args) {
    if (this.activeCount >= this.maxConcurrent) return;
    const now = Date.now();
    if (now - this.lastExecAt < this.minIntervalMs) return;

    const proc = this.spawnImpl(execPath, args, {
      shell: false,
      windowsHide: true,
      stdio: "inherit",
    });
    this.activeCount += 1;
    this.lastExecAt = now;
    const decrementActive = () => {
      this.activeCount = Math.max(0, this.activeCount - 1);
    };

    proc.on("error", (err) => {
      console.error("[spawn error]", err);
    });
    proc.on("close", decrementActive);
    proc.on("exit", decrementActive);
  }

  /** Start watching the access log for new lines. */
  run() {
    const handleLine = (line) => {
      const pathname = this.extractPath(line);
      const parsed = this.parseCommand(pathname);
      const exec = this.resolveExecution(parsed);
      if (!exec) return;

      this.spawnCommand(exec.execPath, exec.args);
    };

    this.tail.on("line", handleLine);
    this.tail.on("close", () => {
      console.log("watching stopped");
    });

    this.tail.watch();
  }

  stop() {
    try {
      this.tail.unwatch?.();
    } catch {}
  }
}
