import { spawn as nodeSpawn } from "node:child_process";
import Tail from "nodejs-tail";

/**
 * Safe, modern dispatcher:
 * - command is mapped to an absolute executable path (not user-provided)
 * - args are validated per-command
 * - rate limited
 * - process is sandboxed-ish (no shell, timeout, limited output)
 */
export default class AccessLogTailDispatcher {
  /**
   * @param {string} file access_log
   * @param {object} commandRegistry { [commandName]: { execPath: string, buildArgs: (rawArgs:string[])=>string[] } }
   * @param {object} [opts]
   */
  constructor(file, commandRegistry, opts = {}) {
    this.file = file;
    this.registry = commandRegistry;

    this.spawnImpl = opts.spawnImpl ?? nodeSpawn;
    this.tail = opts.tail
      ?? new Tail(file, {
        alwaysStat: true,
        ignoreInitial: true,
        persistent: true,
      });

    // Simple rate limit: max N executions per windowMs
    this.windowMs = opts.windowMs ?? 1000;
    this.maxPerWindow = opts.maxPerWindow ?? 5;
    this._windowStart = Date.now();
    this._countInWindow = 0;

    // Process limits
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxStdoutBytes = opts.maxStdoutBytes ?? 64 * 1024;
  }

  /**
   * Extract request path from a typical access log line.
   * More robust: parse "METHOD <url> HTTP/..."
   * @param {string} line
   * @returns {string} pathname like "/a/b"
   */
  extractPath(line) {
    if (typeof line !== "string" || line.length > 10_000) return "";

    // Find something like: GET /foo/bar HTTP/1.1
    const m = line.match(
      /\b(GET|POST|PUT|DELETE|HEAD|OPTIONS)\s+(\S+)\s+HTTP\/\d(?:\.\d)?\b/i,
    );
    if (!m) return "";

    const rawTarget = m[2];

    // rawTarget can be absolute URL or origin-form. Normalize via URL.
    // If it's origin-form "/x", give it a dummy base.
    let url;
    try {
      url = rawTarget.startsWith("/")
        ? new URL(rawTarget, "http://localhost")
        : new URL(rawTarget);
    } catch {
      return "";
    }

    // Only use pathname; ignore query/hash to reduce attack surface.
    return url.pathname || "";
  }

  /**
   * "/cmd/a/b" -> ["cmd","a","b"] (safe decode, size limits)
   * @param {string} pathname
   * @returns {string[]}
   */
  parseCommand(pathname) {
    if (typeof pathname !== "string" || pathname === "" || pathname.length > 2048) {
      return [];
    }
    if (!pathname.startsWith("/")) return [];

    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 0) return [];

    // Safe decode each segment; if decode fails, reject the whole request.
    const decoded = [];
    for (const p of parts) {
      if (p.length > 256) return [];
      try {
        decoded.push(decodeURIComponent(p));
      } catch {
        return [];
      }
    }
    return decoded;
  }

  /**
   * Basic rate limit to avoid log-triggered fork bombs.
   * @returns {boolean} allowed
   */
  allowByRateLimit() {
    const now = Date.now();
    if (now - this._windowStart >= this.windowMs) {
      this._windowStart = now;
      this._countInWindow = 0;
    }
    this._countInWindow += 1;
    return this._countInWindow <= this.maxPerWindow;
  }

  /**
   * Validate + build exec + args using registry
   * @param {string[]} parsed ["cmd", ...rawArgs]
   * @returns {{execPath:string,args:string[]}|null}
   */
  resolveExecution(parsed) {
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const [cmd, ...rawArgs] = parsed;

    const entry = this.registry[cmd];
    if (!entry) return null;

    // Build args via per-command validator
    let args;
    try {
      args = entry.buildArgs(rawArgs);
    } catch {
      return null;
    }
    if (!Array.isArray(args)) return null;

    return { execPath: entry.execPath, args };
  }

  /**
   * Spawn with limits
   * @param {string} execPath
   * @param {string[]} args
   */
  spawnLimited(execPath, args) {
    const proc = this.spawnImpl(execPath, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        // Minimal env is often safer; adjust as needed
        PATH: process.env.PATH ?? "",
      },
    });

    // Timeout
    const t = setTimeout(() => {
      proc.kill("SIGKILL");
    }, this.timeoutMs);
    proc.on("exit", () => clearTimeout(t));

    // Output limiting
    let outBytes = 0;
    proc.stdout.on("data", (buf) => {
      outBytes += buf.length;
      if (outBytes > this.maxStdoutBytes) {
        proc.kill("SIGKILL");
        return;
      }
      process.stdout.write(buf);
    });

    proc.stderr.on("data", (buf) => {
      process.stderr.write(buf);
    });

    proc.on("error", (err) => {
      console.error("[spawn error]", err);
    });
  }

  /**
   * Start watching
   */
  run() {
    this.tail.on("line", (line) => {
      if (!this.allowByRateLimit()) return;

      const pathname = this.extractPath(line);
      const parsed = this.parseCommand(pathname);
      const exec = this.resolveExecution(parsed);
      if (!exec) return;

      this.spawnLimited(exec.execPath, exec.args);
    });

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
