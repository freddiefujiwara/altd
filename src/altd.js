import { spawn as nodeSpawn } from "node:child_process";
import Tail from "nodejs-tail";

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
  }

  /**
   * Extract request path from a typical access log line.
   * More robust: parse "METHOD <url> HTTP/..."
   * @param {string} line
   * @returns {string} pathname like "/a/b"
   */
  extractPath(line) {
    if (typeof line !== "string") return "";

    // Find something like: GET /foo/bar HTTP/1.1
    const m = line.match(
      /\b(GET|POST|PUT|DELETE|HEAD|OPTIONS)\s+(\S+)\s+HTTP\/\d(?:\.\d)?\b/i,
    );
    if (!m) return "";

    const rawTarget = m[2];

    if (rawTarget.startsWith("http://") || rawTarget.startsWith("https://")) {
      try {
        return new URL(rawTarget).pathname || "";
      } catch {
        return "";
      }
    }

    return rawTarget;
  }

  /**
   * "/cmd/a/b" -> ["cmd","a","b"] (safe decode, size limits)
   * @param {string} pathname
   * @returns {string[]}
   */
  parseCommand(pathname) {
    if (typeof pathname !== "string" || pathname === "") return [];
    if (!pathname.startsWith("/")) return [];

    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 0) return [];

    const decoded = [];
    for (const p of parts) {
      try {
        decoded.push(decodeURIComponent(p));
      } catch {
        return [];
      }
    }
    return decoded;
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

    const buildArgs = entry.buildArgs ?? ((args) => args);
    const args = buildArgs(rawArgs);
    if (!Array.isArray(args)) return null;

    return { execPath: entry.execPath, args };
  }

  spawnCommand(execPath, args) {
    const proc = this.spawnImpl(execPath, args, {
      shell: false,
      windowsHide: true,
      stdio: "inherit",
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
      const pathname = this.extractPath(line);
      const parsed = this.parseCommand(pathname);
      const exec = this.resolveExecution(parsed);
      if (!exec) return;

      this.spawnCommand(exec.execPath, exec.args);
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
