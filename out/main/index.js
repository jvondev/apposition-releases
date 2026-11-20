"use strict";
const velopack = require("velopack");
const electron = require("electron");
const utils = require("@electron-toolkit/utils");
const path = require("path");
const fs = require("fs");
const child_process = require("child_process");
require("readline");
const Database = require("better-sqlite3");
const v8 = require("v8");
const util = require("util");
const https = require("https");
const crypto = require("crypto");
const os = require("os");
const Sentry = require("@sentry/electron/main");
const promises = require("fs/promises");
const http = require("http");
const server = require("@trpc/server");
const zod = require("zod");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const electron__namespace = /* @__PURE__ */ _interopNamespaceDefault(electron);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const Sentry__namespace = /* @__PURE__ */ _interopNamespaceDefault(Sentry);
const LOG_LEVEL_SEVERITY = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  INVARIANT: 60,
  FATAL: 70
};
const BENIGN_NOISE_PATTERNS = [
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,
  /Third-party cookie will be blocked/i,
  /DevTools listening on/i,
  /Autofill\.enable/i,
  /Autofocus processing was blocked/i,
  /%cElectron Security Warning/i,
  /cleanups created outside/i,
  /checkForUpdates/i,
  /Permissions-Policy header/i,
  /Feature-Policy header/i,
  /source-map.*404/i,
  /favicon\.ico.*404/i,
  /Failed to load resource.*net::ERR_FAILED/i,
  /\[Violation\]/i,
  /non-passive event listener/i
];
const SECRET_PATTERNS = [
  [/polar_[a-zA-Z0-9_-]{20,}/g, "polar_[REDACTED]"],
  [/fs_[a-zA-Z0-9_-]{16,}/g, "fs_[REDACTED]"],
  [/sk_[a-zA-Z0-9_-]{16,}/g, "sk_[REDACTED]"],
  [/pk_[a-zA-Z0-9_-]{16,}/g, "pk_[REDACTED]"],
  [
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
    "[UUID-KEY-REDACTED]"
  ],
  [/Bearer\s+[a-zA-Z0-9._~+\\/-]+=*/gi, "Bearer [REDACTED]"],
  [/password["']?\s*[:=]\s*["'][^"']+["']/gi, 'password: "[REDACTED]"'],
  [/token["']?\s*[:=]\s*["'][a-zA-Z0-9._~+\\/-]{16,}["']/gi, 'token: "[REDACTED]"']
];
class NoiseFilter {
  guestBuckets = /* @__PURE__ */ new Map();
  maxPerWindow = 30;
  windowMs = 1e3;
  isBenignNoise(msg) {
    if (!msg) return true;
    for (const pattern of BENIGN_NOISE_PATTERNS) {
      if (pattern.test(msg)) return true;
    }
    return false;
  }
  redactSecrets(raw) {
    if (!raw || typeof raw !== "string") return raw;
    let redacted = raw;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, replacement);
    }
    return redacted;
  }
  isRateLimited(key) {
    const now = Date.now();
    let bucket = this.guestBuckets.get(key);
    if (!bucket || now - bucket.lastReset > this.windowMs) {
      bucket = { count: 1, lastReset: now };
      this.guestBuckets.set(key, bucket);
      return false;
    }
    bucket.count++;
    return bucket.count > this.maxPerWindow;
  }
}
const defaultNoiseFilter = new NoiseFilter();
function cleanSourcePath(raw) {
  if (!raw) return void 0;
  let clean = raw.replace(/^https?:\/\/[^/]+\/@fs\//, "").replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "");
  const match = clean.match(/(?:src\/[^:]+|[^/]+\.[a-zA-Z0-9]+)$/);
  return match ? match[0] : clean;
}
function filterStackTrace(raw) {
  if (!raw || typeof raw !== "string") return raw;
  const lines = raw.split("\n");
  const filtered = lines.filter(
    (line) => !line.includes("node_modules") && !line.includes("node:electron") && !line.includes("node:internal")
  );
  return filtered.length > 0 ? filtered.join("\n") : lines.slice(0, 3).join("\n");
}
class LogFormatter {
  formatInteractive(entry) {
    const timeStr = `\x1B[90m${entry.isoTime.substring(11, 23)}\x1B[0m`;
    const domainText = entry.subsystem ? `[${entry.domain}:${entry.subsystem}]` : `[${entry.domain}]`;
    const domainTag = `\x1B[1m\x1B[37m${domainText}\x1B[0m`;
    let levelBadge = "";
    if (entry.level === "ERROR") {
      levelBadge = ` \x1B[1m\x1B[31mERROR\x1B[0m`;
    } else if (entry.level === "FATAL") {
      levelBadge = ` \x1B[1m\x1B[41m\x1B[37m FATAL \x1B[0m`;
    } else if (entry.level === "WARN") {
      levelBadge = ` \x1B[33mWARN\x1B[0m`;
    } else if (entry.level === "INVARIANT") {
      levelBadge = ` \x1B[1m\x1B[45m\x1B[37m INVARIANT \x1B[0m`;
    }
    let line = `${timeStr} ${domainTag}${levelBadge}: ${entry.message}`;
    if (entry.durationMs !== void 0) {
      if (entry.durationMs > 30) {
        line += ` \x1B[33m(SLOW: ${entry.durationMs.toFixed(1)}ms)\x1B[0m`;
      } else {
        line += ` \x1B[90m(${entry.durationMs.toFixed(1)}ms)\x1B[0m`;
      }
    }
    if (entry.correlationId) {
      line += ` \x1B[36m#${entry.correlationId}\x1B[0m`;
    }
    const cleanSrc = cleanSourcePath(entry.source?.file);
    if (cleanSrc) {
      line += ` \x1B[90m(${cleanSrc}${entry.source?.line ? `:${entry.source.line}` : ""})\x1B[0m`;
    }
    if (entry.details !== void 0) {
      let detailsStr = "";
      if (typeof entry.details === "string") {
        detailsStr = filterStackTrace(entry.details);
      } else if (typeof entry.details === "object") {
        detailsStr = JSON.stringify(entry.details);
      } else {
        detailsStr = String(entry.details);
      }
      line += ` \x1B[90m| ${detailsStr}\x1B[0m`;
    }
    return line;
  }
  formatCompactAi(entry) {
    const timeStr = entry.isoTime.substring(11, 19);
    const domain = entry.subsystem ? `${entry.domain}:${entry.subsystem}` : entry.domain;
    let out = `${timeStr} [${entry.level[0]}][${domain}] ${entry.message}`;
    if (entry.durationMs !== void 0) {
      out += ` ${entry.durationMs.toFixed(0)}ms`;
    }
    if (entry.correlationId) {
      out += ` #${entry.correlationId}`;
    }
    const cleanSrc = cleanSourcePath(entry.source?.file);
    if (cleanSrc) {
      out += ` (${cleanSrc}:${entry.source?.line || 0})`;
    }
    if (entry.details !== void 0) {
      out += ` :: ${JSON.stringify(entry.details)}`;
    }
    return out;
  }
  formatJson(entry) {
    return JSON.stringify(entry);
  }
}
const defaultFormatter = new LogFormatter();
class RingBuffer {
  buffer;
  pointer = 0;
  isFull = false;
  capacity;
  constructor(capacity = 500) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
  }
  push(entry) {
    this.buffer[this.pointer] = entry;
    this.pointer = (this.pointer + 1) % this.capacity;
    if (this.pointer === 0) {
      this.isFull = true;
    }
  }
  snapshot() {
    if (!this.isFull) {
      return this.buffer.slice(0, this.pointer).filter(Boolean);
    }
    const tail = this.buffer.slice(this.pointer).filter(Boolean);
    const head = this.buffer.slice(0, this.pointer).filter(Boolean);
    return [...tail, ...head];
  }
  getErrors() {
    return this.snapshot().filter(
      (e) => e.level === "ERROR" || e.level === "FATAL" || e.level === "INVARIANT"
    );
  }
  dumpSummary(limit = 20) {
    const recent = this.snapshot().slice(-limit);
    return recent.map(
      (e) => `[${e.isoTime.substring(11, 23)}] [${e.level}][${e.domain}] ${e.message}${e.correlationId ? ` #${e.correlationId}` : ""}`
    ).join("\n");
  }
  clear() {
    this.buffer.fill(null);
    this.pointer = 0;
    this.isFull = false;
  }
}
const flightRecorder = new RingBuffer(500);
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024;
class AsyncFileSink {
  stream = null;
  queue = [];
  flushTimer = null;
  filePath = null;
  isWriting = false;
  init(filePath) {
    try {
      this.filePath = filePath;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath);
          if (stats.size > MAX_LOG_SIZE_BYTES) {
            const oldPath = `${filePath}.old`;
            if (fs.existsSync(oldPath)) {
              fs.unlinkSync(oldPath);
            }
            fs.renameSync(filePath, oldPath);
          }
        } catch {
        }
      }
      this.stream = fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
      this.stream.on("error", () => {
        this.stream = null;
      });
      this.startTimer();
      const sessionHeader = `
--- [APPOSITION LOG SESSION START: ${(/* @__PURE__ */ new Date()).toISOString()}] (PID ${typeof process !== "undefined" ? process.pid : "N/A"}) ---
`;
      this.write(sessionHeader);
      if (typeof process !== "undefined") {
        process.on("exit", () => {
          this.close();
        });
      }
    } catch {
      this.stream = null;
    }
  }
  write(line) {
    this.queue.push(line + "\n");
    if (this.queue.length >= 50) {
      this.flush();
    }
  }
  startTimer() {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush();
    }, 500);
  }
  flush() {
    if (this.isWriting || !this.stream || this.queue.length === 0) return;
    this.isWriting = true;
    const batch = this.queue.join("");
    this.queue = [];
    try {
      this.stream.write(batch, () => {
        this.isWriting = false;
      });
    } catch {
      this.isWriting = false;
    }
  }
  close() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.stream) {
      if (this.queue.length > 0) {
        try {
          this.stream.write(this.queue.join(""));
        } catch {
        }
      }
      this.stream.end();
      this.stream = null;
    }
  }
}
const defaultFileSink = new AsyncFileSink();
class RuntimeStateManager {
  state;
  filePath = null;
  constructor() {
    const now = Date.now();
    this.state = {
      version: "1.1.3",
      pid: typeof process !== "undefined" ? process.pid : 0,
      startedAt: now,
      rssMb: "0.0",
      heapMb: "0.0",
      errorCount: 0,
      warningCount: 0,
      guestLogsMuted: true,
      lastUpdated: new Date(now).toISOString()
    };
  }
  init(filePath) {
    this.filePath = filePath;
    this.syncMetrics();
    this.persist();
  }
  setGuestLogsMuted(muted) {
    this.state.guestLogsMuted = muted;
    this.persist();
  }
  incrementError() {
    this.state.errorCount++;
    this.syncMetrics();
    this.persist();
  }
  incrementWarning() {
    this.state.warningCount++;
    this.syncMetrics();
    this.persist();
  }
  syncMetrics() {
    if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
      try {
        const mem = process.memoryUsage();
        this.state.rssMb = (mem.rss / 1024 / 1024).toFixed(1);
        this.state.heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
      } catch {
      }
    }
  }
  getState() {
    this.syncMetrics();
    return this.state;
  }
  persist() {
    if (!this.filePath) return;
    try {
      this.syncMetrics();
      this.state.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
    }
  }
}
const runtimeState = new RuntimeStateManager();
let globalCounter = 0;
class Logger {
  domain;
  options;
  constructor(domain = "MAIN", options = {}) {
    this.domain = domain;
    this.options = {
      minLevel: options.minLevel || "INFO",
      muteGuestInStdout: options.muteGuestInStdout ?? true,
      compactMode: options.compactMode ?? (typeof process !== "undefined" && (process.env?.AI_AGENT_MODE === "1" || process.env?.APPLY_AI_LOGS === "1")),
      enableRedaction: options.enableRedaction ?? true,
      enableFileSink: options.enableFileSink ?? true,
      filePath: options.filePath || ""
    };
  }
  setFileSink(filePath) {
    this.options.filePath = filePath;
    defaultFileSink.init(filePath);
  }
  lastEntryKey = "";
  repeatCount = 0;
  lastEntryTime = 0;
  log(level, message, details, subsystem, correlationId, durationMs, source) {
    let cleanMsg = message;
    if (this.options.enableRedaction) {
      cleanMsg = defaultNoiseFilter.redactSecrets(cleanMsg);
    }
    if (defaultNoiseFilter.isBenignNoise(cleanMsg)) {
      return;
    }
    if (this.domain === "GUEST" && defaultNoiseFilter.isRateLimited(subsystem || "guest")) {
      return;
    }
    const now = Date.now();
    const entryKey = `${this.domain}:${level}:${cleanMsg}`;
    if (entryKey === this.lastEntryKey && now - this.lastEntryTime < 1e3) {
      this.repeatCount++;
      return;
    }
    if (this.repeatCount > 0) {
      const repeats = this.repeatCount;
      this.repeatCount = 0;
      this.log("DEBUG", `(Previous message repeated ${repeats} times)`);
    }
    this.lastEntryKey = entryKey;
    this.lastEntryTime = now;
    const entry = {
      id: `${now}-${++globalCounter}`,
      timestamp: now,
      isoTime: new Date(now).toISOString(),
      level,
      domain: this.domain,
      subsystem,
      message: cleanMsg,
      details,
      correlationId,
      durationMs,
      source
    };
    flightRecorder.push(entry);
    if (level === "ERROR" || level === "FATAL" || level === "INVARIANT") {
      runtimeState.incrementError();
    } else if (level === "WARN") {
      runtimeState.incrementWarning();
    }
    if (this.options.enableFileSink) {
      defaultFileSink.write(defaultFormatter.formatJson(entry));
    }
    const entrySev = LOG_LEVEL_SEVERITY[level] || 0;
    const minSev = LOG_LEVEL_SEVERITY[this.options.minLevel] || 0;
    if (this.domain === "GUEST" && this.options.muteGuestInStdout && level !== "ERROR" && level !== "FATAL") {
      return;
    }
    if (entrySev >= minSev) {
      const output = this.options.compactMode ? defaultFormatter.formatCompactAi(entry) : defaultFormatter.formatInteractive(entry);
      if (level === "ERROR" || level === "FATAL" || level === "INVARIANT") {
        console.error(output);
      } else if (level === "WARN") {
        console.warn(output);
      } else {
        console.log(output);
      }
    }
  }
  trace(msg, details, sub, source) {
    this.log("TRACE", msg, details, sub, void 0, void 0, source);
  }
  debug(msg, details, sub, source) {
    this.log("DEBUG", msg, details, sub, void 0, void 0, source);
  }
  info(msg, details, sub, source) {
    this.log("INFO", msg, details, sub, void 0, void 0, source);
  }
  warn(msg, details, sub, source) {
    this.log("WARN", msg, details, sub, void 0, void 0, source);
  }
  error(msg, details, sub, source) {
    this.log("ERROR", msg, details, sub, void 0, void 0, source);
  }
  fatal(msg, details, sub, source) {
    this.log("FATAL", msg, details, sub, void 0, void 0, source);
  }
  invariant(condition, breachMsg, details, sub) {
    if (!condition) {
      this.log("INVARIANT", `[INVARIANT BREACH] ${breachMsg}`, details, sub);
    }
  }
  tx(name, correlationId, durationMs, error) {
    if (error) {
      this.log("ERROR", `[TX FAILED] ${name}`, error, "IPC", correlationId, durationMs);
    } else {
      this.log("INFO", `[TX OK] ${name}`, void 0, "IPC", correlationId, durationMs);
    }
  }
}
const logger$6 = new Logger("MAIN");
const createLogger = (domain, opts) => new Logger(domain, opts);
function printStartupBanner(version2 = "1.1.3", logFile = "apposition.log") {
  const isDev2 = typeof process !== "undefined" && process.env.NODE_ENV !== "production";
  if (!isDev2) return;
  console.log("");
  console.log("  \x1B[1m\x1B[37mApposition " + version2 + " (Development Environment)\x1B[0m");
  console.log("  \x1B[90mDatabase: Connected · Log File: " + logFile + " · Noise Filter: Active\x1B[0m");
  console.log("");
  console.log("  \x1B[1mTerminal Controls (Press single key):\x1B[0m");
  console.log("    \x1B[1m[e]\x1B[0m \x1B[37mShow Errors\x1B[0m        \x1B[90m- View only what failed (press [y] to copy)\x1B[0m");
  console.log("    \x1B[1m[w]\x1B[0m \x1B[37mShow Warnings\x1B[0m      \x1B[90m- View recent warnings without noisy spam\x1B[0m");
  console.log("    \x1B[1m[f]\x1B[0m \x1B[37mRecent Actions\x1B[0m     \x1B[90m- See action history right before a crash\x1B[0m");
  console.log("    \x1B[1m[s]\x1B[0m \x1B[37mSystem Health\x1B[0m      \x1B[90m- Check memory usage, uptime, and error counter\x1B[0m");
  console.log("    \x1B[1m[d]\x1B[0m \x1B[37mDatabase Health\x1B[0m    \x1B[90m- Check SQLite size, tables, and WAL status\x1B[0m");
  console.log("    \x1B[1m[r]\x1B[0m \x1B[37mSoft Reload\x1B[0m        \x1B[90m- Instantly reload window (<150ms)\x1B[0m");
  console.log("    \x1B[1m[t]\x1B[0m \x1B[37mToggle Tab Logs\x1B[0m    \x1B[90m- Mute/unmute external website chatter\x1B[0m");
  console.log("    \x1B[1m[o]\x1B[0m \x1B[37mOpen Log File\x1B[0m      \x1B[90m- Open apposition.log in your text editor\x1B[0m");
  console.log("    \x1B[1m[c]\x1B[0m \x1B[37mClean Screen\x1B[0m       \x1B[90m- Clear terminal display & scrollback\x1B[0m");
  console.log("    \x1B[1m[q]\x1B[0m \x1B[37mClean Quit\x1B[0m         \x1B[90m- Gracefully flush database and exit\x1B[0m");
  console.log("    \x1B[1m[?]\x1B[0m \x1B[37mHelp Menu\x1B[0m          \x1B[90m- Show all available keyboard shortcuts\x1B[0m");
  console.log("");
}
function executeCommand(key, logFilePath, toggleGuestCallback) {
  const lower = key.toLowerCase().trim();
  if (!lower) return;
  if (lower === "e") {
    const errors = flightRecorder.getErrors();
    console.log(`
\x1B[1m--- Recent Errors (${errors.length}) ---\x1B[0m`);
    if (errors.length === 0) {
      console.log("  \x1B[90mNo errors recorded in current session. All systems running cleanly.\x1B[0m\n");
    } else {
      for (const err of errors.slice(-10)) {
        console.log(`  ${defaultFormatter.formatInteractive(err)}`);
      }
      console.log("");
    }
  } else if (lower === "w") {
    const warns = flightRecorder.snapshot().filter((e) => e.level === "WARN");
    console.log(`
\x1B[1m--- Recent Warnings (${warns.length}) ---\x1B[0m`);
    if (warns.length === 0) {
      console.log("  \x1B[90mNo warnings in current session.\x1B[0m\n");
    } else {
      for (const w of warns.slice(-10)) {
        console.log(`  ${defaultFormatter.formatInteractive(w)}`);
      }
      console.log("");
    }
  } else if (lower === "f") {
    console.log("\n\x1B[1m--- Recent Actions History (Flight Recorder) ---\x1B[0m");
    const dump = flightRecorder.dumpSummary(15);
    console.log(dump || "  \x1B[90mAction buffer is empty.\x1B[0m");
    console.log("");
  } else if (lower === "s") {
    const state = runtimeState.getState();
    const uptimeSec = Math.floor((Date.now() - state.startedAt) / 1e3);
    const mins = Math.floor(uptimeSec / 60);
    const secs = uptimeSec % 60;
    console.log("\n\x1B[1m--- System Health & Diagnostics ---\x1B[0m");
    console.log(`  \x1B[37mRAM Usage:\x1B[0m ${state.rssMb} MB (Heap: ${state.heapMb} MB)`);
    console.log(`  \x1B[37mUptime:\x1B[0m ${mins}m ${secs}s (PID: ${state.pid})`);
    console.log(`  \x1B[37mErrors:\x1B[0m ${state.errorCount} | \x1B[37mWarnings:\x1B[0m ${state.warningCount}`);
    console.log(`  \x1B[37mExternal Tab Noise:\x1B[0m ${state.guestLogsMuted ? "MUTED" : "ACTIVE"}
`);
  } else if (lower === "o") {
    console.log(`
\x1B[90mOpening log file: ${logFilePath}\x1B[0m
`);
    const openCmd = process.platform === "win32" ? `start "" "${logFilePath}"` : process.platform === "darwin" ? `open "${logFilePath}"` : `xdg-open "${logFilePath}"`;
    child_process.exec(openCmd, () => {
    });
  } else if (lower === "c") {
    process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
    printStartupBanner("1.1.3", logFilePath);
  } else if (lower === "h" || lower === "?") {
    printStartupBanner("1.1.3", logFilePath);
  }
}
function initInteractiveTerminal(logFilePath = "apposition.log", toggleGuestCallback) {
  if (typeof process === "undefined" || !process.stdin) return;
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      const text = String(chunk);
      if (text === "" || text === "") {
        process.exit();
      }
      for (const char of text.trim()) {
        executeCommand(char, logFilePath, toggleGuestCallback);
      }
    });
  } catch {
  }
}
const NAVIGATOR_SHIELD_SCRIPT = String.raw`
(function() {
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true,
      enumerable: true
    });
  } catch {}

  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client Executable' }
        ],
        configurable: true,
        enumerable: true
      });
    }
  } catch {}

  try {
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
        enumerable: true
      });
    }
  } catch {}

  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return { startE: Date.now(), onloadT: Date.now(), pageT: performance.now(), tran: 15 };
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          commitLoadTime: Date.now() / 1000,
          connectionInfo: 'h2',
          finishDocumentLoadTime: Date.now() / 1000,
          finishLoadTime: Date.now() / 1000,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'h2',
          requestTime: Date.now() / 1000 - 0.16,
          startLoadTime: Date.now() / 1000 - 0.3,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true
        };
      };
    }
  } catch {}

  try {
    if (window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
      PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
    }
  } catch {}

  try {
    const promptPerms = new Set(['geolocation', 'camera', 'microphone', 'midi', 'idle-detection', 'storage-access', 'notifications']);
    if (window.Permissions && Permissions.prototype.query) {
      const origQuery = Permissions.prototype.query;
      Permissions.prototype.query = function(desc) {
        if (desc && promptPerms.has(desc.name)) {
          return Promise.resolve({ state: 'prompt', onchange: null });
        }
        return origQuery.call(this, desc);
      };
    }
  } catch {}

  try {
    const ua = navigator.userAgent || '';
    if (ua.includes('Electron') || ua.includes('Apposition')) {
      const cleanUa = ua
        .replace(/\s+Electron\/\S+/gi, '')
        .replace(/\s+Apposition\w*\/\S+/gi, '')
        .replace(/(\)\s+)\S+\s+(Chrome\/)/, '$1$2')
        .replace(/\s{2,}/g, ' ')
        .trim();
      try {
        Object.defineProperty(navigator, 'userAgent', {
          get: () => cleanUa,
          configurable: true,
          enumerable: true
        });
      } catch {}
      try {
        Object.defineProperty(navigator, 'appVersion', {
          get: () => cleanUa.replace(/^Mozilla\//, ''),
          configurable: true,
          enumerable: true
        });
      } catch {}
    }

    const isGoogleAuth =
      typeof location !== 'undefined' &&
      (location.hostname === 'accounts.google.com' ||
        location.hostname === 'accounts.youtube.com' ||
        (location.hostname.includes('google.com') &&
          (location.pathname.startsWith('/signin') ||
            location.pathname.startsWith('/o/oauth2') ||
            location.pathname.startsWith('/ServiceLogin') ||
            location.pathname.startsWith('/AccountChooser') ||
            location.pathname.startsWith('/v3/signin') ||
            location.pathname.startsWith('/gsi/'))) ||
        ua.includes('Firefox'));

    if (isGoogleAuth) {
      try {
        Object.defineProperty(navigator, 'userAgentData', {
          get: () => undefined,
          configurable: true,
          enumerable: false
        });
      } catch {}
      return;
    }

    const isMac = ua.includes('Macintosh') || ua.includes('Mac OS X');
    const isLinux = ua.includes('Linux');
    const platform = isMac ? 'macOS' : isLinux ? 'Linux' : 'Windows';
    const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
    const majorVersion = chromeMatch ? chromeMatch[1].split('.')[0] : '144';
    const brands = [
      { brand: 'Google Chrome', version: majorVersion },
      { brand: 'Chromium', version: majorVersion },
      { brand: 'Not/A)Brand', version: '24' }
    ];
    if (!navigator.userAgentData || !navigator.userAgentData.brands || !navigator.userAgentData.brands.some(b => b.brand === 'Google Chrome')) {
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands: brands,
          mobile: false,
          platform: platform,
          getHighEntropyValues: (hints) => Promise.resolve({
            brands: brands,
            mobile: false,
            platform: platform,
            platformVersion: isMac ? '15.0.0' : isLinux ? '6.5.0' : '10.0.0',
            architecture: 'x86',
            bitness: '64',
            model: ''
          })
        }),
        configurable: true
      });
    }
  } catch {}
})();
`;
const WEBRTC_SHIELD_SCRIPT = String.raw`
(function() {
  if (typeof window === 'undefined' || !window.RTCPeerConnection) return;

  const OrigPeerConnection = window.RTCPeerConnection;
  const privateIpRegex = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.)/;
  const ip4Regex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

  function getExitIp() {
    return (window.__apposition_geo__ && window.__apposition_geo__.ip) || null;
  }

  function sanitizeSdp(sdp) {
    if (typeof sdp !== 'string') return sdp;
    const exitIp = getExitIp();
    const lines = sdp.split('\n');
    const sanitized = [];

    for (let line of lines) {
      if (line.startsWith('a=candidate:')) {
        const parts = line.split(' ');
        // parts[4] is the candidate IP address
        const candIp = parts[4];
        const candType = parts[7]; // host, srflx, prflx, relay

        if (candIp && privateIpRegex.test(candIp)) {
          // Suppress private host IP candidates completely to prevent local network exposure
          continue;
        }

        if (exitIp && candType === 'srflx') {
          // Rewrite STUN candidate IP to match proxy exit IP
          parts[4] = exitIp;
          line = parts.join(' ');
        }
      } else if (line.startsWith('c=IN IP4 ')) {
        const ip = line.substring(9).trim();
        if (privateIpRegex.test(ip)) {
          line = 'c=IN IP4 ' + (exitIp || '0.0.0.0');
        }
      }
      sanitized.push(line);
    }
    return sanitized.join('\n');
  }

  function wrapCandidate(candidate) {
    if (!candidate || !candidate.candidate) return candidate;
    const exitIp = getExitIp();
    const str = candidate.candidate;
    const parts = str.split(' ');
    const candIp = parts[4];
    const candType = parts[7];

    if (candIp && privateIpRegex.test(candIp)) {
      return null;
    }

    if (exitIp && candType === 'srflx' && candIp !== exitIp) {
      parts[4] = exitIp;
      const newStr = parts.join(' ');
      try {
        return new RTCIceCandidate({
          candidate: newStr,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment
        });
      } catch {
        return candidate;
      }
    }
    return candidate;
  }

  function PatchedPeerConnection(config, constraints) {
    const pc = new OrigPeerConnection(config, constraints);

    const origCreateOffer = pc.createOffer.bind(pc);
    pc.createOffer = async function(options) {
      const offer = await origCreateOffer(options);
      if (offer && offer.sdp) {
        return { type: offer.type, sdp: sanitizeSdp(offer.sdp) };
      }
      return offer;
    };

    const origCreateAnswer = pc.createAnswer.bind(pc);
    pc.createAnswer = async function(options) {
      const answer = await origCreateAnswer(options);
      if (answer && answer.sdp) {
        return { type: answer.type, sdp: sanitizeSdp(answer.sdp) };
      }
      return answer;
    };

    const origSetLocalDescription = pc.setLocalDescription.bind(pc);
    pc.setLocalDescription = async function(desc) {
      if (desc && desc.sdp) {
        desc = { type: desc.type, sdp: sanitizeSdp(desc.sdp) };
      }
      return origSetLocalDescription(desc);
    };

    const origGetStats = pc.getStats.bind(pc);
    pc.getStats = async function(selector) {
      const report = await origGetStats(selector);
      const exitIp = getExitIp();
      const sanitizedReport = new Map();
      report.forEach((stat, key) => {
        if (stat.type === 'local-candidate' || stat.type === 'remote-candidate') {
          const cloned = { ...stat };
          if (cloned.ip && privateIpRegex.test(cloned.ip)) {
            cloned.ip = exitIp || '0.0.0.0';
            cloned.address = exitIp || '0.0.0.0';
          } else if (exitIp && cloned.candidateType === 'srflx') {
            cloned.ip = exitIp;
            cloned.address = exitIp;
          }
          sanitizedReport.set(key, cloned);
        } else {
          sanitizedReport.set(key, stat);
        }
      });
      return sanitizedReport;
    };

    const origAddEventListener = pc.addEventListener.bind(pc);
    pc.addEventListener = function(type, listener, options) {
      if (type === 'icecandidate') {
        const wrapped = function(event) {
          if (event && event.candidate) {
            const masked = wrapCandidate(event.candidate);
            if (!masked) return;
            Object.defineProperty(event, 'candidate', { value: masked, configurable: true });
          }
          return listener.call(this, event);
        };
        return origAddEventListener(type, wrapped, options);
      }
      return origAddEventListener(type, listener, options);
    };

    let onicecandidateHandler = null;
    Object.defineProperty(pc, 'onicecandidate', {
      get: () => onicecandidateHandler,
      set: (fn) => {
        if (!fn) {
          onicecandidateHandler = null;
          return;
        }
        onicecandidateHandler = function(event) {
          if (event && event.candidate) {
            const masked = wrapCandidate(event.candidate);
            if (!masked) return;
            Object.defineProperty(event, 'candidate', { value: masked, configurable: true });
          }
          return fn.call(this, event);
        };
      },
      configurable: true,
      enumerable: true
    });

    return pc;
  }

  PatchedPeerConnection.prototype = OrigPeerConnection.prototype;
  PatchedPeerConnection.generateCertificate = OrigPeerConnection.generateCertificate?.bind(OrigPeerConnection);

  try {
    Object.defineProperty(window, 'RTCPeerConnection', {
      value: PatchedPeerConnection,
      configurable: true,
      writable: true
    });
  } catch {}
})();
`;
const MEDIA_SHIELD_SCRIPT = String.raw`
(function() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;

  const origEnumerate = navigator.mediaDevices.enumerateDevices?.bind(navigator.mediaDevices);
  if (origEnumerate) {
    navigator.mediaDevices.enumerateDevices = async function() {
      try {
        const devices = await origEnumerate();
        // In standard unprompted Chrome, labels are strictly empty strings.
        // Return standard virtual devices with empty labels to block hardware fingerprinting.
        return devices.map((d, index) => ({
          deviceId: d.deviceId ? ('device_' + index) : '',
          kind: d.kind,
          label: '',
          groupId: d.groupId ? ('group_' + index) : '',
          toJSON: function() {
            return {
              deviceId: this.deviceId,
              kind: this.kind,
              label: this.label,
              groupId: this.groupId
            };
          }
        }));
      } catch (err) {
        return [];
      }
    };
  }

  // Sanitize AudioContext / OfflineAudioContext fingerprinting
  try {
    if (typeof AudioBuffer !== 'undefined' && AudioBuffer.prototype.getChannelData) {
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function(channel) {
        const data = origGetChannelData.call(this, channel);
        // Add subtle deterministic micro-jitter (1e-7) at rare intervals to break DAC fingerprinting
        for (let i = 0; i < data.length; i += 100) {
          data[i] = data[i] + 0.00000001;
        }
        return data;
      };
    }
  } catch {}
})();
`;
const GRAPHICS_SHIELD_SCRIPT = String.raw`
(function() {
  if (typeof window === 'undefined') return;

  function patchContext(proto) {
    if (!proto || !proto.getParameter) return;
    const origGetParameter = proto.getParameter;
    proto.getParameter = function(param) {
      // 0x9245: UNMASKED_VENDOR_WEBGL
      if (param === 0x9245) {
        return 'Google Inc. (NVIDIA)';
      }
      // 0x9246: UNMASKED_RENDERER_WEBGL
      if (param === 0x9246) {
        return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      }
      return origGetParameter.call(this, param);
    };
  }

  try {
    if (typeof WebGLRenderingContext !== 'undefined') {
      patchContext(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      patchContext(WebGL2RenderingContext.prototype);
    }
  } catch {}
})();
`;
const ANTI_DETECTION_SCRIPT = [
  NAVIGATOR_SHIELD_SCRIPT,
  WEBRTC_SHIELD_SCRIPT,
  MEDIA_SHIELD_SCRIPT,
  GRAPHICS_SHIELD_SCRIPT
].join("\n\n");
const DEFAULT_CHROME_VERSION$1 = "144.0.7550.80";
function getHostPlatformName() {
  if (typeof process !== "undefined" && process.platform) {
    if (process.platform === "darwin") return "macOS";
    if (process.platform === "linux") return "Linux";
  }
  return "Windows";
}
function getDefaultChromeUserAgent() {
  const chromeVersion = typeof process !== "undefined" && process.versions?.chrome && Number(process.versions.chrome.split(".")[0]) >= 144 ? process.versions.chrome : DEFAULT_CHROME_VERSION$1;
  const platform = getHostPlatformName();
  if (platform === "macOS") {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
  if (platform === "Linux") {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}
function generateClientHints$1(chromeVersion = DEFAULT_CHROME_VERSION$1, platform = getHostPlatformName()) {
  const major = chromeVersion.split(".")[0] || "144";
  const brand = "Google Chrome";
  const secChUa = `"${brand}";v="${major}", "Chromium";v="${major}", "Not/A)Brand";v="24"`;
  const secChUaFull = `"${brand}";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not/A)Brand";v="24.0.0.0"`;
  return {
    "sec-ch-ua": secChUa,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${platform}"`,
    "sec-ch-ua-full-version-list": secChUaFull
  };
}
({
  userAgent: getDefaultChromeUserAgent(),
  clientHints: generateClientHints$1()
});
const activeOAuthPopupIds = /* @__PURE__ */ new Set();
function registerOAuthPopup(webContentsId) {
  activeOAuthPopupIds.add(webContentsId);
}
function unregisterOAuthPopup(webContentsId) {
  activeOAuthPopupIds.delete(webContentsId);
}
function applyBrowserSwitches(app) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  app.userAgentFallback = getDefaultChromeUserAgent();
  app.commandLine.appendSwitch("lang", "en-US");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("max-active-webgl-contexts", "32");
  app.commandLine.appendSwitch("hide-scrollbars");
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=256 --optimize_for_size --expose-gc");
  app.commandLine.appendSwitch("renderer-process-limit", "6");
  app.commandLine.appendSwitch("disable-background-networking");
  app.commandLine.appendSwitch("process-per-site");
  if (process.platform === "darwin") {
    app.commandLine.appendSwitch("disable-skia-graphite");
  }
  if (process.platform === "linux") {
    app.commandLine.appendSwitch("ozone-platform-hint", "auto");
    app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");
  }
  app.commandLine.appendSwitch(
    "disable-features",
    "MediaRouter,WebAuthentication,WebAuthenticationConditionalUI,WebAuthenticationPermitLocalhost,FedCm,AiaFetching,AudioServiceOutOfProcess"
  );
  app.commandLine.appendSwitch(
    "disable-blink-features",
    "AutomationControlled,WebAuthentication,WebAuthenticationConditionalUI"
  );
  app.commandLine.appendSwitch(
    "force-webrtc-ip-handling-policy",
    "disable_non_proxied_udp"
  );
}
function initializeDatabaseSchema(db2) {
  db2.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      is_ephemeral INTEGER DEFAULT 0,
      proxy_server TEXT DEFAULT NULL,
      user_agent TEXT DEFAULT NULL,
      identities_json TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      name TEXT NOT NULL,
      order_idx INTEGER,
      layout_state TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      tab_id TEXT,
      type TEXT NOT NULL,
      profile_id TEXT,
      url TEXT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      is_hibernating INTEGER DEFAULT 0,
      is_ghost INTEGER DEFAULT 0,
      FOREIGN KEY(tab_id) REFERENCES tabs(id),
      FOREIGN KEY(profile_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS deleted_sessions (
      tab_id TEXT PRIMARY KEY,
      deleted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licensing (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS window_state (
      id TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      is_maximized INTEGER NOT NULL DEFAULT 0,
      is_fullscreen INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discovered_apps (
      domain TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      icon_url TEXT,
      theme_color TEXT,
      discovered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_id TEXT,
      layout_state TEXT NOT NULL,
      preview_apps TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS layout_split_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      apps_json TEXT NOT NULL,
      layout_state TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);
  applySchemaMigrations(db2);
}
function applySchemaMigrations(db2) {
  const migrations = [
    "ALTER TABLE tabs ADD COLUMN layout_state TEXT",
    "ALTER TABLE profiles ADD COLUMN is_ephemeral INTEGER DEFAULT 0",
    "ALTER TABLE profiles ADD COLUMN proxy_server TEXT DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN user_agent TEXT DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN identities_json TEXT DEFAULT NULL",
    "ALTER TABLE workspaces ADD COLUMN default_profile_id TEXT DEFAULT NULL REFERENCES profiles(id) ON DELETE SET NULL",
    "ALTER TABLE workspaces ADD COLUMN icon TEXT DEFAULT NULL",
    "ALTER TABLE tabs ADD COLUMN default_profile_id TEXT DEFAULT NULL REFERENCES profiles(id) ON DELETE SET NULL",
    "ALTER TABLE tabs ADD COLUMN custom_name TEXT DEFAULT NULL"
  ];
  for (const sql of migrations) {
    try {
      db2.exec(sql);
    } catch {
    }
  }
}
function getDbPath() {
  const isShowcase2 = process.env.APP_ENV === "showcase";
  const isolatedDir2 = process.env.APP_ISOLATED_DIR;
  const appData = electron.app.getPath("appData");
  if (isolatedDir2) {
    if (!fs.existsSync(isolatedDir2)) fs.mkdirSync(isolatedDir2, { recursive: true });
    if (fs.existsSync(path.join(isolatedDir2, "apposition_state_dev.db"))) {
      return path.join(isolatedDir2, "apposition_state_dev.db");
    }
    return path.join(isolatedDir2, "apposition_state_showcase.db");
  }
  if (isShowcase2) {
    const baseDir2 = path.join(appData, "AppositionShowcase");
    if (!fs.existsSync(baseDir2)) fs.mkdirSync(baseDir2, { recursive: true });
    return path.join(baseDir2, "apposition_state_showcase.db");
  }
  const isDevMode2 = utils.is.dev || electron.app.getName().includes("Dev") || process.env.APP_ENV === "dev";
  const baseDir = isDevMode2 ? path.join(appData, "AppositionDev") : electron.app.getPath("userData");
  const dbFileName = isDevMode2 ? "apposition_state_dev.db" : "apposition_state.db";
  const targetPath = path.join(baseDir, dbFileName);
  if (isDevMode2) {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    const legacyPath = path.join(appData, "apposition", dbFileName);
    if (fs.existsSync(legacyPath) && (!fs.existsSync(targetPath) || fs.statSync(targetPath).size === 0)) {
      try {
        fs.copyFileSync(legacyPath, targetPath);
      } catch {
      }
    }
  }
  return targetPath;
}
const dbPath = getDbPath();
function applyPragmas(instance) {
  try {
    try {
      instance.pragma("journal_mode = WAL");
    } catch {
      instance.pragma("journal_mode = DELETE");
    }
    instance.pragma("synchronous = NORMAL");
    instance.pragma("busy_timeout = 5000");
    try {
      instance.pragma("mmap_size = 268435456");
    } catch {
    }
    instance.pragma("temp_store = MEMORY");
    instance.pragma("cache_size = -64000");
    instance.prepare("SELECT 1;").get();
  } catch (e) {
    console.warn("[SQLite Pragmas] Falling back to standard journal:", e);
    try {
      instance.pragma("journal_mode = DELETE");
      instance.prepare("SELECT 1;").get();
    } catch (e2) {
      throw e2;
    }
  }
}
function initDatabase() {
  try {
    const instance = new Database(dbPath);
    applyPragmas(instance);
    initializeDatabaseSchema(instance);
    return instance;
  } catch (error) {
    console.error("[SQLite Error] Database failed to open, recovering:", error);
    if (fs.existsSync(dbPath)) {
      try {
        fs.renameSync(dbPath, `${dbPath}.corrupt.${Date.now()}`);
      } catch (backupError) {
        console.error("[SQLite Error] Failed to rename corrupt database:", backupError);
      }
    }
    try {
      const freshInstance = new Database(dbPath);
      applyPragmas(freshInstance);
      initializeDatabaseSchema(freshInstance);
      return freshInstance;
    } catch (fallbackErr) {
      console.error("[SQLite Fatal] Could not create disk DB, using in-memory fallback:", fallbackErr);
      const memInstance = new Database(":memory:");
      applyPragmas(memInstance);
      initializeDatabaseSchema(memInstance);
      return memInstance;
    }
  }
}
const db = initDatabase();
function closeDb() {
  try {
    db.close();
  } catch (e) {
  }
}
function getProfiles() {
  const count = db.prepare("SELECT COUNT(*) as c FROM profiles").get();
  if (count.c === 0) {
    createProfile("main", "Main", "#3b82f6");
  }
  return db.prepare("SELECT * FROM profiles ORDER BY name ASC").all();
}
function getProfileById(id) {
  return db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
}
function createProfile(id, name, color, is_ephemeral = false, proxy_server = null, user_agent = null) {
  db.prepare(
    "INSERT INTO profiles (id, name, color, is_ephemeral, proxy_server, user_agent) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name, color, is_ephemeral ? 1 : 0, proxy_server, user_agent);
}
function updateProfile(id, name, color, is_ephemeral = false, proxy_server = null, user_agent = null) {
  db.prepare(
    "UPDATE profiles SET name = ?, color = ?, is_ephemeral = ?, proxy_server = ?, user_agent = ? WHERE id = ?"
  ).run(name, color, is_ephemeral ? 1 : 0, proxy_server, user_agent, id);
}
function updateProfileIdentities(id, identities) {
  const jsonStr = typeof identities === "string" ? identities : JSON.stringify(identities);
  db.prepare("UPDATE profiles SET identities_json = ? WHERE id = ?").run(jsonStr, id);
}
function deleteProfile(id) {
  if (id === "main") throw new Error("Cannot delete main profile");
  db.prepare("UPDATE nodes SET profile_id = 'main' WHERE profile_id = ?").run(
    id
  );
  db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
}
function getNodes(tabId) {
  return db.prepare("SELECT * FROM nodes WHERE tab_id = ? AND is_ghost = 0").all(tabId);
}
function getNodesForTab(tabId) {
  return getNodes(tabId);
}
function saveNode(node) {
  db.prepare(
    `
    INSERT INTO nodes (id, tab_id, type, profile_id, url, x, y, width, height, is_hibernating, is_ghost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      tab_id = excluded.tab_id,
      type = excluded.type,
      profile_id = excluded.profile_id,
      url = excluded.url,
      x = excluded.x,
      y = excluded.y,
      width = excluded.width,
      height = excluded.height,
      is_hibernating = excluded.is_hibernating,
      is_ghost = excluded.is_ghost
  `
  ).run(
    node.id,
    node.tab_id,
    node.type,
    node.profile_id || "main",
    node.url || null,
    node.x,
    node.y,
    node.width,
    node.height,
    node.is_hibernating ? 1 : 0,
    node.is_ghost ? 1 : 0
  );
}
function deleteNode(id) {
  db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
}
function moveNodeToTab(nodeId, targetTabId) {
  db.prepare("UPDATE nodes SET tab_id = ? WHERE id = ?").run(
    targetTabId,
    nodeId
  );
}
function gcDeletedSessions() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1e3;
  db.prepare("DELETE FROM deleted_sessions WHERE deleted_at < ?").run(cutoff);
}
function getTabs(workspaceId) {
  return db.prepare("SELECT * FROM tabs WHERE workspace_id = ? ORDER BY order_idx ASC").all(workspaceId);
}
function createTab(id, workspaceId, name, customName = null) {
  const maxOrderRow = db.prepare("SELECT MAX(order_idx) as m FROM tabs WHERE workspace_id = ?").get(workspaceId);
  const maxOrder = maxOrderRow?.m || 0;
  db.prepare(
    "INSERT OR REPLACE INTO tabs (id, workspace_id, name, custom_name, order_idx) VALUES (?, ?, ?, ?, ?)"
  ).run(id, workspaceId, name, customName, maxOrder + 1);
}
function setTabDefaultProfile(id, profileId) {
  db.prepare("UPDATE tabs SET default_profile_id = ? WHERE id = ?").run(
    profileId,
    id
  );
}
function updatePaneProfilesForWorkspace(workspaceId, profileId) {
  db.prepare(
    `
    UPDATE nodes 
    SET profile_id = ? 
    WHERE tab_id IN (SELECT id FROM tabs WHERE workspace_id = ?) 
      AND type = 'web'
  `
  ).run(profileId || "main", workspaceId);
}
function updatePaneProfilesForTab(tabId, profileId) {
  db.prepare(
    `
    UPDATE nodes 
    SET profile_id = ? 
    WHERE tab_id = ? 
      AND type = 'web'
  `
  ).run(profileId || "main", tabId);
}
function updateTab(id, name, customName) {
  if (customName !== void 0) {
    db.prepare("UPDATE tabs SET name = ?, custom_name = ? WHERE id = ?").run(
      name,
      customName,
      id
    );
  } else {
    db.prepare("UPDATE tabs SET name = ? WHERE id = ?").run(name, id);
  }
}
function deleteTab(id) {
  const nodes = db.prepare("SELECT id FROM nodes WHERE tab_id = ?").all(id);
  for (const n of nodes) {
    deleteNode(n.id);
  }
  db.prepare("DELETE FROM tabs WHERE id = ?").run(id);
}
function saveTabLayout(tabId, layoutState) {
  db.prepare("UPDATE tabs SET layout_state = ? WHERE id = ?").run(
    layoutState,
    tabId
  );
}
function getAppMeta(key) {
  try {
    const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key);
    return row?.value || null;
  } catch (error) {
    console.error(`[AppMeta] Failed to get key ${key}:`, error);
    return null;
  }
}
function setAppMeta(key, value) {
  try {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(
      key,
      value
    );
  } catch (error) {
    console.error(`[AppMeta] Failed to set key ${key}:`, error);
  }
}
function getLastSeenVersion() {
  return getAppMeta("last_seen_version");
}
function setLastSeenVersion(version2) {
  setAppMeta("last_seen_version", version2.replace(/^v/, "").trim());
}
const NOTHING_SHOWCASE_PANES = [
  {
    id: "pane_nothing_github",
    url: "https://github.com/nk8bnj/nothing-technology",
    title: "Nothing Technology · GitHub"
  },
  {
    id: "pane_nothing_store",
    url: "https://nothing.tech/products/phone-4b",
    title: "phone ( 4b ) – Nothing Flagship"
  },
  {
    id: "pane_nothing_reddit",
    url: "https://www.reddit.com/r/NothingTech/",
    title: "r/NothingTech · Reddit"
  },
  {
    id: "pane_nothing_youtube",
    url: "https://www.youtube.com/@NothingTechnology?gl=US&hl=en",
    title: "Nothing – YouTube"
  }
];
function buildShowcaseLayoutState(panes2 = NOTHING_SHOWCASE_PANES) {
  const pGitHub = panes2[0];
  const pStore = panes2[1];
  const pReddit = panes2[2];
  const pYouTube = panes2[3];
  const nodes = {
    [pGitHub.id]: {
      id: pGitHub.id,
      type: "pane",
      paneType: "web",
      title: pGitHub.title,
      url: pGitHub.url,
      profileId: "main",
      canGoBack: false,
      canGoForward: false,
      history: [pGitHub.url],
      historyIndex: 0,
      scrollY: 0,
      mediaTime: 0,
      mediaDuration: 0
    },
    [pStore.id]: {
      id: pStore.id,
      type: "pane",
      paneType: "web",
      title: pStore.title,
      url: pStore.url,
      profileId: "main",
      canGoBack: false,
      canGoForward: false,
      history: [pStore.url],
      historyIndex: 0,
      scrollY: 0,
      mediaTime: 0,
      mediaDuration: 0
    },
    [pReddit.id]: {
      id: pReddit.id,
      type: "pane",
      paneType: "web",
      title: pReddit.title,
      url: pReddit.url,
      profileId: "main",
      canGoBack: false,
      canGoForward: false,
      history: [pReddit.url],
      historyIndex: 0,
      scrollY: 0,
      mediaTime: 0,
      mediaDuration: 0
    },
    [pYouTube.id]: {
      id: pYouTube.id,
      type: "pane",
      paneType: "web",
      title: pYouTube.title,
      url: pYouTube.url,
      profileId: "main",
      canGoBack: false,
      canGoForward: false,
      history: [pYouTube.url],
      historyIndex: 0,
      scrollY: 0,
      mediaTime: 0,
      mediaDuration: 0
    },
    // Left + Center Column: GitHub on left, Store in middle
    split_left_center: {
      id: "split_left_center",
      type: "split",
      direction: "horizontal",
      orientation: "horizontal",
      ratio: 0.5,
      a: pGitHub.id,
      b: pStore.id
    },
    // Right Column: Top = Reddit, Bottom = YouTube
    split_right: {
      id: "split_right",
      type: "split",
      direction: "vertical",
      orientation: "vertical",
      ratio: 0.5,
      a: pReddit.id,
      b: pYouTube.id
    },
    // Master Root: Left+Center (2 columns, 66.67%) vs Right (1 column, 33.33%)
    split_root: {
      id: "split_root",
      type: "split",
      direction: "horizontal",
      orientation: "horizontal",
      ratio: 2 / 3,
      a: "split_left_center",
      b: "split_right"
    }
  };
  return {
    nodes,
    rootId: "split_root",
    activePaneId: pStore.id
  };
}
function seedShowcaseWorkspace(db2) {
  const now = Date.now();
  db2.prepare(`
    INSERT OR IGNORE INTO profiles (id, name, color, is_ephemeral)
    VALUES ('main', 'Showcase', '#18181b', 0)
  `).run();
  const wsId = "ws_showcase";
  db2.prepare(`
    INSERT OR REPLACE INTO workspaces (id, name, icon, default_profile_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(wsId, "Market Intel", "search", "main", now);
  const layoutState = buildShowcaseLayoutState();
  const tabId = "tab_showcase_main";
  db2.prepare(`
    INSERT OR REPLACE INTO tabs (id, workspace_id, name, order_idx, default_profile_id, layout_state)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    tabId,
    wsId,
    "Nothing Tech",
    0,
    "main",
    JSON.stringify(layoutState)
  );
  db2.prepare(`
    INSERT OR REPLACE INTO window_state (id, x, y, width, height, is_maximized, is_fullscreen, updated_at)
    VALUES ('main', 0, 0, 1920, 1080, 1, 0, ?)
  `).run(now);
}
function getWorkspaces() {
  const count = db.prepare("SELECT COUNT(*) as c FROM workspaces").get();
  if (count.c === 0) {
    if (process.env.APP_ENV === "showcase") {
      seedShowcaseWorkspace(db);
    } else {
      createWorkspace("ws_main", "Home", "home");
    }
  }
  return db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC").all();
}
function createWorkspace(id, name, icon) {
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO workspaces (id, name, icon, created_at) VALUES (?, ?, ?, ?)"
  );
  stmt.run(id, name, icon || null, Date.now());
  createTab(`tab_${id}_main`, id, "Main");
}
function updateWorkspace(id, name, icon) {
  if (icon !== void 0) {
    db.prepare("UPDATE workspaces SET name = ?, icon = ? WHERE id = ?").run(
      name,
      icon,
      id
    );
  } else {
    db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name, id);
  }
}
function deleteWorkspace(id) {
  const deleteTx = db.transaction(() => {
    const tabs = db.prepare("SELECT id FROM tabs WHERE workspace_id = ?").all(id);
    for (const t2 of tabs) {
      deleteTab(t2.id);
    }
    db.prepare("DELETE FROM user_presets WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM layout_split_sessions WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  });
  deleteTx();
}
function setWorkspaceDefaultProfile(id, profileId) {
  db.prepare("UPDATE workspaces SET default_profile_id = ? WHERE id = ?").run(
    profileId,
    id
  );
}
function getInitialAppState(workspaceId) {
  try {
    const workspaces = getWorkspaces();
    const activeWsId = workspaceId || workspaces[0]?.id || "ws_main";
    let tabs = getTabs(activeWsId);
    if (!tabs || tabs.length === 0) {
      const defaultTabId = `tab_${activeWsId}_main`;
      createTab(defaultTabId, activeWsId, "Main");
      tabs = getTabs(activeWsId);
    }
    const storedUiMode = getAppMeta("ui_mode");
    const uiMode = storedUiMode === "overlap" || storedUiMode === "collapse" ? storedUiMode : "inset";
    return {
      workspaces,
      activeWorkspaceId: activeWsId,
      tabs,
      activeTabId: tabs[0]?.id || `tab_${activeWsId}_main`,
      uiMode
    };
  } catch (e) {
    console.error("Failed to get initial app state", e);
    return null;
  }
}
function initCommunicatorTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS communicator_stacks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📁',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS communicator_apps (
      id TEXT PRIMARY KEY,
      stack_id TEXT NOT NULL,
      profile_id TEXT NOT NULL DEFAULT 'main',
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'globe',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (stack_id) REFERENCES communicator_stacks(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET DEFAULT
    );

    CREATE TABLE IF NOT EXISTS communicator_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      default_url TEXT NOT NULL,
      icon TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'messaging'
    );
  `);
  seedDefaultCommunicatorData();
}
function seedDefaultCommunicatorData() {
  const mainProf = db.prepare("SELECT id FROM profiles WHERE id = 'main'").get();
  if (!mainProf) {
    db.prepare("INSERT INTO profiles (id, name, color) VALUES ('main', 'Main', '#3b82f6')").run();
  }
  const stackCount = db.prepare("SELECT COUNT(*) as c FROM communicator_stacks").get().c;
  if (stackCount === 0) {
    const now = Date.now();
    db.prepare("INSERT INTO communicator_stacks (id, name, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "main_stack",
      "Primary",
      "P",
      0,
      now
    );
    db.prepare(
      "INSERT INTO communicator_apps (id, stack_id, profile_id, name, url, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("gmail_main", "main_stack", "main", "Gmail", "https://mail.google.com", "gmail", 0, now);
    db.prepare(
      "INSERT INTO communicator_apps (id, stack_id, profile_id, name, url, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("slack_main", "main_stack", "main", "Slack", "https://app.slack.com/client", "slack", 1, now);
  }
  const provCount = db.prepare("SELECT COUNT(*) as c FROM communicator_providers").get().c;
  if (provCount === 0) {
    const defaultProviders = [
      { id: "slack", name: "Slack", default_url: "https://app.slack.com/client", icon: "slack", category: "messaging" },
      { id: "gmail", name: "Gmail", default_url: "https://mail.google.com", icon: "gmail", category: "email" },
      { id: "whatsapp", name: "WhatsApp", default_url: "https://web.whatsapp.com", icon: "whatsapp", category: "messaging" },
      { id: "telegram", name: "Telegram", default_url: "https://web.telegram.org", icon: "telegram", category: "messaging" },
      { id: "discord", name: "Discord", default_url: "https://discord.com/app", icon: "discord", category: "messaging" },
      { id: "linear", name: "Linear", default_url: "https://linear.app/inbox", icon: "linear", category: "productivity" },
      { id: "notion", name: "Notion", default_url: "https://www.notion.so", icon: "notion", category: "productivity" },
      { id: "github", name: "GitHub", default_url: "https://github.com/notifications", icon: "github", category: "dev" },
      { id: "teams", name: "Microsoft Teams", default_url: "https://teams.microsoft.com", icon: "teams", category: "messaging" },
      { id: "twitter", name: "X / Messages", default_url: "https://x.com/messages", icon: "twitter", category: "social" },
      { id: "chatgpt", name: "ChatGPT", default_url: "https://chatgpt.com", icon: "chatgpt", category: "ai" },
      { id: "claude", name: "Claude", default_url: "https://claude.ai", icon: "claude", category: "ai" }
    ];
    const insertProv = db.prepare(
      "INSERT INTO communicator_providers (id, name, default_url, icon, category) VALUES (?, ?, ?, ?, ?)"
    );
    for (const p of defaultProviders) {
      insertProv.run(p.id, p.name, p.default_url, p.icon, p.category);
    }
  }
}
function getCommunicatorState() {
  initCommunicatorTables();
  const stacks = db.prepare("SELECT * FROM communicator_stacks ORDER BY sort_order ASC, created_at ASC").all();
  const apps = db.prepare("SELECT * FROM communicator_apps ORDER BY sort_order ASC, created_at ASC").all();
  const providers = db.prepare("SELECT * FROM communicator_providers ORDER BY name ASC").all();
  const hydratedStacks = stacks.map((s) => ({
    id: s.id,
    name: s.name,
    icon: s.icon,
    apps: apps.filter((a) => a.stack_id === s.id).map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      icon: a.icon,
      profileId: a.profile_id,
      stackId: a.stack_id,
      unreadCount: 0
    }))
  }));
  return { stacks: hydratedStacks, providers };
}
function createCommunicatorStack(id, name, icon) {
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) as m FROM communicator_stacks").get().m;
  db.prepare("INSERT INTO communicator_stacks (id, name, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    name,
    icon,
    maxOrder + 1,
    Date.now()
  );
}
function updateCommunicatorStack(id, name, icon) {
  db.prepare("UPDATE communicator_stacks SET name = ?, icon = ? WHERE id = ?").run(name, icon, id);
}
function deleteCommunicatorStack(id) {
  db.prepare("DELETE FROM communicator_apps WHERE stack_id = ?").run(id);
  db.prepare("DELETE FROM communicator_stacks WHERE id = ?").run(id);
}
function createCommunicatorApp(id, stackId, profileId, name, url, icon) {
  let targetStackId = stackId;
  const stackRow = db.prepare("SELECT id FROM communicator_stacks WHERE id = ?").get(targetStackId);
  if (!stackRow) {
    const first = db.prepare("SELECT id FROM communicator_stacks ORDER BY sort_order ASC LIMIT 1").get();
    targetStackId = first ? first.id : "main_stack";
    if (!first) createCommunicatorStack("main_stack", "Primary", "P");
  }
  let targetProfileId = profileId || "main";
  const profileRow = db.prepare("SELECT id FROM profiles WHERE id = ?").get(targetProfileId);
  if (!profileRow) {
    const mainProf = db.prepare("SELECT id FROM profiles WHERE id = 'main'").get();
    if (!mainProf) db.prepare("INSERT INTO profiles (id, name, color) VALUES ('main', 'Main', '#3b82f6')").run();
    targetProfileId = "main";
  }
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) as m FROM communicator_apps WHERE stack_id = ?").get(targetStackId)?.m ?? 0;
  db.prepare(
    "INSERT INTO communicator_apps (id, stack_id, profile_id, name, url, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, targetStackId, targetProfileId, name, url, icon || "globe", maxOrder + 1, Date.now());
}
function updateCommunicatorApp(id, updates) {
  const current = db.prepare("SELECT * FROM communicator_apps WHERE id = ?").get(id);
  if (!current) return;
  const name = updates.name ?? current.name;
  const url = updates.url ?? current.url;
  const icon = updates.icon ?? current.icon;
  let profileId = updates.profileId ?? current.profile_id;
  if (updates.profileId && !db.prepare("SELECT id FROM profiles WHERE id = ?").get(profileId)) {
    profileId = current.profile_id;
  }
  let stackId = updates.stackId ?? current.stack_id;
  if (updates.stackId && !db.prepare("SELECT id FROM communicator_stacks WHERE id = ?").get(stackId)) {
    stackId = current.stack_id;
  }
  db.prepare("UPDATE communicator_apps SET name = ?, url = ?, icon = ?, profile_id = ?, stack_id = ? WHERE id = ?").run(
    name,
    url,
    icon,
    profileId,
    stackId,
    id
  );
}
function deleteCommunicatorApp(id) {
  db.prepare("DELETE FROM communicator_apps WHERE id = ?").run(id);
}
function saveCommunicatorProvider(provider) {
  db.prepare(
    "INSERT OR REPLACE INTO communicator_providers (id, name, default_url, icon, category) VALUES (?, ?, ?, ?, ?)"
  ).run(provider.id, provider.name, provider.default_url, provider.icon, provider.category || "custom");
}
function deleteCommunicatorProvider(id) {
  db.prepare("DELETE FROM communicator_providers WHERE id = ?").run(id);
}
function getSavedWindowState(id = "main") {
  if (!db || !db.open) return null;
  try {
    const row = db.prepare(
      "SELECT id, x, y, width, height, is_maximized, is_fullscreen, updated_at FROM window_state WHERE id = ?"
    ).get(id);
    if (!row) return null;
    return {
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      isMaximized: Boolean(row.is_maximized),
      isFullScreen: Boolean(row.is_fullscreen)
    };
  } catch (err) {
    console.error("[WindowState DB] Failed to query window state:", err);
    return null;
  }
}
function saveWindowState(state, id = "main") {
  if (!db || !db.open) return;
  try {
    const stmt = db.prepare(`
      INSERT INTO window_state (id, x, y, width, height, is_maximized, is_fullscreen, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        x = excluded.x,
        y = excluded.y,
        width = excluded.width,
        height = excluded.height,
        is_maximized = excluded.is_maximized,
        is_fullscreen = excluded.is_fullscreen,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      id,
      Math.round(state.x),
      Math.round(state.y),
      Math.round(state.width),
      Math.round(state.height),
      state.isMaximized ? 1 : 0,
      state.isFullScreen ? 1 : 0,
      Date.now()
    );
  } catch (err) {
    console.error("[WindowState DB] Failed to persist window state:", err);
  }
}
function saveDiscoveredApp(app) {
  try {
    const stmt = db.prepare(`
      INSERT INTO discovered_apps (domain, name, url, icon_url, theme_color, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        icon_url = COALESCE(excluded.icon_url, discovered_apps.icon_url),
        theme_color = COALESCE(excluded.theme_color, discovered_apps.theme_color),
        discovered_at = excluded.discovered_at
    `);
    stmt.run(
      app.domain,
      app.name,
      app.url,
      app.iconUrl || null,
      app.themeColor || null,
      app.discoveredAt || Date.now()
    );
  } catch (err) {
    console.error("[DB Catalog] Failed to save discovered app:", err);
  }
}
function getDiscoveredApps() {
  try {
    const stmt = db.prepare(`
      SELECT domain, name, url, icon_url as iconUrl, theme_color as themeColor, discovered_at as discoveredAt
      FROM discovered_apps
      ORDER BY discovered_at DESC
      LIMIT 100
    `);
    return stmt.all();
  } catch (err) {
    console.error("[DB Catalog] Failed to get discovered apps:", err);
    return [];
  }
}
function deleteDiscoveredApp(domain) {
  try {
    const stmt = db.prepare("DELETE FROM discovered_apps WHERE domain = ?");
    stmt.run(domain);
  } catch (err) {
    console.error("[DB Catalog] Failed to delete discovered app:", err);
  }
}
function saveUserPreset(preset) {
  try {
    const stmt = db.prepare(`
      INSERT INTO user_presets (id, name, workspace_id, layout_state, preview_apps, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        layout_state = excluded.layout_state,
        preview_apps = excluded.preview_apps,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      preset.id,
      preset.name,
      preset.workspaceId || null,
      preset.layoutState,
      JSON.stringify(preset.previewApps || []),
      preset.createdAt || Date.now(),
      preset.updatedAt || Date.now()
    );
  } catch (err) {
    console.error("[DB Catalog] Failed to save user preset:", err);
  }
}
function getUserPresets(workspaceId) {
  try {
    const query = workspaceId ? "SELECT * FROM user_presets WHERE workspace_id IS NULL OR workspace_id = ? ORDER BY updated_at DESC" : "SELECT * FROM user_presets ORDER BY updated_at DESC";
    const stmt = db.prepare(query);
    const rows = workspaceId ? stmt.all(workspaceId) : stmt.all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      workspaceId: r.workspace_id,
      layoutState: r.layout_state,
      previewApps: JSON.parse(r.preview_apps || "[]"),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  } catch (err) {
    console.error("[DB Catalog] Failed to get user presets:", err);
    return [];
  }
}
function deleteUserPreset(id) {
  try {
    const stmt = db.prepare("DELETE FROM user_presets WHERE id = ?");
    stmt.run(id);
  } catch (err) {
    console.error("[DB Catalog] Failed to delete user preset:", err);
  }
}
function recordSplitSession(session) {
  try {
    const stmt = db.prepare(`
      INSERT INTO layout_split_sessions (id, workspace_id, apps_json, layout_state, timestamp)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        apps_json = excluded.apps_json,
        layout_state = excluded.layout_state,
        timestamp = excluded.timestamp
    `);
    stmt.run(
      session.id,
      session.workspaceId,
      JSON.stringify(session.apps || []),
      session.layoutState,
      session.timestamp || Date.now()
    );
  } catch (err) {
    console.error("[DB Catalog] Failed to record split session:", err);
  }
}
function getLastSplitSession(workspaceId) {
  try {
    const stmt = db.prepare(`
      SELECT id, workspace_id as workspaceId, apps_json as appsJson, layout_state as layoutState, timestamp
      FROM layout_split_sessions
      WHERE workspace_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    const row = stmt.get(workspaceId);
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      apps: JSON.parse(row.appsJson || "[]"),
      layoutState: row.layoutState,
      timestamp: row.timestamp
    };
  } catch (err) {
    console.error("[DB Catalog] Failed to get last split session:", err);
    return null;
  }
}
class ViewRegistryImpl {
  activeViews = /* @__PURE__ */ new Map();
  webContentsIdToPaneId = /* @__PURE__ */ new Map();
  viewProfiles = /* @__PURE__ */ new Map();
  stashedBounds = /* @__PURE__ */ new Map();
  hibernatedViews = /* @__PURE__ */ new Map();
  getView(paneId) {
    return this.activeViews.get(paneId);
  }
  hasView(paneId) {
    return this.activeViews.has(paneId);
  }
  registerView(paneId, view, profileId) {
    this.activeViews.set(paneId, view);
    this.webContentsIdToPaneId.set(view.webContents.id, paneId);
    this.viewProfiles.set(paneId, profileId);
  }
  unregisterView(paneId, keepHibernated = false) {
    const view = this.activeViews.get(paneId);
    if (view) {
      this.webContentsIdToPaneId.delete(view.webContents.id);
      this.activeViews.delete(paneId);
      if (!keepHibernated) {
        this.viewProfiles.delete(paneId);
        this.stashedBounds.delete(paneId);
        this.hibernatedViews.delete(paneId);
      }
    }
    return view;
  }
  getPaneIdByWebContentsId(wcId) {
    return this.webContentsIdToPaneId.get(wcId);
  }
  getProfile(paneId) {
    return this.viewProfiles.get(paneId);
  }
  setProfile(paneId, profileId) {
    this.viewProfiles.set(paneId, profileId);
  }
  stashBounds(paneId, bounds) {
    this.stashedBounds.set(paneId, bounds);
  }
  getStashedBounds(paneId) {
    return this.stashedBounds.get(paneId);
  }
  setHibernated(paneId, data) {
    this.hibernatedViews.set(paneId, data);
  }
  getHibernated(paneId) {
    return this.hibernatedViews.get(paneId);
  }
  isHibernated(paneId) {
    return this.hibernatedViews.has(paneId);
  }
  deleteHibernated(paneId) {
    this.hibernatedViews.delete(paneId);
  }
  getAllActiveViews() {
    return this.activeViews;
  }
}
const viewRegistry = new ViewRegistryImpl();
const activeViews = viewRegistry.activeViews;
viewRegistry.webContentsIdToPaneId;
const viewProfile = viewRegistry.viewProfiles;
viewRegistry.stashedBounds;
viewRegistry.hibernatedViews;
function destroyAllViews() {
  for (const [paneId, view] of Array.from(viewRegistry.activeViews.entries())) {
    try {
      viewRegistry.unregisterView(paneId);
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    } catch {
    }
  }
}
const FREE_CAPABILITIES = Object.freeze({
  tier: "free",
  maxWorkspaces: 5,
  maxTabsPerWorkspace: Infinity,
  maxActiveProfiles: 2,
  maxFloatingPanes: 1,
  allowProxy: false,
  allowCustomUa: false,
  autoTabHibernation: false,
  autoSessionRestore: false,
  maxDeviceSeats: 1,
  dualDeviceSeats: false
});
const TIER_1_CAPABILITIES = Object.freeze({
  tier: "tier1",
  maxWorkspaces: Infinity,
  maxTabsPerWorkspace: Infinity,
  maxActiveProfiles: 2,
  maxFloatingPanes: 1,
  allowProxy: false,
  allowCustomUa: false,
  autoTabHibernation: true,
  autoSessionRestore: false,
  maxDeviceSeats: 1,
  dualDeviceSeats: false
});
const TIER_2_CAPABILITIES = Object.freeze({
  tier: "tier2",
  maxWorkspaces: Infinity,
  maxTabsPerWorkspace: Infinity,
  maxActiveProfiles: Infinity,
  maxFloatingPanes: Infinity,
  allowProxy: false,
  allowCustomUa: true,
  autoTabHibernation: true,
  autoSessionRestore: true,
  maxDeviceSeats: 2,
  dualDeviceSeats: true
});
const TIER_3_CAPABILITIES = Object.freeze({
  tier: "tier3",
  maxWorkspaces: Infinity,
  maxTabsPerWorkspace: Infinity,
  maxActiveProfiles: Infinity,
  maxFloatingPanes: Infinity,
  allowProxy: true,
  allowCustomUa: true,
  autoTabHibernation: true,
  autoSessionRestore: true,
  maxDeviceSeats: 5,
  dualDeviceSeats: true
});
function toPhysicalRect(r, dpr) {
  return {
    x: Math.round(r.x * dpr),
    y: Math.round(r.y * dpr),
    width: Math.round(r.width * dpr),
    height: Math.round(r.height * dpr)
  };
}
function isValidPhysicalRect(r) {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height) && r.width >= 0 && r.height >= 0 && r.width < 1e5 && r.height < 1e5 && r.x > -1e5 && r.y > -1e5;
}
const IPC_CHANNELS = {
  DB: {
    GET_INITIAL_STATE: "db.getInitialAppState",
    GET_WORKSPACES: "db.getWorkspaces",
    CREATE_WORKSPACE: "db.createWorkspace",
    UPDATE_WORKSPACE: "db.updateWorkspace",
    DELETE_WORKSPACE: "db.deleteWorkspace",
    SET_WORKSPACE_DEFAULT_PROFILE: "db.setWorkspaceDefaultProfile",
    SET_TAB_DEFAULT_PROFILE: "db.setTabDefaultProfile",
    UPDATE_PANE_PROFILES_FOR_WORKSPACE: "db.updatePaneProfilesForWorkspace",
    UPDATE_PANE_PROFILES_FOR_TAB: "db.updatePaneProfilesForTab",
    GET_TABS: "db.getTabs",
    CREATE_TAB: "db.createTab",
    UPDATE_TAB: "db.updateTab",
    DELETE_TAB: "db.deleteTab",
    MOVE_NODE_TO_TAB: "db.moveNodeToTab",
    GET_PROFILES: "db.getProfiles",
    CREATE_PROFILE: "db.createProfile",
    UPDATE_PROFILE: "db.updateProfile",
    DELETE_PROFILE: "db.deleteProfile",
    GET_NODES: "db.getNodes",
    SAVE_NODE: "db.saveNode",
    DELETE_NODE: "db.deleteNode",
    SAVE_TAB_LAYOUT: "db.saveTabLayout",
    SET_UI_MODE: "db.setUiMode"
  },
  WINDOW: {
    MINIMIZE: "window.minimize",
    MAXIMIZE: "window.maximize",
    CLOSE: "window.close",
    TOGGLE_FULLSCREEN: "window.toggle-fullscreen",
    SET_FULLSCREEN: "window.set-fullscreen",
    IS_FULLSCREEN: "window.is-fullscreen",
    OPEN_INTERNAL_DEVTOOLS: "app.openInternalDevTools",
    CLOSE_INTERNAL_DEVTOOLS: "app.closeInternalDevTools"
  },
  VIEW: {
    RELOAD: "view.reload",
    CAPTURE_FULL_PAGE: "view.captureFullPage",
    CAPTURE_VIEWPORT: "view.captureViewport",
    REGISTER_WEB_CONTENTS: "view.registerWebContents",
    CREATE_PANE: "view.createPane",
    SET_BOUNDS: "view.setBounds",
    DESTROY_PANE: "view.destroyPane",
    NAVIGATE: "view.navigate",
    FOCUS: "view.focusPane",
    SET_AUDIO_MUTED: "view.setAudioMuted",
    SET_DEVICE_EMULATION: "view.setDeviceEmulation",
    SET_NETWORK_THROTTLE: "view.setNetworkThrottle",
    EXTRACT_READER_MODE: "view.extractReaderMode",
    PICK_COLOR: "view.pickColor",
    COPY_IMAGE: "view.copyImage",
    GO_BACK: "view.goBack",
    GO_FORWARD: "view.goForward",
    GO_TO_INDEX: "view.goToIndex",
    GET_NAV_HISTORY: "view.getNavHistory"
  },
  SEARCH: {
    FIND_IN_ALL_PANES: "search.findInAllPanes",
    STOP_FIND: "search.stopFind"
  },
  CATALOG: {
    GET_DISCOVERED: "catalog.getDiscovered",
    SAVE_DISCOVERED: "catalog.saveDiscovered",
    DELETE_DISCOVERED: "catalog.deleteDiscovered",
    SAVE_USER_PRESET: "catalog.saveUserPreset",
    GET_USER_PRESETS: "catalog.getUserPresets",
    DELETE_USER_PRESET: "catalog.deleteUserPreset",
    RECORD_SPLIT_SESSION: "catalog.recordSplitSession",
    GET_LAST_SPLIT_SESSION: "catalog.getLastSplitSession"
  },
  MEMORY: {
    GET_STATS: "memory.getStats",
    SUSPEND_PANE: "memory.suspendPane",
    RESUME_PANE: "memory.resumePane"
  },
  OVERLAY: {
    FORWARD_POINTER: "overlay.forwardPointer",
    CURSOR: "overlay.cursor",
    SHOW: "overlay.show",
    INTENT: "overlay.intent"
  },
  LICENSING: {
    ACTIVATE: "licensing.activate",
    VALIDATE: "licensing.validate",
    DEACTIVATE: "licensing.deactivate",
    GET_KEY: "licensing.getKey",
    GET_STATE: "licensing.getState",
    CHECK_PREMIUM: "licensing.checkPremium",
    GET_CAPABILITIES: "licensing.getCapabilities",
    IS_DEV: "licensing.isDev",
    GET_CHECKOUT_URL: "licensing.getCheckoutUrl",
    SAVE_ATTRIBUTION: "licensing.saveAttribution"
  },
  CHANGELOG: {
    GET_STATUS: "changelog.getStatus",
    MARK_SEEN: "changelog.markSeen",
    GET_RELEASES: "changelog.getReleases"
  },
  AUTH: {
    CLEAR_SITE_DATA: "auth.clearSiteData",
    START_RELAY: "auth.startRelay",
    OPEN_GOOGLE_AUTH: "auth.openGoogleAuth",
    CONNECT_ACCOUNT: "auth.connectAccount",
    DISCONNECT_ACCOUNT: "auth.disconnectAccount",
    SCAN_IDENTITIES: "auth.scanIdentities",
    EXPORT_VAULT: "vault.exportSession",
    IMPORT_VAULT: "vault.importSession"
  },
  UPDATER: {
    CHECK: "updater.check",
    DOWNLOAD: "updater.download",
    APPLY: "updater.apply",
    GET_STATE: "updater.getState",
    OPEN_EXTERNAL: "updater.openExternal"
  },
  EVENTS: {
    UPDATE_STATE_CHANGED: "app:update-state-changed",
    VIEW_NAVIGATED: "view.navigated",
    VIEW_MEDIA_STATUS: "view.media-status",
    VIEW_CRASHED: "view.crashed",
    PROFILES_UPDATED: "app.profiles-updated",
    CONTEXT_MENU_SHOW: "view.context-menu-show",
    CONTEXT_MENU_DISMISS: "view.context-menu-dismiss",
    VIEW_LOADED: "view.loaded",
    PANE_FIRST_PAINT: "pane.first-paint"
  }
};
function normalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `${u.protocol}//${u.host}${pathname}${u.search}${u.hash}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}
function isCanonicalSameUrl(a, b) {
  if (!a || !b) return a === b;
  if (a === b) return true;
  const normA = normalizeUrl(a);
  const normB = normalizeUrl(b);
  if (normA === normB) return true;
  const stripSchemeAndWww = (u) => u.replace(/^https?:\/\/(?:www\.)?/i, "").toLowerCase();
  return stripSchemeAndWww(normA) === stripSchemeAndWww(normB);
}
const SENSITIVE_QUERY_REGEX = /(token|auth|key|secret|password|session|code|client_secret)=([^&\s]+)/gi;
const BEARER_REGEX = /Bearer\s+([A-Za-z0-9\-._~+/]+=*)/gi;
const USER_PATH_REGEX = /(?:[a-zA-Z]:)?(?:[\\/])Users(?:[\\/])[^\\/\s"':]+/gi;
const UNIX_USER_PATH_REGEX = /(?:\/home|\/Users)\/[^\\/\s"':]+/gi;
const REPO_ROOT_REGEX = /[a-zA-Z]:[\\/][^\\/]+[\\/]apposition/gi;
function sanitizeStringForOpsec(input) {
  if (!input || typeof input !== "string") return "";
  return input.replace(SENSITIVE_QUERY_REGEX, "$1=[REDACTED]").replace(BEARER_REGEX, "Bearer [REDACTED]").replace(USER_PATH_REGEX, "[USER_DIR]").replace(UNIX_USER_PATH_REGEX, "[USER_DIR]").replace(REPO_ROOT_REGEX, "[APP_ROOT]");
}
function sanitizeSentryEvent(event) {
  if (!event) return event;
  if (event.exception?.values) {
    for (const val of event.exception.values) {
      if (val.value) val.value = sanitizeStringForOpsec(val.value);
      if (val.stacktrace?.frames) {
        for (const frame of val.stacktrace.frames) {
          if (frame.filename) frame.filename = sanitizeStringForOpsec(frame.filename);
        }
      }
    }
  }
  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (b.message) b.message = sanitizeStringForOpsec(b.message);
      if (b.data && typeof b.data === "object") {
        try {
          const stringified = sanitizeStringForOpsec(JSON.stringify(b.data));
          b.data = JSON.parse(stringified);
        } catch {
        }
      }
    }
  }
  return event;
}
function compareSemver(a, b) {
  const cleanA = a.replace(/^v/, "").trim();
  const cleanB = b.replace(/^v/, "").trim();
  const partsA = cleanA.split(".").map((p) => parseInt(p, 10) || 0);
  const partsB = cleanB.split(".").map((p) => parseInt(p, 10) || 0);
  const maxLen = Math.max(partsA.length, partsB.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const valA = partsA[i] || 0;
    const valB = partsB[i] || 0;
    if (valA !== valB) return valA - valB;
  }
  return 0;
}
function evaluateUpgradeState(lastSeenVersion, currentVersion) {
  const cleanCurrent = currentVersion.replace(/^v/, "").trim();
  if (!lastSeenVersion) {
    return {
      shouldShowWhatsNew: false,
      nextVersionToCommit: cleanCurrent,
      isFreshInstall: true
    };
  }
  const cleanLastSeen = lastSeenVersion.replace(/^v/, "").trim();
  const diff = compareSemver(cleanLastSeen, cleanCurrent);
  if (diff < 0) {
    return {
      shouldShowWhatsNew: true,
      nextVersionToCommit: cleanCurrent,
      isFreshInstall: false
    };
  }
  return {
    shouldShowWhatsNew: false,
    nextVersionToCommit: cleanLastSeen,
    isFreshInstall: false
  };
}
function isConsecutiveRightClick(current, lastYield, now, maxDelayMs = 1500, maxDistancePx = 160) {
  if (!lastYield) return false;
  if (lastYield.paneId !== current.paneId) return false;
  const dt = now - lastYield.timestamp;
  if (dt < 0 || dt > maxDelayMs) return false;
  const dist = Math.hypot(current.x - lastYield.x, current.y - lastYield.y);
  return dist <= maxDistancePx;
}
const initialContextMenuState = {
  status: "IDLE",
  requestId: 0,
  x: 0,
  y: 0,
  paneId: "",
  url: "",
  data: { x: 0, y: 0, paneId: "" },
  shiftKey: false,
  yieldRecord: null
};
function openFull(x, y, paneId, url, data, requestId, shiftKey = false) {
  const next = {
    status: "OPEN_FULL",
    requestId,
    x,
    y,
    paneId,
    url,
    data,
    shiftKey,
    yieldRecord: null
  };
  return [
    next,
    [
      { type: "NOTIFY_OVERLAY_OPEN", mode: "FULL", x, y, paneId, data },
      { type: "CLEAR_FALLBACK_TIMER" },
      { type: "CANCEL_DRAG_LOCK" }
    ]
  ];
}
function contextMenuReducer(state, action) {
  switch (action.type) {
    case "HARDWARE_RIGHT_CLICK": {
      const nextId = state.requestId + 1;
      const initial = {
        x: action.x,
        y: action.y,
        paneId: action.paneId,
        pageURL: action.url,
        classification: action.shiftKey ? "FORCE_OVERRIDE" : "STANDARD"
      };
      if (action.shiftKey) {
        return openFull(action.x, action.y, action.paneId, action.url, initial, nextId, true);
      }
      if (isConsecutiveRightClick(action, state.yieldRecord, action.now)) {
        return openFull(action.x, action.y, action.paneId, action.url, initial, nextId, false);
      }
      return [
        {
          status: "AWAITING_PROBE",
          requestId: nextId,
          x: action.x,
          y: action.y,
          paneId: action.paneId,
          url: action.url,
          data: initial,
          shiftKey: false,
          yieldRecord: state.yieldRecord
        },
        [
          { type: "START_FALLBACK_TIMER", requestId: nextId, delayMs: 250 },
          { type: "CANCEL_DRAG_LOCK" }
        ]
      ];
    }
    case "PROBE_CLASSIFIED": {
      if (action.requestId !== state.requestId || state.status !== "AWAITING_PROBE") {
        return [state, []];
      }
      const merged = {
        ...state.data,
        linkURL: action.result.linkURL || state.data.linkURL,
        srcURL: action.result.srcURL || state.data.srcURL,
        selectionText: action.result.selectionText || state.data.selectionText,
        isEditable: action.result.isEditable ?? state.data.isEditable,
        classification: action.result.classification
      };
      const isApp = action.result.classification === "APP_ACTIVE" || Boolean(action.result.isVideoOrPlayer) || Boolean(action.result.isCanvas) || Boolean(action.result.isAppSurface);
      if (isApp) {
        const isConsecutive = Boolean(action.result.isMenuAlreadyOpen) || isConsecutiveRightClick({ x: state.x, y: state.y, paneId: state.paneId }, state.yieldRecord, action.now);
        if (isConsecutive) {
          return openFull(state.x, state.y, state.paneId, state.url, merged, state.requestId, false);
        }
        const next = {
          ...state,
          status: "IDLE",
          yieldRecord: {
            paneId: state.paneId,
            x: state.x,
            y: state.y,
            timestamp: action.now
          }
        };
        return [
          next,
          [
            { type: "NOTIFY_OVERLAY_DISMISS" },
            { type: "CLEAR_FALLBACK_TIMER" }
          ]
        ];
      }
      return openFull(state.x, state.y, state.paneId, state.url, merged, state.requestId, false);
    }
    case "NATIVE_PARAMS_RECEIVED": {
      if (state.paneId && state.paneId !== action.paneId) {
        return [state, []];
      }
      const merged = {
        ...state.data,
        ...action.params,
        x: state.x || action.params.x || 0,
        y: state.y || action.params.y || 0,
        paneId: state.paneId || action.params.paneId || ""
      };
      if (state.status === "OPEN_FULL") {
        const next = { ...state, data: merged };
        return [next, [{ type: "NOTIFY_OVERLAY_OPEN", mode: "FULL", x: next.x, y: next.y, paneId: next.paneId, data: merged }]];
      }
      return [{ ...state, data: merged }, []];
    }
    case "FALLBACK_TIMEOUT": {
      if (action.requestId !== state.requestId || state.status !== "AWAITING_PROBE") {
        return [state, []];
      }
      return openFull(state.x, state.y, state.paneId, state.url, state.data, state.requestId, false);
    }
    case "FORCE_FULL_MENU": {
      const data = {
        x: action.x,
        y: action.y,
        paneId: action.paneId,
        pageURL: action.url,
        classification: "FORCE_OVERRIDE",
        ...action.data ?? {}
      };
      return openFull(action.x, action.y, action.paneId, action.url, data, state.requestId + 1, true);
    }
    case "LEFT_CLICK_RESET": {
      if (state.yieldRecord === null && state.status === "IDLE") {
        return [state, []];
      }
      const next = {
        ...state,
        status: "IDLE",
        yieldRecord: null
      };
      if (state.status === "OPEN_FULL") {
        return [next, [{ type: "NOTIFY_OVERLAY_DISMISS" }, { type: "CLEAR_FALLBACK_TIMER" }]];
      }
      return [next, [{ type: "CLEAR_FALLBACK_TIMER" }]];
    }
    case "DISMISS": {
      if (state.status === "IDLE") return [state, []];
      const next = {
        ...state,
        status: "IDLE"
      };
      return [next, [{ type: "NOTIFY_OVERLAY_DISMISS" }, { type: "CLEAR_FALLBACK_TIMER" }]];
    }
    default:
      return [state, []];
  }
}
const DEFAULT_FREEZE_THRESHOLD_MS = 3 * 1e3;
const DEFAULT_HIBERNATE_THRESHOLD_MS = 60 * 1e3;
function createInitialCryoState(freezeMs = DEFAULT_FREEZE_THRESHOLD_MS, hibernateMs = DEFAULT_HIBERNATE_THRESHOLD_MS) {
  return {
    panes: {},
    activePaneId: null,
    activeTabPaneIds: [],
    isAppMinimized: false,
    freezeThresholdMs: freezeMs,
    hibernateThresholdMs: hibernateMs
  };
}
function isProtectedFromCryo(pane) {
  if (!pane) return false;
  if (!pane.url || pane.url.trim().length === 0 || pane.url === "about:blank") return true;
  return Boolean(pane.isAudible || pane.isInCall || pane.isCritical);
}
function canFreezePane(pane, activePaneId, activeTabPaneIds, isAppMinimized = false) {
  if (pane.paneId === activePaneId) return false;
  if (!isAppMinimized && activeTabPaneIds?.includes(pane.paneId)) return false;
  if (pane.tier !== "ACTIVE") return false;
  if (!pane.url || pane.url.trim().length === 0 || pane.url === "about:blank") return false;
  if (isProtectedFromCryo(pane)) return false;
  return true;
}
function canHibernatePane(pane, activePaneId, force = false, activeTabPaneIds, isAppMinimized = false) {
  if (pane.tier === "HIBERNATED") return false;
  if (!pane.url || pane.url.trim().length === 0 || pane.url === "about:blank") return false;
  if (isProtectedFromCryo(pane)) return false;
  if (!isAppMinimized && (pane.paneId === activePaneId || activeTabPaneIds?.includes(pane.paneId))) return false;
  if (force) return true;
  if (pane.paneId === activePaneId) return false;
  if (activeTabPaneIds?.includes(pane.paneId)) return false;
  return true;
}
function reduceCryoState(state = createInitialCryoState(), action) {
  const effects = [];
  switch (action.type) {
    case "REGISTER_PANE": {
      const { paneId, url, profileId, timestamp = 0 } = action;
      if (!paneId) return [state, effects];
      const ex = state.panes[paneId];
      const nextPane = {
        paneId,
        tier: "ACTIVE",
        lastActivityAt: timestamp,
        url: url ?? ex?.url,
        title: ex?.title,
        profileId: profileId ?? ex?.profileId,
        isAudible: ex?.isAudible ?? false,
        isInCall: ex?.isInCall ?? false,
        isCritical: ex?.isCritical ?? false,
        scrollY: ex?.scrollY ?? 0,
        estimatedMemoryMb: ex?.estimatedMemoryMb ?? 200
      };
      return [{ ...state, panes: { ...state.panes, [paneId]: nextPane } }, effects];
    }
    case "UNREGISTER_PANE": {
      const { paneId } = action;
      if (!paneId || !state.panes[paneId]) return [state, effects];
      const nextPanes = { ...state.panes };
      delete nextPanes[paneId];
      const nextActive = state.activePaneId === paneId ? null : state.activePaneId;
      return [{ ...state, panes: nextPanes, activePaneId: nextActive }, effects];
    }
    case "SET_ACTIVE_PANE": {
      const { paneId, timestamp = 0 } = action;
      let nextPanes = state.panes;
      if (paneId && state.panes[paneId]) {
        const pane = state.panes[paneId];
        let nextTier = pane.tier;
        if (pane.tier === "FROZEN") {
          nextTier = "ACTIVE";
          effects.push({ type: "EXEC_CDP_THAW", paneId }, { type: "BROADCAST_STATE_CHANGE", paneId, tier: "ACTIVE" });
        } else if (pane.tier === "HIBERNATED") {
          nextTier = "ACTIVE";
          effects.push({ type: "EXEC_RESURRECTION", paneId, targetUrl: pane.url, scrollY: pane.scrollY });
          effects.push({ type: "BROADCAST_STATE_CHANGE", paneId, tier: "ACTIVE" });
        }
        nextPanes = { ...state.panes, [paneId]: { ...pane, tier: nextTier, lastActivityAt: timestamp } };
      }
      return [{ ...state, panes: nextPanes, activePaneId: paneId }, effects];
    }
    case "SET_ACTIVE_TAB_PANES": {
      const { paneIds, timestamp = 0 } = action;
      let nextPanes = state.panes;
      if (!state.isAppMinimized) {
        for (const pid of paneIds) {
          const p = nextPanes[pid];
          if (!p || p.tier === "ACTIVE") continue;
          if (p.tier === "FROZEN") effects.push({ type: "EXEC_CDP_THAW", paneId: pid });
          else if (p.tier === "HIBERNATED") effects.push({ type: "EXEC_RESURRECTION", paneId: pid, targetUrl: p.url, scrollY: p.scrollY });
          effects.push({ type: "BROADCAST_STATE_CHANGE", paneId: pid, tier: "ACTIVE" });
          nextPanes = { ...nextPanes, [pid]: { ...p, tier: "ACTIVE", lastActivityAt: timestamp || p.lastActivityAt } };
        }
      }
      return [{ ...state, panes: nextPanes, activeTabPaneIds: paneIds }, effects];
    }
    case "SET_APP_MINIMIZED": {
      const { isMinimized, timestamp = 0 } = action;
      let nextPanes = state.panes;
      if (!isMinimized) {
        const targets = state.activeTabPaneIds?.length ? state.activeTabPaneIds : state.activePaneId ? [state.activePaneId] : [];
        for (const pid of targets) {
          const p = nextPanes[pid];
          if (!p) continue;
          if (p.tier === "FROZEN") {
            effects.push({ type: "EXEC_CDP_THAW", paneId: pid });
            effects.push({ type: "BROADCAST_STATE_CHANGE", paneId: pid, tier: "ACTIVE" });
            nextPanes = { ...nextPanes, [pid]: { ...p, tier: "ACTIVE", lastActivityAt: timestamp || p.lastActivityAt } };
          } else if (p.tier === "HIBERNATED") {
            effects.push({ type: "EXEC_RESURRECTION", paneId: pid, targetUrl: p.url, scrollY: p.scrollY });
            effects.push({ type: "BROADCAST_STATE_CHANGE", paneId: pid, tier: "ACTIVE" });
            nextPanes = { ...nextPanes, [pid]: { ...p, tier: "ACTIVE", lastActivityAt: timestamp || p.lastActivityAt } };
          }
        }
      }
      return [{ ...state, panes: nextPanes, isAppMinimized: isMinimized }, effects];
    }
    case "RECORD_ACTIVITY": {
      const { paneId, timestamp = 0 } = action;
      const pane = state.panes[paneId];
      if (!pane) return [state, effects];
      return [{ ...state, panes: { ...state.panes, [paneId]: { ...pane, lastActivityAt: timestamp } } }, effects];
    }
    case "UPDATE_PROTECTION": {
      const { paneId, isAudible, isInCall, isCritical } = action;
      const pane = state.panes[paneId];
      if (!pane) return [state, effects];
      const nextPane = {
        ...pane,
        isAudible: isAudible ?? pane.isAudible,
        isInCall: isInCall ?? pane.isInCall,
        isCritical: isCritical ?? pane.isCritical
      };
      if ((nextPane.isAudible || nextPane.isInCall || nextPane.isCritical) && nextPane.tier !== "ACTIVE") {
        if (nextPane.tier === "FROZEN") {
          effects.push({ type: "EXEC_CDP_THAW", paneId });
        } else if (nextPane.tier === "HIBERNATED") {
          effects.push({ type: "EXEC_RESURRECTION", paneId, targetUrl: nextPane.url, scrollY: nextPane.scrollY });
        }
        nextPane.tier = "ACTIVE";
        effects.push({ type: "BROADCAST_STATE_CHANGE", paneId, tier: "ACTIVE" });
      }
      return [{ ...state, panes: { ...state.panes, [paneId]: nextPane } }, effects];
    }
    case "FREEZE_PANE": {
      const { paneId, timestamp = 0 } = action;
      const pane = state.panes[paneId];
      if (!pane || !canFreezePane(pane, state.activePaneId, state.activeTabPaneIds, state.isAppMinimized)) return [state, effects];
      effects.push({ type: "EXEC_CDP_FREEZE", paneId }, { type: "BROADCAST_STATE_CHANGE", paneId, tier: "FROZEN" });
      return [{ ...state, panes: { ...state.panes, [paneId]: { ...pane, tier: "FROZEN", frozenAt: timestamp } } }, effects];
    }
    case "THAW_PANE": {
      const { paneId, timestamp = 0 } = action;
      const pane = state.panes[paneId];
      if (!pane || pane.tier !== "FROZEN") return [state, effects];
      effects.push({ type: "EXEC_CDP_THAW", paneId }, { type: "BROADCAST_STATE_CHANGE", paneId, tier: "ACTIVE" });
      return [{ ...state, panes: { ...state.panes, [paneId]: { ...pane, tier: "ACTIVE", lastActivityAt: timestamp } } }, effects];
    }
    case "HIBERNATE_PANE": {
      const { paneId, snapshotUrl, scrollY, estimatedMemoryMb, timestamp = 0, force } = action;
      const pane = state.panes[paneId];
      if (!pane || !canHibernatePane(pane, state.activePaneId, force, state.activeTabPaneIds, state.isAppMinimized)) return [state, effects];
      const nextPane = {
        ...pane,
        tier: "HIBERNATED",
        hibernatedAt: timestamp,
        scrollY: scrollY ?? pane.scrollY,
        estimatedMemoryMb: estimatedMemoryMb ?? pane.estimatedMemoryMb ?? 220
      };
      effects.push({ type: "EXEC_COLD_DISCARD", paneId, snapshotUrl, scrollY: nextPane.scrollY, estimatedMemoryMb: nextPane.estimatedMemoryMb });
      effects.push({
        type: "BROADCAST_STATE_CHANGE",
        paneId,
        tier: "HIBERNATED",
        details: { snapshot: snapshotUrl, estimatedMemoryMb: nextPane.estimatedMemoryMb, title: pane.title }
      });
      return [{ ...state, panes: { ...state.panes, [paneId]: nextPane } }, effects];
    }
    case "WAKE_PANE": {
      const { paneId, timestamp = 0, overrideUrl, rect } = action;
      const pane = state.panes[paneId];
      if (!pane || pane.tier === "ACTIVE") return [state, effects];
      const targetUrl = overrideUrl || pane.url;
      const nextPane = { ...pane, tier: "ACTIVE", url: targetUrl, lastActivityAt: timestamp };
      if (pane.tier === "FROZEN") {
        effects.push({ type: "EXEC_CDP_THAW", paneId });
      } else {
        effects.push({
          type: "EXEC_RESURRECTION",
          paneId,
          targetUrl,
          profileId: pane.profileId,
          scrollY: overrideUrl ? 0 : pane.scrollY,
          rect
        });
      }
      effects.push({ type: "BROADCAST_STATE_CHANGE", paneId, tier: "ACTIVE" });
      return [{ ...state, panes: { ...state.panes, [paneId]: nextPane } }, effects];
    }
    case "UPDATE_SCROLL": {
      const { paneId, scrollY } = action;
      const pane = state.panes[paneId];
      if (!pane) return [state, effects];
      return [{ ...state, panes: { ...state.panes, [paneId]: { ...pane, scrollY } } }, effects];
    }
    case "UPDATE_URL": {
      const { paneId, url, title: title2, timestamp = 0 } = action;
      const pane = state.panes[paneId];
      if (!pane) return [state, effects];
      const nextPane = {
        ...pane,
        url: url || pane.url,
        title: title2 !== void 0 ? title2 : pane.title,
        lastActivityAt: timestamp > 0 ? timestamp : pane.lastActivityAt
      };
      if (nextPane.tier === "FROZEN") {
        nextPane.tier = "ACTIVE";
        effects.push({ type: "EXEC_CDP_THAW", paneId }, { type: "BROADCAST_STATE_CHANGE", paneId, tier: "ACTIVE" });
      }
      return [{ ...state, panes: { ...state.panes, [paneId]: nextPane } }, effects];
    }
    default:
      return [state, effects];
  }
}
const DEFAULT_MAX_DORMANT = 20;
function createInitialGhostState(maxDormant = DEFAULT_MAX_DORMANT) {
  return {
    dormantPaneIds: [],
    maxDormant,
    lastDormantAt: {},
    dormantUrls: {},
    protectedPanes: {}
  };
}
function canEvictDormantPane(state, paneId) {
  if (!state.dormantPaneIds.includes(paneId)) return false;
  if (state.protectedPanes[paneId]) return false;
  return true;
}
function findNextEvictionCandidate(state) {
  const candidates = [...state.dormantPaneIds].filter((id) => !state.protectedPanes[id]).sort((a, b) => (state.lastDormantAt[a] ?? 0) - (state.lastDormantAt[b] ?? 0));
  return candidates[0];
}
function evictOverflow(state, effects) {
  let cur = state;
  while (true) {
    const unprotectedCount = cur.dormantPaneIds.filter((id) => !cur.protectedPanes[id]).length;
    if (unprotectedCount <= cur.maxDormant) break;
    const candidate = findNextEvictionCandidate(cur);
    if (!candidate) break;
    cur = {
      ...cur,
      dormantPaneIds: cur.dormantPaneIds.filter((id) => id !== candidate),
      lastDormantAt: { ...cur.lastDormantAt },
      dormantUrls: { ...cur.dormantUrls },
      protectedPanes: { ...cur.protectedPanes }
    };
    delete cur.lastDormantAt[candidate];
    delete cur.dormantUrls[candidate];
    delete cur.protectedPanes[candidate];
    effects.push({ type: "EXEC_EVICT_VIEW", paneId: candidate });
  }
  return cur;
}
function reduceGhostState(state = createInitialGhostState(), action, now = Date.now()) {
  const effects = [];
  switch (action.type) {
    case "STASH_DORMANT": {
      const { paneId, url, isProtected } = action;
      if (!paneId) return [state, effects];
      const filtered = state.dormantPaneIds.filter((id) => id !== paneId);
      const nextDormant = [paneId, ...filtered];
      const nextLastDormantAt = { ...state.lastDormantAt, [paneId]: now };
      const nextDormantUrls = { ...state.dormantUrls };
      if (url) nextDormantUrls[paneId] = url;
      const nextProtected = { ...state.protectedPanes };
      if (typeof isProtected === "boolean") {
        nextProtected[paneId] = isProtected;
      }
      effects.push({ type: "EXEC_STASH_VIEW", paneId });
      const intermediateState = {
        ...state,
        dormantPaneIds: nextDormant,
        lastDormantAt: nextLastDormantAt,
        dormantUrls: nextDormantUrls,
        protectedPanes: nextProtected
      };
      const finalState = evictOverflow(intermediateState, effects);
      return [finalState, effects];
    }
    case "ACTIVATE_PANE": {
      const { paneId } = action;
      if (!paneId || !state.dormantPaneIds.includes(paneId)) {
        return [state, effects];
      }
      const nextDormant = state.dormantPaneIds.filter((id) => id !== paneId);
      const nextLastDormantAt = { ...state.lastDormantAt };
      const nextDormantUrls = { ...state.dormantUrls };
      delete nextLastDormantAt[paneId];
      delete nextDormantUrls[paneId];
      effects.push({ type: "EXEC_WAKE_VIEW", paneId });
      return [
        {
          ...state,
          dormantPaneIds: nextDormant,
          lastDormantAt: nextLastDormantAt,
          dormantUrls: nextDormantUrls
        },
        effects
      ];
    }
    case "EVICT_DORMANT": {
      const { paneId } = action;
      if (!canEvictDormantPane(state, paneId)) {
        return [state, effects];
      }
      const nextDormant = state.dormantPaneIds.filter((id) => id !== paneId);
      const nextLastDormantAt = { ...state.lastDormantAt };
      const nextDormantUrls = { ...state.dormantUrls };
      const nextProtected = { ...state.protectedPanes };
      delete nextLastDormantAt[paneId];
      delete nextDormantUrls[paneId];
      delete nextProtected[paneId];
      effects.push({ type: "EXEC_EVICT_VIEW", paneId });
      return [
        {
          ...state,
          dormantPaneIds: nextDormant,
          lastDormantAt: nextLastDormantAt,
          dormantUrls: nextDormantUrls,
          protectedPanes: nextProtected
        },
        effects
      ];
    }
    case "SET_MAX_DORMANT": {
      const maxDormant = Math.max(1, action.maxDormant);
      const nextState = { ...state, maxDormant };
      const finalState = evictOverflow(nextState, effects);
      return [finalState, effects];
    }
    case "SET_PANE_PROTECTED": {
      const { paneId, isProtected } = action;
      if (!paneId) return [state, effects];
      const nextState = {
        ...state,
        protectedPanes: {
          ...state.protectedPanes,
          [paneId]: Boolean(isProtected)
        }
      };
      const finalState = evictOverflow(nextState, effects);
      return [finalState, effects];
    }
    case "CLEAR_DORMANT": {
      for (const id of state.dormantPaneIds) {
        effects.push({ type: "EXEC_EVICT_VIEW", paneId: id });
      }
      return [createInitialGhostState(state.maxDormant), effects];
    }
    default:
      return [state, effects];
  }
}
const SENSITIVE_KEYWORDS = /password|passcode|token|pin|secret|cvv|cvc|cardnumber|ssn/i;
function isSensitiveField(type, name, autocomplete, placeholder, ariaLabel) {
  if (type === "password") return true;
  if (name && SENSITIVE_KEYWORDS.test(name)) return true;
  return false;
}
function validateShadowSnapshot(snapshot) {
  if (!snapshot.url || typeof snapshot.url !== "string") return false;
  if (typeof snapshot.timestamp !== "number" || isNaN(snapshot.timestamp)) return false;
  if (snapshot.windowScroll.x < 0 || snapshot.windowScroll.y < 0) return false;
  for (const form of snapshot.forms) {
    if (!form.selector || typeof form.selector !== "string") return false;
    if (isSensitiveField(form.type, form.name)) return false;
  }
  for (const sc of snapshot.scrollContainers) {
    if (!sc.selector || typeof sc.selector !== "string") return false;
    if (sc.scrollLeft < 0 || sc.scrollTop < 0) return false;
  }
  return true;
}
const MULTI_CLICK_CONFIG = {
  /** Maximum time window between clicks to qualify as a multi-click (OS standard: 500ms). */
  MAX_INTERVAL_MS: 500,
  /** Precomputed squared spatial tolerance for high-performance Euclidean checks. */
  MAX_DISTANCE_SQ: 25,
  /** Maximum click count before cycling back to single click (1=caret, 2=word, 3=paragraph). */
  MAX_CLICK_COUNT: 3
};
function isConsecutiveClick(paneId, button, x, y, now, state, maxIntervalMs = MULTI_CLICK_CONFIG.MAX_INTERVAL_MS, maxDistanceSq = MULTI_CLICK_CONFIG.MAX_DISTANCE_SQ) {
  if (!state.paneId || state.paneId !== paneId) return false;
  if (state.button !== button) return false;
  if (now < state.timestamp) return false;
  const dt = now - state.timestamp;
  if (dt > maxIntervalMs) return false;
  const dx = x - state.x;
  const dy = y - state.y;
  const distSq = dx * dx + dy * dy;
  return distSq <= maxDistanceSq;
}
const initialMultiClickState = {
  paneId: null,
  button: 0,
  x: 0,
  y: 0,
  timestamp: 0,
  clickCount: 1,
  isDown: false
};
function pointerArbiterReducer(state, action, maxIntervalMs = MULTI_CLICK_CONFIG.MAX_INTERVAL_MS, maxDistanceSq = MULTI_CLICK_CONFIG.MAX_DISTANCE_SQ) {
  switch (action.type) {
    case "POINTER_DOWN": {
      const isConsecutive = isConsecutiveClick(
        action.paneId,
        action.button,
        action.x,
        action.y,
        action.now,
        state,
        maxIntervalMs,
        maxDistanceSq
      );
      let nextCount = 1;
      if (isConsecutive) {
        nextCount = state.clickCount < MULTI_CLICK_CONFIG.MAX_CLICK_COUNT ? state.clickCount + 1 : 1;
      }
      const nextState = {
        paneId: action.paneId,
        button: action.button,
        x: action.x,
        y: action.y,
        timestamp: action.now,
        clickCount: nextCount,
        isDown: true
      };
      return [nextState, { clickCount: nextCount }];
    }
    case "POINTER_UP": {
      const currentCount = state.clickCount;
      const nextState = {
        ...state,
        isDown: false,
        timestamp: action.now
      };
      return [nextState, { clickCount: currentCount }];
    }
    case "RESET": {
      return [initialMultiClickState, { clickCount: 1 }];
    }
    default:
      return [state, { clickCount: state.clickCount }];
  }
}
function createInitialGovernorState(timestamp = Date.now()) {
  return {
    state: "ACTIVE",
    lastStateChangeAt: timestamp,
    compactionCount: 0
  };
}
function reduceGovernorState(state = createInitialGovernorState(), action) {
  const effects = [];
  const now = action.timestamp ?? Date.now();
  let nextState = state.state;
  let nextCompactionCount = state.compactionCount;
  switch (action.type) {
    case "WINDOW_MINIMIZE":
    case "WINDOW_HIDE": {
      if (state.state !== "MINIMIZED") {
        nextState = "MINIMIZED";
        nextCompactionCount++;
        effects.push({ type: "SET_HIBERNATION_MINIMIZED", isMinimized: true });
        effects.push({ type: "TRIGGER_COMPACTION" });
        effects.push({ type: "NOTIFY_RENDERER", state: "MINIMIZED" });
      }
      break;
    }
    case "WINDOW_RESTORE":
    case "WINDOW_SHOW": {
      if (state.state === "MINIMIZED") {
        nextState = "ACTIVE";
        effects.push({ type: "SET_HIBERNATION_MINIMIZED", isMinimized: false });
        effects.push({ type: "TRIGGER_WAKE" });
        effects.push({ type: "NOTIFY_RENDERER", state: "ACTIVE" });
      }
      break;
    }
    case "SYSTEM_SUSPEND": {
      if (state.state !== "SUSPENDED") {
        nextState = "SUSPENDED";
        nextCompactionCount++;
        effects.push({ type: "SET_HIBERNATION_MINIMIZED", isMinimized: true });
        effects.push({ type: "TRIGGER_COMPACTION" });
        effects.push({ type: "NOTIFY_RENDERER", state: "SUSPENDED" });
      }
      break;
    }
    case "SYSTEM_RESUME": {
      if (state.state === "SUSPENDED") {
        nextState = "ACTIVE";
        effects.push({ type: "SET_HIBERNATION_MINIMIZED", isMinimized: false });
        effects.push({ type: "TRIGGER_WAKE" });
        effects.push({ type: "NOTIFY_RENDERER", state: "ACTIVE" });
      }
      break;
    }
    case "SYSTEM_LOCK": {
      if (state.state === "ACTIVE") {
        nextState = "IDLE";
        nextCompactionCount++;
        effects.push({ type: "SET_HIBERNATION_MINIMIZED", isMinimized: true });
        effects.push({ type: "TRIGGER_COMPACTION" });
        effects.push({ type: "NOTIFY_RENDERER", state: "IDLE" });
      }
      break;
    }
    case "SYSTEM_UNLOCK": {
      if (state.state === "IDLE") {
        nextState = "ACTIVE";
        effects.push({ type: "SET_HIBERNATION_MINIMIZED", isMinimized: false });
        effects.push({ type: "TRIGGER_WAKE" });
        effects.push({ type: "NOTIFY_RENDERER", state: "ACTIVE" });
      }
      break;
    }
    case "SYSTEM_IDLE": {
      if (state.state === "ACTIVE") {
        nextState = "IDLE";
        nextCompactionCount++;
        effects.push({ type: "TRIGGER_COMPACTION" });
        effects.push({ type: "NOTIFY_RENDERER", state: "IDLE" });
      }
      break;
    }
    case "USER_ACTIVE": {
      if (state.state === "IDLE") {
        nextState = "ACTIVE";
        effects.push({ type: "TRIGGER_WAKE" });
        effects.push({ type: "NOTIFY_RENDERER", state: "ACTIVE" });
      }
      break;
    }
  }
  const hasChanged = nextState !== state.state;
  return [
    {
      state: nextState,
      lastStateChangeAt: hasChanged ? now : state.lastStateChangeAt,
      compactionCount: nextCompactionCount
    },
    effects
  ];
}
const APP_OVERLAY_ID = "__appOverlay";
function hitTestPaneAtPhysical(s, cssX, cssY, dpr) {
  if (!Number.isFinite(cssX) || !Number.isFinite(cssY)) return void 0;
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const px = cssX * scale;
  const py = cssY * scale;
  if (s.communicator) {
    const cr = s.communicator.rect;
    const insideComm = px >= cr.x && px < cr.x + cr.width && py >= cr.y && py < cr.y + cr.height;
    if (insideComm) {
      return { paneId: s.communicator.id, cssLeft: cr.cssLeft, cssTop: cr.cssTop };
    }
  }
  let hit;
  for (const [paneId, r] of s.panes) {
    if (r.x <= -5e3 || r.width <= 1 || r.height <= 1) continue;
    const inside = px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height;
    if (inside) hit = { paneId, cssLeft: r.cssLeft, cssTop: r.cssTop };
  }
  return hit;
}
function devicePixelRatioFor(win) {
  try {
    if (win.isDestroyed()) return 1;
    const factor = electron.screen.getDisplayMatching(win.getBounds()).scaleFactor;
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
  } catch {
    return 1;
  }
}
const composers = /* @__PURE__ */ new Map();
function registerComposer(win) {
  const existing = composers.get(win.id);
  if (existing) return existing;
  const state = {
    views: /* @__PURE__ */ new Map(),
    hidden: /* @__PURE__ */ new Set(),
    stack: { panes: /* @__PURE__ */ new Map(), transientOrder: [] },
    paneCss: /* @__PURE__ */ new Map()
  };
  composers.set(win.id, state);
  win.once("closed", () => composers.delete(win.id));
  return state;
}
function attach(win, v, index) {
  if (win.isDestroyed()) return;
  const children = win.contentView.children;
  if (children.includes(v)) return;
  const at = Math.max(0, Math.min(index ?? children.length, children.length));
  win.contentView.addChildView(v, at);
}
function detach(win, v) {
  if (win.isDestroyed()) return;
  if (win.contentView.children.includes(v)) win.contentView.removeChildView(v);
}
function setAppOverlay(win, view) {
  const s = registerComposer(win);
  if (!view) {
    const prev = s.views.get(APP_OVERLAY_ID);
    if (prev) detach(win, prev);
    s.views.delete(APP_OVERLAY_ID);
    s.stack.appOverlayId = void 0;
    return;
  }
  s.views.set(APP_OVERLAY_ID, view);
  attach(win, view);
  s.stack.appOverlayId = APP_OVERLAY_ID;
}
function setTransientOverlay(win, id, view) {
  const s = registerComposer(win);
  s.views.set(id, view);
  attach(win, view);
  if (!s.stack.transientOrder.includes(id)) s.stack.transientOrder.push(id);
  s.hidden.delete(id);
}
function hideTransient(win, id) {
  const s = registerComposer(win);
  s.hidden.add(id);
  const at = s.stack.transientOrder.indexOf(id);
  if (at !== -1) s.stack.transientOrder.splice(at, 1);
}
function placePane(win, paneId, view, rect) {
  const s = registerComposer(win);
  const r = rect ?? { x: 0, y: 0, width: 0, height: 0, cssLeft: 0, cssTop: 0 };
  s.hidden.delete(paneId);
  s.stack.panes.set(paneId, r);
  s.views.set(paneId, view);
  const dpr = devicePixelRatioFor(win);
  const w = r.width / dpr;
  const h = r.height / dpr;
  const overlay = s.views.get(APP_OVERLAY_ID);
  const children = win.isDestroyed() ? [] : win.contentView.children;
  const overlayIdx = overlay ? children.indexOf(overlay) : -1;
  const commView = s.stack.communicator ? s.views.get(s.stack.communicator.id) : void 0;
  const commIdx = commView ? children.indexOf(commView) : -1;
  let at;
  if (commIdx !== -1) at = commIdx;
  else if (overlayIdx !== -1) at = overlayIdx;
  else at = children.length;
  attach(win, view, at);
  if (typeof view.setBorderRadius === "function") {
    view.setBorderRadius(12);
  }
  const cssRect = { x: r.cssLeft, y: r.cssTop, width: w, height: h };
  if (rect && isValidPhysicalRect(cssRect)) {
    s.paneCss.set(paneId, cssRect);
    view.setBounds(cssRect);
  }
}
function hidePane(win, paneId) {
  const s = registerComposer(win);
  s.hidden.add(paneId);
  s.stack.panes.delete(paneId);
  s.paneCss.delete(paneId);
  const view = s.views.get(paneId);
  if (view) {
    detach(win, view);
    try {
      view.setVisible(false);
    } catch {
    }
  }
}
function placeCommunicator(win, appId, view, rect) {
  const s = registerComposer(win);
  const r = rect ?? { x: 0, y: 0, width: 0, height: 0, cssLeft: 0, cssTop: 0 };
  s.stack.communicator = { id: appId, rect: r };
  s.views.set(appId, view);
  const dpr = devicePixelRatioFor(win);
  const w = r.width / dpr;
  const h = r.height / dpr;
  const overlay = s.views.get(APP_OVERLAY_ID);
  const children = win.isDestroyed() ? [] : win.contentView.children;
  const at = overlay ? children.indexOf(overlay) : children.length;
  attach(win, view, at !== -1 ? at : children.length);
  const cssRect = { x: r.cssLeft, y: r.cssTop, width: w, height: h };
  if (rect && isValidPhysicalRect(cssRect)) view.setBounds(cssRect);
}
function removePane(win, paneId) {
  const s = registerComposer(win);
  const view = s.views.get(paneId);
  if (view) detach(win, view);
  s.views.delete(paneId);
  s.hidden.delete(paneId);
  s.stack.panes.delete(paneId);
  s.paneCss.delete(paneId);
  if (s.stack.communicator?.id === paneId) {
    s.stack.communicator = void 0;
  }
}
const removeCommunicator = removePane;
function hitTestPaneAt(win, cssX, cssY, dpr = devicePixelRatioFor(win)) {
  const s = registerComposer(win);
  const hit = hitTestPaneAtPhysical(s.stack, cssX, cssY, dpr);
  if (!hit || s.hidden.has(hit.paneId)) return void 0;
  const view = s.views.get(hit.paneId);
  if (!view) return void 0;
  return { ...hit, view };
}
function reRoundAllPanes(win) {
  const s = registerComposer(win);
  const dpr = devicePixelRatioFor(win);
  for (const [paneId, css] of s.paneCss) {
    const view = s.views.get(paneId);
    if (!view || s.hidden.has(paneId)) continue;
    if (!isValidPhysicalRect(css)) continue;
    view.setBounds(css);
    const phys = toPhysicalRect(css, dpr);
    s.stack.panes.set(paneId, { ...phys, cssLeft: css.x, cssTop: css.y });
  }
}
function invalidateAllPanes(win) {
  const s = registerComposer(win);
  for (const [paneId, view] of s.views) {
    if (!s.hidden.has(paneId) && !view.webContents.isDestroyed()) {
      view.webContents.invalidate();
    }
  }
}
function toCdpButton(button, isMove = false, buttons = 0) {
  if (isMove) {
    if ((buttons & 1) !== 0) return "left";
    if ((buttons & 2) !== 0) return "right";
    if ((buttons & 4) !== 0) return "middle";
    return "none";
  }
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "none";
}
function toElectronModifiers(modifiers) {
  const list = [];
  if ((modifiers & 1) !== 0) list.push("alt");
  if ((modifiers & 2) !== 0) list.push("control");
  if ((modifiers & 4) !== 0) list.push("meta");
  if ((modifiers & 8) !== 0) list.push("shift");
  return list;
}
const activePaneIdByWin = /* @__PURE__ */ new Map();
const pendingFocusByWin = /* @__PURE__ */ new Map();
class FocusArbiter {
  static focusOverlay(win) {
    const targetWin = win || global.mainWindow;
    if (!targetWin || targetWin.isDestroyed()) return;
    setAirspaceFocusEmulation(targetWin, false);
    const ov = global.appOverlayView?.webContents;
    if (ov && !ov.isDestroyed()) {
      ov.focus();
    }
  }
  static focusGuest(win, paneId) {
    if (!win || win.isDestroyed() || !paneId) return;
    const s = composers.get(win.id);
    const view = s?.views.get(paneId);
    if (!view || view.webContents.isDestroyed()) {
      pendingFocusByWin.set(win.id, paneId);
      return;
    }
    pendingFocusByWin.delete(win.id);
    const prevPaneId = activePaneIdByWin.get(win.id);
    if (prevPaneId && prevPaneId !== paneId) {
      const prevView = s?.views.get(prevPaneId);
      if (prevView && !prevView.webContents.isDestroyed() && prevView.webContents.debugger.isAttached()) {
        prevView.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {
        });
      }
    }
    activePaneIdByWin.set(win.id, paneId);
    hibernationEngine.setActivePane(paneId);
    if (hibernationEngine.isFrozen(paneId)) {
      hibernationEngine.thawPane(paneId).catch(() => {
      });
    }
    const dbg = ensureDebugger(view);
    if (dbg) {
      dbg.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {
      });
    }
    view.webContents.focus();
    global.appOverlayView?.webContents.send("pane.focused", paneId);
  }
  static handlePendingGuestFocus(win, paneId) {
    if (!win || win.isDestroyed()) return;
    if (pendingFocusByWin.get(win.id) === paneId) {
      this.focusGuest(win, paneId);
    }
  }
  static getActivePaneId(winId) {
    return activePaneIdByWin.get(winId);
  }
  static handlePaneDestroyed(win, paneId) {
    if (!win || win.isDestroyed()) return;
    if (pendingFocusByWin.get(win.id) === paneId) {
      pendingFocusByWin.delete(win.id);
    }
    if (activePaneIdByWin.get(win.id) === paneId) {
      activePaneIdByWin.delete(win.id);
      this.focusOverlay(win);
    }
  }
  static blur(win) {
    if (!win || win.isDestroyed()) return;
    setAirspaceFocusEmulation(win, false);
  }
}
let currentState = initialContextMenuState;
let fallbackTimer = null;
function getOverlayWebContents() {
  return global.appOverlayView?.webContents;
}
function executeEffect(effect) {
  switch (effect.type) {
    case "NOTIFY_OVERLAY_OPEN": {
      const ov = getOverlayWebContents();
      if (!ov || ov.isDestroyed()) return;
      ov.send(IPC_CHANNELS.EVENTS.CONTEXT_MENU_SHOW, {
        mode: effect.mode,
        x: effect.x,
        y: effect.y,
        paneId: effect.paneId,
        url: currentState.url,
        data: effect.data
      });
      break;
    }
    case "NOTIFY_OVERLAY_DISMISS": {
      const ov = getOverlayWebContents();
      if (!ov || ov.isDestroyed()) return;
      ov.send(IPC_CHANNELS.EVENTS.CONTEXT_MENU_DISMISS);
      break;
    }
    case "START_FALLBACK_TIMER": {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        dispatch({ type: "FALLBACK_TIMEOUT", requestId: effect.requestId });
      }, effect.delayMs);
      break;
    }
    case "CLEAR_FALLBACK_TIMER": {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      break;
    }
  }
}
function dispatch(action) {
  const [nextState, effects] = contextMenuReducer(currentState, action);
  currentState = nextState;
  for (let i = 0; i < effects.length; i++) {
    executeEffect(effects[i]);
  }
}
function resetContextMenuYieldState() {
  dispatch({ type: "LEFT_CLICK_RESET" });
}
function handleNativeContextMenuEvent(paneId, params) {
  dispatch({
    type: "NATIVE_PARAMS_RECEIVED",
    paneId,
    params: {
      guestX: params.x,
      guestY: params.y,
      linkURL: params.linkURL,
      srcURL: params.srcURL,
      pageURL: params.pageURL,
      selectionText: params.selectionText,
      isEditable: params.isEditable,
      editFlags: params.editFlags
    }
  });
}
function initContextMenuCoordinator(getWindow) {
  electron.ipcMain.on("airspace:context-gesture", (_e, msg) => {
    const win2 = getWindow();
    if (!win2 || win2.isDestroyed()) return;
    const hit = hitTestPaneAt(win2, msg.x, msg.y, devicePixelRatioFor(win2));
    const paneId = hit?.paneId || "";
    const view = paneId ? composers.get(win2.id)?.views.get(paneId) : void 0;
    const currentUrl = view && !view.webContents.isDestroyed() ? view.webContents.getURL() : "";
    dispatch({
      type: "HARDWARE_RIGHT_CLICK",
      x: msg.x,
      y: msg.y,
      paneId,
      shiftKey: msg.shiftKey,
      url: currentUrl,
      now: Date.now()
    });
  });
  electron.ipcMain.on("guest:context-probe", (_e, probe) => {
    dispatch({
      type: "PROBE_CLASSIFIED",
      requestId: currentState.requestId,
      result: probe,
      now: Date.now()
    });
  });
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.on("move", () => dispatch({ type: "DISMISS" }));
    win.on("resize", () => dispatch({ type: "DISMISS" }));
    win.on("blur", () => dispatch({ type: "DISMISS" }));
  }
}
const wcPaneMap = /* @__PURE__ */ new Map();
const lastPaneCursor = /* @__PURE__ */ new Map();
let currentHoveredPaneId;
function registerPaneWebContents(paneId, wc) {
  wcPaneMap.set(wc.id, paneId);
}
function unregisterPaneWebContents(wcId) {
  const paneId = wcPaneMap.get(wcId);
  if (paneId) {
    lastPaneCursor.delete(paneId);
    wcPaneMap.delete(wcId);
  }
  if (currentHoveredPaneId === paneId) {
    currentHoveredPaneId = void 0;
  }
}
function setHoveredPaneId(paneId) {
  if (currentHoveredPaneId === paneId) return;
  currentHoveredPaneId = paneId;
  const overlayWc = global.appOverlayView?.webContents;
  if (!overlayWc || overlayWc.isDestroyed()) return;
  if (paneId) {
    const cursor = lastPaneCursor.get(paneId) || "default";
    overlayWc.send(IPC_CHANNELS.OVERLAY.CURSOR, cursor);
  } else {
    overlayWc.send(IPC_CHANNELS.OVERLAY.CURSOR, "default");
  }
}
function bindGuestCursor(wc, explicitPaneId) {
  if (explicitPaneId) {
    registerPaneWebContents(explicitPaneId, wc);
  }
  wc.on("cursor-changed", (_e, type) => {
    const paneId = explicitPaneId || wcPaneMap.get(wc.id);
    if (paneId) {
      if (lastPaneCursor.get(paneId) === type) return;
      lastPaneCursor.set(paneId, type);
    }
    if (!currentHoveredPaneId || paneId === currentHoveredPaneId) {
      global.appOverlayView?.webContents.send(IPC_CHANNELS.OVERLAY.CURSOR, type);
    }
  });
  wc.once("destroyed", () => {
    unregisterPaneWebContents(wc.id);
  });
}
const multiClickStateByWin = /* @__PURE__ */ new Map();
function setAirspaceFocusEmulation(win, enabled) {
  if (!win || win.isDestroyed()) return;
  const s = composers.get(win.id);
  if (!s) return;
  for (const v of s.views.values()) {
    if (!v.webContents.isDestroyed() && v.webContents.debugger.isAttached()) {
      v.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled }).catch(() => {
      });
    }
  }
}
function initPointerForwarder(getWindow) {
  electron.ipcMain.on("airspace:chrome-clicked", () => {
    setHoveredPaneId(void 0);
    const win = getWindow();
    if (win) multiClickStateByWin.delete(win.id);
    FocusArbiter.focusOverlay(win);
  });
  electron.ipcMain.on("airspace:chrome-entered", () => {
    setHoveredPaneId(void 0);
    const win = getWindow();
    if (win) multiClickStateByWin.delete(win.id);
  });
  electron.ipcMain.on(IPC_CHANNELS.OVERLAY.FORWARD_POINTER, (_e, msg) => {
    const win = getWindow();
    if (!win) return;
    const hit = hitTestPaneAt(win, msg.x, msg.y, devicePixelRatioFor(win));
    if (!hit) {
      setHoveredPaneId(void 0);
      multiClickStateByWin.delete(win.id);
      return;
    }
    setHoveredPaneId(hit.paneId);
    if (msg.type !== "mousemove" || Boolean(msg.buttons && msg.buttons > 0)) {
      hibernationEngine.registerActivity(hit.paneId);
    }
    const view = composers.get(win.id)?.views.get(hit.paneId);
    if (!view || view.webContents.isDestroyed()) return;
    const bounds = view.getBounds();
    const originX = bounds.width > 0 ? bounds.x : hit.cssLeft;
    const originY = bounds.height > 0 ? bounds.y : hit.cssTop;
    const localX = Math.round(msg.x - originX);
    const localY = Math.round(msg.y - originY);
    const electronMods = toElectronModifiers(msg.modifiers);
    if (msg.type === "wheel") {
      try {
        view.webContents.sendInputEvent({
          type: "mouseWheel",
          x: localX,
          y: localY,
          deltaX: -(msg.deltaX || 0),
          deltaY: -(msg.deltaY || 0),
          modifiers: electronMods,
          canScroll: true
        });
      } catch {
      }
      return;
    }
    if (msg.type === "mousedown") {
      FocusArbiter.focusGuest(win, hit.paneId);
      if (msg.button === 0) {
        resetContextMenuYieldState();
      }
    }
    if (msg.button === 2 && (msg.modifiers & 8) !== 0) {
      return;
    }
    const isMove = msg.type === "mousemove";
    const btn = toCdpButton(msg.button, isMove, msg.buttons);
    let clickCount = isMove ? 0 : 1;
    if (msg.type === "mousedown" && btn !== "none") {
      const prevState = multiClickStateByWin.get(win.id) ?? initialMultiClickState;
      const [nextState, outcome] = pointerArbiterReducer(prevState, {
        type: "POINTER_DOWN",
        paneId: hit.paneId,
        button: msg.button,
        x: localX,
        y: localY,
        now: Date.now()
      });
      multiClickStateByWin.set(win.id, nextState);
      clickCount = outcome.clickCount;
    } else if (msg.type === "mouseup" && btn !== "none") {
      const prevState = multiClickStateByWin.get(win.id) ?? initialMultiClickState;
      const [nextState, outcome] = pointerArbiterReducer(prevState, {
        type: "POINTER_UP",
        paneId: hit.paneId,
        button: msg.button,
        x: localX,
        y: localY,
        now: Date.now()
      });
      multiClickStateByWin.set(win.id, nextState);
      clickCount = outcome.clickCount;
    }
    try {
      if (isMove) {
        view.webContents.sendInputEvent({
          type: "mouseMove",
          x: localX,
          y: localY,
          modifiers: electronMods
        });
      } else if (msg.type === "mousedown" && btn !== "none") {
        view.webContents.sendInputEvent({
          type: "mouseDown",
          x: localX,
          y: localY,
          button: btn,
          clickCount,
          modifiers: electronMods
        });
      } else if (msg.type === "mouseup" && btn !== "none") {
        view.webContents.sendInputEvent({
          type: "mouseUp",
          x: localX,
          y: localY,
          button: btn,
          clickCount,
          modifiers: electronMods
        });
      }
    } catch {
    }
  });
}
function ensureDebugger(view) {
  const dbg = view.webContents.debugger;
  if (!dbg.isAttached()) {
    try {
      dbg.attach("1.3");
    } catch {
      return void 0;
    }
  }
  return dbg;
}
class CryoVault {
  lastKnownValidBounds = /* @__PURE__ */ new Map();
  shadowStates = /* @__PURE__ */ new Map();
  rememberValidBounds(paneId, bounds) {
    if (bounds.width > 50 && bounds.height > 50 && bounds.x >= -50 && bounds.y >= -50) {
      this.lastKnownValidBounds.set(paneId, { ...bounds });
    }
  }
  getValidBounds(paneId, fallback) {
    const remembered = this.lastKnownValidBounds.get(paneId);
    if (remembered) return remembered;
    if (fallback && fallback.width > 50 && fallback.height > 50 && fallback.x >= -50 && fallback.y >= -50) {
      return fallback;
    }
    return { x: 80, y: 40, width: 1200, height: 800 };
  }
  normalizePartition(profileId) {
    const raw = profileId || "main";
    try {
      const p = getProfileById(raw);
      if (p && p.is_ephemeral) return raw;
    } catch {
    }
    if (raw.startsWith("persist:")) return raw;
    return `persist:${raw}`;
  }
  storeDescriptor(paneId, desc) {
    viewRegistry.setHibernated(paneId, desc);
    try {
      db.prepare("UPDATE nodes SET is_hibernating = 1 WHERE id = ?").run(paneId);
    } catch {
    }
  }
  retrieveDescriptor(paneId) {
    const desc = viewRegistry.getHibernated(paneId);
    if (desc) return desc;
    try {
      const row = db.prepare("SELECT * FROM nodes WHERE id = ?").get(paneId);
      if (row && row.url) {
        return {
          url: row.url,
          profileId: row.profile_id || "main",
          bounds: this.getValidBounds(paneId, { x: row.x, y: row.y, width: row.width, height: row.height }),
          dataURL: "",
          title: "Restored Tab",
          scrollY: 0,
          hibernatedAt: Date.now()
        };
      }
    } catch {
    }
    return void 0;
  }
  storeShadowState(paneId, snapshot) {
    this.shadowStates.set(paneId, snapshot);
    const existing = viewRegistry.getHibernated(paneId);
    if (existing) {
      existing.shadowState = snapshot;
    }
  }
  retrieveShadowState(paneId) {
    return this.shadowStates.get(paneId) || viewRegistry.getHibernated(paneId)?.shadowState;
  }
  deleteDescriptor(paneId) {
    viewRegistry.deleteHibernated(paneId);
    this.shadowStates.delete(paneId);
    try {
      db.prepare("UPDATE nodes SET is_hibernating = 0 WHERE id = ?").run(paneId);
    } catch {
    }
  }
}
const cryoVault = new CryoVault();
class CryoEffectRunner {
  delegate = null;
  inFlightResurrections = /* @__PURE__ */ new Set();
  bindLifecycle(delegate) {
    this.delegate = delegate;
  }
  async runEffect(effect) {
    const win = this.delegate?.getWindow();
    switch (effect.type) {
      case "EXEC_CDP_FREEZE": {
        const view = viewRegistry.getView(effect.paneId);
        if (!view || view.webContents.isDestroyed()) return;
        try {
          const rawBounds = view.getBounds();
          cryoVault.rememberValidBounds(effect.paneId, rawBounds);
          const safeBounds = cryoVault.getValidBounds(effect.paneId, rawBounds);
          const snapshot = await captureViewSafely(view);
          const title2 = view.webContents.getTitle() || "Restored Tab";
          const url = view.webContents.getURL() || "";
          const profileId = viewRegistry.getProfile(effect.paneId) || "main";
          cryoVault.storeDescriptor(effect.paneId, {
            url,
            profileId,
            bounds: safeBounds,
            dataURL: snapshot,
            title: title2,
            estimatedMemoryMb: 200,
            hibernatedAt: Date.now()
          });
          const dbg = ensureDebugger(view);
          if (dbg) {
            await dbg.sendCommand("Page.setWebLifecycleState", { state: "frozen" });
            await dbg.sendCommand("Memory.forciblyPurgeJavaScriptMemory").catch(() => {
            });
          }
        } catch {
        }
        break;
      }
      case "EXEC_CDP_THAW": {
        const view = viewRegistry.getView(effect.paneId);
        if (!view || view.webContents.isDestroyed()) return;
        try {
          const dbg = ensureDebugger(view);
          if (dbg) await dbg.sendCommand("Page.setWebLifecycleState", { state: "active" });
        } catch {
        }
        break;
      }
      case "EXEC_COLD_DISCARD": {
        if (!win || !this.delegate) return;
        if (this.inFlightResurrections.has(effect.paneId)) return;
        const view = viewRegistry.getView(effect.paneId);
        if (!view || view.webContents.isDestroyed()) return;
        try {
          const rawBounds = view.getBounds();
          cryoVault.rememberValidBounds(effect.paneId, rawBounds);
          const safeBounds = cryoVault.getValidBounds(effect.paneId, rawBounds);
          const existingDesc = cryoVault.retrieveDescriptor(effect.paneId);
          const snapshot = effect.snapshotUrl || existingDesc?.dataURL || await captureViewSafely(view);
          const title2 = existingDesc?.title || view.webContents.getTitle() || "Restored Tab";
          const url = existingDesc?.url || view.webContents.getURL() || "";
          const profileId = existingDesc?.profileId || viewRegistry.getProfile(effect.paneId) || "main";
          const nav = view.webContents.navigationHistory;
          const navEntries = typeof nav?.getAllEntries === "function" ? nav.getAllEntries() : void 0;
          const navActiveIndex = typeof nav?.getActiveIndex === "function" ? nav.getActiveIndex() : void 0;
          cryoVault.storeDescriptor(effect.paneId, {
            url,
            profileId,
            bounds: safeBounds,
            dataURL: snapshot,
            title: title2,
            scrollY: effect.scrollY ?? existingDesc?.scrollY ?? 0,
            estimatedMemoryMb: effect.estimatedMemoryMb ?? existingDesc?.estimatedMemoryMb ?? 200,
            hibernatedAt: Date.now(),
            shadowState: existingDesc?.shadowState,
            navEntries: navEntries?.map((e) => ({ url: e.url, title: e.title || e.url, pageState: e.pageState })),
            navActiveIndex
          });
          this.delegate.destroyPane(win, effect.paneId, true);
        } catch (err) {
          console.error(`[CryoEffectRunner] Failed discard ${effect.paneId}:`, err);
        }
        break;
      }
      case "EXEC_RESURRECTION": {
        if (!win || !this.delegate) return;
        if (this.inFlightResurrections.has(effect.paneId)) return;
        this.inFlightResurrections.add(effect.paneId);
        try {
          const desc = cryoVault.retrieveDescriptor(effect.paneId);
          cryoVault.deleteDescriptor(effect.paneId);
          let targetUrl = effect.targetUrl;
          if (!targetUrl || targetUrl === "about:blank") targetUrl = desc?.url;
          if (targetUrl === "about:blank") targetUrl = void 0;
          const partition = cryoVault.normalizePartition(effect.profileId || desc?.profileId);
          const hasPassedRect = Boolean(effect.rect && effect.rect.width > 50 && effect.rect.height > 50);
          const validBounds = hasPassedRect ? effect.rect : desc?.bounds && desc.bounds.width > 50 && desc.bounds.height > 50 && desc.bounds.x >= -50 ? desc.bounds : cryoVault.getValidBounds(effect.paneId);
          this.delegate.createPane(win, {
            paneId: effect.paneId,
            url: targetUrl,
            partition,
            userAgent: "",
            rect: validBounds
          });
          const targetView = viewRegistry.getView(effect.paneId);
          if (targetView && effect.scrollY && effect.scrollY > 0) {
            const targetY = effect.scrollY;
            targetView.webContents.once("dom-ready", () => {
              targetView.webContents.executeJavaScript(
                `window.scrollTo({ top: ${targetY}, behavior: "instant" })`
              ).catch(() => {
              });
            });
          }
          if (validBounds.x >= -50) {
            FocusArbiter.focusGuest(win, effect.paneId);
          }
        } finally {
          this.inFlightResurrections.delete(effect.paneId);
        }
        break;
      }
      case "BROADCAST_STATE_CHANGE": {
        const overlay = global.appOverlayView;
        if (!overlay || overlay.webContents.isDestroyed()) return;
        overlay.webContents.send("app:pane-cryo-state", {
          paneId: effect.paneId,
          tier: effect.tier,
          details: effect.details
        });
        if (effect.tier === "HIBERNATED") {
          const desc = cryoVault.retrieveDescriptor(effect.paneId);
          overlay.webContents.send("app:pane-hibernated", {
            paneId: effect.paneId,
            title: desc?.title || effect.details?.title || "Sleeping Tab",
            thumbnail: desc?.dataURL || effect.details?.snapshot || "",
            estimatedMemoryMb: desc?.estimatedMemoryMb || effect.details?.estimatedMemoryMb || 200
          });
        } else if (effect.tier === "ACTIVE") {
          overlay.webContents.send("app:pane-restored", { paneId: effect.paneId });
        } else if (effect.tier === "FROZEN") {
          overlay.webContents.send("app:pane-frozen", { paneId: effect.paneId });
        }
        break;
      }
    }
  }
  async runEffects(effects) {
    for (const effect of effects) {
      await this.runEffect(effect);
    }
  }
}
const cryoEffectRunner = new CryoEffectRunner();
class AudioMatrixService {
  sources = /* @__PURE__ */ new Map();
  allPanes = /* @__PURE__ */ new Map();
  masterMuted = false;
  registerPane(paneId, wc) {
    this.allPanes.set(paneId, { webContents: wc });
  }
  unregisterPane(paneId) {
    this.allPanes.delete(paneId);
    if (this.sources.has(paneId)) {
      this.sources.delete(paneId);
      this.broadcastChanges();
    }
  }
  handleAudioStarted(paneId, wc) {
    if (wc.isDestroyed()) return;
    this.allPanes.set(paneId, { webContents: wc });
    const info = {
      paneId,
      title: wc.getTitle() || "Audio Stream",
      url: wc.getURL() || "",
      isAudible: true,
      isMuted: wc.isAudioMuted(),
      lastAudibleAt: Date.now()
    };
    this.sources.set(paneId, info);
    this.broadcastChanges();
  }
  handleAudioStopped(paneId) {
    const existing = this.sources.get(paneId);
    if (existing) {
      existing.isAudible = false;
      this.broadcastChanges();
    }
  }
  handleDynamicStatus(paneId, status) {
    const pane = this.allPanes.get(paneId);
    const wc = pane?.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (status.isPlaying && status.isAudible) {
      this.handleAudioStarted(paneId, wc);
    } else if (!status.isPlaying || !status.isAudible) {
      this.handleAudioStopped(paneId);
    }
  }
  toggleMute(paneId) {
    const pane = this.allPanes.get(paneId);
    if (!pane || pane.webContents.isDestroyed()) return false;
    const nextMuted = !pane.webContents.isAudioMuted();
    pane.webContents.setAudioMuted(nextMuted);
    const info = this.sources.get(paneId);
    if (info) {
      info.isMuted = nextMuted;
      this.broadcastChanges();
    }
    return nextMuted;
  }
  setAudioMuted(paneId, muted) {
    const pane = this.allPanes.get(paneId);
    if (!pane || pane.webContents.isDestroyed()) return;
    pane.webContents.setAudioMuted(muted);
    const info = this.sources.get(paneId);
    if (info) {
      info.isMuted = muted;
      this.broadcastChanges();
    }
  }
  toggleMasterMute() {
    this.masterMuted = !this.masterMuted;
    for (const [paneId, { webContents: wc }] of this.allPanes.entries()) {
      if (!wc.isDestroyed()) {
        wc.setAudioMuted(this.masterMuted);
        const info = this.sources.get(paneId);
        if (info) info.isMuted = this.masterMuted;
      }
    }
    this.broadcastChanges();
    return this.masterMuted;
  }
  getActiveSources() {
    return Array.from(this.sources.values()).filter((s) => s.isAudible);
  }
  isPaneAudible(paneId) {
    return this.sources.get(paneId)?.isAudible ?? false;
  }
  broadcastChanges() {
    const active = this.getActiveSources();
    global.appOverlayView?.webContents?.send(
      "audio:active-sources-changed",
      active
    );
  }
  initIpc() {
    electron.ipcMain.handle("audio:toggle-mute", (_e, paneId) => {
      return this.toggleMute(paneId);
    });
    electron.ipcMain.handle("audio:toggle-master-mute", () => {
      return this.toggleMasterMute();
    });
    electron.ipcMain.handle("audio:get-active-sources", () => {
      return this.getActiveSources();
    });
  }
}
const audioMatrix = new AudioMatrixService();
const COMMUNICATION_DOMAINS = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "discord.com",
  "webex.com",
  "slack.com",
  "gather.town",
  "huddle"
];
const PERSISTENT_MEDIA_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "music.youtube.com",
  "spotify.com",
  "soundcloud.com",
  "twitch.tv",
  "netflix.com",
  "disneyplus.com",
  "primevideo.com",
  "hulu.com",
  "music.apple.com",
  "podcasts.apple.com",
  "vimeo.com",
  "bilibili.com",
  "dailymotion.com",
  "pandora.com",
  "deezer.com",
  "tidal.com"
];
function isPaneImmortalForCryo(paneId, view, activePaneId, activeTabPaneIds, isAppMinimized = false) {
  if (paneId === activePaneId) return true;
  if (!isAppMinimized && activeTabPaneIds?.includes(paneId)) return true;
  if (view.webContents.isDestroyed()) return true;
  const url = (view.webContents.getURL() || "").trim().toLowerCase();
  if (!url || url === "about:blank" || url.startsWith("chrome-error://")) return true;
  const isAudible = view.webContents.isCurrentlyAudible?.() || audioMatrix.isPaneAudible?.(paneId);
  if (isAudible) return true;
  if (COMMUNICATION_DOMAINS.some((domain) => url.includes(domain))) return true;
  if (PERSISTENT_MEDIA_DOMAINS.some((domain) => url.includes(domain))) return true;
  return false;
}
function computeCryoStats(frozenCount) {
  const hibernatedCount = viewRegistry.hibernatedViews.size;
  let saved = 0;
  for (const h of viewRegistry.hibernatedViews.values()) {
    saved += h.estimatedMemoryMb || 220;
  }
  saved += frozenCount * 80;
  return {
    totalTracked: viewRegistry.getAllActiveViews().size + hibernatedCount,
    frozenCount,
    hibernatedCount,
    estimatedSavedMb: Math.round(saved)
  };
}
try {
  v8.setFlagsFromString("--expose_gc");
} catch {
}
class HibernationEngine {
  state = createInitialCryoState();
  intervalTimer = null;
  bindLifecycle(delegate) {
    cryoEffectRunner.bindLifecycle(delegate);
  }
  setThresholds(freezeMs, hibernateMs) {
    if (freezeMs && freezeMs > 0) this.state.freezeThresholdMs = freezeMs;
    if (hibernateMs && hibernateMs > 0) this.state.hibernateThresholdMs = hibernateMs;
  }
  async dispatch(action) {
    const [nextState, effects] = reduceCryoState(this.state, action);
    this.state = nextState;
    await cryoEffectRunner.runEffects(effects);
  }
  registerPane(paneId, url, profileId) {
    this.dispatch({ type: "REGISTER_PANE", paneId, url, profileId, timestamp: Date.now() }).catch(() => {
    });
  }
  unregisterPane(paneId) {
    this.dispatch({ type: "UNREGISTER_PANE", paneId }).catch(() => {
    });
  }
  setActivePane(paneId) {
    this.dispatch({ type: "SET_ACTIVE_PANE", paneId, timestamp: Date.now() }).catch(() => {
    });
  }
  setActiveTabPanes(paneIds) {
    this.dispatch({ type: "SET_ACTIVE_TAB_PANES", paneIds, timestamp: Date.now() }).catch(() => {
    });
  }
  setAppMinimized(isMinimized) {
    this.dispatch({ type: "SET_APP_MINIMIZED", isMinimized, timestamp: Date.now() }).catch(() => {
    });
    if (isMinimized && typeof global.gc === "function") {
      try {
        global.gc();
      } catch {
      }
    }
  }
  registerActivity(paneId) {
    const now = Date.now();
    const pane = this.state.panes[paneId];
    if (pane && now - pane.lastActivityAt < 1e3 && pane.tier === "ACTIVE") return;
    this.dispatch({ type: "RECORD_ACTIVITY", paneId, timestamp: now }).catch(() => {
    });
    if (pane?.tier === "FROZEN") {
      this.dispatch({ type: "THAW_PANE", paneId, timestamp: now }).catch(() => {
      });
    }
  }
  updateScroll(paneId, scrollY) {
    this.dispatch({ type: "UPDATE_SCROLL", paneId, scrollY }).catch(() => {
    });
  }
  updatePaneUrl(paneId, url, title2) {
    if (!url?.trim()) return;
    this.dispatch({ type: "UPDATE_URL", paneId, url, title: title2, timestamp: Date.now() }).catch(() => {
    });
  }
  updateProtection(paneId, flags) {
    this.dispatch({ type: "UPDATE_PROTECTION", paneId, ...flags }).catch(() => {
    });
  }
  isFrozen(paneId) {
    return this.state.panes[paneId]?.tier === "FROZEN";
  }
  isHibernated(paneId) {
    return this.state.panes[paneId]?.tier === "HIBERNATED" || Boolean(cryoVault.retrieveDescriptor(paneId));
  }
  getPaneTier(paneId) {
    return this.state.panes[paneId]?.tier || "ACTIVE";
  }
  async freezePane(paneId) {
    const pane = this.state.panes[paneId];
    if (!pane || pane.tier !== "ACTIVE" || paneId === this.state.activePaneId) return false;
    const view = viewRegistry.getView(paneId);
    if (!view || isPaneImmortalForCryo(paneId, view, this.state.activePaneId, this.state.activeTabPaneIds, this.state.isAppMinimized)) return false;
    await this.dispatch({ type: "FREEZE_PANE", paneId, timestamp: Date.now() });
    return this.isFrozen(paneId);
  }
  async thawPane(paneId) {
    if (!this.isFrozen(paneId)) return false;
    await this.dispatch({ type: "THAW_PANE", paneId, timestamp: Date.now() });
    return !this.isFrozen(paneId);
  }
  async hibernatePane(paneId, options) {
    const pane = this.state.panes[paneId];
    const view = viewRegistry.getView(paneId);
    if (!options?.force && view && isPaneImmortalForCryo(paneId, view, this.state.activePaneId, this.state.activeTabPaneIds, this.state.isAppMinimized)) return false;
    await this.dispatch({
      type: "HIBERNATE_PANE",
      paneId,
      force: options?.force,
      timestamp: Date.now(),
      scrollY: pane?.scrollY,
      estimatedMemoryMb: pane?.estimatedMemoryMb
    });
    return this.isHibernated(paneId);
  }
  async wakePane(paneId, overrideUrl, rect) {
    await this.dispatch({
      type: "WAKE_PANE",
      paneId,
      overrideUrl,
      rect,
      timestamp: Date.now()
    });
    return !this.isHibernated(paneId);
  }
  getStats() {
    let frozenCount = 0;
    for (const p of Object.values(this.state.panes)) {
      if (p.tier === "FROZEN") frozenCount++;
    }
    return computeCryoStats(frozenCount);
  }
  init() {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => this.tick(), 15e3);
  }
  isPaneImmortal(paneId, pane) {
    if (paneId === this.state.activePaneId || pane.tier === "HIBERNATED") return true;
    if (this.state.activeTabPaneIds?.includes(paneId)) return true;
    if (!pane.url || pane.url.trim().length === 0 || pane.url === "about:blank") return true;
    const view = viewRegistry.getView(paneId);
    return Boolean(view && isPaneImmortalForCryo(paneId, view, this.state.activePaneId, this.state.activeTabPaneIds, this.state.isAppMinimized));
  }
  tick() {
    const now = Date.now();
    if (typeof global.gc === "function") {
      try {
        global.gc();
      } catch {
      }
    }
    try {
      const mem = process.getSystemMemoryInfo();
      if (mem.total > 0 && mem.free / mem.total < 0.03) {
        this.evictUnderPressure();
      }
    } catch {
    }
    for (const [paneId, pane] of Object.entries(this.state.panes)) {
      if (this.isPaneImmortal(paneId, pane)) continue;
      const idle = now - pane.lastActivityAt;
      if (idle >= this.state.hibernateThresholdMs) {
        this.hibernatePane(paneId).catch(() => {
        });
      } else if (idle >= this.state.freezeThresholdMs && pane.tier === "ACTIVE") {
        this.freezePane(paneId).catch(() => {
        });
      }
    }
  }
  evictUnderPressure() {
    for (const [paneId, pane] of Object.entries(this.state.panes)) {
      if (this.isPaneImmortal(paneId, pane)) continue;
      this.hibernatePane(paneId).catch(() => {
      });
    }
  }
  stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}
const hibernationEngine = new HibernationEngine();
const captureViewSafely = async (view) => {
  if (!view || view.webContents.isDestroyed()) return "";
  try {
    const bounds = view.getBounds();
    if (bounds.width <= 0 || bounds.height <= 0) return "";
    const capturePromise = view.webContents.capturePage({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    });
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 800));
    const img = await Promise.race([capturePromise, timeoutPromise]);
    if (img && !img.isEmpty()) {
      let finalImg = img;
      const size = img.getSize();
      if (size.width > 1200) {
        finalImg = img.resize({ width: 1200 });
      }
      return `data:image/jpeg;base64,${finalImg.toJPEG(75).toString("base64")}`;
    }
  } catch (err) {
    console.warn("[capture] capturePage failed:", err);
  }
  return "";
};
function initCaptureIpc() {
  electron.ipcMain.on("view.screenshot", async (_event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      try {
        const image = await view.webContents.capturePage();
        const { clipboard } = require("electron");
        clipboard.writeImage(image);
        if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
          global.appOverlayView.webContents.send("app:toast", {
            message: "Screenshot copied to clipboard",
            type: "success"
          });
        }
      } catch (err) {
        console.error("Failed to capture screenshot", err);
        if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
          global.appOverlayView.webContents.send("app:toast", {
            message: "Failed to copy screenshot",
            type: "error"
          });
        }
      }
    }
  });
  electron.ipcMain.handle(
    "view.capture",
    async (_event, paneId) => {
      const view = activeViews.get(paneId);
      if (!view || view.webContents.isDestroyed()) return Promise.resolve("");
      const dataURL = await captureViewSafely(view);
      return dataURL;
    }
  );
  electron.ipcMain.handle(
    "view.captureAllActive",
    async () => {
      const captures = {};
      for (const [paneId, view] of activeViews) {
        if (view.webContents.isDestroyed()) continue;
        const bounds = view.getBounds();
        if (bounds.width > 0 && bounds.height > 0) {
          const dataURL = await captureViewSafely(view);
          if (dataURL) captures[paneId] = dataURL;
        }
      }
      return captures;
    }
  );
  electron.ipcMain.handle(
    "view.hibernateAllActive",
    async () => {
      const captures = {};
      const paneIds = Array.from(activeViews.keys());
      for (const paneId of paneIds) {
        await hibernationEngine.hibernatePane(paneId);
        const desc = viewRegistry.getHibernated(paneId);
        if (desc) captures[paneId] = desc.dataURL;
      }
      return captures;
    }
  );
  electron.ipcMain.handle(
    "view.hibernate",
    async (_event, paneId) => {
      await hibernationEngine.hibernatePane(paneId);
      const desc = viewRegistry.getHibernated(paneId);
      return desc?.dataURL || "";
    }
  );
}
createLogger("VIEW");
function initViewIpc() {
  electron.ipcMain.on("view.registerWebContents", (_event, paneId, wcId) => {
    if (paneId && typeof wcId === "number") {
      viewRegistry.webContentsIdToPaneId.set(wcId, paneId);
    }
  });
  electron.ipcMain.on("pane.clicked", (event) => {
    for (const [paneId, view] of activeViews) {
      if (view.webContents === event.sender) {
        if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
          global.appOverlayView.webContents.send("pane.focused", paneId);
        }
        break;
      }
    }
  });
  electron.ipcMain.on("view.openDevTools", (_event, paneId) => {
    const view = activeViews.get(paneId);
    if (!view || view.webContents.isDestroyed()) return;
    if (view.webContents.isDevToolsOpened()) return;
    activeViews.forEach((v) => {
      if (!v.webContents.isDestroyed() && v.webContents.isDevToolsOpened()) {
        v.webContents.closeDevTools();
      }
    });
    view.webContents.openDevTools({ mode: "undocked" });
  });
  electron.ipcMain.on("view.closeDevTools", (_event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.closeDevTools();
    }
  });
  electron.ipcMain.on("view.hideDevTools", () => {
    activeViews.forEach((v) => {
      if (!v.webContents.isDestroyed()) v.webContents.closeDevTools();
    });
  });
  electron.ipcMain.on("view.zoomIn", (_, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      const level = view.webContents.getZoomLevel();
      view.webContents.setZoomLevel(level + 0.5);
    }
  });
  electron.ipcMain.on("view.zoomOut", (_, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      const level = view.webContents.getZoomLevel();
      view.webContents.setZoomLevel(level - 0.5);
    }
  });
  electron.ipcMain.on("view.zoomReset", (_, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setZoomLevel(0);
    }
  });
  electron.ipcMain.on("view.sleep", (_event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setBackgroundThrottling(true);
      view.webContents.setAudioMuted(true);
      view.setBounds({ x: -1e4, y: -1e4, width: 0, height: 0 });
    }
  });
  electron.ipcMain.on("view.wake", (_event, paneId, bounds) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setBackgroundThrottling(false);
      view.webContents.setAudioMuted(false);
      if (bounds) view.setBounds(bounds);
    }
  });
  electron.ipcMain.removeAllListeners("auth:trigger-autofill");
  electron.ipcMain.on("auth:trigger-autofill", (_event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send("auth:trigger-autofill");
    }
  });
}
function initViewManager() {
  initCaptureIpc();
  initViewIpc();
}
const DEFAULT_WINDOW_DIMENSIONS = {
  x: 0,
  y: 0,
  width: 1200,
  height: 800
};
const MIN_WINDOW_DIMENSIONS = {
  width: 400,
  height: 300
};
const TITLEBAR_HEIGHT = 40;
const MIN_TITLEBAR_VISIBLE_WIDTH = 100;
const MIN_TITLEBAR_VISIBLE_HEIGHT = 20;
function isFiniteRect(r) {
  return r != null && typeof r.x === "number" && Number.isFinite(r.x) && typeof r.y === "number" && Number.isFinite(r.y) && typeof r.width === "number" && Number.isFinite(r.width) && r.width > 0 && typeof r.height === "number" && Number.isFinite(r.height) && r.height > 0;
}
function computeIntersectionArea(a, b) {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return { area: overlapX * overlapY, overlapX, overlapY };
}
function hasViableTitlebar(bounds, display) {
  const titlebarRect = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: Math.min(TITLEBAR_HEIGHT, bounds.height)
  };
  const { overlapX, overlapY } = computeIntersectionArea(titlebarRect, display.workArea);
  if (overlapX < MIN_TITLEBAR_VISIBLE_WIDTH || overlapY < MIN_TITLEBAR_VISIBLE_HEIGHT) {
    return false;
  }
  if (bounds.y < display.workArea.y - 10) {
    return false;
  }
  return true;
}
function centerInWorkArea(target, width, height) {
  const clampedWidth = Math.min(Math.max(width, MIN_WINDOW_DIMENSIONS.width), target.width);
  const clampedHeight = Math.min(Math.max(height, MIN_WINDOW_DIMENSIONS.height), target.height);
  const x = Math.round(target.x + (target.width - clampedWidth) / 2);
  const y = Math.round(target.y + (target.height - clampedHeight) / 2);
  return { x, y, width: clampedWidth, height: clampedHeight };
}
function isRectMatchingWorkArea(bounds, workArea, tolerance = 2) {
  return Math.abs(bounds.x - workArea.x) <= tolerance && Math.abs(bounds.y - workArea.y) <= tolerance && Math.abs(bounds.width - workArea.width) <= tolerance && Math.abs(bounds.height - workArea.height) <= tolerance;
}
function resolveSafeWindowBounds(saved, displays, defaults = DEFAULT_WINDOW_DIMENSIONS, isMac = typeof process !== "undefined" && process.platform === "darwin") {
  const isMaximized = saved != null ? Boolean(saved.isMaximized) : isMac ? false : true;
  const isFullScreen = isMac ? saved != null ? Boolean(saved.isFullScreen || saved.isMaximized) : true : Boolean(saved?.isFullScreen);
  const primary = displays.find((d) => d.isPrimary) || displays[0];
  if (!primary) {
    return {
      bounds: { ...defaults },
      isMaximized,
      isFullScreen
    };
  }
  const isSane = isFiniteRect(saved) && saved.x > -1e4 && saved.y > -1e4 && saved.width >= MIN_WINDOW_DIMENSIONS.width && saved.height >= MIN_WINDOW_DIMENSIONS.height;
  if (!isSane || !saved) {
    const defaultBounds = centerInWorkArea(primary.workArea, defaults.width, defaults.height);
    return { bounds: defaultBounds, isMaximized, isFullScreen };
  }
  const matchingDisplay = displays.find((d) => hasViableTitlebar(saved, d));
  if (matchingDisplay) {
    return {
      bounds: { x: Math.round(saved.x), y: Math.round(saved.y), width: Math.round(saved.width), height: Math.round(saved.height) },
      isMaximized,
      isFullScreen
    };
  }
  const projectedBounds = centerInWorkArea(primary.workArea, saved.width, saved.height);
  return {
    bounds: projectedBounds,
    isMaximized,
    isFullScreen
  };
}
function toggleZoomBounds(current, workArea, lastNormal) {
  if (isRectMatchingWorkArea(current, workArea)) {
    const fallback = centerInWorkArea(workArea, 1200, 800);
    const valid = isFiniteRect(lastNormal) && !isRectMatchingWorkArea(lastNormal, workArea);
    const restore = valid ? lastNormal : fallback;
    return { nextBounds: restore, isMaximized: false, nextNormal: restore };
  }
  return {
    nextBounds: workArea,
    isMaximized: true,
    nextNormal: isFiniteRect(current) ? current : lastNormal
  };
}
const log = createLogger("WINDOW");
class WindowStateManager {
  activeWindow = null;
  lastNormalBounds = { x: 0, y: 0, width: 1200, height: 800 };
  maximized = false;
  fullScreen = false;
  frozen = false;
  debounceTimer = null;
  displayRemovedListener = null;
  mapDisplays(displays) {
    const pid = electron.screen.getPrimaryDisplay()?.id;
    return displays.map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, isPrimary: d.id === pid }));
  }
  getInitialState() {
    const displays = this.mapDisplays(electron.screen.getAllDisplays());
    const saved = getSavedWindowState();
    const resolved = resolveSafeWindowBounds(saved, displays);
    this.lastNormalBounds = { ...resolved.bounds };
    this.maximized = resolved.isMaximized;
    this.fullScreen = resolved.isFullScreen;
    log.info(`Resolved window state: bounds=${JSON.stringify(resolved.bounds)} max=${resolved.isMaximized}`);
    return resolved;
  }
  savedFsOnClose = false;
  savedMaxOnClose = false;
  shouldMaximize() {
    return this.maximized;
  }
  shouldFullScreen() {
    return this.fullScreen;
  }
  freezeForClose() {
    this.frozen = true;
    this.savedFsOnClose = this.fullScreen;
    this.savedMaxOnClose = this.maximized;
  }
  unfreeze() {
    this.frozen = false;
  }
  toggleMacZoom(win) {
    if (!win || win.isDestroyed()) return;
    const workArea = electron.screen.getDisplayMatching(win.getBounds()).workArea;
    const { nextBounds, isMaximized, nextNormal } = toggleZoomBounds(win.getBounds(), workArea, this.lastNormalBounds);
    this.lastNormalBounds = nextNormal;
    this.maximized = isMaximized;
    win.setBounds(nextBounds);
    this.scheduleDebouncedSave(100);
    global.appOverlayView?.webContents.send("window:maximize-changed", isMaximized);
  }
  manage(win) {
    this.activeWindow = win;
    win.on("show", () => {
      this.unfreeze();
    });
    try {
      if (this.fullScreen || process.platform === "darwin" && this.maximized) win.setFullScreen(true);
      else if (this.maximized) win.maximize();
    } catch {
    }
    const onBoundsChange = () => {
      if (this.frozen || !win || win.isDestroyed() || win.isMinimized() || !win.isVisible()) return;
      const isMax = win.isMaximized() || process.platform === "darwin" && isRectMatchingWorkArea(win.getBounds(), electron.screen.getDisplayMatching(win.getBounds()).workArea);
      if (isMax || win.isFullScreen()) {
        this.maximized = isMax;
        this.fullScreen = win.isFullScreen();
        this.scheduleDebouncedSave();
        return;
      }
      const bounds = win.getBounds();
      if (isFiniteRect(bounds)) {
        this.lastNormalBounds = { ...bounds };
        this.maximized = false;
        this.fullScreen = false;
        this.scheduleDebouncedSave();
      }
    };
    win.on("resize", onBoundsChange);
    win.on("move", onBoundsChange);
    win.on("maximize", () => {
      this.maximized = true;
      try {
        const nb = win.getNormalBounds();
        if (isFiniteRect(nb)) this.lastNormalBounds = { ...nb };
      } catch {
      }
      this.scheduleDebouncedSave(100);
    });
    win.on("unmaximize", () => {
      this.maximized = false;
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isMaximized() && !win.isFullScreen()) {
          const bounds = win.getBounds();
          if (isFiniteRect(bounds)) this.lastNormalBounds = { ...bounds };
          this.scheduleDebouncedSave(100);
        }
      }, 60);
    });
    win.on("enter-full-screen", () => {
      this.fullScreen = true;
      this.scheduleDebouncedSave(100);
    });
    win.on("leave-full-screen", () => {
      if (this.frozen) return;
      this.fullScreen = false;
      this.scheduleDebouncedSave(100);
    });
    win.on("close", () => {
      this.flushSync();
    });
    win.on("closed", () => {
      this.unmanage();
    });
    this.displayRemovedListener = () => {
      if (!this.activeWindow || this.activeWindow.isDestroyed()) return;
      const displays = this.mapDisplays(electron.screen.getAllDisplays());
      const currentBounds = this.activeWindow.getBounds();
      const isVisible = displays.some((d) => hasViableTitlebar(currentBounds, d));
      if (!isVisible) {
        log.warn("Active window stranded off-screen after display removal, recovering to primary");
        const recovered = resolveSafeWindowBounds(
          { ...this.lastNormalBounds, isMaximized: this.maximized, isFullScreen: this.fullScreen },
          displays
        );
        if (this.activeWindow.isMaximized()) {
          this.activeWindow.unmaximize();
          this.activeWindow.setBounds(recovered.bounds);
          this.activeWindow.maximize();
        } else {
          this.activeWindow.setBounds(recovered.bounds);
          this.lastNormalBounds = recovered.bounds;
        }
        this.flushSync();
      }
    };
    electron.screen.on("display-removed", this.displayRemovedListener);
  }
  scheduleDebouncedSave(delayMs = 500) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.flushSync();
    }, delayMs);
  }
  flushSync() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (!this.lastNormalBounds || !isFiniteRect(this.lastNormalBounds)) return;
    if (this.activeWindow && !this.activeWindow.isDestroyed()) {
      if (this.frozen) {
        this.fullScreen = this.savedFsOnClose;
        this.maximized = this.savedMaxOnClose;
      } else {
        const isMax = this.activeWindow.isMaximized() || process.platform === "darwin" && isRectMatchingWorkArea(this.activeWindow.getBounds(), electron.screen.getDisplayMatching(this.activeWindow.getBounds()).workArea);
        this.maximized = isMax ? true : !this.activeWindow.isMinimized() ? false : this.maximized;
        this.fullScreen = this.activeWindow.isFullScreen();
      }
    }
    saveWindowState({
      x: this.lastNormalBounds.x,
      y: this.lastNormalBounds.y,
      width: this.lastNormalBounds.width,
      height: this.lastNormalBounds.height,
      isMaximized: this.maximized,
      isFullScreen: this.fullScreen
    });
  }
  unmanage() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.displayRemovedListener) {
      electron.screen.removeListener("display-removed", this.displayRemovedListener);
      this.displayRemovedListener = null;
    }
    this.activeWindow = null;
  }
}
const windowStateManager = new WindowStateManager();
const tearWindows = /* @__PURE__ */ new Map();
function initTearWindowIpc() {
  electron.ipcMain.on("tear-update", (_event, paneId, x, y) => {
    let win = tearWindows.get(paneId);
    if (!win) {
      win = new electron.BrowserWindow({
        width: 400,
        height: 300,
        x: x - 200,
        y: y - 20,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        webPreferences: { preload: path.join(__dirname, "../preload/index.js") }
      });
      win.__isTearWindow = true;
      win.setOpacity(0.8);
      if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}#tear-${paneId}`);
      } else {
        win.loadFile(path.join(__dirname, "../renderer/index.html"), {
          hash: `tear-${paneId}`
        });
      }
      tearWindows.set(paneId, win);
    } else {
      win.setPosition(Math.round(x - 200), Math.round(y - 20));
      if (!win.isVisible()) win.show();
    }
  });
  electron.ipcMain.on("tear-hide", (_event, paneId) => {
    const win = tearWindows.get(paneId);
    if (win && win.isVisible()) win.hide();
  });
  electron.ipcMain.on("tear-commit", (_event, paneId) => {
    const win = tearWindows.get(paneId);
    if (win) {
      const bounds = win.getBounds();
      win.destroy();
      tearWindows.delete(paneId);
      const finalWin = new electron.BrowserWindow({
        ...bounds,
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#ffffff",
          symbolColor: "#737373",
          height: 40
        },
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.js"),
          webviewTag: true,
          safeDialogs: true
        }
      });
      finalWin.__isTearWindow = true;
      if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        finalWin.loadURL(
          `${process.env["ELECTRON_RENDERER_URL"]}#standalone-${paneId}`
        );
      } else {
        finalWin.loadFile(path.join(__dirname, "../renderer/index.html"), {
          hash: `standalone-${paneId}`
        });
      }
    }
  });
}
function initWindowManagerIpc() {
  electron.ipcMain.on(IPC_CHANNELS.WINDOW.MINIMIZE, () => {
    global.mainWindow?.minimize();
  });
  electron.ipcMain.on(IPC_CHANNELS.WINDOW.MAXIMIZE, () => {
    const win = global.mainWindow;
    if (win && !win.isDestroyed()) {
      if (process.platform === "darwin") {
        win.setFullScreen(!win.isFullScreen());
      } else {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
    }
  });
  electron.ipcMain.on(IPC_CHANNELS.WINDOW.TOGGLE_FULLSCREEN, () => {
    const win = global.mainWindow;
    if (win && !win.isDestroyed()) {
      win.setFullScreen(!win.isFullScreen());
    }
  });
  electron.ipcMain.on(IPC_CHANNELS.WINDOW.SET_FULLSCREEN, (_event, flag) => {
    const win = global.mainWindow;
    if (win && !win.isDestroyed()) {
      win.setFullScreen(Boolean(flag));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.WINDOW.IS_FULLSCREEN, () => {
    return Boolean(global.mainWindow?.isFullScreen());
  });
  electron.ipcMain.on(IPC_CHANNELS.WINDOW.CLOSE, () => {
    global.mainWindow?.close();
  });
  electron.ipcMain.on("window.focus-main", () => {
    FocusArbiter.focusOverlay(global.mainWindow);
  });
  electron.ipcMain.on("app:focus-overlay-window", () => {
    FocusArbiter.focusOverlay(global.mainWindow);
  });
  electron.ipcMain.on(IPC_CHANNELS.WINDOW.OPEN_INTERNAL_DEVTOOLS, () => {
    if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
      global.appOverlayView.webContents.openDevTools({ mode: "undocked" });
    }
  });
  electron.ipcMain.on(IPC_CHANNELS.WINDOW.CLOSE_INTERNAL_DEVTOOLS, () => {
    if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
      global.appOverlayView.webContents.closeDevTools();
    }
  });
  initTearWindowIpc();
}
const logger$5 = createLogger("UPDATE");
const REPO_URL = "https://github.com/jvondev/apposition-releases";
class WindowsUpdateDriver {
  name = "windows-velopack";
  updateManager = null;
  pendingUpdateInfo = null;
  isSupported() {
    return process.platform === "win32" && electron.app.isPackaged;
  }
  getManager() {
    if (!this.isSupported()) return null;
    if (!this.updateManager) {
      try {
        this.updateManager = new velopack.UpdateManager(new velopack.GithubSource(REPO_URL, void 0, false));
      } catch (err) {
        logger$5.warn("Velopack UpdateManager init failed", err?.message || err);
      }
    }
    return this.updateManager;
  }
  async checkForUpdates() {
    const um = this.getManager();
    if (!um) {
      return { hasUpdate: false };
    }
    try {
      const updateInfo = await um.checkForUpdatesAsync();
      this.pendingUpdateInfo = updateInfo;
      if (!updateInfo) {
        return { hasUpdate: false };
      }
      const version2 = updateInfo.TargetFullRelease?.Version || "latest";
      const releaseNotes = updateInfo.TargetFullRelease?.NotesMarkdown || void 0;
      return {
        hasUpdate: true,
        version: version2,
        releaseNotes
      };
    } catch (err) {
      logger$5.warn("Velopack check failed", err?.message || err);
      throw err;
    }
  }
  async downloadUpdate(onProgress) {
    const um = this.getManager();
    if (!um || !this.pendingUpdateInfo) {
      throw new Error("No pending update to download on Windows.");
    }
    try {
      await um.downloadUpdateAsync(this.pendingUpdateInfo, (percent) => {
        onProgress(Math.min(100, Math.max(0, Math.round(percent))));
      });
      onProgress(100);
    } catch (err) {
      logger$5.error("Velopack download failed", err?.message || err);
      throw err;
    }
  }
  async applyUpdate(relaunch = true, launchArgs = []) {
    const um = this.getManager();
    if (!um || !this.pendingUpdateInfo) {
      throw new Error("No downloaded update to apply on Windows.");
    }
    logger$5.info("Applying Velopack update silently and restarting...");
    um.waitExitThenApplyUpdate(this.pendingUpdateInfo, true, relaunch, launchArgs || []);
    if (relaunch) electron.app.quit();
  }
}
const GITHUB_REPO = "jvondev/apposition-releases";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const LATEST_API = `${RELEASES_API}/latest`;
const FALLBACK_CDN = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/releases.json`;
async function fetchLatestRelease(isPreRelease = false) {
  const url = isPreRelease ? RELEASES_API : LATEST_API;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Apposition-Desktop-Client" }
    });
    if (res.ok) {
      const json = await res.json();
      let data = json;
      if (isPreRelease && Array.isArray(json)) {
        const candidates = json.filter((r) => r.prerelease && !r.draft);
        candidates.sort((a, b) => {
          const vA = (a.tag_name || "").replace(/^v/, "").trim();
          const vB = (b.tag_name || "").replace(/^v/, "").trim();
          const cmp = compareSemver(vB, vA);
          return cmp !== 0 ? cmp : new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime();
        });
        data = candidates[0];
      }
      if (data && data.tag_name) {
        return {
          version: (data.tag_name || "").replace(/^v/, "").trim(),
          tag: data.tag_name || "",
          body: data.body || "",
          assets: (data.assets || []).map((a) => ({
            name: a.name,
            browser_download_url: a.browser_download_url,
            size: a.size || 0
          }))
        };
      }
    }
  } catch {
  }
  try {
    const res = await fetch(FALLBACK_CDN, {
      headers: { "User-Agent": "Apposition-Desktop-Client" }
    });
    if (res.ok) {
      const releases = await res.json();
      if (Array.isArray(releases) && releases.length > 0) {
        const top = releases[0];
        return {
          version: (top.version || "").replace(/^v/, "").trim(),
          tag: top.tag || `v${top.version}`,
          body: top.title || "",
          assets: []
        };
      }
    }
  } catch {
  }
  return null;
}
function isNewerVersion(remoteVersion, currentVersion) {
  return compareSemver(remoteVersion, currentVersion) > 0;
}
function downloadFileWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destPath);
    let lastBytes = 0;
    let lastTime = Date.now();
    let redirectCount = 0;
    const MAX_REDIRECTS = 5;
    const request = (targetUrl) => {
      try {
        const parsedUrl = new URL(targetUrl);
        if (parsedUrl.protocol !== "https:") {
          fileStream.close();
          fs.unlink(destPath, () => {
          });
          reject(new Error(`Insecure download protocol: ${parsedUrl.protocol}`));
          return;
        }
        https.get(targetUrl, { headers: { "User-Agent": "Apposition-Desktop-Client" } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            redirectCount++;
            if (redirectCount > MAX_REDIRECTS) {
              fileStream.close();
              fs.unlink(destPath, () => {
              });
              reject(new Error("Too many redirects during download"));
              return;
            }
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            fileStream.close();
            fs.unlink(destPath, () => {
            });
            reject(new Error(`Download failed with status code ${res.statusCode}`));
            return;
          }
          const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
          let receivedBytes = 0;
          let lastReportedPercent = -1;
          let lastReportedTime = 0;
          res.on("data", (chunk) => {
            receivedBytes += chunk.length;
            const now = Date.now();
            const elapsed = (now - lastTime) / 1e3;
            let bytesPerSec;
            if (elapsed >= 0.5) {
              bytesPerSec = Math.round((receivedBytes - lastBytes) / elapsed);
              lastBytes = receivedBytes;
              lastTime = now;
            }
            if (totalBytes > 0) {
              const percent = Math.min(100, Math.round(receivedBytes / totalBytes * 100));
              if (percent === 100 || percent !== lastReportedPercent && now - lastReportedTime >= 150) {
                lastReportedPercent = percent;
                lastReportedTime = now;
                onProgress(percent, bytesPerSec);
              }
            }
          });
          res.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close(() => {
              onProgress(100);
              resolve();
            });
          });
        }).on("error", (err) => {
          fileStream.close();
          fs.unlink(destPath, () => {
          });
          reject(err);
        });
      } catch (err) {
        fileStream.close();
        fs.unlink(destPath, () => {
        });
        reject(err);
      }
    };
    request(url);
  });
}
const logger$4 = createLogger("UPDATE");
const execFileAsync = util.promisify(child_process.execFile);
function resolveDestinationApp(execPath = process.execPath) {
  const match = execPath.match(/^(.+?\.app)(?:\/.*)?$/);
  if (match && !match[1].startsWith("/Volumes/")) {
    return match[1];
  }
  return "/Applications/Apposition.app";
}
class MacosUpdateDriver {
  name = "macos-dmg";
  targetVersion;
  downloadUrl;
  releaseNotes;
  downloadedDmgPath;
  isSupported() {
    return process.platform === "darwin";
  }
  async checkForUpdates() {
    const currentVersion = electron.app.getVersion();
    const isPreRelease = currentVersion.includes("-");
    const release = await fetchLatestRelease(isPreRelease);
    if (!release) return { hasUpdate: false };
    if (!isNewerVersion(release.version, currentVersion)) {
      return { hasUpdate: false };
    }
    const isArm = process.arch === "arm64";
    let matchingAsset = release.assets.find(
      (a) => isArm ? /arm64.*\.dmg$/i.test(a.name) : /\.dmg$/i.test(a.name) && !/arm64/i.test(a.name)
    );
    if (!matchingAsset) {
      matchingAsset = release.assets.find((a) => /\.dmg$/i.test(a.name));
    }
    if (!matchingAsset) {
      return { hasUpdate: false };
    }
    this.targetVersion = release.version;
    this.downloadUrl = matchingAsset.browser_download_url;
    this.releaseNotes = release.body;
    return {
      hasUpdate: true,
      version: release.version,
      releaseNotes: release.body,
      downloadUrl: matchingAsset.browser_download_url
    };
  }
  async downloadUpdate(onProgress) {
    if (!this.downloadUrl || !this.targetVersion) {
      throw new Error("No update available to download on macOS.");
    }
    const tempDir = electron.app.getPath("temp");
    const dmgPath = path.join(tempDir, `Apposition-${this.targetVersion}.dmg`);
    logger$4.info(`Downloading macOS DMG from ${this.downloadUrl} to ${dmgPath}`);
    await downloadFileWithProgress(this.downloadUrl, dmgPath, onProgress);
    this.downloadedDmgPath = dmgPath;
    logger$4.info("macOS DMG download verified.");
  }
  async applyUpdate(relaunch = true, launchArgs = []) {
    if (!this.downloadedDmgPath || !fs.existsSync(this.downloadedDmgPath)) {
      throw new Error("Downloaded DMG not found.");
    }
    const dmgPath = this.downloadedDmgPath;
    const tempDir = electron.app.getPath("temp");
    const mountDir = path.join(tempDir, `apposition-mount-${Date.now()}`);
    const destApp = resolveDestinationApp();
    try {
      logger$4.info(`Mounting DMG ${dmgPath} to ${mountDir}`);
      await fs.promises.mkdir(mountDir, { recursive: true });
      await execFileAsync("hdiutil", ["attach", dmgPath, "-nobrowse", "-quiet", "-mountpoint", mountDir]);
      const entries = await fs.promises.readdir(mountDir);
      const appFolder = entries.find((e) => e.endsWith(".app"));
      if (!appFolder) {
        throw new Error("Could not find .app in mounted DMG.");
      }
      const srcApp = path.join(mountDir, appFolder);
      const workerScriptPath = path.join(tempDir, `apposition-update-worker-${Date.now()}.sh`);
      const logFile = path.join(electron.app.getPath("userData"), "update-worker.log");
      const scriptContent = `#!/bin/bash
set -u
PID="$1"
SRC="$2"
DEST="$3"
MOUNT="$4"
DMG="$5"
LOG="$6"
RELAUNCH="$7"
ARGS="\${8:-}"

echo "=== Apposition macOS Update Worker ===" >> "$LOG"
echo "Target: $DEST" >> "$LOG"
echo "Source: $SRC" >> "$LOG"

# 1. Wait for parent PID to exit cleanly (max 15s)
COUNT=0
while kill -0 "$PID" 2>/dev/null; do
  sleep 0.2
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -ge 75 ]; then
    kill -9 "$PID" 2>/dev/null || true
    sleep 0.2
    break
  fi
done

# 2. Atomic bundle copy with Apple ditto tool (preserves Mach-O permissions & symlinks)
rm -rf "$DEST"
ditto "$SRC" "$DEST"

# 3. Ensure executable permission on binary
chmod -R a+rx "$DEST/Contents/MacOS" 2>/dev/null || true

# 4. Clear Gatekeeper quarantine
xattr -cr "$DEST" 2>/dev/null || true
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# 5. Relaunch fresh application immediately if requested (minimizes downtime)
if [ "$RELAUNCH" = "1" ]; then
  if [ -n "$ARGS" ]; then
    open -g -n -a "$DEST" --args $ARGS
  else
    open -n -a "$DEST"
  fi
fi

# 6. Background cleanup: detach DMG and clean temp
hdiutil detach "$MOUNT" -quiet -force 2>/dev/null || true
rm -f "$DMG" 2>/dev/null || true
echo "Update applied successfully!" >> "$LOG"
`;
      await fs.promises.writeFile(workerScriptPath, scriptContent, { mode: 493 });
      logger$4.info(`Spawning detached macOS update worker for ${destApp} (relaunch=${relaunch})...`);
      const child = child_process.spawn("/bin/bash", [
        workerScriptPath,
        String(process.pid),
        srcApp,
        destApp,
        mountDir,
        dmgPath,
        logFile,
        relaunch ? "1" : "0",
        (launchArgs || []).join(" ")
      ], {
        detached: true,
        stdio: "ignore"
      });
      child.unref();
      if (relaunch) {
        electron.app.exit(0);
      }
    } catch (err) {
      logger$4.error("Failed to stage macOS update worker", err?.message || err);
      await execFileAsync("hdiutil", ["detach", mountDir, "-quiet"]).catch(() => {
      });
      throw err;
    }
  }
}
const logger$3 = createLogger("UPDATE");
class LinuxUpdateDriver {
  name = "linux-appimage";
  targetVersion;
  downloadUrl;
  releaseNotes;
  downloadedAppImagePath;
  isSupported() {
    return process.platform === "linux";
  }
  isAppImage() {
    return Boolean(process.env.APPIMAGE);
  }
  async checkForUpdates() {
    const release = await fetchLatestRelease();
    if (!release) return { hasUpdate: false };
    const currentVersion = electron.app.getVersion();
    if (!isNewerVersion(release.version, currentVersion)) {
      return { hasUpdate: false };
    }
    this.targetVersion = release.version;
    this.releaseNotes = release.body;
    if (!this.isAppImage()) {
      const debAsset = release.assets.find((a) => /\.deb$/i.test(a.name));
      const downloadUrl = debAsset?.browser_download_url || `https://github.com/jvondev/apposition-releases/releases/tag/v${release.version}`;
      return {
        hasUpdate: true,
        version: release.version,
        releaseNotes: release.body,
        downloadUrl,
        manualActionRequired: true,
        manualReason: "linux-deb",
        terminalCommand: "curl -fsSL https://raw.githubusercontent.com/jvondev/apposition-releases/main/scripts/install-linux.sh | bash"
      };
    }
    const appImageAsset = release.assets.find((a) => /\.AppImage$/i.test(a.name));
    if (!appImageAsset) {
      return { hasUpdate: false };
    }
    this.downloadUrl = appImageAsset.browser_download_url;
    return {
      hasUpdate: true,
      version: release.version,
      releaseNotes: release.body,
      downloadUrl: appImageAsset.browser_download_url
    };
  }
  async downloadUpdate(onProgress) {
    if (!this.isAppImage() || !this.downloadUrl || !this.targetVersion) {
      throw new Error("No AppImage update available to download.");
    }
    const tempDir = electron.app.getPath("temp");
    const appImagePath = path.join(tempDir, `Apposition-${this.targetVersion}.AppImage`);
    logger$3.info(`Downloading Linux AppImage from ${this.downloadUrl} to ${appImagePath}`);
    await downloadFileWithProgress(this.downloadUrl, appImagePath, onProgress);
    await fs.promises.chmod(appImagePath, 493);
    this.downloadedAppImagePath = appImagePath;
    logger$3.info("Linux AppImage download verified and made executable.");
  }
  async applyUpdate(relaunch = true, launchArgs = []) {
    const currentAppImage = process.env.APPIMAGE;
    if (!this.downloadedAppImagePath || !currentAppImage || !fs.existsSync(this.downloadedAppImagePath)) {
      throw new Error("Target AppImage executable not found.");
    }
    logger$3.info(`Replacing ${currentAppImage} with ${this.downloadedAppImagePath}`);
    const targetDir = path.dirname(currentAppImage);
    const tempInSameDir = path.join(targetDir, `.${path.basename(currentAppImage)}.update-${Date.now()}`);
    try {
      await fs.promises.copyFile(this.downloadedAppImagePath, tempInSameDir);
      await fs.promises.chmod(tempInSameDir, 493);
      await fs.promises.rename(tempInSameDir, currentAppImage);
      await fs.promises.rm(this.downloadedAppImagePath, { force: true }).catch(() => {
      });
      if (relaunch) {
        logger$3.info("Linux AppImage in-place update completed. Spawning detached process...");
        const child = child_process.spawn(currentAppImage, [...process.argv.slice(1), ...launchArgs || []], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, APPIMAGE: currentAppImage }
        });
        child.unref();
        electron.app.exit(0);
      } else {
        logger$3.info("Linux AppImage in-place update completed (silent on-quit).");
      }
    } catch (err) {
      await fs.promises.rm(tempInSameDir, { force: true }).catch(() => {
      });
      logger$3.error("Failed to perform in-place Linux update", err?.message || err);
      throw err;
    }
  }
}
const logger$2 = createLogger("UPDATE");
class FallbackEngine {
  targetVersion;
  downloadUrl;
  downloadedFilePath;
  releaseNotes;
  rescueUrl;
  async checkForUpdates() {
    const release = await fetchLatestRelease();
    if (!release) return { hasUpdate: false };
    const currentVersion = electron.app.getVersion();
    if (!isNewerVersion(release.version, currentVersion)) {
      return { hasUpdate: false };
    }
    const rescueUrl = `https://github.com/jvondev/apposition-releases/releases/tag/${release.tag || `v${release.version}`}`;
    this.rescueUrl = rescueUrl;
    this.targetVersion = release.version;
    this.releaseNotes = release.body;
    const matchedAsset = this.resolveAssetForPlatform(release.assets);
    if (!matchedAsset) {
      return {
        hasUpdate: true,
        version: release.version,
        releaseNotes: release.body,
        manualActionRequired: true,
        manualReason: "fallback-exhausted",
        downloadUrl: rescueUrl,
        rescueUrl
      };
    }
    this.downloadUrl = matchedAsset.browser_download_url;
    return {
      hasUpdate: true,
      version: release.version,
      releaseNotes: release.body,
      downloadUrl: matchedAsset.browser_download_url,
      rescueUrl
    };
  }
  resolveAssetForPlatform(assets) {
    if (process.platform === "win32") {
      return assets.find((a) => /Apposition.*Setup\.exe$/i.test(a.name)) || assets.find((a) => /Apposition.*\.exe$/i.test(a.name));
    }
    if (process.platform === "darwin") {
      const isArm = process.arch === "arm64";
      return assets.find((a) => isArm ? /arm64.*\.dmg$/i.test(a.name) : /\.dmg$/i.test(a.name) && !/arm64/i.test(a.name)) || assets.find((a) => /\.dmg$/i.test(a.name));
    }
    if (process.platform === "linux") {
      return assets.find((a) => /\.AppImage$/i.test(a.name)) || assets.find((a) => /\.deb$/i.test(a.name));
    }
    return void 0;
  }
  async downloadUpdate(onProgress) {
    if (!this.downloadUrl || !this.targetVersion) {
      throw new Error("No fallback update available to download.");
    }
    const tempDir = electron.app.getPath("temp");
    const ext = process.platform === "win32" ? ".exe" : process.platform === "darwin" ? ".dmg" : ".AppImage";
    const destPath = path.join(tempDir, `Apposition-${this.targetVersion}-installer${ext}`);
    logger$2.info(`Streaming Tier 2 fallback binary from ${this.downloadUrl} to ${destPath}`);
    await downloadFileWithProgress(this.downloadUrl, destPath, onProgress);
    if (process.platform !== "win32") {
      await fs.promises.chmod(destPath, 493).catch(() => {
      });
    }
    this.downloadedFilePath = destPath;
    logger$2.info("Tier 2 fallback binary verified and staged.");
    return destPath;
  }
  async applyUpdate(relaunch = true, _launchArgs = []) {
    if (!this.downloadedFilePath || !fs.existsSync(this.downloadedFilePath)) {
      throw new Error("Staged fallback installer not found.");
    }
    const installerPath = this.downloadedFilePath;
    logger$2.info(`Executing fallback update via: ${installerPath}`);
    if (process.platform === "win32") {
      const args = relaunch ? ["/SILENT"] : ["/SILENT", "/NORESTART"];
      const child2 = child_process.spawn(installerPath, args, {
        detached: true,
        stdio: "ignore"
      });
      child2.unref();
      if (relaunch) electron.app.quit();
      return;
    }
    if (process.platform === "linux" && process.env.APPIMAGE) {
      const currentAppImage = process.env.APPIMAGE;
      await fs.promises.copyFile(installerPath, currentAppImage);
      await fs.promises.chmod(currentAppImage, 493);
      if (relaunch) electron.app.relaunch({ execPath: currentAppImage });
      if (relaunch) electron.app.quit();
      return;
    }
    if (!relaunch) return;
    const child = child_process.spawn(installerPath, [], { detached: true, stdio: "ignore" });
    child.unref();
    electron.app.quit();
  }
  getRescueUrl() {
    return this.rescueUrl || "https://github.com/jvondev/apposition-releases/releases/latest";
  }
}
const fallbackEngine = new FallbackEngine();
const DEFAULT_CACHE_QUOTA_BYTES = 250 * 1024 * 1024;
class StorageQuotaService {
  isPruning = false;
  async prunePartition(partition, thresholdBytes = DEFAULT_CACHE_QUOTA_BYTES) {
    try {
      const ses = electron.session.fromPartition(partition);
      const cacheSize = await ses.getCacheSize();
      if (cacheSize > thresholdBytes) {
        logger$6.info(
          `[StorageQuota] Partition ${partition} cache (${Math.round(cacheSize / 1024 / 1024)}MB) exceeds quota (${Math.round(thresholdBytes / 1024 / 1024)}MB). Pruning transient caches...`
        );
        await ses.clearStorageData({
          storages: ["shadercache", "serviceworkers", "cachestorage"]
        });
        await ses.clearCache();
        logger$6.info(`[StorageQuota] Partition ${partition} cache successfully pruned.`);
        return true;
      }
    } catch (err) {
      logger$6.debug(`[StorageQuota] Failed to prune partition ${partition}:`, err);
    }
    return false;
  }
  async pruneAllPartitions(thresholdBytes = DEFAULT_CACHE_QUOTA_BYTES) {
    if (this.isPruning) return;
    this.isPruning = true;
    try {
      const profiles = getProfiles() || [];
      const partitions = /* @__PURE__ */ new Set([
        "persist:main",
        ...profiles.map((p) => p.is_ephemeral ? p.id : `persist:${p.id}`)
      ]);
      for (const part of partitions) {
        await this.prunePartition(part, thresholdBytes);
      }
    } finally {
      this.isPruning = false;
    }
  }
  initBackgroundPruner() {
    setInterval(() => {
      this.pruneAllPartitions().catch(() => {
      });
    }, 15 * 60 * 1e3);
  }
}
const storageQuota = new StorageQuotaService();
async function flushAllSessions() {
  try {
    const profiles = getProfiles();
    const partitions = /* @__PURE__ */ new Set([
      "persist:main",
      ...profiles.map((p) => p.is_ephemeral ? p.id : `persist:${p.id}`)
    ]);
    for (const part of partitions) {
      try {
        const ses = electron.session.fromPartition(part);
        await ses.flushStorageData();
      } catch (err) {
        logger$6.debug(`Flush failed for ${part}`, err);
      }
    }
    await electron.session.defaultSession.flushStorageData();
  } catch (e) {
    logger$6.warn("Failed to flush session storage", e);
  }
}
const monitoredPartitions = /* @__PURE__ */ new Set();
function monitorPartitionCookies(partition) {
  if (monitoredPartitions.has(partition)) return;
  monitoredPartitions.add(partition);
  try {
    const ses = electron.session.fromPartition(partition);
    ses.cookies.on("changed", (_event, cookie, cause, removed) => {
      if (!removed && cause === "explicit") {
        if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
          global.appOverlayView.webContents.send("partition.cookie-changed", {
            partition,
            domain: cookie.domain,
            name: cookie.name
          });
        }
      }
    });
  } catch (e) {
    logger$6.debug(`Failed to attach cookie monitor for ${partition}`, e);
  }
}
function initSessionPersistenceHooks() {
  try {
    electron.powerMonitor.on("suspend", async () => {
      logger$6.info("System suspending - flushing session data to disk");
      await flushAllSessions();
      await storageQuota.pruneAllPartitions();
    });
    storageQuota.initBackgroundPruner();
    electron.powerMonitor.on("resume", () => {
      logger$6.info("System resumed from suspend - verifying app overlay and views");
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        syncAppOverlayBounds(global.mainWindow);
      }
      const overlay = global.appOverlayView;
      if (overlay && !overlay.webContents.isDestroyed()) {
        if (overlay.webContents.isCrashed()) {
          logger$6.info("[OVERLAY] Detected crashed overlay on wake, reloading...");
          overlay.webContents.reload();
        } else {
          overlay.webContents.send("app:env", { nativeViews: true });
        }
      }
    });
    setInterval(() => {
      flushAllSessions().catch(() => {
      });
    }, 6e4);
    monitorPartitionCookies("persist:main");
    const profiles = getProfiles();
    for (const p of profiles) {
      const part = p.is_ephemeral ? p.id : `persist:${p.id}`;
      monitorPartitionCookies(part);
    }
  } catch (e) {
    logger$6.warn("PowerMonitor / Cookie monitor hook unavailable", e);
  }
}
const logger$1 = createLogger("UPDATE");
function createPlatformDriver() {
  if (process.platform === "win32") return new WindowsUpdateDriver();
  if (process.platform === "darwin") return new MacosUpdateDriver();
  return new LinuxUpdateDriver();
}
class UpdateEngine {
  driver = createPlatformDriver();
  state = { status: "idle", currentVersion: electron.app.getVersion(), isDev: !electron.app.isPackaged };
  activeCheck = null;
  activeDownload = null;
  failureCount = 0;
  lastCheckTime = 0;
  init() {
    logger$1.info(`UpdateEngine using driver: ${this.driver.name} (v${electron.app.getVersion()})`);
    setTimeout(() => this.checkForUpdates(true).catch((e) => logger$1.warn("Startup check failed", e?.message)), 1e4);
    setInterval(() => this.checkForUpdates(true).catch((e) => logger$1.warn("Periodic check failed", e?.message)), 4 * 3600 * 1e3);
    electron.powerMonitor.on("resume", () => this.checkForUpdates(true).catch((e) => logger$1.warn("Resume check failed", e?.message)));
  }
  checkThrottled(minIntervalMs = 15 * 60 * 1e3) {
    if (Date.now() - this.lastCheckTime < minIntervalMs) return;
    this.checkForUpdates(true).catch((e) => logger$1.warn("Throttled check failed", e?.message));
  }
  getState() {
    return this.state;
  }
  broadcast(nextState) {
    this.state = nextState;
    const payload = { state: nextState };
    if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) global.appOverlayView.webContents.send(IPC_CHANNELS.EVENTS.UPDATE_STATE_CHANGED, payload);
  }
  async checkForUpdates(isBackground = false) {
    this.lastCheckTime = Date.now();
    if (this.activeCheck) return this.activeCheck;
    this.activeCheck = (async () => {
      const currentVersion = electron.app.getVersion();
      const isDev2 = !electron.app.isPackaged;
      if (isDev2) {
        const devState = { status: "idle", currentVersion, lastCheckedAt: Date.now(), isDev: true };
        this.broadcast(devState);
        return { success: true, hasUpdate: false, isDev: true, state: devState };
      }
      this.broadcast({ status: "checking", currentVersion, isDev: isDev2, tier: 1 });
      try {
        const result = await this.driver.checkForUpdates().catch(async (err) => {
          logger$1.warn("Tier 1 check failed, attempting Tier 2 fallback", err?.message);
          this.failureCount++;
          return fallbackEngine.checkForUpdates();
        });
        if (!result.hasUpdate || !result.version) {
          const idleState = { status: "idle", currentVersion, lastCheckedAt: Date.now(), isDev: false };
          this.broadcast(idleState);
          return { success: true, hasUpdate: false, state: idleState };
        }
        if (result.manualActionRequired && result.downloadUrl) {
          const manualState = {
            status: "manual-action-required",
            currentVersion,
            targetVersion: result.version,
            downloadUrl: result.downloadUrl,
            rescueUrl: result.downloadUrl,
            reason: result.manualReason || "linux-deb",
            terminalCommand: result.terminalCommand,
            isDev: false,
            tier: 3
          };
          this.broadcast(manualState);
          return { success: true, hasUpdate: true, version: result.version, state: manualState };
        }
        const availableState = {
          status: "available",
          currentVersion,
          targetVersion: result.version,
          releaseNotes: result.releaseNotes,
          downloadUrl: result.downloadUrl,
          isDev: false,
          tier: result.rescueUrl ? 2 : 1
        };
        this.broadcast(availableState);
        if (isBackground) {
          this.downloadUpdate().catch((e) => logger$1.warn("Auto-download failed", e?.message));
        }
        return { success: true, hasUpdate: true, version: result.version, state: availableState };
      } catch (err) {
        const errorState = {
          status: "error",
          currentVersion,
          message: err?.message || String(err),
          rescueUrl: fallbackEngine.getRescueUrl(),
          failureCount: ++this.failureCount,
          isDev: isDev2
        };
        this.broadcast(errorState);
        return { success: false, hasUpdate: false, error: err?.message || String(err), state: errorState };
      } finally {
        this.activeCheck = null;
      }
    })();
    return this.activeCheck;
  }
  async downloadUpdate() {
    if (this.activeDownload) return this.activeDownload;
    if (this.state.status !== "available" && this.state.status !== "downloading") {
      return { success: false, state: this.state, error: "No update available to download." };
    }
    const { currentVersion, targetVersion, isDev: isDev2, tier } = this.state;
    this.activeDownload = (async () => {
      this.broadcast({ status: "downloading", currentVersion, targetVersion, percent: 0, isDev: isDev2, tier });
      try {
        if (tier === 2) {
          await fallbackEngine.downloadUpdate((percent, bytesPerSec) => {
            this.broadcast({ status: "downloading", currentVersion, targetVersion, percent, bytesPerSec, isDev: isDev2, tier: 2 });
          });
        } else {
          await this.driver.downloadUpdate((percent, bytesPerSec) => {
            this.broadcast({ status: "downloading", currentVersion, targetVersion, percent, bytesPerSec, isDev: isDev2, tier: 1 });
          }).catch(async (e) => {
            logger$1.warn("Tier 1 download failed, cascading to Tier 2", e?.message);
            this.broadcast({ status: "downloading", currentVersion, targetVersion, percent: 0, isDev: isDev2, tier: 2 });
            await fallbackEngine.downloadUpdate((percent, bytesPerSec) => {
              this.broadcast({ status: "downloading", currentVersion, targetVersion, percent, bytesPerSec, isDev: isDev2, tier: 2 });
            });
          });
        }
        const readyState = { status: "ready", currentVersion, targetVersion, isDev: isDev2, tier };
        this.broadcast(readyState);
        return { success: true, state: readyState };
      } catch (err) {
        const rescueUrl = fallbackEngine.getRescueUrl();
        const errorState = {
          status: "manual-action-required",
          currentVersion,
          targetVersion,
          downloadUrl: rescueUrl,
          rescueUrl,
          reason: "fallback-exhausted",
          isDev: isDev2,
          tier: 3
        };
        this.broadcast(errorState);
        return { success: false, state: errorState, error: err?.message || String(err) };
      } finally {
        this.activeDownload = null;
      }
    })();
    return this.activeDownload;
  }
  hasReadyUpdate() {
    return this.state.status === "ready";
  }
  async applyOnQuit() {
    if (this.state.status !== "ready") return;
    try {
      logger$1.info("Applying update silently on quit...");
      await Promise.race([
        this.state.tier === 2 ? fallbackEngine.applyUpdate(false) : this.driver.applyUpdate(false),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5e3))
      ]);
    } catch (err) {
      logger$1.warn("applyOnQuit failed or timed out", err?.message || err);
    }
  }
  async applyUpdate(relaunch = true, launchArgs = []) {
    if (this.state.status !== "ready") {
      return { success: false, state: this.state, error: "Update is not ready to apply." };
    }
    try {
      logger$1.info(`Executing pre-update state snapshot and session flush (relaunch=${relaunch})...`);
      await flushAllSessions();
      if (this.state.tier === 2) {
        await fallbackEngine.applyUpdate(relaunch, launchArgs);
      } else {
        await this.driver.applyUpdate(relaunch, launchArgs);
      }
      return { success: true, state: this.state };
    } catch (err) {
      const errorState = {
        status: "error",
        currentVersion: this.state.currentVersion,
        message: `Failed to apply update: ${err?.message || String(err)}`,
        rescueUrl: fallbackEngine.getRescueUrl(),
        isDev: this.state.isDev
      };
      this.broadcast(errorState);
      return { success: false, state: errorState, error: err?.message || String(err) };
    }
  }
}
const updateEngine = new UpdateEngine();
const logger = createLogger("UPDATE");
const isTestMode = process.argv.includes("--test-idle-update") || process.env.APP_TEST_IDLE_UPDATE === "1";
const MIN_HIDDEN_DURATION_MS = isTestMode ? 10 * 1e3 : 30 * 60 * 1e3;
const MIN_SYSTEM_IDLE_SECONDS = isTestMode ? 5 : 1800;
const CHECK_INTERVAL_MS = isTestMode ? 5 * 1e3 : 15 * 60 * 1e3;
class IdleAutoUpdater {
  hiddenSince = null;
  attemptedVersion = null;
  timer = null;
  init() {
    logger.info("Initializing IdleAutoUpdater daemon...");
    this.timer = setInterval(() => this.checkAndApply(), CHECK_INTERVAL_MS);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  onWindowHidden() {
    if (this.hiddenSince === null) {
      this.hiddenSince = Date.now();
      logger.info(`Window hidden tracked at ${new Date(this.hiddenSince).toLocaleTimeString()}`);
    }
  }
  onWindowShown() {
    this.hiddenSince = null;
  }
  hasActiveAudio() {
    for (const view of viewRegistry.activeViews.values()) {
      if (view.webContents && !view.webContents.isDestroyed() && view.webContents.isCurrentlyAudible()) {
        return true;
      }
    }
    return false;
  }
  canSafelyAutoApply() {
    if (!updateEngine.hasReadyUpdate()) return false;
    const state = updateEngine.getState();
    const targetVer = state.targetVersion || "ready";
    if (this.attemptedVersion === targetVer) return false;
    const win = global.mainWindow;
    if (!win || win.isDestroyed() || win.isVisible()) return false;
    if (this.hiddenSince === null || Date.now() - this.hiddenSince < MIN_HIDDEN_DURATION_MS) {
      return false;
    }
    try {
      const idleSeconds = electron.powerMonitor.getSystemIdleTime();
      if (idleSeconds < MIN_SYSTEM_IDLE_SECONDS) return false;
    } catch {
    }
    if (this.hasActiveAudio()) {
      logger.info("Deferring auto-apply: active audio playing in workspace");
      return false;
    }
    try {
      if (electron.powerMonitor.isOnBatteryPower?.()) {
        logger.info("Deferring auto-apply: running on battery power");
        return false;
      }
    } catch {
    }
    return true;
  }
  async checkAndApply() {
    if (!this.canSafelyAutoApply()) return;
    const state = updateEngine.getState();
    const targetVer = state.targetVersion || "ready";
    this.attemptedVersion = targetVer;
    logger.info(`Verified all safety preconditions. Executing Ghost Auto-Apply for v${targetVer}...`);
    try {
      await updateEngine.applyUpdate(true, ["--hidden", "--background-update"]);
    } catch (err) {
      logger.warn("Ghost Auto-Apply failed, falling back to manual restart", err?.message || err);
    }
  }
}
const idleAutoUpdater = new IdleAutoUpdater();
function resolvePreload(name) {
  return path.join(__dirname, "../preload", name);
}
function resolveAppIcon() {
  const ico = path.join(electron.app.getAppPath(), "assets/icon.ico");
  const png = path.join(electron.app.getAppPath(), "assets/icon.png");
  return process.platform === "win32" ? ico : png;
}
function createWindow() {
  const initial = windowStateManager.getInitialState();
  const primary = electron.screen.getPrimaryDisplay();
  const target = process.platform !== "darwin" && initial.isMaximized && primary?.workArea ? primary.workArea : initial.bounds;
  const win = new electron.BaseWindow({
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
    icon: resolveAppIcon(),
    transparent: false,
    backgroundColor: "#F7F7F5",
    // Invariant: frame: false strips native window frame and traffic lights across all platforms.
    frame: false,
    show: false
  });
  if (process.platform === "darwin") {
    try {
      win.setWindowButtonVisibility?.(false);
    } catch {
    }
  }
  windowStateManager.manage(win);
  win.__isMainWindow = true;
  global.mainWindow = win;
  global.overlayWindow = win;
  registerComposer(win);
  win.on("close", (event) => {
    if (process.platform === "darwin" && !global.isQuittingApp) {
      event.preventDefault();
      if (win.isFullScreen()) {
        windowStateManager.freezeForClose();
        const finishHide = () => {
          if (!win.isDestroyed()) {
            win.hide();
            windowStateManager.flushSync();
          }
        };
        win.once("leave-full-screen", finishHide);
        setTimeout(finishHide, 600);
        win.setFullScreen(false);
      } else {
        win.hide();
        windowStateManager.flushSync();
      }
      FocusArbiter.blur(win);
      hibernationEngine.setAppMinimized(true);
      return;
    }
    FocusArbiter.blur(win);
  });
  win.on("show", () => {
    idleAutoUpdater.onWindowShown();
    updateEngine.checkThrottled(15 * 60 * 1e3);
  });
  win.on("hide", () => idleAutoUpdater.onWindowHidden());
  win.on("minimize", () => hibernationEngine.setAppMinimized(true));
  win.on("restore", () => hibernationEngine.setAppMinimized(false));
  win.on("blur", () => FocusArbiter.blur(win));
  win.on("focus", () => {
    if (!win.isMinimized()) hibernationEngine.setAppMinimized(false);
    const activePaneId = FocusArbiter.getActivePaneId(win.id);
    if (activePaneId) FocusArbiter.focusGuest(win, activePaneId);
    else FocusArbiter.focusOverlay(win);
  });
  win.on("enter-full-screen", () => {
    syncAppOverlayBounds(win);
    global.appOverlayView?.webContents.send("window:fullscreen-changed", true);
  });
  win.on("leave-full-screen", () => {
    syncAppOverlayBounds(win);
    global.appOverlayView?.webContents.send("window:fullscreen-changed", false);
  });
  win.on("maximize", () => {
    syncAppOverlayBounds(win);
    global.appOverlayView?.webContents.send("window:maximize-changed", true);
  });
  win.on("unmaximize", () => {
    syncAppOverlayBounds(win);
    global.appOverlayView?.webContents.send("window:maximize-changed", false);
  });
  return win;
}
function createAppOverlay(win) {
  const view = new electron.WebContentsView({
    webPreferences: {
      preload: resolvePreload("index.js"),
      contextIsolation: true,
      sandbox: false
    }
  });
  view.setBackgroundColor("#00000000");
  const loadOverlay = () => {
    if (view.webContents.isDestroyed()) return;
    if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      view.webContents.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
      view.webContents.loadFile(path.join(__dirname, "../renderer/index.html"));
    }
  };
  loadOverlay();
  setAppOverlay(win, view);
  global.appOverlayView = view;
  global.overlayWindow = win;
  syncAppOverlayBounds(win);
  view.webContents.on("render-process-gone", (_event, details) => {
    logger$6.warn(`[OVERLAY] Render process gone (${details.reason}, code: ${details.exitCode})`);
    if (details.reason !== "clean-exit" && !view.webContents.isDestroyed()) {
      setTimeout(() => {
        if (!view.webContents.isDestroyed()) {
          logger$6.info("[OVERLAY] Reloading app overlay view following crash...");
          loadOverlay();
        }
      }, 500);
    }
  });
  view.webContents.on("did-fail-load", (_event, errorCode, desc, validatedURL) => {
    if (utils.is.dev) {
      logger$6.warn(`[OVERLAY] Load failed (${errorCode}): ${desc} at ${validatedURL}`);
      setTimeout(() => {
        if (!view.webContents.isDestroyed()) {
          loadOverlay();
        }
      }, 1e3);
    }
  });
  view.webContents.on("dom-ready", () => {
    view.webContents.send("app:env", { nativeViews: true });
    syncAppOverlayBounds(win);
  });
  return view;
}
function syncAppOverlayBounds(win) {
  if (!win || win.isDestroyed()) return;
  const view = global.appOverlayView;
  if (!view || view.webContents.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  if (w > 0 && h > 0) {
    view.setBounds({ x: 0, y: 0, width: w, height: h });
  }
}
function getMachineKeyFilePath() {
  try {
    const userDataPath = electron.app.getPath("userData");
    return path.join(userDataPath, "apposition_machine.key");
  } catch {
    return path.join(process.cwd(), "apposition_machine.key");
  }
}
function getOrCreateMachineKey() {
  const keyPath = getMachineKeyFilePath();
  if (fs.existsSync(keyPath)) {
    try {
      const hex = fs.readFileSync(keyPath, "utf8").trim();
      if (hex.length === 64) return Buffer.from(hex, "hex");
    } catch {
    }
  }
  const newKey = crypto.randomBytes(32);
  try {
    const dir = path.join(keyPath, "..");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyPath, newKey.toString("hex"), "utf8");
  } catch {
  }
  return newKey;
}
function fallbackEncrypt(text) {
  try {
    const key = getOrCreateMachineKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `$ENC:v1:fb:${iv.toString("hex")}:${encrypted}:${authTag}`;
  } catch {
    return text;
  }
}
function fallbackDecrypt(raw) {
  try {
    const key = getOrCreateMachineKey();
    const parts = raw.replace("$ENC:v1:fb:", "").split(":");
    if (parts.length !== 3) return "";
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return "";
  }
}
function encrypt(text) {
  if (!text) return "";
  try {
    if (electron.safeStorage && electron.safeStorage.isEncryptionAvailable && electron.safeStorage.isEncryptionAvailable()) {
      const encryptedBuffer = electron.safeStorage.encryptString(text);
      return `$ENC:v1:${encryptedBuffer.toString("base64")}`;
    }
  } catch {
  }
  return fallbackEncrypt(text);
}
function decrypt(encryptedText) {
  if (!encryptedText) return "";
  try {
    if (encryptedText.startsWith("$ENC:v1:") && !encryptedText.startsWith("$ENC:v1:fb:")) {
      if (electron.safeStorage && electron.safeStorage.isEncryptionAvailable && electron.safeStorage.isEncryptionAvailable()) {
        const base64 = encryptedText.slice(8);
        const buf = Buffer.from(base64, "base64");
        return electron.safeStorage.decryptString(buf);
      }
    }
    if (encryptedText.startsWith("$ENC:v1:fb:")) {
      return fallbackDecrypt(encryptedText);
    }
    if (encryptedText.split(":").length === 3) {
      return fallbackDecrypt(encryptedText);
    }
  } catch {
  }
  return "";
}
function signHardwarePayload(payload, machineGuid) {
  const key = getOrCreateMachineKey();
  return crypto.createHmac("sha256", Buffer.concat([key, Buffer.from(machineGuid)])).update(payload).digest("hex");
}
function verifyHardwareSignature(payload, machineGuid, signature) {
  try {
    const expected = signHardwarePayload(payload, machineGuid);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
let cachedMachineGuid = null;
function getFallbackSeedPath() {
  try {
    const userData = electron.app.getPath("userData");
    return path.join(userData, ".apposition_guid_seed");
  } catch {
    return path.join(os.tmpdir(), ".apposition_guid_seed");
  }
}
function getOrGenerateFallbackSeed() {
  const seedPath = getFallbackSeedPath();
  if (fs.existsSync(seedPath)) {
    try {
      const seed = fs.readFileSync(seedPath, "utf8").trim();
      if (seed.length >= 32) return seed;
    } catch {
    }
  }
  const newSeed = crypto.randomBytes(32).toString("hex");
  try {
    const dir = path.join(seedPath, "..");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(seedPath, newSeed, "utf8");
  } catch {
  }
  return newSeed;
}
function readPlatformHardwareId() {
  const platform = os.platform();
  if (platform === "linux") {
    for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, "utf8").trim();
          if (content) return content;
        } catch {
        }
      }
    }
  }
  const cpus = os.cpus();
  const cpuModel = cpus && cpus.length > 0 ? cpus[0].model : "unknown-cpu";
  const composite = [
    platform,
    os.arch(),
    os.hostname(),
    os.homedir(),
    cpuModel,
    getOrGenerateFallbackSeed()
  ].join(":");
  return composite;
}
function getMachineGuid() {
  if (cachedMachineGuid) {
    return cachedMachineGuid;
  }
  try {
    const rawId = readPlatformHardwareId();
    const hash = crypto.createHash("sha256").update(`apposition:${rawId}:freemius_v1`).digest("hex").slice(0, 32);
    cachedMachineGuid = `node-${hash}`;
  } catch {
    cachedMachineGuid = `node-${crypto.randomBytes(16).toString("hex")}`;
  }
  return cachedMachineGuid;
}
function getDeviceLabel() {
  try {
    return `${os.platform()}-${os.arch()}-${os.hostname()}`;
  } catch {
    return "Desktop-App-User";
  }
}
const FREEMIUS_APP_ID = process.env.MAIN_VITE_FREEMIUS_APP_ID || process.env.FREEMIUS_APP_ID || "38794";
const FREEMIUS_API_URL = process.env.MAIN_VITE_FREEMIUS_API_URL || "https://api.freemius.com";
const FREEMIUS_AUTH_TOKEN = process.env.MAIN_VITE_FREEMIUS_BEARER_TOKEN || process.env.FREEMIUS_BEARER_TOKEN || "";
function getFreemiusUid(machineGuid) {
  return crypto.createHash("md5").update(machineGuid).digest("hex");
}
function getFreemiusHeaders() {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (FREEMIUS_AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${FREEMIUS_AUTH_TOKEN}`;
  }
  return headers;
}
function isFreemiusEmailRequired(data) {
  if (!data) return false;
  const errCode = (data.error?.code || data.code || "").toString().toLowerCase();
  const rawErrMsg = (data.error?.message || data.message || "").toString().toLowerCase();
  return errCode === "user_email_required" || errCode === "missing_user_email" || errCode === "user_required" || errCode === "missing_user" || errCode === "email_missing" || errCode === "requires_email" || errCode === "first_name_required" || errCode === "last_name_required" || rawErrMsg.includes("user_email") || rawErrMsg.includes("email is required") || rawErrMsg.includes("email required") || rawErrMsg.includes("requires an email") || rawErrMsg.includes("first_name is a required parameter") || rawErrMsg.includes("last_name is a required parameter") || rawErrMsg.includes("first_name");
}
function formatFreemiusErrorMessage(data, status) {
  const code = data?.error?.code || data?.code;
  let msg = data?.error?.message || data?.message;
  if (code === "license_utilized") {
    return "License seat limit reached. Please deactivate another device.";
  }
  if (code === "license_expired") {
    return "This license has expired.";
  }
  if (code === "invalid_license_key" || code === "license_not_found") {
    return "Invalid license key. Please check your key and try again.";
  }
  if (code === "rate_limit_exceeded" || status === 429) {
    return "Too many activation attempts. Please wait a moment and try again.";
  }
  if (!msg) {
    return status === 402 || status === 403 ? "License seat limit reached or license expired." : `Activation failed (HTTP ${status})`;
  }
  return msg;
}
const REQUEST_TIMEOUT_MS = 15e3;
async function activateFreemiusInstallation(licenseKey, machineGuid, deviceLabel, version2 = "1.2.4", appId = FREEMIUS_APP_ID, apiUrl = FREEMIUS_API_URL, userEmail) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const cleanKey = licenseKey.trim();
    const uid = getFreemiusUid(machineGuid);
    const endpoint = `${apiUrl}/v1/products/${appId}/licenses/activate.json`;
    const payload = {
      uid,
      license_key: cleanKey,
      url: machineGuid,
      title: deviceLabel,
      version: version2
    };
    if (userEmail && userEmail.trim()) {
      const cleanEmail = userEmail.trim();
      payload.user_email = cleanEmail;
      const emailUser = cleanEmail.split("@")[0] || "User";
      const parts = emailUser.split(/[._-]/);
      payload.first_name = parts[0] || "User";
      payload.last_name = (parts.length > 1 ? parts.slice(1).join(" ") : "") || "Workstation";
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: getFreemiusHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (isFreemiusEmailRequired(data)) {
      return {
        success: false,
        data,
        requiresEmail: true,
        error: "Please enter your email to complete activation."
      };
    }
    if (!response.ok) {
      const errMsg = formatFreemiusErrorMessage(data, response.status);
      return { success: false, data, error: errMsg };
    }
    const installId = data.id || data.install_id;
    if (data.is_active === false) {
      return {
        success: false,
        data,
        error: "License installation is currently inactive."
      };
    }
    return {
      success: true,
      data: {
        ...data,
        id: installId,
        plan_id: data.plan_id || data.license_plan_id
      }
    };
  } catch (err) {
    const isTimeout = err?.name === "AbortError";
    return {
      success: false,
      error: isTimeout ? "Activation request timed out. Please check your network." : err?.message || "Network offline. Could not connect to Freemius."
    };
  } finally {
    clearTimeout(timer);
  }
}
async function validateFreemiusInstallation(installationId, appId = FREEMIUS_APP_ID, apiUrl = FREEMIUS_API_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = `${apiUrl}/v1/products/${appId}/installs/${installationId}.json`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: getFreemiusHeaders(),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg = formatFreemiusErrorMessage(data, response.status);
      return { success: false, data, error: errMsg };
    }
    const isActive = data.is_active !== false;
    return {
      success: isActive,
      data: {
        ...data,
        id: data.id || data.install_id || installationId,
        plan_id: data.plan_id || data.license_plan_id
      },
      error: isActive ? void 0 : "Installation is inactive or deactivated."
    };
  } catch (err) {
    return {
      success: false,
      error: err?.message || "Network offline. Could not reach Freemius API."
    };
  } finally {
    clearTimeout(timer);
  }
}
async function deactivateFreemiusInstallation(installationId, licenseKey, machineGuid, appId = FREEMIUS_APP_ID, apiUrl = FREEMIUS_API_URL) {
  try {
    if (licenseKey && machineGuid) {
      const endpoint2 = `${apiUrl}/v1/products/${appId}/licenses/deactivate.json`;
      const response2 = await fetch(endpoint2, {
        method: "POST",
        headers: getFreemiusHeaders(),
        body: JSON.stringify({
          uid: getFreemiusUid(machineGuid),
          license_key: licenseKey.trim(),
          install_id: installationId
        })
      });
      if (!response2.ok && response2.status !== 404) {
        const data = await response2.json().catch(() => ({}));
        return {
          success: false,
          error: formatFreemiusErrorMessage(data, response2.status)
        };
      }
      return { success: true };
    }
    const endpoint = `${apiUrl}/v1/products/${appId}/installs/${installationId}.json`;
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: getFreemiusHeaders()
    });
    if (!response.ok && response.status !== 404) {
      const data = await response.json().catch(() => ({}));
      return {
        success: false,
        error: formatFreemiusErrorMessage(data, response.status)
      };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err?.message || "Network offline. Could not reach Freemius API."
    };
  }
}
function getSavedLicenseKey() {
  try {
    const row = db.prepare("SELECT value FROM licensing WHERE key = 'license_key'").get();
    if (row && row.value) return decrypt(row.value);
  } catch (e) {
    console.error("Failed to get saved license key", e);
  }
  return null;
}
function saveLicenseKey(key) {
  try {
    const encryptedKey = encrypt(key);
    db.prepare("INSERT OR REPLACE INTO licensing (key, value) VALUES ('license_key', ?)").run(
      encryptedKey
    );
  } catch (e) {
    console.error("Failed to save license key", e);
  }
}
function deleteLicenseKey() {
  try {
    db.prepare("DELETE FROM licensing WHERE key = 'license_key'").run();
    db.prepare("DELETE FROM licensing WHERE key = 'license_state'").run();
    db.prepare("DELETE FROM licensing WHERE key = 'hardware_lease'").run();
    db.prepare("DELETE FROM licensing WHERE key = 'last_validated'").run();
  } catch (e) {
    console.error("Failed to delete license key", e);
  }
}
function getSavedLicenseState() {
  try {
    const row = db.prepare("SELECT value FROM licensing WHERE key = 'license_state'").get();
    if (row && row.value) {
      const decrypted = decrypt(row.value);
      return decrypted ? JSON.parse(decrypted) : null;
    }
  } catch (e) {
    console.error("Failed to get saved license state", e);
  }
  return null;
}
function saveLicenseState(state) {
  try {
    const serialized = JSON.stringify(state);
    const encryptedState = encrypt(serialized);
    db.prepare("INSERT OR REPLACE INTO licensing (key, value) VALUES ('license_state', ?)").run(
      encryptedState
    );
  } catch (e) {
    console.error("Failed to save license state", e);
  }
}
function getHardwareLease() {
  try {
    const row = db.prepare("SELECT value FROM licensing WHERE key = 'hardware_lease'").get();
    if (row && row.value) {
      const decrypted = decrypt(row.value);
      return decrypted ? JSON.parse(decrypted) : null;
    }
  } catch (e) {
    console.error("Failed to get hardware lease ticket", e);
  }
  return null;
}
function saveHardwareLease(ticket) {
  try {
    const serialized = JSON.stringify(ticket);
    const encrypted = encrypt(serialized);
    db.prepare("INSERT OR REPLACE INTO licensing (key, value) VALUES ('hardware_lease', ?)").run(
      encrypted
    );
  } catch (e) {
    console.error("Failed to save hardware lease ticket", e);
  }
}
function saveAttribution(params) {
  try {
    const serialized = JSON.stringify(params);
    const encrypted = encrypt(serialized);
    db.prepare(
      "INSERT OR REPLACE INTO licensing (key, value) VALUES ('affiliate_attribution', ?)"
    ).run(encrypted);
  } catch (e) {
    console.error("Failed to save affiliate attribution", e);
  }
}
const DEFAULT_CHECKOUT_URL = process.env.MAIN_VITE_FREEMIUS_CHECKOUT_URL || process.env.RENDERER_VITE_FREEMIUS_CHECKOUT_URL || "https://checkout.freemius.com/mode/dialog/plugin/38794/plan/65379/";
let memoryAttribution = null;
function parseAttributionFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl.includes("://") ? rawUrl : `https://dummy/${rawUrl}`);
    const ref = parsed.searchParams.get("ref") || parsed.searchParams.get("via");
    const affiliateId = parsed.searchParams.get("affiliate_id") || parsed.searchParams.get("aff_id");
    if (ref || affiliateId) {
      return {
        ref: ref || void 0,
        affiliateId: affiliateId || void 0,
        capturedAt: Date.now()
      };
    }
  } catch {
  }
  return null;
}
function setMemoryAttribution(params) {
  memoryAttribution = {
    ...memoryAttribution,
    ...params,
    capturedAt: Date.now()
  };
}
function getMemoryAttribution() {
  return memoryAttribution;
}
function buildFreemiusCheckoutUrl(baseCheckoutUrl = DEFAULT_CHECKOUT_URL, attribution = memoryAttribution) {
  try {
    const url = new URL(baseCheckoutUrl);
    if (attribution?.ref) {
      url.searchParams.set("ref", attribution.ref);
    }
    if (attribution?.affiliateId) {
      url.searchParams.set("affiliate_id", attribution.affiliateId);
    }
    url.searchParams.set("title", getDeviceLabel());
    url.searchParams.set("url", getMachineGuid());
    return url.toString();
  } catch {
    return baseCheckoutUrl;
  }
}
const b283cc111765aaf3189f424e5689d16f78967f6d59f6a675f9ac86cd32380b93 = "2GblUSSLvKYqocuhNqh6/a80u15D/yjwplKHNou9gTDYOuPMfWoPqNFq7dOud8hSEb8e/ttN01pi0Vl+2ap6CWx1aqlPQyA7fgmglVco1gv+8jRq/eUeSBYKbsZKRPElKkHDmu5+0Bqzrvy5NldNJ6FqstaLV279uG0kATZin0/VcZVkKRCBGz241rOAdqIbtUNvatPw9UxEyzQ=";
const c2899c728a5e30da25595d97e9d1cce49d4d928f34a1372bd7ec7854a48a9163 = "PgGJxqIp7CUir7OweIJO7jLIoVssk80YgNvxQozGNknPz/mth8Z11ETlRnZFUNlyJTkp6uQPfIXNusWnkaEDYMxVmGce5lLoGV6OW2pyOBfLmNH+8Psvhg2Iw8BqkP+FvUS4AEKKlUuRDwWS1DFvtZdIZZaHjXGCwyfKSFfY9lbXj+kmihsEPuxy1GfHU1q61Swn6+M3V2DYSAs=";
const a06f6efc123bb6355f5f55fa70cda78bba5543187d2aaf5443bdc35a45e9b146 = "c26tsgCnOJZ6fdyJw8TxG1vonRwV5FXr2Z9vnoK152MydQpcIlwxly1WVeLrWxHkYKwRygElbxn45ArR9+2L25L1Gwxvd8YOVdnZCO6cEoanIaYqiPvWK68zelNsX3q8qRa1DV2MA2mv3VXrIAWE45rCA9tV+6gkWFcpD/iKNHXRrS+ZgboVXUtev2jbrJW3+sBW5YAJrXWF0B4=";
const e9bd966db7df088c7ff72b6e83c2567291882df0338d3dd8f56b7514ed3f22e1 = "BKQHlR54Y+YVMasvWuz9nYnHaYvV8kytgDRJ7ieDbXlrRl703tEqRmyrxHGcH/0Z01/e/FY+o2TnYfEMgWWs7SaU8RBi1I9EAWSVIDiWj71j7WtNwH4wnatS3ye2LsuPwJ9BNfwuLiUJTThjP8PS3eLVDO0JIlZoBiksd7razf01WOkLrg9tL62XAIbMPSV/hceleXFpZUG/0t0=";
const cc151d3209fecbf242004089af58f1ca15f9ce2dd6923014c8765af92cb9a95e = "Ro26QHOKCwJUI3mCKUVYnk/b/MLmWq/U2U6LCKv+dVr6NOmjkcJd5DI8O8jWYcbX3kU69BfscXvXsgSMzTx7Izda0jXpdNWbWhRmhal3r8U7DBifZY4IBjCpc7rge6VIKffLPPuocUBlDR58WB7aErn3lU+m48O4Swu1uFORphTAtqS6rTUh0ifXHKapKcxkwJoB5Oqu8LAfYjEz";
const e0d70dc6df57115c2244ef57da9df89d0c9b228856c720354e80505ef01411e3 = "WuNjNYZpwyO3lIRkbIgzyxzO2btwJuLg176UukrG/njzBzdZ+iR1rAdi8mMlfwG4RDyL6d1jx2Kyd/C07bMbGMKp05RxRHgw0EjboGjqcgSUiocWi1o4krVh7sgDLnJQvvLsriq5xVWY4OF99GcvbhyD4JxMAlePjPFGwiqjk2eugnHMaJJieWTQegaFz4hxhOkf5Pp2nCXGQ2I8";
const d68f1c7aed6562848e63b7606b9ea1932aa8df98deb984a6b05921838a9d0272 = "OfVqaayTXrlq/L3+N8xy/RBv61DVxOelO+JlZ638nFalTmpT4C1MZ0wz6WpOgth+RPy68zqMuq5i0WsoG30d6Fcy7VyIEFcRxxug7JLyGZZXPX1C0kWHfdQMTsacDE9QDTtIOdIDFODAbg9ooRCmwBbVHeP9lELxmtGivZ3x9JFyTbgs58ZOOnOsuju90CsD6o3P+gc2qGGw7qF8";
const c10e28bd21d24f151f6067f3163870e1354beacc566d1212268ce96fd5c74a4e = "xFiQZldbcTPJL/18oR51JlBSjWBDkPSddkdp/f1KV0cFu1DNU2bVCu9oMa3Ky8rbZDuXPn4SBCMKttpP4KAKQFQwbfvwmIF4+qXcUtHrTySRouuiDPNTRQdvfLrd89k2k4IBjB4JpsttMeTZ/G6dXBWHN2v1/2nkdn4GgrYW0ZAvkTwWf0NExwwVKkl5spYb/7Kw1rc5Z+8y2IxP";
const e368b4fa7172adaa8a4d24f82f0006df27e8a84bae2c7321d77006888f3c8cc1 = "R2Ecij0TIBhbsCs3r6LU4YS91i635l3cCvjx1iHhYQ+JGFEyahGUoTzF1h5uvNLnQlRecFRPZs8TOrmlCucAGmOtsf5vJbOgaFnBiDSuiQYAVVJbThRN8tFb32f2LLwKpAY5jGzTQQ+U/yKUn/F3fSozc6/GSG1uaYrj29lcqnxqX1PWMHgRuAKulKsMuCKW7ECg2p8d3Vqwp6Ax";
const ccf01389baea021779cc373c468012b96f12c4c20869a90d42e8ca07a1f7b16a = "amOs93mquq04U+jWLxzX0wH0kq0cgUkhaC/tGWtk6pRfgY20vnOhF4yHGvlkjLZmlLVzDm0HBva77+fASX8CAfQIQTSMw+GK1AWNW2aZCdukgnD/U9hdgpGgq96+Mi3x4JXFNxCXw3mA0dt+YHPZ8b4bl4E/5MScgnfolWP2P7bJqe3pKn9hkcpZJYBH98RjuFDEoskuPOngM3ru";
const e52f6d50a7aa3536e2880c1630ce81828506b7654985cc4e49b4937fe2424054 = "btJ+Lz3IrDobf9E0bDuku5A1RhE+WsGxM+/5fe9JFnf/DLz+SMzH0i3ufUT3aUOfBjaHV9bwgvh3GM/6PVfOKVUaonYPq7itPB63vQEUixwBEaDbDCdOFleGmNAcPE3E09Yya64TW8Fl9iKFOM5U0PXnjUIreVDcnpzsIWgnTURNKO1+wK9UvbA8aev2RfJ/Uvne+VFdCn1O5Rig";
const d1b3174313a6b21808a2ab227a06cd0b560d75f13a5c7947b848c70896eb944f = "mhS8kQvCXMVfjwdb0lLJGHpElB/h21GjLA2i79ONnDODpgAe6GHXE2ngTaYyog1PwnTUgodhvtzbE4JHJ3LqcLS5FBXMWYUnVEHJFhxKkspD7w41cyfAkU0pmTtUcnZRRWqNFfAFs8ytn26f7hmM4jqyWsabr4ZaeER9OiM1Sc+iS9vIIxAsMOfsC6S63FaRSXAUuEqgDdChCrpg";
const f130bacbb81663b0e3ebc0edcbaab8510a16bcaf46f693ae835984e2acff9250 = "q7Vcrs5qbOE89ApYS+CjwEPCUQkLjuDGwQW8QTgjEh7TPJAl7Ma45fTfqHbrN2oawUgQWDJa1CbeKIb7P6ot0t1QrtEmiFVk/QgR4YwjkVfzpNudBDyjwHXweFytkTvJOuHKhpbtH7Amhr6STM6HbM5D1vRmsDttTXc+r/qfZNbD2uO3pH07XBQa3j8yzcRLHIUt3qXwNITytAjU";
const ebbb7f3055c6255aac780214979a3de3150e8e9d7ec847013baf6d7dbfbb48af = "BQlbPMn1j5qxK5qJLZgcBLx1ab+DMKHoqHKGvsgBBqWRtY6VmbyIBWN4KjGcIXMgUhjI95y/SUErtHARiSlamwpJqrK5xLt/KVlmX05WIdgLgMw2XNf22QcAx5mzEOigIvGKwOHI1G345sumB/xzxhUHDc1B5/dMDw/n+ZGsyH9BrThB7qylFdSvVN03UaofOgH8JPoixJPN2VbH";
const c17c4d5e5b374d16d9096d33fd60e66a6b9e361541d6b439ed7c927997aa9d2f = "Ye6lqs4McffgH8a8AhsEZyHHrbOdGGDOtqsfbyLTaspXzZrNMiUuTAVaupe2doamzuih7mdOmUC5WHxdJ3ycyaScM/U+eaCYVatGVLrOZJuGP8TFQxDQrQo1HmRM1+zsqVxUfiAxuCNdCXD7FAQ4WS+4IGZsYCnTcPpn/J3ye1/5ZB8aWTjKJY6lwGoF7wOB6y1WUCDtfMnTBje0";
const fa25efc4ee79d3ef810b212c93b5899618c5f9c4565114f505aa2ff9f8192049 = "IJgv1w6OTYz7WtXV25iv6hodrnClhV1xnFe0tq1zw73U2z/9HX6Sz3yFxMk9VDGxs+FLYP2Q2P4gu0NgEuJv4LW2FqF6h/wABT0Yok8M3c17FcDeZmf9Hof/RrqtpSnLEUekdnTTxuc0cCadOm64ShQZncChgVExdmzwl+pWiC4LYWqxeFb9/hbHppHPURbVDBUV1u3nCKr/475D";
const a00cbb43e60ea1149711bca57985b5c92d53e48ffd25f22b2144df75e071dad9 = "+SNxURiflfCKXqiN/toDeVJnQM8PchyLb1VqkNQ6kB5B5yfyDDe9CDTky9PUa4fFY8Tqb2+ij6dIaeddiP6eN42ucXbAyQVEmdsyf3LVvjvhiaE+X6svepr+zukLfML/QaPTgM+sm9Rz/UxaEYb3nd5zvOQmnT/hBlqF/hgS6wgM1qK2fpDzQwwMlc1LYE0bKFOULKKj3FwoIp33";
const fac3dc1b2491357dd392fcd9e11aa34e4963cf502e4a4fad6dc10ebc635a6301 = "9gzhKeren0jxQrEESXIdnvJOuufx5sVR2vZ++IIGnazPFDhvHOj8RJ4IuTcKjEKY2f92PYEYa+MNJ8GxV/dhAX39fGOdyyvJqJh6FjlLmjXycIV9R2EDqFIiiWYL3mcQkm2yxrZwlDuH3jlgH2obuVBVNGdnfiIqVqptnkWtA2y7KDY/x+nraB4/35jKV0c3ZVxNoEPgCyO6gzXy";
const f94b41bd1dd0531c8745e35e2978c333f67a9c4796e9fe986b9a6eb642d49aa9 = "wgMzPO2+L8xH0AB/ZQAPrymmUoBhrkvR9GoVMR+g03X1cIJctvuGVjD9jvCvlvxK3kcFHTd6wmMQHzdpWTfy9rWJH5fVFs7lu00sHdIJT89Ck7jb87T5tbDwaQrmtvxbEP6rpH3KgwkkAzuZGLOCr6rLdC/4wySqylaYf6TIYkMZM/QBQ85UKS0vf4d/YLFar+vC4FaCSEd85/r5";
const d3e987c69fd5a14b5562df9b38596f6ab86be0577d4e8c1fc4086c572b97d516 = "nyCY2AZcmPvQ+s6IJbxyq05es0RV35Z7aLwbiUknCuoQC466bk4QGwLJFA/WFWDMJLpA7PA2yFv3XI+V78MlkdkN/wJJMXfHfEbCggXkEPQwqyhd4u+cfYbj0tgVwRtUMOtDpC5wCui4QMTnh6oYjYdcRLVUB6rU+2e90vCDcgpPSVH3yKSd/s4peoFCWdi6vyVJE2L8h/DAhBAp";
const e04e0bbe608e63b4adfa1c3fca5c3940c7ac09cf26cb5113a5ee6fee5e328348 = "3DdkPEgqGTZYzUKBVVyfWCdAplxuSPAcU0n0FlVCy4bQEE7kbq3wBlgv4S1AlPMBJOXBvjXG6bM3wHRrw/Q+8K/R3SCHd08QmZ697Iq3TewnBgjkhIUI8yA0bzngcZTLT3iaXEbQcgFbsJIiAaybxJBJNjSzbuC6OWQTRSN3HLq//Uct4Zh6tixmLYEjgsjH/51P4pD5wdAedbmf";
const eb3eb75fc85b75236ef710c14cd79bd0661d11c2e0dc984ea2b9cf9dc2632507 = "YmJdmnFSDSh/afwpDplD54J/TDAMzAyVHrWEqSQW/D2lk8NkIXh7J0PUZlvrk5dU+n2BjEMhLgAVNFG5KuPmUCjleZBHmUxEk5d9yAwFKP17JKKG6T3NBvEOtS5FY++UwLW+gvt4vM54wddbTNUtf9mBSAfhoUvvQHeUyPuLa2XVgw9Qs8iRb8GeRNB7L98WK58wrmsYQgnkH7xO";
const bcb095243b11692c9af2ffc1c7a820126cb8d9cb29d93922a57b07a01feca1c6 = "9Ma6cN58VvmrBZWGTRCtj0HCbHOwmCGlfJ8MQLkGZAB8zFBjVF8qdLnehSqv9KCGGe3cMk3uzrOyrtSXxm3ZLkaqSQ1lqYry+P8BuXJliKZUoJ7orm/0aGg5MhORb1TyPZwe57lIUzhKeD4T6O2TPwhKpLbIhBuX+0cxuYnMKzgvbCaafBVZe32GUyul1wbbhrq7GhHGGa1OIizY";
const c603db3c315cae6d163bd101a75ea95e934a1837654e140908da8227e2aaecae = "7TL1Jd02Cmtktveafh3Lh4ZNKlx2k3u6ZNHY7964zj3T+2naEM5K6pCZXgRtqQ5b+0bM7+4ATxVlrBf7Mvu5/E1FIs8AB1v8mV3EWRBFkztaizPwZywTL7RDu6VaNO2WgXRWAJWA2qM/C63Nk7z0Hf2i1/YYIzH+yBgtGEpx5ynUDFsiUMDvcnU42oSk0WyMnBC1G+KjC70LDqcT";
const e366471c35d596e96e674b9f5240b2b538d83c08a51ebf3f3c95dbf744bee20d = "oHQOq545s2xlCkD7z287JwP0v4fgnSTASPiqNv2VyaoTqPOTMbwAJ5+p8bBBxzvLbMCwdDA9YM+dzTbUFZyadylNKwANYak6QZm3DSif1rWqgXeHPhYh3i+TrvJXFOkfJyLzZB78DMKYFVyYsuSSR+pPWr9uG6S9pVNJi+Trb92t0ypRtf/b2HFW2uF6isjiA2kY8MP4PxBR7VZr";
const d01cf9e8726382170792f0f9b28aa0d1289f42fda3d3db4890ccdafee9ec270b = "q5po2H9KYIzVonN/23AgVXhhxOxxKcrq0JYyCKT52iMEvoYZz4m2t0eWfPbwCwtL1NW7mvCm+wETbx56+liwbvAwrqdsJELs0WTGmc2l3DXRpuisZIp/1CfHvKuGO6ogVI3psC4ofAwx6w08lewCxzLOG418zzS77pkGgRYWIpRrvnkM6NmDvWY1BqJeh0SuAvMMwSIm+xF/hVG8";
const bf82e705420535a2a24dab51c3b5b9b2d9e14f2263a9abb9d5d72bcce43c4c21 = "sgH36hxshaPEtZHqoUioOfUKMdZKUj1RLjFN8hSJBrzH+CjoljdlOem1Rezi6k4dG98X0uWH/E47GAfooVQI/+NYFePA0INgzZYyILDYCi8OXk5suSDAsuCSQi5nZTqoF7QAAdJYqFriDlY7pE+T/DfBnkQ+Jy7/0R0HZ1hwJ8NPG1ixfgRNyhEfCYsK5fb7BdHE66qKfNaCQ6GB";
const bf8675c476683e7615727259e0b443ef40a8ab43b5f5f705bada02cd6f995016 = "98P4Fi7JxWvTOneO6NvT6S5sDsTGGNfiYQGih73ZGCVyiNv8/jscZTiP8v/rsx4TDadfhxhVk7Gz6JIHyRY279uVxf4r8L33XYoJoRdv/5Cd8atGlAkhvsFafonMjoGoIEHTn1gUc6bWHRWsaFUDa091whvL1aJeIvU+3SvbPH0qaEDvqf8Ulq8KfCuAC5v0MblsjNYPkY+1iK3h";
const c8a653cbfd3379330ab9560738f02ef90e75be35a9922eca16fc40da88c4f050 = "dSEnIrDV6LR06dziUnRFSNo4tQK+1wdnC0Tg+uJKxeX2wFzi1bWB8sy1trXj7+5hglfZHjKFKgDvpjOddfKMetfuN+smnb6m/vl6xItvl4Z7va6SDL/Jms63bz+/emY58XUR6cs2QTD2+5laRIrxQdEU/9QWWNbBr3IwWjIB2ZTcD1wZl/8edEkeVDHtum/oich5+i4kSBDBRAkQ";
const d96fb967f5026f31564c9bc4c2ebf944438b88e5dafcdda57ea17f84edea13c2 = "3n8qhJ7MzytFe0qApy4bGKhUrCy77/nTqQ1Y3F0W3kVd5cge6TOX8t4aLAEoN7RYtLefB3XqaTYE60cy90vjNUXLPHGs4zDwMt+6g1SilqWa0DTMKchGuYZsVNSiZxOxwVsyeBpMEtqNIhIlyqHNqJFSkTE2pboRWQxXopZLOAytiU42MAIN8WtfeiU3Xa+o+Wj+EtIC9zwyyBP8";
const ea225a2620087f589cf76ef61e1179b959aae52958cb97eb81333d263f734cd9 = "YYEpAOSIJfxH3kSbL2J++By2sV8gxsYBNruC+Vl5lKiMKCSyHdkOToNbBcJdhmMxqMO5TdFytO/6deS/ZRLc/cABxYoAqSuFthVmnhyWNOeEfDdDXDHsH6x9BySZ9aRYt4gABVZf/yzJsK5r2VndVgHEW3aQLlI4LEGCLAojTHDAIekv8Z9fgdIn5QSm+9wiMIBmQDkjBWAFCKMM";
const c83a21f4f58beaa371233ced9f97c076ea05a6e76141b2ec1bd00d13c8f932ec = "nN0BHPGfgfhB0aJCk8cg/UJ2WQbCBEaETnly8s7ZXmjW0lhUUghNIjNI4qIVsItp/90cN3nGWIX+4QPBUK7eDNRgAot3KwUZAgBpqpd5Vtop1RO3T8iXaHgqBVJSt0HAnif/qVLn2K6xEymku7vV2YuT7zbaQcdvyw/difheJeLBE2mVOGOrZ+X4WOgTxavq+dFFeSGe0M7ymTq5";
const fa27bee70718fae963edd6e246abd2de0ba2e827127c375ad83d887d1a938ff9 = "M5ZAXz9aZe0JtsloPn51Z0fAxNBjotHm0XJx8P1rnvRwhd/Rjvvprr1yAnnFyBW7wv5WQ2mHrkidNgcVMXENoQv6NPztL4D8HJlzSg4Lk8wxEqsocCHnAsDOLPj7vHZasgm/xn9xMJKDA8HcnpmItzPJNyXiPleJfv2nWQ9DPMQB8nm8it+wjblaliOB9cG7OMuPCr5bay4+m9hj";
const a167294498464224bdbd1b0dbe43059410928244aaea360fd4aee7115e54a89f = "bj+xDqNCW3CDtjRJ1Nhei5IfNNofOMV1YJ7sNYMWduFQ9qDlvlayBBuXb7FNZPTt62pc9bGvd7SJae3Eqv2jehTNpp4rEsJb93PO29G2pueG/zMYDOYoACtMyg3/2JwzP3oG5Jy+28JJ+ohgL1KoXSyCFu+8S//754BTkNPbaTOBbL1vHi6mH96n+y5LxgDDI49QmoBEihfhsAm1";
const e8e80e88bd10222a2decc0f5c08a93d550ab841de09809a5ebf6d5154ee1d689 = "B6D4wW/7y1lPq2H/liCxeBJch+TEsESE+/fN57ubkLUd4G9vpPYCJ1tCNpMsf7G1qgYQqs9rEX12mdufyIviR7i1PQCkWOvpUHj8XAe0/kYC6zz+l+9iMDJzWC5TX4gF9zy5rTFjdVWOc+qe75C82kppxHx6mMsz+/0uUgeM76+sMF5sC5GyOp8sjhQXOEMDrskkQevebilQMsI8";
const fad6d96fb625f0f7e9dea4866c6e28e0b7a58452302a7815f1612944bc4d7931 = "ccMebLMVZlHJ0oaDwgRSW3Hjg/nTvKojspGG+6i7tG8qC/xJJ2cilWIrDhY4kmmvWrKojGCordb6oYypp7/cIepQEVZr72CmmAozJ/EX5AF8fnTrRfuaeOPcbl82ZXodJBEuZyWjMWeB5gWDRH37PqPUMl3HcsLDdeL3Esp7MUyPCLsqaMW59Yvw0aLoA4Xtd6k/Y+0PU1oabFUK";
const b41bdf454131dc0dcca641d1b0e33c6878c94020dce76c565966c4b40d30a096 = "gpJPq1qFhghm/mibadqpCjAYrtMah//glMGUH/pMwdFJ0IjKvyJG3xQszgecDPRxJNkOEEmogq2VBOsK4ud8qT642lycumP0ytaMrj7PG/bUeJmGBvvGKunDPey35VKsDRelU9xKTDIxEIdtQUk37kPUAu3nElZX7mnxChgSqwt+Q2GywhLvGGYS/UKsVtYKdoufcwe5vSs2yEmJ";
const ae10e46b7909315efdd44d0556c18d1749f173c1d55084bf283d3eb35130a287 = "miQX308uJQbp+KNqRBPEMoB+KSBmeQji5ZtGD7HbvVtq+fXFbQ3bKKbwACnl83URDXO6wwg1IxE7521NGj1N+nmjolVWURO2ClzGAQqr40zWMpLgixniT/XgZQC3sbd2BLOFRwsVuG+/If7FUMw27RuVS4uq5tujO9LMb5JZ3L/UpnjHBMoJbJb+R/C31SszKSNcZnk2Uh5amwaB";
const e8a0d541f7d6e8c851128bb8a4e5fb02ccef608b9e43fad0d412929de68cf1a4 = "ECvQrMUiziQn2wh91ypbbw/vAzhmRW8lkrlIwyyy/taA1ptiMoOO3pDdI5aNHYEzzXBk26rIayQZdzyZ3WHAR9bTfQOtmBe6eJ+ATPfVVuV/ci4jYDBZZH4voGV+0OaSgYllPke/7gEwXvvVe3pH2hO9y43QtuHh+Yvt4PDqIcub58WbFsQZYFo0VkbV8X3O9/R3SnQ4pCPVR8qm";
const d9fb75d0e15ce052cc72dbc97d36b10bc64b65bb52ece71cb59a5f54c22b425e = "1QXe7s7xOOzgrlrM8aYoKHKclGEyEaBR6+j6gOQ6WJ3o1PQrR86WUoDMvsBPzKsPE4BHNArNlBs7mhnHEkTcTJdwJMIVABiCj2g192ZZq0oOcB36brzeu2emKXxoHpEVcOdbihM7LJyhNqSQPQZYtkgGw5DpeByZ1x2F0Kw7056NjQjEwdPgVHQdsF3g7Wz5evblMqjIb0FtCjvS";
const c3eb2b8f7685bbf3e111ecf88ee0f4343e176b228038f40b815e0d69c2febaa7 = "fJq9TaNLUU6qBqDXukTi1n7VKh+SjLyk+CQBV29rfiS0Msarvb+5wTIPROhB51nrQC6H7b+qtsUgQFSHkIBVuHMB8BP6ZGArqpKA9mIJEdLdQ2ZzkGVfFaDuKeQZ1ls1eHMxu1o+pC4seL773HfIQb+ZBz3ML8bgMweEM2Jb8QGdPg5ZtkV0sEOZknYrbPWU3YktewGysi84WrFZ";
const e2be9550750e01eea27e0fb5539a56947b1beaa74dfe6cbebbe2d29f64b96854 = "Mxe+AloqiwAOOZj49/nElSqIreGy0VhVgemJcQGAWNXZKOplzVle+SWEFPdNmVnjavz8+tU5a+xAesTwsd53OH8jqC7ASyCWRs8FSm/hnRAWdgZ4toTdYRzghLjfL1E2RJpGvynllM1gvX87XAmrlREnJ9+G/hDA7psAwaasabXVeLjxmJtlgU+FWGSTHnGK2mV9vZddjMpeSgQ6";
const e7aebdc8d6b9bcd47646a07eb0f75b4bd6cdaa85fa35e512eb9795fd396ec071 = "YEW4TrS8q94Tp7QhFTRpIbMV4OBb17Duw/t6tNrhjRVIX7I2G/nqVTgEHIC1e+TLg5a73DGb9TjRkKOiSFf0UtMMnTxuE66mVOuOgKSr6BZLv75hWnxqVj+K/721u+ylrNOJMlPfzuYHOhbrrh3TKECLNB2Z8Dm42LUswfMjobp+Pke/BJon8TFRjqXh8RZCmbVmhWA3RupT/MNPJg==";
const d54fe43ff3f2b2d82e21ba61b29f0f4e825829a30e21892071297a4cdda063c4 = "sKjkZ9Lj98Zsumc66zRUAAtyLXAUpwCNqogZMf402UnRUGFo52yGfweE9+VzwBqujtVQ3jx1DCBuNHWI8fKA8Ts4v5G1vJ6eNVDtkbnalwTPhu2mjFLv5DBmKVnKk149K6jL5u4RWUKzKh86ynswn9vyUe++k9MEV5NSyQzjzgHizgIqYnxK9wIQx8OwwnI5OpEkfbc7Glg201ylVg==";
const e85f01158cc093bc8d4295d0d588a23f549de892c1ceafab8ca13735144914dc = "NAirpUXtkzKo9Nwu7sFrbI+QYVnJb7BFf29/H5Z3DDZecedpI83uRJm4MR1fQjR7Kf2QzRRdXlNtLE2A15qvc2K0BLdU6BmuVzYiOa+UfmOlhCQubSDoABUYJc0tt0tlYziRYfgK3bLt7V59NFSAHkn1l09NhYE93IHqhGriqK08lew6iJ0Ql67Y7xzaWiwNzFEYrE8+YbnHAnFySg==";
const f830fdef7dacb5f1130946eea759851af97030da63d4a0f6a03748d5595e71f5 = "eyMQijG4UEVZwMxOrocJWE5Orad0IrPK7F/DoHBulQMRSvAGS9pRR44ExS7i0A2QSrKJ1JAayR7Xb+aYDoFZ2Yjb+rpYgUCgJVhkSBMtBZyGQTJCzBc+ksJM13IHPkbOGxewwW5kvbdWnoaHvXu2d8M2dGrwWZf18Td7jYzHSe/nMzPEJbXLOfankiuRwfbExOaL+1huFateakqjVA==";
const a2e2285c7697524358777e03b8ba15eb34bbccbd6ef30151646237120ab9bb14 = "Wqz/sx+BDdM6CtTHnRPEsHGdRbfG/hfkPigLHCbhIL2nK1wHDGSxEMtcjtxM/uJHopeahPVZw00t2TcYO9oSvWKrzT+/ZfhAu9V4Zg+1GzIOJfUkRlBUERW8PZUhKgOVuYHMCznf0gqki8K32iXwuNuZmBanbm9yIFUp+Snm7QKQawvcS8bLWceWZcMBYbSQwcAjSjDEPm5DDG9SLg==";
const dfd99886aa468ebcf6f30921e95042266137016eabdcc8578bfa1e7ad14a355e = "jChVARgrssD8X8Vin7yH7Zdx4t87CPk7TCUkmTfK+tHZFMGG/zCrwjIUsPBidYtdeefVi0dL10PtGKvUokaYuNyN01W9Dfe0PNLieoorYEiXcpwZQjR9g7wY03cscNYWv6TGNUXWTYp/bsBz3X7xql/MpE8ToNa8mcmKX2SbrrtkA0Fh9aKU3HJmT1pM+7jND7W1syv8/ftP0fao6Q==";
const b0fae542c2f4bf264ec4140a09f0b1828472fe8638685137c187187824caaa6b = "9EBCeSGwKdQcW4RueOkmCJdQTsPdAuCg4dbI7ew04ShDAsc9z+ZkMACA7j3sSkhyv7MuFEqvSUM9EJyfnNzYmoi07+ZZFuj2K5sNU6X8frYBW8LPjbMNeyvZ7o+3HmircEn7dcDToCNqnTk1b+JjIMGmrVYIkq8H/gpcZ38Wz+EtpKCqceqpg7zsvVh5CS29o3Ea39XmkpH9medzHg==";
const af511c2efb1cdbe0761e1cb77fa76e1e891f1c95f89356c55203648bfb6a0d83 = "lsorOBg46s3tjkkXhPKaWEjA+vR8Jn6LbtMKSmeSWr4eg+UNaXRaKPnLqS6RZ1Pxt9vRJphOeHDReMEh89onUDrxfVrCjM1soqPAdsM/rP8OIpdQbfzhJ6iaZzBKU2ezdoSR+rUUQ8ujCGXgaZujuqssAdIyLLJP6FtkshPt0IlSIzhHybVEYHvDVh5b8V0VNMzJ26Xpgm4gQTNPbA==";
const b7e8889037f6899b8c5afa88cd308395f5c1b78d10a250a0e3adb034a3c322e3 = "M3e2R+S1Aprypy/Y0hVfQp8GsSPWEn+S4c+ZJW08JLka3tJ5tJxqrUtE8yfehxew6U4hxiegoY+CZ6hCwLWh/jFEQFXHy1505yd1u+VIOGd938LRebrE0tXU1LvQrN5axKEGNRuHgvxBNK59CMY8DF6A8zxO8feTTmSabZXApSt1gevVPaMBGavUH5+C57be/mOolY+ePgAACLg16g==";
const c92a834ead590e12df3b71bbc0a80fa0019da2906f40922953f3908a7e83e5b2 = "VcG3xvp4BiVkIoudsV6eiEBmuxOny/VXm4p/ZsMUCewInwqPuJkwiRxIO7WhtC4SSuUYIh+tWS6sAA3xT1ESc0s3ZLvNnjSFBj/1DHOB1KOu/fKK6Z2DIh+mcVftyF6DcNCnIMG60A4edkAd6dWZB2CUqgYToh5/Ae4tSqNfgaihIQI9IuINLdLVWW0KF3xaABi4U+i0eMObXR/Vtw==";
const a318160936efef222e172389ed2d836028e467b6bb24680594873ed3cf594d83 = "Sq9QyUsiifKIg2GaK8HnVITUamOHOHjlsN3NfErWInD1xLQQsk/tvBUKgN6uBd5XHMGYDvyiLOZ/KZjpCJhjeF19q8SZmB1tC/IB4+R2VyS199qIOk3ZMEeqlNcpNy7LEgvpU04GvvPHbIJhcjPvLYaSzjhjTtzjctwp/bP/77gy/4P5eaCYbg5kFBqoIFkMLg1fnQRivzhYeATPZA==";
const f747cfc86fd808c9d22b4d03e98d3b12cf6bb7ff3c836780fce348b65981dd2e = "KX83PVnJjiwmXmxnpClYtbv2aKH/9bfSDh36a0R2/KDKhslr5vJjNZsKzjSDN+91/Cmmjg82zkWip/nQIhgUvcO6/gw5YAsDWCfHSXv82ab5Q8vqkbzC6U5501ADb3MNTSXu9pMZV6FsjpgFAyYEyjlfjCMHSmayJNcOgos4Dd831DAzHyc0gbJjZd8TjfgDwu9BRs24+Zo1NDIgyg==";
const a3f749e318f7f22f697494cf8a8736be805eda67a76510e1c42d30d69fc7baf1 = "rnzmLr1fC2YKJQMxSPMXGHp56zyriW2k/EJX6iLjxO+aF/hiyjKI3Py7t/vmlXGwnjdREJWwHv6mOomjY6vYu3ddnfgiYS1FpaqYaSBr2Nx4WRUJ6rgkWkjt+LbBAJYGkxUvQrNSydoCdAbGOep3ibT1aa7yPW6AMqmwf085NUYLTm7RxCO8eZ4FmNGmAkP9nBj5FITi7r1QAM5hjQ==";
const b96cc30f1b8c6e32292ba32e7bf0005743ab7985e71166befdd86a71479079d7 = "6mrwcp2+9wuIstLyQN0sl2i4MK6cgXTQG8CgLrMmxCVA+SPuGimcYVk9LNJFpItoHW1xVA4B0GF+tbD5m3XrK7LUhut8F3WEzLnLRvVdJfNRAowKXXIo8vKDTYyPEm0QT/L31v8zOC4+qFo+X95dFP4VslsEvl2dit1B1S8GeEyd6ssPFEhKUimXIOisFxCdbW35n1TPYGu3JFULOg==";
const dbb51fa137791d8e164b1d244e60f28e9049e43aefacf7a425f57572b7eaf988 = "aUq9Yotbp06q4hjh+nttnlG6EyEJ8P/olXphJPWDYjb3jqqkcHoFDbMyxA+QAb4Za6/tF41/YBtyF13kf+clddUp8tHSlRUijKkVJVs08FU6heayMP8E/3Nt+Cq/p6+GXKHG8UWITVibhWCNfXkRabOmokQC+wkGmvTJbj0LpR8MBSK084tVORc1/INPAd8tP120cj6BM9DBo1BPLg==";
const a4c82233488b7687cfb1144f4a57048192cda142cd6564330104bb03258b1a28 = "lMxFsU9mNeK7xC5ZyfdyhEt8NmyNb5fzEk/JyABhajv8pKIiADY+3cOT9sVfGRGK8xrvl5VxDq0MzCuRyFBpQpylizHD1lRmP2kvMrDzR3nuzt0Hm0oWouohmzQxvTpCOr71f1LnQWO7vehn2GlwqDZ0dZIu+HX+fN89E/eVA35Brbxy510HsO3KfTLhibbtxNLWg89R/SKIMhmY5g==";
const d41a915f7ebc18a9ec738194d6eaaf66dcd26f20e9731a28d5903d6192d6f68f = "JtYN2MqRPWuHlf3kmWerrsY40PHFppiiGhzlvTHtHtdmbed6y1ypPRevb745MZ013r7ZmyAo/X5TQoLf90v0lImwlonUutUJqhIX2+kIubIQSfBgNtv2DJROQj+EwOs9K9QKOc+xe+4IoWW7prfOj/VJMXgRRghEBw9OhBDYzJKQ0GZB0VY7HKCyAum0G+CA+5FMxW8hQHKmMNOgBA==";
const a1804b5e808f36ded5461f80634fcd95a318ddcf11b6be107c3512bf1ca0d4c7 = "g5d0CzWfBg7IvLLkQzlSGtkpwMPCAPKLShVzyiy9QnHubIKFz3IMP0/VH4hvBaBH3Q+DOb+oto3MEwwvAexcTJzCwnYp/xTjAeKO29Q2w+4y3J28E4RYSXOo+MnhQoTv28kd+xjDmpdaACdoP6uV1sVfzkZ3YCM22GVkTKTnzttpqwhCf/zkVUCB3sCXYskp4/ET24Sux28+k4lIHA==";
const b60af2da0abe38d5cab66cb46d9f91b2fd31f8c4ecf2a7baeb3a524596ed2a00 = "6So8cdaDLNg65N6IUgA0tjT3j+VloCRnMfMZWrSbtBxfJ4PqgbJzf+i7CGhvwBMGb8saJ2gWl8Iy5Vq0TPgp/MOMrtw8hrQLN0U1zvlaGfA6PDTWMrG3XYRsgpuC+53PGee/CgGoyaEtPHpS7HXieP7by+7iFkmsVuRKT0dpLivKxegH+kipS9nhZ2/AyRd+/7r2UoJlfd3SlJUwuQ==";
const d74a5ff0b59519760e632cdba1b3ef5c3e0f80aff0b2b0a81a0ce5c60518f475 = "I2+8zuolxGMPfyVjEneX76cHmG9YEnKW5UT5dN+CklgzzTUAG7ozaoAPjow81CR+6qee4tG0H2HVpu2mkFUS8fZMdo4cq8oA2VsPIoLkZrB0pXis0UhMPBOkKesof+EyBF24HmlFOzMaTy/MU6nZofnO17vpRNOw7MOPhx82XQGERdI3kXPm1Zn9Bp+GW8v2j2tkPbWOBdWdnm0xOw==";
const cdfd5d99c8e473ca03597fae164ec309ebcdd035effaadecebbdcb7ecdba5e56 = "D5jAVcoVKU9Q0p/7rkLqW+5h78gdbv8c58NrtcM8L2T0hsNN0Xkrgv+oOkR5h+R75z9ra01z7GQ64WpZw37QB+K4LdmymbQPOfIkmuOXgIPz2ZR1fyGxbMYXGpPim3Dwbwm/bkx+sU1/ffYM70T0QzJa5lWlemeSrz1bvA4SpqZdgC4+CydLwv8Gcjn+/Br/q+85XfUol5jDRAh8SA==";
const eab688556ac17179fcd695583fc579d448b2392d7fd4090682c464bf79085085 = "tkqJZdn+Kys8lLNaEFRc0KIBPCS6p8/12m04XZiz0i1b/QQEjJLXN67Qgrs6hx9BGCSy/NZmKkQ0NVNVgVOYdu5X1/0h8PFYwYtWlj1T731VtbIyRfApcfYjGTSswkQrdhICI22xwrk6u0a8ZpsBPWjwsKmSnHbVTveB2nXjYfJsj8ukaRw0aAuCfq4lzQf6HKmkiWhT70hRcQlD3Q==";
const b4cfc2034cb2e498ea061e8fb0844e0430faa7a45fd0798add3954d0a675379c = "jVtiqHbuF+Z2U81oRMtIV/GmUvUyMqqupdNHwzUV1ajZgDzR6S93oB4ZJOi7QPT6vxcUT0LFLpizQslr33mTgsUZEtVuzpywLJVfScCCXSQOB67NaDHNWwPbKGdRZr3iUasTpa/po850sjB1onTIEKKnnk/mKvYmPdtXjBSmVqBwQq66Z4wNe7aFl1ZoFkEZfTfJpOYyVeS5+gMrJg==";
const d2de8b3ce5ff1eac9431d249956f06177ed27223c525b0991e7271cc3da43aaa = "fHS9KuhAVaAl9yayaCYrQCyIAAJ8jIWPStEEvAOjYKtdpDRPpMfGbrwI/O2DErHAKM1BGm5NBCSTLVQ9caiqExMRz7fhJWKNavOktfHkqDKnTMK6iiUSswteVzXA3qczwk1k67u3lq4SHSaCHHMVnm4H4+vo8avaooMKS33rOMmxM7adQLJ1t3KYWNJBASKGBTcJapTGpFUZq+Ruew==";
const dd9d5bca2fa976fed8dfbd6ed1f0b731b7594900aa0260a68b32d245a00efd56 = "lGsc9DSJfhhd5ENvSD+SRTQHi9m2NnjoMhf1e7tg4Hv0K4swacsi51Xcl/+PV+O1Uyva/9xuR2SO1k/x/OjRQPyGW+RhPxWMmpEcgshn3w5XRb5Xp0/w0Z5DDSbv1FytGKbMsSn+kh+rqAlDZXjrmOwGtN7u6BDGD2fc9FNAYWyG52cBR9wOCUgbHFEBqV5myO6+sYeeQiM0QvKmXA==";
const c6bfc0ca3c3233de7554dd6581911d15a623178a7131bd7cd7b62895eb88323c = "a3H6e/GTrcs260+txQ+Ucfgu1YUxnI7MP4WVKEmMClPg2RHZPnYD4g21F0g3DANPHzqbwDVd8K88FnWGn1x/i+/QPQ9Z89bfkwOlwZs0Q3nFwBv+OvFTIw23TDfA6FS0R5WtpJjt7U1TPtno3vUHhwwIpLn3NraR8JKlQgEc7zv2z4ZFFh0MLcpVJHX3OMs+cROKNsplEWfr0j1myA==";
const d35ae462910efb96510d99885b3dab5f23f8f4fcb1c63f1f099c0190303e20c7 = "40oN+tNhU8sgUhD2ZD0PerNl8IuMLQsqdmvFqc++fghdTlWwio7q9Cg37ZdsboMvlHnkSonK7di18K50udvPJ6QE+YSNYiuEjbQPLgiAeBObtDLTjI4pr37ocRGXP+6oGFcW8eRbm054s0d00JYXB40nPsTZ4RAg30ykKW5tazN/zhGwGDe4R4+CdeZCIXfa83Ll3wqxbdAjBEVppQ==";
const b4cbdf199bc82ab59ad15c7ee1aaa2acdfe89186938b8cda2ae80ea8a4d7f766 = "w3hWfO02pISqiYP3FQsSznhhMd37Uj+b1unVVur2eDd1xY+ZetjM546j72SIAxMM8bFKU/ZSQTZ6FHo9yH5VvofbXJKuolfDq4IA8mlOtnaF5A2jYJR4pFbggp6FTh34RxI20x6LwMjXElequtP6IrJQB1jhkNttXCCLlt92mETp+7BEb5HobOJ0WXD8XI29kwswYf3VN1NojL9Udg==";
const aac46c418144d9df97aa654d35e9d4e2a4c1ab2b029612d8e73d0f4c3b319e2c = "lGj6hZSc7oOn2rGh3h7hXLnQyYicgAkIi2J4iuXNEEYHl2y0QBzsLhwVaFcwbzKEMar7Cw1n6geetHlvNqtwwlnFpp3EPiLiAsV2JGRh4j1XL/DrtliBa8DthCsAueOJDsD16eXyLPmECoCJ5UrjndatNnC6mPXvzYSUjHau7sgOC87DarvfP1ExsCpHSqCqHd4D/z/RucPFIvxhng==";
const dd426a0bf3ddadbce1c1cecda2d43d0ad7b077d9b7fa23e706645a0bb5e3aea8 = "dmWVVXHugNltwOiFK3gYeDIv66r+5OOLPj+WZxpr7Cs6LVgevwtLMyhKORXJP7gRcvY04ZjSOOyEbDz8HZwd4tpabNss7KzMrVH4nWB/gSfQ+bXVsoAMUQTpHWLvD1WNebPiHL6FvfZoaPGmiPZNkZ8i+Il8dRNt7qv0f4Sj0Ph1Rf2K0U1gvPXOtLuGoOftYxH4fkrQ71lwBYpuBg==";
const cb94ae4f6113298f29ca7943874128b7a7c784b451fed63861e6e9db79da8ccd = "MeS9uIgS+bjEc5L0fCakRXgfWbVR+V0QL0YpGwF7JQwXka9mGfTJjxlhfrKYwBmFxPCODIdsGTimI/Vgvwu1Rfe/ZxABNkY13V4j5g/Lv3uTP12JjpU6i7ypisfPTdFBQgQXoJQnaiQipbxuTq9vrja71E0tVyXPOPmsv9Q0T3E2on1yKB0u5mbBOE8npbRCZuxnzaMiMywUQ6iLcA==";
const c4befb689b654642949dd43b28d0f175cfa646626e35f83650360b477b9f417f = "wHXXEamAfXRc8AmLYeasG9kuGs9zI0uKTO+BN61DaY0UscydbBRLI5gU80sXox6QezUk9rx4/ywtlopPb1GoNyqRWQU9O8AdY5nonDWn7cNKClUmHcevSSBjcVij9+HIC6KFBfXnP05qr6FGtO39ZWQoDLRlR0vUwHWkXvRSoO1l5k4oa56m/qcEbHeq8i4Du8ZkqrlE0nefhPDunw==";
const c4f8ff3142a1ca8eab0f3c67d3cf81633d97a7255b66a6b306b3b292f7082c16 = "u28Mlj+8rZatV+3yYFmlQM0OjZ0CptRQEF+kHnlFOMFy1kCZQtKmWVTGPMLsMW7w0Mx5s8E1RS6JhFgeWfNR1No+SlVkVMiPXpaRRbq/qbKQM5aL9jJEaSM7kXDgaJz15W521r7Ycf8ihCNNHX2C3D+oOebkMb/fbFb5+9LHPBntb3vVb7c7TG5QpFJ9vhAzcXe5MF8cb+DBBEjEAg==";
const d5be2eb891898ce503a3fee492dbd7bd3e089ccf6a12f58545e066e02c9201de = "K3xrhtPVj3EciVKv4F2XHryP5Q4kavAN3U7Bjgra1wNbKK1WGOlN4vqecu+bxnTN0aNMgdM+mdnv2gMbswSC4HiLhV7m8EGcS79GCmMtzAkwLI9UM9HWOuKdNBagrCTPTskoTF7sBE1so7LPNWTmD5TlPWbapbD+hiqK5HC1PSPkJgOw9BdBp3BM+BC7E4gZdhs3GqVrcsXwg42MsA==";
const babc3ad6f7faa4337822d81a4f953603d274ff87f7d32f21d39453946f695a33 = "FjS6lYDOF8L/RgLOT2qdyPNRyJ2zeBYyJDlQ92ZA/SNueto+gM8vvHFN4ThvpXxSm8/bCmu/6QfSFefIOudoTKluH+wMR+gf9+2nm8iILQLPYyDkJGixaRv0i81ZLfFX22GAq/4nCY9XEMh7Dhl0NKdVctN02B20CC+zSxgyc0o8+UMgLs3lK8dWU49LMl89Q/B9cqQsgk4ijvEwXw==";
const b444977c313d1b7abe63ac8f90a0cc91e7e8a8d21e2563a88f7fd91c699ea131 = "R65A7m3CNPXudZCSfMUzdu/pAKADlMC0gHcY11rtd2P54YuhmAXyAJRdfx7echZPsNP8kLmmAnman72aqlujtbxq0BAloeTOdTrWiJ2nS5zRdmDs/Kjg3qwAISXVLdk4PJAOdP3UMUVUf8Wp58oTN0t1jAX4ZKbee7m4YytdFA1sQafHyDgQZ8z6hdlTfOfFNDwlpeRZF5RavSu0lg==";
const c560be44a0d0333a30ddc7420aa69d94c3759af5a5bd681d7e379ac09b2e127d = "M3Gz82nLeKPomU4jGMb+adBPN5qHjiWdHLPAr9+azYar+W76mefRzOvIKdj63k4ycGw0PYuQFsE6MEoP+Xpep6JnbVWFxpUEb9I82zcl9Ljsh7FxyCS0/BVFo3U7ML//1wluB9Hd4JW6asx9gDV6Sr+OJHu7efKDS0GDTr1HbeFONalFTejHl7W0OdakmdlJLjEgdi7KGLFvuhNEpg==";
const bc1e1dcaacc0caea5b9e41b6fab4b3a75ffe5cfaa77d11e188b9b773e34d56d3 = "AK4Y/VsmxV56OM8SBdDG2C6g5ifrMTAq/4K0ZukPO5yg4RSOBg5wC6tVSKhhmopawEhZF/FBZ+8akoeypxUjqP0/B5gFVAwga+lzfA42o7VaKm27rdawpdANzlHX2uC7K0ULU82yIfY5yJDWkfg4vfoZcKLAVQg+kpQGc1EWDCCSi2DmunaqQd+SWtCtbINag7D3IqOqAELCpXLk/A==";
const fd6418df1a792f141b8cf09edf1002ebdafb9131808205e2f6d120d571b68d70 = "7yorGVaAFbqrvKaUhf1AnXO8Xhekb0dYICTUVME77OK96jLiCKA60qz7pZBdYlsKCUn4Y/AU6SNaVJ1hqlz6EXkKS/H82MNhqVcNgW6mAhLE/ST5wDgC8M6mwzomLUg96oIVtNJoXcsYGQRy1gwHA3NL0tFq3SyH+PKS5Oo4iT25VPM3Eyydm7m8e54OMWIfn6FXfC6KBbMgRpkoyQ==";
const d6712a38a507c5f5ae3ed2e9739728617921598dc8219011833c29a78f415b57 = "zhJFzVRBwBytM13AxG/RZwDYiPQrxz9L475Jc2t0wR+WATm3b0319DvAV+dBWQbDoxFsXvXq26Nf+UbMFB1728dxsFJZHYxE5cOWP7DAAjiflTCP1O5r9Inj8+M3HDHroPGP7FWFlAqVf2kQWm8ewrL3KS2V/krOiLGCAzZ6y6i5lYCmHIIB99CqxEEKp72yQd6uhx+28ZtVUmzrLQ==";
const fe40789748aed2ebca44b00d6770149b63e38d7cb54a0b448191e42c95479ddc = "XdX7vgFTvzUtyilrfgFh5NWUjTt0+d1GLfqOOLJ6YW/Kzj1Gv7PnxyX0JAvCB5aW/OJhRvAWitIfRoRd2TRJh6b8vYItGoAAJUn70EJ2vu6a2Xjq5AsDFBRTToEjeKz7vFx9Q9JzhHKDIHZXLotLtJP7f3+Vfe41CxDd2ho7HJ3PKiOx9WlBlaEKX8OlIRt8EkITPDReA1tEqOw3rw==";
const c32c13c62afcd06a93827ee81be792d495201202902e2963b5e5a12a88a7b476 = "IjR9n9KUe0TlVacz/7uzvhRLRIxp0Z3Y9NYKrTfiELogkhrM3z0Am0JIFiwv1SipV4KZxXQU4pvBkMfKG8qWrKbyIRyDoWkoYYWHj+KYTGJr58dYnB6rgFZfaDZxqml0RaCWmJazCgSB+j3r+Y2id1aTyYmk6Ns4jxcUZ0XxgmSnvCduGxexKLZQfSFd3lxArR/fGRctpUv/8NeyZw==";
const de43fb6b9fdee2ebac5e0f2cdd76830ba474bc87220de4bcb437a235fe4110b6 = "NUnNGAZ/5lVRyYYqE8hJiC8Fz/Q/ivR6i59UzWyM//C3ctzEV6hzULgdb9PUAinC34zDF9MZZ0NfmXmZ5k/wJ0znkeshswOsWWqWaPYJVNU2JUpQvwrNWDJnHBXYy6QBRsS9Lk/3p8KoS5mkdNi3p7BqtbZlmRHJeUHJfS4dYNwC44QLuOIa4Ana4uMHERprVirPUW+gaAYy5yhZ3A==";
const e3d9dd9f12f32b0f47ef5cf1f3f5f3c7d7901edaa467a901bae17d7373c5f99c = "Ki/oi5eO+DBx/s7Jaj3Pw7TJYuWx8k6khFKaX5hxXysb20u9D28P4l7YfB20RFQkE2fyjby3pgFeVXqyZNUpybMco1yHpP94i/trVLczjOKHhqj8rQPxR6PCEdPN4FRmkRLQdzT0xUYx8DwOBDxocTBLGR0M3cP1/5yZJP4XIW24I6c2UsNXFHWHeFcbH38o7yDHgvd//+JtndUZIA==";
const f398aa6f33ce64e804334f5a86c66230f805b56d57d1da80a7d97ff51255a0ff = "B4PwH8zfbzlxrzXHGIolNAoHts9MWMTJgJ6d1PWr27Tkgeul0N9/+J5lIHn98B7MzsjVzgJD4jJFkFf8wytqNK3PLGbehdN+JFKOvN5qF6/gO7ch7Z8F5Io0r77yzBUDmwVi+BlHNII2Gqqckz+XspUbrBMQ8jh6cC0MhZHJNW/Hq6WSSMVh2Cu9BicUPwmY1P87tzrv/fXA2chrvw==";
const e81732ac2470b86482c5ec2fb257f4cf9d58eb670ff60b5980a16352fe4ef79c = "KSdH1cYXrVsdG21Eb3MNkbszyl2YeZDn/xYaDmtcNL3JPy0xsgUvTL6CzErEEfjA2W3q1XQNGCXLUpXz7cg8H5W1kgaCM4baw08EjUBlEv/6NVy6Hzje1HkO4epux94F71rbtvqqgY4ahJUj0gjFsms90fNgrN9zLPaS8owzuqhQ/MMPH3DeByo1J9EG82DE4b+xvR8DRA5HQOjmtw==";
const edd78aeedfe9509aa39f55e1deb145b31bb5baf398261e5175b55ac09f5d2958 = "S2Q/wwwLCiSBpECy2Vm/GaJoI6peyr/0yoHw7pFT+A8sRYR53f5ngDvUHp53ucVfd/PF2qXTfDl3mkcx59RhLzzlUhzqaAGYMkqs3tmFtvjJ0bfUX/xTpkb7HR5BzS7F4eN5dTo4JGR6sAKvlT/HAyNplK2hICOMIXnzeJrneqFqXuL9qESU0gzMjIgVDnPJytWHB2xdXA/tqYMl1Q==";
const cce8b1538c0c6b6031ad94e2314cf234b261b881adace341d4d9d9f93dac8bdd = "gknO9/+iOd6xR2oqG5CXwAhzaa6MXi84M/e92/w0r8PzaZvN2/4DhJSGNXzdT+y/8AjT+/0YH4kEv7xxgoZRgPIissFvLhVDFZWKcDCilPdl8/KI4AOxr+3sYKDOsa150VcagsniWzAcWu74voXs1wUD1/mGUChiGoftfaR7ndvqayNQzzWVfni9BVRHOh3+mbhXh9pRI68jwCjpBg==";
const e35aab63c1a3eb522386f93e88ce5f7583b7850ac053929b3fe37cfb3e478227 = "x53AP94NDgpSFHdTWY/ucUhvTEMdk3PA4iHdp/jbY3Rj/OnRZBU3E4z1FRYhOC05u6XASoJkHIRXgC0HRka3gXIVTLbfV22zvt8xnxO8vnzKP2Xm2mLIVFKp5AHcSGjeatMg7N+9wu6u1Z8bjQzsRDKbosYOtQclGKV1X5hwFumFBQg4BYpgUK2lnmXPxDOAEIGNvWR6Rr2xDhrWQQ==";
const f63632860ea804e352033d15622072f6c44bd47555160b7ca59bbd81268193ce = "/AABMAqcRgo1wkAIo0K0ZcR7lKxuZchIRRvQy7tE8YbLweT2pYas0zXXw0+JIhjaahcdRwbI9KqzPwFjsoJzfNa+GDTsrIkKtSkyQOaialD0LmNZc6rTdWFEF7jDyyPAdvhdwTfJIVgwUpmMd+4Z96UrklzGcCyI2tzzQ6xsDRMF0CzlVgUiioHYKXmIr6XhYB0bDBdMO58jAr8B5Q==";
const f5c438ccf77586b008f353f0f7d4093b80dd312d782f8402ab2dc39b2fb19da3 = "aMtcwqON53NgHz+JTAC4X4YXw2zf8OhNAW59Xn/DBxiPlNh9obAf1fTEK/OnsPqDXL8gl7hN28DXb9o1TP0yy9dvi4c0hLZwb3D2U733jGeAO1Mh4eVlZPyno86iMde8iw0x9EGaO+2IpKjSo44xrd76so5o/hnnXqOKKBb5qmW5r0+og+8k0g0dxDQ5DFkDio+ukwUY1Av+xtXUdw==";
const f3aa65aa6f2afeabb59e2460a421165e8b3a0f64474ad4c46c27e1b39d7fbfbf = "wa2RpR6mJLp4uZ2csKrX9BvEGSoq/647C9G5RigFKqYbszozP3It0DUJK7BhBREhacMpGnVnCqg7c/4cSx4GRugyGsSqRgPx6ElWpJMonA3FvnUOMU3MoB3gRIBG4tsXB0GEqlHdHUxsAiGbnpv8u40KWMhROuQeYXAOwd1XYhPt5uFrG/XhyU3C2ODUEK91PxqRhkAsnTXG/QuupQ==";
const bb15339cbcac4b8a945434981718a9d636e460faa6d425a310026ae9646552a4 = "wf2WxOqg5k7cXhqFN8akOmfr67UR1soAXuYqa9GDv565YQqsACognFwE6VUVPxNltDBCFB41bn0DXYrdF8ma7rM/AkZi3J5ZiBdcU3A1Y+y6bkMJ1pnR0YAWDFJfRWJXXLxmDM5XKklxHBkkLftlSHvpszLp2aco7x2AfqmdNrytfKGTsuA0DmN+MIkkDS9h55rsYFljqXkzEOqP6g==";
const f839e4a41948f0ff1d5ad8b0521c71ed4c473e1e30e78f343f7991495f02e873 = "dGhN8gand2OC8vU+fxX14tbdbJqajr7Z3hQFlBGGD/oCARNiKAGs7uTyuM3L7MC7Y3LzSQ5yDBRYv2dq76IXfcL6ovat/yEZzWS6z09xomzQnMvPmqxSkJB8fOst+gdL8Y6DlyK21Yq1k0pmVqZBof3uY3Jm0RV6tnT/vR0icAhb1nawo1H3ecZBFm9kpL5H8k4o3QoAQ0auQVloMA==";
const b3d4f3d98d296c31912fabc0f19ed3d4b950af0df4d3ef48fc4b53e0aae9ca74 = "Smqn0zhmKL8oBjHB2n79B2DuMk2zaVIfm0vyvvbeFAMm1X9HAxsZoBQup49ZVaGWRtFchBbdLTxo9hDdqNcFOhfII9qrTFcuXJClbd3sVrS342+s4CErKW8glHtBh7CmEcEDpPtLqTm2HbsUuhBDDbVspGJK0MsPEmvqS3I/+ahucmlwgDxojgvdGOEkNqWvIwm3mm5F5AVDgKavvQ==";
const a5e5f1f53fc41a06ce54720b9751d19bc993e2bb7b21f657c7cc9ea0d703b0f9 = "7GyxCQ2No1BoQm9UvgMGzRgeMPkm3rg2QsbMVcItyXUgyIG/8+25obWUglBLhpXTJj0O7UzrQ9MnYs1mYIBaYYvAXVOXUA/Axms8o0ePmtbJcabm7wLOUyGr28yYWlwqDpv2wSIGLaSHNlS9N6tGuxuvtFeJ/9KB8vArjAV5fSvRh7LWHFu262mWpTlCYcycbLZ59ez8SueZkhoVjQ==";
const f62218ac483807038d9392bc5474edd2c9490f516aca02be42c7696014908eb1 = "AVqwFxL72dtdxzcZVFCvnA39i9VAlJW1HMtdwgQ210+rQsGNYZ+J7CgZ+V7OvOHcGzLzjZjU1vJQzp3pW61lXTsmm5E49QPOtVs62Dk90QXOYDI5cFvk8YGKlIcU7Iv6tjAJtqTpd7JUpNbKRwlDuN1wydCBeQrNDLCSY6AHiTrW77e3cDxzIjy0K6hm8YYSRCuNzQ2JbQUgD4+evw==";
const f4bd45a8b046e83dfec36d858c71805811b526e4e313103f5b18bedd7f002977 = "lul4qR85Q/d+ysTnB1kP1DHUtWv6OZCuOINzrdg/plpffGXyd0QrmceU+php9iBoY85PTfTSXeflCVg+2Kr21Aht2Yh8rLk6Gst2gEmCBKIdvMRXBgrFRMiEnvlzfzLMZoay8gMShi6JqztGntj9BYGkVf347NHul9u9Q+7jzuZRroh96z5EWIrJXiiy+93HL39cjaxwHTaA8yAXvA==";
const da2d2e280664b57304a514f17450c00edaac4e3b6a8aa31b61064442a37e8d81 = "Dx8dh6UDbMAzLMnw2N8JPIpDRnREVn7KclEl6p3JNBL9rETPlXEX7cKnotP9ihhxLyaruN5EMirBLsciDgomnQKJF4nNIGcfU/sWzV15y4wWlxzUO5CGISqARhkqMfhXUZVL1AkQiJWly1DFXGDikaWcLu9E0YPRQWvctqslhn86TcpZqY2Xk2Tx/sgyv5i8X8pggb/on5j1ia77Uw==";
const d649419297688c6f4141c5a0fd3f28129327196828076ab5bf17fe403f55eded = "Am0znWQn8vJugOpFquYGWGwLi3ixEYG0Gtpesw6UABWpq3VwXN1iwSh1TTZaUDYUOClFLMTq8TFXEEKuMMtqWiQzxzXtCwaM8OVd06YvDe606ukDIl4uNGowlr9ZRiaQ3rxwcRO1Or4b2/vZN1muqms7IuR5yaFCWwgr0XAiZS4kac4ECJ90SVWhD+UD6yDynW2E118Sjjgexr4MpA==";
const eeef0e604e006139acec8e999d07bac7f7e48c0e6911330288c11674024ad630 = "EZLS+03RT0CDcVlLGCzx6gfBSmDRBsc1N/4ccLxMVqwmvXJIcc5xS/3bN5jEDIlg5tGhdgh/xd04E33tFWlwuNs3g/JTNCn91kbiNvtiPgfG2EDRDbf3uznDXYr8I9ZAPvZsKLpD6ST+FETyIQ/enkVYJODWR9m7QklhfutDaMqGLSGqrJoHVyr9P/WUGDZCgBk1DN6g1w3dv3y4jQ==";
const f1e665185afdf633b1859e374389704c803702f6d18f768d6e654dcc24b6b1c7 = "vS5b2nzkJGgY/aoteMEnrSkPLDB4YUe843ZbsIHdAOK0RszWyDyFyAF0r/CYK0iBnsQ6RdXqKbUlnTaLEcl2APEawYdaiuTMc1TMZ3ldClnjywpHDnAPyncG7QNrthKgGyjvmV/+H8gn0cPobFf53t+FF3P7ssyvzpgwwkO9/b/kT/Q1X8aB301JKzFJ2ngqRCt4hyYZV/TmyTqb0A==";
const ba2041fedbc26dc9088a5c1f5c7bad053870575adf230358419101b009e87019 = "HZx3p/02kFPdj8RVr7wqGN/+jlt3g0YmsGBpcY13ZmhFhxJPpb21pxBOPYISD1jLYrUuAVbVyByVNfrezKFtn7VGE8cuLHIqthBmerhfm6Kol4y+qKGrCReGe3YIGZaDaPpVoq8Cox+R9GGaH+6IBTFTHHQZbCkj9qiWFHxtYu0xlLPmTHDReQKOWo2ton9KjXbUEib5wTpPLofhOQ==";
const ab89a537de32e258dc9a16bf0f5d1491ffcf56b8876f03a20c4d21b3447db858 = "lh5tWR6EByS3A7uMltoZdty7cpXjMXzJ35CG3UNU6+CvppPFpucQEBYaRHgJi8m+rT2zu3c9d9c5/qrGqwosqxEJKj3WasiOJ9sTbKsyQZrLlfWqlkTBMESnBdSHGc0olyufa/sPxNMTtHsYRXP2ZRFpzt8xmfPaTJAZdN63HZGzMZUppUI4peM3LAGlhkKYdbojQ1oZjPmAKRHDAA==";
const dca54f7977e804dfeda185df6595a2cb3865c59dea2633023d28e180e9a5fcf9 = "KjqcqDPxONmilyaaeKkoyWRIPOedU2y+vmmOLkG5dxm5vLYmxWODg4ulUhAXs0msb6rm9wYU876iiHwbznb4zWrYWSkmo4bjfROgR2rRNFdde7N79r/e5Q6JJPG0ySTkAkvqSxh7PDsCDT4hkGZV3Zsx0VZ1NGOeU+v2iqYzBu0UTyZCD+6436VezmnwvbdrEgXRlj6MqUV/YJP66Q==";
const c232226f22aa9abbe83edb1da6a764d7183585898d15529c96da30748733be14 = "sn5+6/a51wYVzyNWMGhhFJ686m8ZbamxWQDo/nh+stJV+YR6GkEjZoK7YyHaNgjcKNLWqp+oxbOkynypBFTZGKE5gNQQBlWYdg9cHcakkH9B1W4W5LV52mmBD5+kVeQCx856FjmduF2+shSPB8Jk2xjfNMC1jtNeZyfZDSr9muB8gjxQSRBO5jQZaJtbgESIzWmr6Zt4d0XkjSfMtQ==";
const b294e4f7a6f0665b9ebf569a786707da2fc84a2c9be88be4ec7246e9047a1775 = "oDR76Pei1oZQmy+HOsbnDKh7TL6tEejFTOkMUGTU26lHpb5HssYVtXEJ2E4XA7YQwsYt21AnBeTmzsX124hERWYrDUSdpn+FOZqmrTRrfPbHjhf6XNx8H3K7m4hU/nzUY7cCYhPTwiyGAjapqrtpF5QgGYsGUbCcUcXZXGXNbOo/uS8Y9gspofNeujHSOrQIEOHwrr1xPoaQjtv8mQ==";
const d68712cae63a3b1db0b6cb5a79c1522ff2cceb30ca634e6038c3708b8fb2ab38 = "yx3q1rmwxiTa+Gv7RH0I3x9JgbnYNshlMF5K1RTOZY4Oy1Qpk/wVtvEmsuGAIihtl/UDPIz8WLymHuy4+NwvoXJ7eFYwp/2j4S7pbBiQU8pPGx7huIOwA1BzcrraZw6GzN4c71WxGFCXjCyb+dXlvGHtiL23faaMS5o4v1DN84JjAoCLGWkeKNBJmrxzu5paFldxPeEJ3TY1lM0eLw==";
const c7c67153b22b6d1e445558d02ecd771d608a4958275282bb692c3b51f69de5b0 = "C1DxDbZ5SqlP/3RTyZMD0xImB33Z1WTigQrFvXQIfFmtwW1pkdLVyf/ljIKFyd1Lr6v9AHN3Z/uMLfFO71elmFHkluIt9k+y+dO0jcCAHs7w4/SN6xpXGq6xYFYJ0HM780hN9bh6k4sYSM1QgihMlhPEaF472SYVQO0SXMvf/3LrTtrcwLGliS/s0vR6q9uNuGPt9eKHjcFWuL7psw==";
const ce21285b9dfc36abf1679689e722ccecad5149b7299c618c964ce27f84ad7323 = "vfj+G0V7ozD05ihkiR0U4GmAqkbqAoKRKFP0XvUkcsGTBvseu6D8C/0MEIg2jJ7R15zON6nYCco/5U/ARQFWqd19h3tBOceqnROXwqhpQiu76IITRLB8nShBdHV6gCY+vUON8+v4x5o85bvRfjZLrHysValAwBv91zVjDjMAGUGngTYyMu+rQ70HX84LilwFqIHv8wb1865gTTw6FQ==";
const d135285d4808bddc3d3223300337df1c691dd633b76b7ea15fbbf60c6b011f9c = "jmcV6mB8Q0nweWoYoqlaaEdJ12hEYE321+1hR0t8S9twSsqusCRcUG7/TYYUMW6jTV5w2GXYYLmLbpSTytXe0a67mS8FDZ3bfbfFfIp7/xzKaSl59LyZkuFqV1eC6AtE+6+JXfU0AhUWjQujsARILeiOtXZlgs5VPCuA2gcEcS24+hVCjWGHXWSmrnKJCDVCXJcVNK5oc3uD4qrfoQ==";
const deb6b3b616c78291b45ccb42fc0541fd3ad7795710fbcf5c95b879cc864adf4c = "m9ZTtmtmo149P01qs02W54+PAfZQ3XLZGg2Or8/o9rlX0tTpeGAMVVeptz/M4StMBf3XVChSk0sJtw5Pb0uGTB51iXbSbeByOqDDXnq3HzUuNpvF0PkKHXz4I+4VZAqswjKVgUdsEqwCLAeVS42didiHfUQoz5X98UmdXMBNS/ksAZ5/l0w49LsNb5vD7ap40y4WbfDVh1D9yD/waQ==";
const cfebd30c6e33bce1cea1bf537cb7f0b903e2a74a36eb9ad1dfcafc35fc61b854 = "Ugypo5MaCZKQ513gtRTWDvc87HyfiVPHt8WgUXdq0JDberaC461W4ec4zp/t9BkR0IMEPMcn/Gg1giyFy26Bfn45wQ6Mw+rSKQsMJwdwcI05BPUZ30e7FQmu4JpzFKsDC+/rHpzW+GyNoUCM7e6NRUB0knDN0ByFXRIOKjcnfetXGS4QsOw107fBsZfVcXFRXtpdpTpLbLpL+LwF8g==";
const f315483b4f19256181a1cb4a6f59cd29cc721bb46882642ab1f1e32981e8e8b6 = "froI9nilFgsf9pgK8DVZO0ggx+KdyhUNLLGLjy/igfyAEjj6dT8h1MJQLo1M122g+PPERsKC4jdwc2IS8PegfuMd9xax/d+Wf47VT1P+fHZB7BcEYCJDXzAGqFpgWR8E26UCnhMANq3jE2KhVEO6JZ7j0E9QteoQLYSYm7qDk/c9fhOubKiiFXxE6j0dx5aedo53hJ4RuLKbx+kH2w==";
const e99b4d452521e94fc336d9bfabf75fc6c215d3e837127a9db7ac9661f9a32cec = "QDmoxbaSw6Hg77/Fww2mzMzDTzgnn1QphHDF7jx0Q+v2f4R5qJxDfWGXq/5Puu60Fd5Rv+f/7HldW5eh7fDD7MnLtw/yx3g0t8JQg+Zd6oF6krH1VXshSgu8dRJEt5TkMJoo6Rpw8ceQw6w6H/+hdc7R153LBsJ8BiMHn0r6/6Q8BLbTIL1JLNV7AV0eZrmgz6G5v2IML854qQVCfg==";
const ac0faf22549713bb55b0ab675b22f6bd0b89e6f51231c823806e8c25602b385a = "oZrXWNnwPQ0lFQ3Pc9mP9D+FC+6Bh5QFX/J0jtO2eaWDjX2ls4OdqlFcJLxpM+kFtdW+S/8tISjx85cnfI15dN2G4384EDBTK6NtpZNYSzSTm6C2NHNGysvZLiJDZUwPgqbJ+fGbEhXTQcvynmwWF3cMvsqSMYwO7x9oHcid9RD7zm4Nk66By3VvV/itZXVjAAozRHhPYmrSwxKNMw==";
const fe59a0ada67da802de8e2a3e8b908b82dbcab51cacc6a7908b67100330e60903 = "ggs+InGFqCzuvb5Tk/FF/GmGu/i4w0RJQBh/Ri2uBWaWQellFzM7wsyE40F4zvu/Mo6hJR20VyUSca8BXO/y1G9C3U5om09M1wa9tCTTdVWya2gC3/zHCbgonZOEkS3Gyc4mZKnHhtK2g8TjTg65Ohg9FFW2HncJE5L+Po1L1wC2lTLhK868vi+TWtOlW5gsVaE6t8HJd0QmLqW2bw==";
const b52855a6d6cc7843e35c1af74c5fe7d1fa4dfbf9c406f28ebfda3d1552753f5e = "RADshkAy4xnAP0M2Pns2/PUJD7p41XCrhR1cdjEJP/tExW8dDHFEg37lJqcSvNjjKUK9iZa9RPyxa67Qt/2xN47g1HH3FvKTjBEmZiLf9z9/OcaG788ut4ZUR/RK1zo0zxbxglLd6t5gRrmXN+AXqBj0pqMso0GjQ2yewR7o7tT2jHHy4Bzfx5SbDYo9uTkyRyKcgXQAQK2ma2DJbw==";
const d6792ffe2475b276c4bef72c9efab1c4151b25abe83aefb422289e4d223a703c = "Q3Yr8Jx5uEUCiExI/2HxNSz5LADCSqz2IlTeHbwqlngwz9ZCpO/BkU6klyxOVsZ9WgPPaqHNau4rXZEeNky9x/7z/yfCTPdxWwGJNw37s9gWxLoSwLAJv50egvQhtlIfQiuV7UTHxFXU67tJY/3D9Vdmj4a5E0PTCw8jS9zOpwCQuWCRy/4DQWNLlOkzGCbB55YsoA//cC4HPBMoyA==";
const b9644b551f1ea7657a0742661cd42173ffb721e6d32b9cd70b4ebca7eaf7b771 = "HedK4GVs6TzeEQrXuLItfutafx0KdmuubEKmYuF//6kQ9I5RtUxd8Lvhbni/TH6lSKprScdrCYW8f0fKJPxJ6PO4wEJDmnw3B/8BglqvZXuLHDzKgKcoR0wyuQIhaq/cwEqvAAOFHlhgbcP4ch+retCtO2UQN6v8iji4XA0/j6d6zagQ004CkhvUDgJ5PO43kNzBhdd+saTRbiWAAQ==";
const d4f99327fc0c30217500a8661596e8f9206158ff7d2eb973041de977360d68f4 = "bq5Ez85BAdoEZeugy6zEgfy125GfcOvSJI3bDrAc/wfUO/t66dPASQsP0SfjZsh77OKqfxp8YyUMMsSxAzhfQ9eiGpFd30y3FRXN1DauCio+5fxqnHbAK9wjWhR0zoWM7mgO9UmICvRxKIbpfFJBCkxx7pbvCfFKUoad9hRg4Ji+6jfnGfukh2kXn3IQN+C95NJI/Z/WfRM4VU1mDw==";
const f0cc39ba71e7464ae117776f64a59e555a9cea2939ca1baf2460ec6848b5fd2d = "fEXyJRfd9Wvv0rwi4K7dcS0LObJY9OiNqm6DW9zNA8/o3nZCzRYUCXRh5i8q38Ry6KBDJuvtLiLsCDtuwglJuWGdwyV+EHft3IBuMGj+gbeRFdBpbTFCA86NAsim5hoiwTIrnp//m2fxlziwaAKZ+TZ/jQtChmzSzAexlJ37ojQW0ZNSADipSNRzTyNE5AzeOb6Sqoqr6N6VStoJ+g==";
const d941fb84bf526df9100093f498aa03ed6292f0eae6bbc82b7c0525bec3fa4cfb = "6jX2FjdMKCQhovOuUSUSiGYdLTdevo0a2MduWf0Vq3+cAgGaAQYuHLrb0SqSg69vfedRulWMZwXYnNDt2MPFdn2nW5SzQeL0N8U3gIfsOY7GgcII5EA4P4AVPbralefGwXFCqmskmCQKV95P7Es1T+c8kl7PLUF6G0fdsCfJ6mkNhXKvssESqWXnOeYRpUxXf6K5Um/U14RTVLSBSA==";
const cfc7b92ae9af58d8372e022f74151c6bee06afa8a2a3101e7fa9b0c7e9a39c72 = "Ai/TkW3n1Cz0cneSiBb8DjetRFifiamW9hty4sH1WTCpzzpxmn8FQGg0wpJ8hMuxmMDIzvZCJqKC9LpvjxrW1LM9ntn6hjs9iYLJgTqiHh1I4hg68rM/cjEbotnTQIpyhlXTm894iN/LJ2gWYVn4yi/g7oJ/HIBjSaWWWWx+ltBmGfgT6WL/NBDCvP6PWLOuHINctn7bWliCnclEBg==";
const d956337692ce4a48e1e248c5f0b58cb062628f2510f863cde55bad2fc98e0708 = "LkrBZmUwMoY2Bx/OfguqiJf0IdkQcj0/peKjCySu1xP5BGwCjn7m7BdCroip5Tr3ik6FQ9GaS+Nqnon06eijKLi0b3OLN0YfMBeyoTlKcWyHCTWR+1EVfCOHKYKh8dHhRV9DGM9o60zdnbQHLcm48Ja6mkDZr0eHSZsUzM/TU590njo2kLzHif9JZ0yc7Eu27xnfAnWEN0fWM2Z6pg==";
const f2a23f16d8235614aa0944934b2af9b0e86a9d363953c4fe4553e7bc8f8492fb = "r6DnxvYoim48MY9zbZrZchLJJP94FYHaRkuvhZokL1PbxXOYs4EQgRA6zNchC/iHyy6o/YvCSJKd7yPqoCEqfZSy5B6KEKMZ4kJ97lKglV9OFr3d/ciA1ZtQrG55YgLznY3DAPKrpxPaz+mSFQG92A8dpQm8aAt/HmFZfYJtgVEAXhd6ZI1IQIfUVP/WPInMqECMh/1xvl6jab7skg==";
const f7067551242d24b3ded95f95b576788f1efa1d22b82562ca3f3a53555bc0c1cc = "eX8AohP7Yyd2lcIe8zq9mExYzuSbrDulG29poTULJTAnUMAXT1kAHN2Q3Q0iU3oesK+40eLvFycYsNmc7qdn8DF5GVSndZKZWaSd+n9ozbT+DGW8246SrGgxT/jj2lpy029z40yJ42hGBF+3+c8UCRpTTXVWsFPlT/CSmNnqid/lGI9BMMktG7X9aJ8iFFQx/ibLuYvvC8zyaeAodw==";
const a1b229f95490c3e9fcce6f1dd670703bded9c74142961174bf14bf65123ccb15 = "+FroUuy+3JCr1BAkQtrmj4wWf32SeyA0DbdOIYmvH4TA0DapN8nVujhwoXvrr6T+tiwJWFLxaGA7rDSVXnyw8NO+6/SdXB1h39hMoFks5ED2KKWkrcvn8bZAtJIicP2haNCXHLuCvqGr9aPfWAkv3W8IWuVCNoMSQ4ZA5eCMKX+/REyRpn7MnsPppsPjl1hTeyUPXMzvbnpCY71OzA==";
const c9a27dac9400312022dab6703a5e6e6f365d61f95d362d8c76deda5a4d6fde61 = "TY+Hl69RZcnHbiGZwuRrEniMo1VNCDuEchJJ09mEoks4OeIEh1hpH04PuNaYx07t78GL9kwnLICwO7/Uu8g8nPC2LXyzqw9WiMUoT1aVEhxhLKAk9i02ybawz+uolf0JU6XZXVBxSY3SYsW/7wpBYN4ZJ4UvzOD8lbLyXFNN+2el+wfslGtJhcVAlcSRB6yCeZqgToJgTmbm0WeHTw==";
const cf10f1c7fc12325630734ccaeb6b1ae37dbd0b74fb479ad6b14f76a8de20480d = "rReRPsPSDJ4eRmwbas7Nzms3NPouRzE+Rb1FPsA62KmWcCLOPr9FISBl6Ni0NLiIrk1zUxNd54PYo3U0AYIpuD3gDV6wkbR1og5OM4Z+rQ38tFKzwIKrRae12Fb9BAo2N1ORGJYOEek+5pMp9Dy7yzbVz1PqY9AhwlIAyG/Eaa29n/+hK5pO4ekUe0S2chKnHnNgA4cXGodbOmUizg==";
const cc5fa16f483685a99351f29d086c5321ccc0d4db74d09a3b45e467222b11dd09 = "BF44FVquKIzFUvmPcdmbb7HEBNtGnm+MssGFBDXpdnVAArNGTfu5EKxAzmMIoUoM1UkkTOuwwR/axSSED3uoC8m6jEPEgjWfUoY4jKF4IxlfODJC4NdOG0KWnacdyob0uP/FQnaNJkBI22sT/gbjE8EeG9IjPLf/KLwYQaZiOd6ZV10aWeVEFFqNDi4wY2bYd2bvlo6jmqRUvOHiAw==";
const e4611db293c0f2becb362b19cae0cb16e8779e31f4909ba25a13eb22409a138a = "OJtLe66OnltHivclgmB+2d2sUAmyw7UIkcumyp3c2skunNzEA1tEd/oR2Ram1SP/bkzTp9ruide8d4qxCb+SNTFptQzcPZ1QtUnUiZ/fNJT2FPdqvlyoQ7WPY8O2mh1SA/dPg19ustr7ZTOlJvqtrvs3cv3iEeEkeMDFpAqKbx53lrvuYgkuJBOC81h1JtwMzRv6x/gH2x6NoC+5xA==";
const c6fcf9ea7e67972b33e732007e34198432aab4512a534abea3eaf1e0ebc007e9 = "+u+HxCjHAXox0o6xbbc+sNirrADZ+oXdvqCbbiYcIW2l/ZrKvQwUsyg0izyzrVNPofqL2mDPVxn7eIENmumQyvPVjfXU9PwQW5E84MO56e5ystPHbKQ5fbHAbk2p7ASTGnvO9YHh497BxjqPwCF7p2q4a7l0Dj1ahoB42JvzF4ehYE7QuQMngMEh7NHSJcX/zkwypn2FdeP/Vn71kg==";
const e2a992ae266cb88bf396246ea18179ddd8d4e949cf981fba2eb99b370b58f14b = "Q2kEOhpYXC2nf2/N0a32RSZd6F0fVGcqMuOJVvcoJbNMbPKgFT+5Rliruog7n0EarNjLY30YvDK5NRGOV/ruIDRJaJLaItaUbfBWP9+DKgwJN49jAYGRH7Pyby7XwZezDx5CuwirE/cVOla7ALPoMcfwiUHj/ZQFn6tUxfZCA53tNyAmxSd4fwTMeMYzjG5eudgg5PwpkgIlh977CA==";
const b81519e842a63369a495020b8df87dfeb67c60fe0579a8ed8e8ccdcdeec49f1f = "Yer7BkGvg0yoZwyyYmbLfTxRCVFwjrX/eAKQ7SVUVg7P9JNICDxeL63vup5VIIsercQfpo4H0bBHajMNTXSMKdRzrFm3udnHbTOmMARh5z/uHyb4OFxchqkcm4StfkdPHiw5b8d/PPqFUyQTZzFUaq00lXmQs5Uu8+RlB6ZBBjawSGROZ58UCieGSUzUlL55iiWzsVF7wZa4zzak8g==";
const bae21197c2479636ecdaf535e263af2c7babca16f9ee6bff595827457d1af9f9 = "T7XU1eqNi6HpV8G78U/YGCbcaaB0kRsUaAShNO4BDr0gZ7cjoEE9fNbooxHDlH9qKx6ZWeAxTPa4q/tJcmQesnm9LXS/jNKWPxldBPc/ZvhPL4R1b/PH8NVsAii8J4WT7pge2IiT834CmAuQQAW3I2akGgvZr8gwPRHpWbtfAMcI/3U8KkiXeGdm4In/6h5xhz+1eqwNn8DGEXq15w==";
const e8b34996c11ae4a9bd9cb7477358382efc8d8c9d7049faa1fb0164db270204fe = "s4DLPjh5knNdZAOBMts1+D/n38oa/auORW7dj3YmnH6V3vA4MTiizElHVz/lsZ/To+PNB8WqFgPrLOltazswbHXlaCYHoEr+L5euV5wW5vEArROLxVtiS9Y4zlOU/UzQJSy3rnBVhLUrPFyi/Tkf9a8hZQEu8PJtBVrgy49TOpVGViWBu75PEp7EaHVHBXC9id9zqft6rF7F6QIm4g==";
const c0d55d6b861c2f588ba4d24a5c19c1195c20bb0dadbe5f5ce28f7bb2afbe0815 = "rI8welcFdEwHPmSATAhfw9KlvCGoG1HW2W4WtmIdJQ/cTPVYiccec6dkI4NgxGDO8f07pLwBnu982YNWFeAJub695eoMahNZOyAqyt1Sqf8OMKmpw86quRGpsWrfz0AUs/qICknBbC+8HBFVJFEG7K/hHHqWxTfV22J5uoaEIEXizVFfDVk3S0Usj1dwo2zEhr6qRRotYg4t9e6N6A==";
const bdad977af5b870a0c026ef96453ea7de51e481d0747e6bb686491fa9b8be457d = "JZB9VsW9jm55VKVhkyMXPF8mSMDOjHAIxL2Or76H6LXZZWWtXXYdIie6c6mVv2XENWbme9R6uLBnURWTsa/vRyYqek5Z+FLcuROBfwQMX8HNyQfa6nEo6HB1KEcNzsK8h63Zvy25svLTaH3jX44ryPITXK+Ze3eQv0wGWHLTBqCiXhNtkx/L0WDyYjrDyHxNkpOx+Zkit+2H8Hz33g==";
const a77e91c30b16d8eaaf72984b83effcb11cc8a3a1e25fee19426854919cffbcde = "WODS53b3mq2Rg6tRCy9o1/rYiezGLoIAt/DNHe0IL7G4D8za/Sb/mSdRMo8U+d197rXbWDyDDRvGhtKutnYNYplcFCyaVvdytEbQry6Y1g/oSfp030ViRIpKnu0yvq6bsAGDjor7rV7H5mha9YQumKnY1k19ewR6gUIPEryhWqthLJTQTg/LZVnxr65hfv9EKnBA6V5VnsFyBzImkw==";
const d90f6f3d3475cb68feb87673e3146f23f8b0f55e3e13ee3069438824378f3c3b = "uNxE9lFJIgytjlOKvOp2ziMfkJsSUjVIjcn73dBq0CYsg5OGJsjLQaYcj9vVcIysWa6XM8vKpVbunatTokCwOcvjYNU3lU/9WVU8hqyF/O67bXIYePY135ExEx5qi0liGausAxYoiXSOSft7INnWoLYTm2iBNZhNtXG6L/mcSvWI1ji2kvT3nY6xOxJpa/ziw8BULY+CQIeDAQb0cA==";
const cfea965c90d7c34d58ff4dd2d15740c783d89b945cdffb6bfb5051f193fae056 = "nUbz47bsaeMuPrKjWa2Wk79lzWr32xQUo95K/MMi8qNk/aIh/ig5EkpHz3Bxacsze68UtRPY8U1EnHrs0NuZNuDVNsFfA1Kp8SdrQcGJF2hiYuAyxHKqlxjt7sLj5gl/MmtuxRRCxDFXLXrlQQPOxqW1aheq+XNFEb6Bl6itVPNI3EvQifnBCvffOrZgTcuQyjELr7GvWP0y9o0/nQ==";
const c98a307e2754f532baf26f68eaa22944632255a4325ab2366382e33b292596b9 = "itu4cYNhTI4uTvS1V/zLGY15sklHEhze1eYf6Hb3yJuUL9qVoqRGkRnMi91Fd7FUC8RQ/q1Jv+kgfCxeSIC27xyQ7IHf6C9l57njWWZCbLb6R9T62RhqvnBmBFdIwLORJ3NhA8wNB3DUmC3KyB1bed1EWAi2z+GhJP28zdYCfNE/zwpVvU8eK+fKBHzzM9rG0BQexr5gVnB6TER+4A==";
const c76ca029103d640a66190cf1052abb3b52d5ebb9ecc5c1667078e00913e9eadc = "LjG6/1zqxeFjomnxOR/u8GWKThukpkiEKZrQFGG1WzVNn9QlnNck3rCjTGm61CJhl3Zpo8mSa0Zz8E8ejjAOBpua6C8D5atlHiP+l8Soulx+ktoTvrwc3HzM3Tt7wp8mpo219AFMaznsTB6f8HlD2qk1AE8Qs1pE3YcXEMQkkp1GoznfT0ddwM/JL0AY33/CkpzXi02jDctgztzrKw==";
const fdb255d19c5c597ca2fde3100d8a06d0c5965d86775d71b59de4a1475b61c32d = "wmTuaPOL6t5bBJVdOu/dCysM0d2IjKNzVTfmistfsMTuz/oFQK93rxJPogfnhaDU8MOX9HFZ20BQlqK+KozLFUiw1JooVgtaEkTiD/OmNV+guR4zbQI0cHzqIs0B/sVW1QrjClI2D3v/nBAat1Rc7tMD/t3aSMdHPH9arEtSnXqo2PC80zzQAjNWtoUbnRpLNzutDiZFWZFsTgdzWg==";
const ee6b79569dbb6ed1e962037827e998ef89585b1d5b26b1b7cdf822e6ef73e2c8 = "UQwFSTY3a7P2qDVFilTc8OizmYa6CYUAd78Puf2av3e6REUqs4soCguuYGH2dU/4Ou0M02jlt+fclZymibxVN1NKNFTFmKgBiAyBehZg7FdNB77bUqcIipd8SxBqmBjHCnLPa0ZRnqi0rCd5fzgxQp1Jaz2VIlYCxFLG9Dgxg8RfnI7VT1BcIMuyIl9xq5nQrbrdepulfCR/TwjzIg==";
const e1dfff5f3fa7cca7da9c49883dcb633ef6ae1a148c68d8819f74dd0bf2a882b9 = "F4BgQLUNaAlkMaM+PDFAQLYJC9odeEqkJ3dnusleJtyc1qQxV7p/9l4FC67YUDVdjwY6+IY+6hGIpTWqCaYV5vYrKm2EmtMRykWNDpmH7I5ZJHSIAfsc8YD6Id8ezGgpe39ohGziEpkh4XUEsdbixy8XvUBNBoP9HLd9SBdACwXwSGM+wcDOMcsiEeR5fqEoFhxRk4kVoYYfAAXZ7A==";
const aeb8a40dd65006249237a9c4c538068edd602b9827cb3a62044703f5d67d934c = "qeeUcOKekZF0UEXQL9VUh5vp8iW/YvuxTOKLTkFny/ja27UQh4wm3rkITo7yUfMIjDupQ65WWcti8QnECtGVNwcz4qj/wWJv6w+skGt9MqoENi5ju0/6fK3y6BH2TQqye+n6jtbKQRIM4JWT6MH2UA/AxDFTJSK2oIU6al1qy7L8XgrFLSRuQMkyuaDmb8WZHc8W3hYS1vPbuh/hnQ==";
const ab6d3410079cc9629dc5f1891462dd6f8c00c4f2b2d9f9282dafd3ee85d66226 = "YBYkR3GIUSl6ZuvAhMycJ8NdnFXSFOGj0bo/tjBxgZ3YhWvi6tSzZXZehtLKIReNK6YDhCHxXdgk4k4DJH4wJQpWxlovNLIO02Fq99J+SQvuZa8BjDKUbPRQkOOs7j3L3BzP7D5KHGLGg2EYiHYsF235cC/LG0e8uheT+eTT2fQ4J6yj5NBqtp/KqctyIJbefQHQBvsIBxjIMB4y8g==";
const cd2dc278fd06c808c38eae261f480a3e16169ea4eedbe64b7821400fca51d4b6 = "UdqCBRLQFb18LKvsC4Mp60s2aItSYig1p1RjIAli30bIkTcSGjw+ZmbMq7Nx/IU+AGlSHazm3qeH84WhZk9cmmdFN5+gNeuRwjrcdjIGITdxVZuJasnbEI1yJz8TGGlIEbLtG1mFEa6DdythZZGwStZOx9N/+twU5ukGrerL1hkzrwwVEmOgdVG4kRfjBceKm6G8OBaPY+0t2NJtrQ==";
const e8a4ae7e778121e2734ffeed7c23a957b6ce70aad51c0ee1452ee2dfc43712a5 = "4Q7Fw//JXZGvDmTC9X+v4VwQhHBB0E1kgGiW3QcrydukiuxghpORiy2caX3nXpBGLKEyVwWlFU71b2NU2j1qAVV6g9zZnevCbm2vIdT1nxQEmCQ4EwDFbntr7e6KnjjUPBW2VIdDAFsdcW110Nfi9vIX4dJi9U0qkQzB/cnxKCzZHY5HHznRqsX3zmCYxD6iTs8jbDk85zCyBkoBJw==";
const dc7a4dc92ecc20270acda5f6fd51eaf794c765a2d7c841baad0fb5e686cb5046 = "T+gpauTN9hIDb8JgCxroy6KGSwTlDN+tBDGzmQ61TXbbXpGG9O5mXGi8b4EsKxoQrgruqKiciNH4yWO7htt5uGkGQKuUkTpp3p0OFz/Yo71pQwa2CIM9KGZO9HtCAq/zkQVdmRzU8xKAGfdX16WwbnCe8oCIyqt3TEBuhUNeuX5lZQ16CT72WWyVeWJw7GBnNYWiE48qq+ck5fPeNw==";
const e6d5507535ef60107cc97b269406a88e2304ffe8474bcd5ccc73e244ead2b729 = "BLsjFGrj+l9aIUsh1WIgBUO3c//c1r7G4m6fDxs6N0rRcvBzdoSb2L6BxG7zGF+8W71S1fuAMZQzIh4y9STTF6DD5NW7zorcLm4yp0atV9rP/4wiwb1J5sa2EiOXRRg68WF6PBQAyOiPp5yoIc9B/qVBXhPTJ+h/5jv/EH0+N2f6eBY6kj6F6ySDUC4kd0vKoH0psu9mx/Oto2AGrA==";
const d611a71dc7da6134bb5f2c973c299f48e54ad3c517998031c3c73c8b2187c83a = "NcN8q3lf6PUAjG05B1+kwLE7skP253lISuVTCruBTUz51rrgd6U25ZYqS+XkuATTIrL8YiZ2Xc/8DX74mXFgXoAOlmuRac8NoNGrWYVE23J/PZSzmCy8EHZ5v+2wGuxjOph1dLVqec6RRtOaXl2jJ/+hTweZ9EuOePoYvwGSmuSUMLTnOMXez3D+TmNGdPqbnVL8OoVYQhgBSHxH6w==";
const acd85130894be08345cbc54b49ec4b62e1a71ce3112f7b9f9ad211ff49a8e737 = "XuAopZP3QfaZq/oamtbOSFZL2cBqNw+xvogEbd55HkLK1HEzMVQFNto2QXBpv3BKRlCaRxmNYvVk+2JnY7mt0yTkO7t+OlnQbJZYrcyGqnm7ksfc0GZgYhwcHAxakOdjca6/Ic6Yylb+dXmL6kmZFJEIO/RdgmFXuhlPpxi7xNci8l+sqEC0201kUEEY7OKVquwCd6UhSk2i0vbOiQ==";
const d0cdf74a59693dfb92b77274018b7a9bebd1189664bc5e8981e32f0aed288ca8 = "9AXLXl6Uvt25z1SSXXx4emJFmv1LsoTpoYH+NKHuW2tYmQyOaWlYL/PSKeWmdQ3TEHOJBUfltEXUENWjHSRoGFYnRpSbbYpvFXmJqWfJ3WhK0WirxY8Y6F8U3PTfnNMerrdU+mywv6hPFr5TCksrjG1Mcb89m2VfAhoY/f7MeWMAz43UO5CD0gzxjgf8UHQ6LGANXotpKa07O0SITA==";
const bfbbb57df0b4684149896e07f0a93603534cb459827d0298b4e2138832a3180f = "mY7ezw9XaeY3SZS7IT+LrIDrhFZOn2+Oq9N0PmqLLAc9qST4rk7YktosSOJ6IFMrcaFjz+ALTb+4PgOM0281fAHkCF0KmFd+RryKUaaOwpEk79z+WlpmZCZfeFEjdECJ/+1pvJi+5usRL+WkoBxKm0igmSoWtbirr5xFkEx6f3bjSRMZ+EFuV0uRynKvA/4Mv0tp5uYs15HUeWdyfA==";
const e3d7b655835bb77d1e4dbc65066c308e0053c2657a37cba556052670029d0f0a = "tvemmFbnBWOHFXA75YrDIQ7UR7kKl6ivk8ttg4pOUfq/FkCNIc3a9rcumFTic8FOc0XO08bdZgR8Si/yARDFR4fwOKOB/IU0GQtb72jVOyrGFfBO2Y5nCUkzvF/Vvv9ZQ1XatkW6+d6G38+TMjwGDJ/8cp3MaMQ7U8sMnZD2BAiWRn2FttotjwPeVe8vt9vcoicbKmv9fmeTUPan8Q==";
const d3e1d9147e1d2844f29b9c81bad01aed6f7730cb4aada564d328be3e1ad262ac = "M7+3gde5DvjlDo1KwXP5DAguk3b4+p2gLe1qr5g3lT4Ee678DZuNMc6rd7UJCwMFJwpBPqVXV61fVO21h7CtO2JMOE5vqAJm1sypk6rCogpHfrmbL92uI9TuXy9ikyxsNvWwRCSogE67IcPa9duvSTGUrDn/saeVTHsPa3JoWyyXu0U09HkmT+06jsE0TXIHIi7c0CmYGBsw899LeQ==";
const a734b62c5063b27ea563d2aa12aea97ff58b18b5c1427621d6c232a2a41f288e = "fAbj49CWcdOaSXjf0pjLZUqZHaZiQ9PRHtrCmi3C4tbAv1muXK8sweYSE0x3Njh0IiNh9a6lPG1A1bb8i98c5WUsIR5fPKa5S+C/Aw4cyoB1vs0/uu3USqapEyLHk9FOAJ7yLXvg1vo7kDpdaNvRgdHP3BkZ4IXDbYaw+UaJxIeT7i8P47IKxdih0LUb4t42l7RKbacDcDxtUpIbIw==";
const f6b8a203a50140f31e02c72079f75a3e91ae4c024b0d501af7cce2cc2eab5bc8 = "5ukl58D0mIWC3WUpOGN+bM4xQHQyDLOkLBrrO4JNsqYF/iOY9u1lZAUAdHO74Y1vQQVa9IY8Vhg7Jlk3iEDr0ri6LZCIbv/gnb2+SkETBkqSZHIG9O6OFhtnTMGn7sQrwmbcgwNpEme/HrM44AGByGGt1x+/auVa+wKLpRbBbgTtrD/hOEQ2g0XxRqXHVh5pl0igpehGMWZlFTwCjw==";
const d9cbeb3cb9c48b62cd7f27f1e5f889672f0a7bbec2bbf44b7ff81e5bb14cf81b = "QAkSKTjKNMLvo6U5A1bYODuDtnEW7YBwh33wQrxD6SsSvFp9qcItbgxwbwh5SfSLfQk7BdVcNJk+vEGwGnKv9JWODrxFRGjaDETWv88tQ9ibojBfyW+UHd9pFRuGdzvNuBsfxFQQdf5bbWpkCvReJ1VitmzHgIdZgZ1giOfmIQHXH0AzkDSz5Gkly8stjlD1mA6o9OXYtLKXyWtzLg==";
const bb2e346a41ddac3a24f1fb051a4bb797837399ac75824ab8f861fa33f893f0a3 = "QHISDkgckHkElH3eaFCdIhJd7AJ7Bixq/uur7TNomTdR9AoLzdLXtVFytIUcylMXJtZTqnQOKrk+wT6C9mhi4cDd2BnrLY16aslUvSEkQNNWCSocHl7Dvy5fYW9e+wOxzcTscBqvx2J5RjNM3n3zhIXhGL9hgDn4ApQDqr+PRkew6iirKnfbFkmXtHH+IyKkK2uFNgUW+HIiHQfAnA==";
const e3919776bdb9490c29dc58290511feffd75b74c689e950e447e279ea696a553f = "0ygUIuoAjtTOXu1zolL2jirx+mbW5dhgHFPhmiJ2+2MBR5z3QAUqKCKr/pMZrWI65bNk+UIjgcwG2wrUqQSa4C1sk9CTaD02vrZxsyH2B9qX/lLzWmNbpi2APJrJ5Jd2a5SeJ+XG3laO7MJNqDhVDHSdJuk3kZsIFYez+iN3RW/ZCLI+w2qvL7ewWX/VyFL+JSqZsenLuDSOZHORLQ==";
const b55c413db5d6034c194ff92a332c80cb55b862fd5731a45af41d6957e34ce9ec = "CsxrDkRxX31l5Bi7+9bHVUkpV/Oq6xBfl75rDE4G6X2c5Z1T8VyX2dMuGYeAheSrWR8Dze1LSNh1riQ/AWNSUPY547F69ow2LVGXDk+IJLOdQj+xvb+RREM5d6W+SrW66sX2CTHUSZ8r6p7I8Sg1q7xgp/v2nRCtujDutjQSEUNDcZrXTjMDhAiifoTOO3fnQeZ+prHcsTDjOqKaUQ==";
const f9fbeafe77ae2e405ae171812209911e105300feadccfe5c6556857dab7dcf81 = "xSN+CmJVPtiy6pczO3FjdQ+8iQe8+PviCLuCkIJU+Zoj15buT6rNu7YF3JDKCLfoDjyaF1OMSxbZHioHxCY3nrfQNspR3Q3oKVprJohFlGRc4IL4tkv9wlnQn7avI7mQsp7Ad4mqL2OcypKY/AUdflLvenBqyXDXbYrcep9qk4Aoa2/M9p20v418EvRTMMXpmHb9W5RBYjP2agD9cQ==";
const acfeda75b23c276419ae3c6a8265074c000f5f8fd78b2d886b9b37b33ec1f1f8 = "JxpFWdsqWA95qZyFnk+D71OXEfvLvcUN9SKSon8jh+xEOqKaTxY5uq1B5lfNPd2B8tr9J1x+imroPPyVxkX4TLrSKqO20wzoiHR5KSJ67RSNfWNz0iMSKuoTJgB/vjNe+6ScZg17D1DPswzGQEIB6b1SoSpXtHF7p3YYdP3tANFfuhviYLfyjVP/lBGASY6TKn9FYZbHQBFKVdbPKg==";
const c36f3af1e5f0d23b8110b1830e84207cdf160cda13124463681cf3e8e52e57a5 = "h42RVhIWXAPKu32kTbpFYGSPU8bbvy9PQUeWNeouxTrya6Gy2ftHktA6zEA7frdkvLCp2Y9jqPX0tZdyJT4XPsq6ZIqQeO7VMMF165fRK/gjMEQsWMEsf+xdEP5jC2ayxuEt3pGiuvLeq3aXHLp6ESVz+Md8Fro8UPaMKPvE6vlIIJWPc/RC35iSjz3qqvPxBA+Oh0QHFag37twWSA==";
const cbc76e011ff3474707cbec36e39798d8f96f2999b63c6fb1166e51c2590393ee = "zL0xjD79NBeg+d92MyKayVjBoHiAJNuTsFYEuACa94oDkdaC3HsQlHBm4HCHrBXDOJv0Gy5e2tpjGTFZS6fbkxoJoYyQFeNrhBvWyYN2Q+malj8aPp2QLCr5IH7SPeB7aGt7pTmsC1bPQ5BcYhA6Egpa7kbVZdir31a/6REvcCNLAE1y4zA4bHrOr+sXq+GM+o2qzv4AfSuzWXwM/g==";
const d661ead8e860b46240c783a992169b14e7dec41d55853099d96bc651d2f0e42c = "8Y5CKXdx5h+iRrNSrO0XOu1pnZM4QrVSkUMBPrpoZLw9Oz7Nft/EFbLpXk1HcJaP760EzPQmatdUF/Qk68NIzIQPMXEnzkxIzlRs0zbvHaBWTXNgV22/RJXhLBonkwbglJqYMiknnwEtU3qIFr7rdz2bHw2AjtO4epFq57hh+6xy9xOeQR0al58IbCUC5lwTUSD+iUOsFEkUvS57Iw==";
const a0caf7069434ce98238c4eb2f75650c0743ae141c5de75e167800300c7d63ba1 = "4ibvOrfgsDHw9Yz92eGZgq0Kn+py3uisNdropmpCwMw7KH5ARhitpwdmmJeg2r+4O2oKGwHpOixLFWp0wKZHe0via/iQj5gSujGemi5nmtR1y+yeqTTD6Y6U2v8eFjtTfN7BY5I55xilEIffyrPLsTZ2TcYJ8Iz4948pDN2BQKW7M9QyTYDuIbYwE6fRvhhmMZbCuDg83XMFOkQ36Q==";
const d6ca692266e92ef8faaff312327e239b482f75d1ce16fec11c2d5a630f27e7ed = "HtpG7OUTUUIMdnuGlSBg022chw6SapR2vYo0xv5LDUDRXxdps9bb/dafcXeO1vnhsdDOqTbt2GKZqGpvTZJwfHkAEURNYJTtz0oBc6OQ3ikbXLK1oJpxdxX3oRmyVwB2FAghJ/9qyd7FxT7+6RhSKLybhvTBctTlUp7npOTdSHR4TBFzQdEHl5+V1Vbrq6jsl1zOe992NEcgb80Jvg==";
const d9f1ed1966a561f431b1e4ddfe39d1a2259be1aaae8b64486b900b45d144fd71 = "+u0PtFtp7IsaLAG2XlwxvJAXvLqqFwV2Mfea9Ro7y+35F5RKHGTGkBGFQUgsYDAmQLXOtmYPVMA5gXqLILCSLsOOgLCaTtyhaGTJKgFFY+28YPuCxjfV23EcSYUDZjRklbkQBB92R2oQSrNrxW5wtydUmG4ziPBo4ta8vgys2V3bRuNkDXOYfhG7Ny0z79ID2lTYcuooEkyWCZb+ng==";
const f4298a09ba5a8ad8f4c989be65ff916eef34a82343264117abf989731413e044 = "SO0d7Ht5ZlUue91Y+zNFSpR8XetcPL8mIPhoWYYW1HFTGZwNzmiuTWSgx24M1b/V/FZ92EXagQRwQltkYD5z8S6aVeBV1qqaaEjhZ7/Nv8/tbcet+S8FDyJzYqjuCzEXu3xflinYtyrr4TRixP9O23LFW1mCk1CrmyaQZv5bjXHngPgLyh/PD4SLzkdP9m6rP5lMbfyaDZMdZVSPEw==";
const cc8ae1fb2af4b869be06e502a4ef683b6bffec4aaeb224d95562c6c924761e2c = "S3fMJ2tRpZeOydztHuhz+lW08uRsGy5elRXda+1JLL/uQZfsactFJTvW0c/RmoE6dFZ7/AnEv8aEt809EFXlmCG39btCACZbfnARWO9ECKPkXDlWaJMcBsNyUldOvt1bOdNQspf6a08WUgkzX1G6hyo63b3QUKdAPugYb+LMGNyuole0fS7XIj3WvfLYt7ISMxIEh8hNGN3U4OZuqw==";
const a28998e96be69f02c7524e7889697164aca6bae810437513f8e14b5567a7f379 = "dctZFTwanLQXxLotahMgXPJVt4PsmS6qTlhl4NvOrmONF0gMH7Pc5m85FnS/TxAhQFrc1iah0cBml9V0pns6BFE6JeSiwxRqQtRC8C0y74hEMxfwJmgrMQlL8LrdwPpSDD8s6yIBTadbLm7DS3dg3tHEHK6/at2iVOW8wXM9LYvRnn1alTE3Mkwrfrhsm1qWu6MwFQW4pCBPXc1A0Q==";
const aa1caffe6d3b79f7b3df942f44bfe9b229a392238955917ab581233228f20e6f = "22ivUXhw1dx5UAzVfz7m1hjyy2rLzaVGu/78z+j2nYm49GfiLkJx8ZxK4AbBm9vaz0koCY30LTF8q3WnaPY/E83YE1+EV9/j7N22v7FG/NfgIuasdJKJN50+gnW/n2fE2tsnDdbH0I/WEcUd/tXcPGOlWsSpYVgr0bWgSm63TjXHz1tIQppTGKvF6/5DrBgx5XILaVBWLzk3o83Z2Q==";
const e89e0cd35acd2b6fb6a037ca332c0cf19eb1d440fbdb4792f336208a3626e8b4 = "REXsj/05ew8/JHEzR725eAXoTfl0m3UM6Qe8WPbDwR6TXSASZ0hdhfAOYPNK8eaVJMZNyo945TDyi9gXA0vdzJIzkkq+KFllWnk+hc/W00GZR+nZusDooyy0msK0iqZ69FLeEevGG5UFCiNQQKX0JILoR9D94wPgtpjPQjd7r7KD6YgamoPdvVvC78hdM5JtoOqy/w9E9e7fi91vdg==";
const a4294c8b94b03974ff2e32966fe3cd927b80f66ddcdf610fa0e9031d510131db = "6qVfjIYY8u/Q1glYTc3Z3yyaHoiYHUXsvO5Mj7wovl3ag1+xbShRGyVnpladqlyXPLwxBwxPanal/4xsjTFDHwAJzPRhOZK3IvI52mUXbLKFu8FNNPjF/tR4HcmySUhCl5j5IzY5VW59ueAL5PHk8SGMSbJ3cW9kCWyjvegptKWbgW6f6/otbUEZwGLmCHBPWn7Jw+863Hv01RV9dw==";
const cb4f6f30351366dc9f6bee6e60bd43de1fff99ab10f6b7646ec1faecfed0a59a = "j3vm1IS2kVMYRvcWRyGcHu5Q2IA3MgrYUqgMwxTb/sYcC4uFQLL8IHsIyLp8Xcf9DhgrYVvBwpoUDRulS9CzE7lh2W5eSFrvdw4cL1jTViyzbZy1Q7gQSKGhuC0W5SEa4sa9n6fIxMoYN2rsfkOMvfqDLpyGvPfatzWtdXnSnB3et9KIzTIWYJ71b83e2qrbQKhSggAQgeF+AiQmSw==";
const a1d53b3ec4428ecc8d5f5cf36b5a3e31ccad3c5068995013dc161285c82e349c = "qYCuLPPzomOMQJGdto/Tncvy+RdoeWXqphKhAAK7Vl9mdojuQNQ5sv1y64xfzfOq4hbzOba1Cbu84Kosei/QEmrl4WoyIPmUOE7bQEir/rhBELUiEC/cRt+9GFWsVha2hGa27ztDp4KdmjnAw31xzLUalX36S1Ki+wfLBS8JAY38GWs2XW2slGk43V/LjqPby81LyRx6ebq5owNOTQ==";
const eb73c204098457bcd5c88247c918a9abe02d46beef8209623a3e74a6deff8888 = "X1uPQqr6ku5oDKjZtfYl1z6K+isYQaeshT+2fpCBG/T9ETiTQoaUvw0jVt7brZJfYXUuE9DE3oUKZRPbmLB+ESPZq9cEKN4kMBpOLZO/Jt0cHEfYu7cn0Z7QtcWI6jGfm7B0sly/dM6Mu7ft37FBa0KrT/jeBFrwXn8eNPujMhMb/Awfx+sbmq/xgOTA62SQrKaUjORFMHQAGLmsJw==";
const bf3b491dcac69afea39dff1d20e0b4b3fd1c1e45a2b66169371320b3f3c337f1 = "dO+ChRYaORg0zn7jM88J7X+mmTg2ST7NB0+6G1LgC06aN9qLWWOSsoA/it1jkphR/jzca/T575rssFhFnEme5T8DJ25pywuFdy5/FtGnnBSgrH/TcxtglepNvyJn//Vf13jAJSFvUCADbePlaPHDOfm1vm5MHV80ok/a8tm44jpFIzqcOV5sNzGUttn8kTMM1Qg2WSRJyaShpU3pyw==";
const bc9dd2d9435f4794679b17489042549934489e203d6a24ef41f8c64d6ab7b366 = "K7fm68oGwn/5w+yxJVIrwBH9un2IqqeivQs92r+LDWqzGLAIM57mXv71M4nqhNkQwaXRSfyA/3RX762eF2Rc0CwtYGe6fhFTjqmbAZ8jLd2NiVaEgMtkexILIGF4O1uksVx7kMRMpXg+/cKGk1oULDuaM20Q+eqq4ZIrGTCR+5oB3UffH1YjjJj0xfpHQA42VLn1/4WOtn4reb0o/Q==";
const b13e7327ca1884b3fa1651a1ad555dd844bbb0b785a1dd290ae392834d75790f = "AFbBzeI9UefWOwpXHwOPuXJYNLjAF3KP+3OYwCU/Ql0+wGHOQTrdTlM3AQl1N2TLusv8otrzoziz8nLF6cPvNksQ6KC9UvPEGCQUJOpebf+hAS/lM9Qawfce/OSAP1/i1azTr5vO5+GnmCKQXA+Xm4Dcq/arFki+F1VFKEI6IJRXhiEc8PmFAyMQBenq1eH8vCz9789fRx8Nq0HJHg==";
const fbc5a83eec33b1a6a4a5fdbc67b531df9af9586b82c2d4ed151d57c9c4b53363 = "ddgbrkpu90oA8MZV3EqYT6egkln/bDN30AFaIVRDcywbz46w4TwXgZnORDoe+/S0G1F/4UuvzE3zQOMAhUzVrjl0cHotpcji85LFOJX+nBXka+iE45++Dm/pR+iKpHY04j0PdZYjQMyfG+tX2YFCexBATbU/SFeUmbibi3ENG7zc5Du/BQsMptl3bx1vIYs4BwaV5TsiZ17fQty3jw==";
const bccc96c0e131e8798555e8803de6fdbae30f340de590663bb25c9dd755600765 = "EP9S0DU4eTZmOBswZ1M3cLI/Aww2/DlLbUpggUSeyc53ooYJ+z0tHre4V0GmDBluH/8OEntWdQxJisiLC7CJbsFCPJpLXZ28gtZdRREcZLMYDOyEp8xq5J99N0pCrQGd0YRaijFCIq75IQ3qUTh5y+NS88j+p9oo0WklnqIaxOQkWEgS5AEnh6awiZ+dvtkXmnQaAlrYA9xRSPfe1A==";
const c9131b74678d7d7c613d9581c2eda7b4eaa0d372ccfb623c742f85c9d694ef81 = "EeZPC0EKifQc8g3rzlsOkXMbxRYw0vVyqFh0YkAIIzrWzat58KNQZPVMUddTM73puidJCkzerduHIL8FGF05MGigGb8au1cAlpPd2QbrvPaR7IVaknZYPAs+ri/CZn5k4jBvZLkm1D5DgVYDZv+qqjK2pz4OqeW7Bovvvgd+XmLSKvgo0YW4AnkAvqTF09z+/L9mqaDG+Jh60xY06A==";
const e43add8a875a9c2aada4248f135af34816395d21701f707a3b5e768327d1e706 = "TdttECeF+BI18fIBgLDK9JzxbOQivPRMyDDsWnyUCYdO2/V5l3313mXv/Ohs6CFsap9RuZh2FAI7mEnOgppsmKLf8mQi3koRq0TxjKkaqpog6ZON/efXXhpMg2xk9hFltaDI0q0/xzFSCJ5czFhUJ4zCuX84J2CxlIh1Bd6sr7UhhIVbAmNhDZu1Ds/kp6jqn/FSB5ZFhaUqF74ElA==";
const c4587c8ecc5518c3754d7fadc403d1121cc0b3c2e812f61dc0d5c0d4f156edd9 = "FLy1WHGucBdlxOsc15NrgnXhJxCnmYTbEkBKtXe2pA7NCkdC5A2+5GH7im5m0QBSq7XYOLjVjRdEd2k7kZ7Bq4SiZGx+ZWHS/lN95PlHvYGA+/mCONSzjP6KcCxNp+Jr3oCimFbLwkNg40nfLPXyYt1QHMFWPXk2VT8DizYRGLIyMZm5+GSnxzGH2/nEjIszEHKguPcCWK03ukKrmg==";
const a2f22bac7666dbae2378ec570d3290e3f068a2e6a73c3f32825425740ac74771 = "BuQ+unvnp96PjsDfn0XKA+/x6UM+bjT0HYMpC+8mJ0nwM65FqqsQbZNlsMp7XQsTHh8Iu7dCnYQhTEAmwlA6PwDsGffT4nXCBHwaftQjDzi5RBMLHVwU3snADywaO97gU+nSuqIZ54+Ci9mddQDj4yVDd2+2FN159y5WF0MrQPyBdpEX+uBnM4aFZ0azI0w3EcrwLEta8OL/y1X7hQ==";
const ce025dd3050b5340d96230f4ccc94afd50fafad6d02329e86fc5ca33bee28a42 = "HG1tXlivAdevptXLnpUFYFVI11GoECxTzIBRsj3HEUiK1KpOFxXJDMpI1Yo1p5ES/NIjDQlkK4Pb55S9TVUwA4MvLcE6Xze7Ks6t39OOYxDy71e6R0Dna4Ecayli06ytIOQL2MUyOIm1GagzLBTpqnB1FmS1e17txFxbUXcpAEgcLjnK8wZ5z/rHiC4j69O2jUulpoc4qgXPE0vEKw==";
const cb0618218dbd59cf1b90a2831193c8e3bf86ef3bc3bf4e1c6ef2f1bbcd6e4699 = "yRNgZZJunycsgs10G/WBua6pFS1JamYyjGG7hrJnDKksT1nB/nKxkSI8DECTD+KZmKY4GCN2eZN6u0XccMkbiq8NXEK/QpBYeZbVUzNXM7HECBmmSNIy3MQDi5W5RoL4f9jSvVxc39vaeenJLnKlD0/odkv+1299QJsPr2OryMfvv+sKeiUYDYe1f6+8Ku5ItO/1cgQK4SQ0fa+xbA==";
const dfd69b4329726a3f186c7fe6a04b32ac3e0f348a28569a44846a13756a09a717 = "haMX9J0VHRCyaTxm/LT+r1L8QfWBg+9cB0mEDKN91KCvV7ALEggO/TJpCVroqS7yGRSPwkRVlnNDsyKEM65XpqU1iIurNrp4VLyeQOKql9MZ5nr5qfGvTH4aGGS4iSx/qll6+JQBcvImTDr4mcEfDigF8iAKeDm9FIKM3RS9jTyFBecAsmnjD6iCkuHi30n7TQJmcV4vBeRb8MnJrw==";
const c27550d4325238dd6e17789e58f3019e5dc39bb1749226464d5655ae09e347a0 = "4llvQZYPCSPmMFV49ZBh+iSJE2XtfaILl9enfyaNhDoqiypH4NzKpvXWXaWsmjleQ3HjnAHZQbrsoFkUwqf6u5hRawCjKE1dgob+15f/vgtwBRpFxPvSRiGlHjcFOkVjB6vuh9zoV3J+rXgTTgx9eJXs4gdWvcEHSuYwXJB0ZJdi00aRX3AxCYoLw/GTl/GwrFUiGidcP6Uv96pBkw==";
const f366891e599c120fc6406cb9cb584e21ba61d9e629c681120c27c1f1733cf423 = "5aVQ1zH03MfkUNXEABKYGasuN75r97BGiHN8ao9EVeRkSXoV0/S3JakRpwIxN0Tz9Y6lyKNuLcjsG7WRlTFRJqqUrYys9AJHqPKDurnAozqWKuOE/zMWtKrUkcKfc5gwVnxzFEojkqq+GyY7P078LFdVq9nuoS1yuNuXGwIsRhjzJK42Zq3tGstjGR/dVBOu+VgNRcLPxMy2QVPjFw==";
const fd7dc8ccc1dd5a5c278572f9ef20db7b93a517cceaba7ff1c6d4ac58e1bdf29e = "qD/sxZ/5s1uYXxaIrlL6II6Q24/GfoxfbBvBO6zY2YFe/y/vVYwZUps++y6Do+8hHciCA5FYz5HTjmKj44VyM9zTUzorlXSH5rhrr9R5r3Oo3Mwt8/lfuGOt3op2bmqMAW3la6L2ofVWPSlXG7td0gGRPI3OdiLMUYQeGqudmrh1xvcitYFvI9TlQrRL6MdG6DAg5Hhg5zgymJnuMg==";
const d24c60a6a98e9b193091412bc0646b75722bfc69b1b24f1fafc9afc1e9d65b6c = "37dSCZLMFJRmR7KuwNtJWsYAcxdU6Kjy7hyMNecWOLv1LbjJSRC2hj1dPeubHzwkS1cQmRo4iltWZqrrf2miU34X1PkDypQD0ozKYcEg715ay5DNIMCcsmdMHGvgz0EEuq01Y+bI8oWqqbPrFeRwktjl8bNV+vCaINM3CbCNcrh8XHxxDuXj1AOdH8qUW8zw4QcfTQQDtuR5d/iCBg==";
const dc044cd99af11b35421d47d06b0345c0292233b03b1d9dcc1d7202bbadf2ae40 = "AObpq9nA+lcbZ0UmgI7u4BV4fLYtLx3tO029FX5d3TwtCYFs93Zi2HVtoyhpkUSca1cs4yyVjAif+lNXEsHSaEH9Mprdwavj4R9rQApFKH3ViTFOzHrTjT84aHFAGQrcxWlGcDZKg43gxQtV9uYdS6mRgjuJ+ptLw4liWLScxPsS9GCBNqY6mEqi1s1EI6ipGvCmVZAq+VPWjhk6qw==";
const c3b4e5caac4de1f4fe6601aa59d98162194a6bc0edc23553fd536606248c4a7d = "QcAZMg+WhKMgW8rnBYOvnBWgpXJnBITcfjn6cgicvvwzqtgEPTn0S+hQ4+RfX6i8CNfMlj4G4JL1i7VlRUlXQGfxKBd4TGZ//03gUcmSn9RuEVCUP5WiQIs0q/ktUjYo/pt9/rxpaTVpIXCQKwV3eR1o2HMFERSFjPFlZmwRcdB15ZvZS4w8dScncoaREgRbIBy3ng/KG6n9crZP1A==";
const f229102aa89a40635d7abb15708e5e07b9b2f26ce1eb35ecad442558c6471de5 = "FncKtfG0rqeooud4V/xBzYcfSErpmZTcVvORF5Uns94erNBI+IkzC5FmeCv/lrYPXx3MbtN5NLRdXkOGJwQTjdWGxR5cF2/TpMusQgeh/DuB6B4/jDIohhQrvCJzmYk6jsINiuNCjkO9rzzLt0hvjuCmtFyUUQjSnYcf1T9dGH7eQug9lKizCJUKrUK6owtQfzsUgVgmixO3Zz/Obg==";
const fc6cd76f5e85cab1c97ff88d4395b0fc583c830e59d740bcbc6d43a1537067ce = "ZgIjTYEb6n2RMvceJrTt1YqNIPpm6twGDFcbRCoY/ZMKW9swfS8qpHcDLFLq0qLwfI9Rkd71hDoTVvUE71IU+6Xrz0025MHomRPULr9xXpqEGU/SK2gvynGffpwn/83ECE+FC6LvIUjZvEf/N6UbU4zEw2XOz3XNM5SZxqZI5gI3fbMDqX5d8bdsEcNTyYGWPoZ3Gz2tUhl/HuIJOw==";
const a48fa88fd9349107a26819dd543ed40199ddcc41b8835e9499da9c5a97822449 = "qBt/HQ8Hu9rN11zSeJFx5lp/vmIiQbjPEpanizKX7pj7dBFuu0UyfCh340ZgvHrBP1vwUawm+pb8ek+GNoinZqC8Aa/4oRaAWQLzFPZ6OXLV+GK7oVA01BofEzlUBhR/Wh9B0laEMxf18ZC/e1N0RPt333PBpeKiRXkKt/Z/VBu1fr9AtdQJ/kkQu5KszNJjxFaP/vPGIrn0iwJnww==";
const bd0f8266243da8790dbc15831d95fdd45cd6e7e0c2ac7d3290c610d0ae34ec63 = "Cbrfir8BGVguFfpFhnD6l+Vly5eWNx0rGp3DrQMYaKtoCiTQYdEF4LFzHVqS/Wdmbqz8mFfi+dXKOEha1whD/376JBmKgRU97Bo4TGruoSwB7eKzCFXx+d043YNQnVuJRlsHJyZuMMtvM4QmPgyf42waR2atAxsKAkb/VnxDxtNn0xH+gKICeOF9nMPHiL8AoKMmwEBAKcwO5UxCLQ==";
const a0ca10c109d1ed951f5e4597e20d5fefeef9a687686219d09a499f2f6c2a8cac = "cB/TaZUTBoA5sTVV5gmMzeBqU+og18zji3xyHdLxbFY+fLn4qMXL07T6Ac5hwneEYowFM2bXoz2Z+G0p1BRecUmQoSB3Dfx8wgWbidutKk06d57yesMFgtd1RnxNgTo84c7qbuCEH/96vy+i5LfiwJKNCMgWT2IICxPgpegsZIsiKTjzd59404Cg6o6WB4+Xe+fPvcOK+suePMITow==";
const ff39ba334d0866cc3ebc7715adfa7a1b70e5a95f94737c93e77f0dce9586c6ee = "kHAqHnDfGNERNEa6f/biP9QsP+5pUw+I62RFyxIHmMINihlIbeZYZwcjxz6QT8ugGb8u4Hxji0OByLXOdCPR1WjDNfSZVUbRwxQBlkKAZgBip/8av9hwvQRWJ88Ds4mLP+zDTkDVPZD8MP0vOZ4Rz+otLbyAmZ0x6YeaCDwiag8G6HNUy4IE0bmAhdZ2Nf10qa+NhRoc+F1xQGYVlQ==";
const b1c32652048f6948b48e3015fe766c21fc3bdfc06b19e3b63d1f01693ca961f7 = "KYUhYEGREj5FdmAK2OUV+MxBYXxqrjCRX3fIGluYRf+mBzIhO5cnLlGaURIJAmrB82fHR5NOeVZ/I/n9M6umRgLqM/QxSM04gwXUbK4FoCjY256UeV4loEF26E56VYacOnXJ+WiZmxmXy6W67a0QaTzuKKMoLR2wS08NNThfzPCYzqTyxvJSfNbK9vvR0TfZgtCxXnj9Ou/sbNt/Ng==";
const bc70a7b7c01ff23041b48678c88dc659ea74d45fdcd87000a4345e4d12f361ab = "BLptPqlsztxS6iXzKeexMQmWUBUH/AT5wL2GuR0+xxnGEX2edFlFJn/ahNoXMl2Lf3A+sl81wDGNSZiuSs5Ok60wGtAtcj0Ioag25Oeu4jAOVVm8/vRm7XIK/pnmu7oex7Z1SN10lpAV9vAvTpkSuCDpaUFxcBxqAP6VGip2C8Vr0ql6kvIxMoWvB/NfuI1fM9DKSEg6MCIy3P/68A==";
const ba9bb3ac859f3439d1d45ed1b6fda1aa912a726d08b4a7ef5f8f7289cadc4ad5 = "w8a5+3vXAK/JWwIkEPFCmBkavxstRga4UruwimFwzGIEdHHka1pqjj27OEgynotRoayePguWY/pUHL9XKCPJ/27k8Rc6ATHrY+zzx3shDukNrXuYEzYEd+2rIwoiGNdrtFiHMDxvcRqFX1sGXR1kptZjlZdPkIdKRw+t/6kSVhyiN++7OAaj6InkdnC/U6dWk6eCTSUmRWMeIjBvMg==";
const f161a9b5c5d9e308b57d1fc31514de4e3219f76f0f35bc66f0623c668f3ed711 = "vTbN4RdHO7ykxWYu1ac3u6ti+kNChhl8cr0Sv7yk86uyrLSyLqfsYULHQj+UcxI7ns1qOwRZbfSnqRZV7w57M3EodRmbV9yOQeoVv0+Z74PsLTjeT646zpqEQPzevcvRg7RAZxoR8JzOSDilcJ+XTVm3AYqZ9k2k0I5ZK3m/LoUKjGSSslyiRnAfA34DxbE5XPWl0AwoCbhOsBsOmw==";
const baaddc8cb394f594f4f6f2b67d5baf6a821c189e5dd9e26f7fd3cd6d7f23f3d8 = "55Odg0JQv/iwn/Q1daDnVA396R6gmPGWFO2d2btfGL/xQow6KsGHvf58cPH9k7UuE9TAH4j520cDlmWgqOBxqmcZpmXXrNpO9I8AoBZit5FITGPN0VQLF4fygBLtw7MPh7jM8odiZPztdMwEFbpcPedUlJgmIsPg8QBjUXC8xxNVZ8Q3ldUZCaovu4AootjVBAqaLc3rZNGvUdTvxA==";
const ad9ec0dff8ad3e3e19d3da43ddc51173b557da627db4aea41faaba3004d5ae71 = "CzO4YwTUYErNyfsBE8Q0qIRpGjMG4ymobZdkqUNq69kqfV4jU2eTHB5v6t7dIfxK2YQgUfHMQ9L9wg4LUdjflZxwdVY+TVn/co2jriNtpoHMFq3H3MU6nMj1hvuCsalhSGP1/vu8L4/vjYF/Tt/RmQfCG8aHXO3WBd5nR1IU0EfzJSI6pSixbKTVErgSruuihYte5iWZp9thmiik3w==";
const ac16bc1378ee5f43ff2788175c65045581dd31a2abfe191f9af4fe30e27c51fb = "7OBIH8HmwMXtUZZ1RZGkpn6g0MNKQUdzwRWKx6yNxMhvHs5ebnHt4VAw3wWGmr9ecyVrT6f2kNx22XTzTkp9PKBpLpU+vUwuFsTJ7kMZfLzq2y6CVEysK/ie6eNlWpFF6V9s/VLJr5M9JltJ9I00OgkHKskJfcykRqD9mZXJAMXLVX0KnDp4qezW7GiJO1uGx1BsBohCE3EbFUXmIw==";
const eb776ed627880fced91c35f739454a6002651eaee2e5de73a599e1211d498983 = "YlFIbI9H1G9y5uRkn2dMeQsEfJxgVPD348VFYk96/O+OmhJUkXeorx5pd+RGebv11owEWBa6D4VAj+rylm2M/HqJ1CPTWBIakxIF3Dupgqee/2jmsThitm/sWAzvgCi+9A0HQgDuaqGQ2i414eoWAwyn0wZP5SsRyJWUQQa9BJ7+hsX/7/6Nyf7IbEZhQtrtSWYF/5bJc1g0KXI2tg==";
const e3fdf7393fe75ab52f4b94f0a225c3de731e0327aa2cc851be43801afae01d86 = "mFGTCQmAiWG8OioVLYHizojGEbJtCAMtmavXr31w5l1YzNzjwS4mlTXQo8J/ru1+MrzXYsuOQIG6i4IE8ODge6x9dwkJrSzh2MxllY16en3SxNmkemHxGeCZ4fTjUSfgfpj46c3NMixlRBPysLkAopbihzar6qGZ3hTXpUEYSn5S+hAIdWfcjPpYdsCbzq48b8Ubtptwwzl0F3viLg==";
const d2efc5b89975b636e175f3fe1d36e53b126da5fd9c1ff022fd6650dc4fc439d4 = "s/2AbtpC8TOBB7O8BZvAeCfNuw2aY13eJio9PuAtnycpxE2MW0kgkiiDPiTz7XTqjinJRJvvjbPmHNlEfZmtKCwhdz9CLEwtex7IYszZhBzZVhob/an0WZl9xdwbyiH6/7LDe22arMqIxd76ljNrMUOJM4+4WEhfGYtXWi9je7Vacmc/4a5+UbUWIiWL7qcxBmOQF6Rg4Rp05QrmCQ==";
const fa43f2ad0f2eff6600897b9dc5963f2ae7836f798025f7b3add54bb66bf3aaea = "mykCgROW6BPrMjKKrUQkD7+T7gqqU3CJvXIIgXGm68LC6VkxNammV66UScjLzZLgOwcOPZfDGG5q/IqoJdJrWrQzBv46scxtUrlIFnXDJLlctC8pBLAa48r/g3APm3S6mVTRbckxBFOGD3z+7SS1NbCTOUIzSBgStOmOi3ZCBFWF6DZKAxQx7fjizKlnyv4xLa8f+ZQIsRqAzLRNoQ==";
const caa2b91078ea6678847e631117e97835e4af0c7d9c33af5ba3bbb10259d7a141 = "SjZ7ppRVL5v+uDXKJjWzxsvBidQQQwPf+qIr/MkgKz3WEVlFryt3eVrtI74lvUJNg8eXrySO2g0/6pU9VzOX3MuShZm4+1lDfzfUNLjDsFMpkghFMvj9ZU+mvSVLT+CgIhC/2O+4/8ivRUGtnsuLojh0jSgTOWDcrXpK8SAIjcoJJT9dhhY8RfCW+d60FbipEHuDz/8rq3H63Nj3XQ==";
const f67add387d28f1c09f8280e226872ed244558bd025a0afe6c26c0b2ae7e4e359 = "zoL1szca7+reIryUPal0akElhiMOAyH7I/Fq4S8mz80RJXEdyL78myGi7g21ybkyRsm1qUY5nzb2wPcpAUSiRF1gg6d9VDEddYF79AqCdorvTUiPAOTeuh/4NRdo6ATw+R8phh5ypKwJrNPIe9X+ATI4uSSVpdA2lcBz++g3UsL4t0LDtfCqdf34xUAWg5i4kqIN7kv+mM/5e3nf+Q==";
const fc75beaf4c23014a7efe5bae58ba042b334622047d0d41eb81e4290cf77b55a5 = "KbuP2p3NfYqHpfIMb5MeC09Olls2QMRRU+6g1IRY5yvRF5+gs7QZIBdAr17rkWy6VYioDLLGnIvOiA7kFnB1deLW81TZbKdvhH/9RtM+oWQEsCBa0IUJM1B6acrgMMot0ri/6eVL8jpu+EOss+Tu1bs7kIrOGfgfX4yFxRCYCdfscB6kfANGHvxUiCddA8hX3hmLowyHg/RQqqgD3A==";
const dea49eb17fef14a8edf41d73905fa44230b1f1ce405d16bd9f36511ec57c11ce = "8wtU0U7jUpiaDc0Spl1G91d0mlm59Wd5ZkofXjkrKUKl7klQ9WCfOBDz3zOY/rEIqgEedQHOCuz6mqgkxbz3rA3FisJ746kRytYKsMw4O5xdSw6yGPTnGNKSTB68N90cWDXNVTpceU+w9dXoXTdjDI+2eJERUEXqOJIwc1Wk6RZTe4DRPG/iss8Nn/iyQ9fkWMEQHOSPT3mnB/KnZg==";
const bf14e4d02573f4f4f977788cee6cfdeada40b61f5e9ecb4968a9148c8bc74e62 = "RRz5mnXrRyk0/eyz1Hcz6wOJKbxi8OE98h+cmJXQfd5u20KOGLfXBtWIfntBJ4zFU+J707AYjXZ3tv+hr2/kUHgb9vsXXiiNZ1MVAnTk7WzhDNcl79nLbazaXqzFO/v0DM3WWjyvRKau08copmzuaGoAP0AFiVjcTM+ggHcmUx+f07otD8vgIgDLIYm0T1ulPYJdE7MGqI+ne7E6rA==";
const c4955bb59cd657492302acaf3f00e268438806ac56f8bee833f21eaca7dde54d = "oHPfPwZLSiF34FNNTAjuchBoQF8U63HgNxA3fyh5C3sssymNMuOEegV0Dg9EiZcCFgN6H3a1l61G+xh8/ohIE8zTmlzJtlNCDPw1taEdpZUmQMXRuEauc2gi+ZJngdpBVinYG923ndui0K4vI3TxVFL/akeq0lWeH1cmiizOrP4jiOT+d5CEDT7Emi6LmShNNugw6MWj8vXHaNhjrg==";
const eb67047cc753adf57d7872eb214c464f639df66b4da981e01f4dcf978aac056d = "xtyNR0wBCRdXgFFJe4de6DLmXRiRuYQdoN7hcyUJvd9vSTe1XcQlP1a3gIDFpJuWLR6+gPLwgZoxOjH8w5HEzWrSm20AVFEQHBmiXwu6VGkJpKqPZv9XA5ff0Vf9NQrTVjlFSQTu/2cZykOVtHgt4SLppJ03P2u5+LNu27rbXhIo056hCXVsdwipSjQc6Z+5gE6+dZN0YXFs5t3dfw==";
const c4a3dd7b9aeb7a8ecff2c69788b454f859148ae246a31ea581560f931d72b06d = "69ir/Oq7ZM/V0yPJmzArqR2D/d/suuYqwNiX/SMUyzUpnHrU3DaMUrPAZ6JBIrUmI9kP++78IZf7WVvaFaXSPRNGzNocnAL7LW3lB/PFIRypzhZv1f6DX2OaqdZUYWxoeSYotNeU/Yrpbn8SVdjbxiDkADtpoKji+efo6s2t2VCZgYkuc4SplVzARg4oWNXpC5vZntVEl1w9B4RNTQ==";
const bd1e4ac2b5b47495aca61ed3441c859d820d12a5f89722803cb36ecd9752a5a3 = "hykas0CGKW+4fxjgEf3Km84AKa+SXJxwBVfRAtEi+/RBzOCbR9tb11/JP4vBUn6L5KBP/vFKDZFs6dWKW6+awGJ79gBCTq/2IcTdil3Ks06URPqPhJ1NZgIOa1lFRVWqnigwbwQKnBGXE1lL55qMYc7YT5K0QdRKZ4KG1a/Jk4yX/MbMZcsPICwyT9fJiAa9QVtw27kswrnCb6VcUA==";
const d3b46f85bc6a0da6b7b537e2a372963305267703a9b48a41debf260ac10b3d9a = "fvjOakKk5DX4jbJTd7ZNhfQK+9FWC0rNjZ+GVVJFnOb+4voMJ1FzcJILmGISR4TcOFDseLUBxf5R91yFrpFIh5hkO2nh/uIl8tpshzSLj8l2g7MVlU0DC4xr2P+3E0MqqO1MBYkaPK1+cZboaEduRxygKBaBd8DR2Fqe6e0Mg9YKtD5rx0610iJrXzqEcE25ZQFcD0sP8QZdxIBKCg==";
const e8ca1a46c85a6104ed05eaccca187cc9cf6e699c60980c274b1073f824a9cce1 = "QiiNHKnuWzqegMfRTr2hidQyS2h80vj0eSnPpUd60musU8Qe9uzSVOjbdf3Ir43z4jieq6kB6EoP7qrDukpWRwh0uT3qDI5A6P2UDBdGnlMCVS2HWudNpbF+lotbKXGLKnomG+k4/i4Y84EW1OWVUrMGYp1ZUcdY9SO6hHTSa9Ew+yY6gDBAnVXnKUUwmIgfmo1WVc4jBxuzouqxqA==";
const cf31027c90f2648f7e3130969edaaf5822f4869837c57d10b2937a02e3ae0517 = "x8txmU55Kn6cxNvMx2QAXxutdkzz+QDyFJ/ZCn0trusGMA6EAbtmp8C+7o7p3fsf+lbsA/ADb0JpcpwZFVmkq35BJjRUJwwICB9di7azAuaSESm8zCZiZ7jKVCABlulZhL3RQr3IvHvuOJXi2nyrepllUGwVJJg4d0u3kV4VI+3fEKIqfbEelB0HAIRqXvzhkEuvKGI4BvRoxEJ8ZQ==";
const a31d4f8d91cda84a417db18dd6ce238c2aa0e7773a4583d81f3dff5f2af58116 = "Qcn2Wo2Nd9l1gJr5mreO2/4CSKBU/mgso9V8LJFXMS2kT7gFTJFZy5Dl0RQT6eOJTd6/O3ql1z59XM8YzaZmQEHuSY8WraAw64NwCdkR9eQjEwxlhwqfyzrvdgL61m/cHMWo/o+0jrNIXJ5tPqHgehysROwsC0f1WIYrGTXkjoWpSSEH5pn4DuBIGNUj61Fs7JczCvausY6Tzt8dzg==";
const d2941b9755b41ba6c9699badf96d6b934a06d9a910eaad335c9565ec20eab8e3 = "SMQjiVJTkFxHCiYMa23MsG+AWYd6QJ++lI/VevDuZCB2dO1VxCoyUrxfzA3RKSJWVsKmfMpAOSYFOiN7OnuTkyRjiU3Q8SBIPBY2PGzFQko1pPftFhQB+3Jtef+so1EiMXn/51l74YYsVOQMchk2NedsBeOkYm9HF4ztthJl0Ot3W6JoUYaHVHi0cV1W7b+aWxGFveXCF3BCCaBimg==";
const e0e5db0aed9f1254a4b935af84e8b9bef6d196010f831c93ad63a80a2ab5da49 = "OsvcMjBB9Z4AvjChi3waY9071GJ26ZO3eOADAedqDSjDuC2ngw7KsyHmZK62826DlJrb6kQoEvGfJoTICurxUz7WAhCqsWekYMOAzKOh6vNTeAmQtLs4s2WB4sKbkHwu+w1gmFzDaQR8CGaxkD51ZdgvuwO511Zlw4OK3UG4eO5VqRqNWdwJ+xaLV2JnkiralaCtLC4Z9Bonz0RmOQ==";
const a184bb60482bcbb54a72f9d68c99820b13716ba3887cb016a99fa36fb8f83065 = "IHYieI1xSWRc8f/3xfz26kAUHUmJHERhup2o/RBJGdQ48fWojHgJaqSknhlqecH9aBoR56ECy/5Pof3twzl8hFl3XuCh6/f0WwHRYEZVr3cF1qhE/wn2/8DbT4HlBeqjKTwCPagE/EXKapfjMDDJKERViqb/rih2XqUq32MZ8O1DWenxhWRHe3fMdoTxdyqHYL38CGz3YOExrKopsA==";
const a3cfc43832aa33e065e78e5e597dac1241b3c8f4d498245fb2ad25ae831abe80 = "5ERDsMEBxf1mh+h2W8JA3WsViVs2hIUFVQoLnEzsm2FA7vHqwyGtmslQmSMfepUBPke8kQXugizaLgNbETew+vD7I5PUVE3AariL9S5cK3WwRF/F8IHzDddjf0iXw0KMcYsSBWLUPYlIcOl/CmA0f7I92Ex1AxTjcnHoh8DkojoGl6tCidexphDonCK7mCWoP7iAdwxw+3tpxA4tJw==";
const ca40509dabf87cfd2b740aabac85164f70e7788ee38bc2ff006a793f83008250 = "DyRrG7vz1jFBrP7jUuxVSLDY8uNuirSAKoljp5CQILdB1Ok70kiayK4fCB5dLQm1YEx2rJCqpe2ItSxBu/OUwuz1RNNONTKCzp2bny8mr8ILccnaQKwbERQvU+8XgLl2nLeKzj/wePO7/cuWamalMyjPtV5PBg/x2uncBlT0s13gqHQRrtcSCZDgVlGl8GObbmX5+2QgANAKlcmKdw==";
const ace010936538b35955be78e258b089a8a556578d15c982c02b842e765022d282 = "S7JnZy2gphWRuRxDWWPBR6hvOMJsg9tjJi+Sx7uWSRC2QI1/cB90GiQObZYQASX8BkPuj/5bjlRzEbFe3m1Q9w3ss+3Gc3dgYAU0ZZ5jn7TjGKmObGKB8UlENp2FUaj154FguNF7WKyrwXwlbKMzynoYvkUVlrIMSvGFAkvuoAgsXthGs3N3gaRGpiufLRGSn1l4DViWFCk4Mq3hkg==";
const fbb757cf0f3cb69d533f12a269d0679fd819c24ff3914173b88201917e82cc6e = "TS2kDpMeQ6UjQYZXDN8Cfqh5Qe7l7E7xiaCj3AJKvXkjsYd7LT9M/cyKsDy5s2hG5HH1rK0BaOzqXjgqHrSfUiJQhRT5GJeeMEXwTUhVUQ/xugtWUwi4U6keMqYGufec79vlY1DpcryeGc/mUaR84flfaSTK3OLnDj+4BnFBOEzZBBML9Cifikmz5heE8pXbRxG+YX9/vgw1K6C4zw==";
const a075bd338aeaeac13b3de430bc33c8f91eef49fd33d627ed9fb4b92f32d8a28f = "HqtKv996PRgXU9eN1qy2QaF4bTiqCxhNZMqM8elASMCHCOBOOxVb9HLsKnVpVwCZwWY/9/4lIp7FAnGEwYq3k0dE/zsXWyPlsYHWnXrfXpGfSMCd8017h0Px9emIs6Esa6Wy2HqgQ/A+FR7h1X55LxRlW0gl5+o4zh6Mu8WhZNOt4epOF6Tyy/xCA0u+fVDrCNueViliUfpfdvQ5Lw==";
const e1ba421f46b905ba1ca9fbfdf1950d0b4fb63e72116d458518fc1ebc1b5387c0 = "dl7R294Zqbf6YMBLAvBwuCJfejtJQvnbt1wQRjF3aRIH1j1o6ZuuN+uaO73UBQvrWpZO04Djja/r7jn7QCLNxxeXKT0sXUnZ5zFkyYSywFMxm48DUlRCKPRUP620QrTKzkqsLdCK7vehdg8MnAtICqslwpubrjh6gZ5ODs3SpTyHAv55X9GVGV0SNIJ4T7bto2YOmWH81eyKd95hdw==";
const af8376de5df3288309343121a616d4358c8baadc61c0e1d2ffa83565cd601f68 = "Es/T5RlJWwjlIyVf/my7NjvDoX8q8OCo5Cqc/DzWElH/Ew1J3NZ84ZjABEdBprtueZt9iJn68jzel3qO2O6GmNjZDW+/f5ahnlo0cSm8AWV6d7vSUtgDFJXTZO0T4rS3bwsFXyO3N5QWhsIkXZQFIe7V6DGAr4LgodYFvbye3OLSz/wSbJnZk2+5K2c6HftVaFlAxzBYv+doEzZmxA==";
const a778fcca5a89e873397f7d9ed6ce79a631da78fd7e7e8c8e90957017f39850f5 = "X6SUfcssyH0pEf4FsU/HrC0UA3yZJgd5aS9XNyRxmk3WA8rSYy3A38yeQzTTXCyB7WnU2k6718UkuUVK05vgmpaPRf5jdoaR6ynbXz3F+3syjcekzIgLx17/WUvoQyDU5MDRTDB+c6WUemdJr4UvK+6JvUCfwdFPd8jStHdbgVRMZHjKmC8sLiTUfoL7cb/TxdL7YO84jG8SbPn5xw==";
const bd50d27d5922a52d4e8adcbe94278b7c99bc9aac115b21e28286dc37a8d00eaf = "mahAxlL+6cEGggVa50O4OAPIW49YMebzWiwcls28woW8Q6UYKOnFD7VOYB3kqLwTiGQ8cS4g+XsPW/qxApenWUDTGB06Bqm5PKvHasG7qcfj8Qc1OQLsu7Aog7ufDxjTy04kO78KPRZWuS0ficNjzU8ZdihUMWFYfLU6rpkXcuOXdVaswi/+z9Jm0t/6TmtPMuZ9w/kcMokv1GFAZg==";
const cf6cc164117306a525d5c90a155403870ea460e2ec7a55f0ed8ddedb8d039e4f = "6hz1kRn151XdCktz8QoXTZlpWCzZwkq+88m67wSVRABDa2yDndNuWEIx5JHJKMa1+pOZ4Vd/Mq1X9+V+wjSxgXkcb7QJSIvNaiKsYzSvu3kbpej2ZRK6sBXRXKke6Z5UC05CD91LQKSGQQoB/re4ghgtFGACUu7BwfK6WWlGyhx0U63qlPNRnFGo/1vYwVKlIcvvy5QU//43L9CcCQ==";
const cdd0b27807ce708f322922832749edf12dec26b5a7a3a1b59167926f64b93964 = "SSOSZnGcGwbEDAqosblyVniwTpgBzsEiRsE7ReqrdfJ7ka2+JUqBbcVHtUCraInRNEIfB7KomYdPvaJruBNJscNgdZwDuJAe1lsuc9R4IN28VfknPa6olCFML3Bx2EIHSdxY9lX+m7vPx8KuKmMNGSAtRAHErjpKfnF0V8KzgUDeqzHNoWrOMpXBsVj3aMnCrqtVETse2abcYSz/6Q==";
const ef21ae594095ae6f814f0dd9c7208826fa338816e540c113f8bc58dfca74548f = "Zlwh1n/fXxtLH1pA6JvFNmKyNsmlZFDr4jQJLQjif3urfBCptrjM3CxfZ4YKXn9kB3Ck6GrEmu2D6UqatsYjdPZIzZyIZTXmig18axAB1m1ckoY2MG+73L+Fu1RdcXYxf7sTzJQCufPLQ+it0dU1pj+my0j1svnlvs0yf1BfVYzQ4qdC72F+7pKIin4Oo5hHYxLLQ+DyrcQVfnkE4A==";
const e85614e9d0dc72dfd85ffc5127e24aafc4aa8e1f2175a6b9e6a27457d24e493e = "djXTBvMxG6Om859fSDiwnrRsIkKkKK5qoxE3IMRaFY53r2MqIVxNyG3EpHEIsL3yD5YPK5EXLzYAgoCoF7QOZ5Er6rIQTAJEabpZAeZAJ9Q84+G/QnDZZ2DWrwudEgpitdVni+D43XFveN91SxXX5HFjle7mKxax22OYDriGzkeo2MKf+yMOEsBzwlJu0oPZ5btw7vMpyRo+S13reg==";
const e585e4539980f4a3106ea061501368376a06d10dcf5e298946ca55c1455a9a47 = "ArOqCeTrcyx02X9A62A/eQGdARmqB+k8BnUuRdsdYluuINClPQdza3C2kAZvjZTD8izFMo0uWQWmtaiVQwm5RQ8fzZrRGvNyXeuM59RzlJ3eISCaWj1MCnV9ddG+fJ8CvrzV89GEBM5rkWW6NOcTYiWi5U/0y0Rs7nh8xNCva7drN9R7XOduTLEhroHtWPWTu+0TUYIUHmJGwD69PA==";
const e27cca000b081cbba52b63f3a0f3a30b2b86e15de3cd516ceb3f357eae984658 = "AN9dEyimi9Qj3idktOJ73Tb6HmpfL1USGDjrWu5xc9qWIDqBChu9qHXnQs+wnHjVG1UB99R/trHl6YUmKr/B/Hu/uo4+oaTwCin3aukkC8XEvifPrGazhcmLUEO5QBWS6+88RNO3hmhmGxD4TPqRvydYrD5I1J6o4u4RdkLaQsiZ3KZSHlVcXPytyMbs/18OWvouyyoDux6sNgsZng==";
const faa122ba026ea7c5bcea8c3007b345c83f3fd5a5014d0cd81716d99f4e785c42 = "+g54utllD2p9pZVBTnECZJWqeJsCU5XaXKMneBCeQItTN9kZj8/0p4qIfKMgyawDKsj1wAKgZxr6BkuHzmuPoYg5O0GoMru/fr3flbGeV/fXREIaYuH9ZK4SYIvxsX034cAbq2aRB/WxI8l+OZ9YyuQk8uaSwJLpBwUpyU5T3HOQ+3orV/SWWuk56ESlaYv6vxh2PyDlQ0MG/wIl3A==";
const a575430ac958d7fdb791c266d8022a3930d92c0d11e5b7759f98e154a219d784 = "vl6/K9A2bxucu5cYSCcNW2d8l6aOWm2X9J6G1LlA+1ITc+dok6pM2A0sFKRgjwJZ4IFebgS7iAf2KCqfPL/erx7AQm1MJcopRXdbQpTT0OmUP0Ta8PiVg6fsmAZSv5uuHdqThTneWIOhjOa0K6B20VZTGfahGq8scFigWqKW9Gz+k7DjZqO9ScS9Zh2+8CcVX4xvgbR2WGfKA1y64w==";
const d5e23185ae8b5516c7583e03d93492653507e2d3d720b79ebadf8906bcddc0e8 = "mtD5tGtOpaQmzlIm4NTO9weIHJWWe7AmudP13cVz5R2wyFfogVl2KuuKU+I/BUNDDawbyW6XU0eYqmKMNr7Wa/oDLD0rbkDogeEKVX4JOjepaNvJ3txXXHr6UWdDdvqic8OSwo+qQp0oZD6OSCw8Wfd3jMySxSFO0D5q4U1/P0oPJsMYdaN3Xwqq4473AqHlucvyCt6wa6NXIECfyw==";
const a5da8f4219efc9090ad3c0cb9e18e72b32bcdbf51c8ab320f5bd8f024e64fad2 = "GrGzHfQh+pw6sy+WJl0iIUl2wvsFpPnUJG4plg1FCbC4rDr6f3MxIkdMtDjId8OAycIVJVFGNtAAhbtBkV9wzjkStzGjRh3SritAdrAvu7t2P6GZrtV5gRJgNeGqunratpHDjK6pxESi6e5zz091grp3DA2/lHJlIsYSHldjHsXGvicVHLJy/ooSz3gye25ec+0r8MQAAe56eQSGKw==";
const f211f0804487f274b9d33155463d701e470f52a3b1af84496186b865cffc3290 = "V4hN65XbzetDS4SOck6+NKDSkbEopRaRhN9OZ11mxucoV6F2CvFpZNkEwi6yKaci29xNW2ONg1BAJnyLwrwMRA57Ip/zLcFFH32fRzGls3B42kxE6XlmQphHA6IIyI89pHQLUxhFk72dKEi92i03/CxukR+4pV6s1Hfern4qbdZdyu59ugaq+UvhqjzW4HwaoIsJF5NDqQp+yfyoEg==";
const de8d8cda4a5872a7fc943cb163caab69fc1212b84fe1788df39676d24d03fb90 = "Uqz6I+9a2KI3q0BAaIPp4mSONJlel4uzbPgx/jEF+zSW+GA9TdQKglq4YbiTiHekO9J0VmFJZbZbturPP7m+6Hcbv3QqR5SKcmOM7J3zYPESRcKqyORkF45KiJ3yNDZelg0HRQkNOVUCm7tNpyrAJP9YiCAqWd4v7gzILOm4vVQpre7wNbsEaTAbZPZdsNiKDg66pzRxR8asIXg9TA==";
const f23840b53f882471e775e408de2062f6846af25a5922f22ff45b68ab873f0b17 = "PTJUvqJyEKPpvbH69azbyXkh5cNnssLGBxTaJpklQqPh8DRCkbYkx2ZHjDCg6/Xvm32q0UNZsjPi6geWGbEbY5vSl4WFlt1TtRxn3XHIgGuB20Y4DQBWhiOOfOHOSLlAkeuMTmuryC2b+3/geE6UwZHHRU/qSO0nzindBjYl0sTGEInlPUlWH/IcaKjCaElc5ErL0j8i6m64+Nv0Lw==";
const cde200e5e909557a626f3437dec12c4c5d4c6364f5d6bf41981dfa9d61d6f0c7 = "/ahuNMMmcnY3oHxgrL0kr2OPLCL5VL+5H+hMOtr4Oj/0aAJvN6AtAnKXjEWnFJtF+vyLzpnAVy4kX7oLD4QX32WFJiKR07xIsttjjf6/1X782QQ0YTa5mAdX86tNSIYK7vt/Fl37NJ8/v2NFqzlJz1sR7iJ8gKHr8jUClfTiN+j4/cIaG7Va/wXazjKRdV+8lRKV90kI+B8L9ulWuA==";
const a9a3dcb0ea855910e39259eb96c7a0dac5902f7d5445f4b4a613f7a265dd9a46 = "wc7YP+13eH5QL0yg4bVfhR8RAGmI4G4qGQk0BRbCXiD11e+Cye6tA7mfondGx+8drNp8jTvC4rKypaFa9W3Nd6EXBMTr3O7GL9dsM8ZlrHDg62no31BQ4dzgDgJ9xY3nrfte8ylDAZF4PWgPYvkCOKS23Ti1Nqnyx0pJgeFakieAhiDhBcLjDs5YKLDuZw9HAe9Dd2lDGPrSwSUE1w==";
const d7553d2dd2cb090ddc964eff28d741946416b83d2798390433ff8f60094a263e = "mh3x8izvaS+0tdrb0nYG1RU+AMNWaUXyLwgh+repX4wmRPxFUTefMFAJSYwQHZPLhwvCtBzQURLjyPoyvcaxpXbHg616VjnDdcjOX5SpVoY2otqYDOoSch8RmsqUHd9J9aXn8Oc0N0QfYLWsgSNalU+IoIE6wmewQgmhgAUZ1qJjzTEoz+jr1+e1lr/7YGGAIQC5Oft32tR9IwbwgA==";
const b9b4887d7c42b380674097ed8008508d5b3da36bd4418c4b1b139d30da07696c = "rHjJBjHtMffHhEKLCNjE6mI6zw+6Wc+bgQPvkXXSXmHMSuwjlKA+KHI7YkfAOQ+TvUZngjU6AJdsh5p9ZteaZThaogM3zeGZ29stX3uT15YBLsnsi+qDdEjdqi4s+17ef0mBf1snN8FRUReHLsYoo+wf4rP4ZEs/SpQB2kOnpveRfCBZew8xRCD2hZDFUBCkjoPywidmpAVwDe5YRw==";
const a1a655113803b2ef0733fb45b0e7eb57520b6701fd9f7078aa1a7b702072993b = "bRKGsLky059MTC3As5TxGsSK3uO080TW1KJB0hHbb3/eEYgpXTpd344HCrqT4OZBXZ4qyO9F2d03C9i8YgEySHnxu+RoDZg/I0as5lShRI0QlLhPDaWWVnLY5ZuwibP99CJtiDIpZjHsvPFaK02hlqqPBhph9Urf87+5rWnEjU/llKAZv7IWZzJ5Ch/isTXKFDn82ew2RBED4VhdxA==";
const ac99ccf81ce48d86a573def1de331153345efdf8c307295960aa30648a01103b = "h71dIRvd3CVb5/gDNpVHBJAScY1HgQ9l6D3DvbpmESU4SJkP0VEoUDNqm/7DKfdUw4jIdx49JzTV7QjOpR5CwK5YazK+I+a7QU2joqriiBi4h7MkOvxnG73vfgF/RcJTz1F70ltcRG051PrhTj98QD3oqDxWyvi1M9qpfbCZsIYfXgZgqyFwLFKN6I3XZ+nUQZgLbCspAAG4Qdxd5g==";
const d57965bb6e562fd677ab692ce1f976678b22a46583172524aef4750f48f4570f = "YDLfFJ3aCRYrr76lfcruoJH8EXjZV6lazltR6qzOol/qSds8IL8be2H8x+A07MyZFthVf3HccUA6822pp6JkW6BckDZyBXywm114fmy8gTZJT3+sp1iXNLz1RUyB+QI4ZbOh//5Qc6qfBQc4LBwsH35dwrEW5gHQRHTQPDJV2Y0iwjkMr8y0NV/VPL9o6b7Z1CAjV/tCfHA7z4A2jQ==";
const fd56e7f6562d84a967591fd59d454a69be424426121292852f8888982fc42ebe = "HQoV10TuvnbzNFKDQI2ZuEtJ2X/gz1f4A6YO4lHGM8IsABUoXFtayrhhXFmwZCnBas9agOjJE0J08O/uOMzy8k5A3iKubGIOSeQd6fp7vxz+FuC0ilakZY7VDxcBNyb7veDTe99r9kquXvHUgsAwmiae+eOqKyjY9rutbFkyG2M+HCIPD0D+s54pLi8UaK5ND/+YgCCFTJxtF5KGvA==";
const c00887fd2c260c7225d4e38ef419a6a1ddc0e2d0ace5f9574cf7ffdb6444b323 = "F1sKofM+kw7c4Hx+9Tplrydtk2xp43wy0KFhP9JckIf3zLB68U7D5vt0mwM3j3/FpiaCm1nsNjn5OKTITUM1N3ipuEbqBi2cs4FqtdkVMDmR0Y9QOQliJ8xEJ9FmAGaY3r3guUWTX07gkv8uhtuLgSHzlfCN+55qGnlAXUKSpui8SK1fg9yi4cxQg3PMl+fEbosESWRgQbRPMHdbBw==";
const c1af76359e6bdce4dea21b719202d3357c4f93e6bcdb24ab6e8989164dbb4959 = "5rWAvX4L7ntjZExuXOvT8aEi+3mhbrh4bsCl8V352xItO8dktmLMkIkVkdPR3o3M0IJ4tXzpur/E/bOZENh1tai+nlXgRheLT2yeCiulFdUwTnl+tYaexKSDSqal4P/S3Fzlb+6gDzzAP9fwHp6cI91NQGmm3oH6FxW16AtKuipY1kXCzhGy/i/j0l5dxUzgNjZ7DspJ72vmAZHJPA==";
const c7c8b92eaf4d10ad47b81a6467106dcbb9daca1e874bbc536ade495ac4914131 = "sPYQmOLrIVw20SrQ8lv83OJsMNc8LYBeZNgJ0tcjUsT2xGmJlZxDJoA9Ih55gHpE0M2NTjm4RF6eFGwxyIOd83dLgr052HGz2tInCJhGNrqpnSVZuCc4v5zIveLzL5oe9nY7oP/btAqoCb4qKyOknUrRT0XINdYmmNwxk5awlUchYziq96q7KNZ5x0BP7hkWV1cVjB0n5Djz1jAD1Q==";
const c44ed88b10896284ca1c814d375db92ea7c4683c3f099cb712e9efb40051516b = "ZcigUFG1hEkZKNpZv/j62h2idpods5dM9CPnMFV91i19MbN7H4VUczw1keaLQh2Gc3HnQstClI++a3ewG/DFSk8mx3XHtZQwmViaPsPxVOmEkP8fcHRqpfzfm1Z+U4zBo1BK4q6sPbn/mRdaPuPhi9SrKY65mgoGUvp68sSo5lIVp3HnlBV1DW5hKe3D7jPDZW1nGjGxEqwHl0m5vw==";
const a831351769481aa854a127a3d3f0130da7d8e1f74030a7caaa60133acc5b1b67 = "XXFbHlm5P7+JHQTgRFuuuT3KvmMy5dUCfDDfiw2j4cFwxWPL27jUmevFe5alRn9aGYEiZ7L4rVoXZkPtSB4THR2W6+yPCcZYuOpTNOk6JNpUEWjW9i/8bb69p6ttmU71Tk+bpk7vlLIgrlUEY8vnqnWPa95TiMqRnaaJWRgPZsK0vAh/wCMkZ0SGlZ8niskXhSxgHqIdhkhTlyH27g==";
const d2d882b47b1a46b3226fe51f44e5b17d65bd4f8d04628886ff19249b9d198af4 = "atobDrFpwWeicc+6X0sqbW5hIEfGPoDuWXvKKCZEoF7xfE3uMgPVBScKp0CYR0oZIzeK7CEHxsAsKu68rPzT5x/KvgpgIf4jLRPPVbgdy/Li/Rt/Yu0IwvOCmFXFJry+eOin8wdVjg0llIg8OL++nMQH1wektAr1cWaC6jz9EKDrAXIpXrwd47qmCUGZ0Jwqx50gFAcP7GayKzKWJw==";
const add225b0531df988ec44547c37b6f6136a10b02fdbf53ede0bf1557acadc5d70 = "pYJddCI0pVSe8k2s+Pty75We+FmabTFqWljdWcXP8TxjDcmD8eBrLYncMiAmhpWaL+d1EvRfXkuduBTCZx3P01VxTuk8icwibuQi4NSSSiVs6LDQCFYCORnwRd7DjoB760X6TmZJAVNK3y/kTiBl7f9ZM5ZGF2pnDKzZqyblstNLLpp3hBJVBmm5ZfLxNNwhyK/YU3sFkuC0Mow+ew==";
const f332aab19e2ca16f7f9c48058003bd2bb0f510ce9df83b26a1c874f7991b53c1 = "aCQ59zaUapC0B5dmC6zpXzLQiZTmi42EJjVz3f0zG8SKji+l4wKb74AGM8IPvvljEpZHe3bcwpAc6D5BNFAt7Eks86fq7ShA+rENfm3z3XK3gpZ/z6oqPJGClj+VtPT8mp5eZ3QK6gMDAw+iZfw/cWQzlMG5xTPPnlD8KLitqPus69YTDOmd/5Y5RaCvlXB4z8xh4slYMtaHPv9FiQ==";
const c0111e5dd258d5f8a5a6c06580a0b6bcd424d64a82c2c3663674286696b93485 = "KjD4Le+91Pqx6aHcFUGPWHG9jO9EYuRmz8fE/s6hTiNSS9S0s7qhlHpqh98pQaFT6mKpyAvQcyXLXkLqGn/MMQozs+ErZXawQGkDl/8qhVWrLxGG6KtIQfA+EbI3m0wZs3iD1xSE+kgo15Yy2256tEKcY2+4oBwknHVt+8U1xfoz6rnXIU52Mx88NRCYfbekcFd65PO16eRaHoAkQg==";
const bca462345facdc6c56bc28d69e413fd3314ef831adacb17740f1e05243000875 = "/rDCpT10dQDtFQ5LpX2fW96CNNNbZ6KbtYF7VjoAU90PrjhBp4mNToczxDFEhUcReLLg8E7y+m1ltcqW6qyptHy0yzwzNQD0S8xp/2+vCzp2a7NPXqXvmVGWDcmk3eww6kVvNsG+7UxD79qbnr97K87ailQb2GYe3UTfrGlAO4C4e2+UbojYqdKQIF8ekNf42wjzb8LwjDVR/y/KpQ==";
const c34781d57fea4582034ad0af17b7720e77b31098897cb41466225b172a22807f = "+YOmJVmdp5uxFhWHCUAvN8XHXkC7K719pOPBdKFFYVOtB91v93/qQeQtvKXvD4ysZjhS6MCHDEIApchbUJPVi/7w8Cu8e9UrsutfyJX/llMgLnKr8ngJI6b/fM10HhJ5cy7jnrKqkv5bBx0Qs443JFCHXjRn7jI7YS6a0TQM7j7yPFrPIPfYY3xxdYfg8bsZlAa/LbGIJA1wyRwqlg==";
const cb7d6f396d1fcff84e11038a054ccd4933bfd527a3a94c9465e7669ba4071acf = "8f6FkBNabsOxiQkQyY2z4qYKgcOaT7CJVAw3TpGY4ZyefcPo2HocAF80f8v3HkG26iEQbvp4frDAeEcNa810pnLbw1Sew3E3RbC4BQz+M7ywGswks9pSnAiYvryBgLe70V98wS8OWM2uzUsSYUeRPJocJ/6m3wa/HMevEk+HfFcSxyKJzMhYiDArIWR/7RZV9K0U8X0x8pF9U9ayhg==";
const e631d3ad70d4443d25e9fff5858afc97ca06683b4a0762c83e0ed6495490bf01 = "U9Fz6/Gp9fjALfk5Mfs4OWDCRdVWm+Dlm46aspR2HEaW9adpFl48ermxKE70lcna6r6XCQa2/jDRkuGnaxN0crD/OWYZeYrkg2s0Za/OUm7nnfHsO19kvv26c7pv3l2zWKHzA2i7sKgGaPCNKkGx/jgHR7PR8eqr9i5X+hQdIeBdfYzmh8Pf+LiN1kKGnv3goliAaTvW18KN50h1ig==";
const b8cc05531961d6f180d21d1b6ea8663b090bee7dc88b1c7d07634d366ec26298 = "2m5ybVcgMMbM2Tjc1xbS3nPCTzmi1jTbv4ZJOZiBl4KDAbsPrWAFQfbB8ADepnRvZpwnAuUcYykZVX0qkz82DyN3KBIs4E7duvYFwu3JvDrMTTHvkqj4h8BL9EfEpzffelcu8lCVsNYy4eSyYNngAYE/1kpqmzUwq5lVd2ljvt7MMRVJtjFqUuZ+vtFrQF51SVjVILFFvGbcpnbQYQ==";
const b4910ac930d06b9d469899fdefea18b5c99a9dcbda4cc459afbd13bd99a3e9d4 = "d1B+d22al51sks7nCTtnJvxN885+YPEXtCdYVhVCL/b6Oo+3+o+vaZU0CJXd/w09H+Wxp963svn5vjz54kfeI7AqLJT2QRAESf3FV49Cpp7AwppBBKUoyU+O5OFCQhQAGn1duPO5m3TdkSHjjGukPUiJ9P+YjfYBfHxxM+PGDkE4qKE1CFtnCWP2nep+CvLZfc9kUkY5LfDw9XRbcQ==";
const fc48d0c0eb3a2805473a87ad25c0680e750206c53f583ef827332f9cc3ca7945 = "TLT269a+vTz6esq3uSD3GGy/WdX5gqBnI+6i0clc8dVxXlhqHmgmE8Kk/X+Q33H3Z8uHtV/MhhGMNKwNHDQSSfxbfGeoQvcsuZCXDNf5M8H+Zlq18EpYubfqMn0qjycHCMex0GFaLFcOpyPlDKbzKwPv7Bj9KK9GL3K4u8ECUs0EcZ8ilTlTuoOUFWvRNKuxNa1T8d1R8yK2BKj56w==";
const f4bbfc9f271ef2b110e36b1388f3cb16aad51579f72f1bfeca5b3365d39afb03 = "Q4EWKZvmKegXY1Nkl1OXwL2/cunpsTsciSPDJ1q89Kr7pJGssWT8/h6Tw9DFK0ydZT2N97tG08gkR2FMJL3aJHhyELZcVttcEmhu8+GOsPxRwDpgNYtaMOB7uysCgPX46pSatvo++bGGe7L31b7Ncbbvw8IjK8QHdzcL2uREULCH1z+4RB1sdEEjmiOrPPeFMMtgyuytRgh5w0t4DA==";
const b8fb41b61dab1ad54c358ce547396123facb3c18c10ba8f5df810628b4011b84 = "pt6Pb4sW14Z4LUs5QpqbjpySmaNzobbE/Eq+frcEHLBrpsP5wc73D8TozhZLU1XOHfy7uaznFiv1lxHh7A5dMtaiOoXPAPRpeurAghiTyg8BnkbG2kW1dWKsEx0KOSCHjlQ1kN7et4S2PGGyffMCTkBl+5648xKsJIFfea8gQ7gB8YtoFpA9VSZB/wWZ4c4YAsUbmkDa2/634IYADw==";
const b3c6106abe5e60623006d43cf98a522039059621defb97621bba8f2d904a492c = "I9sZGkpNi+onBTMGDPxVDd21PUJTvOxeuN/QkiSpFhbfWniaRItbKl1bNJaUGvWVcNtKmc9pOtmlAeEE3zr8frK67nR9qrfGjZRL+rQQu33GI6ShdhdOFCujtWObykuzAdw+9UCjNJm6wSpl5qWf4X5sp+zYbHoUdYooxaM8Axua2U5O/u0pv3meDdCNUg7ssZxRRXVG5iLTFGntgQ==";
const d1f22fabb9674bbc3dff328465b48e5ea4fc0cb5a8d96feb150e1bd8bd4f0809 = "XB0nnhaELCFzzHtL5IuLviY4icU421/9sdenibHPivdG3cnFfW6+8iTTpSEgp+5owvPLnu7Fxt3raZgVFeEQIEiZfFSm5h+IW5YxS56Grg1Fd8lzBwcMLfrB/ra35jXs6tN+ObZKRpXr+Y7UQAemwdpJ/foC0L/OGeo5f6UzNrCNFSimOnBAD1Bh4/17KXMGZAv6LlFBLKMzQvxRfw==";
const ed55ca931b46b0ac7bdd435012b9c38b84d5b491b07910b98ff7536de51f7a65 = "bBbKW7hKupQebPLSdpZ56EIMFZddMlXhO3DVU66QF3g/TRFrfdu5ABBzIJ5E06ti+ARBAHxFq70ISCKxIbS4jZHtU8wMaQG3KhlL0rA0EgOTOjk4idreeaKSimQhzuyRjgN4CvwZfz1iA3wpy9zKRxhrTxeAm5m4HktO8ANtWgOMgIrvvtHji8elKrySkxQ7f9bA5gIiPJ8M7jenlg==";
const a5fff3569cf892f548daa0ae0dac68124c53a30471f1a5346a97e12ad8f111a3 = "m+sFtHuvbEvbm6iLQAJG5awocSHws/2rQRIP58xRVkxBxGJynp9pLtV0oiG96lyadrVYppjVBxdt37htz/CgeL2/mmIkb1Dj2gtJpp0quitNEygjDHW6fTFXO8Uup7I/oe8D3BobGdvgOs87+ATxRynpuPqC89Q7DLTv+dbr7jvo2KMs18CaX0gitpvs754I8StDta640Ft953Iixw==";
const b8c24c87d05275520bb58825c83a428c15155f3dc93f243bd0da2feb1bb5dc54 = "q3ftRcqNWq4NiRNrz7vXcAZAtR1ZuTY2DK4hTmHCoXnsKjp/jDeGSz0MqlYRU5xnlz8i6KYtSWnVZwxzq29h8gur23j/byC6XjH/WqwUBsiwp+b4ibvhl3tqsgnc62HMy2/75HHYjPTO/t1V+tMwCUq6zWJsYMn5f7sMob/Ir2ZDvMhVD72UqGmz/1urrreIGJ64LKTNTxGdEON7eA==";
const f95f169d04555d41af124fa54354258c43d9eefa0f3f3de0b63690641078950c = "4IdkKDVsvwpROZycEkiM/5r/Xh2RWovXZQBSXuX7TjG4OpX9lH/4meVPrMjrsAzz7WZK0M3E2Essm0UykbL09gRU6dOZ2AorO+FDaGuu7jISTYq0dOmIWsAH+1uGeHCPsx6bksiRxVnHIwo4+Hx9j+ltnD3bZ45ednAEHO6Fo+o5o5nmDz4RLUAM0PEcALbjNrGvtsXef8iq5eQqug==";
const beb38ee9684594c61bb2d716309b70e591ce397a5a2e3a80ea401ddb36bbf931 = "yDHmvGflW6fUel7SFVoNFQ1WOcz/LjP+8+VkmNNRQoXoERNlHZTICVLwRm1zvezdLf4pGb6stBM9E0CaXneP4W2TwPsI9uvQTJA35OrDwfTPdhDsnzGabvvm5cfh4duGS+aicv833xO5rAIb+4ndKfRDs0RzfaQI5Tq4oRS8MTlxrGmCKsoQorIHSHDLTJqE29Yx/od6cndFxrWfiQ==";
const d8f3dc67d0fa88f888f11d412e97cfd3ced0cf15bb0f057472b6d649b9131d2e = "sIHkP4/d2LXRHVMDSxaAJUnc2xfl8vsrWW0afQyeaV6y+JKe9ACED3cNieVTFki1UwLpQ4dPKzCwiVkFX9ze4JEfwmSWXv24TaEl6gJH/4nkdUNE7omusWbwfT98j5O41w1tnm80f9yzidbmrDaZSxBYCSA7IbiEsT4UqW5W3BpoP3w3PYChM42uqkhW095zu6J/yRNRPteVR5DG3A==";
const fcd235470362759f3362c67b3735160030332c85d65e6df84d39387d040e8525 = "+Np/CB7n59O1rED+daVokIMA+IFG3/rkdBSONeik3LzimIPDaKl4BeUpgUQrJMhjvwX7tWncFH+k5Xb3pY0R8I+U+CzuGL6KFyByyehzGovF9u2QL3ltcu7Cy9L2iIOuCJ9uEpCqkwEVk9/wUuxG50eBQTVIgBNtHLgsomf7Ud4KBPuzgw50RI0GA+EaiGXREGgKnWq7Qn7ZRD1WvQ==";
const bb18362e8be79dfb3360bafce0a134544b9179d3e9ffe680f09aded927d5eabf = "jtvFhtyAsVxvOc/GWJrXSh5GuMkWHBKgyuest4/z61H5kI+HOoDhaECAhSh953UXlF5TMxtdno9WLRovvuFCFCfFGdDaSQ5WOGsCfGXB8okGsO1cRDNyVn4hYGcMMScjAHcZLKnx7I/Ia0I5XHhR2+Xmz3aeXiraY6BXE1iYiVnPmpNJ6/BgKgBfJMWvO2wJgDILizHQCdkOEs7FIA==";
const d9ef23d6b7b274a88b902ab4d7aa8151ab0f8f21eb67993d56c114b66525300c = "IKUceLoRifyx7zwEj+QfJg6yI2YHDVpAE3GCAoloGP5hKrYKbebmjD0doXExeormDvhxBxdIrxfvewAffbafhUs8JxDoePH4Qu+3pujUslxxJsDumSZjQ6Hq863H39JOJqqht5AKgc3UKYAzrf+6PfFrl7hrCl5Hr8Doif6acclKWu2RNP/xOkDi12homAcUg4UkAP9QKdY/gdnpeA==";
const c577025098dc9cef5685b48144fb19a98c21472d796c2b3da7b1221c9d449b90 = "0fPE2Dm/bvjQzgPgQuBDvzA2FoODIW/yXxUStnehhOA9d1VbkNolBvPywgkRADDLaiQkokJWeMYsCKxXtDSgF/faS6g9qDp9LIucMqy+mCYr9H9si7MRVdk5S9u695CVCgkkIKv9Qb42eNeL/YMixK8SRR2qHh+oyTKb/aXv9YSG5udHvl8N6++5QRsTdSyG12IO4ZJKYsgZWZgHLA==";
const f8adc686a4a0b2ff5adfe188cf13b674c2bb6ed5d0ab91bf070a77177647672c = "ly8gxAyWUyVNLmIn2LBt3uobhUPwxajhK9mjoE/P0NduoOYhsAzMiPvSu2rICSMOEB0m6WCm/SKf3jZggwM0dtuzP/Cu6KpFibi2zwEMEQ1dobSusYo4SPGufrFws80CFjQLaOktLL/vhG+rx5CqADLjQOn1RMK9/Yy89gT4uVL119Kp5h4pdW74dUr8itwRrbl5b6QJOLQEzXC2rg==";
const c28879f476986a53aa3d11d951cfed833aa3c599bd6762205ee61705dc00d982 = "5jfSDMcunXJoX7t2X4Q3xmY3fbFrS0GLJAk1OT2k1vGK7sE6W3MEcCuB9prfgvIOH1stWk+gg08iiH/3XkWKT8AM2a1+FEd6aaRW7x4NYGYRJOhwO6Ig4+BzI0tlEWyz34lmrvAgg5RmVSX1Yq9WhWBE31TF48ieKml9TTC4npDIOpOFFhowM0paEajwWMa2/RS3+YgX4GX/cjIAsA==";
const f176a2d092bf09cd5c1f97079f7f4da0dba3d002a1c464294a0d0a9d854e7373 = "qOq0UJgBDflPe2YEeeIF7VxprhYC4C5u/RkiXEDahMIPSs/qiOCGAoSZgPZtyyWrzZaQR4L1UtHo1LA5dMLQePUBqHtrVu/GnQ5SgpMZ3MTK3T6/y3m3pQBExrjalEpfFx38R6HZozkicUnSuev8SqIEE5Y73zfXMuofTpYsZj3fMI0DgsMkbXYBlupTAc4t4nCIEhQ3GUEl5+aCcQ==";
const c578af126f4d2c99730d577d4c4bf55c240ded46f81bff8163ba1a844a9576b3 = "gvNgZojVnY+17utGBrd8K2y/OoIK4NTeqGzPQHeZPwEhWUikUVY5064awkHM1K4Y0+UJdBDg5xyn74mLwCPvbSItYV2wHRvN0GCzK+Thv5pzZYzNoACmyBshKJVoEJm05H0pu4ByWVA7fEyIXvXdVPgKjNf+lsED5UebpImbGZ8AjZNku1egyT3B9VeE90tYhtsljqskEHJJNy1e0g==";
const c03aa1fb5987cc0c3db1ab9d3ec86f58021ea4369c397b7bdf5584bbb421bd18 = "hOAuR9004u+eWPZPY7jNXDd5YpGkjxbOWPD+2xhUzQRNjIv3kvnb9R9yADfS4AjJj8UeeAjc7WajGxXeXWuSeFKGnqQkMMKEOhU7Zs8gXj0WjGeAmjHhcYazQdRo6UhhGh706QZOBntg63l78LZhA9JIXm8DpSWnZS2lHJZ1FxCVKAJcmkzGlgpCHsiO6jMlzt9kL+shRmt/cK0zVA==";
const ea5bd2bdd9fb16eb4456ac3f60835eaea01503e5ccd85ae656e29074f3babcee = "jFjstcLOsSmwPJrgPIWKNidTpyQbDTbuEgJM8NzYATmJl/WnEH4QwnlKo6qbo1/YQO6i4MbFuUh1OzhGKEyyuO04TUz5HpxO02Ln9Ch/mXbSTa8/CqWu7YweSb/XuElMqaeqx4tEc0NcrE0nq0Nom3m2GMCgyqlL4dmzAmeiZQ/d3Ka+Ns5TC5O3GetbO+89dIRjufaRBAxTSPCJWw==";
const ccfb5b5fb686c64ae37e75717ee820b66d28ae5293fd67211475f3f52381467d = "38E8VusvUjLWr++xzvwva1hbRvqK65bxp25ryRcxSu8T/qZcbxBVl/CFrf0WtyQg3sa+LfThRl0EYq3AXh8u7uMBD/dJTvR6kyxzz169FYiJb/E/DATLS0EVBtr7myM5O2y/btmVsDKIH+e3qP/go49vr1KcjFKmes13rWlkG4PvcVF7AF0dAwNjLZf9k3kNw6izIbSgfxPOWYl7Qw==";
const fa0070626b3d3f4170b5435570256407047998aa981c4bdc76213b8079922a26 = "Ol7d+5i10V0w2b68xjJKixg2ozC2RW2v38t0SVtV4CaRKYS0eZbP3mfb9/EGGl6+6vs8dsNssIHvJyGhF3GiwolQ3He6vE6k3TslrWnrnV9JQ82w/n79VMn6AKdoqGKIE8MoVzkFdwu0HpD6F8nYgJ4sDtKik5Oc7z83EJflAZRF7x+X4f3CMLwUi5EYww/X0ow0ehZa207JIv0I4w==";
const a804898fa39a96ba21b3decdd2dcb070c74f6793e75f7e7dc5f9de74ff89a603 = "imI0PSzcmusPj+M6D/Xen7CucoswTzPIpCbTE2si4U8MiKY9Q/JPJpIRTL1WvCNqlUdNSwsA+MVwIz4AzIfkKBS85pos+owjcSHP8uBk5q3kttFNjhcVd40NTMW9x9MHqzcVsaYHHK8lPU6cGwcFisfVm9gevU2xFJH1ZRHLnBDgPD/hTO7pXDyH1xmU9opFCMmGp2/ATzLZ60WEjw==";
const c2933801842ff5902ab9fb19413ae42087c7b5ff587e2ad08e2ef82a99d842ad = "12AMRd7f7NIRsKiPUq/QmEoRiBP3SNSchlsoyusOBqDyBMstb9nApWQ4pK6Xgwr+kE9zEJTX4fx2xNaddc3d+8yumcgKq+1kONXFaXT1ggd6h2iropU241CVxgL3k2P21H8Yw1XQfbJVtyvngIOVt9AlPHft7/5rbmCUjdtWpaWHqpDl69zAVHwYcekN5HOke5GMV9DcJg0FDCESpQ==";
const d6cd42a4d0fccb2eb6c27cb5df9f00290c2cc1486708fce0412187b4f7e75b2b = "75tpQLn0uMQZm2iHSJwWiath/TchzEQIEG0/lbBCefqt7zlFdGITYDKl8Wgq9RtAN3tqBsXz30Z/aaFzo5UuLsA+VfAksmkuY4Qfot2QMeZGnNJuej1KwNTlsDHBMTEQw+VcK04zJbhR+Xp26cMNEoTcMW9MEyZbIytDJF3li2GC7+Gx8LyvgE5/UGl28qy34g1EeoAOFsoJGn/VCQ==";
const aa385e15fa825e1afab67b7d00064967bd4f83fe4348640d37a54c953e519b80 = "hMlQoM7eVQE0snsXFpcFfYfREzznghLGpIYWUjAE7m/fCzvqy8zcNYnzylyPcxdE2kXiTGwG99LnLTbgdizjyPyfVfHCAkj7BLFGqYKpPn3oLvPIpUZrsydb+urCXhYjkjjwUJPu/JBhv+9wdZKs0N7WOVlt2z4jSOpwFMyRi+/0At1FnDhQrPKpajlW/kNRCynwYHEJMs9Muha4tg==";
const c6fc71c80a73ea048601b69bfe9e66254edd95527d807a8a8462cb4ca28ef330 = "wpg38Ra+eNSSpiKx6cil/H5vbeZug7xE1aA5/5ZtOy6qSyZXbEtxEALDU+nP3QJXW6ICS0xGNwmL5PjqIaVzZ+SbCzeasyESTl2+LWfnmonr5Wshr78Bp8heri29sKDQxlv3v+ijdQcIUmt3ILJn/H4aW9XwlQh32brdMdKgsVGuGhlpERg6azegKga991TfsviyOKE5ondLbdPCNw==";
const d755b9fdb6e5637db98c36543b2f23f2bd4a0263550d76d6e887f16865ba36e5 = "Ll9oUnyMRjDHhNmMA5CWqPRQZ6wbfRRf8k0SNobdsmFxz+fdMv0aU5Q/WgQXKrPSXIl5seEZ6uAr2BB7VrBKpru032vy1tTRZAV4D9HQvgpIBNM0rWROyva/eloJu0pDtQg3ao7vWMvfrLoZKDLWSDoyxZ3571I+jzl4m+VsdOZsfFhDkyXBxlG2mP4PtX3Exa8yg0bXYKECiirNTg==";
const a5eae570fdbf64d6e4501dad8201503c94b486b2f3c909c52dfbe6a86f1e5fdb = "v5892e3/RTOsa1+13HpSr7/1m6Olvt8CpZJH4rAjS8eBHGelchAACvO4Smb31tc91/2U3ZPFpfkicROFc17bPODPwNvyoCRwBgpbL7XOQu2wGXLcwoITuujGW00SMKJg6+YsWWYotNWFvXjf/i8QISt5eiq1XJKk6jFlfDRXbfqgZzSflL+jgHe/KK/FiQQe6odM++XINVMoHnvdcQ==";
const d09b6af4b9f783cfe14258e7e3e2014db434de7db675dab12b113eaa1bbc8091 = "NODsYSTU6WztXReU7+882samSNBqUoSupgk8YLMHhM8lUyrnrE2lJWC3tLQAfOzHIeCNUqKMm0jdCI+Nwv0tDzyG/csOIYG9cA24DPs2ViVIhyYJ6oYL7CvyEPoGjNDc5My4MDaOgGNcNja7g8Pzp4/tH8EjGTr65m5pTmoT5KYtYGy/vvus4Tjw7r/pF3TPQoSJhDRCoSpBrByvwg==";
const b25439d643776d1363e6e5f076cc69e69542b23a8bc75bae645d86ba6308b51b = "WqLpy39bs/betHcUCI7iXYjd7MHjENrwrR3Zr0RJpAGY4xHrR4nD1X81cNOnXdPfClg4NUaKMYhQfuWkE38cDSA7Lt4sSphddaP7Usja6IEuakg/+UnRMqElW3eJ5JYC+IKfElYJfgUDNnT2nen6mczniByull+Ck6eCNn32tm+Hj6jyZfdncFcd8d5IuduYB/xu92laAqJmiSno3Q==";
const b5e3995090b2c9066aa3f7aba7ac352b0d31c42855a7cfa5356a360a278ecf79 = "AsImfVdWc5pncR+69drlPDru1jWH5R/J41iFZsYuFydribDskg7eW94mD0z8UG98WVz7gBousqgp2QHPoeOjAH+b/E2WZ3gy+AOpLRvCbuuls2Bw9/lrA8H7Go0A17RYRHsT7YedjVKMRijz0eujGIYpgeZ6nmGoziG5UUvHF74Cf9CZmazHuhDKO8dx/wWUQJKAfkjz95lFYaHdFw==";
const b8661a62912852f28e3fbbea39ab8059b23ec7f5877f9e920249f7ae026ea9fb = "OV+5nk3QIjZVSj1ysp9/C8jVC+HDhdLp7UQa1TPdVDbDrnBIPo2LJsxiypHfjT69bEaA+55c6xcemlevpOA6I/50Qeup2x1KVfrWeFmnDnnOofuzEptX+UrzpHG1Or1UG3xAJc26oc1aj7nqKg/AIoUZxIVDqFjJnqqb4UZ19+Bzknpu7GJZniJTqpnY/5outUez78bfOUGe3F9DBw==";
const d86d5db639b5a8369c5b56a091e79bb2393a01c5f2eb9801d6ff2651c4207d24 = "eMS/v6OZD8GiLICJtL9Bmpi6gR5RsSNGv5JCCDnv4RKBoeovzPP467keIdx49bQyCdoEhWqq20fuu38xiJg3VVaLfE3ejQZLfGGuDnQl+8/Yi82IMcrdGdB1Ox8dItw9vFiuManNK0CYeCSV5dP4DC0MQVVRfsCYS1jORhKIf2j0ZdEPS92rdZ3Lwuci456BP6zLix6x1k0Fb/7/JA==";
const e5672162ba940d7bde73b51ae8e5d976f1f287e29bf8ecd53583b5ed598708b1 = "hcZH5IHAXkRdOBsSKZkJ0ZYUo7gKaLHZeCxqVbHlcm5aODXZA0RPylENYjHZqLknwoFzthrjKA4ABns8wVZlamW7DOl4iigkQXH+hOZYrqwGfaOyyy8PRWkI8u0t67zGTWGOyNXKplEMCyuASFutwuJ8d/MPObBML5N1nbjXHZrIqm56sKPqDqW5LL8/j3mvRNzLd8MZCtvkkDyuEw==";
const a2fbb778e8066d16cb1e48c86985cb290d7f07af896c73ff2b3206705faace66 = "ehAt+IuZCmfG2PuE7pM9Jn9j+A6AvGdOfg/AU6LqOGhBuEJsdQ5avsqiDNWwwOQBSxR02uPhmY2+4JFy+ZH5P2zswEysLgp/0HZhBYiE0Uc/aIiV2H8qNjNeKVJEAlLKQzeStkDR0mY4hbSTLA5NHrgdox/fudPNYu+YQYbaMDQNDfazjWjjSAGsmmb7DPRaWIppq2tCBGaoVl0jqg==";
const f9b0678f8d0625761510522d4ff69b02f3c61bd9482b24b94162b915782b219f = "sWaDlrJcX2Bg1/DiNaYQN3rxCOJ8IOBOr8W+yte7KIaq0RY/OWlf7B9yPxbxE4UZlEZGa21L2zYBkRY+JUyYK0BHJvOHzjJo4YMJ9wYLPwiXvbTuR8IGPEbNFeidk48s5JmdlaWtn3wTmLrpJqmoFh8Y7HxYH6srNLJwiFcyXjL78dN4Rt8EIZVorz7wIu1S2Z8vA1SKY1O9E5tSYA==";
const b95b9b58cc6703376af9050943ea7e59275ee037da719620794b4f868dc7ccb5 = "JDxc86b44rX0mef7cVpjnB9O24OzxEYlhjxuTIuYtFC52BS9o6frgnz5AhWCzzQHHbNTLfK7gRrfmmAn3irvi5uKHO+HkvaaspfPOMKCTcHNtCe7bWRXEXWJDdN1n5w1bAmTC94prCsx8X6v6Owd/Ptd8l40tIFlZbsMC+aJh5uXjmGCrfNsESnSWFGfqaAcwlRytOIP49A0vF6Wrg==";
const a08aee7db0b3cc26dae93f855025b8a4dfa5916d16394e86bf2931e708793c6a = "4M9uEozs/eIwyZXcRaLw99mM7Rp+tT9oMOYP5Z+z0DcanBnR3DMgfpfAeX7H8RnY+VX/45meCNLVz5Y5iIvJ6ljkZCoSvAbIwxPnbW4edh5qJ4cLs1e4CaOw1gM/Vw8Sq5XO5BqZg50pBueoWcbfxfDzbc8OmW1ACRRAvCg50XrmbagIWyFSWXiwGvGsSFaVdrF3xO3mcSN1+ZU9cg==";
const ce2d7e1aaeee4eb512409932126dcc976b19e0d12c0b02474f562e598b89dbb3 = "zgnU1i9yS5Ao86hrgjhoQ57VkG0tuYHfmZmFXZeDcuS2PBDGqJuNge/Tk65ZdWHI6hTC9tN1zC1pcd5C5eaueGyX1MFu5dtvhPjKqCiqHEypldoQIvyhXxGcmyljRssLvnNUylHxZCsuAwjU3xWAhBtoRwBkYmSkPBioPt8RWwGkpbMGv26qdZX/Jnkwe9/2N9nw9BQqeANcnt72tg==";
const d47bc082bb44e2f731330f8668b2a85dca321822b4646c7543fa89885aaaa6a1 = "nr0VQ6CZGCs5WxJTO1tr98/ydnz4NPrHMeloFM1lsJ0IxPHHiXTVg63z5HYWu88E6KvMuFpWpBmlAIMbHB00EQMHXh2nGHT64Z8UyXvxrFBNQzJq0Q78Cinw3XtN9mAN2/C6UQV4fQ1BZybjoth7efnA+6mRNnMOsv2uV9QiS5l90dBQ9LAS4po/5CLeg7Rs3etd9rkPe7U60azO0A==";
const e09535b1ad33bcc64baf5291899b66fae3eadf70581ceb4c48b0f96b7cb20831 = "qLAQF5J8GkC60EAF1+qki3tyMHojuTbP2sRYD535kxxggWallyKLhoAhbV8+KIjAZV517d9UAqXDB0Mq4upX7/JnHvBg6ew7qFjYo4r0nEIPO5YpqdLQQP9qR8gEWTi3z5aIUTfQ8fJDbq3fHUrdkBdNbTTUpBvMeVJA5lLAR7EjJW2VvYe8Tg+y0U3TI1HvzotJoCGNHvSHlD7DrA==";
const eb6f0d9e82330356a57f9d63d597db78f93f3a9bc3a89ddf5436441cb3d02363 = "hWQJD6HcZwNlInGhcpcYb+p3rp6pfj06AmvKu0phZVqWoAibmHlXV+P6yEVl8sroPyExN7x3LlD4orxNtL/kku8lzvVQ3qTgoFL3BB9Zz7pNTVS34LFAYRM0555yxseALyOIUYcg2iM/LytDrqrjw3HKu8fJDJd/vR77Sb8/UwfdxL7kr0ffs1L37Ad+gMJVjMJ+R1XBLdv7KKLuDQ==";
const f4a137976fe26a606adcdb437d10ccacdb57243f45701b31ed5997f261e60dd2 = "RLSvD9V0oSDhSZB2LOz90K8gYjGESQRnh1L5k7ZDseZyd0sP3J/x4X+ANg9xyOM5GPBi7qyT6GTXNW71hecdbpf/Cxkdtqk6gYVSUBFpry+ety2ov+c/XYby/TGLF00g4mMHQE/L9RyiDJuq9vG5VGI2bATGzzt1rGQpZ34HGsULGGOHGl4yKbCuY0gpVOvct6wuyQQ0u+Od5f6ZPg==";
const b53bb3fe084e2ad9651c2619bea617974cebda438e415a37e0744e9a403abc95 = "b8EoWdFp9zelkrxhWxH3AoaLfWinkK+OexRqEiulACnIgKoVfzC7KxSM1LbyJKbuAhNPUFGKOlmZabSIHBdFK7VgzFqAdY9wWo1OX6tBPmrxEHiOt6gBWm4iZEingLVUkOAbxqi7SfuMXh+f0pvFR88O9a6kThDiJCSPcULd4OSqJiSZ72xeKREWRJTqGsha1/1bSfO1w/DG7JwksA==";
const be07014d9e86585687858a0cdc82bdc28a011d977530b057fbe2889f59cfb1d8 = "q0RevNm96wEjgw0q35VAeF1m37k/1e+2wZh+ImhA2z15xt1YHdOYII9O126NDtCSiWa6sIPKIdo9klsCjFUyD2fSKwLA5RfvWUjI+aL00lkbut3ixTZoYzK8bZuYKWNjlhBZ+5nMRPXEufHphI5sUbiLp6rz9aBGoNAgfjeKkN2mnQE4WIJ9GCTlJzjfjnPNtxvSph3Mb4jOnvDGSw==";
const ed225cc8fbfcb1d625bea64313beddb72fdc4fa54e3c77c72517fa8224f8d5ee = "q67w9XtL2RZvG9cbpOK7GqqujudFnTnVsNGf2tUeHhL4m/FwETfABy4JwUayqThfelHXsAQqEqP8XyFmHlz8ucuymyPD3eKWq4fQii7Igi3aaVWkfQvEWBmcnZvGP/efuUvAaUnsb39WVHfw7PhzF39PZkT+lrxxkBObXUrvxGuSB7+QJTeQASAtvscOgIloiJ8Vub2rFPYCncAJJg==";
const c498fee9b8e3a1b08a110783f05854b99dbaf0bf8e4f2ceff84464da0c555e90 = "z98XAzZcYofcpGfWokB5JpbHVMbymP9Vu5SFWQ3U3BbqI+6ZqistXNmxZqsG1QwtmBK9HtUxpObgzvbEbfm5KPoZf72FjoHChMJln4TOuitDzd9b4LUl4VJ0In8jwozVFV753iB+3uODl1TlF0rxeRlVzpbwmI/BXWHl8Lx2BIDsn/iYGMQiaWcvlIQAeVr6jE0uiQCSwf9CYGQHcA==";
const b7628a947755b3e3ebea7a9db679c7088da37caafe8f381bf88439b21a4d4be4 = "uARXO8OKQexOr13KEnW+QbFT4MUJrfk46DgfcxsROVROcIU5HMeEWfsUzAg8bGFB6NwZQtdU7SAE9iRLaddLX7SAX4PKqAd86UYwVX42hQhLKrpwU72F6TlLqnvyYyOa5KINWzGAIlsQOCUhCV0bgdoX51J6HWfpDd6SF2Sc7r3TtfJ0RxCihVcYmM1Ip8fqL9E2nF4PAl0AjFlloA==";
const d28ed6bb124dfcb2c719d55e9d15278b01145e3eb22f0d3ce98e9dc152df154d = "rdn6xmbeLCEGxq0dmPa2yT1BiHM7d1cwiydRQRuRuPZDzgiKNDEL8eDxHDb6S8z1Xtpykx4YPxXvOsUL512TsEW68b2DsAmX+sQYgWAZB4zkGSrdEA6MJiY/cJMInfi/ADXXQSoo95QeUBWCpvrTEL+bXBQqW1QnQHHf8ciKjwFU3MdRKkJJFNui5cmLgNp3sM/THj4oemmQyV/4JA==";
const cc31a0cf3fa2996f3c30f3f0bcf24c4bf994f225a5f76e4ed8bd7c078f0f1c78 = "n4qvFE8tQwzft60+vbGLSZxr/97dTuq1JNSZg6HlmGMG9DbF99b9vIBVcWBdX5RHHooDBpVJimhD14WNgmYCnNx2H8SFpk4PjD5a4oTEhsOo+dLYk4dd1zwWCMVXnag8MpJIBrMd+4DwpHqfK5dIvQ2h4H8Uk0vOqUub+vmDr5dFkkSpM/U8TZC7azqzWWfYi7grzwqt8j1mMpR8rw==";
const bf839b74dd80b61df55299d1005fa5e2988b0920c09702746408eb137c2cb5a2 = "3GTKpbmROyUgLgMuzO9RhCY8IEVsI4CaSVEkdMtSmkMgt7CEQ7iXixGZbGCw1a5y8g8Kq4AY1YESOOQQ+YcYxQrki9IpAim392+VtThFtO1v59f7hpiDX+F7mj0P+F4lCzvJuWYtbYrV11dSO2sTxZrIN/GagCXxD9bIZjOIQhpXN19uXsNv+RUa7RL4OCvyxwsPsVoYOVCxcZEGbg==";
const efb81e471ceb5e38213b57272eb79b6525b75c6a5e6225821ac6a6d38240e1b6 = "czWVKKqk2PRwlUAo74NaUr2xaY464MjmYIVm1Br+gZo6/26sufT/Df81wbSuKNS2p5s9zpXtvuqu4Q1TYo+Qi+8CBzUgNLGPi+Sl/qFy0fr08rRZ8waUn9yubkTmTsPvzgrfQoHOY/W9RuVrSSVNrIXpwnGMbECzvsfT3y6cJz//LighFaURaE9MASq0h1trIG5fQHki47oOooWCIQ==";
const d8a5ba89cb7ee5da43bab0e58325cdc678a4f321777862c2c7f95c861ecd1878 = "W/qjeJ7iyqmrIrJF0RPhJYI0nTv0iW3RoNfWV0irwrstFIXpfNYMzMnxMAxHEDwGCrVIw/24dGIM0zn4uEZa8TVnBzlwYa1gRf5905IVeZi0rJJfwUQP9IwLUEJ+1VLYLJxVFyqW/r9WC3Pb6+MZXZvaij5eVCW8l3P0O3b0u+prQ9/J5YEvbC8GPVA1php6QTbzZiTMl5lr4SFJMg==";
const cd886b2b71838081c12d3b6958c1e7e6be691c7478efb508567f5a43011da207 = "ymm/kwQrtwk7UA0+/F2S9+KwYlVRnOEPjMQCdEN4z0mHiIhZAeCfKoSJdUCuMlBLD8EfytY74uROXxzO/BIVN88GDJ1eX7L90aOeSev95VgAQw+wDnN236tz1ib2yeXBtuQTL0YbRy9Pyq1ipZhjSjC7DbypMJmZaz2Cv2WFqBTSXton+4f8aMjERn/j7pzJCZJNV5P3zoXot46iug==";
const fc358f629020a2ec520573636c93ed5f741adbfc50c25fc4c522ca6a2a4dd6b7 = "4YAiza62I/zBhjjaVqJuPYv66txQZ3sQbJReLteXOonSp/k26MZU7SekDhb2DfpGAYB3OwpEnvJBwgVklvh7OWLTBL+uCtaW5LW5ioDhuGdMomG83eV4spUZMheduvKwZclF/jeJuyv8yWwj/14ltD11c0FdMppHS31Ik4mwSTjiXomj+sTZ6PgcrRXac9O9c9UtwM8Jg/eH5+r2Nw==";
const a0042816e40f3a523a5a2f4b56445ddb1ac3107b2d61f5bf39842a51dc3cdb40 = "kRLcrxVfBZ+mH547sEiLyoxiVboCym8uu/gRNd05zgB71d1Ucyx5SYO2n7ZheeT5bxIix1wXrfT7sAWGZYO8hafV/3/6OoAaDdcSaKtuM256KZKeNeZ6XY+RrC5PB90q7cJHabrSLQXfOOx2r8ncUQVghSJc17+6holz0rb0oxCyB3UQ/Sxl0l5zHEKCIYQm8ckJkk8qm9KrSPoD3g==";
const face0f572cd513955fc0696c9a86a1358e77b4802998990d80ce32c5513e2e09 = "m5ZNtNVl7Klgxg4bqlfR4issALj/aP6WU+E7GtULxxFbKgf2Zj2DqXXiMV3SZ23VnZqX7gJdU0/XRjY9+XohGLosmkzNYU0WWQqGstFENOEZpMHLygQkn3ivjEQhiNXUIW1TNhYhMe05tVvjIl9Xm7tMvPh9dkPJxqyguPmlEFqNLj3YBzYKXtrtPS+mxhfGC0tLfTdem7HPBga9yQ==";
const d84c259f45145894bba4b2ebe861eda685b34eaa3ebc573aa9939382878ea429 = "BwgJpWKIhhrLkcIIEIxMTOnsqP7OWwE1rkRT899HoicO0lc7lin5FZUcuDOBDluJPh3mUW8NANd9htdYdEWy1Gk3+nx78uQDArThOqSytU1MDJVERtdL4aO5Ochcgg9jy5BGvHhGGB4HtPn+H7ma/pztcMnwnjYP7VDQIXz1/Tid+IIVd+ZlOVEUmqlUrSEFqjLS75ElWyfbcHqFrg==";
const fe5ab9afd01fd627761cb3b5a695ae1d33f78853f6e28cfd2a61fd762be61d02 = "Cp8PDT/H6NIktiWv10Lv2VS7M8YYQD/4A1CzZfcR7xrCu4mJO89NVnDGe2UCke8w3CorWhOa8h/eJY1ILauv7cucWZ9u9OE1D3bcLKfCGcbQS5Hr7bfL28HdldDZNuTjfqos4zFcD7VCoiQx/wZnsKl3FbNSQMq0qokJKjF1Qkva4c3bj/plQKE8Ek/LmpdL1t84XEcZEcl1HlYElQ==";
const c981338bce6eba1cde12ca1254e3a7249bacc36e1ff79148e9da2236484e40e3 = "nJvDSkKdpPKDU12ADolRVMSTjL6f074Hr906LRw3YZi4BYrxBcJibfi4KlgrlU+nTENx/WVrXkPbhz3qAPMVxN6izHJ/b5na7FoaC7JhloMCrpnGtCbHWor9UbnGT+cq03I/M4u1kSnebZnTj+EzsuDMzuPTFn13aZBgCZDuh01zBRBWQGOUIQ7etxHENAiShymogtLMfURVRO1GGQ==";
const f86fdd9835f007f505ba2b0048510e7eda67971d764fe4df1ced128e38c81c8f = "4JcsaojXAirs+rBNhw8S42be0K36cFGSQxYXbj5AqrqR2oTVga9F67fxmlX3L/eVZ11kXSJ7OLOZalEvJLELF/s3VtVq6ljOLAbAl9KRujn5QEFo3MkctFPKNU/r/sD1jF1LMMOsi45Q20w3ozmZbKyUFFS/idcgfutbSEIrLGAehPJjLqWl8MF6P0IB0QItewzdgzhsRbXZNMuqCQ==";
const cc4dde107d7d86a0088ce8ccb506e503a85efa378a716ac53da9f7ebdbbeeb0a = "4evSJyP//5I6pr2Sf96Mv6gQvFMqX+oxfAhhCGZW6OVmKFX1gX868uuvwwR5CELV8c77zidK8R+ghrGIp6Oz5PAbP8eGDy5/ODa5/cjYFnkgHqQzHinqFnLjJqdJEZ8NfcIhMlPDaghmPVmcBOXRss5qqusHxs0erMzQabcT6jprIghsw/wkKKQmjWv2W83nZu8/HM1qlYqbhbffvw==";
const d7d12803e48d589df5e381e763a4c2b9617fcfb81c42ce5989d466c5b9b4791d = "XxC1dBoyzNGbzrh6uJlNm4HeWuGQyC3AoDhw+pH0O+PZF5lpk/2Vm6QjnKhfjTwtyoTJCDH4h7D++lGKZlnYli3HW5p4OhWVF9INR/SBnqZHUBl5k8V7hlH4PL5B6VfvHiVxKFiIHXdbKthJwxemd1GbDElDFVTJDQ4clzYhCnnMKEqm+l60KQVL0He5uzTNldWe7L4yjRHETXYk2w==";
const c0a386fd50405badd8a28319e033c77c62d2bd1fc3e295b6a1e69d792c4dc617 = "Gv9MYuAYz299nzJvzwZpcPpOUZozsBqmDAVtRrVSmAAfXMxatPe4FDsdD3NyVmA8uUutxurraeKcpYcbTCgZhpjTAytixFQm8hAwbirgdVPrnRxvW1NQUxgWU19ZAlR2VnMZDg1ZVEArOtgUyen5ST7P3/vRM4Ro1+uhribCHHuFpSSLehsgBazYjtBwIaU6niEURdfytE5n1qUz/g==";
const c0f8dead2f606cbdc8ee2cb52670a6c3dfa1a63d9f4615995603a3dc92bf406a = "g86nlp77I1GJ8Qx6LBRN0T2s3GYfwvgGRe96EtBTP17FyLJchtqYURM1tlvKQkhbFzgEDKmH9HLDHdcIj2YIrXviAevtS9t7xv7t48uoskrJzBoZe4z4HuAZ8oGZigUN9Fu0LhxbYxVy4MRBUiSuWeQQbrTflxOTHvbq4aGYWMgOMF7Gl09pmbR1mgjWWeB5YDO9HbupSRqYSDmZug==";
const ca525cf68722f896e1dc9847bac112d5219452406abe2573d406fbf84b10091e = "jGHLPZHkill+CwOMW+7OSrygvW9kQXs/stGe9qqnYRvASjkNEK5bnbkegEcyrZUFj/WnnqyHxsT3e8MArekvGN7LMwbAGuW/2dX3GKfhs1Fz50wBNp35yMAJH++b1JAPf87W6KCzvkr8A+2AXs1kP2ek3Q9HoYcGRIox4wOyKqjt5sbrAftxdjgkWsK+H/MWv01TAOOLHWytnlsEkQ==";
const fbd96f5a3c61abd0b01e1d161f9580db57166dea6cd53396cb8c65deafec7d6e = "O8vtLX2d6uRbXGNKmHUSiW4YbtCfva4qOasjaMfQG30FofGZrRXcP9cnTN+ThFNTl0otLk4nDTVpQPiK6WX0Ff1M5j9Wp05yvJvONfqIUqvr0HjPf161BEn5mOMyTSxPWA2QXHZKxku1+8OEp1/TgY1xQzXljtdmDxb2ESr1/GFGaBG36J6PtpjpUX3FnS0oDUkYtnuHznPX4u/vOg==";
const cdfaf72183b2cf08e6ac0f352ff40d46aa546fe7d8a9032c897427ff4b18a63e = "l8kHEdNYvIKVfoyi8vOstcIIyaOK0p7koXHKRsCm/RpCnj7kwafAVNzJRwNyOvf0n0XblCYgMhKN4VZVz1jfay2X1BgDf7PXgn7qNPXgZ5aVDbNwLMyZdkstmeZWXdQHOY1a94RWnIoZof22dLg+r4anFckc7cN7YUWZ5NqpmH9jcr8QhUYrZlBkeQQ3PrzIan6MW5V3oDDBxX4iDQ==";
const ee7617c992d511af999be1e0925059f5105744ae9f5b54f7a7bf2cec487c6129 = "nqXNha0aVjXh++4XegTy8yzetYbaFw6BP0ft3gSff4ueP8lXc5a7aLVQstdUxqaVPZru+LohWE/V/mBcBnYR0595V/jHChouF3Wtm1U5oZZA1EEFqKEylHFVmUr3vZhs69tAaUU3f+lrtp+apYQ34lubX8MRqiRJsfHeTk3PM20Mb7yWm38yl/rEYYj1SGGEgyMdj64lCPHy+eozew==";
const cf2a3a446d5428518f57a3b4390de28c3a49199a68e2321e081f5708f073fd86 = "oAUlNVny8Yc9bl/OJZ2GpmUf3R5FIz4bxyBDovX7h5PPtwlzAhZqYa/k16e5Sm4FILTafwlwUB14cGF8YOE0MLSfxx8GpjtimBcBPG5EYnbwKfKDcTRX9ZHZUzBy2VnpqI7kqGVFenAkZAnK61Cgymb9RJfAJk66MjO3vlLvHJj2LkA1ul5ysxcitV0xFAhYY/oMBhIMxACKpOfjjA==";
const acf94425dadbd1babb955899f384ec824fb84ca1162398a1567171760e600d27 = "0G7NuBVTrzOco0A1a5fKChR7H7E8qX01fnHqnazoZvQYoudCAIWkS0ssxrpOkHiIEufyiSi2qaowmJYl2S600ZlMaKoeajb8J9K38mN6ZZlgGvA4tGNcT4s8PELzfT9meZerZgj1JVasUU0Ipj91eo8xp3hmAPkL4OIQWNy6eTfiVDSq9szlua9PWxJSHmxqhhM4/XSovj2PEUL0HQ==";
const a11dc3eab1ca1ea9645e900a26f00f929e4ab44a9eb4a9931abb9f9a576bc9b8 = "rED9szf3zHkJA5ETEH+uFC1Wgua2BnzED/Pk1GEpNMGNdoloj+w2zHn//OgGauuIApzMCGzliyvkCfS4s62XLoT6OWb93SJeaQcqGuvLk16oxe3ESglAuDD+N6uQQYC7DZAO3OxbOM9w5P39CDeBzOeVnLzzbWCIi0bnxODvdpJBFdYHvmHFQ6rGctbt7yiMOQtMN/rnMubJANYvrw==";
const dc9b063832aea7eaf0d370ce301892a2b2a10c60c1ac91805b73b03c7d7046f2 = "4SpBK9RtvnogfLT4jlaTN03hWdLWD1/D31/riraN0wBqNraoX+c1rAK50cC7hzcu9rmyPcvJGPGs4j76OXEHu9ZdbeQxoJxqGnZNJUfnVTdrv7GjUOIGS/y6x2onyzgQIC8FJ1VZnHeK2795YajJzU6prJAM+La19AJf23FTLTkHMXz4ypYIv2x2rXZLC9Nu8ekHdwMlfpw9NV9pLg==";
const d336c52f0c5e81490643263c3ebc815614967efb9a8ff4c4209e230c5bd3feff = "6z1qLbKzzCwDL6mxpPKcq+jJf3KMvyAmRsy9lhvnp3X0ZhfMZ/gRcQzoCyglU+uBrvRrKTN96CpzbUhAbaIUdAGV7u+la6IwgRzrBIxx59vC5xHwruBgKLgD/DjMh6nNVb7OEVq9FDP0FicEQ6U7oVCv0bOvr2cBIKfe2GwTazb7Dw0ThfaLxxB4xiDwA4d6u41KeHN8ac2EPZMy3Q==";
const f171e38e4c909078555f7266f9a5210ec17910e1688ac19afc89949e806b62a3 = "WvQeK9p6hoYMPGB5a3LnD+37jKPaZyJovHN/XbclYfJY835c94h4Wah4mXZ+jzEN6vdUliqEeo2e42I7iBUn84TJtc03F8wvsY205kiuXLeBJd1FmXGrPUx53Ol43YA7xmr/hNvXTTTICtAFQ8uSrNNNZk1K4E22bCEN33cvKJ/tUxGnk1DUz+TrVuoVYTL7KGb5LSSgh6VZ4lJvrg==";
const eb551c0918d2690993b3233c4e946ec682b42e22009d69b7f17f53f212340a18 = "dnBPNCtH7oort8zacrr7BC4IAl+QjX3tMdBwNlGRUSoj10QUYU1fvnfO/zYNfxgRiwybxU8kh0xKX2yJOA2AuzGq6gTdvw4iZMDC7GWq6PulQbKdSmQeznc8Tt9FeDDMnDqatF7JBuw32FEKJivMRutdYaq7cel4OOU8loH8zV+d6gvVkX6K7DP9mslH09+gi1sy9Q2u8LVeDn+aXQ==";
const a04ab06826e5f24226ad24db4285438d4536e665106006bbe94fc53ed1b0cd51 = "xULOln/Fc3YrrN7bt+UtFqx4mfb/Pt7YWbg9i3z0bDgMramuWgBxXRCXzCgZ1xmxdSMOhWeohjnL8uTkTH7uxP5UZP9nUnEb5XUfIsiNmNe6W1cGXsEM2pGUvmfuvbJHI8r26jKbqxXLtJVtLmsimjuyb4c9dMH5NNKtPAcFvGu0vOIl/bXOfJTqqt3UWUIpjKBnae50ZyAMLASaZw==";
const c6391732a881690937a0264de4e87bf6c8eef178af4093edbc24cd9cfeec8b08 = "qdYWhIlQ7jDVjbhzRdL2rZSH47wqMIaW2Qpnb5oG/6tBQ6IRNNzzXWj8gI8G1mzTSCA721QLFUgnAcDS9Eu2YuEZugGXmj3Xx5sXELC1x8ylMCk2vqhIvOJMr7y9mZBMCFu+b/utGVFqdzQbU1NmAcUMOMZtbiMXm+40ddgVrIcx7TThUqgcjj9xamXJK1/2UI8FqLQ063MOP4dRfQ==";
const e3b7afaf7c5e79d66a0984f7737b774bf4f2687e300b3dd58a23aa4a320908d0 = "S5aGWc/AeVZgCI0KNbSdFkZnXn9pXs5Xy4KFAL+cGhuiIgcjEvM2u36tjKQvdoR/87Y+oPVcYmchJkyqo4lmn9hkhJEXnzEYYFbZph6qSqCczokff91tnrl+OkRBxnCppVQ247AI4VsGRHTADdJdYT1ajggM1fmmHi/mJACSY9xgFgFIMnpk0wzWUh0PqbGpjFJIiGwz1F4gjp7hfQ==";
const d5a84d89e0e3b677d1228ecff5969eb6d47da8d6e9acab30e8a9a9721aaf8abf = "IihMMJ9PQUCR04ckzXsfoogOlvtBTMNxhIMq/a86Y5KGp3JrUAmXuSFxROB3bkxmwpXUCKi8Hp7ZWwuOwLXQ3tB+H/ipQ9PvjeZfBCedG8+T603Cap4/OgKqbrgRHYQT1HEXgGzJqaKTI6UxKUXV7i3hI+cE609SRVTIoaZbEeWo1Wb+qWuZcCV+wAXsC5VYJeb3oi9hAt037XHlpA==";
const dc54c747b62f974c1f93e3a7c7722a1d84596e102bd8230a18d3d62a1a642c44 = "H2igKu4h6no2c8sICOoBzvzXruoWdwbiVrBuKQh8pptx/n6T0aA/VhIH84r9ipBQadG3egcl7pnHH6Ourg8st+PmIYkr0EpOrEKDaXEJDjnGPjXt0maBBfu5eCTh1Hgo0lrgQ3/+5tNZiCqG9sl6wETRb+Ltnt5RUjPfU0dcaxRRtVSR0yfMbMdeW0Y1JrSudJrZ9DebwbKJp8SMYQ==";
const b7c15d056924b6547b1b18cef652a71fead4fe4a0a1a4c3e277ae7f19bb0173d = "/5L5qw3dkMqRHcSgiaM34V1f7UN1UYbXVPY+xbvdhsx6O+QbeLHWYGpWExXKLAHojDCZV87eg6Aq0/hL4qn64cG4psZ6ie9aUOSPdFtkv9FpD+N77qn1czf5tJclsptXtBqbeQs0RecalCOyatiAOOcTUrmfKiugKil0nMwwCGLTuh2O09diOoohN+JilupGPYF1XHQnF5XLWPyAog==";
const registryData = {
  b283cc111765aaf3189f424e5689d16f78967f6d59f6a675f9ac86cd32380b93,
  c2899c728a5e30da25595d97e9d1cce49d4d928f34a1372bd7ec7854a48a9163,
  a06f6efc123bb6355f5f55fa70cda78bba5543187d2aaf5443bdc35a45e9b146,
  "116900da222bfa360f85d4765e13ad6070142d58167815e72ccbd56ef34771a3": "2DMk18sn9oPNPEJl+EzB36fn9x+fO/PODMuOgpUffzDNDh6U5YOfWIUrakl/hzg9SXrApPNkUEgQpudXLgRbU7QMSdCwOpmQMkn41LPzVlhPnrD7FlWiJlfHKA9Nj1fsWeZEGOaECvC8xPQwNC2XCqeFTaJ1Ow8NBW1W4KKO5YJf2+Q0FDlO66ihKFtYh5Rs3AFUp0sd5tUsDLE=",
  "1e3f90b2925814816e26bf70270ffad8832ca98a155c84cf7f754a9b1b9310e2": "1lnOckUj/b30qCmUd8uuf0PzLrgogM5auhg0zwrSYjKUq6gBf0SGFE/BzI59u/Naxn8jvEGTrKMDGU1d6id0OArrUPffV/49I8yzSZh2kATue2OujAZofF983i8cvKe8beFnMT3UAuGYDx8SgBwheoHnGUCUfhMazEXVKr6PC+UFIDNwBJxfHM31enxmaBNzX9o0JuyyRc5623c=",
  "9015b076455691563cca22e3676e5008a0c1642f4a6ab75f01a64b3b92b51196": "DKAidlcu2Gx3t4k01+vxbc59jvd9xDawUmmXY7rGVbU45V6MvfHliYFGgwfR/9HMmUIW8vSyAYyObm/klZAirjoa5Yn3ib7a0JRTLrrUJfu6x1X+7eVbti/NaxwKCsWH1KkAjz9NMgxmIkUACl2E+MR8FnfoeZcCp2yIJ50jYfwM9YqJenVtXLkyV9QjcYcZv3DOj6AR4T3F/Mg=",
  "7fd524c33d2730beb0a7bc8f010abd919cb1d79115dc44014fe42c570dde7c1b": "sOsL5M7tVoQCW+wz3lgFzJEoQEDR6bg8Nm5gl1N4Szsnc2kQZpZ4IIup2XCpeApp3kbKipEhrVSeoFOmuVI3DcJ3VmbJdXDH45DGYwwUNZHjUC7B2JSuHW21jgFYU5/Jmq3AI+uFFEfzfv6k/wAUzxCz8G9AKMGDp9fDTEBqR6LFmx4oXejp7P9cTAC4TpzXjGh503J4mpiXzr4=",
  "800d64a2992af760e77722df228ba2076f975995b1fbaeef075111c156a1128f": "RE40B/x7efoIzO5LicN6Sop6Z5/qV+z+s3YAn537J0N0y8HeckzzpLpzSPamYddW3JNmeMEzisJCQb3RH7Y7Gwq9R5HfYBYpQqWaMGwfM9JCT0pCD7IAoR0QkhzD8JsKnQ35U8ACNOeevK6xnfGzI0QslVvOpegBfUpM29+lrEj+IRLEwxAU2Ck466Sn2/9vtMUu9KCDNLR/HCA=",
  e9bd966db7df088c7ff72b6e83c2567291882df0338d3dd8f56b7514ed3f22e1,
  "996d009fb22035cc8a7fb78bb29736dd7b61e98a3364097bd2c2cb32192d1e5a": "uoFhg1wrPO871rz66uf/uWch/Jth2aFRZL7Kp7rXsZmlxKZ97OZ1+Pj+t46cifKWGlAaoqob152PdQkNGkxDSTAzTf4GUwgMURuzsxjNHAuRAFhAPDgFGZTaED/nd0qhhruX10ZXxNx0JPK2QAn5s+tUNxMCDxCi6h2Ix/5da24bXz4zCHUdEAt9t2lc/MJc4mpK3HqEah5kYN8=",
  cc151d3209fecbf242004089af58f1ca15f9ce2dd6923014c8765af92cb9a95e,
  e0d70dc6df57115c2244ef57da9df89d0c9b228856c720354e80505ef01411e3,
  d68f1c7aed6562848e63b7606b9ea1932aa8df98deb984a6b05921838a9d0272,
  "0a7c852a2a63f5bfb4463fc61f9a24687580c5c9e6f5dba4bafe8c324048fa70": "d/HrlTRyX/RNIm5hTEKZg8u8cb84LfitZ2bnWGqLD4r8JwrhSGrF9jmARtd3iAOhN+wco9xsTJxl7+LOJNJ9yb94ZuqtYtJxfP0s8iZfyHXhRKKb21brYSXnLQMFR/g1onZFXMp1ABis+udP4bMHMeGtc3fa/xbB9HsAPgnJAk1PeLUKqQL/woZ+nSn5Uwad5DdhpKtRfue2OAhx",
  "49a38eabc3817ceffafc6ff7e499047aa33311fad68030bb5b05637fcc3b8ce1": "IGedEJbZysm7EDBuNWL3ksC8t/u+lpsSoOVzwHGdrptH0rtz15NBmGvBq224JeuLcwqRABS03dZh/FMipLrAQhEEBw8iRkHnazhZe7N6om5LooeSuPVPncqGHm/McuLb/yDuEmGlZ2TB5klJPYo/lkY7roC9/RbFVV0B6u7ABhGy2WKB9iAIubfqvBMdAYKX/NGzgf6TS2Odc4Ee",
  c10e28bd21d24f151f6067f3163870e1354beacc566d1212268ce96fd5c74a4e,
  "51118af301748e2002a9412bd56226d4571d80984f84c36f791292c7cc50db09": "4m+1XwNI1MydjmLWeDbPMy9MSNsfmrg0+tsS+T2yKNY1n/q4f/gRGD8oFaUHDn90tPdAgeIA7HGPgcmRBMTAGe7kcRP/nQPVBIYO7tjLdDvn89dSIix5N5gho73ZIHRXGta4AcY8w3dQVREyucxKkpGp2q6Gixv/VDR15kdAYgRg1Ka93hFbWta+X6ojZ3hgsysA1hwMoyLdEmYd",
  e368b4fa7172adaa8a4d24f82f0006df27e8a84bae2c7321d77006888f3c8cc1,
  "5761f20e211d04ce4e2aea4ca94d8b5da62cdbc941875ecd078d0d1b074a08e8": "J/X5o/QcHJUSL7DF8iv56cmBPeNO7hleRBHTKJ2yxbJ/DSG5Q9hZcYGZX7gIEGSw//ArAwE5Gg89suoc4xscE66XvD09kfNT2gaMtV4fVGooAI2xRaNtH5guqSToUTSWEC/j8bN+kBhAbgkMfX16i+NILKMTM6JhCiItDICBL+l/XrB5FZ8sCm7I4xRclxT8lsx0g0GCzpdwLxKj",
  "7759dba7b0af5188762887250a856dfdaea418d5c94fd6ee3c12918d9ea71bdf": "EI85RfGEFFE+6hPAmWDLGkv8rRla360oLnwqrOAgca8NRsBk8Q0PNeERW/2ZV1b+6pf71v3c3Uml+x73H5wBbFdBzpaVe4//nGV5IL/KcSKY50Us+zAUJYuYDFXH5O56x/o5cJpAJryoioxH7QIoGGY0d1gB53HlYo4h8GVyyfvYL0tehUf0V7G4oi8Panu+4h1T7nqoAaaeFlEb",
  "20d4e7d07bae0c28c359138d60b48f6e523790cf6355bac9180b6357921fb9c5": "SH1k2sMNKrue3pDFcvyc3w9JkfMyEmCBtD4e2OMiVCXQ1d56N1uaqCWoXKWorbs2bo5TO0zFE0/W4Kk7YAyW+3LiI68jkWNi2/xXhdTioqSKVXm9HQOOpY+bZMSwGg+bQ987XFacRROB6XFBGeMd8Zgl3rGPdXLeuGKxnATdLWW2WzgAq+3MRlkdGK+/ILth3LYLLxhJzTvIan82",
  "997fe0178349a71fd8c21e995a483264816f24791c1e9d2d3097408ef4609792": "JmjNeoPsKfweZtMQuFkSJyrkc1fGzAHRxcT3LZCq+bPGWcJTJKKowDBAdgNPo8rMaVXgs1xNJdLleiI9y+1WX1r56XxMKEhhsvWlnm8wAhuQMfNwJ2aekfeJJ2Vw2zPfS5HETBSzw7oMhRNXj2gbTIKwa4TqnpaC5K0jEe5sCz8E5gFxpAChkQR7LMmDlC6tEuQ9I9p9drmt/MCV",
  "68c5112b6e851f9e97227c72d98b4902816e97fad16c5b398eedb7f9af4ecce7": "ds03IbdqDIYllSpTT6yRw+otszxKesxPAq8r9eSNGIZhlk2gQmMRbuq2dP+Yf1BH2LpI1YzT46HkVB6MZ+SCvSGXDXXuWyILTlndSeu3tkoQg4nxiJFm4nGR+8LHgeBnN6Ryq2DL48QEF1kD1gKCeKY0jigNYI00MiGrxy0UcesCkreOPgapGvfPxNskMvrYMP07b4E+/fxEiQ0R",
  ccf01389baea021779cc373c468012b96f12c4c20869a90d42e8ca07a1f7b16a,
  e52f6d50a7aa3536e2880c1630ce81828506b7654985cc4e49b4937fe2424054,
  "9626bbb9e158d32d712d16503d3a1d3bb9d4cf942f88015c9fc908e79db7ad50": "eDtsbuP8QtyncpUrA0sooCvGTQwyqDZW3TTx8Pw0un9Grp83gTC9CZQrrLzTB66MkxWKYN65WMjGq3jLTSSJvBHees3j8Zbqm+gdOAbut91JmRzs1cJqU6s6HwspI1XAAIM1KLc3/C0ayjYZ4MokvdhutrJhKKGe2HfA9sFjHmMicrNkRzTqJLgEVT8FWKmaTzdDx3o/liI27ZmQ",
  "83416474c4f45cae78707d61569a1ad8818ab66d6d0c4eaf87438d84b25eb298": "qukT4yJs6Ih2SCtpqYvRRtujmTRudXscwF/OVGWakr578eI1rHfdqWO2SCAxoZR+JfBpHhAutm8jHg3Ki9wBCrJ3xUebx1OSS10b8+aQ80Fq73PUvDhbtJt8oW8MtqgPHQrxCPEzjfER76usbqqvjH/cjcC8sjq8Wpwx5qL440XXaIKjKDbYoUwDmvlHiYZKWVQ2RyVYos1Nd4bQ",
  "6e452204e8ce2eb35a616a36813bb690a009f93ba9c30a78309bb11fd708c38f": "UNkeC6WYK+al/vQAacfBbalFuDEA4q3LFMQVnf6WxByF/pf8jWjMHcxuUZQ+6FekRxkDm+l+YoEkEyq+vv3o8pGzPNSxDrF4fZ5wVndnZ3NHyUTzHOUo8olU/psGUyFRs84K3pPT2GB61xIPkk1U7OVToGihEsJyv9+6HmtttAdbGuEzOeDFw/WTmE1IK6zVMQJI/2yNoC8sOgSg",
  d1b3174313a6b21808a2ab227a06cd0b560d75f13a5c7947b848c70896eb944f,
  "7de4de6cb5dac8449f75bdb7f5c06e61465af659f33ec62daf9946d46a138c86": "kBVOMA1ZyqqnOMFekbQThT78hIL468AtRG/6OpJCDTc95447sftEFx67vwmHrSMoWN5pYswIX/d3ykqwYqz9QZ8z3MsJbG5IilPiQ2I/6vIV3wyc9dLTTHBwhvT72y/vt5cKbCOl8vvzNKJsMl5PnTWnr9FzNPpiGZLc+Yd+mEJeG3I+foM5JdGFVC6+jsbAIqQ/fUwMrznmmsJn",
  "4b59e4e2722146d7516b078a2674d99e017a20d0c09e682c1036988aa57101ed": "GWKnn9gAX4olJS+w+e6DkJi7udYwHkg6HobhmccgsNBlzF6dtMG+0qPv/C5TLysvZfNzHcQ4khiGq2ThFcaPp+Rj5DLWLwyUm/CByfh+/QngBkpjiQnxEmBqMTnCMKj1qRY/nBEg1n8HHFxkGrUCK4D7mwO6LnqGMBMNjbK7tILgHNedy9h98Pa/JcYRxQFvte5BPM01eTBw/iQy",
  f130bacbb81663b0e3ebc0edcbaab8510a16bcaf46f693ae835984e2acff9250,
  ebbb7f3055c6255aac780214979a3de3150e8e9d7ec847013baf6d7dbfbb48af,
  "80257cedf5a588928b9adfb3d54160a1a6c3e036bea5f549a2fefb5ffbf65178": "v5U61taYrq3+XeEhZL/K+LrFN5Wboae/YWhRZyK8M8nVhCVmvlV8KQGen6zEpUr2CJAaXwk+ec/3WyyQDkUNZRxKp2bkggtQSTAThgchOyGDwLAqKbcGiRxncFhxkLHo09u1nNkgxvOPN1XM6fq8+QGPdeuJayXLtu3uyBkDxT0UdpgW/JOaf207WjZuPkU6ZZINZd2/5nMFE1GH",
  "9376969e06029b5f047f8cf05cdd099558adabc89f0bc13b89f4b5e1d776c38b": "SzIu0aU8d+Jl303u3lSNjTBy3fO5Kp4tap2bL5482FyNriv8aa1lFEgtY+2L7XpG6u2YSQlEgd6odhdOE8slj80kMU1oEsG6ekIrkzkcJT/BZI0nxXiPIS/W7UNRLM+9D6XRXDLesKihwtm867MxFnMgu6TzJ+EoG4vRLIyHCCfYlfuxUbv/cGvBFAR0UVkNfsAIJR80H3ORrirY",
  c17c4d5e5b374d16d9096d33fd60e66a6b9e361541d6b439ed7c927997aa9d2f,
  "85231350e11f199c3a8d9beaada1d085b849a67a90f0be1f3de2514002eca77f": "5kA4uitn1qv9AOp3zCbCB8hsbe1hvxxUrre8iS6pFuTMlyxRHZ/+6PREgza22xzIx6/67APLc+1gfoTJtTZGuVCCVOuOIRNplUTLSIgoPydirJZm5E4V073+CCVKI2Je/bAw3NMQ7A6Tr6rOMlQC/Uk1Xd8x9syaWxYy69/Dn5zjU8WcQyrDXc3JTQ8Nzoe2Un0m+A1wT9VaFbiZ",
  "94a9aabb8eb8cbf80729f2503f25d181dfdd942484f765f42a7ddb88d27452d1": "lqMFEd64WBXH5UGFjY52yiHG0VRgCaY29PQg9M+1+PhnZIvP2Cir0a1rFaUwORbZ6MeCdgL/IJFfXVGi6hap3DFZ8GXYKW7be2OpvrJJAMGrsFTRsGZkOKm63mnqDh91GkQvClGs3MTBnn12nV3rCmi4DhPYGd2iY2cu5XPMmncsFrTlma5NuOULjpc4D/bcgic0kh7tMtxkQyDh",
  "13cacd0d2eb34f05dd2e91d723645a5423a4d24e92846e2a2287aa4abed616c8": "LyXwvPm4gRz5ofqNS+ZXy3pLTGA1WrN1ncLs2mgMp5RHq6DUR2+uczIktayMU+A2ORd/d6oS+Dlw1Xseij1X3nqWxbzJTrPh0j7J+FtyCCTI+jd/Y3aGCqnjEZjAxTSrWK8ezBPIHwYHbY113Ic58ABALvOwGHLyWbkNKifz/iizrwD5OQ+CHL3WeHS3/dgAzj2fK97ZtuOrxIez",
  fa25efc4ee79d3ef810b212c93b5899618c5f9c4565114f505aa2ff9f8192049,
  "0ea4b1781b2dc398e41ebfa20282a5c3fdf9b4794902873e0ebcdf2cbce10eb2": "szBaCcwHZ3O9QwCguWcxFEImCdkblJwr33MHKaH2oxpYV6F/VXfbfLN9hoQaQOur4imkQGZJgQyw3zKwhas0MWBsiUTuvDvy9VGQuHfLy7SyOLAXZartt2QNUgmtb+AMbrlpYkdzfOcRRrbwbag21kNckhTuNSg70jcI+FUO446/tC0LI2JZTplW1bCClybeLrRdX3WD0f55v0da",
  a00cbb43e60ea1149711bca57985b5c92d53e48ffd25f22b2144df75e071dad9,
  fac3dc1b2491357dd392fcd9e11aa34e4963cf502e4a4fad6dc10ebc635a6301,
  f94b41bd1dd0531c8745e35e2978c333f67a9c4796e9fe986b9a6eb642d49aa9,
  d3e987c69fd5a14b5562df9b38596f6ab86be0577d4e8c1fc4086c572b97d516,
  "883dcdac4ad3fa2593c95d42ad5d380cb7e12726a1630b5d9a8d4da62a0e8e2a": "Yerf2LeKNnJRAo9SxmSom6cxSY38nOyiHqBrb43nv5+hiN1Mj1jyWZETrGe/xbmwecPg9zhXPabVWfKqu12AGkGEIEsg0GMaFtuIrQ99zS5sLxTXNe2HoylOOkrMYK8senlIJPTSFu/oqSf5EJVePNildDFtiz2Gm0AazRiYy2nTCg1tGtww6qdRiUEbgprkXeXbPE/wXqzrx9v0",
  "9e859a4ea07325ac8d670ae97eaea25cf802bd1a3ee306c3c574ee0cf50adf07": "r0s8s3gGw0XaQTli41NeX9PFbRa4BAKnRBKw+ewmXJF43TT9o6+NaHM3qOBQc9zsqFHyU7BWG/JDnHEwM1iO6V6wCixaVf7MjRovPV2T2MUBBE5waut4qZoF3ThOG7rMfVsNFG/Bd+ZmHvQhQzqD5xGrbpKaVXGF6Z5vb4GoPvI2Wsp6zVlYWtauYPY4/7CBPNmd1MGTzxl+hAUE",
  "2ffe0583219de54e95772b7371bfbe3dd4359814215b159198e858a2a434533b": "5Q+z5P2miPDop8FxKZb9Z8262rJdaVfMRYkjtcSN6Wgw11Jjo/sUkaZWp/nLnHLyhrdJMCapwctOnob0IqT0/eKM3NKJUngWwIlca6GRcOWNG4UFRI7USx2bRG/66HQ9T/EOsXma/wN0/LaKeQjL5s06P8O7AktCBgjw5ArnRuUUxT7Or0fJOn0RESV61x2HqcD/UU76bgp2EDfo",
  "69bf1d48bc49bf4f412cf6dad3fd1b167373c61a54c29f46aeb0b151182b833b": "ZJqsxAP596dtsSH5nxkNDqUa+ASKerHR+BRsQh8iZyTesCy3Vmkh+m1Ka605j5mQUeggxQM/GFmp20a5/gMO81TpSSAMTYLJoTJno8n38Vs0TQgvUx9vbkZ8TBGMppp1DrsUrLEfCGGfsD1SE/os764R9vZkkHi3/qUxn5Kg+uX3HOSMYxVsOOFlXaRrsuMjgIDEVBet4jvVL3rQ",
  e04e0bbe608e63b4adfa1c3fca5c3940c7ac09cf26cb5113a5ee6fee5e328348,
  "593171055ccb6015613a5bf15ab9c3af3c91af4175b1e340c4731fd4a6b7f2ae": "jDx+kLYU4U4n4LbT/xfP2qwD6JZsKl+1DTz9dXI/xMWqaArH1ms/phhXuSm6j1hlNy7IfAcrRf7BZOj17ZUzQ5tqeEVTDK01FxOPyULlK+mmudMuf95GLlTDZjLPP2K98us1rg1gR3FeVDs3sUAzT50hbARuNL8r7KXZb6VnVF4MefmB6lOYnXqcKL+f0r6eqPx+qihxMjZ4/4oy",
  eb3eb75fc85b75236ef710c14cd79bd0661d11c2e0dc984ea2b9cf9dc2632507,
  "3dd891a32cf069175f2aabdd34fd6b6ada39fae996da1e8b41d3ee06b67b25d0": "Cy92Da8EXgcJ0TaVGj366QjU9RsWe/2H9SuDLakPRP83AVUpqJGytpa/mqRhwSXuqorNgInxSobvigmS0GOUDT48pb6asWLJwVOB4zmNIGxbe9aQlntOuWSooGKFXL2YRwULSCmomrAaI8GJ7VgBXnRnQt2iA9vvWPtRbQ3rX7m77GkNJ2hrap30nGc3wO+ZnjRsKAUKRe5WAxd6",
  "3e1ff6f4eab18fd94e8eef916036cdf1ad28dcf81fb79c89e4a0c4b831d25ed1": "lhRJu+jjTx9pWCJ7NVvJNsHzJrMgjhUrniEISBY4nO6IVG1S5Rxdtx3mBzISSyTJiU0pV27mf+vFGR4W7CSqsIaW5AWTLspPGMMhV+b4hdMOwu2XshvwyIkwPe+X2pc3oh5UQvkcnAeQdhShfS1MlavsxyfjVifxCQm/7ZOHCEGqwI3WW3p0LYs23uarInbZpRrH8gsL971dOI8J",
  "77af264fc0516db166ad2300c36f17fbbc50498c762507448b6ff1ed6a7d9732": "Tuq9/XZkNnkNK+3zVIL5lpMJWzqSxOGgHgpWHZdEwz9hsdxqjJwAbStV6Ru1Md/P1xuye9oKZyUDjSAVBeaYCZ9HrqRQJ6im0e9Tx3N2TYKUYpOoiqXVTYWIGzxe13ZLpr+GFtlOV4i0XWVr5EmN3ElSYXqFx/Fj3sgV5/ET1pQIPdKmD15WxrfpojhxJ/auX85KGBXfOPtmx5bx",
  bcb095243b11692c9af2ffc1c7a820126cb8d9cb29d93922a57b07a01feca1c6,
  c603db3c315cae6d163bd101a75ea95e934a1837654e140908da8227e2aaecae,
  e366471c35d596e96e674b9f5240b2b538d83c08a51ebf3f3c95dbf744bee20d,
  "4ac9d973ef1df22add16b22a8048398412e1cbb00279da4439adebe72d769349": "M8JpJQqMRsLPuka3bRGkAoGzAD2LRawrcXnwBbYPejsQMEg/OKKyyyRIbfLmA10RjIRPfIr7Kd+k+kxW1cq93Nptq2+an8QvwzJ+OEORrzOl35u1NLa9BPKK8rqZunBNwOEU0DU1gZ4mDMXl5/JyJFoqbZM6W8EPfHFNycw49o0zqnuiU57G0tYASAnnFwx7n3MvcEmk+enJi2ZD",
  "200607c09d01c7354f9add6d8f4610433b66b91c755a28ab3d6a9dd8cd2d3418": "itBFWZa0GxDVbCbYR4Ue1Y6ubyDLoKqY4DHGteGipqWJzu4fqnTNSHs5Nhd0wmfybMYao93qcaz5RvgCgi9KMnXTiUbZqQG4vkGMxcSOpjO2AvADmkHWmstdrsFnhESEHmNWeraGlQauuuvxwt20bFwZr4WQcqhj8RwAvq6RUiy+z6L2J1y9do0yu17Kbs1dTzjIDdCNC90z/kGc",
  d01cf9e8726382170792f0f9b28aa0d1289f42fda3d3db4890ccdafee9ec270b,
  "8adad3f76290f9a7066ea3cffb4e3d5d5de6db73abc48f7320474ff49137dfff": "B1raDB2UgnbMwGV1Q0uUg1zPnGSYzjvos3BUS7/Jf/pBBlFtFssSa5ccYHBahfyLaZo2dYbpnFkFZTFfHl8WYz5yB94+zWco52H4XIxe00sHIQLh48fi34GIWNcVOKeYaQ8afP+M1W/me4w4hRzOpY0Toe9FRUHIfkAJu4K9a8OvwuU+0uzMG3/bF89kCRizcvdfueV4fyDVnKMZ",
  bf82e705420535a2a24dab51c3b5b9b2d9e14f2263a9abb9d5d72bcce43c4c21,
  "5006ad5df5878c52fc9ea4f74bae9e554e9720f0aa7fc49bea4d6d0a5f6892b5": "yNZ+jd0vP3dOJWhfj6Fr3vYMWXMZ+lWsp0EHtd/KU3SpqLQeW/9/vOlyI0J0iBVkdpL5HTpkzvlIwRtS5mffs8BUkj+vVRtVAvofohQueZ8sPzbTxabEN80bGNJhLuorA1dRI18P9IUXOYSyPYnbrhr6cbJ5El7VHqWh/Lr1i0CfDosV2VYIdT2UFlXXO8dyzcdpR8uLVQVVlVqf",
  bf8675c476683e7615727259e0b443ef40a8ab43b5f5f705bada02cd6f995016,
  c8a653cbfd3379330ab9560738f02ef90e75be35a9922eca16fc40da88c4f050,
  "1cdd03c6290e9c6ae7023e084f6544a1703aec17de7dee36b3b2002e26ca227f": "oQurghBr6I1ZQWuWLDLkcunqqLR9XieCKZRj4NpR7sf9rCA7FbcfkW+ZZMpT0jx4CXmibt+0qMezmY41cuPeUemvUVtN6GtRwSOvz+VCJwEvwR1Rq/pW3YWH+EYjk0RDmQeUJrq6VXMU6oGXqufMCc1KGxHgpwAk316nUBCl9bFq1g6udBC9kxUumOG3L7/oHyhMFApKUg01a8oe",
  d96fb967f5026f31564c9bc4c2ebf944438b88e5dafcdda57ea17f84edea13c2,
  "8e58023e4123ff3209462166e7b1e01fa48ce16b9055fa8963ce27f7c29dce44": "YnhPfaq0h0XamwPvvjKk4pgdROkDXnrg9o6+VNvTS99XI3NrBxA/uzc1qwgb0aOcKGJtjil7qCgRn16sZrNtBO5nTSN9aOQ2TAKpErtGpRyYG/H2Sa214iXmTIbA32ZRYFb5tpYrqSat9BULfYrRfgEqD6Gqml326Y71gFGcoM8HNzHvkY0t0ipqfkQgcbrgeTWuxbUQeqQcpEHJ",
  ea225a2620087f589cf76ef61e1179b959aae52958cb97eb81333d263f734cd9,
  c83a21f4f58beaa371233ced9f97c076ea05a6e76141b2ec1bd00d13c8f932ec,
  "70bd199edf81076bb5173a1e3f9878afe559866182f575091930d57caeb754b7": "mex+QlNcZlRW7hNh0hngyFPlb8WMngEhkiBUu90g3O8/HhY9BJbmA3uEyv/cEjBcorpSNHgtrbhkj3zlGWnwPLYZdH1aTFhVIM5Wb4LV8a8Idg6Vdm0snsX5Mo3CXvBgRjB/CY88c3Vf1hYI6Xt3WG078VkqkqvJ4Ud293CsGPX1piLX1/RptgwW2BZFrXfipZ/aAT/ruxj+lBrE",
  "6592167f6fbb7f4508576718c291411f4ca7a8dd6a293e62d86b8de27be040cf": "ti8aKt75jCjII4kGqBRV0GCC3hjMuy7oANdq/mfww1EKz7xJw1yGgemJ/PTtmqb5eLQJx2+cqAUx/oBz5YiVL0Ye26ctop/p92jaIm+8d28bKlZbqWbIRAXs82NuEBtowL9NabE0ZWgcgeWnD4+LybzU3h4Dv3rsdfHO48RFF9v2v6tD9AbOaFIPxEsNH/MAIty8DeyxNLQFhdjy",
  "9fae10f571204a8940f28dada3b9258f380109d2de2e9bdfc02c124a799ace64": "qCvs22ctjT6zKPtX6RzNC8kSA1I3BovJPP982yCBV5MlKGa6ojB/SVIgXqssTeMkudZ+bKCtj1y3PAybzFqNmtM1MQxUnifsJwl+P3EtsdqdxlKCjDgmVDENpeVq6vg52OZbvN4QpC1mGNdVSQsdcRUGYdClJFxjbb7UKZlPqJwLh+FIYTdtaKmlZVbDvwZK/+JZ8UaKqwZiRT0Q",
  "7736b1ec03c132541e4ab66d7b246e95e2aa84a6e4a3f945a976fadec4b7a074": "HsP0+vwBgnqfyJmQ2vdz8K8oBYWzDd9qhzo11yC+4wx9tWf0nqNzAQE7PvkklLp0JwnCjPuh9TWCNrzdrR/EKui+WLJy1JEXUgzR/4H+EbghseijXZOZnznFJrB442EXP3ordqkBmznoKkmqd/J3RdMFa85ec7QILOPt9Hm96vXHNy02XQbBo2BFviv/r6NeaG+l4oAFeI49zytY",
  "58a238b56f1968e897416790595863ba8ed4ad44fe55b41a32f9f83e3a178c9c": "ktB8S0ODhHpghxcJEZL14P6fFWqn/qdi+dGvb+Tc2G5apeSmtFKH837MZM0SF9Jl1WtL70Oz3ODu54t5CUKIJ9XbKcLndA5t6BbLlWVeS485S8Lym1DZ4fuNrWM97sJ7tfI/1Q4cxsxWz06EMTOiLl+BTpnlplIjWe/ylMTKDKiSXooqU1I/QcAQC2jsgciwaLJkEB87Gg0jvS9l",
  "981e6d5bbc803315d2878b12d461f13640939c6cbb692c5452d8f484c689adc7": "xkwToqfwxIubAatHZvveXjuQo4HugLuiH2qUoNoWrrRI+qZTvFi/UpitMMyUZstVbq9Bd+HHvC/Ag02Tau++qQOlkSx/uMXibGJhsl/vAa7Hsg18v35MWiHUOhxlmw9s3NVu+zeLr3blWp8yIxG/As/0/Avzw+hP06LM7ytwRmMg+d276JhpjuuHr66m5wRPqOziNDfOUhFfTUgq",
  "9a9043c8f463b7a6198e40e553362d4e43c86e78079e0a4f39bbda830f2237dc": "EVKNYSvqX9kSYasCf+FHCJ++I4x9h0gQu475+9Gx6TScT2hxPT0dukrR+vC8lBWFKKu+rNYYCuNUwrph/E2w1ibUwiSLuXDcE7zTsGb2Hb/s2dm1AZ63IymaVXIG61bXuzfGbithBYQaHzLpYa8C7a25ndP8T+3Lc+pksvX8qvqtraSX3m2F5b7JBXGqyWaBZsx6SRXGhnuBzEU2",
  "49f06a27385440a3b3b35be86c87f0ff8fdcd60252eb0fe495c6cce149b060fb": "wabnAQT4IAxHKEF7V71VW6mfIH87XEJCEtf4y/Ki1jHnA6EzCUsNz/mFGc+BFpL9lbELcussxK0Y60X4+DXRRqZauoqclOhZBgRxydoaHAl57FIW6xz7k0pnvM6o787aR/1BB7+B32Nr4W//oVcN+qhdTfESEfuAeKoZWTttkAzEHYx8hakKaVcQETGKzByPTCLBfKix/ElUCDq1",
  "42db230d4789fe56417a0cb36c37178e18b4d47e79de5cef4544ce6fc81b941a": "V3yr45/+R2ymeigGbYDoORKD0tKM6NXziQxzxQLu4QWb6dWBO1wMcApMzrwJjG/HVdxai64LUWakmpnIBicjH4SkVeDTi68Ooe7yh3twRW1yEqROxeAUwDDOwxdFr6CzKk9/wQ1AEBJuNIHCeBrG17h5BhFJap2NCScM5FYh6OkAHGIPcsCKtmdmokkmywqZwTZUpN9mo4L5MIv7",
  "50e35fccb4bc841dd503a7bf04a85fb9326ef3eb6a62711605163ec898c2c9ec": "Fl72NIf6RVACbdTNh6mVhvAEk6+kc6Jjqe8k4+D5UNEZbcj0O3N6RBlSQEFtcgPxQc/mL/OLOP26+oMfkP4RGLBNzraoEgkhUMic3zP3yXc+UQLo7LUmLgvRfSci8/OKVaWKp5nktG5P/3CLkoolzPpc7LxHbrf6Y63NduT8NG9TKGjxnX6+nUdxzYigqCNasAV5y7zdPyM/8CJn",
  "514c2472525451878bf7a4bfdb7c8f88f2c173ca87fe328355f260ad533f7d10": "UeeQavh96hNfYnHxVLSsgyoAb7s1xlnWV9PABpqXOuwH/7300guMmZ0HrDbLMD4vxlqIkscWeM31ojyTfd/Sdpkz064dUtH1hWnWBki3xglY6A3A0Eg50EnaJIoLcWuSM8mbUSNBowN/GyCytImwzjsedXxfp5Um0nssclv/j4uBzRpzcZaeU6fzbYQIjOZL3FJC3Kt1EiRxyzly",
  "98751c07396ee4a71e79174e85189397f2b5e1f7b29eddbde82d1a7db300866f": "eXct7P5trZTyuUaNfeBQy61rmVzFtMeh5exqm+u8DniJwp5w/NZEjE92eNTwYwYg5j7nUIdlRk6aVzKtB1ZuLQCK17YEc/wuiL7xdKck2M3wWUNRminCZKnYcmbdzrP29f5B/tLj0a+Mnui7gQ9oZKV9+qCukWbBWC/++BZxBO5TAFyaucROZQkUo3hc35jpX2v++ShGSgowFfSj",
  fa27bee70718fae963edd6e246abd2de0ba2e827127c375ad83d887d1a938ff9,
  "0acbb0e6b6b8f45c3290eaad17312fba635aa975ebbcf1a09d939a15c78b2448": "PK5HBiPxK+uy/x8eOW3vcFNQsgzibQB9WTiqgNFKumSs7MOxz98PRsrSa3OH50w3YTnZ1vyVIV3FDaOzLuR4VO93mKyuUoUkdmxtnUHTBDxuEPpLkcAWdQ9/izjRu3pfS9AfhScomOHJ5DEuQooSgo7KqhAeClgsBJ5/FfgFjH9uJUGgH/F7BWFXfNIUStwxKaMiriu6Klfb9nhs",
  a167294498464224bdbd1b0dbe43059410928244aaea360fd4aee7115e54a89f,
  "35fcb7905ac28837aad95edf16c22a96309d1926d8bc1fbe55bedca8330e6fbe": "kqiCQCVZUAwM6aRNQ+FCQ5Q+kgfKDfabcw0AGlJksWRKU3Pa10QCm5r5k/lhrFOXIHsvzBQbVpjQdsqijNcYZWF4TBTqiYRMXDMS6qGkzrWdEpnUoKCQ5JKmQVFbXBQKOqGViTheSGtdbOzDRliHzs97XUvNRM2qipDbVfFW3AXKBWrgqtoDJiAR61pbIq3fILFg2VYznM3PiITx",
  "49b13dc5e148d83a7a5f79545063f926714aed89593b452342d279a6d5e1850e": "TLANd18EIkaI8b6vai2pLC7Q5mhI+sEjTBhaqGO+l+cY5wOPxQ+wYQU928JRpttLc/LSv16SASphqsFaagq5uWHjHGgKLdYjcX0/JL2NWlVbBuPc6yzkrFVSBtwV2/RBIhrko7nNVlQ2MpAsA2qu43uTUzW12S2EnIizjyz6/jsYHDuCIhkYaYse85vxqGZuE+JMT0BafWm/XhyP",
  "10789ec2095ea3c1b92f216a664484e4706b45cd777312549037c7efc2a025c3": "uTRPLQGA7laOLHPh1XTBXAYVvTbrz2CHqJ+FZZRmEp4GGm5D5fPtZGOmzOcjXghd7mu9XxMB/w2HEd5Ozs6swV3cTnzzLEcHLgPphMdRB+qCS5zbfnARe7m5UA5RVy/GmFegpfjMuqES2U8xQKx7wuxz0Fm4KmnYcTaeznqPSWQNjCZ/NJonwSwWg2dT5apHcDzG25z5MZbC2k7l",
  e8e80e88bd10222a2decc0f5c08a93d550ab841de09809a5ebf6d5154ee1d689,
  "962fc85a7c7cf2ddf1b5c4099f6997973d0cacbc5e2f472947ce730683b54927": "QUQg4fSY5WV4GWA/pigBv91THde47gstRvTV8vlPscaBZHwymDJhis45m8hJVDW91Q8stSX+5aAobYEXCWFDEvwJhPR7rEong0uvkrmpMD89fphildsChFFJ4TIPRkO/10vF02VUKdhqW+/dAyjShQJ8iJJGemP2NpGAQwtGbU1Hw95RmHvegmU/wO6oqqeVH8Ec37usG8+5GAIv",
  fad6d96fb625f0f7e9dea4866c6e28e0b7a58452302a7815f1612944bc4d7931,
  b41bdf454131dc0dcca641d1b0e33c6878c94020dce76c565966c4b40d30a096,
  "4512b538e3d57ddc6ae02b4c6d1d9463137f2ffcee85bbed682d1ea1195fb020": "0Zhz5VIjXbNxSlndAvWLMq5UZxNayorTKCvaVtweFBTFjup+gVxV2kzo+cVjmYLyCXSS9+p11T7qD4tvf87Bn7XpoV9TvrH5u7MU1dUKxc8XYp855Csiph0NmPlUe6zncydOgOqLS/zatwCH3hYjTZ2ym9UTVwwz9e7mxDAJGIwsDBfmVsvJl5gMJbeZGjoGMR2uDBEXWdrRKXcO",
  ae10e46b7909315efdd44d0556c18d1749f173c1d55084bf283d3eb35130a287,
  e8a0d541f7d6e8c851128bb8a4e5fb02ccef608b9e43fad0d412929de68cf1a4,
  d9fb75d0e15ce052cc72dbc97d36b10bc64b65bb52ece71cb59a5f54c22b425e,
  c3eb2b8f7685bbf3e111ecf88ee0f4343e176b228038f40b815e0d69c2febaa7,
  e2be9550750e01eea27e0fb5539a56947b1beaa74dfe6cbebbe2d29f64b96854,
  "8ecf342e817a6b128c9f634ce150890d9e5586a36a8386a60d6877055aab76f2": "4k8Fid2eNo2ccPjbBLxTcj9zgoA2YlJklZtZd+KJa2oJDeulEWL0gl1tW04bZc5vwVQEixHOdToKHU4QWX1PzjQQiQQivw0HQu//yL4PHt41gsSwTnoV1mWQJQKRWn7HP6fZNOK2WqZMNg9EfymhvgpTD4ymAJbrY+X9oH8dagN8Fwi5bpWSh3agq34+LTdXJeebdX9ND+Ev4VHr",
  e7aebdc8d6b9bcd47646a07eb0f75b4bd6cdaa85fa35e512eb9795fd396ec071,
  "39c02d4d58849d8384c2e6e79ab97b556297219122b814b060bc27e2c7b2b145": "2QuLKDm7IsqlzRxJAtOJY2JaPjN2FvlSbMr6qehZR5HnJ065qgSTGNS77neosBT0LxwNYr6ZPLhyUhP5VMIEauZQ6U1ffm7Nj3kzchNMzHjdgpSCUiGmXWNavS4CcOC6XQOnn/mqGeuqGWR32mQ8lpbRFP5qrwcGsILRRlOlEVjoKoOcb/uuOiIHTzSzovZOY2M2YG8AVWXe5iQW+w==",
  d54fe43ff3f2b2d82e21ba61b29f0f4e825829a30e21892071297a4cdda063c4,
  "8c3c44593c4a68fb98c376a4df8d307b809d8df6f6e19b4c0c37a168a46d599d": "4dephXya3D/WvlSZnheG9HcZ9KSKZJcBEX0c047H0l+3CJDDw0E8FIP129KcoqgfEf3sLfeAz4yeBndPTNRuHa+dqngSKk/xFjrTlpjoOZ8FuWRNhRPrfKb5F7sQZHBlKmTyUWWHc/klsNqACQD+4VnMR+ztLxk5fNS9ahj2LTwAtTeEz8i1SVljuwe9wc7y48RTFxLxIkwTN5vfpw==",
  "6cd2e1ba21e3d62d57096a729ea110912b280a5c25248b46a887a04ce0d5de4c": "uPmfUbhXXK0j1syFDWd0Gmo402DG2+Ft3+DEOZRXg6kU2a9SuOaFYB1WQYIxOZlbM4JQhGqpWxXItU7nDUc4yOFmW/KjuU7d3dzVwCoOwoGm7iqFIzK1yJWaB+qu6TJUu8mdnpLzYF+hItTEMWDQdjrvfwDFDE8UWMPpWTUqVA/EB2hstSyWYAB/Lw1aWhEXxdBLtAorQtKB65AcWw==",
  "72696c90427fd34ae0a1e58e6be2e26b57eab3d56c1832fd2601f3586cb0a683": "Q09zVMBtk3+gP0ujFHudEQRuNsibp2cBzF49+WgoK2vOrPrOyHcVS+Rw1W8TWIOqF7s18wKMfPahZErc7d/usEnhemGQw2kbuXe3FGkj/KOD4fGQooNrVQdtT7DtEyNyrdM1s41fZe0mqnXTn4VJuJeXvqNqQsKVLtF6zA5cPY2mZkfevo5nCLNNX5AmOYlkIPlxYFwGBx69PRoO5w==",
  e85f01158cc093bc8d4295d0d588a23f549de892c1ceafab8ca13735144914dc,
  "3ab67e4a90a4f5aa7734c7e245f4341c75016a6a71400a1e44880cd9843d400e": "tzeqRzPgyXZwx7hSfnWJ3Eczl9PMTbxBk6FCWI+R6FzOomJjkmYJ0Sl5/KlJHPcZKaWk0mpQpUv7J4VF8vgcknwruCg6GkGEHe2qbFGhkl5AuG11ZRkkpzdvj5pqZC5PIH52tQnbNOYD0JGHAmwVWyUHatRv8eNj2bdb38sZmwAdQ9NwYnDqXz3W6VTWCyI7IpP0u5iR3gsGRLXyhw==",
  "632ed99c63d8eb713550b1e3fe98292b3df2e13626cdd4a847ab252d3ce5e96d": "CjXH/Bg4YMA79NpnR3WD7m/EkX7tv0QyRjfgOhsalaqW6Dkxp2pISr6Sc9DbMZDb/uTjIGKnSwME7C5MLrbRWmZX5Lm86IS6B/fLOMMJGsR3vYNfzA/7bZSwciQNqQUoXVChm55YUhsXRVmE/RyTakTIMDtd+6sOMGhl4SAC6b9XVwv/KbMvRzxEpkVYU8Nf1k7xlpS+mshvNpqfxQ==",
  "392ce2faa5550330b7f28bb250ef40e4722291f25779250f1c9c643ca7ef0137": "pFZlGu/P3IFXtPsZ2pvgiAaDfxpQb1ww5fC6aaTGYdeDpiSqr6TwnV3zg30lzIxpRPG576WKc7s39F2Gr4scNIpg8d5hu1JxVWLeFZDXeSwfjuBhpW89vEiFs37CwiSignu22cQzfr0Wqh/tzkibUpdZtvX7ufyE4mTfc+Tjbed+J/vqPTGa8+15X153lo+YizRlLAXuLB057Ji6GA==",
  f830fdef7dacb5f1130946eea759851af97030da63d4a0f6a03748d5595e71f5,
  a2e2285c7697524358777e03b8ba15eb34bbccbd6ef30151646237120ab9bb14,
  "6e43c90175784913c8eb9dc18e91e4dec715c362fbd5ec8b7633f6a4ce388162": "fGwWwzhsxy8vlYt9PAaD8SzCnbQdhVbYcaa8/4pJguHmyRamJoZvxM+uxYeqscBMMEztxcAUd8wFGs7419IfyQTMzgSzrc5CtMrPZQFrQ90tPElonK84Qbr1/1dwdoSksOVQxa0sYBDnJVBPTZx2I5SA5Goqnd5rCtbJIZ2/OpR+6ekdw//BX5KWZVgbHaShEYe8uRL1vaivqsRzjg==",
  "06287e4cfec1316a5a24ea1c67bce48ab66a1c32978b8a57fd5dc098534cde3d": "VUItt453d5LiVQDqNBI7i8yWWayMKFGOWhG0DnIENH10UXNaZDD6u6/Bu2UTi8xpaoJnC9dJi65b71NFD0G7bjYvuLobLIkOeQ+1qhfQMWvPxCrk+GxacgvgOtL8xRsljbuPbAm0gpyj8VU0mY7ErV/H4PH0VHJZVV04pUXg4z21DhJmopq4YykXaioYeygds2YAiERajOBFEUWHsg==",
  "79cbcb7e0e7e70470731df73700a9e12a73b3d498233d46ea50289adaff96a8f": "/s4M6GyoKNoVXTQ9FhsTHXInvdVoZ7NT2XbC2+IQIdtOnX3/w1H3gAFj6JFMVOdzEOApQZiZGiMXpIiVxEaOvVTvbFtCSMvJt1Zo4iyF5PDYJFGEyABgIreyvsRxIwIeOftE0Eowu01NzLrj1gIjw77zGSxFu6okPnD1jlO1rJBOYFGket+Lhe2Omr3IP1ZABz55wtBSIB2Lc6CkwA==",
  "27c4bdbd01798508be08603ca7ad495e28c0f08c44c11ee9631212a4b59045bc": "905m0AmXBJlEX4dKcnFdrUH3+f+/Esa5OpfhUk6nwBTa3ASgPJ7YdNsWnfzERCn4z9AHJcvfpil8ALW9OiawN6yiMiK4JO/RcVF+gYuxXRQ1RjGp9l4mIXmRgz4xfl4QI16h7ZtP0s75Qnj7AL0hEN3FvQyYVBvwqKYaoOECZku2UHOHWpoZVa0m9bVxpzzyR3fmQGQUijeT8txs3A==",
  "904321e05f6ded09f6c3b827f8c6755585fa31e3766f0bd3a10b6fce2d090185": "iurc5HoxP50MWhON22pu0F5Ihaoyrw8BPU6CjkD2yaZJH9VFzU8ox6KUF25KEKN8QoB+vIYxepHiqXTH35VEMDcur+D7nE0vp80lCCCZN3ykySpXknkk2uZfUi5CvFah9ndQBme+Yj97xD6Z6AhMOSpFQaZH55MTBk+mwhPnI8cfbZC2x2sUgDFi+2hTSRqymyrdxabCq7bwoMCzig==",
  "2e0ee51e139955ccd77496beccdc1cf25cad135d1b3d8e867d046253cf5ae671": "NGzgIcwPc7jAFxmgigDEZXmRyYmdrFg3xnquXVlO+Ch1bM+E/bWVqQ7jkrwiYa5tGvW4SVxtG+f7ieQCnOBqCbSJIm93srlcvSwd5Kby/+KwKlZXhZ3yJsZd7didUSnz1yk/tVyAllclCkAS0mdpF+g2GEYTAYcfE39FLxTt8BiWtke1qO5D+IqjNIXvRvRU+7ylBmF8ZAwPNhbGOQ==",
  "756cb0ac1584d55adcabb764036e130ddca7ceb0af3550ed53470adbc4ea7244": "PtkY6OZI9KEKVF5x+kOIV9aeLwgnu7Y/JeBGXVMboA9XcG934IQhWEJA4Gsl9j0/7ZTKJYaXKB5xKeV/e5vW+bHD59CmIkEvojGJcNCbjAhnb6IhEfloTQ/aTXeWfBelXKzuXVQqFcU+qf/ne84fchdssDHwt1GUEMkUE4MeYnRUYgihnrTUaZVAPvw1ql4AXr4tn/OvmfH2gVBWCw==",
  "87e904a1fee7f839581472e8b5a95a7ba6249e96436a68d2c19a27d67bd3e8f6": "x3U0PecYxQqhveP8G69d1rB08BDTQbzI/GyGw89BgraNQf6xx/QI17Ba2qzDUP92UTaRIrLylJ/92ulkC6mqXA53yeZeSIfE/Ybu79CWFSjIL5P2qpZ3Qtaw2SbVIoDQPGFb91eonx9PdCFf5GJm+Rx7IhZgGy3FTv9Jagln+3+pkeqgGkpiUmnU0wRaUOTWnrtiumlF+uMNAPJj5Q==",
  "0f84d1020d04fc1657d9b238936b104303d0a5de12664c22bcb029cfc88741a7": "UM4T+2YFDw1YMnlcL0gvCxi5iUPY3AfDDKuaHljO3XQEMET7jWYF8+w6RlA+lz2eFqTxZ50bgeDTZKoohsnDkP7JhAMrKjVaPlQejWcCtiX0xOdiDjZFh9UyVkf1isnLDZDXYPD1fQh8cCxhTMrh3xQEDJlaYS9BS917QvuxoLDNXybhpfxYaNuuffZm57Pv7EHpYGZpph22UTlv/w==",
  dfd99886aa468ebcf6f30921e95042266137016eabdcc8578bfa1e7ad14a355e,
  "90874b2323d4238882b814909880cc8260f6c21f8683f8c7ee89ebcfb8a5cb5a": "Bp/A+aN4lieCuMp8whLDjvQP8niSyTbYU+/lmDv+4ZEXZKFnGCwABeycfFYi1z/WS2tawoBNXtVCWdsuix/n9vPm4fvLxguDWlI7DdmjlFFtxLTv30Xg16bKR18OJG5AXEN/cxOp4lEMZpLlPouXUFRpIQSP9u57vO7CBWT1NmesqNpVb02wTRiXYDLjNzpZg6Qa7fwcas93YrZ+cw==",
  b0fae542c2f4bf264ec4140a09f0b1828472fe8638685137c187187824caaa6b,
  "97151ac957cec604b4baacd8bfba84ac1409ca73e1c580b1fa2ef7fb98595f79": "m3XuFPeZJzuUwYq0qYDWabUGGMtqBsoJjGCvp2eoCsHaYijWlG2NqKeNn2GiRlbvCiqQdofzhJw1AAAtr2/p6c1dtJt1FPkJVglHPt4HmmupeR0DjtdQff5FcyyRcinPysL0wQBB2/EQQm40mTUQUSzYt0lg99pxlIOFec3V1ZYSG1qwIzaSRCBNN57vho2z98fHUNaDqa/jG9Kzdw==",
  af511c2efb1cdbe0761e1cb77fa76e1e891f1c95f89356c55203648bfb6a0d83,
  "7212c914dee2a0a385b8d6cd818d96f43cfb069321b65da9e064ee5a8bf208e8": "9GQl+1XmIHmWR9pucShrrkP2l83FGE8nX0J2vzMgcMi5uGNF4TMdRQSYeaP3DEmnUWkvBMm5akCyc7OreYnE0oPBz9U6iFeHamdcg0VhzUvRsnE6M5mxRIh5sdpCA/FNUPMnANrFatdiZRwDQpsyHd/L5JxJYgJFTa6I47fWK559HQwrlA5tDRom+YlOyfdLm0GDT/BScRj85C5NYA==",
  b7e8889037f6899b8c5afa88cd308395f5c1b78d10a250a0e3adb034a3c322e3,
  "3f513841aa1aa9608d4966f067372b8464013e2d6e72a9ec18e1af1ead050b50": "lLw8Rq4MaZ6Nq0PrWCD9e/qPdHBK6KVCpyPm0hpolX77p2rLnAqqcAQLy7RNwv6YaQjqj8c5BybkXwWlcb+OJr3y89EVHbensn+GNJC6nY5l0qF2JIEBnQSyIwNtIYXKgGCGJNwGBFAE96r+k+8AJYZTD/kMGLqxRDn6xf8u+wy5es58llM5RI5N+UzDnEYsVIX+o4o3ydXQqea3xw==",
  c92a834ead590e12df3b71bbc0a80fa0019da2906f40922953f3908a7e83e5b2,
  "00560282f66452771770c5f4dcc541647d28afe2dd102928a154c236528b444d": "0rkajVHq/nzNiCgqeyHMPfy2hRSF2YbDYw9yn/vr4S8GOF6iHTDbrUg6z9KWc5FbW5Ji7RUVZ224VVAfMZSivACBEAGfEYDwLaE7kg5fFnVvPrGgUkMX4Gce/Z81G7ZBijgFxwH9FavCTAOpflqngTrJWo86WzzVOsvmDqPK/4g3PKdDtO61dmR5NwhqaZzc6s3FoUrOrZfRZwhaiw==",
  a318160936efef222e172389ed2d836028e467b6bb24680594873ed3cf594d83,
  "68420561c4c3717ebbd9059b08eba15baad2ac80e9cadc252e4aa49e00104a0a": "6b6YvOB4pUuFasBXUxoHWEV7d4mbnvke7CvU0e4WcM43T4A7yTOSkiKYd7EyL8BYEPsv5j71OVVxt1NPU1oa4Dd9x65O0qKY24ImdcRDnh5fMVrLMqvwdzNmc4PzQoI4ppqi+b1sY5zmn2XxosnemQfBlxe6DSN7+TlZGG1EFBL3TXVA6nYuKweCLfxlpONK+jkt1cb+fIupUfBpVA==",
  f747cfc86fd808c9d22b4d03e98d3b12cf6bb7ff3c836780fce348b65981dd2e,
  "5a49ce2e36afe7b45b5873bb726ac2e7c1b891779970b489eba6035e1c2fec58": "gikA8KywTXQtWQtWoIZ1UyQ3q0PblRhMREungxGDEnHSlaKWCnWtV5NxbYH4UdGU69xr89iLBZPVQKoDZcTY2EfiLBTHUHNiCnPJ5ZqzR9uYwbgzz1O6dK+8wR9Gw4tWhRZPVRJfw7GHAGqqyXcIxGIo6nIOsjBbMvgnEkE9TXQvIJ3H59pDOhB9ggAJOXMIR99ftkyGTywZhgp/jw==",
  "1410ffbfb445d3ec02f04f150acd30fda2a8b96a3a4d7a95611bcc5962ef0a3c": "4D9crT49QR7d+csg5huNdExHfO75AMz6b6SsHzUZUws8gspXQL1Ky/0deKbLL3gl3M3svoZUHbP/7g23y8HLAh+OFG6gkxNxlGM4RgIDg9S8nLu8dzmkXQCRjylXtw3j9qOetX2QcaT1WkB/yHbvK3GBo3YA+UnzBJL+n/1W9DGeFjbolppQ+jab5B3dY5d35zYlM/YnKRnwgk9mfw==",
  a3f749e318f7f22f697494cf8a8736be805eda67a76510e1c42d30d69fc7baf1,
  "6a87587990fefd0ba625b27d01fd936cf8c01eea9d87d3d8ea5ab80ff36b350e": "rUe0CvUtcBMkoMLPqVM3KW1kXhBHaSPzLd9so/NI96Q8In43jQlZqHPvLi8lLO439HYawGchC9PlcpmKfxaJgEMxb6cPoB68kw2PyiQEaU3OXE+SNS/r2aprCr4Uq2DSKroJ0V+RYCJqqbp/44YuAZBmqaTcBT7cTOMqhmefu/n8KH993hBDuL99y3aHZHSMG3+7iG/KtYI4NYshCA==",
  "6865fa910ffa1084923e325f746a661ff8f478e3d14f5dd530a2202fbc9e4877": "dwcH5J6+deuIL3tT4yzNLi0azaCXBhA5SROnQcOZtSMArDbtBgmY6+jxXPUKlPbXf++Myjay2MVlXlK6LN0yCkB0EDGJOyZFOEie1iUViZ0dQpELutfJLEd3ZnE2JUNHufH24mE6gR3rxPhsaRHVs/Vx3h+7UTz1QZZ68VgxtSxBeu1rS1hXdjDTc0dHWSX9BzNhmnIH3w/JP19a0A==",
  "7a85c9081eeb9248653b5a2c8058f96029aec85228d3097c56ad4519b15af0ff": "uQPMhgUzz1nOxL9JHwI/rF3+QiDNxOaNaob9QjJrLmMk3aCzu6qsF82rlHWpGn8kyPy2k5DGfKGaZb98jsAPtBvUv8pc73FLrHcTXhsWX+EvmbX8DeMedWNLr8zqnhcyx6szi4sRUsMsWgtlE2RDFVctm504JpFiDlZtpb+qAaIUz4WfJMYni33ozu9kNfOQPlIiHlBur5AZRGgUgw==",
  "7aac2e191ee375c2ecc10d08829509541e5b918c024b5d240089f3149a5c6865": "grUw7ZKkRvhw40+lsJmcsaLJuUpEZNKb8nSsvtA1sv2P1jQRTfe8VUxVRtffwFNq1soC1MfzGmUbqtD7G0VgTz/pozNlphtBsjsMoivbTgzWf+ksvKMdqYRRgvdfsLspKtMAkdBncY8P680toBoo7tAWKNO+vHZQ7f/h9cZcJ1ASMBvS5rZ6RiiD8BGOFuzm4uXAdEginBGvaTvzhQ==",
  "7515fd211e928e7bd5895b84273bd2e523946ccadbc5181617c38e9d2de958fb": "xNHg9+YUcA/AE/kTn0CCcR0dW7QDHQcTUYRQCbbx7IcP/sovgzKrcPZOFMI+pogawTQR7NV+6V+BN14fXEY92ssrRM8vLiY2PgaC8V2ioddprOhbeH9iEkKNjOEp+0v2aiUxoDkIsuMIQPrN1WlISx1anTgRNZJcqZOApcSVLWfpmgYA/sEIv9AyGtAMZGB3ElbFfZWMXXmqx+fxUQ==",
  "8ec34859eee69de81edd14efe40b9108d9dffa773a73e9c0315c4abb39a20baf": "W15ctL51dCXc0bIG6bX48Hy6kfED8igqQQ4yH+H1luKLRCh19GPH+N55Jw2RIUpHhC2XmHHYYp2LxkLg89fFuS4OUUOSzRJCKRQsIVDSZfCPN+oArWkmzbi8mXWpuOMnqaJXgUmVOvvqaFQU3gkntjN2euwtUK/NutPMdnQytltRAmTjjcrkBMmixAnLVlqd06UbyPbH0Msgty+3OA==",
  b96cc30f1b8c6e32292ba32e7bf0005743ab7985e71166befdd86a71479079d7,
  "3494b4f182ca8a10f1546cba42a423eee135c02f1f9ca97267a1b91f02e2390c": "A9kVAo2nOr6RWpn7Tj3fkCeew465N2mRymLXuyzhhuNaiuBU1Viu8vkTo9T6T7M+T5wEy4CshvLXRpJ+VShyUdqQN9WONGazbcyri/UHiPjEMW67rMzX6lNg/BWVtXHjXUqXIYrhiG6SrX3T6SkN3ycdrrYVYc6mZnIzHqaXKrV8n8sVV3uyjdTqcKrxlYEqbSzI73el5Q65sHfDbA==",
  "52ee024e0a0bce0d79ab8fa26ee43d65f6ea6a03b66441dac6b80fddb6e0af10": "tAWqPaGpsV5snIMKPldn7Ld/bwiKp05TQcdIlWVs/8hpvJKRh1vbtxJI4a55o2mXEZ99syZJhadTG7s9DV4DJSzSX5VvmThlpuO/LnKrYh54Q06Zk4vmN+3oO4dNKrblzHS/gy2rVVdY1Yi5nDdxzfe1hN+X9ag9cU7UUPoer3uMBnmeXVh5BM49PxWY9LIIeyIGCDIWx6PbTMhW1w==",
  "50e66c79963bb15c659281f6acbdd9bf7c5caa1b997ab75fd8283199afcc2bbd": "GfwVOv5QUNyisAlVwxSYkglPUqgfpMbDwmoCJrXAxO2V1rs6uEZl2LtjRYPHi/J/ghNnWXBmukTDjZUMp4FbgBQ1OdmYjVFemc6dDZm47iOmyKF2+oZgjaupoOxL1YDmxN2muk/wvq1ABRwKEAAQ4siDKO6cS3Ir1ntMGA3lriwGs4sbBhEGu787tYWJMLHo6YXQ4/rNLDX9l0tRmw==",
  dbb51fa137791d8e164b1d244e60f28e9049e43aefacf7a425f57572b7eaf988,
  "5b28e68f78ed1c374e28c4bbe8557c73226ca9f0464bede8c2662cc55656fa5c": "0hdYWBPI9cUejqDB585JI4GpglX+0r2u+//guW9QuBQ+GvDT7GH/1EJiQn156vyHyb+ea4V1eHlbrfIe5Pnp2cyOq46oincDb8QbhCdB5iunYdH3tdH7SpTCSduH42JKTFUmaXBzVvp95WeE6ynQQ6wIKGBg5hokVs7OTELuos1BxGsHZunoYrYcJh0XjQSyCEcfjRgS8pHSj6KkKw==",
  "3d618736a86ca46a92e70ff5b34680560cf79e57a8ec0c64670de37988d1a9d6": "d8L6QW0/TYecxNDjYiFI12Nd6zlOiOO8A84zGehIi/d3xIWZIfNv1Cr/CPB7/eg+ovv4Fvfoe6+7WX6Xt2Vn5wO0Y9aQ59BvBMWivSN4nNG5R2bTUpiJ9T6KVPm3NsI+HwqEsmBRqS6+gZips61e7okzHTMbFjN0F/1GE2jKjC7VlvjcZy0YpboTSB/uyQyPM2s1l8ooGtlD0UEM5A==",
  "985ffc91a2e6f9fb900da09d515518179cf90cc072d9ba92d04234abdab1c241": "IZHu8MWBAfhDVJLWOoq0anuF58eEmfE2nsgqB/CRhtaY4YG+3cVO2eKeCdSE9N9cdrNfIubSS+9e4wJ23atT1jOVHbwIMR0N0xk6fmhlCuQqoMSUYy2LygP56iBqbL67Q8pLVEO2lU/2CETB4bBiVZTTwWhpGv+xeEOIbE9n+hHFtGlRGzMrR0SZdFXZDGgz12rQQCv7M4P7KnrMJw==",
  "1b1dca940c4a044f00aa1997f59f2a7db0a5fd9ccf521a90d0503439bca0fbb9": "O/YoPBIzKHcbsvMjbG5lVtrDL+p2niOWPjALiIprRtoyh/PbhMifGFcO6Mb4wd7j5O9/xjkUB7Z0pMr1Hsojf5eQ/K1OovEnzIdlUFTTgRJ7jxoEsWvDHaIQVt35dWMNKTIwu1127zirV/XBI29seifI2N0JFZrR5p8OAO9gxppko1VgZEbpHok53K993/V8w9jgD/VGTRaYGO72gQ==",
  a4c82233488b7687cfb1144f4a57048192cda142cd6564330104bb03258b1a28,
  "88e0a58eadc22db011ba57b3fc481444caa917215085b55312dcad87f442aa26": "c51oaEKR6yGh0Ko5xBjf8y6odUlhDiYnNTngr6t1juFrMKokL+rJANV4EjsrHq9L2l/sVxVH7euqMC6CUniRmXcGvefEjIS/Agp4Dd9uskpZzpOlMeAR6Aa9bUB/NUJq7tcKsBeG5w/gkVh80sZLaYlEyppHbd3LbOoSj5alLe1jg44fmASh28ob/ZQ0E01u1JI6Sp7OvjejI4EgWg==",
  d41a915f7ebc18a9ec738194d6eaaf66dcd26f20e9731a28d5903d6192d6f68f,
  a1804b5e808f36ded5461f80634fcd95a318ddcf11b6be107c3512bf1ca0d4c7,
  "68016e07ad46d98295183b293ba744cd46fcd92961e67a7d3e67a0eb6904ec1b": "2mLtEl6TEPsuT+SifRY/GyHpWm9Db1J/+DJ5Te/4V5bNrKPdR6aWnjdGZjtZvlYdrtYkaJZhm0kyNbgyj2NeYBYxHn9Ck4LBMVrJKFU2CbGqUP+gtOrR6dTWQ6M6wCigiIlIFUY+Q1zgHbZc6AJGyoeC1fw4BkTtF2z70Qv591ODjhn1fFg3qTAbpSQJ0JdpNLgmh3vQjZpCoX7UMQ==",
  b60af2da0abe38d5cab66cb46d9f91b2fd31f8c4ecf2a7baeb3a524596ed2a00,
  d74a5ff0b59519760e632cdba1b3ef5c3e0f80aff0b2b0a81a0ce5c60518f475,
  "900c0ac318b34889d7b84381db485e6d2a829850e663aafd54e95650cd827a85": "MdWFUjgJxSJpaODJA9MwwkkEbVavEqT6IXfby17w7JOtjztDRxFF8oQrB96ASq1mkLQAXknoRQocmndgmYyOgfiNcJhyIIxA/OeIc/tohvN/8kUsw4JsOI2oD63MKJzusCNIqeMV1yflPBWu9VoQ/E2i4FQhng2F226EJefYyLeHqwlXEtEadTUvTpWFInEfKZrpPa6edvW9KWSMgg==",
  cdfd5d99c8e473ca03597fae164ec309ebcdd035effaadecebbdcb7ecdba5e56,
  "282c150a1f2c7945724df895e007dc1c6239e1ce36befbd0936ec3f696a4c1b0": "slQ7IQIl0s2xb+LKkWGlqTOCIGzc+Gzl0aetYkkvuSViIwUVYsE6Xij0dnx/VgbJ0euevkQ1Jd4lfYvSsTVXvih+dyvIa5ShL/DJqmZZ7j+aQYmz4ByndAh5dBLeuITREd5/p4c40S1ZcQ18D5mLYZZB1FXmCvub13fB04uwcTehEmT5/hxs4P1UpG3YP41SsUtusEyQXRmi0dwvfw==",
  "7c738682e5acb34d9b50f7aefe77a5d9e9f6a86f44bb7b80028bef6927193396": "3WbzHMVDaqDAWWj+lrLmiNuaOpGMekPZIpg2yqsGkS465voXHJBqsuLrSlIjjsqDHz3sJrrU1X/M2G6oBswdLdYTqcgMZWTWtHX5+5ATASTz/jN9k8DPM6VBufxdrgn5Da2Nv7L30ZmA5YvDdbSquTaaGOYXPZK6OJTBYQDubTf8thhgxV5r12Oc73OjqVMiQobD0qS+KOhAj/AJvA==",
  "0781e7837d6d979861d6641603b635c4d9c01daa85df30ef6177d03ac6b203f3": "nbIoPj9PnBkN1FJx73S+0fLqPkvfv8+pFzE6j9uu4ywwAsL2yOAR67FKTE1tIoE4DeMdVr3THUuedf0DMbOu3llf/eaI49UYHaVYQsgp8AEU/ZraJJixOID+0q7dIyNwu09KYittngBf80k5k/w3Bk+kMDd7PJ1As7YslYfwK4Z1eqyAsHeILDc8kUjo3aN0vj8+W8kTywDOsO32BA==",
  eab688556ac17179fcd695583fc579d448b2392d7fd4090682c464bf79085085,
  "8c0659f03b1c30c7369d2943fb95584a53bb7da04e41dc709b540c3fe84f15e5": "wg16ZluORINF+aQDbYPlsyEMBkQN01/xGZB1jqLU0Wab93OgjAsZ3LOv7D9l/MrvuFTlMkiQBqu2Y9StVl4vJAkq9Fj/GhqQZd2SI8lQL+UTIABy/6bPF8cnNZ4RvUsmgrN0s5GNQsiNAOq/qiTxk+vltG/y+rq6e8lqATPafN/WaDteYFXB1q5AhOl54Vd/2/Eeq8UPlsTFQwlm4Q==",
  b4cfc2034cb2e498ea061e8fb0844e0430faa7a45fd0798add3954d0a675379c,
  "1ad285e4a74b709ac0a43252060861b58948e46d2550e9ee652f4ff3cbf134b0": "D/Rmk5ZuMvwVaIPmKz+sxQzH1SLJy0zt/W27JRhErsFQN1mDgtDGnPY+Mqa23NsPgqZXQqd7Mh0AoHvWClRVupCUoeh4KKhwUHls1iWCZW9WT8qXRWICnGV8GbhK1seY+XwqBH+mGGWAX/V6L1F80Dk2SvjK+5FJHcORX2jJ8+OX6DbmcwFOkjg1H8S8v9JT4BSLFNiv7rRECnuh/Q==",
  "9f5608c00923a8bdd13d06baeebd04b7fd86a4cf7223ede1ad241ea72599cfcd": "E/ynWZ4rWabrDVahnIx8HdXOUNZhuPxK5tiAuXlwtaWRykjY6lOlcdVe2UzwB35jidnYa3kKsvr60uQgeY0glanFdv1XvtqGigywFIfsefTiuwi6wfOd1kYwxCAMeersseKjWq+dEUQ0fLB5XLtfhSHDUkJFhjup92IzsRKc6R3cHNm7wNjU9U8emXiV+SkB3fEEsuuKMP96iOGIyg==",
  "001e9e41f66c962bc26660014578033cc014f5d64b10629bcc7346c29152d132": "LjyQaSvKFw7+Zb3FNEqeoNOWOimJDgOv2a6qnUHBRKXDCza51sNJOo3ZJQdn9gcznAmIpavhhirL8qlTgqJrIJx4COzpSuGCnu5Gmh71HJjlvztY5nTZ6u6qLp0gb3Mqg0S6aCmvo5x3/3ESZiFcXZ6xbRYqXHqY4BpAsfE7m5GAA+yeuw+DKKlZY4LFUvsRqTmFjOQ7g6FwFuUs0A==",
  d2de8b3ce5ff1eac9431d249956f06177ed27223c525b0991e7271cc3da43aaa,
  "1bf0e9d70604cd69345d295fb170161b587f009922bcc713a3ba94692c75fcc0": "lCMG/PoPHAPIssfyrJ6ANtkcxFsxFEo5Ow/HoUgmhl9KHVq7KREBat2rGhcOC83nPs+VOS7R7MjqovHHCrJNHGZQMlMMez2uiUF5yu6majKFdPjYELLRqN9zH+RE+q0Ti4AKFKpYuiwxuRdcT9SlubNEUnmGhOpBh9pwLxARi4gAmUEXiGa4t/CzHMn5blLumLIRwcUWUViuXt2S0g==",
  dd9d5bca2fa976fed8dfbd6ed1f0b731b7594900aa0260a68b32d245a00efd56,
  c6bfc0ca3c3233de7554dd6581911d15a623178a7131bd7cd7b62895eb88323c,
  "479f3cffbe8aba952fe5bdcaa1c6fd9103235b3a1bc68734db42d2357a04b2b4": "KcjQo0RrUWnUfLInbwx0GYjg1mXQvejJMaUR6z0SwnFt7JEVDgEmbnScY6ili0EtH3xREDkKjjs9lgzeWbWI5PWWDSGo48AVKdgpCk8xkOmIw666eOh3iD1MyEPgtxdtkYcs6HxJbr1N+NyIIT5cTA45I94dnyrEovsQubJqOpYMDUdV5q0X9KeoEfd9VbegphnAY4lyTfxrkT5wtA==",
  d35ae462910efb96510d99885b3dab5f23f8f4fcb1c63f1f099c0190303e20c7,
  b4cbdf199bc82ab59ad15c7ee1aaa2acdfe89186938b8cda2ae80ea8a4d7f766,
  "5679ccaafac2f5ce33ab2a1dea4f3593f45532365850574b8c78d949fd04946f": "J5kafjOhT5fVYwMfVlchtlBQlrXnCir+DG4kRPmW4WRUSbbAZ3tnxRBok2Xyc5aLwqPb0OLCQzfLKkbiR+A2mUAG43jC6bhZVJ6RncizDLLs9QivtvECERM2xZVudhrHBebyr9usaLYS7hy4AmQWIqKT6IN6ohG04g6iVJOKMWBwgLMY/aG0jkrqC0KFb2hqLZ2ecOO/eHQ7KHoLAw==",
  aac46c418144d9df97aa654d35e9d4e2a4c1ab2b029612d8e73d0f4c3b319e2c,
  "20aa7e6a6efb6db90eab052f2670cdf6c174c86ffe99780a057b09402f98253c": "UDF2OIQKSEDmGmLuF0GCV+0k3RuJ7cbPGwOjPLrKuf01aGQ3110CwauQRg1i2jV/WZRfZb93zIjtlN48Ul2PTMNpGk9ZxlF4OScUDmZOlzaiMkgUAFU01jmQDYkWXtdmQ35f4R9Gye5W3AH85mD2Uw+ZsUyE5YMA0/Wy0zrF9kaBgWhp1V0HjGw7ZTilEpIjeFfjn9PiIoA0KJFRIw==",
  "09f06e679cfba5b682d0e29b8611d8fd5cd4cd167724e06874143c2d6e24f772": "1I5B6IL2YmMmtJ3BDTDgM8ea10bO3gIk3spRYhCmHhR5O5pmpeqELLbEbUJIkcGHUPoyZGTDDVN9rG2GpXYGYNGXkM/UWGC2pvTxg/AU63oLCRJBtOgQuqa+/4MM/wIzHFE7edet+WFvYNyRTbLmbnuMU9J4H06aqxs5uZqDMbHNukqJy0S31y4yHMDaIfIR81Xi5YVvcDn/HtwE0g==",
  "2fc846caa6d624bedb6b6cac62bc0b0792dcfe80eebc77288f043c622d42407f": "wqRg6+0X+HuAps8yTP9/WZlHeCXZLTbSOd1j09CZ6Y8vjj2ScGB4IzFqt37e1nzG66/ims6+ssFc3J7yU7dC1qhZnUpUcxiilsX4l9xIyEtQit8QKYaO3cLl/R2oTOvVDy5K4Eg5BengflYm0Z2nemrYdZ6MJ5XFoetyBH05n6lcsTcZWALZoDH85ccS3jQVwFba/YEtHXNrpWBv+g==",
  dd426a0bf3ddadbce1c1cecda2d43d0ad7b077d9b7fa23e706645a0bb5e3aea8,
  "1bc7ac44c2878be93f18bc1505c440a69b47075220c31592201a2b12d1c6542e": "Y+EcE/oRH+ZNevwoa24fJ5oPDkQXy710Eb3aUxNgKeN4sis3nfFGkAwbDcRnGjwaiE20LKcE2Mm9QF7TFAwajAY+1QSaBYZvGlaA1y2HWXVo5DnA5jSIRpupyFmMpfAU7T9nS26jYs8oNCFcSNyTOyYB6a1tXFgPE6pGqT4bIqP8Btw7Mi1qzd9qHM0He3yCpo8/ReVIotU9P1BMYw==",
  "5f8073723e1293f0329618b2abb9a55fd0fbe49922f64ae103fe696eec9265a6": "jYxC16bE7d6wqSgNnZoK61oGM0dB0BA8acPHldr8+RoZ2U+Wgy1IN6iVAr3s+bXRHd7z3/QPs1Ogj/bXKO1OU68oOorBoOWBgLDn7SCaq2UZIueQ7f1QoS9FkzcB4ooaMmT4MUH8rt1k/NcFYeojrc5CJA+1JIcyCXV9eXHe+ULfMo8JPFfWCtjud1yffNDRqZBzff9+zgzIASvEUQ==",
  cb94ae4f6113298f29ca7943874128b7a7c784b451fed63861e6e9db79da8ccd,
  "90ded389ad78100c8dc470ef25516165d70e376efbb681e3b7047c5cdf15354e": "YrqEwXiPSDiLYw8iDuiRP5F04W+gfI7GWhHYqsO01OzVToHC6pOzvGr3qPyaVPtutvWSf0WB2L/RFSGK4wlBrsK8mf2ARRDgzMM7GENGFzPUrGGoD2QN/fOHM6+52W3UU+ltrrWvR12tquqp/tZ6IrK93VrLs9iEJl7oj5Y0Fvzg1LlNARAqz6IJoPy5d5suGJNyU2wI9SRe790qLA==",
  "4a36e761fd627fdb271d9c3cc88b5c79cd9cd8df7aa065e195d6dcf7cb2c42d5": "DiVaPEF7vuz95NEpkZQXDewp3Mj3lcRubA97SGGdwyhsd2eb+oZmIhaBTG3nS6SKSsGjVS1FpPW1zGmSaLAhxMAoA9qBRea8Jy/0+Evv/EFWZ1kDpAMPVk7Hms4PPJdpvcFiXjEa/yeDvLrvhRjatoRz1Lbq/VUqG+E6Yc2KU1j8jvlrPzdTVe4Htp4/5nymNyQOHlESqHNjM4Fycw==",
  "3a30d0833d7aad6b9d7f7d399e40eae942efd89718ea57e72d04babeb6e7eb72": "n0ZsdrETHTZaZDUG/tObjK9D6TVpU6kAy8CpJtZ0Ry2XjMN2T7cJFLoh6rkkMu0G+3pG+r8bkD3zIRv4b/a7qH+GZFJ5Q2G0Fzd0cAWSXTYe6GwKZwlXRlDzLyNYna2VnUec9iaKr+CMn4Th4CKXboTcs00Vd/k6Tw8D6CGTuAe2iqhmqTLbVG0PGh6or8hB6rWSCeFQJc0TKJTJCQ==",
  c4befb689b654642949dd43b28d0f175cfa646626e35f83650360b477b9f417f,
  "1b2291de15719c27d9777392058081fdfe42f12b8ba8b4e6d9e5c23f98d2f8e4": "i2rwe7A5SlDeEkD+BnTojV0iXFzKXP+/gpB+W+YnZDpkbV0XxsI7UzzkefKB9lCYIDYKZ9q/I5hWxJkLlyaA+Hg+kiNcWtYQnRYNXd3eImS/cVkRvp6sp44vSd1U7WC0u/lP8uNlGxNG2CRG+ccZErigfA+NJX1SMok3E/TbW+ZSt+0uMG/GEiTAkC6Xy+vqzlqU7p0jfqLIEMAusw==",
  c4f8ff3142a1ca8eab0f3c67d3cf81633d97a7255b66a6b306b3b292f7082c16,
  "014d6aa7f1a6655cc1e8923cf7909014d3c82b04f2cf9965963d7371d98d3efd": "mI3BECHBrOk3Ku9dogm4faOrnXUSJ7K/rlVqi1UBgjwm2jMC0rqUTfipAdVtaYVaWFOiLKeBT733ulyHkMsgsH3F3IZ4LHL7PS5PSRfkSUdjylkbRRP4uBJ8gYrcwIdXxBYiNuW/A6v2NTxpSYx0IPErDSmrZgfGSIqLJt1BMv1Anbl0+5R7Pf8mu+E9eTgIJZriDvX7Gn+YHQaL6A==",
  "2db17b6e9c8e33fa9eb28d51ee59a8481e6865116fbd15ae29b4ab3684c81ed2": "O2RXHNB9GKETHvpgEd+L3OP40uZa/LQH+joU0mEikrw5QiWQLcGZrVUxaR4eDrX5kIYC7Xc4bBHahyjGs6OT9rMCaRANW+oTe9+fwvtVDO/U0q5+cquOe6eKY2fqiZIHDk7i99f0wCU2Wc6BPWvs/+gV6+MTgm93EUzQpeiC/ad3Z2nYapfERbt12yMWSbQPKryHYYkG6xY1dY4VPg==",
  d5be2eb891898ce503a3fee492dbd7bd3e089ccf6a12f58545e066e02c9201de,
  babc3ad6f7faa4337822d81a4f953603d274ff87f7d32f21d39453946f695a33,
  "86c756700f482a95fd05982e9163fd56818da66b712eb3bc58f2286cc4635c42": "+sULmIEmrsoy9JjEeDuY11+XPBLJW1clIiYZyiI/H/qu/joQmJT+N/cCbfpA7tNbwbM0CarmnuXXxaum49uVmyz/oVNpCZINXhp5Xv53bQEtm6QxBhbcq/3CalrXb8NffPAslfqY6DX0V3+LmCQyRmLsq0YFjxB6BYmh8U28Tg1RHHlpEY8JwssiRFKYZyt0vlCcpMNnoRQsKPG9jw==",
  "2a9f7d51cb80bbd9349b34736cd4f3f7ce293a68d1d7a70ca695d7b12c121500": "nonjvRZFuKw5OhiVZn4ykeIcO4NWgu6DHcXxJWvml5QKXc/ox2QRveNBSf9b583ZlGGVDzzQkvnXScU0ij2qVJXNLTIFNhHKLLJWL9y+9vb04ylhOC6zAz31visHU1lohAqCDAX9L+z7FTFjiiY38qro6MUkP7APSKvIxh2moR5C4fyGRkBuh5IqUr6WMxlEEsAu5b5MzonPZ9EeBg==",
  "1ef4117dd349cfaf66af73dcd9f9a11fe76ceaad6e654daa27df395078ca6da7": "WZCpzLrmt5UXBW7+DdSUjO9xdlLZ5xTIKT4Ld6B9oloZ3QJVLPjX4dIoc3i6t4GtnAiLhQPRjXX5ojwk+zIRJtsTvlXl7BdgDSHpFkOkDvmE9yUO8lr2Ve2+t13T+FbkxjeJvMyRcgpLgDL/Lw4SQHxR8ybG6CpZz8OdCH2Ui+bwWjNEUqLgbotqgKHnl6NsE94EIu2xmTXgLd1Fyw==",
  "9475ff1cce8b8df70950c170341bc1d4057eeb8bbef65c71cbd6cca3c8ecdfb0": "HnZeAVkLSEgIQ1h1Ecv7dRTqDQkvXYbxpS5QTP1gAB1VqZISnrjrpX1jxu+RZ+FCahYEcshsuXgYXoOhB2on7RGnq05f889CIoKDJOX2M8v3GOQHzC9KsyYyk/QR5Kz12MXETStXDRIvyH21HYIRVhep7bc2EVa20kz7CMQJXiDLcZo3S2c3sEsi4q6KiTStmMooYZ80xdYA0oryYA==",
  b444977c313d1b7abe63ac8f90a0cc91e7e8a8d21e2563a88f7fd91c699ea131,
  "917814e44cc5392cec2c3ab27365206a122c5b137cadb7ee9184d15303cbf361": "m9RGd4hXLPgTCeeitSS94HNQGPASNIC/rZb21dWddOkCH04RF2IMTwHQlGci6FbaY203PfTAIZyKfbN0CebJxAm5/1H0/CzxSjmNhRhseZe3eHOyi+Exuy2jYKEb3iCoZn3sgE1FbBJh8/Svh9UDKmoYMnBcnhPCvUFcizUC/9k9sG3e7Lz02GrcC8kPwisE/A5ZcXFTswWTFI2/hg==",
  c560be44a0d0333a30ddc7420aa69d94c3759af5a5bd681d7e379ac09b2e127d,
  bc1e1dcaacc0caea5b9e41b6fab4b3a75ffe5cfaa77d11e188b9b773e34d56d3,
  fd6418df1a792f141b8cf09edf1002ebdafb9131808205e2f6d120d571b68d70,
  d6712a38a507c5f5ae3ed2e9739728617921598dc8219011833c29a78f415b57,
  "4883a4fc0a58bb8cb318629e5cad073a82009597e65c39ef6aba733aa13c0196": "j5ZJd851qCVbrRijVTvGRUc8p1oDLmQwokOtkXUItk13NKBfGNqw8TUrdH7FC2QSAAJRKRZdxKfYH0KmqRQrI3PeMWq9AuSgHwOlkbcgV8AUtNAF6HujPHbDvB9BEsEGORahVFqeshv2QWZeo/E3pXlzUeNA46WxIXQZIhlp6Tj6oIgsTLF+WGLedVygpF9groN/ZBHm9V7Y/NU97g==",
  "7ad6547583d2918b5dece1889f9217079749f2679c204ff56d989ab1ca84ea2c": "h9BIKEgqiwE5aP5ZYrI/UC9JEUUusq4JMdLe/OyUAtX/k2/i3BF0wdSoIeTmdwB93MOSB49R9tEjk9J7plc4IWq1cG+NQOc7P4aodxkDT2EnoJldtZLArrJ5OuQ4Uax4XQFkVOV0lCcDdFYD9cQMpm6QsdCosf0pt2141Gy7Patkbh3LvxhC05HhGwg7zYeS5jJlE6a8HSQDP3DTbg==",
  "3dbdf9549a9a9f690a1e3d8d59b68b84b0710645bbd6a6fbdc790a91acba6267": "HPSVt5rDdZt4MoXWjkJEL4uGyVcsp+50FE43iRjHdU6ircGPj4cvPqN+eBAEleUUQ5X5j/B7MnT680AAw+yJkML4IH9zZ2YzzxZ5OZ8akTseyoI+nDbGOaHOUEHwS6pYvVzCuIwblH834kWxEPLEy/X1olYwLATo7zypoQlLdwdL0fY2gEwFdOd3RtajRaKZN8Tdsw/58ajpw0V8zg==",
  fe40789748aed2ebca44b00d6770149b63e38d7cb54a0b448191e42c95479ddc,
  c32c13c62afcd06a93827ee81be792d495201202902e2963b5e5a12a88a7b476,
  de43fb6b9fdee2ebac5e0f2cdd76830ba474bc87220de4bcb437a235fe4110b6,
  "77a4999d30bb1dd9f404c89419604312d53b56d2c53453ca09f05a1426cef5c0": "tGswe7pZv288029jAT/bzmzIBoR2IoI3066LXMT4y/l+cI8GLrwmGcVwp9iwyrpFaQq6o03w5fUj8DkkHYBDtzvWPAe2oFdjgrGgykCre5fGpFa/ZhqOiqWfUW6gKkTdXB+TuBVa0lC9T8S1qo3rKkVLr+b9btah1orBo+s0gt/w/2UgeQsw1U1YT4b1QNRXBEpIE5ywblfjMvw5Xg==",
  e3d9dd9f12f32b0f47ef5cf1f3f5f3c7d7901edaa467a901bae17d7373c5f99c,
  f398aa6f33ce64e804334f5a86c66230f805b56d57d1da80a7d97ff51255a0ff,
  e81732ac2470b86482c5ec2fb257f4cf9d58eb670ff60b5980a16352fe4ef79c,
  edd78aeedfe9509aa39f55e1deb145b31bb5baf398261e5175b55ac09f5d2958,
  "8297e30ed44413ac466c29d673fa1e39feec135b0cbef3b0c398a023354ba0a2": "3H+4XupoOUcriLe1O1EfCw9idw85Ksls8ld5vhyJH7F/bDiPnjeE9B7Wt5sNtQ5s5nTcs3UaQLOsZwNE3/7FjHY8LzfFweF9kOX7gYTGxk13SVo5xLVWB5I44HJWPqxHoYindNBDs23IYRinDT7N9m53TzVL39vVUQCQNDNr8M4lryOx9uRXrA1luO61+DQrvec5VI7sAF9y892Q6w==",
  "8a6efa749f8ba6d92c2d00d650b41755102524c0dd67f1d05e357db2b0a617c5": "t1ifa2lge1q9fN4ZXGVHAfO8wDfk5qBzJCrmDfyrMVXPNzpbfdAAG0DEcPgDH0msM61pVefEs6gt+SzDScBlg75x8/HNfGJiWxJaHewU+wSNVKnE3KdSshNDZjGKB2dLWCYjvH4vHSBvwKkPyoMEKcQRAQSwVqNFjVVID8RJKZ3DKrQQtp0HCKyarqCDkMHTSbC/oZqVCqO8aF/zDw==",
  cce8b1538c0c6b6031ad94e2314cf234b261b881adace341d4d9d9f93dac8bdd,
  "0dcd90047aa68588c15a5b7785482def3d921e5d61592ee969f6b35d2dda68b4": "l+AM0WtMJeTsMwTFSgLpUaI3F+aOD2WAEQl8Gz12dKLt6R86KRdQECA8hk6mnW4aof8wkMNi6ih3iS/afXBF13zJmo1n7iItp4cqNuEMUVlnn2PtgNSkyS0HX5WFlbdlsO6Np3mRGAcnp4vkZxd7UtZHnHjaDqnPe1N/HpsOhg/2PSTRiwPFKyNjGQle7B69Y8YcGxr317vI54+59A==",
  "834e7d59d0cf6b42b6ddd81ac32f52fcada8413f97be4cb011007ee0d24bcd18": "fMZArVZsm7YQK3ZaGr6JL3yJ2hhL0xWO/1sb9yre+6+uNjuE4PJwLWpfX0Epkl5G9339n2mpO3CvcSwjpfrhld1a/U7NFPlMsjMaCLQcazAiAKDFl8GxwHbysaLzOpZlnN++lec+Z9wO/8pP/fW/Ygytvwyl1wJJZI3KxXtgIGeRimb831pgxxKi72UF8WzQn8QbYCVah5w/SPo5uw==",
  "8616e90761eed9363b100bce84a650a398472c88505885b36ed724a07b8f16a6": "9HIsq6K+zJmFiTeEzTtwXAzaGX2zrkAsp46axOetcpMb+YcrGursQdTAAOHUsJrqtUA5V+rlZ0XfpsCNIb9MpgHBUmZqSpOzdkq+1Du3uCqlvAfDBZVNpcOet0XJqMamZjMY70UhgxapkuCkH+6MAHz6DCntjPV2EESTB+7oaUR9HiyixD7hHOr8xTaXMB28ru0tynFuvxcqGMSyXA==",
  "4f69f00a8b88b70c69d2f971d1bec76bd060613955559190c6f472fcbcd00d9f": "/efTlUuHFA574L6ZmG3GKOxz9aahaUvKqHiRgYue0gioC38Z5o4DL/p6L/GEBagygz2Rshdg5YVzSkcwdKHRf/GahiiRjxusTVs9PJmL6ucSZBSYs6i/akp+/kylwWF8TRiypiWVXARtxtDCbMCv/yl2dLfOze9SIjfuLra0hztJT14CftuDrFv9i4dFS5BoJYwcFVVBOJre0WvOnw==",
  "695318d1a7807385f2d7dc975ecbd96b171caa01e14aec025c0af553fb9b924f": "bbBP2vNnxNs5SlBM9unIghaQ0/ffSBCHZq5c9jtstt1ewDp08uy++ZyaRlUVlrjLauj2ecS2RJLCfEaF39MVplfFd9fV/cD6JZ/SdSCI5qefqNJ9+SpHO9ni8lbqVKYEbwEfb13hnB3vMJCl4L7zH/acb8M7nokH8mG9au0zffGlae7868SdwQa3HxPJQdHTQRDVP8VZ2ZvvcuakJw==",
  e35aab63c1a3eb522386f93e88ce5f7583b7850ac053929b3fe37cfb3e478227,
  "3db8e69c9a36e9faf0c5f9039d98a3fe3f6f448aabd9133a1898b33465e8b975": "TJkXkEJE6cdnAs3wjYSFH7gbyRxNYXDUoDUi/bBJ2+ZshPs5UM2jiU2/ALe89IdOdsBUOUL5lA5CJ24xFHJSNirLfxUN/5X03YJtYMdU8pdjRdY/4IqOgy6LdiY+w3gf2afsFv5olWY+aHi1gWeNONezwQ+GtV/G2eD/WjZxH/Sdhau2IKQEujcgY4OOv1DyKaejf6nkUow7ZZFgLw==",
  "1b6cfd077c3611165a20d3cbfff46ac4271a02982b6ab858cca0b16782269ecb": "pPpE+W7tD1L2vkYzTeJG3lH8pgICzi3aWI/En6BB6v6+lj8XjXGBjgvdJBooLylua01se/iPZud9zOzWyLpkTXupWlsWP5NsCea7EL/6/2jCD7sqjzx16dQOUK0eTZEKA+YiqfWbzVt1GfyOROWCQd4rhL3KlfXyZzhH9C7cDdAttPgCS+XbqF1TCxqLWRDdLcTvIM4QWI/ivQa0Gg==",
  f63632860ea804e352033d15622072f6c44bd47555160b7ca59bbd81268193ce,
  "3db62d7b8d9bd258f580cd2dd5f3cd769f674735325c67412ddca5d57a13f92d": "mUpJoXLV92ibm1cp7px2D5wkMIO1bf0HSLp/TUzm/7UTpBh5c5tdNThnSvuZJj0nBVjI0rq64Vj5vCTi82fp4PxwRU6PuGdaSNPZA7wXJ15Y9k+2mO3n7mOgKowWe5F+IpFThDlPg9rWTBj86tbdbxZdphj3Xit+u1V8cGaRS1KlukE5sWnlj0czwnW1Hkx1geljxu0LtPvsIF19tg==",
  "80e123a666e055ce1afd3591feaacd503c6a8f2a369e39504845e2a33f783fdb": "sF6DUrCYLQPr59scyc8oWuEIgCxE8Mp9pdD74scxlIX43d+yfODKuidRb3HVggWD4xWB/J4zCu8A2IUMUhQcBQa5Yh0RN2L8DTno+p67fJrCGAWCzRTcOgivOX9FccdpjUSGmH0Qv5puTCEXq9YyaRAlgqeDxPH9JlKOxt6I13Ex3R1NNcVBXSsk0vv85UHKr1CrXIjGB/4EIzDflA==",
  "46358afab485bc6145123a63c480087ea29984f964e63b242ca687219ce21d13": "GzgcFPdxVMjAGvIVU1Ppu4VGitUORkSYVW/wlTJSzW067DT6gTKeM8686DmqsdfCAjylOGL7gubJIjdLPfAzCAnPvl+Mamr15DdVy4yoa7K/6xF30Xp0SWI1eQ5mvUHYbCOjYUvxAU2qZ0q7sTnpLRLQ/n9Zyl/8VB8WkG7ad4OKqJ923tl8sH0okjlxF1xhhkrVXsKaTjQh9kJsBw==",
  "5e16ddcf21a0b7b0df47567d85937cee29d99b2228bfd7c7c37aa3cb317465fe": "zFqLgGRc4UVbIB2UBiQWQfX3jEFEpARTJOHz/luACWd+d8vfxv5OAwlPPbzXTvb1niKk1PH2reKtcfQ440WN2j7qqVeqtrO1txlJzf5hZ9rSTQeV4bDA+Sm+FpdmpZAerr/T6TTPVhkExKHlUD9w++m5xl3Q0BUwecTtvEBZ8HzJta6Rg88lcmqQCgUSi16Xc+iaWAXPSSc489Ci6A==",
  "76cea9878bc3b2eca546fbc242da219deb48dd1ad18ac6cb3060055d2919b9c2": "tZnVdLFFOiPI58a9vfQz3XvW4Zze3FQG/i0QecVVdullm7RfW7yMbLS8ZqTHHzH5j8+Nu3mXb4olXMQr0RtDoRNrHGvw6GQD0xSlkFxhxSMEnjW0ZpbjtJysv+t3mpt17iTwB0xV4C0IvNS0poA9/e8hrzSh+QpEKAAtpregUfwuL5x8eyYnVfDjgJsyu8OS2D3dxyOPMnavOwWxzA==",
  f5c438ccf77586b008f353f0f7d4093b80dd312d782f8402ab2dc39b2fb19da3,
  "4ed33b6e8c274cbb995379741e0b84e6347feb56458da6511179a72cf85c581c": "7/G6hCjaqpmkZScW6qtvQU+uUakgTYGyCvGkf87G5u+q0Dwf7pJ8de4wGC0ZYgq0i8ncxumXHxPKqbLzK7AsKPYWDDb3VtbLzFPokDty0BEVepymHLER4eJyCdvwrSp0ucQA9tHWfLpQ5AAdnWzH1bv1oNT0uHpaLsHLD998wNj3l25nZqzkSXI9GlXbBN14+cWtNvooFMvS8ovzgg==",
  "1e69a2fc747be7a52360235025e3391ffc61454f96cd63d9274e6bd71bd947ef": "rpo5C12JSB4HGkk78xI4u7vwMANFY4upzHlqXQqfwdTrkYx2POr+Is+p6sZrSWcaxdMuc0Zw76F67gaUDIXH2h6adXtZuxompcl71WrO/fMzW/Lt0DvemwOrHyKp8MATVbx71uBz9Q52zjn1gaqaFTN0xIbGOsCYC9oFmBDiTl9JPtcUKxIRDguRIW6JMMCeHni+fYMKxNFXge22lA==",
  "3f6bab99e016ac3e904183c785b6c8c0fd6d10738239791737bea1851833e274": "YZKJxbY3iNSdWt3zMstuhEj01nXcAgf1N8Rme2QSDLnVxUUYRvxO+TqIAL8xZBXWX1TXAJttA6fSQlP+9DR710d69D6UGm6nGoNoTENtIR6Pz6tMnuU4Mm6UFqfROUb0VdYHSLA7gKdKvy+qr4DkM5iHQP893/bMJlFpChRj9pet9iM6pxEs6QqUZAk+Jvfmw2Sywa5bH9pRflDyKw==",
  "74b30727d6875e5b02f08f99d2c03d6f8910721a3b824a1cfbfdde4ebed962ee": "pBkiacu5BFj5vaNvKz702ZHumMlZVVR3/DJAddjPMx508HDlBwitIiYFW4F9/w8RhdJ695Enwq5I+FpzO0klWYhcH+1C1gqL6W2TWPGvOAaPg4QyrBjr9dCMnisXWClhGv66UP0BWvKh2aA58wnjQkE+oyvM2k/8hq71x4BmzkiHGp7aJzU0EZECHlRIGyo3vvLUMJaxwwY9Idy6+Q==",
  "73df91fdea43959bc421ae6f00140342c1479a0c76f418262a9bd3e9ffdf0676": "M0sE46ZTbrSMsO+JqjVH59WMWB9xaes3PG/9wrOJTd6VYB0fW2xcKp5zygyadHb+6SGSmkVuwyBYLkHIDSP5y3cBrbB7NIdjaJhHcQ1+mtCa1O/FnNcpMD0bDi8ZL3I56XQz+Kwt0UJekUM1hQr1/1f3G58lGdQr+OipT7mGEBUzEJ2y5VLvixr8mU2daOGFO40WLeeQCPYissT5wg==",
  "95a120a1aae0884d5ddcbf342c683aa47cd6f93cd265e4af21a5e7fb8fd928ec": "kTyHJzU7n3KzgxGjirBHSQYmEgeef1JLkT//J9pTNNgHILJj8QFYWrvSql9MQqfoVI/DZucsgjoR0P99tN8C1eNqP9BBVDXoNPptamqK/Tj89vqbcyMUXbcdsiruzrENnmXvrpUSRXZVrktumBWgUqT9XwFJyZV/oUwlBjyEvaYPslxC6WWcS2CJYXBcZJA1Kz8two6Et36hT6b1pA==",
  "2a09a9e762eb7a6c98ef198390d11cc718295c20c20d29e98e645798f846aab9": "zuV7ZZB46lo2LKubuE6zEdY+bB9DEtoJMPhTJoD9kPdOtw1SPkivihMS04wp6sJF0iBQvuPNKGjTOb+unObnAkSR7J0ojchR0wdY6tgOQlV/s6cRrRw9tpAP/O81iyhy+hlO69x5cY8Fi/28DzB6URzimeVFCeTQeFibvvLfFbsumS0BoClde0uLo0RUkU/vcl+8KL5XJj41xQse7A==",
  f3aa65aa6f2afeabb59e2460a421165e8b3a0f64474ad4c46c27e1b39d7fbfbf,
  "3cf5e21f9eed9aee2d6d7ed9555ac0cfba375c110ea9a131d4c885470f420b7c": "vDd89N1cR5DMWNditLxSU8x6JBPiuaF1JxihNPsQkPZfFyVOL6Jy6w5enYhS/DgjrR2Q2qkVvTnZUInGJarT/2rKhPfzXzafMtOSRfmvASsGTOnVMYAvR0kfXmkAuA3iF9+IU6CIFsMdc9RdbHlGED6Cd9K4/xnVClbOjUVgixYnnlZiimAudEh14msMjmxJ1VbBwUfohPv0pGXCrg==",
  "40b9e406eef6aac9bcd010157aea2b1459fb1f9319904131ae12e91d1e451080": "MNQsn/0in/SrZRJDmUcPlbNtWex1GfHZAF2tupFYhz2U0lvMWXk8v6oKdzBXbCaCIvy27dR3JCIoCyREDxUUaGFn4BPY8HEpumcHtWlBr+2O5oQldJRgFqzz3w7bWVmJCCGiVpXWieZ0dVqXOChNINuFsiu7Je9GSKOzm6kM9ua7M3hxCgM9qPRTAxQPtZrgzmeuAwYb4XIwAhJVag==",
  bb15339cbcac4b8a945434981718a9d636e460faa6d425a310026ae9646552a4,
  f839e4a41948f0ff1d5ad8b0521c71ed4c473e1e30e78f343f7991495f02e873,
  b3d4f3d98d296c31912fabc0f19ed3d4b950af0df4d3ef48fc4b53e0aae9ca74,
  "0df6cfa0b09ba468d68ba53225c526fd3195757b891f608ccfd7e90ef88d2fd9": "vt3pDPQd48UjQZMeh7juPqJhfAN6uLxZ+PvgMWett4X7ArB55VVHjQ+17Gv5ioBhifKzO1MIud7UZxi230DKejocbHDDfKNDQyOZEKSYfMyqUOkZxc1jTayLXPfNq2eO99f4wOsNX8UEkuZplrteBsfcl5iaq18YRtjF8Qz2GXmWfoeC79Wui9P1s3fKrnZlfGO/vtQmLLDtmfC6Sg==",
  a5e5f1f53fc41a06ce54720b9751d19bc993e2bb7b21f657c7cc9ea0d703b0f9,
  "00c1a5f0d9bd5704afb1ec2f0f783399b160fc37068fcd11eb8748886796c557": "/6bMLB0dQXfsKVkiEz+FUqVvw5186kJZgeWnOpkB9hUQsxi4eYJWAGwEg2IKmyp6aIszmMrdpiitv/+1edfeY5jNg/5YVAvEY6Xhf+K7MhZQWtRqjHAqy8NtTucQT1ZV0oZsHM+qGBJbGzT+DUTAEIBhbTIK37TlnWtynQD9GHVD6D1aW5JvAnzJSmCrGJmcSCLXelh39LmbVB1miQ==",
  f62218ac483807038d9392bc5474edd2c9490f516aca02be42c7696014908eb1,
  f4bd45a8b046e83dfec36d858c71805811b526e4e313103f5b18bedd7f002977,
  da2d2e280664b57304a514f17450c00edaac4e3b6a8aa31b61064442a37e8d81,
  "46b2ad74d5bade4cad581663d8ffe2551c281707d4d6b81d335b9f815f125979": "jbWYVNHLEb0VsQJ06EV+oZVrO9siv/TtYvXEJqQVseEu9ABsZQcZYXe//uYYpZ73ziCjM1i2/NspqW4yyygIyFSOB6EJYm+2gCVfGAnFnBmg5yK9MsoD+xgT1GdF3Jigc2PNsAgUQwlrvMpnh61m7aLNk0to/Dh2dzLGcTSd6SEmiumkeNxilFpJSIEZWTmD5h4jsfU3HWkzjzHt4g==",
  d649419297688c6f4141c5a0fd3f28129327196828076ab5bf17fe403f55eded,
  eeef0e604e006139acec8e999d07bac7f7e48c0e6911330288c11674024ad630,
  f1e665185afdf633b1859e374389704c803702f6d18f768d6e654dcc24b6b1c7,
  ba2041fedbc26dc9088a5c1f5c7bad053870575adf230358419101b009e87019,
  "4903f866d86ba26b8ee2cfb63127c468324fac6f1f4dcf2910f7520195747175": "Qjf6qXATH1WGBWokAEi7fMmKbL2GNDe4rIlDF1khfJDjcaQE6bpnB94y/vY+ScDQV0467SYArz+1vUX9WAobnt3gTpYfMbj0TL5dWBtypRwVYfB83qbwp37/XE9bVbud6HIZHQ4NkX1xGLkMbpODUB1mMlUBhBSZeh2nkEPnqao7DyXS96gfPoSCgyxJRJrLApL+yYre64f8PMogSA==",
  "028f38696c247ad582f752029a956742f0fd64e8d82781946a9aaf2c45c13d61": "fZOUxjSoIWxueDv1vOzIlQ5nAtDDRM8xcCw6rINqTP2ojGkqx8xQ9EI5zV80J6gmsyUS85gybLNqujCla32vz+qZtjOFdVHcNjdGTb1T+D3fYTsNu1mrrGHJ/adeiVR2cQjlV5Wp8Bk5bbx8rJbAFLeu2cUl5h93Q05US/61jN33UaILm+COS7Beuw9Q/9c/DKqBVp6Q5pJJJTbmjg==",
  ab89a537de32e258dc9a16bf0f5d1491ffcf56b8876f03a20c4d21b3447db858,
  "26897ab4b1ee4676d39bdd148d100917dc27e3131d3ecd79b7679ef95dd9be64": "esgbk7HZ1zpxg+GapS5tTjCb5yQlsc5HlnFBHHeuQ/ZJXjgcGGdz6EmHfWlrOPMAqUTY1cCkQP6l9WHKJdMyQ02Zjh+rnTrwe2sV3nBr6/1Dv7opf/n3c1NX+5Fchl5aEltWccXBIYKxyqUvgTJEwg+b0Fw8hQ5PmQMrUVbsNrRnGoD0zeQtwSqAVDaA5k477UmOAO5tBsMNAd6StQ==",
  "61a95a8b6ecd345e44ad5a0056de1446628271167adefaa0104676d8cea0dd7a": "1qoSU9QI32XAk0prbx83tRc6DCHuE5OcVEw2tfx14fzpTi3OYM6/cvnHRgoiQOAFuwQEnO7xwQ3kwImpgbYSefcrm/axxzcmwEZwYg67XoX75kBE0IcuMXD0PxhIWge4irFqT9DpkABDFx89QpzL86ZIJiUrrQiuKF9VEXGlvJINwMRiJ4zeRsbH3shrs35ZItXL/zcbGLNlr///Xw==",
  dca54f7977e804dfeda185df6595a2cb3865c59dea2633023d28e180e9a5fcf9,
  "8ea2ab0fa6ac79866b9150bd43333015c9565eec985df8ccb302b53a1db27c42": "hEgyp6leD02lSbtcSPEfmysVU9lXVj7RUvhyQCbHGkuCzbwKHlpJhrFwR2a296oonG3r7BYBtoXge5J+kEdOgZeB6/8WX/abYPIQYoKgOEelV6JtGM1fiNCd/P8mB23N9sjUhXzqB2PXRbGmz3xlB8uTFpvde/zrURSOZdyuUk2f0TU/+iMq9hcRVeTAnNtoWaciyDpsBKYMg9D7JQ==",
  c232226f22aa9abbe83edb1da6a764d7183585898d15529c96da30748733be14,
  "07cf5ff0740c36ed03312b60ada5cb8e3ba8b2bda2d90c7c5c45093eb5c2fc5d": "nWc2Ls1ZigFPhmEgVUD8FqtrzJwjmEd7GI9TLz7yGysBJVMbv2ER62QnjQboZf0bzPtfWAUw+x+/eoHZvqtQmWePJL7v/DWh8pP9LS7U+zDM1UTXCHgJ2oYbtThvwsYmLvm1CB1xLunurQ6vfvafRs8Di1YJtPDDBbK9g/JSC/028WHxFozQ8Md2ljeFc++/iC0rjgIFwCHEO1zWQQ==",
  b294e4f7a6f0665b9ebf569a786707da2fc84a2c9be88be4ec7246e9047a1775,
  "228ce06598a81020e1d4dccb981f6e6ff1ef3b59aaa432dd469031239bcb6dfc": "h1oY6BTgA/KsWfB3SgdoFa1qlseZPed91KoAMhApG86gajOgi0jFNkyRv/vRnQEW0b343dmqpceMU/UUVgZsmTULDTkpoCj/C/YkPYEVwbjg70gJK7KPfT7T+t9N/AVGQ/NzKCKx8rDXuj4QMxJMbyIMnVigKUcR10KVFfXxWTZjQGrCWUXE8KfngXg0wQmSSeMSswoMah+UowygRg==",
  "54bb66215fa97c66bb86966c09341daeb9cfe17aa4f8ad710969b6599d69cd51": "IBX3Zxa7XXOCNo140IZyq0+d0Q5heSEPkRk3RVJ28AWFZwj0+pwiz66l58seNEEeseFRfUY3b3nMjrEG9mXyJ8F3S7h8MvlF05cgS6gXbkLik/Ux4vmt0pEAW2sfC/sWtMwdD0x/rj8KiMgZu2YXOzmhNFN1UqXthxTmxFZ2Qjm6vZQ+ZWm4X8p/W3IeU3TkkYXmulHzdtJaKqlEjw==",
  "06ec5b83b6a7c6e464d4e2be9e86cdd9359933e2b667ade33bca6a2dd3fe6afb": "akF1i+DafnWNd4hpdkW7NtNc6FX3pPnKdjYQhEZGdrjszVyD13x1TaheztoFkQXkVxek1xw5EG9/eeJFeyqgRqb8s0UfDnZo6EknJpmVqtcJZExWOeVPBl3B5rLkPsh+NMCBO53cHruK0qX+0EQAjuAJFBEqqpuBYBecGjRPJoFNja0A9L3J5IUzUgl3OKls1S6XpOpfyfdcS9tJaw==",
  "52b135eac16d562c1115fa6d721c2e27f89d99a53e09c0e9a4556f82328a1b9e": "CzTqoUQEpclIDDPSeRwiJ+rNPPK4MSqzE+hR7+fKImnZL5i+veanB043eIHoDhi2O7JnypLPtrGspBVQRHJk2kLJ3E3qsEwdksvonL9XVHMxgK9YHVNdPHyJw0DPpNHPsRUITsUOK01fo7+QeXC9hGSFYlLhpsDOZB7XHkfegcs2H8vSXLq9BS5jsmJO10z6xqCmjyIJUUSmYZYNhg==",
  "9e1ba72a4e481fba353e3d769e10c544f8a055eeff5e888a1b2e5f22fc72c3ed": "zUmJnNd1CffEvuCIAVTAtTrduqDx/hvBosqGSX6L0r6f545Zk7cgpnB2i54yazNyPKkJCI0HBEYGd9UaaSEm7L9jRYjR7V3emfiYw8Ou7vXMtHsvR+CG7//DWmMFK2b1+86+lZQZbyvt//gUtvFzuUC/kqHgIvDdKqQxvSZkPAba1aAPxJF01rEU3WZdA2VLovKeuzlgJHLYEEU1vQ==",
  d68712cae63a3b1db0b6cb5a79c1522ff2cceb30ca634e6038c3708b8fb2ab38,
  "32c7c9efdc12c0c3f0341a12dc25df702a071d60cae94dd8d32a221d331139da": "3vwVM5WRmDGl/ONO+8bcRdZW8VoDdJ0SwPTV9LUznrgi+uF0bga+cHbix/U1ynra/mZMGvVK/mdOWGv8QSqNlrN9nO6y7Uopn2GVOkI7aqBjKx6MNWIeR34HQzSUO/I+cdYuXSalgB/pdPIlNpNjojVQtIrSVJIoKmLDjLXrnBlphDG2f19Q8EPqFU26UPb4M6lMX0kZ/egIGpjW6w==",
  "23c99f06008c5bdabb027cbf366708782b4bcf8f9aef5ac0a8026e3f3e37fd67": "KRX5Pb4Jsq44LCZwfV/mYvIKZ+22PXxXx72GIhhIpnvU/RfocGVQC8S4uWGXenRTrYpuTtwOSGqqVAC1MzU60ioAVk38yJyIWmz5hzQoSHIrE1bQwSWRK2CTIN6/+3Y/4OCMqLpk5UYv9n/I7ngh3nh1NDV+4oOJs5a+64aC0wdFOiKW2qGikggdP3zpUhu4aOVVBPjeJOQ9Abzllw==",
  c7c67153b22b6d1e445558d02ecd771d608a4958275282bb692c3b51f69de5b0,
  ce21285b9dfc36abf1679689e722ccecad5149b7299c618c964ce27f84ad7323,
  "6d2b4579cc9828845bc178eab1379de936432df29b11b73a815b5dc67d30574a": "oOfWkhUAq1daVy9A8kFQS6IAsjBKNRtnXOOUS7b+oE9sXRYFz6B9OYkrc9yDrvuJHG5Gky+oUv5Fx6VKDO8fr83gLyAjSOPxQWURnBMDeJSlc5M02AxbDhHaL0nMGL1ZUBzIAwJIIkKFfnr/uAvU+glCEdLkFGpo2dYpyaKUiIqBZgNRa52swLN6xuRRsd0gH2blcEYPhKkhw22oDA==",
  "75be593190a8b77d155f32ce0bf9c55e6c6d7907d007127c55f664160592e706": "YUqJ7YXEMjbe0Xf6g5TmaIe2LYIYDB7TRPzNT5DfCw8EORxIAtYzb64ZWJEpX3JzGpEyDe1GvGZpo1kNqh2/hMXb321YeooExe863mkC1eKXbEfD76+KhLR7duFTY69GhFyV+wqJbTIvnkl3b9ekxEfqZD2eYV8ADpLYNbmnQu9DtI93q4XDn7tyfz5rJMq3VbOILngYMNXev7iVUw==",
  d135285d4808bddc3d3223300337df1c691dd633b76b7ea15fbbf60c6b011f9c,
  "66322e88ddeff2c5dc50e798d6f6070f7745b25b8a75c5fc2bb8e96ef4818725": "6I0YQs1cn4glZGQZddMNB0GeHX013wyckzwZWvgr6C7vKoJcEQhdR7itlg/cV+BLkYopUz+FEaEuHhZ3Xfh77YVmubqZOTjF6sWdypYzMYDcDVBp9QdN4rBH4ykVphWhvnJT9FqqLFVMjH6OtEZ1FLQvpwVHK4VhpFusb9q/jtn8aQPdjm7qITh83HUO1y1+9lVW9NLuHDIl1UmN1Q==",
  "2b6f58fda065278aac2ab69b95254ba303e28947dc9d0a6494d0052f196f226d": "lnfYhna5OvSKDgSJO7KHAn+kVDj9ue9J+HPC8+bNxthunOAEJhg99Bny0IDDK6+mrPhAHkQUFmi2ZznEEe9WyOg53ai02ljI7fbK+PDtYI5lHwJjFcPqTXudVA0FIPYvPtnLZJU+0VqhdndaHHwLhm7AOBIB3E+OdGGaYX9uglvhs/1lY/lFWcobCHTcAiCvByFS5OOwEnif7jOT/A==",
  deb6b3b616c78291b45ccb42fc0541fd3ad7795710fbcf5c95b879cc864adf4c,
  "2b94dceb9c8a35eb9c115efa90f905233e99c62f668d4acd85141a52b228b96d": "GXalu+VQu/eqM0FtiLGcDxRs4nzYYTbtXzY6mN0j0WKlaiBj+CYUWW8MpdcfUGcobVxkporZM6KBfsJyo3Dr2wPCzMb79u7GQHC8VoMSA7Dy47GHaQATW+PedB2Hk0rMVYMjkOPgdLuseKwRDdQRwEnnG6Jol0s2/yN4gLMo9Ae0JfECQDvXZQg7BPR+wxk/9xQIunhujTG0eKGOTA==",
  "995a6a47517219f2c969a267067483a3023b4ce68a1443373e6f55e7914c3201": "vrtQZ8zGc0JYoNvyrdSY9imblXsTz/lOBp8cow+yw/6UMmZUMaoX9js7SlHOczNSW2P1GF4E8M1x7tCBSWUUvPtH71rqdywkccUrlxirCol1O3GRbfQ71DBbvxZpyE1mM7nGRDvPZzY35txEDZa0wOuBJj/h5a1rLhGPBicSVcZhnyvUG9Yl8foMXj50kbUdTc3OZYNaI+vlOwJJPg==",
  "98d746d7152e32d18e599908e638509f809b0b434b9b33866f3c630e26d86653": "E/952pHUPLwcFzoh9ChfirnFR9hDTrUBx8cc08CrM6wgq4TBTkcuVagN6PMQ4cQxaqe6l0u3iUshjOTlSq3ozf4JiayA7B9/wxVwfAMUKw99NBN4lOnivHashKUGv6CEkl+fVFmWW5mlEQdXC9Z6vwhXF9e/aqCGr8I1Hqk4QQVkhcrE6CY9cNOtsP+BscD40O55Aawh6kA+ORxNrw==",
  cfebd30c6e33bce1cea1bf537cb7f0b903e2a74a36eb9ad1dfcafc35fc61b854,
  f315483b4f19256181a1cb4a6f59cd29cc721bb46882642ab1f1e32981e8e8b6,
  "81a902d79a9299d36eda044bae8b6ba65bea151afdb3e6f927a135ae16207c83": "gwC1JLssTk7buL/b/oKdcStNX6pBz7jVPCvQM3YSiTabqxT0QLVwT9LB7lsN/Ln40mJIfVBNi7y+syKvVCJPEnLPzYSCKzyrRhkSU8UVZvBn5GNTpEfMB096K2uYUIoziIIvpq0AWBdZ6RzaBqT7nX3RiaIltrmsIs5BgyMCN+LLFKJkTDdPkq8QV5PedLsiuTXYsM+/ad2DtKJXIQ==",
  "467ddd39dcf381a602efc64e345b1727f683c58ee72a0a21c5b50cbdae9f6eac": "vzPH7UCwQJnkYqiR9FKvxblPo9oy43qKLZeKtiq2lmkjFwi4RSEimIYsPdZAv8TZDF6Y2hXl7ZGe9PoW0INUrL+uT2+9r+Y15lvwUxf/VUXynkMJFOkbYWX8f8kNoAXiwqhIhOEQZg7cPRoq5nw4KDtKGT9hbM6kmgE6IAAND8eaddqjXui7f7pVyqTjjT5aUelGyw8F10oTqNbKJQ==",
  "91122fee13f586e62f385c0776eef9d178dd44f964e9a49b83582a03151c6446": "TjVKMBUv2Uz9AlXgzLAfvMPziZAuHvzP14DivEfnqsfxR2Cif5PDaTgRr4/ZXjnv4g87HkN0r55wedWeBv8z07fZDOSTm4gDoHKrAE6nsP59UCG8iDqihYgW4fdNWfjKwZR32T7nv1W0j92oE1AnTvod+IP9rdw+2vQ23Kr+B0xRTJW262POx8fjRghjGJ/zpLGm4YeyQzXfmF4VLA==",
  e99b4d452521e94fc336d9bfabf75fc6c215d3e837127a9db7ac9661f9a32cec,
  "8cf77c6491c21590b41181b8d347834cd88fbf44a0f85d74504b994ee61ff014": "HN3vJy3piVI2X/B3KJDnVtWjjINJth/OKpP+omvUOrdu+Q0MfvBKXU0U3J/UD2ktS898um8TYe8Te46XZXM/BNIuYx1kPVbrTMv881uQu9CA/AoWpT/LzkW9jmrpzJEcBI62flrR23Z8Ol9lTtNB6B51Qw+gi/gk+ghQVQkZjeD94PjO7Utrexy6R0jBdhLO990hiktkRXV3XoOcfw==",
  "29ed0f7050ff7b87f833b4f632f9941209430479c6d7c42ded4ecda2374dd320": "8+KkyTzitCOAt0VONO8zpMXqHEqK3us/L8rkNP/Aw9C50Bbu7Qy64c9zt9W+3QbKwb8UpWBcZ7OHm+P497wSeR3fBrzTdXw1hyvOQamUJ4RKdaSeHIuPYNUFafdvHqh+7JEL47KtVGvZFWuw0aAQK1Mv+2snJFNn2VgUIY6EJltYr/MWxVCcfHKpKHeHcg5+XlODryulp0LcnXAjlg==",
  "030bd1f83ddf124a9082471bf91fecf6101ed31c78ce11a866c5ab7dd157b366": "5csKYMMMlNOmnGqeyXNiv+nV4dL4BBJahQGGItRTAPnJG4k3K0ijWyjLxymf5giKZvLyqCZ2HoyLtz5wfaTupgA5IUloRzLR4M1uJe7H72pCB899sSEONf4UMOjvNXpKXSvqjpdEI+ZDnI57CpovJV2t9cCtfScwRjmJ1itEP4KjIg8KPLfWTDazd8Dkw8hT3Vs1ctykZPm4ZPGw/w==",
  ac0faf22549713bb55b0ab675b22f6bd0b89e6f51231c823806e8c25602b385a,
  "5f7837a161a02029ea69fa12b53b33885796b6c29449e2a13b0906af0e04361a": "yuUbgSsey4sC2Ctf2e9g3oyhEqqoIXFsZW7OvhL2irdqPCTCsnrZWdUWbbj/kiWiVeu2Sva99lrwZQTU3+TxM+1hJ5Qe7i4lFRdAo9ChUHZPu3LdBmJFOMKQHOpchzN+g4aW9nlz1lQvEeZRXtgSz9W3FF0keWkGiCsM0OBfiMq5BhigPBxWeMmRr9YOxR80YFZByFMMsO1MV2uTaQ==",
  "62275a9cc5da5f465570694b188e21907b76c1106cc6400ba5472360881557e4": "yxaGP+Gd/S7JPSDGrN/j2xMljSyfYKe6S/jBe3TAcySvAo9N7ysQkFKHgzHZFMC+7uRnBVJISHgapg9mck072AKOgA4Fe0VfmZFw3EY4tFmQNhXv+x8e3YNbiP1223lBtgh+xJkZnyLTrcWET9zl7oQHt3ZqOtu5m2uBynrNZUCVKxnFPFYTZOUH0V+e7Pjuxjw/b3B3LsvUtWu4wA==",
  "2637ff3a931f59fcb2e6fd984dde7dfdda42d9be2c7df0e2684172960e6e5c6e": "K2wawexRWg70Ukx3MeqASdukJodRES5jVMAOeK0sh8ZU4UxHgEib315ZIdm/OgcWoGfRka/e/mlsgOGTdVKnHeCqqo1fvW0+wdyuZSRgwzCsDL8xcvgMIj+AZH9zeMWHgbGZtfCLXhpdvTC3uuFyty+jY1iJhpC14ZsJYldtMViJ67cpO9wKbjS+qdbMSiTj8WGtPY+V3U+JDJL4kg==",
  fe59a0ada67da802de8e2a3e8b908b82dbcab51cacc6a7908b67100330e60903,
  "0e35664c00b65cc625eba72691ec5cb1aa8c8026d266e896d648729a3db47839": "13vte/VTPFOkaaJbFPvl/Q7HW4/qqxwkzFAywpSAwAEbHrM0EKe9FchU19/W9Tf+onbze0c6DHn19HTmEYmC3OSz1Tuec4ZLj4gUP2wV8IFNY/9KpjxomT8X8S9zEzeQqETF2bwyysEjwYMzqcluxwLzFXlQaocnKJbg7dAOcP2WV8yTv9zI76cytvw4/58UdHsGEReVxNhRM4XBqw==",
  b52855a6d6cc7843e35c1af74c5fe7d1fa4dfbf9c406f28ebfda3d1552753f5e,
  "9b66c0361fc0cc029ca05b1b5cd032b08f383590ce753a7a7be104b3e7a46335": "zDxSquFhiM3ekRJZk9KtxXCh3PYgkrg2arUXg75d8KBI+Z5e254KED/UiG2KcpDEy5Bn312+6XyE6Pf+XrCBvPfaw2LAN2u/larA0ya5F/pszE2Oel7ctp3kb5qCVuDH6biF742iFgLRd5V9BjhFe9GZXesPOm2lexAzlRy2X+GZJj/T+IzxuM1ssfjzLbjmQD+CO+wKwNZnnifkpg==",
  "312257eb13ca6fb4e6b5a0aad5ad9a812e8f2a8f51247e987e1660c6ccdb6173": "Rfub8baBL6WFu/EP9/YlFagleWBnN6vMgCyop5cbjwMr5UH6POIS3J/ru4bVG5xXK/ct0zTurE9onFaR6pJeZh47eYE2qsoRN81qwzg2adNdfETX/njQ8Yr8jnceHC7BETOSg5VE0QoQ7rQgQyNLa9BotIQkFXG/PAz9BQMhu7BoHn8NqoujZZhoUjasd5Ze7RlE4t8YrqUYfw6mhQ==",
  "507af56777eeefd63bf5aac1cce5d3a6d6db2ebcf5bd6f44efd2de7783fe8b8c": "DBES11LNGzIC8+BrZThzTW2eL3KcDZCWxZwzCaIl0u/7WWFRY8NXyNelhN5o0PLIwtNb9TftZXERyrtjkB7UgJQahGeNoJBmn5T09ktmizT1g7nmW+QblgMrVlHhh99o5VCm1FJo0cDq5fC+5dBIwnlZ+a8SU53+lOntS9WWePl2Jolj9ktzz8mOBQE7KcxCBx83a+7TI4ioEFCrNg==",
  d6792ffe2475b276c4bef72c9efab1c4151b25abe83aefb422289e4d223a703c,
  "97a2867bf35db15d63c047fc07ac2e0b5d03b3cb7abc031f6813b57bff440a90": "ksHtbvnucZdO6L9b97ii/UTBasndFB6980GFjx3XtG4ETMm3XV6hMSJ9FPKX834HQJ63ued62YAwx9zq+I6eFaIk3GIteo5Vbx6stRy4QeqTpQb+pRo8ps2djenNFrx2aU4WpNMaPb8gmta2KDM1wbXkOyubd4yfYqKyp8CDldL1oPGdhERutmeLFJ3kB8V90d43A0Y07jsZW8jD0w==",
  b9644b551f1ea7657a0742661cd42173ffb721e6d32b9cd70b4ebca7eaf7b771,
  "2b3b4be91974325d9e5dbc088271f88cbde9d68100f62095bbec29e557e9a1a9": "E+0YiZoyyitDJX3hrTAkjutljPb8FOi137b5Cn48g8Ktu1nbeSI/7b7DrRs4iUNEHXYpc1Lbjawjw86BfQkUw8KqD5DJspmLBWJefNezYnwbTlz2mWPWcpnLu5EA5YoXOClckfsWS2KVd1ItfcpgIIQhYKER17PCgWJH9bIPWiXrx1bF85SxOe2Er5F1MXFUtB3f3foOf9JJxvg2Hg==",
  "85da8e4b48ba0c419b1cf7e8f9f14e1962c205711907f49b79c0b028ccadc079": "lEWKHXrBvusTt5gZ0nWMaTkmkTh++VzPVmq3P3Fs9tNfs5bs1aKbmZlcJlcOua89KXt1er8A6+Bk1Uzvt7cX+aNia548+t4+jVo7UTXgH5YcPLMnOuCcZQTCVrQbl2UHB2tKRtM/yYJvRz1HZOwDminDKZ6vNV6oKbSOIn/cibTX3UTKnY0xZmFJWc2f/aCp0xekUwm0HnZsORyRWA==",
  "05eeac32cad56470bef77a6ffa4abab5ae94e7fec697dd1d0918b503761e0dbf": "dOUKCtL3J27SqbFKQLuSuC4xts8+GuqiQa7ypWUeJZoJpkQy9PkDbbyOqH8qee8qfKsPtVS/FsKjYoSOMRDOeK3yGsMwbjKT9yia4Dwiq8xurtWsUAZrWkNddzpbVLRJv1ddIkw5QqA3/FfAaQGPPzdFaKb+fOWDjCXK0Ce2MB9gBNbm+W2ToYyRNZeGrhED1Sx+geuDFXk7DuR1ww==",
  d4f99327fc0c30217500a8661596e8f9206158ff7d2eb973041de977360d68f4,
  "5beec909b97c8de47bf2fad12234316199f9b460bea9aa6ea76f8765c84aaa61": "iK+CvvFYEgYjbhlAPPEgYtjtT1r9gqhYCtgRjkjFJua8udsOB+gQgdgDHgD9nTfdAn/P25rsaB/ZGnM7uYwSZj6yqnnSLUpTxC44SM+KIXeVpP3aMYOSuK/qtLgtxw+5aC/vHLglg+3caofg6DoR/3bGsgS6Bg1bN1vGFVpyjyfiyZl6J/nmkVPP1dU/xSTukegKYkCF5+FMjrDVrA==",
  f0cc39ba71e7464ae117776f64a59e555a9cea2939ca1baf2460ec6848b5fd2d,
  "11ca7110ed64d6407613bbbf523d2c5ab8e13f6c5db876b1c9fe241577cbc548": "ozIF0J9vqWRfC5LZ4bejfLvxbITZnwSt5ge9zZZHA/QZI7Qhnss/JTOFC+bcXJ0+ImTNcKNbey1xT2vtvn5c66hDDpONZY40/7g3tVpBCDbKLDco3Po5vJB/fx5I5QA7Fz86A9v5sUfnuN91MmjYE7lbNFZzuDzeZC3EvGu8Rw4h+Cr7G9hJcUQj4Dy0PeiUkFZN4E6S18Sam0AHYA==",
  "0c3e6335245b7bf0f986cc6dae9d9f0f38f5e273678326ea77e00f59183ba1a1": "Di8soE2M3DL8qe1bjZuz+ZQEYvic9zgmDpTSlB6aDH5AfJ0eXI1rpe8FpQTx9OcVGMQDTfHKjniFZZX3mAi7b/kV8E0r3GFHAbyqyHVAegl0ZCOeQrvHJJ0zTMr2ww7h4YjSyGX5xPj2iiDr6erTMZsofg4Cega6nTL4POgOJSIV06AXDgYSXDfMyM+uMuiJNwBLb9jceoiFmH7sVw==",
  "50c7917811d071ff5b12958d716fecad66b6a71fd0c0f8d0174232a6459cd143": "7W2KI8sYXdGKEdq+Cbxf1skaHPJqcOe+pIPbNjQSCJZzTANbOkZM6CHbOZokmWReZ31rIAy/JbBQJM1cifPB6zjn7eVBanzrsdbjXZZplLOYmREMaSRC+rwxCfG3QorTYWyR582vgumjrBEJsTBudhHHtHx+IQkajZnZRCnucSQj336k6fz3zJ2KS8s0Hb+bDBYAXZYddwN1xc3s4A==",
  d941fb84bf526df9100093f498aa03ed6292f0eae6bbc82b7c0525bec3fa4cfb,
  "1907420fc31bf166c71f1e7c838b03a73c14a1d0b8d2b9b5332113f3b4a69b36": "7Bc0ATWYqj0+M+gK9gOTB4vRlSo1YvdktduAUh571kJB9f7V9Kxf2jFhur4IFi+K4Sy2GCZysGmda4Mp4wsmJPezNXBSIdWZT4vDpHG2nkQnOGj/7yTJbSCdmbsLebpaLqGKKRq/eVfn39M/eW+Iu+ZYEnNXfDvaZWt7JdiD9xa5k8bUAehz3mL3B5zWvoZWyTxwkznAs4zufXYNOQ==",
  "0e24ac6936e1230b70de2fa228ecc73ac62d3fc6be32f766438fd716e7874c48": "sTCTQjqAdg4L4mEjMXPdM7Ted4uBQnFqjfDZIJWXL7eXr8maog4ymFO4ZOdbgd4+hzXahgur4pP+KeX5IiLhRsRGwOb+J70HNxHF+h2TXPDLhrlRSDuxDk4NFI5FkZjfoNFw3rmdckSssamOJO4NXARcIMGcXMuMiAJCMir46Y+L+mrocmgyW4c6nbi/9+EvIE5KnjgZcF1zxADjiw==",
  "0de99a977abc4aa23a7f98c1c63f3259e71b8f88be883419f1e190e6b63c56b8": "GuUCv3SO4C9eUj+DZmeX2h6RXZBrigjRBlTkRn114wpd0PIDheStlsdWP/rNDlYLv7IUFq0Aal/LGSGcRkcmQZ+aUbuMGiK67/Ivl9srSGPQsC5+N8Xpi9Lnjwq3Ot65Z9t11FmlF4mvomYURhBmI39jfZ+xlog0Gnl1usQFfSS85xyNlMa9FSRhuF+lCBvz5njDwLofQaKsC/0hVQ==",
  "49f88ad9522b90f0b850654c11f9d0bc2650ce814b69ad4250e65ec5005d86f0": "PnZxdQLg6KpdAlBz2OqZe4ws5HkItFkzBkAPYCnwakRMB9MGsBEpiDTP0y4DWXSj42sWUpSZDsnovtAprFZQc0+Vz4zYw8Mbhxi6Wv6o9BdbFs/8DNcWvRtNaYETnT9puWMbswMZwCvaWgBQZJbKWfArLX7Op7aG2qA5dRIOwZQOosAGsTuGo2UTNahajEeVe6X/fhDT469QQZtmlQ==",
  "698a58b3b925930a4cfebb62a287ff245959a26ead6c794332afeaf9ac098d03": "pqzUOurSn+NAnra1XYVTR0qqiWZkAaHFkslsIbAKCIPXRMLwpc4SxIy6B68nMXgttz18D/ir6cZZkY5Ic1zanPzwVOG98RaCHRERv66+wUQ6HbdD4JwadIeVda9A1XLliBqUIuMWd2kH5WWAlglj1FNWfOjx0CwTO8xwOVKD4+ktXXfQwuVntXIxsiR9oLFbzWSZTlDYCJccjCBxxA==",
  "8549eb0534cb596b2e32eeae5f6d8889a35c152660b686ea25cf6ccf45d77f36": "tCTVv3iiBMV+QgbWyYGxwNyFwtVqENFzsYRx/l1N76WE/QL/wangZ062b3eYvfS8ddQlSllF+wSIhyBGJ+qAPjdGDENkkl6JFBiGI38Kkta5t/XmVbRAMlaOdrHi66frR6NFrU22pKrKJmFwruEv0qC5ISXmzbVlDzykDCqTv7d0d1DwN6VZvChAHb7gQXE1LpMU0Va1Ypva3XLMSw==",
  cfc7b92ae9af58d8372e022f74151c6bee06afa8a2a3101e7fa9b0c7e9a39c72,
  "0ea6906ec9d4c7f62afc955b8fe9a76d0345dd3bc22384bd60eb35c83d68a723": "VeMsgQgBb1xCermzForJue7mpQUlNjf5lM4iixlSKJhjYHRYEB1Im8UZxGq8kPAaS3bkKRlQDRA5uVo2E+UJZ96woNNhBJQNzWQgRz6MjLwEYolTXW7TtSFJ8GJC7mLtfUTnMPcSFXxTwQ2LUFxYzFnZaNUWtl4EhI0JnXfN9xTKS9JQw8Y48z9Kyf/XRh3GVJcjIqxzTnm60rWyfg==",
  "77129aafe232dc395537f1f027f8da23ae8ead8517c0696ba042918f061a5556": "DOWvPk+nMow5/D7+rUyQ7io5Pyd2JH/qD/XEHGqqRqaZJrpd5o5G3dkMBqz60VbtDWsgJ/oQAAZ+CHcMJjacwjv9cNUYSpAfvqvF8eOesVXeUrDdEBl3EaUV+9EcJ+A56zfG6ykC605zhvr9VU3SK8DNjKYGO09p/8yyhrgHQudlFPX0ypmpSbGlxJ8+0abgYlyUQ2XR6tqPLHPXtA==",
  "79b68963932fac5e64083e1a326287a3dd70314ee97d5a1a108a79e2d4f40208": "o/WsKtI3Jtj+o7Uy7bUB0RzAUFf/jt4MTA+3K4owupIxI6OGqWNGvj/xWBQAzf1GJQWS8yR2BRzd75PU3n0JR7UQ28rZln3Ia10A+4WsK5xlxbtMBpxs91b83xBamdhnIpE2OhMZMsmp8hsQGiDP4sgU4bQ1lsYtnYHl6LIWJ9ui9+Zhk6JRun9x6N/HqeplfsdNUCC1a7zdALH2Sg==",
  d956337692ce4a48e1e248c5f0b58cb062628f2510f863cde55bad2fc98e0708,
  "1e158ee01d432dfb8d61caff08973ab80bd052e48cea79fcb0b2845e4f9a252b": "2lAVVIdyCOiGuO5Q73AI+8V1TvLr/pPtKq9yXfaIztEUHOkF/aeQxGprsnOv5EZilUZP1HZAsIlWL+lUabg+Mnk2OUF6GZzU9bO69NUYFhD4Q7GY0fc4GfhsD7pNwf9lSCr2DIuTE9csigB3t0KXhhQAwc0YH9uAvWRQ4BMbX80ZXiOgRokd8r1I1QpXaTJCVV1v4lIJszex1ReP7g==",
  "30788bc59f23ab1f1ea5a94eb131fd98df1b7d28256766d556ebe4ec9cb828c4": "TtuwoE5Xbos+eZS+5nvMF8H66+bcz3NTjOcMvRWtDCEu63BCsBhO7uHh1KW/uKiieM3ySOBS+CkaPGlcjGSD/5auSK2BAuUJ1ySEJQOoWgKAhmwjtBvBAXvh5HaXlLmWNtTwlGiebPt/lSx3rF+l5jD+YQwyC+sxkKHkuAvIwgdWAKiFqG6FVRlY3E3eZq+3eSpzITXunYZsATChfg==",
  "4d71679163c360092edd51098f4b64bf009c72d7a208ded72ac10c16c26e8bfe": "9UQOmyCqhYQ7ei3yzYbb512K0KTWwzboByUup63Qlt8zYNNIMFFo3WYtf1DY6kkGoNicSQ97forkrzeUeGeJNSMUDA1/ZnIfAZ/xTa8qvd3XUZBm7zCmd/zagWp346xQWJRRWCdDcouOpQTYOp0iHParNAZqiDM4fLmpiNtxwwJIQ9YavOU9MhVfIhzoX/46AEAuLzjR7MAMSqMPcg==",
  "280a07a1c17ee37422e482a019675c838b9adf57e870de648fff1a2919b03886": "+h6WKVebOyygvSSZ2vV2BRxwjZlaF2LKM4QTG/KDb9kcARMqSUHGEKjEyB8n9mm+ALobfEWef3n3+VwZje93OEtW5c86RMi56Q/C8hS/HEJ7ZReqojKfbgiy6hou7DIGgmFdzK2ohilt2rLTRdhwXJL4l86tC6JbBdnbOSpQS76KkqG3jGQEk5ml87iCeEJFThSZFIgyr0lfsXjpyw==",
  "168ecefccf13ca9f9e699a508244a7c0eda2c0d4c0504494ed7b637b1bad8a01": "oQ8WWFG8fGCJeCChQb9QBjRCfbEOMyB7DThiPtTox43pt2P9OTENaV/K+CxHvt34oGIYw7FHXOw/NpLFN7AoC9SaIYHn5M5cS1UFTCqcsLw73EtKfL/AnsrOCcf/sNkCwJLRv6OQzpG1RNKwfi3qkUoxtXS4Ee2jD0EiLh3nOYAPABA/t89RbJ6Q5b52VECCiESbfl3r/NmoRY8QNw==",
  "248d9be73133336d17c9f5be55bdc18ee69a718a067361cdce280798f3c16767": "gavlegs4u23tH7PBoDZxSnfoNlIskaOqtZPPa2BlkZ1z/mr9L7FTuS/YgAp3R4kw1r33TbdBa6MRSFU+k4OsNIut9cY3W4iszydpLT4/d5/9w5ElwjECuhIqeVZw0GYTTuB3Pknlw80J0hWphhwNkxjiAIY6L2WLAGpN6zSCgrWLPAoLcoNWzbQMeuEnEuqaYhmvPgNkjA2yN4iDFg==",
  "1e354a3c9756d0457ea33ac5679a42bed8b72f8197e94789e7029f62301c24d6": "/oKb6SW4u43cMWjaLYc89tJNl7q/hyIXQVgmyGn/u1W1sP4moDypwVKNUutVzu7VUUfHv8WJ2mcs8yEHJM13hSVRS7G7ND/4zM6eIOTprzuFKUXbA9eoU0RXktC4azfBELa5umrVKvg6M+4P7TUBy3s9++rsl79buN9R0Yf2HhCWa2dlMnTk7McUQqSKBWUdiTMuBjDcQcCsgWkTTQ==",
  "40288caa0d2ec2738130e29182c11163393955bf08de61b5472d3e3bb68871ee": "ztgtCzQXBXYcp4F5ZfXySpsSEbv3aweclUNFGeSLF1GHRWhDW7QkDe8akhX9IKDbT5UFXaYSuRDEW8XvwSXdf4K3vePpOqaQPb4Bm2XqKgUebxlkvI2sAWTjx6mNYMweUW8ACCo+ONd93uguqmemd3cRflmZUKwzQw7cTaX3gY2Z/F+alBfkyliF/Uw/ToUm+J6YiGYfQyvsL3GLpQ==",
  "089c269400606c166952b307bc961ab80a2f9c4d79a18bf13b28eb1d719d20d4": "2OtHQnhss1fkO4OIjyhtMBpKb29ez0xZIWR5jWJULAMvJPSUkgbZbO0fSeJfgBwplMXOMnH88j1rihzaC+gujPWEGWaGlavUKD73bZXuNRkY8sImmrNBzYWEnkMcdaB83DuuQyN+rejq49J8GT4LOhLw4Jwna6He2ZEGT9uWxT41meN2xVVmbeZe35xE3hLFGe+NgAbSXwAM8JE4Fw==",
  "58a07a802ece8f9c18e7d16ce233cd86932e64a16e419887d81ce298839afe1d": "HBvnhll5cdA2mfbo/UFaSI4yJwLMguiVHFcOHhk+fFlm6hC7ZCyXLkWi6EDHrQw/1tfVHE+nH8DlVk1CRXYciCVTIIcRrZDSadizLXMh3U3fjMOx/S92u8tXuorAHjppozO0bbeNs95siuqkXFytckhaWJpT53NYLUekcAdiMDN/PfptWGBI3ERdSXL4BsU/+0K6/d424HIwJevSxg==",
  f2a23f16d8235614aa0944934b2af9b0e86a9d363953c4fe4553e7bc8f8492fb,
  f7067551242d24b3ded95f95b576788f1efa1d22b82562ca3f3a53555bc0c1cc,
  a1b229f95490c3e9fcce6f1dd670703bded9c74142961174bf14bf65123ccb15,
  "282379335daa8ce204b5918f95760c21a3506babc77ab2729aff9aa21fec10bb": "HIjvymR8knLqYAFxtOkg+Thxuou9HVmLX1aOpIHYqfYTqxAW1eR3Iv1Rt/fudxY+Q92YCLZAARZu9ft7MklcV5O0NqtR3T5kgX+CemJpokf7GnDbZWUS/PeTnNuD28k4lq73fSrswG5tW5jQkOwsvs904nC6WSj52caMXmOrCoHqQ2odG3Vq2xNyLXcuZy/QNQZoK4krA9ApCVYsFw==",
  "75b8928352198cba207376263da4e0b413e68747b2e6b6a61343a489b70f9963": "LARCRPWsdqbL9L/ccMHn2VudcNM9aE+WtTaMVyCG7HvNa8gOK4Vunm+8/BY25yy7jiF9zJ378xpssCRLqEWI0KAjvDFq5QG0dynCO8D/T5vPYg/Qbt4qiKLub6OgTIaPY29si9msvgBDfqAB+Ou6Rk6IiKGgWNbUBj60OcGT+dzs6M0Dzqk/UNpKiQ48tSVHRzGeoiLUNQXpzY6Jvw==",
  "6fa21f0d48a110650f052f3f6f04243f2c66b66f1e697e13da94e1bd14825cc1": "M0ES4aOjITcdFtI8DVatwtXasG+lP23YWsm21JDY+7x0UU0KZlJOsQTG5NAAa117JJZcSheb4pc0sVOQ6nn7ruqazvrLlNTFZlMw0bnMdFl4UkKvpD400ZtfewxQQSrS4wsLHTR6JjTfYEjFJU/thhID/zwVG7ZRQRM2vGhahY2Xsz1N1STVbBlnbb7UC4RusSz7juvPTFaQVLgCZw==",
  "7a6500e43dc2c1ba5b63f82368ba0335d4f18c8bcb1f0ec7de11af3281446e4e": "V7yQciYo6eS9Pex+CKGKdO5wjDtprDjr57OIznjvQW7kIfDJTytXYKBdQBJjny2/xwh58ufOK90Gt3Ah/Jqo4PsV5eOHrOLxyK1d1YenccEcfVRXioQ8y2144wWsXtFJbftOWW3edPa2Jg16xOXbKQry4Vqa6wgJWp+KCt8Vnun+QcGl6/nNlQMR/Y5zwiwvi4sf1sT99PmHU5LZiw==",
  "82be7ed75f17b9747fbb32b22852d9d719f07d6d3211e56c92fa0ee45d7bf80f": "0/G+hNgcA4aJoCcNVVYmYkGKDZFgKp6b4CRUMrlqjx4E80yqtnYK7E7oGXKUd4Uke2tORkSDy8bvuiyvyi95KowbY98Fu3SStzzH/1pW7weaUpqhh7YGePrs/Esq7k+OINn16PPY0xhpYoAaU7yxvcS7nvc3SijNhSNCRK/sHnAWTpG0kJuM3ZA1ZYSbPXut1vDzja9oFQ3T4YHF7g==",
  c9a27dac9400312022dab6703a5e6e6f365d61f95d362d8c76deda5a4d6fde61,
  "6f7d526655b4bc918c9df83779ef793a8c8b8cd18fd2b5029aa175fccbc78178": "duzm6yHHhNpwv6Z+/mn01lIFy47TKBO7MPgCpTw3bAQhis0xca8hGsLDl1Ei8WcSITygM/6Kgg6jHy+NAi5qTk/ihQvGrCTM9iFahrHHPJSKs/qaCxOpFgrCqGpUVjp7zGGy/LoTrynLOl46kZfbBQ0mpugYTATlpKl7f4u+bsBwsOmMmSuPBoLMj1FEp4OpctLmUe9qsdiwe4NFRA==",
  cf10f1c7fc12325630734ccaeb6b1ae37dbd0b74fb479ad6b14f76a8de20480d,
  "91608406c8394f3817f8e6b0e227a800733ed1843cac12220f3bc2c79b3001cc": "Kl3/mQPdo2sDf/BmSDBTgxLW4Xo4uxoj3aiRtDFWEIgItZj6u2JE5ovBaexrPHOlzU3TGTPaz3HE5iB/BqDCFZPMLuws9zT9xQV8Ssl6Q1OgKASA3DPNFgFeji41AQdRUowVd08S1PS+VKt4NMhBj7E2W252DwcZfYuAM4K3edZIq+0NLXzsf744rqJKgUWA5+j5CKabBk5wExodMA==",
  cc5fa16f483685a99351f29d086c5321ccc0d4db74d09a3b45e467222b11dd09,
  "3f3f90ec9656f2a2f136f5123f2121f3031709da5b0f5625991cf79ccb44a7b6": "OmO7AXSuLXS9a/UXYS6ID7ynmnfLid2P5p4tKVB8JGXa9Zj8HZ4w50Avw32eOc26AkZQvhI8NifCW4gJbExzuiHZUS8qIOOrBdsYCSXnesQjbtn+gZAJdaCiPERB8bfqbzJEY8aCiT0I/aDl/OHQz2NTbi82dbR9+nFCLvYsTRaeYgDRbPNWviSvKfpnpu1/gyUY3PARdBNeZVaiHg==",
  "034191e7165ad35205a314da1f267d2fee5ea5042bf2730bc62048cf91517453": "9Ei0o7vRZLW32kyXu3uEy9ytSqTyKcVLJXu/HaaGyb+33vEZdEBpIjhwkXiByremXl20AY9F5legNNT0eVWZTCkGuK6YoAV6tQTgDJMRuyndPQgJVN/rUuwWNCVxR+Uhqi2A9hPo6pVz8OMrmeIl1ECtrpfW2zLRVZdULc/VucFVcPIVoWlexIrAG9KeExhhLTb6vaYQ3iOw3qfsiQ==",
  "3bae336aa77fb1061518f0b5aed2d7be3e8c4c4ef80b2189fa8179a9b7707168": "h28p2ZGjhlkuOetIatbrdoHEUq1oD3WXE2Bdz7GxuDxX2ykq8QilWwc2S80i6sAoir2auH3wKapaUVRKSfXDG+x4OOKvXy3uydQYYPWRlnA3PEPZmfidq2+GB+ssNsVeDvyCh58d4YaV1TkWF08sZErEHw1kYQp2Kss2zUi8syib29ug16blFWldq38n4wJgamJ1O29E+t/ikI480g==",
  "698e1fa8ba1467648625d47542bca1b65c964e75a1a2be6d5451daeb5d87b1d9": "UrcjvgxcMOps52MQr6ViukiSqpp7xUldYDqdCyVgbV1tAdr84Z/lzvizC6JWuFNHZ3Pj6iKs7v5ilqy9YKAtMSt9qOaxZL5iDtuClXeaU9uhEieLAne4NAeZnV1JIYKGqYC5eU6mFurWE48ykjZRQ448Rfg/9xHSCbRNEK8/8gQb06pSQz7zYuJxxbi7lTh+6soAp9/LB9ukyJCPjA==",
  "98662fd41e1666295250f517520d7fd980e78ab6a6c888104151a53642cf14c1": "vdGaAHqIwKOk+tLGahnPXnFAzfJz5C43BF66anY52k911sDqZMXOrxhpYMuvpNs6ZDzd3YvNoSS+WeznQ6pV2VJBEaWT2NyzljmOPVopGvLZM78+7vnBHRhq6FZ+s3nA/AnEHA0+fIr1XGTdb8hZK6Fx8mVLyJAORvE2JQo5lqv91Tr9xbWbYHCRKwYQrdtdjQ/tWrevAgfxx65iKg==",
  "5115e9dc5f965284c453055e37fa83aebc8dff89a0faa71b4daf454626aee087": "HCP/4QW0fe7rZH7v1mnkh61kWCSVKoRHh7QTDCZe4OXj/Ew43U/e4sULOoCMjU/B/SmvxCKi9WTuH4a1xH3jJtSaQ20zf1si/mogqNA1Rzish53i1KTx2d/LIZTadKTGOT8y75bILlEHo0Q5MJxXNv29KrOiKjGZJtC4fPuE1uyjMrU3VYvmFdS85rpsZ8Zgr+JRLsAX4cTJuiHxzg==",
  "6d298ea5890a26324691a4f608a9ffbe3cf5bb50d2e7114d0454b91622821fbd": "GX+Q1r+rFS4nNJxjTZM3bkO4WBU7fEibq72Rb6DnLUt9ceVIZ4r3KPAnd+JbqxXqs6rUeJKMUvcYMspk2w4QeAmvwZ89iPtxjJZeSyHNLWEU/hFWJqCU+FaoYHbWdxphOJ+McQ/nQk+NZaFQVZygNTxLuYKbY3sCtuPPEBkq2Iza0plAX6ANl1Xb+AoBTmMWn+L20U5WR/3cpBex1A==",
  "0a99fc2495adb65fb890d9b171da4d1f3de4f104891525ff8457951810a3e51b": "SE9gwOLXbOI917apWSMy8i1ceFuYq0cq9YO/5qwVYd0Xw9whOHny0g+McQveVNAkHV/qnCr7XVyjmf5bh0bi9pfdQPxMXYy+Cw+rTZv+fiMdgBxG1avuM9l7wyW968/qqs+9iZB/WWDF0uQ8d6ILCDHlM3al50r4zjDa6e0w6o7G+HRbI74LwTv3GZ+qBEOtJ8TTFdRWnF1Sa7gv2Q==",
  "8f51988a3eb0758248296d6017d892193773986dd2baf82e332f9054f878eacc": "ca76JsSjkc0cjpJK2NFUuNz6wr7/bq746+xYM0ClF08YuKOmJ8ZNn99/61pVSSGUnoeyVThDWFoZsn38MJwphVycSS0dqnZSRurAblbvaXEG6KTPohIvjsp8aCmUFBfhUmwmfXS8+5oUn1Z8WtjEwdrpXFcjTwVDWaic7MFF3rQRS9ZrRZbyY2x0Ssd662a/ZKpykedbshLGLcANFA==",
  e4611db293c0f2becb362b19cae0cb16e8779e31f4909ba25a13eb22409a138a,
  "4f31977f1a3885d9b64d72db1926bf224d0ebe1e9853572ca9e7db3573595ce5": "I1JH0LUTNKwe312/CGnfeSLqpU7zjXj/jCC9bAtprhTomElcf69AvdWF3QCAnehmdMfhyjNLfyX+SyAO0e0i233u1znFeNl/HtFAcywKDZxItYKGMOFDAGcHOih/RZlRNXzqBoEBYA7yNUR5hDE1dtGXNDmdiM6Nmmy9npVS1GyS292M/ED4cTF10reswuJCgwL4hJrBLnTmMABODA==",
  "1d33bc845a7521e93fa037d2a85f2761de4a283396d75ae47f2c9901b361fe51": "0IPCoNcXGZRms6VCmxxy8fN+RJSHETkPPjShWdiuaTfN06lQwjC6qN5etV/RV/SCc2x4xvwjDlxbCGPbNFMQbcG3wPG0L1IpuCzjOn1Xv5A7cgk/11CGM8lgAmHiKFQJkP4xwGZ0gDV1oA5D8VDd31o6EaDKuI4df4jt+qemcqS7/IyXUSnWU4mkizkbUBAovfe1WKnKFtDepnb5jg==",
  "46c515458c9bda94eb2f91579ffa89e9a4480e6102a74d68589dbde24e01a794": "9ey2JiU0HkHZfUAgTwkA2UPuqLDsC9QHyb4vKkSNMxouOL/EPw0hecIMJKIylwSmpOLZU5ZgvBrjqEitTJgMnm2AR1k5bNM1imelhsem2Sz9mIE+quTh+C0nH6g1OjlJO7eY8VrEisSVsQvZf6+irxx4zVO4IKjbHzFpWWSEXIhW+UC5iIzmLTd+2b0Up5C1ik7BaTq5HClcFSz/qg==",
  "89094ef19ad0d7775cfb8f5b03b532a5a3199fb7f46b435702167009c61e5288": "QaIfKVGVpbi4VCKjmUKknZ9oRA65WqcKYWFxcQc21e8lKq/E82Ee1vM9VRMfcA14wEKF5PNGnl9iUUa8QyWhxmMM4pgWVXaSY03rzS822Yz85bl68ZFCH4xl046OxdIiMjKP7Pg5Jq0ODsLo9gkF3jmY2IIb+YEHor1fL861ZxRbehqODik/0raOJUQCR6Ns2jIrXPN6AGTcpnGIyA==",
  "9dd465901a37b8f4e0861a34e310794f02de64caf09d2d78d936016888409770": "ifavaeI2qfTIB4jaBjlfegVvm/TYvdFJMCCFvUQbjTI90FzBViagRdKS6ifIKHCdF1PKdHkNgok46iNLR8mc29+4dUu2RLuL9MLlLkLp74gSN6yaILWPB58KfP/euXjbJ0CF4N38usIneM/U3ymY0L5KKx6JZZBl8yy3/gU12UcAxS5luwZGSeLIUNTLSEFHrSMjHdso7q9u6Rjjyw==",
  "31a04ce28e3ffb008c809a5f201299ea6b9f181bb69340f21c89df6961bd042a": "Fjc1qqexsizwstHIPevOYUpw6mLwUHVsopcH+FFYOFgRka53RfcglsjUSVYTfPkWJNtGYjwAN/9RnLXoJKhnYg2rzAXoiSananIqSvTKVrXHZhzTMCfudQ0i1+reUVp8ZDnlKVl7RcByf7glN2gD5uVYJDpQQY/i0uVMLKBVMnBFztkawfc2txNENTvw1xBCCdqBKDM+XpA1EXw9yw==",
  c6fcf9ea7e67972b33e732007e34198432aab4512a534abea3eaf1e0ebc007e9,
  "2721c29634d634ac7fef6c0ad1542c9be07d6c3f2cfe3c9bd83256a8035be5c6": "vk3aIX69zFrfSjESZlxFRd32Dh0B99KMuMi6G+1czQ0NvJnOeYScDY9uaN7/k3yw3PqxvJBB5IAf0C46tjqxc4wbTDFUyrNHqiJZIbKV/2oeFgG9XBk181ARGh7o1Zw7QIOe5pcwJ3TgSm+nEZywsQGBkynndDqFNscHV+so2jw7f804QxXFLhQQIESlVseTw4hUyi/Jwgv9oSFs8Q==",
  "73c1097fb7f0d9cd79588272d59fec80e0b2253a7a47eb0eb8c6d54cab143a3e": "VV7Wj7XnnCY4Q06Ih4JuZ3QMQlptDKcOjI+QGXO2t9S9k1QzuBsELdO4YvkKJmRJRwjBdYBZH77yMOXhkc1Zd/xDFgTsEzpXXfn87dqYek7niD1J3lZ8ppUERbKUoqTDEeARrl/I6HlPBf68yXdilr9RjHXNv3GIFuJUIkrfveDf45It5zdiDbifckWLLc/PGUXoSBTOzDx1PU75gQ==",
  "05fd94efefe1bf127a4069db39534a36328c4975de52f7ec2f41482e467175ec": "W59CbDDdhdYgsUlh/TYbZyG3NmWrcYG4kdP2P7horswrEgCZsNQF4hVFkiZUaexHz7JNuBEnJdqQvwdTQY5c2Tocrm3zO4W0A2Rs4IyRQeYxjrQF0kESUtz3mZJQrDT1Ulse9bfULIkiOL6/gSTOGFPladz1Wqw4Txwill+lMmuLU9nk09Rb/Wr62SQQ4dx32xcnsdhkZA7AblWXyg==",
  "5e407b27b666652a58275cfa295202cb8bfcc4fb00768bcd6457413808ae3aef": "gP/g4VKkJR0zm5E/OXEVe1vfCZfd12CZ9yxBJ/RZ6d8gb9bK0YfGFy0PNHirxr1kFv+NsuqYG2+nFEXfbot3yleQ+vUo8yKancTegkgFfuDon298ejlwogRpR/5NMea8IEEHKI9w8VD3yNb/CgscKqEymqvlR2fC4DaJO0MhSjujGNj0Y/5B3T3wDuUt8zd1HkOltcR/VqZgYiX1AQ==",
  "1b22f37b555ad77bb91548413ff354a7b1c67d2fe58b7411d0dc21dbd2285f52": "a7coI/MoM1PSE+ICKJDrvSSLz7/Urws2Ely9XLO3L95WH4lJ4pq8Lxfr1tt4p6e/sxy7MqaeHwnqTFDVq6jQzwVuPqQPkqFu0DhCC0BItH6salOBfVlPYJAg6ry2nS6rNd5PnKInIMONX6Rs1Fhr47d/JXZq5lm0qK1Q4KQOFCAHp416uqFzd/ElSIZeVhMgqEPVFUrphaSGMZjKRg==",
  e2a992ae266cb88bf396246ea18179ddd8d4e949cf981fba2eb99b370b58f14b,
  "3aa61fd70965a70e8472539f9df6569e7e4325c96421584af51371d76990c576": "bU0YaEIwcF1tCNntfe/U/nke2SzKRzYs2GZ3wNdi9HIe3DJsBmxY4puGSaeyz1h7vuJdx9hcTUMv3WkXIDGQ9OPXpWkn4n4vkUkpYwonXN7TPswwEMI2VV17/OEk44YmMJJMHj7anPNUNqTVeKWgJ1e+qLhObe7ZAyMNhpqKF3Wc1yAxErlXnRh7CKO9snRpTc1I0ZlB227TerTQlA==",
  "092d5b3424ae48c5470746291094acb503330b11017bc6c8014ad8215cd0e24e": "LT15CjSK2ZXpdiD7A78FoYTBI3RqM6oUKcRFp3aizEdbtdecSy269gbW43ciMfjTwNNYARBwW17yjpGkNPINsmvIKF8+TJSt2o3mlUAt80cVmtipKvKM9ACZRXtd+t0msb3We0YDZ2v5ntAHjJtrThWVBjVzLCDPBcv/ssgWM/CY9w0PrBEeqP6+PlbeK6t1iQabPRgfMD7mOK0q5Q==",
  "46071305f5c6d11f01f5e4d44c0f638f8cd92c8edf0ebe1a70e40ea7ed10ae77": "SZeAbrUpGsZbDOAjCHk5jemSQlQzpZubg5ih1QOKKz2xjms1oi0DEOyRTxw0wRPbfKJqMefZ4XJm8G8GLmOF+hmofm2rUsHp3YsWv9JUHIs9F35hdGiKCZcT2VjwOo12qWKpZW2vyAOiSlYrQyEaIQBmVDBrRC2Hpx8Ru+3LSfzY5uQFgz2UCY6nhLd7706qKtrDlNsomIH88Ze8Jg==",
  "6d6f2b4a04feb83699aafe641dfded7d2ee962346b8d864a5ad7bec2e24223cb": "6H1oQ+RYcKlgtzSjk03CHyFG/DoZgeCuk/jTj+vFAKoCy1sUckZr2ELuEQ2L0emGyO2SXNwe81FL/BpY52Ur6VMgnzpUxM5DhCV67pTbMIdOFHtvxQgFvYZIX3HMLpK6DqQdeRBSrKBbpfsU355S//iE2iclvXVrdje68KN64nt+WkwCKipB0Jn2jSSqatlGG0u83pz1zto5rlEYeg==",
  "43902cd7ff97e2b393a6f948632aa0a95926aa51057d5baa947a177fbff0e537": "jP1ybL+CUdVyWdphh8frxwDiD7duOz9PDzgO1L+vGaqgJYifht2WjQjXRq6J/+F2vKxdvUjp+moL2fOq7w+X6GdYdX/lyxm8wjUIC7hAzENLy6/CSAhNudgT2s5E/DbbayN1eoq4Nnhd3h2RYkXSKZfQe5vA+FlJd6PBWt4RqMuLg4+reL5yxOm6vSogIl/CZYq6Kk7aDGXOYMbleA==",
  "6e53ce01f0ffbf055b9e251d9d21229d71d8eaef0b08abee6142c75a4802733a": "+jtZE2+jF0WoSMkBFF0OHbYM5QaqbfSCVF3jFRWcFZNYy8U9S1qlyT7ci/rZi/xTdBTym9GYELzyXM0CFHrNbajaLChpKFIs2goSWbAp14s0cIBYcVM1c5cp4I1l/VqVFw6dszBXLoxNyZ6oN7ZfgFzr9I1YjsRwCqWy3g8HXEGUvNKMThVFFlxg7mXK7+eimMcXFSFqJ5GF2uznDw==",
  "915b05f4e56e6858f03a896947fb4dda56906e33d7c1ca9fa300c7dbbd2377fd": "j5gzSbDQ+zO1IrS/HQasLn6s9FqZZgB6ABri3h2L31UcqMDCvk8khxO5hu8rhjElE9ifqYlfRzAgkpaH8w/VTHrcmmxZ1G4cAuZnODxt75WjE0Gy3f3KLCa0ltrwblbL8ym+AvAE7ybT43/y6/iuDSmHceLaZjeN8ft3dUnqGvRF9yZKEUN7caThTdDcFO5LFu+bxKI0CMv5t1JrzA==",
  "40bc74288a747cdaf509e02d76eee24b77ecc66a42c329864eb9209ad85e6097": "+njldyb5oi2VXLJLNjBmzhAid9PNxgc3Y9gb0+acHRNAzWik07D26dbOmjjp0qnG/iLMtAPPkhNwI7Pd/OSUfc+iNEdMFxzJkSlwTzxCbkPJs2+NLmhCn+rBChF3KOguu+gpZBce9cuhWU4bw3DNbbTiBBSAyyWwxjUeB8yOiX3Xtt+ojjjmJlCMJMRjvf2KXWKfFj/D/CE55+zoJg==",
  "55547e7e9ec6d379c5d5817cf7d95dfb8b1035e0c2f32c5b23204b14a9d8aa81": "SILd33VZ2N3EBRlW6GOZREEpzbi2QbwKlMPQ18IQU7Svd8eX5Gb/lqVbl6191YdIfZmgJEjHGvrPWGdEcq3KvtlZ/7jXnpe1nQfYd+HF9IWIO059e6wV0F390X9QIame40fZtLnSgrOy+P80NAm4C6B4ESi6xwNxFRLKqgPP2MV3rxpUZf8xaCB2/UQEGig6Rl4hzN5MhXSC3RkaNQ==",
  b81519e842a63369a495020b8df87dfeb67c60fe0579a8ed8e8ccdcdeec49f1f,
  bae21197c2479636ecdaf535e263af2c7babca16f9ee6bff595827457d1af9f9,
  e8b34996c11ae4a9bd9cb7477358382efc8d8c9d7049faa1fb0164db270204fe,
  "93fa908377153afc00a32cc644892ae2ae890f4210f63797ba10d24d55687107": "4DZ+lG5vIcpylZh5XCZZz2aijWKC/hTIDC6WNEbfBMGZ/9vDBzm4t/b3GICJ7zBMXQXzaKy1b03c1C37HS/dGYeKCwhSt5AzUgGUjLPwIJI43T1o4Ak/D9BBTNNLlzXANq/dOgi6l50M1kOofAI0i2BZdG8YM7hyBwW1H0AT8jsxHn1LmgrswAJfgdPRZqrNL+9O7yc7PUipuNTIAg==",
  "90cf13bc5187d2a3cf680bfe10ec7ed90f025f89e5d0a39ef76516c5dd875ec4": "NF0kMLWoK3kLXCHT7eYhG5JoU8xkyh+ABDQQXuTmvEJ8jsjng3Z0IyQicczxjNO1grJPZgNE/EH+1T3gx3L4nynHkP76lAUsNct9Gd1ktGjt+NGntLN4ICQHaINr4Q+67aQVqdkpueRUCWhRrtw8CAAsn9UrNe40eScKTpnWIAoBlEhQKId2lu7H8lSNAu4qnizV0/BGsQw8DmhJcA==",
  "4cdfcc32b768ee815fb9537e0ff43d7fcf289a6e724f9f3cedadfe762808b557": "iccJwt/1uI4T4JeGfseVm4+sbar1e5n9vEbt0cqx8wqiBqxo4Y6F7+IDK9KXRMwL47e7Xl+oh0/rEwtyVpQnbQWQGBu/P8fgBLZKHoZ8JWMXm3UN9aG4CxA8hExDjcomsn9tGQtD7X57QczMtTek8MYNUqxBosHh0SJQJLm1vOoRnhx0fsYijAoNoMkwuRvjub1GFPOd/TZawWry+g==",
  c0d55d6b861c2f588ba4d24a5c19c1195c20bb0dadbe5f5ce28f7bb2afbe0815,
  bdad977af5b870a0c026ef96453ea7de51e481d0747e6bb686491fa9b8be457d,
  a77e91c30b16d8eaaf72984b83effcb11cc8a3a1e25fee19426854919cffbcde,
  "73bedfaba95475a90b18017adba5a4fa94589a954923382e37c23e8928f0de3f": "VVaoJ9mBc+vj3JoBvIs+VhERs9A/zU18CFRehPN5qJRwjR8p336aTrdfxMrdtPG1f1XtuFKYqEXbRcVfHYt7pVn2uMgXgErvbyReKVRtx5pz7s3b36yFPQi7r21pJUZvxJHPZHFaMIQCh+9x2Z3MNqPeVL2Wjaxo0LI1bLHPZ3QibDHh44NkMBGzwND7KfphiKgvpK4bLiiivjXk3w==",
  "1046adbba3edd35d6ad9135d948c8a6603e9ce42150a0d73c775c9c359a945e4": "weu11EZld4R+2OjPfporBeF67ynqpzLYN5ta0iAcVEgxZ2/X/Gr9lLrs365UD7MOcftcikrL6bHnCK0LvwErAYSZuxRqRjKE4PH2mVJi0y2Co917qIAqatgsSq+rXGWjQ/w2ekUWS3O4pY4ntjkpNy0tn5ZdzFCSZiau1zpZ9ZcEr/v9ZftLiMHH52D0hG8a0vXw9zC02bE51L0Mkw==",
  "55396c83a6b57b6d4edf9f4fb64088f2d3d6dbea0e420f5c8c03cf285927a05a": "F6f8wfkixCIZ2+tU5BSARj5PFi0Fq/qGiUnk4b30L5VxGGXxjsT8SaQfqr1ELhxxGg+urWEnoJCfd2ecQnF2I2VAD4ZLV1s6emvM0otte8+39K1u2RneuHznBo4HsLD6rnFsgL0en6tR+cOIrlS8shPLjFVPGtGLY3QXkzVcMjNGy7r9QKSxEp/3ZdmwxTS/r1C8U1KoQAJo122TgA==",
  "20cf3d2d97a2aaade776a72a9f886641d4b1012812f5fa4b55425934f4a8bbcb": "YHF6tP8Jyn3MZarY9Kqy05ka7c+wO2frAZqr5G4QFUWkzDCjt36EzYgBG1jLtw/wqPV5WFf9SfsY/oquhys1ByGXdOdEpPm6GqJ8hRChJ6N/dVeRw7l3khNeL/MRUfwX5SW1/8Wo6F9bzdhbvcidmDhWJLK9mQUneqUCuLAaX829X05zBghxCctbwaPSP4qCAdjX/DLsKV1NJg7USw==",
  d90f6f3d3475cb68feb87673e3146f23f8b0f55e3e13ee3069438824378f3c3b,
  "62c5384d4559da7aff4005c86f6072812d215ce153f795d8b90276f1598b361e": "b4S083y8OB03kyuehb4lJ8c/+NVgJewbvx7PKGEmxCetxO8SWFFpn7VmGTLUfblUsyY3wbaWr1/840rD2oYuAuF7gKsQ9nJe4+6znbclIi1Ge+060iPYsWl1uoAcJWetnAnv3Tx0Js+WFBypRjhrj/gpuiKNxY1lFbtcVK4RF/k6+W+iYCTTmWGlZPZf3g1nI45ujse/jXOh0pTz6g==",
  "3bb51949d5ebb4cb84e653d8764019e763b05571aeb74399c9fc6365bdce9fcd": "57qJ3KSR7Pjqv34/PIFMYmaRAzQlRn/VRtS+VJ+8GI00n21rw8L1oGK5c7j+rlUYcyZ2Q2w9WCblGxuiIe+UG+e6FSOxlXCWmH9e27YY3MFnrzseHDLPAbU080qUqtw3BM1eAXx0tWtJ6KRhELHPh7VuZlE7WWukDJgmfcpExN5XIVyqxNuU4YXXRpEWg2PFUUm2DEcyr4QhXsRIlA==",
  "59181da08490f1c3152eeb6fee6eb4a11fbe8320fe0651b77822f684909bf866": "HQINJJDZbfzI+IXpVj4wJn5v6eKr0nYPRhX36l79OPY1rFPlOzvUXyu2g8eDMm1seGLj1TEfw90PxumNlz52kX/uihRQ0UJ7Hj36KUxZaxIjuNeuh5Llc3YBQjTvy5Jas/1WxSqjUdy9DvyTFf7HF1qbTT2E+F16HvoXs4kRiWitehKfEOhB/2k/QRNtb0uhO/AryhMO2N9eFlL5xg==",
  "9688522c1f5e4493e93dfc0f6b1d432380ec7784cab58b47e0649685013b5ac2": "LbyNdjOAQjnRVecTTG0lfQiZT9Hb3yIfU6kNIGB8XNIHzqBfl2Zffbgv8o+e6gVdJ+XBoUB/rD4vIQiZChlcH0KYD0VzqUxW9A9dnKuV/9WvpMIrzj9M1T4O5BIBpebBbNvjccZujuIhnSHHnuTFuBHH1Tpu3mW1fZhIluy6XGOAUPCE3rFYInS4uQTw15OV8HsDI1v8LxDfeRTt+g==",
  cfea965c90d7c34d58ff4dd2d15740c783d89b945cdffb6bfb5051f193fae056,
  "33e938a0b57b4297ab40c440bdd0a93b660b83607af8ba9e337daebfee0eb0a8": "CYaCr0D7T1O2MCi7ggf1TtTbuY/gEd6o7fn8U3o/Lme5vxNMVh+fP65J4VpidVAImb4Tqc4Q5yIWZ5tCuMvOioB+8B3WUblXyVVkbk6RcAZxzEKi8wtiNLh8KxkbH1A1JVyBvnKpqxJabhTIbndpxcqHRKYlqyVyaLdoSrc94OvKufiKlG2HurO17XXDRBboj6JTX6c+OFqHuKnI9g==",
  "6cd0a365dc1e04e228794608283501e9d88ac4ba3bf8a61da46695866f3910f2": "IZ0sEIZmQIPV7jwywF8NnBdIxE5MYmrtvkKlNQzu9hp5+/0/m8hKzk2euC8luwULfN55iVqXY4BhTVOfnq0chO/i7zOWIMaqfUbX8Hwl3yg99Ml9QukXNJIdgMSeHwgKIyCHG9KuoM8S5X+1RIR9QaLcNbpXq1T8MUME5ff5j5AQnNU24dlpf9jMFNLHpOIhkJYp08kBtuiYVm996A==",
  "13504cf4b6c0dfbaac99c4c34460e20cac477eac821816429a520407f70dd12e": "L2JK+HbW6fhwsWxr7AeX7kxKidNOppVUYT18To3l9xwj7WUgwCtz4eiffCizqdXj9VeT++x5vWo6XhuiwXWjnnrQ+aRDyA2J4FgxVNE0VI0p0jFMd1Z6IVMXpZaaxJ7TNHx3xPL/KqQCjX2DgvjyrxU2MkmAovZFNkkhOaDydB91QnBz+aT5pflTieheu0KsOqRhpJ+iy9Bm33ADQw==",
  c98a307e2754f532baf26f68eaa22944632255a4325ab2366382e33b292596b9,
  c76ca029103d640a66190cf1052abb3b52d5ebb9ecc5c1667078e00913e9eadc,
  fdb255d19c5c597ca2fde3100d8a06d0c5965d86775d71b59de4a1475b61c32d,
  ee6b79569dbb6ed1e962037827e998ef89585b1d5b26b1b7cdf822e6ef73e2c8,
  e1dfff5f3fa7cca7da9c49883dcb633ef6ae1a148c68d8819f74dd0bf2a882b9,
  "606ac487532709766b9cec152039777d5c826da4241a6e61f2ce10a8e54c733b": "+D2w48+TULJPOSxMynLcmOTKnMJ7VR0wi59P6Ib3K+pACFbASMPkClW9TaD/KWAZS5pkSSwKV+GdF46ol6+H1iGRbZYEL6jwfM2/A71xrbsFb7XpaX157EY3jcamZRTIv6w2XMkYOVTZRG2/b1bM6pRjnP4lYPJlh0w3Epciz6PS8ZPC3wA2hRZsbm5XZ0TVHY8LhiGzG/h5L8mhNA==",
  aeb8a40dd65006249237a9c4c538068edd602b9827cb3a62044703f5d67d934c,
  "8dcffeedb3d0651ca88e3968eceb92a5e6111d62ebbaa2cdf807c85977640fb0": "aB9qxkIoFH/EMkELRE9SRrIH84L1NukOiKj7GA6wCSQ8LabNzliZACvuXfQYEq8I5TReX/oYwtrMgAe4+SFuINODhkAw8I3qEQ4JRSv/NLJG3i7nEDwDhPrtvcd4Sd0mzukbhcL6EmgWKvLl5zoYcK0KFyvkCJbLX4hwHRDETPkGY60kK0XX69oceacvRt8CCN12jJamm7e7dakWvw==",
  "6257ed7de8da9eb2b4c1bd250262aa74c6717983cda48e155ee2ccfceed8d3f8": "v0gZ/d2ixg1mwDccJhVF9BLLt0xv9x2m0g11bPvC5GN4w5qqbdztDYG0uuvmH5DJ6SvOVi/+moPMj0JJDZYBRHqMNS1zIXimCxIjgONU2dn+4LqrQyyiHYPprCdlPBc1kOezK0W8S94v47LFKPiR2i85whOtodcAJg9L3mzmaWYZO55+nGIMtXHb19KtBaa9074A2mrFqih4u8reeQ==",
  ab6d3410079cc9629dc5f1891462dd6f8c00c4f2b2d9f9282dafd3ee85d66226,
  "4d544fc98763243369cce9b23c7a0b54e4654eba06f87e57862a5230795c3cf2": "7NvC7TP2tu4V0R8CBV25JkDSnSoVXnqtGTtzpL1mbEgrTR6G+WoB5x1GDxLw7zGLbUSWrE4VSWlKEzQbhs+oi0ydkZjSrK9jZcJcmUaitq3S8fWNFR00m5vlwWSUqHHpYgAiD86SSOLXZNc/VSZloGk2VKyC5vMKBkDiZb26R32pbVSTJjgi7e1hEVPRapCuquN98r7mG6Tn4FUFEw==",
  "79e84dca9efc166d46db033ef59f5e61f806003a72b7b3d65403ae294aca0705": "eMa6MMXiyTFBcVeaNScJ5n9QRLBQ8JnFVablokbXU7QIpunajOoAXGBrL1Bnrpcw5UazpYtraYZm9iJ6657a/bs+538IFhJy9wQPZlhCflJiGoEmwx2CDUQcCLtgST0W9cKuwn+P9Jyj45Rp+tpJPJIj0VTvsVvEpcPh+tZKeqN7VzcyaxFKZ19jxLoubwga204W6sp1iCoMsjRRkA==",
  cd2dc278fd06c808c38eae261f480a3e16169ea4eedbe64b7821400fca51d4b6,
  "994b64e1fd2327fd54f55bc9eafeb1fb41445c961aef95963a530a525cdb6464": "V+G1tlRiBR3nKLfcIqjUtNfALb+ze8rR9l2eNWnsYovcm5hYP9DPG4wqKE9w/FsooLvMMUylmhQgVaICUYZJoZ4Ma1n9XNFC90PW2Hpu2Vw0NzMRAJBQwst4WDdj3MltMnEcbbMLTcnUMup95od7s+Sosil1aAeEt3A+nXdKBVEIqLEWk27q3YWfVecg/WwJevxZc7CPXAFEk6oCLg==",
  "7ee02d4aede04646e6c560086fd5b46ee38a561fc0e71473f538a0eb98aa1c00": "GqqWOuThgO3wz39SrIzZFu0Eoj80i6o9XmgfMlW9I++7ONy3ee7ePbP/2XX3KwaTnSI1z/Gw1QnjK+8NkObID8WEvTY1/T0j3c+dXQALgJrMHgSwNnGYZeOJnWGCRO466qAMnO8ws5veLauAAiztAsWX0SewJCNOMCeTvY3cEj4MJskCXO4xTB95BxJzGFBmFNteB1Z+UXLhmMXQwQ==",
  e8a4ae7e778121e2734ffeed7c23a957b6ce70aad51c0ee1452ee2dfc43712a5,
  "0d147ad5c143912b71d09fa0cdefbd0318e6f7b8c23bac0b02cf889dcb2613d3": "IG0liVhRxAMncu4J/N1zjb10ptu990I0SCbVqn2HoV2O52RlER7Dd2VNZZUgmqhE6jRvqKNSfhnlztngKaFoffmLv7hVK5wJllW5jUDB28Uk3WbaVdtWrbVMfZqKidXMkm4TH28EpRGVJdKeFGidiZLMsNiIQ8tLmwSvUzxXwD+USU2HIMriBQBgjC3IVeqAaE79sgJeQTeVvJ+Bhg==",
  dc7a4dc92ecc20270acda5f6fd51eaf794c765a2d7c841baad0fb5e686cb5046,
  "4623f164e326d8013997ad7a56ea67609b05945e68b8b46b44844334c264ba18": "8lHN9Kg6nY9+eDhZmVpZp8HXWUntOnEso5RqJbYv30fo1m92rzFNRFoqbsQWEfcYWNqzRcCGf7cIpW0CuJR2Af9ZLRwsHEYncpqJAOhY2UEzqZ0+5p96/WK/+p/LbWXYwzdfjnT6XxSInbBLlfHOMMJY8jCpQcXYYxFB5zNa6k3S7qnwmKL4yKcHMsyxrqBkn4rTCWCsFH7nRWN5dg==",
  e6d5507535ef60107cc97b269406a88e2304ffe8474bcd5ccc73e244ead2b729,
  "3b610cbc763441d9332579188d052560e105012d8321ba51c51944e102b0a30f": "E5Li/GBXlnYFV+Zj/Z2UIdySET0TJ1whFirGzWknGuWoi6uifXxWvXnpZgEBibBKPv7kIeNIB+lq4By3VWtj88FAAEg17Xa3U0XEdFPgVyg9t6eG92PUMaaMwm1GIH+e1lAOlETsMkpKtTfP/uhC5IEUDv+HCJfp2UfiCpwiwsRDblDmQi+12VIP17ZSWoxYgjV0OKVc9OSB5ctigQ==",
  d611a71dc7da6134bb5f2c973c299f48e54ad3c517998031c3c73c8b2187c83a,
  "7ec3360bd34490a14606f6d71c074ac956508254a450498f8b07fb6b7c87758d": "bBFdNoNq+szbem5QxvZ4REd2RSwTTxKnxKm+gze4QD5dCCnQ/f2zwsg8tpZeUouwyFbf/cDmwna8F0IpbUuKHgKDfM/ctwQ6THtA6QOhowMMgCwj1hMZpsaRrhIBvzpdHlaAbnVmMhd7rqO1GHtFXSzPzzpytS3WAUp1qKvOXSzRqPcL5iDeLORM/Wfeivl39z+0Ke/H4DZY+DY5Fw==",
  "6a9655ae1cca9d7a4da12354cc999c25bfc29f06fad125434a503a032ac2361e": "t3aTuW5UPVl2WWt5wRn8E1yhAEpVnaZECB6Rv8b2vQqp4h67EwcA7Jna/jWMHQBvEdQsRlT1hoPrIRKcaakeoirJDyX3BvgQvimIwkZOUd+UIlTqLnMaL9AVJLMG0Y2kTvdYNESijyHECGeCH3A4YsmYRQ3BkITRwBsQ317q4zAuZqsljpp1AXfFoLp2Pfv8KU3+nImuR2a8ADn/Vw==",
  "12708528aba873e910d41d5f7c9104e9071b1ef72c76b7f7de467092bd323e46": "PqNkltumUPlkNEj1WoXXXpX3hHdNxgkep7/eEqlKGLkmEyuUg9Zt+k+hQnQiUhUxUBPl6hfCaO/vQrab0uYcTpWoPhV1zfXmwHQZWClu2PgHQMm2oYI1KZTcQEQuR302/wemzE/uI575CM+H05dADrRylTGRBrORTSMcNK8wxc3H5Cl0NAQQpRUC2Y+5ArvIigIPGCtILQWsIdqBUA==",
  acd85130894be08345cbc54b49ec4b62e1a71ce3112f7b9f9ad211ff49a8e737,
  "363bdad331e496b0e0a1b0d57f7a9ce6c46421607f2123cb0091ab6b88f71ede": "RGrSCfCKig0DwUnGxQsBKiC1Vh2empb2QO+u/xCR7BmVL1F/hqonvmcRk049OxC7lxIGabSM+AlqiCOXBPSO6ltFRxNA9z65vaa6KWP4X0YeM3S8KziMQjvAAcV55TwSg6da0t+2923yOGslLnmGK/WZPlo+GSMrd2joOuLmeiNgjyx4yCtxyLlC9z4ThWL5N6w4I9zo3mwvLXGgxA==",
  "03851d03c9b3e00f14d405a306a1c34f86de4c591dce9150967464a56c33d84d": "c3BKDlovUSxR6PMKyY8FkYQIhKh5PAC3W0JkGadFUAXOqvoe8zihEBgNdOJOXwPZ0zDmKnV7iSJdhE+l2m6R76WN/iDsVUcNUAdCub6qF3cY3CTjwsxBmxdqrGWpZcdYxSVBfOnVG35hrkaXfqRD6Wy6+o+/Lr4VslE1D0Aqm5P6Els4EcvyBHDr0VUWL+DdtPCQgQwYGGxAaqSvjA==",
  d0cdf74a59693dfb92b77274018b7a9bebd1189664bc5e8981e32f0aed288ca8,
  "4926433f58632c4a3b60f300d5f42379ad59cb683a91e38c6231ea5c88020ccc": "v3XyH9zSspDCMPZMS3Av0PSr11MLAVy+ZVC2qPGKOkvM/YP8eXBOMiypmJ4bQ4ZDg9q4aIl2/v/PgMoj1ildki5IhDVHN1eyNTQz/poR7U48god0fGSTsTw5dBx4E/4/eKGcUnwFc9pLp4RUYLmtH6PMs94JaZnupDAM5gRWdAP0xc2K6FRRCTkDK6ovRr2ANbRUFxhEliVbAUkYcQ==",
  "1909cc6a1a938001556502b7edfea61b6e7ba8c6fd22f074e61c5ca985d6b499": "V/+UiOQ/6d2wZW92l6GYEtMKjS0WXrGia6PwVG6K0LFQz3TOTYo+3K3FijL4/xlaAY7KEXgvhAhItAyJUxXVniGtj2Pjyp/qiznFtBEbhIlJxZhTVO2gVQwANQWtHlOPYF96QREJ8MmlM5tB92pScL+mFqTzYBjPJS0C8X2rB5zhN7ylXq2TK8n0MODpgL87lQPs61lcR7lpkvsmIg==",
  "773768129dcff96b865b4c285b403d8605f1f16c2e27d7fb57876ef4e6014440": "IgoZfRILe9utAJNalT7yZ5c8p7seZByGz74AsCWNwSlh7Wi9D3dru03iVd5FzRZKutxOk+6vV5MDHLlrt4zPUOQrrisoJ/Mhr2vsJ2qqRON637JglAp63ev/6rDGR/6Eutwwj3BP+KobZR2SBP+UCZfIdchzAtoyqHEFh/Gc5kluysrhXxbMFDcQYkoZkxv9HPMgR/gcDWUS/OmZWw==",
  bfbbb57df0b4684149896e07f0a93603534cb459827d0298b4e2138832a3180f,
  "39762fc7b84bfc8cb40094bcb81a6d1e41df8b6b1ab12613d8e50ed5b7312244": "IT/gJV//7bTnACtOjkU+rQs7KrrA9z311qz8EGHoWUMFkhudM8eMovzEuLjKaAsuKhohv7iCHReGwPwhD8v4mqtgNiVBPA00JuqDA2GJpebITV2dEKWAIOxJlwcYPt+lqgTiTisyDdegkpyjAidheYnb9fxduMjQOfzIFQ7bayS6p3lr6SF6rq++jl5BUcbIJdjClCPePevnbv+38w==",
  "91a6619305e081646e56ae459debf3da36788da1cde6677d440b54d9fc1f9825": "WLmmlhuJinKaEahIqt4xANt7NzAW9lcGnzXvjRixt11Gc4ZJ8bECDzhEY2lmx3exehmUBdz7YKcbpy3JlFoFf+eplJRna346gOHTcHA6dHsDMgDZN8FFj++e2NTLxB2/3G9ffB+/QapzThLcMfSIGv/KIi8q9L7+Ol2fiP561qDVcsycM5leppVGBmtrGGCaiZUyW087rrpmhFring==",
  e3d7b655835bb77d1e4dbc65066c308e0053c2657a37cba556052670029d0f0a,
  "7ea02533300913e4128e315b708c07817f06c388905a15d9a049b0b6ba120770": "H6NweCAx/N83IH+MMGbqE/kFYs+6+eyMiSjIJ5Ttept3hDBvfGncyCSkAkzpNM2x7zRxRSw7IjPgbvJr9SdZ1wk6SV8lrc4Jifz5i50hhXtVWp907QBmVjdeJ6sMPIrKLwckz8goGfA0l3tbydeyHNjF8PCg8uhBSQU+jnZDEBTEudNw1kHFHv0Wy1TOeQr3/YbcDmXtLkELapXzdg==",
  d3e1d9147e1d2844f29b9c81bad01aed6f7730cb4aada564d328be3e1ad262ac,
  a734b62c5063b27ea563d2aa12aea97ff58b18b5c1427621d6c232a2a41f288e,
  f6b8a203a50140f31e02c72079f75a3e91ae4c024b0d501af7cce2cc2eab5bc8,
  "2d928255fa977d87cd7059a4cb058b2b3f0c07b49448fb2df686cbb4e7121dac": "iyNA8aBNuWzOREMK+W2fyC3rltDV2KuhS+9GNWJbobYE4LxW2ayw9oi/Y1EZmk3gfHAH1kpMuXnxAlumnOUfQzM+Fbwt87PRiPuPySQqv0oPHqMdm5NcYUKdCwsgnDr4OJULjh9ZMBCQx5U4foGE47taVGQm+acS6tVp+ZN96NNgVq9200eFRv4T/hdbjaCBDKkWnsVw0qphY6TOaA==",
  d9cbeb3cb9c48b62cd7f27f1e5f889672f0a7bbec2bbf44b7ff81e5bb14cf81b,
  "8de707884e07e747a29d9b74febe7d25263896d24f54f685cf81d508900ec7cd": "lJtm+8dHpBOCCF+kEUSjlSI/M9iXis8HAyfeIYwCCiPm6+u2HLv302j6yrSKAf4NBUQi1jvbI8mj9uL54iNx29ok78IlH2UjheNq9C9+OqjJ1bLLzVhMOOjJf08O6uGhFrlacJMrw3JQjyu9qW6+5YPng1h3qu7K0VXRNanf4GOgpxBL5F50cxI2GD/NMIRHHfdyoCTJamLJhderUw==",
  bb2e346a41ddac3a24f1fb051a4bb797837399ac75824ab8f861fa33f893f0a3,
  e3919776bdb9490c29dc58290511feffd75b74c689e950e447e279ea696a553f,
  "65c6e161231fffc0d659cb530c083f47a02b3065699129af6259582dc6fdb6eb": "BCZRLaD7jWS/y/dJ7mzGX8L+DamBtYKQYZhDA/g2R9koJKY8y7Iv4bUPrBO/7Uisg0LweA5IiNhjuyY6isfxXcXT3ugJWXEca2DV9xDAYV8oOgD0hFEnARGD8gkntCHItIETR+w9PvB5L19gRK4fEZ85SA+YiIeKc41lZeXH1jhPLM0WlT0t72/QKj33H/Zx4ZxkRjWA5OcgNKfz4w==",
  b55c413db5d6034c194ff92a332c80cb55b862fd5731a45af41d6957e34ce9ec,
  f9fbeafe77ae2e405ae171812209911e105300feadccfe5c6556857dab7dcf81,
  acfeda75b23c276419ae3c6a8265074c000f5f8fd78b2d886b9b37b33ec1f1f8,
  "35c80c0b239c5c84467fd5802cd606e6722626c2a092ec577aeadf049cb4e05b": "L6uHXH/QM5shcN0E7Jig1yzLCYUeFfH/mTuyjuo5PpnCngKGeCbx/5cPx6X1d8shsBPsa8fe7Yzpf7elVvIlUnubCCC3No1PWonVAIn6PjSyJQVRdlfZ6RWdScx9Zj08bCDcQsnE7D1EvUngEvjwpYU3nNCvbI4BXBtoNcu9fb8RH0epqAqLau44c8sD2dMDip/pSipMqnXzpCHJ5A==",
  "1f10971d04c26514c05390afa1c9d06e69c81e785876e6b5bc5567f18ff660c4": "fQpCKPrRxurqLsLbh9Zmhkg9AZM1bZAqwLZvOSnUBeitAG4zlG/dN4wJnjBHYAJu2aG4e/75lQlGBLxNsaHbsIcu7SzZuNxJYXvIOhuCuHLT8gTD/T8ZPzTjLY0jgqqZJeOW/lThR/dUfRs+TTBV2aZbfIjPKNqh8oKD0oB/hLktZ3ZqFG1m4ct4KiSt5H6865ErmRn5Q9OquVjXzg==",
  "912d53146b2c1231a76ef7a69646e2d0324a091fb8a643856b2bca009ae4b97a": "BFnUQsqwXJz8QwJ3qC0E1U9B5pfnYn0AjtJjFQ5P3rabrKUAKo8HWpnOZ6ZZyRx4bkbwNkme3MZmIIVNsYlPw4BtbO4uQo7lJmzwC23q7NcEW5681AqkbZKv1f6BTZqTGYgwErRLyNbdTPV34+/S08cdFHbmj0Q9qgwGc+6FrNvIwMEw8AStI7IHAakPVO0v9WdkB6sUR2HPRpdT+w==",
  "411de32f879264af28d4e9f6a9c797db26c140c0f65d8dd28d0b2fc4d1b0be4c": "mIuy9tG/+IOABas7rbhEH9Bpe/Ycr95EiRD3O/MTzmZLtQmr3ZvhYGoVpvbYeCL/dgT0+hqoHiq5A0mQqk7coDn3ygyzAHg92RKZ2hVAL5gnymJ/yHl+rgQQhQVovDU3+vgrSI6jNthfoinzcgpOM+3NwiFRXi73W9clLNTwbgZgHa3pDMDeIZ6YziJkuumdD+K6SDK1Y5NxNkbYxw==",
  "66223843f6995b96e57531dff5d737671a6e7f49dd6da6681129ee4342fc54d6": "AH3EQ5yt6TZjHs/twd79UBbq5e4kzfZp6sQEf8rzL0Yoai+hhFSAz2LAR179JaBHj3N6vv8dbZ9Ly8GMT/09qZJ+wJwOZtVS23GaHy+SbTW4YK6DkrwBnD+ohUUhhPBguwnOWuw6UXXl0MFZnFThqW8aEWPJ3eTBoZO4m2H97QY9Z0PjjJETdiwE3Re5x+KBfOPhmF6gEcg5+jstnw==",
  c36f3af1e5f0d23b8110b1830e84207cdf160cda13124463681cf3e8e52e57a5,
  cbc76e011ff3474707cbec36e39798d8f96f2999b63c6fb1166e51c2590393ee,
  "0eb97b7d2f398d43087e3f7dafa6c3cb7510fad1fd8d4abb947fa24ab6b7c938": "44aOS12fC9kn4LHxIFpBeqRUOZGfNA0RM7RUbWveeGF4U9t22P41PIRaXhTKcJeZ4EWG9Jo5BoW0AP7fES57g2AlvKntMan+jxZfNffuDCF+tkS5y+DNDAueMs+Q4qWGYAxvBkK20mrTZ0M+XAcazd5idc2Tw7aL01ORzPLqxKUdcJvvSiMZtfwEkMUFBPsw3mk1wYUc87MX7lqAow==",
  "88d1a16be809f7e7e529fc5f8fc94c25ce31a654eb8450cc4be92c0abb535d3b": "H0ebwlfeSKEs3YAedwF1HegE+wxRPC5mmco+8NHeSnD+fSyWmbwnFNJ6mHGLthvsvzgH+/ZpWRAjEB8vf0uYKdvb5yWPayUBwl8aJFmCSfyxv8fRJIyMFhubyfQsXIh/MbM3BPHl7yNFkPvLk/rO7EgDYSSNxa7RUKKjOANqFmKAPk6bP0GOo2PWfO3p5RFXdAiSDr7c4n+fej9xeQ==",
  d661ead8e860b46240c783a992169b14e7dec41d55853099d96bc651d2f0e42c,
  "39919f07d5667266e4b103559789fd402026b8cafde491b9966a51d6ec8d48ed": "bz/oIF6Dz3EnMBD/9GE1YAjg0/gEQ34fRiVdnPeKpibw0h1bdPCERcQNwKYvl3G4v2JlEUy+t+yIehmeCaYqAVIU+U+qwTJiyNtnCjFxqfmZH4QZCmM9oznzp5x0k7umWqAZMUqJxvWda2PAtP85jI0KY93LlZxpCO0TADmSvKdZtx2KgKmWaNwiHprWygKLPHHNwBz/rljjv1GbrQ==",
  "2a932772b34da023fde7f4623a6a6190de38e1a8ecb80af91fcbde2e247f2428": "Ow10KVSVVgQFVWeYegClzKFhpKbNZAFN8Nl7I5odh8GshRBPOdwf/VmaiTD3tPmj55ueeLBIdWtLd12sc7C4YRxOx/XMz4eO6OnbIq89v7m7WMXAL/sMSliczUV0Oh2UX5WMcfav5Jr5EGIsarF/QbV+Z6OV8v641SFkx3LK8GCiGbatKHUoQ3lFcpgT5XZ04BG1MJ6wGBeHxIOpKQ==",
  "3b90a27f0248c2f8d7700a7f618e9a030cfe4cc5819e37fae3a106ba421a4055": "f3qw3fKF8l6ItWdQCOn5Apw53kFjfPtOJlmc4rpyzg7W/A8c5qDpmFGnTxVoyvxpXZofapcpXNmnUTsu1jiBHMl/HG9CCS6hP/MUu/8yqMBFkHsh6154pV7d6Y1u7GymX7ghBAzExhmBqcB7Lrg/YTwC2sBV/k1V83MKNSzo/PoBaW33QJ3MFLwq6bMjI62vYpqZhvWgu2TjzQ6lCg==",
  "06dc60a66ec54ae29c8724bb0d1654b39789df3a1dd92a5868d4f93b9edfe729": "7OHg1TI8qgqJwLSaKgDpWgKsgUFdnHxqkeyzMFbYWlPLQCx5was2Mexd3pd05WyzEfH7UWRtftkxOcX7G7bNvrv7p4Y3SskHtlPKmAcCeNj3p5dx491GJH7QqIT9wtJKSsIXFezdSC3WaQOmG5gYW1dafQjtnyEs1uwBrlLLHCAdAZ7ZJBKrtBC2/Wur36ckP10wTqOdY34sakrqSw==",
  "38d087776560c67ec044a5daa4c433474c50087da7543dfd69539ba1f5124a2c": "FaO2rSzzbJ6nQqCdgGASXkS73MQ5ly5WMkmZWljtofsQAUQkRxSHfoimtgLAkyZUgNIpyjky+gIrmDYtPSM72y6otJ1RQlw/BvltIgxzMNzCND2oXEiFfTeZP18xIbx1KZKVmrV6S/shGS+4Eiwhn/YLxHU9zRi5pyhyiHwhsBTqOMCP3DPwga1rwQL3AyJRbjQD5RHIVYJTxHPgLA==",
  "0e36ee1f676e9cde0aae28bc25b7e34f96be3e6343817aa39c271bcf2f1559d6": "XyztwnawB80kHtUR9P5daiXPd7hGj6XPZcgTeSGwvyS91pJCMufrSsgkLl48EKUepTV+G7DfV4VuJVCjewb8qwlBjXHgMNmd85VfoqAzyWTJDT0D4nBx2URl6k9wfXYZv3qjT6kucqJTeS50HQ/BNELVLteRrCX6aR/6FgibzjlyP8nlaEK/knMLTAUsG+gxyIvp4DAWI7b+fw1rUw==",
  a0caf7069434ce98238c4eb2f75650c0743ae141c5de75e167800300c7d63ba1,
  "8c750d7882459a9dae74fa09537f7c61fa2ee37476455aac166cea826f929d94": "nye3gJXPYp24+jjEi38BbLk4IVLS6Khi74G4wdjOgFaNq7dUsHTo3egE+cGc1YfEypkUz8q5HzMok40m9psoVQcBYLoZyzW+hH/hjubELxeI0axhz75rNwq4ZdLmH17i5fdH0anM8pcxdPBGyMO0vby05iu1pQED9VKzsB4bEIVCbBACQHKFY8Z7MQpE8T5hHh00FOQzMotzY9XNbQ==",
  "89b86666fef5a73123fca7d9b7d888e0160cdb249baad0a7c5ab80894596fe7d": "LvY1PCqk0yLNJeklZa9tKiks++8fTkTI4uH3jcaTpTEDNW4mWvc2lzqr/6k/8u7WlRdn5PqpfYyFrGoauOSG6VccjTObjhmYS+xfnYXCFp2x9vEMcjGCpNlrDUDw07uRNp5ReosEpFqm2evHB38nCuwXc7mopiMtFqq4YFK+jyyeCB3zdrwc0On9kTae0fQbsKkrsgtRCM+CT8uVUg==",
  d6ca692266e92ef8faaff312327e239b482f75d1ce16fec11c2d5a630f27e7ed,
  "10afbe1676c754411e1416c880e71823472ab5962c742e6444a77aba83e5cf8e": "nk/rgFoQvc2qfR7ChSxiVZPI8SiuiczWnhzQTbA8oTzidjRzxaJNSQjoj9fM5eSlamzCRY22MCrZu/npv4xBTcgu6+602CJTZOZ2/2o6SpAVJ+uuV0EmxTbTevQwEQOzmEJp4sSUpEfZFLTRk7mgnlmHddyoylP23GS+I91ocZ2qoTOt+Fh8QkgXVmVdVQdE1+x03+9Tek2rNdj1Og==",
  "818236bfcebfca5f3851cd7a909340bc99bc93165e19c6cd8cc86dc5b719b024": "vlupe/igKCmAWVaEA8J46GgKKbgrY60xzY0o4tsoLcauqC3soTwVg1n6wSPdFoHykDJjURzHfmRtqzNSgZ/2NyWTyGmGBrfCXbvDcQDyKuIHaxwT1xmuyXTzyo6oH+yAkZswkiw6UVyEHT+dpQ3hDHsAyceiQsF7WsKd+/H0xDv037WfCcqs0vLYgmia4deo9ra07yTPZMNkocJqSg==",
  "30135fa6a44a46088d9cbe17250b7fee076bb33ea624b974b08a2bb5fb01db87": "PBRoG/+wC4q5M8vBJ70qoLplcUx/8D1exMdUvPdd1hK873iFNR70wQBzDyORKkVPtwh4uU1ZlV+VihyCutAK9LPW1dM7YXDM4c1LTu87pMUmynr/SgckNtYsT8IDRqA2XFpB70HkUG1R0fOmSsdt6GkDuN8+x3SFpBQY586KndNDH9zbWuk6cT29V8arqFnTnMRfAhXzs8lVoEIwZQ==",
  "9d4fb26972948d343b27f8a14db08b2522cb9537d9142563c9803290d58ef2e0": "v5zrmLIIZBqHklrcyV/I+mx04U6vkOrHsFVa/b6un2AQ4REuruLpj9XAFkNU0DFatQthuIE5S0FOhn+w1jRSFvQ5xCfKupQyCWWDHA0xFmRX4eq/hPfuvr3aQHUZwGTZelpOhdmX63yJHdV54JcM1lnnjTSXbxvT3H+lXSFha0OVXiIJLROP3Bh72ixCE8d6c45QIsss3/UmStQTQA==",
  "69044d0c6210bb673c4465bc7a03b6535c27441a629de2a86cf07641a8c54a7d": "rfvzAtNL/0iscTiFogjF99VE0a4cAmt3Hj8dizdcMqauQ+NvAUtHW/q4wge8G6TniKeXKVB3LST7z9OenRJXg5/SE23Z/XuKZmfg53fP7p4FXI0q8KXEcXz/MQ05Sl/gdXktvw40fGnll0kglFRZKtBwgOT/Z7UH2934bifunZuWRjrsYptLycA296yIO1aiesfSO9vtvRCQG5p1WQ==",
  d9f1ed1966a561f431b1e4ddfe39d1a2259be1aaae8b64486b900b45d144fd71,
  f4298a09ba5a8ad8f4c989be65ff916eef34a82343264117abf989731413e044,
  "518c0e04ef1750ed06366285a82cbd0d314599ba91d465e406c9494d675b4838": "6r/g/b6rVriAEbIIoN00FrESI3Vdn1hKE05XB3SwAxBO1uSUAfhZ9Kj10SWVsz4UelR3WUecsqzVRn6btmoQXSpbhrg1ntIGTjftkvZg7Y3mInDF4CAVGny9mNuNor8cftvyLXH1Ea3SlFvvssvSCBdekmoXSP3hNZh0BE4l6ygSUT+3DHUmQ7lk70xLy0xNH/D9hpNoej/Y7pLDWA==",
  cc8ae1fb2af4b869be06e502a4ef683b6bffec4aaeb224d95562c6c924761e2c,
  "90e27ca110378e103e5ce0076903ac48f4020d5c23ec232957a7942acdf55680": "02GQPJ2eriuLmeA4AgIh551eu5+3R8OILgbnqmxSJUt5tfVQZkhpase/Zh2EouyXI9/Ibny5fbK9nSTx5Vqlmz0ebk0vlfI1iiNNq9QWosOflhrYiHq4vKTnVJ3HbMKyhrBAQruqedybKZ6rRQe8BO30I62uvWo+lSGfNNqjhrpOfaQwILgGTDFMCVwCsZFB9eoZg26HQ81Ur1fAGw==",
  a28998e96be69f02c7524e7889697164aca6bae810437513f8e14b5567a7f379,
  aa1caffe6d3b79f7b3df942f44bfe9b229a392238955917ab581233228f20e6f,
  e89e0cd35acd2b6fb6a037ca332c0cf19eb1d440fbdb4792f336208a3626e8b4,
  "91b5694ae5a335857425114d58697da42f8aa60ce46c78cf0cc9e9b745dfd9f1": "3gpM+FuoTIm+SpPwWxk0iAZz7kKHbhEbUYG5fUZyQ7jG9+PnT3TwqgCI5WgYyZTJkMG/fguYoAdZyQtxZcxjFq3vIm15gao5F1HnBWxsZoLLXUSIejRyiFkY3SbOjAm5sQMViSREyFShhBqgQNgMQpPZRJG+MW1/O+TQgbCCSoXnf57f0cAVZSr45bQo3geW6OerZ/rY9SxE6seQqA==",
  "0ccc6dfa72cabd93f6518b4cd1ea3d3d00c2c85b2b5dd30549ff2352ed26cb2d": "ey4y/ScJOivEKmSw0JI7d15n12hFdRfoUS/BrWNiZjGESjVwakfuIqRgLYDM4XWFt0u3D2ml8GYIamacVCoPjZnB9njNr0nryy2WrOQ8p51FIi7DjLn+T5LvDk7As0bZq0wOX+jKWqF1xtZ5SFqiCrEAaFH5FKx/Ocp9sZM+L6zVaNjmQyofuURGuNY4u7sJ+AfVqkNKcDsVszlh2A==",
  "3061827567fe328a64e70136da453750f5b4a416537e43600e3232a0d6512837": "nNEU7LokdRythF17iJgcdyk0ObwCPRiwmSSW/kD7RLGxqGJhcdbNUKKeJ1820P5JbXsPZNpZZv9G4oKkKU/DUcYiIw8kHm4W7K6gW2cfKOEqV72uIISszTkuXm3lKaDhRiDYj9uMbVSysFZapCc+u3S5BEEyDKnjqG2IGKbmyiuhZm6CwSEI0IhfA+g/AVe98oMPnuNpAK6+CXP2kA==",
  "81a5a0e8f3b2129580126eec42864ef64074b13e4fa5436af27c81714b8f74db": "+ezjRNXTcajz5hJStxCUGb8ZsJ5VaRkJAVp2NzMWQiPd3+fHT8q0cjVw64QIutXt/sNqEBEyzxr+gyc57FzBIyhXrxhpk4wTKZrpqJcFQYgVZoHE/cOgua/x8o2QSPkwgOZSX4cNI4QsSIiZloXLguzNa5Y5yeGriBnLrsIjUEfOvWqrHF6GzYrCXB4ijUmxsb+EXv2gnOL07Rd1CA==",
  "0f8e351f0ae70c341cac22609ae52802e45db8ed9470e0cacaca88ec3ffd9c63": "Mzroc1/kpGXJM2oPQBuYmDQeoUcpOcwhpAW6wf60bkRVY2jEMVW+NV+KEZVbKFnZr8wac9OJKxqa7ZZGPhg3JP3gq9A41yrMv/ZZXFb6npKNHI9JNKU2t039E0sDo9GuaeALTkoljremgtwElTFsNxD3aT6Vd2xZPv2UIVPxyCIs1s9dV/qK9meD8yoqbqVWjDSgwSe9E5RratUedw==",
  "89ee983daf5201b4f698132466df72968141ab44872f296cfd93249eaae08bd2": "Qc6MXt+vpUugshhha7khKYReGtlpsAY56RMCI32ey7XTGDtr+jWq4WK4cMdDayTgAz4ChaW2wJhllCVr+KPwPc0UmdZCu5laRBXWJs6lJtbs0FBCUtTzDNcLnAqWDGPEZ0IISMpsU56KCjYuXnhnV3HlkMZdiuNsM68vIMOdI/jD7GJUHl9Wo+ReE+vrGLVV4ixPcwERXUh4/dnKoQ==",
  "62b842043fe5c199bdd2def58a03947e00a0f2f3a6326bf986f743d9919091fb": "9mcJrYq1Zott4J6Vn2v+TO/PbMu5jBqFgRe5H9tBMc1VviMyzyOP3JOrS3pkFtUglaPkGnn1j6BajjdzjZZYbiiuKFbVEKfKEEH+0eUAabemkpyX/zPtGu8O6niUQj9t5dkMLpcu83eQY34+m2oCdtZnAlW099kQz4lWNUuCPn8cZLFfO2zTNeGno0lUEoAC1MOVUPVPJ73QNLFVCw==",
  a4294c8b94b03974ff2e32966fe3cd927b80f66ddcdf610fa0e9031d510131db,
  "420b817cdc2c52f8406886fb67c95d1713270c0b06d056284a2818feaa82a247": "sWHip74saTFVwAbzC2IlagukbW5Zkz21tfMX7SWSnb5/mHhf+tMoLryuYaDtqdCMXT1srnH3oGQrDHNOcg/5JIyUm4uGQPxSkWwk7/79jLedjMwIdDZxiOsA+bdWlqebh5q/4TmyD9WkYlrCVIp5aeoW/+sc02led0ESasFBFsglhVlshas1sP0YzWxbrq4HWmMvgmQ/VbVkopqOjQ==",
  "9faf93c269cf45e7c6a52a4563b792c30f856099ab36b0813bee682374af588f": "h79Myqqo75sw9duCjKoXU0QGYTb+aM3AADtU8y+f7g7Fp45dYQ3xU56yG4Xp0BNYVxBI2gIm3m2x5BhZlo9VMZalqxNpIrNzBtiluKAmNJ7w7Bv1sAG1ZHemfxIIUfsGUNvVsrhW3k0YLP6HRAjVhoFWrH12DOk5N+oN68uR0fTon208lx6G1h1loePD2Ux89hDNU+F+7Tq5JvnNZg==",
  cb4f6f30351366dc9f6bee6e60bd43de1fff99ab10f6b7646ec1faecfed0a59a,
  "94602ac27683f6b646af5856a2fd10e761c2a655f44850db68e318e9546953e6": "naIMO74kvIx5g46w1VfRk7O0wwStrhOkvxhiHUD8f5utp/aJin8V4GmRH/abjCafeIbK6g8tp0nb8MRxt8FIRtqc7B4F9YX6TVaZ2On9xOUpkwCxDctdigZLafxPRbL5rzaB+Lau79l1pAuNAjZJy0kOZkwtJiUDnR4BrwtHQAd91wr14wpNzjPg/Lgea8LdD1ENXR2wectbfGp3Nw==",
  "27e89cdf15899a6dbad9998cdece25f660d8cfbd48be1b35852e9ca27de9378f": "ds1Z7qs7EQfawnHK6QI+hrpVXKRJnSR8lIb7hbwbkPGqoyjPeGDWpRszqfqwTBeg9zpCNN74xohLPJRZBTuJub5Gv08J8lEH7k6i4/SxigWecsvAO3e02A5ZDeUyYNtVOGTufw4KMs11MlB7FePI8eE7qxWmUBc+lUVupFi7b8kCehw4b0AKnHBgkS0Z/7lkQiM5NhqxX6Km4wtbog==",
  "8e2891d213e9d1360ef50333b7f6b74fed71ecc851185d4dfb969f9a45d04cf0": "ConoJwX4hgL3RrfZUQpR1QsVpIIeSucdmEKEYjRDqr2OlJcp6Tye5FKvaBMZxqratyRWcUVJqER+h6jQV18RwvbklbaSyMXv+wvOQTA/4jDZu+3PKBPL8UWp72+6VhO7p1FV3mGwqX6heZBQvVxJM7ySvC5fgWaGPXLCkuytBfIQoJfRTUS5K9JOgmM08EmKggXW0k01oA7pj7sIXQ==",
  "2c34fb67c89f5981d7d8e18068459d6dcd82d83a9b8fe16db366eed8c4e90455": "AKfLKOLd+5mB265noXj6X70OP6lGMz6IWZtr8fThjl0Fn1Hc6E8i14Wu27DZQAiIEjcimlLwV+lkxlrjjF+efcz3xqgRn2+NhLiR1f4fHrhobIexuN3ZDtKWBdswSBOK9rsrzIJ5c1lTCxQPSQiOsKskSqyozjTHMp2TWxsTIoPgJG+FZEIkDqkOkZfWdome80xy9shOSkXxhaq0+Q==",
  "4ee27d7cd9b84d7375741184a2057c4a2e2b8976255e0d1181503be8eda0380d": "rZ1tPOjKhVg+oc+2LObY9hV+h/CCT2cJtbYIpdr9KAe4KeipQWa6UgtmvX5VWv67lHWkRv6Rww/zIJpzxjOp8prypk8Qw0e/tQTQEiCTfEyu6jfp7/ADingunD4oY90YZoQo+QuegHMwUbu2rgLnX7Y/DrYPvffsqQjP2CIX0LNL0K5yBPZA7XkqfpBFKn9gGCh1II9pv1trD1CVKw==",
  "1d55c4c6e4aca1142b614ee7bce9ae826feb7ff3f9fea00dd9ae5bd55c0cedf7": "8ZOlIC7ChHlJRlTRVUapiozWqYjri+DF5sAgmBwSUQiAssrpKpUaUisL47bV5mR04s8oEdKZL4ToC/iBPxsM18M5axwcRkJAzsU6sijnAeOTwyvy2AYcpfT+t7+HtJtMXjLM5FruJ64MaLMplJwZiLKRvHnMyc/xaXg8ZHUkDOivWdNfD6NjoV394vyZf2rsupNwekA3IJxr9A2YtQ==",
  a1d53b3ec4428ecc8d5f5cf36b5a3e31ccad3c5068995013dc161285c82e349c,
  eb73c204098457bcd5c88247c918a9abe02d46beef8209623a3e74a6deff8888,
  "46da33553bf4fbd21c51c02b48e86aeb355f468d4bc58befc00f015b39fb04ea": "db5AfXVNnY+J42IoiQFeVZecv4u5nUV624y6KQ/3NSeSy782Xi2yS2Q+VSI9faIehYei1mZq9/jXoqvrCHEsV6LZvRn+ahcd8I7DDVGYNL/lP/C9tKydn7XB29Edf3WA72w6eubyS1ClZPkuODs9kfZ7FUTpNYy+bfHDDADegnPbtp1xNZjjgB9yEKeCohJNuTgkOZNTFn7JyPe2ew==",
  "8140e9a7501f0abd88fc942b63abbda4e6a738e274049ba07b241cb48915007a": "7LI+wsKuo3owkyjzsI3Eg1saA7vqxGIXm72G1ZMrCteZ3K4yXwXH73udHsDYUQr7OA7RLXDZ303S6bI84qKK0UJ1cEeKHgo+bXbfgwReyaA5SdK0gfyQxKR8bXvZ23NKGOAoU+6ULgOKIMu1X6QLufhNS6ycfG9WinkQ5cVvcJtl/+5h+NYZxIiah4/d6Y4MTLFgwos3dT2EvhCnxg==",
  bf3b491dcac69afea39dff1d20e0b4b3fd1c1e45a2b66169371320b3f3c337f1,
  "9300c3f0e61bca95c449cb1052225259d080eba48ca82bfdbde9cb170207fdf5": "nU+ChArykjqfac3xzBWxlhrrEFL7wcaSn4aVNZewp3wxX7kFgSJ1saI4NAB/RMZGd18QsWQYetXPZrciOxzkRDcTDxuHEqe8aqnqUjf+0xzgjrpClh9vJAyQ4rmL30uo/7PbvTfldOQa2qp8MESpqAJSXjavVd+ZhuNn7vvqgTeNewkqUrIO/ZXeIpZa8CTCTHjFXP45e3iPnev7PA==",
  "3895411608141c18849307669017b6e70b7bd10bbf702cfa20ef5fe380662ff5": "fEV1dV/VuoD/t7w+IYb+EoizUmHeYqHuqyvKVt8MWjAci6Iey7hAKrOZXpNzZLfnseeveoOt6W8p5GilGxLu5vNBe0WtW1Q3jm99cgs9ix4YSp7tS1XCDwdx+pLxTpQL1u8kFNgress/VUFXmSfhh+9ziwhfiZpadJMJ1eUeHqG4ktQAY3TNCQJAIfKBb5juKQ9ynvZ20frgAyIyIg==",
  "0cdb438fa6bb0e77fe27ea9c5f1a4db27b13e3a07faf69f303f15f14bf342ce5": "+inqcFFETzXx2vChJoWf0QGKReoepcjDDU2poXZCS6e/Df+kiQ4AicVulZc8dfwMfXmP1RsrCVHsaMzsRBF4gDVcfUMrVIA5TBnBcRIG/sGJxEracRuyztpCuwDx4rUTu7oWXQo6JGhw9RK9/6S49TaCN3zdhoid9SGF1dSHZkJqlMsl5qBk2glqWSp3LGZrPaJf/5rf/+/6b/EORw==",
  bc9dd2d9435f4794679b17489042549934489e203d6a24ef41f8c64d6ab7b366,
  "5ec8519afc44fd063147adb3a2637a0c86839a47fac1493e8b5b390278e0e38b": "5KyI44u2J33BAqNefnE2ak3lFK1yXVBEk8zmKyJP0PJV2oUqacRUMHe5vI+CtD4qnk4BImw8b4XSMY6D5G12LBTFTGPtSaCljOQdy+4EH55KcEh0FY5MVDJi47pfNPus47EfUpwjtqeblNKfHDHWIJPufMRrHeuoI3sbM+3kmpLKG1bPp7YcXq35B3H0kVm+/e6AmSG2rNe5cz9KNA==",
  b13e7327ca1884b3fa1651a1ad555dd844bbb0b785a1dd290ae392834d75790f,
  fbc5a83eec33b1a6a4a5fdbc67b531df9af9586b82c2d4ed151d57c9c4b53363,
  "54abce5b26b8c776c0c8703c14f2bba2723cb1b9362af86c4f72d32e82c0cf84": "zEk8CFb3oKQ1C1L2vegUpb0cA5CEA8IJzF3lkxfGtUJOrmJcHzRIdOaCrva7xpsF1cjoFVBbNR3oKwYZd+D2Cw1LXI5nvJyI9kaN2vYA3QOaZFQjmt/xPT+763r/keEciNcLpvPTSpJO1/TAP10Lly7jq1Bw9XB8i2vRrn9ISeDmm4CrL72G88DwI+ZLJxU6edu73tY+6h/V5e+tuw==",
  "88c9aa53b204f8c005fa66c1677fc4f46aace83da6953a9edd9e807a5db62a27": "koSvrJHHK1WMs0KGrYjf2eBnClz2iFPGEMctqccAInj6+VniA4TxcWo97m/aSYnXcsK42nByDaUWnwvfIJCgyfIE5uuK8BMqHuG4qFAc0Fv5orKSGydUgllSBClnYtLNJ1Fari1mquKi49KJiQWeQIx/LF7gxT3ZfCcTVdOge8xmlrMtuCuHShTGtsYzHa7z2yGKktmcgFnjQB9wfg==",
  "27c751f3effe994ef917365441823b8537e1b379bc4a275894d2d42069af1a1f": "q5o7l/HtFWcx4IoQJyIsBFZT4haR1LgYt93n+ohIui5ZwuAG+w3kLqHP3JZMZgzGPm9D5qlxX0BWctqidCc0FV0miH+puV22juRvDPQ7b+3CwsPqsL3i9l9Er5sEn2qrAfDgrkQUN5NHMPysEYpqqfb4UAiG9sGn1xNTYz+IiOA0p3EwdDXmvgiCkwjzJ8w5ausoDZTjxQXVs0aYaw==",
  bccc96c0e131e8798555e8803de6fdbae30f340de590663bb25c9dd755600765,
  c9131b74678d7d7c613d9581c2eda7b4eaa0d372ccfb623c742f85c9d694ef81,
  "6233f0991f2e22aa5af5d9e5c91f4d473444b543db993c49b65e8c477a998ec0": "7OD+hGId3SUuyo+221rT44V8Po+0iKzhaQXUgCY3uCPUEvygV5gERlpZfVprhx5440yhQZEU1iXFbSNUwyy2A0apo/T+1D2a2vCVh3wwW6prewhGhzJWxyHCQxYZSYEqC/sdEU/2QDpZI2kVswNoH+KWOPv0AXxMVfjrPD3e3VbZ/yoY0J3DoQ9NSnR/bVtAHIvCuyEfYX/zuXyfMw==",
  e43add8a875a9c2aada4248f135af34816395d21701f707a3b5e768327d1e706,
  "6ef44ba470a66c8ecff627187f8dc47c9f269becafa8b8e15e68ed97a8a0dce6": "HUsdQH/ec098RxrY3Yu4Fy9HIAzZf59/8uuHPab2GP5KK5WyfH736okeZu0Zaj8fqiuImLKbFOQBv3siOFwpQBBlnMre4gs9Hwj/PCg0CE9Trr050EdIi7Sf6WQz2blBllALacCWy0nskk70CzTgb58yHMS57PWDsr3Ne7qOOH2Eptiw1eLXC5ayZVn96OfEpUl3DPlMhl7KV3+CLQ==",
  c4587c8ecc5518c3754d7fadc403d1121cc0b3c2e812f61dc0d5c0d4f156edd9,
  a2f22bac7666dbae2378ec570d3290e3f068a2e6a73c3f32825425740ac74771,
  ce025dd3050b5340d96230f4ccc94afd50fafad6d02329e86fc5ca33bee28a42,
  "8e743dc64b6606fac1817e4783ea47cb88725c5e50f6f00783ba4624f3047fe5": "je2ECwaV3tsQInDqMBdctRd2mxgrnCYZggRHq1QKnGIOivXs7DRCw164Yf3c24lbAkEdWPGhafsrf/be3djUOH0miMX5WAJClbc5+fYWqcDemC48T5MLd4bTzcPwuZLQdsK5iI/l9EqPkMBv6GwQnlMA/RIwQWxd7elLHSxCnV9wSQi9TcFPuhEO+sg4QeeSO/4d/AGE/dcrzbH/Ag==",
  "5755ac0d2711f5c84c8ffb58e17c28b391d558681046089fa19e1926c0925faa": "a+ryht0T7R1fCFKJ1uZYRTtTXfcth09nq98M0RuVM5dOYhGE4+VqsMjDIJDqE7FCldwqbKTNe5Zl9lXLsDNGrGLf/poA+xoNISnVEznELa4Jl4t8gJxgdgHQYbcsAW1CSlJsO3rY8c1I9R+wPIn0NOZNCaZ8ZIVeCkgi3Q4KCHlC/DoDiCtUrC/wAKSitGvQHYHpchN57oHEz2EqYg==",
  cb0618218dbd59cf1b90a2831193c8e3bf86ef3bc3bf4e1c6ef2f1bbcd6e4699,
  dfd69b4329726a3f186c7fe6a04b32ac3e0f348a28569a44846a13756a09a717,
  "0c22eeac64cff95bbc2d6dd3dce2862c2547a8212fb6a14e222a9db5973eba26": "qQ8V2f0Si0H1BQ/pbLeXIkmpt/cl8aW7CEFvBdGh1t+FgYwprvPCNkpSOIQFlRLGsGIsQajAxkZQlbx8mSkkkerTllE2bFWZw7aPHPT9X4miw7Zbf5i2E+q4eZfRle1hcr5aDJei0VYoXJM4jt0ygjLkZ8LD6lJ9qf31iOLlafNboRiIZjo/m5sblw4yonSGO6z9qbOmF7J7tqoc3A==",
  "4e3cf2b5af74a0b14afe14d1a5ec93da19241ce3cd6dad374b4ffa93ae508653": "qG2LtkbspY6bBRoz2gbdLIX4zgc/5eIO2kPB/cB/aAzkoRiGjIsnqTxw6qRrVLBnwsAo5TtDn+A1JcGk1YWDkW/joNFgthPxr/nA9x7ydlax2h9qMcXZaOknGDgCTTxLNWzsjYCUuiXEPbr7uQR+Wv6jDYvqDVtM7JqGuaYyd7qVHsjligBObEH0L6v+sVTg1nY3FHXT/oeSmPO+vA==",
  c27550d4325238dd6e17789e58f3019e5dc39bb1749226464d5655ae09e347a0,
  f366891e599c120fc6406cb9cb584e21ba61d9e629c681120c27c1f1733cf423,
  "6ac297291353741c96e79836a6b351ac171f3a9f17bf47494767e9905ea1fc29": "apWpawtQC2IJJWuApApzlwAv3Lc3eWM9P4FR0xSxYKYy7crNrzm5mNsCdxOIBSUv+R6/vbshHRl9wCRO4LIWh97KHJEynYj3XSsfiFvFZnCjAoTcVaNn8YEnUFbSlSuGN1xrVvJiaZ2g0AFrx8HPZ5sTnU4ibw+CpLPBRaaO+Q7qojRhaqZUcnGuL0U0DfRD5vGqtkZr7GxEuiIaFQ==",
  fd7dc8ccc1dd5a5c278572f9ef20db7b93a517cceaba7ff1c6d4ac58e1bdf29e,
  "8465faf9e7b7bd5c189e0af0c6d2c56feac69c4097e91bd5bedc004093265cae": "qr7CF26DsZOmioOHxB659LIk0Mv6vpGlHz8SJ+MxlKv1weyq85UoO1pZhxILNTMmjd6VB5RdBoNKDViBjPZMMeJPCOZfmoEXZUIkbcBPfI9qcVe3e2+DIIfpacSTy6cdO3GLtNzRGtXHQHyE5x95QNdbY6EUgwgrJmnXTPEobi741OZ2zP4gGa4QOreGQJBR9cG9pF5nN3Ihw+nb+g==",
  "233f432adbeb5f59d31790a3cd76a4eccd460af58f13204564c16db767fd4af9": "gbwybKbg2saozXZ6h9P7/JBkodtpYjmckqOYsOs2H0OXN9LMauBZh/UHCvEO9r3YKRyNgy5CgMzoBA1MRV1Ss8lYfYohkorJOQMb7TQa7RY/sk6BSHmpJ72WmJGCstUPNRDhbj0EppYIdY3VpLC5lWBf6B59eBSB25mcArDjLBsK0KNqlzMm67CQthvK1iJ797SKkF/0KxAhg4W8dg==",
  "5354b22be6cc0b104fe6824f7a06624ba4ae6cb3626c4fc6915ec970497bbe07": "Dx8fIL0bwT8YG86YcwxEH357+gTzAYDLN65O4wVrtufoZgu2arrDP4UAF0Y5p84bEL7gCxDkRrfitssgYtmzd/WqHLdJvOmVb4JH5i+cgLearZ7QdxD9fV+o3XfKxgxZvP1KhczuZyH3b/7Pr5Fo4/LPZKFcsvsQWZwG9D6TYA1Eox0zLd/aU3eBIZI5aobzBvtk8Y+lJcpmj3uFfg==",
  "4721631ac3d67164488beca2af742e1902bc03aafe5b168b4558fefd443d88c9": "LX2/cFLIKI3uhYdO6ip25N/tYJ+EgWdSM2NYZlEnVnZ/wEfKuBCLlh90VdA7YtjFHeCZeeKp87i8zJS3/Ev5SL1fmIDBeRVI6Bnk1EFMi9Hi8ph8gdUD+QcdRgsLaHdW6cmBg0Nm31pzYwhlrGox7uHrZwrKjsrbJ1CKBUvs+csUhjzbHp3Ip6hjXn8tqm6CiP/n68NmLPWCGr2qVw==",
  "4ff37270e33be0dbb20bc3af470a7a24bc9682151be0c662cf2835a5dfae45f1": "tGjDsJU+8ZLYVu/GpKZl7Nf/lQB5qzCW8WyHzi8LAE5GdOY1P6sxubQR6bAQaOmYJRz0Tkc9xFqhOJPS3JgoIwXhbeEMrKj+LmkMV34+71fsP1bqL5rxolYo/kbNlVenWn4E4C1J0iCEkIxxl7lZYgdjbVmIVq3exv9QJmOWusXqNvJSeXBYbo1TMPjf+rLI0feIqUZyra3S785Vcw==",
  "2e7698a621c0a95d7becc5f3a6c132cbb03e97a39fb64b04effd33f0f201501e": "uDZrLPLrs9NY7MyYeXr+8XUSK5yd3F/oaXbywKU0RX6HMxoh7WYp6/WSxupVSiwM+SiGUV79r2CYgGtRHXfI/Zr4usct60SVYtJBt1nKJatif7utC5DEr2LH1BOW57/Sywy2r2NwOARQI4oBT1Z7yoDbfr72mfwslEVWh9+sKgIzfrplrDDC5rRqR1hTK71ybAVZ5YFZzsLfeRU1ZQ==",
  d24c60a6a98e9b193091412bc0646b75722bfc69b1b24f1fafc9afc1e9d65b6c,
  "754bb70abc568225073b4a4d462df221e1536df36d0cfbcc32335b5f619af0ae": "np0V3hHtv/ZhbB/oYnUTU0tTT3i9VA0k2rf7iUQqUbJ1OGsdkE8JCn7ExVhjVISYSRBwc2Pdua/8Fq7AgM3AtkA1Rk5d8AV4EefTXMbKeh6JkCailosbEOg9jIPEKx7BOsbwts6ssWWF1gtjddBNliu/O6WOsS0iBKchnkdJVEQvB5V2tO2Sj8ceB/8Qj10YooaPhh19661n7omATA==",
  dc044cd99af11b35421d47d06b0345c0292233b03b1d9dcc1d7202bbadf2ae40,
  "298b4b0ae5d8d8b9970833186f3103eaa64edeb782193a726beb0f194a2ce568": "rCV02Zr1aOUg9K4/CBZX5bnor1unkkSA+l0CLaPuEjJgc6QAgej4yQEF0GsZU92sKFoef8aNvluh3/Dtnf6MFX2+pfIWbaDu5V7pW3eA+ve0AYBeAdE8kZYlmPJU2cxbGdhBCSo+bYHAwRNAfmIDRelKE6bL4oEc3pjwM+XVQz6RLtROmX51Ydekp06RqSLrURrMU0s8DRwP6ihLow==",
  "95784279ffade105ebf88027b74e402485561232f64ed560c6ead745a92b3443": "3CCFE9Aj9ZexlsTefb596Do7IZMqH2fmD3anhVZu4DxpgLx5RiaFfMkITvFjmqv4LSsTDAmrZAGCFvovqGHIFr1YqxtjFotLoHNdzlbKAFHnx7ipCZ/8PSmCXsBXOwi57MAOylWLKuFe6e6yVwJtp2oFgGzCEx2mxz/WEegjhqppaNCiPYfEwUplpnqlKjZ5olFK35BHWymYHCtXqQ==",
  c3b4e5caac4de1f4fe6601aa59d98162194a6bc0edc23553fd536606248c4a7d,
  "502869d8980b9e221db2736a132d953652922b24bf10fd10ec3b71b8e817e35a": "mBDwRWYtxj0mf0FRB6ct6rctQsX6ovXcfvgSWfaA3r+3E0NHwyt9gyZ7PjR9/oyneqPnxittPg6gkRGXb07b0CfGRpEEkLQR++KbzJI01NeaeMp3qCSOmvufUybUXNOzUZhelYpj7WmdZ0sfi8MchTP3chxgpk60nvEbT3l3FXrrMxLjHHeGg3WmW23eVVCES7XijRE7oaU3jNhCxA==",
  "4402e3474104bbea53219a6c517f7d755dc414403a6a8ff9b0e56d1212781cc1": "inJ0TQyaPMuz43swu2X/Puox+fXZSY90YnDBV/GhzV1Ntht6FhPMvef7tEstLcMYTjIZybnIILFJMzU3YbLDNO6erpnTozpH8FAqB8oMiYLRMa9SXM0sFDSDlEbjNAI/fTqIvLKVW+Yi8Tu5fg5lNySwMcqSL3fZU0pfCwcuSG68yXrWTP5uojzkjsQfhuzZmYV2rfzJM/ZQkVy2yQ==",
  f229102aa89a40635d7abb15708e5e07b9b2f26ce1eb35ecad442558c6471de5,
  "735fe096de8447e7d374bcb12a742ae99663b725c43d1f3180f6ff8bde5b1694": "+Kj3I7gkxv05HYvkmqHhHMRMVMGtDvsKcf4b1ibvsopslov5KGaLwrU1NqjMPMvIi+0oS4B2wOhg4m6c3cNeHDhNC5bwltBYSYS9Rzs09ETOCY2Sqyleuni5pV/froUFT7STiVpWvIguPegL1lqK2Mc1bRq49z2KJTHCV1OTLEWen8q6+G/nNro1jDfTxFAelcuViF8RytY4JYZ1NA==",
  "9ed4a6bf8fde095b060522db7b242a4ef1d727d51efd408e34caf139aa97d363": "uFa2l4/WS3OK0jFFChNSPiATVeJ9Tni5LOQJdk2slE2jIx/R+b4MLxo8DRtjO/B4O+81S2Hfzv0N4C3RKYnrcygSCtNHrVJyqIzGXRi8itQrq60tD4C7UP9KvTGmAuE+9FatJ8x/ihw6uH3kNl0wS9qfHgCRgJ6SkbU1hQY0DdmREIjbAfohIMkms0ju7wZpj+nssK23iUM85gO3sw==",
  fc6cd76f5e85cab1c97ff88d4395b0fc583c830e59d740bcbc6d43a1537067ce,
  "893fabaceb10c5bea8c8af23914c742f8bfd25c70ff9a7ef859edfca4290066d": "ouZO2XvImuI7OuZE3iwh1mX4rlE4kG8Auc1/oCcx47pHW594RTUVq3moj7HNXAXFYkY/k9FBfSkZKcM4n/SUyKDEi8ELI/8pxJhysq88XYPMu1M1PQxmdNplW4ITWblUlm5CISJbYKOKjQAda0HOAhcVwS2LEJM/+yeSE92U5+LAWGdjxbtkbzWTRod190QjtusOrWYtVXM8PdP9Bw==",
  "3a72a323d89712e877324406d984d766384a2aabfba8ac534625d2999a3da4d9": "be6uyhc29aD4Rg7XdGpgWPNsC9pbUEnAo4yALwdfLDKGM55cjyXrJwGWXB3RR3jt/tZuztd/5PaoKfeAz2xSfPiinT/L8VzF1615WY44Hw/2HwZH/i7Zw8cHnpIVOdzzUaEh83Cqx5+bfUSLGNkMAbe6hXd1phZqIoR6nfvUA9nSvG4iR3hRYTkJuRNDi/3I/+qInIOWYbzPSbTl/g==",
  a48fa88fd9349107a26819dd543ed40199ddcc41b8835e9499da9c5a97822449,
  "3e00bfb3c8b2decbdabc6429a6e184f09966067ff4b791cc2645e73d43b612e7": "82XzeCxgJV+eEqj/2Hm8Tyw+mEGyGvLtGGF2osekCbP8Y6kmGt4Iai17NT71yxoDY9Ri8/6nmCXFlMY8Pc1lsqNax7+ECpsqksw2k7lsCMic7vRIVWOd8RstODfEoJn0odMZgt2F+cj9Hmd/nT2xclnGvJAM19dJFUxAU9gZ4VamVTYLjUIfo0Pw08U9sFzqQHHpzzR7ql2WCutoQg==",
  "466ceae2a96e68fde2169192270c4b7e339b401dff3594f95fa916a240a4f068": "KPPRqWfcfVFeavbiSr7Lr4vkuYZjwjEn/T8bbLwNEYmSpC/BCwzllpsbzeV/qZhma0Qkggfkk5Ru+67bgKPqAKQ+2Hxw1ucnXXj9Dv04Al87cHkfpLDOvEq8t4EaGs8pNk3UcKtsDKejTfaABPrZ+gThOj+88dSV6KzZMw1exW4ZcV+p/wHzR03EZeIBka2YHUlAdoB5QoIYd15CfQ==",
  bd0f8266243da8790dbc15831d95fdd45cd6e7e0c2ac7d3290c610d0ae34ec63,
  a0ca10c109d1ed951f5e4597e20d5fefeef9a687686219d09a499f2f6c2a8cac,
  ff39ba334d0866cc3ebc7715adfa7a1b70e5a95f94737c93e77f0dce9586c6ee,
  "5ca6f396dd2c187e0c19d5a714276a3825899e4f14d374c8011df26ccc0f11a3": "1OndVwpPo+NUWz0nM1ouDl1sRVozB0RxQ/+vlu9OYWCwHuG0ZKlqFYN9anBgm9j8VE3Ym/J9u4BgZJtA2chFlYC8IUVs4wSXbdLhnoH4W2agA6pY+bqCYMQeNS7xGRe8IpwVg452Hu1yIomaGe2bWxZQS4CqEu/Y/LpoZLYiTxKOOVRleNQvt4XMFCYGsKfzwiB5E3IR/AX+qRRBQw==",
  "5b8367476eb31377670b2d07e9e64a991ae232dbfa4303cbfeb1ad388a045a77": "xBAG3SXJbPufNUdwpL4/7l0hZq1r8LZS8TVmTNUjTMInGinCjWgYYgtl0kw8vrQHCW/hzvOndGhcs4/FuBp15dmk9H7DGeZWzZ4kA3Pw9RDEtmyKpU2prcKaxlFsrVFCcho7cvKW0xTKK+NpjzTTYJaN/zoDhpcJkOMBZ2ReLX0xACv6WDuKV49EfaYBnlPNYtHICEoZyzOipbJsyw==",
  "75355ac16914925965651ffc3cf944144ea6ae544dc8d441282dc8ac123e02ce": "x+5QXgAS+yqiMlTX8mB6Ml7ryoLbrniPsQgFAGAycHiYknZqz6Z4GtAMfXKgZssBcYeSGdGAMhlVmbcINc8bhTg3AN180IHiO5DrL/OFpM4tFavfmw59Wf5X+FVaIU4sHQu0YQTjRWD43mX2rAYp6PfSKVnPjljGxOJcatLDORNQCZYtxQx88GhInS1KbZwh/LFV0P9gXaHbMXANdg==",
  b1c32652048f6948b48e3015fe766c21fc3bdfc06b19e3b63d1f01693ca961f7,
  "9248c315c96b0f1c2c539a436e2986c730d5f7ab54ca296faf43df0121de02b4": "3W2pv0uydXMXzx7ScVRgg2vBL0zAJXSb5vf1JysqwuotmNIVx5pv+xRaE5gDS11nWbSvM884pQEJOIcSlHkb+OZQ/GfPEsRcXSIKTlU+0P/Hpm10pnWKheUUS9wvXZlY+3TcEvd+hx1K3M6Lh5mXxKVda4Gq4z+QQQW974lRv8MNu7Jh2QNUGpXvQLX0JDcHjkNjPL93Vn/C1TMQlw==",
  "99992ff44a4e4b4af2885c7c30d38afbbb7d0acd8c0a213d534505abd3b3ede7": "bpmdpjgN7R/m+kGqIQsFBavZ+r6jvtuVrK7UQwddCcHx9ENmvnMVE/59fmCMrZUIRD1QdPn5tGiBbtD2Vzzvx4QRetvGpSJWl/mXh9cgZFji/3q/p9A/mDa0+7SHeOepu2MrNsMdL/Nd1IpypcuVfWcJKk3rFdUkPBt2OEp+uAXWF1LxtlD23+IM7b6+gBlqrmusQCUszQdjxYvhtg==",
  "70f6e03f4feb29fb1c1067d78e2721af020fdb193853c6afac8486b6f9363356": "UV7k8/aEEKsVryScr1fiCMRhntG3BvTc1g/ZYzqp/PXkGpFqq9YDOsnPn/vQLZGbvFQM7KK1WKR61xdQfENIbp+mBPiFDsUj0jREypsE0WZpwN+mCwGuGDgtWiei7hOMxeRG7L3ZiHm32UDnuhfwcr+eNeyHid78lQEfvS4AZUs4FnvSE3ruj56QglGDLLsiaj4eFBjE8wMiiwCqLg==",
  "7285c2f5c1e2d002591e92d31454e33a8d45b5b29e0beee0f30751f8e60b5cf8": "0L9ycw4ekekWRP5nIlMaPZv1Ot6p5BgdjZBa4Dsg30V+rXSilMSVmX110wR/WTibPO9SgbvYIyiUhb7uht0WHbZgtMDzNYgq5tA3XnnS+dazBURQ2SFePDbiOlaAkrM9iNpyBHOWPCrTH92eHVPzDN5OXQRbxFdR3dcwKtCiVtM3nSzngzZR636vfkWNcIpMGh8beRV16Gq4Sz0DgQ==",
  bc70a7b7c01ff23041b48678c88dc659ea74d45fdcd87000a4345e4d12f361ab,
  "9d1e639ad5e91c809c94020fb4a6cf6db763b55076000a5e088521527e0c02f5": "lJgmmZEmBZNiHqgEMBn7H6oZTbQFQVuBl/Y1xhDVJ79M5LGumoU5dMcp6MpWAmgXrcQX9hL3htv1OTuLvKE4HtV1gbDtzuxwhaTIRvafTJ2njCHq6yoplvqkV3/jT2alKfRSuZN+96UbzkdAovI8Azqw3RCqwidTJ+OCdd9HHHhp0oKjRmaebD1bDrqt2T3wC6HTxrzBnGxGfo4uHw==",
  ba9bb3ac859f3439d1d45ed1b6fda1aa912a726d08b4a7ef5f8f7289cadc4ad5,
  "8fd5b58d64259a7f85f38ab0ae13aded7535838efa64911f61f2bbe9240e4f1c": "iEaNz/KH9Z4LTUlSBKMCsZX6TavefHUvG/p5BLZv4E7byRaeeqnfZ1k2GjUrOsaVnXZ/8ls66IaAbTrJzSp+g0P1vFlwTsQdplXsEJz8M9l8z+3/PnpYZ4O1lXAZVn5FvEdA7PWqcuIE8y4I/Deogffxsq/GY15EPq3jcgF5EmrYQ0fweUoGApbrhPL/QeMtDcLKORTDG5r1s+QXRQ==",
  f161a9b5c5d9e308b57d1fc31514de4e3219f76f0f35bc66f0623c668f3ed711,
  "221919d7de5b29d752f173770156aeb975f950a59fbb18b37f8e43a6f6706927": "JX3NxjzTn+8zz5fc9NaXNGPwDs0efkvjv+yhuZWW2kivyt/DUtQiR+5BDfUM3J/EJ90u/s4c5tD3HEDgN+egzEi1Q3odBDqYd8s48KkMbLFscLPO2dXnbiVZzlO4fjCnTLXg1S++jAojXr9IyjnO4nu1UXoLYlSQOpkUuNmkRNz4McIs1eOaF9tsQNaWBJwhJpCetx3IyVWKNeVrsA==",
  baaddc8cb394f594f4f6f2b67d5baf6a821c189e5dd9e26f7fd3cd6d7f23f3d8,
  "1016df5752dee9dafdffa2598f3d7ff7dfa625bc0f0e6f94ad186f0dab0147f6": "0pf/nubLP0UwgDI9Vep7wplb/WadORmslGQUdjXt0iF6/3lKyprT1tDjyH9V0Qx4aWfX5ruVIttLh3mpnT43vo/bPzp/I40bc2bObyV9Kta6PB46bUm5CE/0jjTXVHbSat+2fl1adO1ibggVjnrk6zVUIBb6ZkfMtx+JjVtXxtOvvtYQE79oRCDB2x/wJL9DfpktUjcmcUKh2XHMvA==",
  ad9ec0dff8ad3e3e19d3da43ddc51173b557da627db4aea41faaba3004d5ae71,
  "3a1b8392ccc73ce418dd62fdde344c46c5af4e000878cd3fb03886825b262301": "+94DTBQHk0gKOekTh4aOU83DY2MMA8RuU2OJUrf6dPq2DKSlTOlvfZcCEOoud6C1XmjW4XEnLEX4PMO9Z2CsrYytGwRJN+ZrdyHdBzGvNj1IVmAs6zl4IwV2AcnPahYopCo1BhTXH2ocaCVueTo91AGMdst3sc1Eh15m5BLkzHMWzLcTfCxd50a7aihACWaPrQEMGh7+WUw+mF6d8Q==",
  "3e508d201fde94fb6bf0244e011aa00f124edbc75d1136f34986725813a1805d": "9REEeORnLbIuMCnjmxhHWjC1zWZ3jkhVS5GvvVe0+j9+n6LBiqY7VC0DSnZsbBH0E1hxwX/oIeucmsPtu4T5f86FEikoDVd+53sgsJwQYcBgygZioSzqOANFlGK02sC56d4wSpkWkBXuyXwCDvMXtYgxQ7dIqqNOdpj8Xiv122WNJw9lHIHV6/d1loXxkuATN4aIe3MW3Yw3vYZOYQ==",
  "9b86254015d830d1162fed7191f54aa1c08465fc312b40c2e2b23ec1417abe4e": "ZCuwHhRcjoctQDDb6OyO646HNlMYxqNC+B6IttYGV1J5RT99ztmSeP15DqkNXxxHH0P/p6M+gLXfsWRgRo5dJaTcUAa2CZ40r0EV/4mgBKTZCrzuTTrlhFF6HN97XPkrd0grc/PDlQXtm2FyYNI1uj5U9CKnT5TJEbvF2wn1hbzwrOVitLAZwB7H+xuDisTJF5CTacMPySyB8C+OLQ==",
  ac16bc1378ee5f43ff2788175c65045581dd31a2abfe191f9af4fe30e27c51fb,
  "70e555cc64716da48cf5bdb20bca835c18aa5e9080505e1e4a2a77cbdba99da4": "Skx0X6G2a7La5oE7MPmOy//T8peZO1VZ6d2kw1GzVPv7k5zP0WdtfYu9wFxuhYtwa2VcvQUTv3EpBQ09bhdNb+Buh7w3Gzps0z/Cw1JV3n17BUTwSyJVTXNsS9ZXC9lf32ttGVio3g0NeoZtWF+L+84xyA0VDnu8CUQEjM+TyrTvErU/dxjLteQNu50NI8MrvMQPjVsxDqwY5CpoUQ==",
  "309cf16608474318fbbd8415f73d82d07c0cbb969f9b34458c02b56c2c976dec": "RS/3AUz0VrGLBiKvDPD4ttBlOyNdch7QtDjcFsQtyCHd/8XC+LSxpsNgr5zTvqw4Y6SBae4fRlJGCRJU2kAozFH80REZ19xSczKMf1cCBXBcztFKoqZLhxElCUj9VYD6NFV7OiJ+GC5GBa2H1c5WcWxVsE+G5Ta/6oACfn1HIR6aQEDe41IHfm5JvlBzEmpY5hMcawbRIURuDF+mqQ==",
  eb776ed627880fced91c35f739454a6002651eaee2e5de73a599e1211d498983,
  "879c6dddbc26098e139ed162cd7f2b80c834c61875e6791f49990c2cda5fbe74": "VA/xcQWiY9dhW9dLyyvlnEQzqVbF9GMdRJgPFEUgIf6NhoXS/U5xDz6+INlAJOVI/cBE88qiACiNr+2RXJSe2Z0YT734P78d0rVUI7TwaQR3zL1oXvJYcit1xPTWT0sHW8tOoVVqJBXql9Bgk8yZWuN2UgPLD8AKC9vTsxGKbSA90Rl4G6Yc882zoNCHiDeHDD1V/bg1y+A9vcQm6Q==",
  e3fdf7393fe75ab52f4b94f0a225c3de731e0327aa2cc851be43801afae01d86,
  "925c4ad7f65ed69d987c36ef2649538f54e666376a5fdae9b7d016b0516a367e": "atFgOxePkq0gkvmlzyCWl25NtDo/OzAxhVK2xcodOZAMmTTGUaJZER3YOi29SHfcT8B5c1sVdcerOkqxac5Upk1ptpRP9yzSNaDSEyJ88rzRhkaNc2GRz/xuMGJZggBFmuv5O5/EwWpmjRPl2OcBxIiBwm2d73NcuLBQweQhiiamYvkD7P41HugFKiGz+eO8FjM8ttIyUSn3lmiTGw==",
  "5a1cd1f86b6ea9dee113fda8534da935bfa5c270bb35589358a095cc127a58ea": "YcozO+GJu8qjE5fO7PKx61Se0Ouyyimjc4sVtC58+BL4e66Xgbl4UrYafbamxUb6tbnVTsht63pDkqmQWq4BDfgEv6HQV55YxRtvyLrzInJmtOQdj5HFtYnmNpxOwYuj1lg2nqsLUeuj5BTedkLKUV5mOBoH774m8owVEl/XnNsGQec4zEbZb1xgf9EUNanVv61eWYg/kZRXtGocOw==",
  d2efc5b89975b636e175f3fe1d36e53b126da5fd9c1ff022fd6650dc4fc439d4,
  "3a8c686d419604ee12ce805484a8c477bb5ccac142226e2dd41b27447b5dc20b": "gAIRaicLp8tl6X3QErMGKQR4RIpGYHHHT1bn1pjdVL2gBVm/Il8/8QZ2ZJv8hOO4z0wPcZfEGW4NDP9uI5X6AWcxj8g1eZGnoL//PLtzfFgpm4hoOJ7hO4DsByHU+CNgYn39wYX/5vTxn1nZWaFkAla2W4a0Qo3icRPbKSBv2NAFS1vWyBugsXTu6K+HQF45EJWXK1vdcucwl8zJow==",
  "7b957bfb943c2e93e69755b810e3d24a23d4b6eab89aa75d2d7a0e872dd3c55f": "YavrFowkHI0Me9tA8Q1LCvLkPJBHhw++rJOjgZsZbcaHNqgeyPcKwdebNe0w0wgB0xMBUXgDEUdp/Kufd0YfnbN0c0XmX0KVriaBYXPnjZU1D9JcMNnXpGCpy8xA8RTEBgTzliWOTdErZ43YERC1dj0fMgFjBVt9WQpXGuO+uJQUKE7NmVV12YINP6x7w2EbwMfYSzdPIKcsdmI7oQ==",
  "5ea2978a7b5bad1ca3a0c8f11506f2fc2fbcc20f238e2596a51fd5f833364a1c": "IKLmHJQFvhMEtLfh5/eFXxl9Q9lJKlausn+11ibvAP/F5L1Wx0wsK48lE4VeliLeSihye8SonHj8F18hb6IBDIdchuTS6N4iJK9QE1DL7uh2NKnO5SVwJETPeBcaWXYySRIZtn0swqQe16M2AejGmqMeN7pimIJKDXY26VPrSUiboqbk+MozwXwxzjkfWo81LnsyJV0hvPV74WM6bg==",
  "59059cd4200c32996f19939a145b7231e41c5dbe9a5c205512cb490792a0da90": "Z/ZFesNlJ4acFZWBsxnxOq6QQSYfIvmvJ0U8oBw/hMgllfT7bPb1jojMKwKtPutzIPrk6WyKga+/iEMkWm7JGQsWOIV0nk+AsHWTqk+xc/65huvqUMUVBHGwVKWqSau3Gt16mh/M30AtybeEQBxyIkOiFRRNxOmN/WrJGw7oLeGD4MwpT5REhKtKinG31csQYpwO8Ovp6SJNFJResw==",
  fa43f2ad0f2eff6600897b9dc5963f2ae7836f798025f7b3add54bb66bf3aaea,
  "25b0dfa6c9eb0ecc5ce6e59fe09128d42004aa91a19d7b099930369a96a1aed8": "T+d494OL3BMb+eiIrvW6d2VlWZVW/SAfebfdx9eMpYB+yLC7L2A2axBKQ5PVPPCizCpZ3uwzPaXdLraNjehBbV7TQcOgJP+FMbVHaQb1I4FcSkYA3zWO5av/OSFswm6cLWOV416J10ET1POsza8/6yEQCr+V/8yzsnS1/6nCpUCw6MqvJJvGOYTcU2NWjaz4GkHrXBfi8l3sRGEHAA==",
  caa2b91078ea6678847e631117e97835e4af0c7d9c33af5ba3bbb10259d7a141,
  "3b87b67ab053a3abcbcd3bf5a18912d1b0599378417fd6427754fe39bca09b2b": "Xz0ZCUGgde3GPlQ4vZ0vzfZQBYMCd1+djLOAnbmwgALOOXWi3JIRRhKfDQXDKzhUe4gIxaxvp6Lq5X8vVyAFJi0rBZMJVIZqF95SgrIzrVgujNxCMI3gNi2A55GUmyyyg2F4BEXaYtM5cZjvrH5J4e/VKXg67pi3n0g5QfOPb0xUZ+rfC7fQ08eqTJTXiLbUKq2Eu74zt7EgHNf0GA==",
  f67add387d28f1c09f8280e226872ed244558bd025a0afe6c26c0b2ae7e4e359,
  "0e6ca35e4100c9ce9fd5f1e8c40006613f16e1a60405c3923402401474bcfae3": "vPs98DOBVr4b794cfm9/16MUsonT4ZQxiHaDawM3mPbXHB+lR71wAwDOrgONDDc3WHvsUq9Al3jf+psIPqWqqSC5rKWIx9MjNWO3TyrRQLL7BBOTLpLbD8RXp3GVPcvroProhU5Wu9U0zxO7qoLXvvspCzdibwL8kbaaWpAWo3DjBZ8P1qu/O7743fyX74v9O3a5jokssgW5RuX2Xg==",
  "181682311a21a5a7174ccb4231bd68fc150565eeef662160f53a4b594adb6458": "Oct3s19wTO9LHuwH6sNRwinVpRj8HiT1hW+/WJFVFXx0HXyI/hG6Ut22qP4VvMJZRMebtebVRlWnMHYJE18699zyDLVEQCk38djmqZIhyVlle+rhNYTt22Pa/te3nILQqHD7jCoIUZ8Bw/q7Vp/vT4sZvIgO9E9m/H8RiUik5FEuAfi1OSvsyp98DPIssdOXJV2IGOMMVpUbYElSWQ==",
  "49ee1f3a9d0a94535bf62afab58f10dda222ba18d8bcd17f54d858d32b4defe9": "e8DsByVJW1F0JHe1Cd5ziH0yI8aPRl+6ZguEm/8pDLPandc7bdk69mDJzvClxra9GD2Jm2NsC/3h8+mVw/Tf3zPsjCc3vaOg4Gossmy94PnmhTzXPtaDzJJRh7meHPNnU6lXuSl1cndHLdwXrU6p/rDPFNn3iHn+rm8tTN4g9Omr5iG4UBW4pWPR6NSM+JQZhPUKA2zSzEVPGmjaRw==",
  fc75beaf4c23014a7efe5bae58ba042b334622047d0d41eb81e4290cf77b55a5,
  "80aed84f79d7f9c4a750a01fa13dd006f9882ebd7a1df2bedefb2ce0e9a8be7d": "QHT2FqHe8vkojFpQVlfNU40euUnTKRIIj+zszcseOlypcA5JqrTmAvM0olcQ4rVJc4IhJ+sq0oOUYt7MPQsXCXzUHh27xnglxmrQuHmCkIdMyJOPQIysaoH61PI8ds9xX5YqT6C/KrFcXcbrbqkPM+401yLlmvt53U+o40j8k97NOSO/slC7y9J7UZivNBduEk+ykukeyJm1M8JDMw==",
  "80d37cb277c6599e0a82e43c4e560c8a1988819ab3933e2c9a8506197c504155": "rnXw8lB+iKgvCZxe76bqjWHFhM5OLexPjAQfsoLPHd58hEWgyl5DdGaLN6sEN8tprTm+HtWxfxxvlVyeCRExP0MWL0jGZrLo9xRBLChzKSv7NaShVw83gZNC6Gqqgs7IXxLx6MPQ2elsLoIOp5k7dM7LZ30Hrjexmd8OfoVDzS+mqrUQDpE6I/kvF/OHrJ55c+nQfgaWtFOMaEPgaQ==",
  "93a11e13d47b0a1866c5a29a4796ff5296dba100f34bb3076358fbe133851e55": "Zu5+uVRASmcgtMIIuOXctd9+0NuYMbaLORdzOXSYZJKP3Rx0jJW//7I4VywFCXnsevyvjzavn5ZaEXW32Udgm088CE2WOTpIy8ESQqKgN7p8iheACQ/WORcNvjPr8bCb3A71NhE9fkaeUhWPxO8X+4IvZJLtIxzvCqYs4dNlVowRuge3sED+kRBjMsFV3swrJYETexkmdQg1P28x/g==",
  dea49eb17fef14a8edf41d73905fa44230b1f1ce405d16bd9f36511ec57c11ce,
  bf14e4d02573f4f4f977788cee6cfdeada40b61f5e9ecb4968a9148c8bc74e62,
  c4955bb59cd657492302acaf3f00e268438806ac56f8bee833f21eaca7dde54d,
  "5eab63ad4a3ca90a613a8369e40f62025658fb494f647183e0082e063a016663": "ggt6TbWvpEKwSUfuzrxhJGNIhH+AtcuwTaOhkyj1imyhoIpQX7PCXJdtxm/sJKQZ49tQjQWTBbughoWMlZajaAhH3VLiBAbShL/zi2xgNd/NKBYhg8glpdYdoDL6hbENO/uA4IeKrLN3KkJ73xxXq7PiIigHvTo16oSvgC+dCG1rgB/B/yqWhtfKdGYmqUXaFtclr7xl4UDNgbQ2gw==",
  eb67047cc753adf57d7872eb214c464f639df66b4da981e01f4dcf978aac056d,
  c4a3dd7b9aeb7a8ecff2c69788b454f859148ae246a31ea581560f931d72b06d,
  "5f8709fa6352934d7371034b2dd44714eea9aec315ee7a56888b875938859902": "6i5ajMGWYUbvUfQq6J/CNVocRP1JEAvPUMnN3NrXxTgVVCrBxf5DR85uw1wDf1RHfmVfFfZu1RjfFqVg99e2jtN8bPWQHIiJTITQICBEUcLrWH2GzucytyYO0oU92+/gCeWaHU+HS5DlWAWS3yKxKeod5NLf5HAaWmoZcuQ2dbp6BjgkiONXe4B8GYQE4nBIZ0A5hKZoNvit5JweKg==",
  bd1e4ac2b5b47495aca61ed3441c859d820d12a5f89722803cb36ecd9752a5a3,
  d3b46f85bc6a0da6b7b537e2a372963305267703a9b48a41debf260ac10b3d9a,
  "4c5e93d1f5629cbaaaeab6defba20f2f7b1b477a016a7cab5e6d75cf3e4288b5": "3e3ezlIVDq9AEUtXUQ/tSib7mhZQ/WdAkNi3zbczu7JT0lMK1siVLgOVtkFI+UWQKVbPqd9sqRVGRkzSDglXn+TpsCTfA6+D3u2j+rrUNRvOLIRgnYnCyR3J7u06823ExGxSuF3sp4uSHYJ4h/wSkzXMECN/XSP8x21tfmcHbiaweDDEI8UzX4mlhhPQIo8QUZ+3SwaxA/kS3A7wAg==",
  "319657b0256598c40a5aaa590485780ecb3d3b78193e5311506b4a0154164d25": "8v0GZrnD5X7DxTbsi10Udyhh3mBknZFDw0dlC/MqeGZ2uZvhlx6fXXnjx5KOHPDOf4P5q7wXkSWSkR/FWUqsvZuHBITSe2sjr5bqinJYTCluWc8gRiNTSyGP+cXDVreBSdBk5/4S5oNQLlulcxvTfGytA6aF0XNWiJEtRqGYIxVkg8X2tzssLqun+E3kLW6tYbhpoffZrxh8dVPhkQ==",
  "005a20bdd9851ec82706bee26c67e40d1cf3b46ad83c454311c9c6e45ff7e8fd": "cS29bM9L5rARLcDLNukmBTqgAlXeLirCXoMjC9HMMfeajSuqVHHq1kw1nI/CoFwpnG9Vsu4VC1fkjdSIzKj8wh2T1MaFmIn/kequxLFd1XLxkSmvyKgfzIGdVdJrHTD5u9A+fVvUFsvR+QUbDofhNnDJkfWe1Vjf2OrCPA2+m0iNLpwynXj97VvtVmd9qlqDluOZwM7Ut2qMab2lrQ==",
  e8ca1a46c85a6104ed05eaccca187cc9cf6e699c60980c274b1073f824a9cce1,
  cf31027c90f2648f7e3130969edaaf5822f4869837c57d10b2937a02e3ae0517,
  "3adec0c5f75c9fad457451b39a27c10b30ac549fe4ec0a741bb045fd8795f4ec": "u/KxHCeKyne8LOO75F6kWU/veaecPJJUQgy0q82pyyWiccNn2B1Xl4/uE80+9cCMXZJMvPEPAt10GftgeGZJ2ADF5ZhjJam8+v8gQLv+69oxuAb231MPyWXpeiNSXTsw4FVE4MbPdvPlq582J7pObI/U+e93qE+RwYOBQ12FdBujpjfOkmP6RPaGee+4/5t82dNrWZpCqaVSJKPQgA==",
  a31d4f8d91cda84a417db18dd6ce238c2aa0e7773a4583d81f3dff5f2af58116,
  "5848a56a6809c45753f4d09999f559803fceebb89148fc2a993120563dce5f7e": "XDckhyZKO0jUlCkSOKy1INNX+gCUTgJkgQu1n/468CHYTgCe9rgbM0XKxzsF3D+RgZQeC7hmI+TlOcomf+t8GYopUfhEH0LkoOwV2wh8ncFoocqz7wHxgPMD2y0l/wli5tpaVzF8fvce+/f1ruApzKAjehY0ImelpfjPNO1/6vm+KsolFNwXKC4+IXQ3b05jrRibRzwkXVGCpYvq/g==",
  "2097d97caa85ea7d8ec725e7c85efe87decd5422da1ed88fc72b5ef99226b908": "cs5J2hH++Rp+RNyVY930nKKguFeuU2MfmDXj7RFtr1aSfJmYLsEra1i0ylLJXo2gv/R3jfm+OqCOrdnQtiCRRTRJPIHK8ipd7efm9PvRkNC34ZUShCro6cmI1RUUrLRE13HW5FgeZb6VmuANPRkHq2oW9IVF4JQtUx8bwjwruzWOuN91w7kl3jsSKZh5WHYqb4H9OZh21VgK2BFg3g==",
  "544f295360bdc919969b6c1f83f84db8be4b57d7efb17e18a5e9beca7393bdfb": "qm8Q8jIls/tpYKnZ2wus3UyQP1lyczqz7EuX3GRNMjIVVC2cGqcVZeW8PPB3MT1JU09Qc5wm4Z/GL9xJxe7fEs5HSKPY997vmPUs2bw4YEHj8d9g91pfkIDTMd/ajxY19ux+xYFUhWo/zbdRgQDJcno7JyH1YFP5B22M/NIFlMqyNkLlxhtMtJbvm4aWsU2tKZVT1ggYSskVFQNUhQ==",
  d2941b9755b41ba6c9699badf96d6b934a06d9a910eaad335c9565ec20eab8e3,
  "9123568c6529f6243a4d1a1f93593f933ac1e005aee89ded8837ef616f53502b": "gq2wO4SqCh+5vCkWyOZWdil5b9ZJaoSvVKs3wEO09CuJuIcFBusxT3EiZCzpb+eNdB4eVnVJtSmwFz9UMnIi//biLHnjcIyJAtxWNjymasastgA8vEsqa3oqPFCGPWZ49bdkLfmksC932vHIx7sE1e0CbNqvCpZ/u/63v2Frmlk6E8odoQeN8zxUpLCQv0vapiP5mMmfg/GsEc+X2A==",
  e0e5db0aed9f1254a4b935af84e8b9bef6d196010f831c93ad63a80a2ab5da49,
  "107132bde7c46fa3e3d5b2cfd975f5ac2fc494fd862c84689ff4bfac7816f707": "m3jEPblTKO6LxCAtqamFu+P52ExuOstFUU5YOR7XlcYf8k00UWZlfO/khd+En/HonYyluR7GqDqrS/njANn+NRrJnnyHj1jcotO1lENAdflH5Norxrmk/4eKiq6rspJTExsvQSsYG4MD2IgyrUiyMuN/Esf8iUSHJZ8BJDNApckbr2Rrp82+GvxaBdDZPsU4heMmPRDeHMFFtQuBjg==",
  a184bb60482bcbb54a72f9d68c99820b13716ba3887cb016a99fa36fb8f83065,
  a3cfc43832aa33e065e78e5e597dac1241b3c8f4d498245fb2ad25ae831abe80,
  ca40509dabf87cfd2b740aabac85164f70e7788ee38bc2ff006a793f83008250,
  "9933301d5e5ad850c8597db383dcc1710aad8b2374f9b677c263b8c6657b2670": "gt9rkQJxm5qQdz7jKbrmq2AH5+7NyzE8N76P+FAOcpsvcJMsqqOMm1qzTHB840vdJWADy+dDN7Uq2vY93Bxrs57pFSziaqNS13PDfSLgmYOsvECwXnXBh9+aKKfE95qksfuHLvojoC/pO+qaKK0aD2r+eIOxajnjJAGzH0MGSZjbgAHz7n8lVRlZAlG95rKqVD7gtIWYQhfYzcQstw==",
  "5c1453b04e5d034ef6aebec8ad73962b4cefae5390d205a3a0b7f233c4085cb6": "gAEp2ymx947LV+rbbx/JPbbSSNPuPKPAx9k7ArxMZPNrmq5TwgkWx8+PQezy2gba0JtP4zAcTON8dyZs+FThVgK88n9ZqmI8vEb5cuom237Lgh6dE/KYUt0l5yZ4S0MyEy61NBB1HJr/G4O+STzSVTBoH7pGyQZUxN5lrpP1IiYfNGn97cxnCVFysecSECbVbr8cOFpC1tBRJkoQOg==",
  "9b712dbdbc808e1bcb5758ee5f097b59c47340c5bdb759a5a6457643f3c5e585": "DIALurUzFwPOjdqRQ/rM4h6/gQLZ0zg4yAflxcJTzSHWoowH1V1Kl+TcKqLBUc9KQSMUWH2Uz0MZ+UJeYUVnmJRsQCTOpT+/NTq9fG3rEIou6Enz2DYfJwloFsZO0l/gHP/mHkjiwZhLg7hbPi/oR4pSkDE8yxPg+KhewLajng4Sg4yFPP3q/jYdaarkNPLwXu4UOA3GZnf1PmkeHQ==",
  "2e709291001ae09856623285083256b0ca1eda26c415dc5c5ae0e6a9de11f384": "AcZte4LJsaRuCb5LeIKoBL6c5Rehlt1iLtXvuEsATcC80rdxg+UbwCYYpIiLLhlfAZ8+ZuFJ1rE02+oPJeQHolT2MNCpnYVLopj6uPLkYIQhC/mZX2TgX89CuzHR9d0JMbYiOR5/ubqkU/xnM9jyVmsneis1++CG6rb00yR9/BuT0rmnJ61IDH8LdQEwaS6VqGVEpcfC4chUiaWf+g==",
  ace010936538b35955be78e258b089a8a556578d15c982c02b842e765022d282,
  "36592303043c2a84bcaebc6f4511107f6cc114eed4a400ee56cddc03fb759b78": "mftyeUmjd8jqSvcxDmBvMHNcMLeQYZzjonwQ51HQCmT9sVAL13nefNQQujY56w07R6YBQtbk4TC9oEDYf6hyKImbfzmKsoo2sYa7c+6VpNOCJFQWRT5yW4rx+oeIjUFkQwMA60j8pA6xKv3ALVqWHV4dxzqzBLxQzggYzWmZ/kpjkxdVYCJ8pGQ7WhkmPR8Md8s5tnsFJWZa1i8khA==",
  fbb757cf0f3cb69d533f12a269d0679fd819c24ff3914173b88201917e82cc6e,
  a075bd338aeaeac13b3de430bc33c8f91eef49fd33d627ed9fb4b92f32d8a28f,
  e1ba421f46b905ba1ca9fbfdf1950d0b4fb63e72116d458518fc1ebc1b5387c0,
  "28cfe9e39c04a5da1f872ef58a81257b8d33109a5cfafe19c218ebecf7c1ea0f": "XEqHhEfZYDdCG+j4E40tCDksi0cP4paHd/bvseFJshK1/2uzaeEVoHF9O7KHELliWJaZaofNfcLzSXztPAI6r2S649IgCqU9O9fE1WUzD9gSyG6LCMcKIVBjNq5vkl/68SSIzLtiDqOqv2ecmFnIABasnuLEamWqp/lUmqJ7T8Qoj0JIrAwLpS2j/BkP4w56EzJ2m20ZZFPYC/afqg==",
  "432cff54959711a7fb22338c5ba1b0bbbb6b0c14b2d1ea124314c30b6473335a": "p+aWDnlQLQ7H0AGyLz+5PnoRHWAfj3fQxStR1176fiX3bbwuM5Aq6uvFZ/TXoLxXjok6zD9jYldsj/w5P26aMW/K8cHP/SnW1EE5ii8jwOq7wzyMmCB2BleeHPvr4zg67NfBA/LsKyorDTRJbCrxuA6FCo8C2HZv2E+nB0uTFMwZuJfK6PzGPmzhnTAFP+qjtr7Q0aiTiGEOqsgA4g==",
  "8ae28fd3e49a9f32b282f748e53050df9ccb26b68b697d5e08a4363b7b9e49fa": "pXrxJEiEZLSEnz3ChypRxZJYBrS3yv/VmJ7L3CPg5fQYcSRRtL9VwqNl4D1IXBs2KKS9T23zf9KnjZLZTZ6IZk82WZ6vHdHEg5L1myiApiJmkZt1TG7Rs2L+sMeyj1F+cdTRb9Y6hbMzsMHyveGfqmqZqHITZ97uUuRnyxLt8hneHV3JAN+ZMtVM9d4glP3/XGC1oNRwOXViof2Xng==",
  af8376de5df3288309343121a616d4358c8baadc61c0e1d2ffa83565cd601f68,
  a778fcca5a89e873397f7d9ed6ce79a631da78fd7e7e8c8e90957017f39850f5,
  "0a9c0c371e67e4dbece4519d04470151d9b25bd3ee56a280fa0d5bd98e4da8a7": "JNy3NO9vmb+GvTOGR8hIKGAX64iwKroJu6OTOEJuhnmrxC5qrJK+2NBZpuU/h57osWyAyw/Dle9hUoXiu+0FFXDPkwtVDyfH+nrh4Svu0BwKii8P6Jurl3UgYWraqHt5MZp1bpglTkeqopPVSin/P3/HaiGxb1RVjJ8xZgcQ009uoBE+KrjkP2WuGsUmDQCQU5bKNUJYdwFwAb/wTw==",
  "4d5d4ec11c0addbc0c638dba21b175b9c21ba4056fcdedeb9b72a89e553bf892": "LehOOoo0h1ze5WAL2scYObtfdB9WY763ahd5I5g4RMiwsSg+xL2s7VAYRp8lN12YsJ9pXgSQlzgoVooj5h679RE1ZhpDt6bUyNyIZ3ALqJib5+xQzrNf+kQUjjC/kwj7aQpIdo2EuHq7hf0upe/+V+0Ku8RPyRbltRpmDbw1QtPjKVKWMol/SJrrg4EnL3sY/SncVjagojwo4jMYaw==",
  "1d7f1060921084ab2eaf374b3bcf11afcac484f7606ceeb5548ee2ced29d53ce": "zINF2H4vXDbLyB2o/i8LiMdnJ2iyVFzq294/x7zrwhmd4Vixe/ZGG9xtd3zciPnMzbJ/Zh0oU0eMa7PLmvWaQZpAdv+6kh/SbdY6Z7t9WbwVvhQzQI4rgPAMxlB0HzGeUYgOslYKIrGfuUhUdyVoQYRPAAyBrHmTuYaJL0rJ/7zPJKBoYWovP9FAABKRxt98qe0K3CwOjFny0e+UHA==",
  "989ed49a7de6950d95e2f67efd9650a26b32afb167d2272f2879cf46cf0b9204": "zyns0sylEG0gVR+G8M+ynHqT6/fo1E3zD8yo/AbXHJeeiw3DGyw3I6PaDhovUasoo+kAiMFd32vcv+yGutE4aisfLKyZMORPEM8/JJCVk/3FQtyijj/KTFkXfRai8ofSFu8syAH1jmKzcb7gAr0Qu41MXVFyTKn5r4D6XTwNBVMmMZeFkT8J+qGv7pIghWhfxuI0nmssSYsHwOqFgw==",
  "0ec8b06d098078fb388c585afc5b90390f457b8bf1c325b75f1c150b66cf54a1": "v3Bf6Z6L4BhC+7utEKcKFKny9XiC7ZvEQEJbhuxItwV2Lj2oyysMR8I/+j1gdoMHLSKQu7DMf94KYGu3rdFAoTEUKB5IJ7OAA4o+1fPxPXuUgE0uROx/PlBFKbHWNtK3Kb5Cds9WHTeaetmD7INK1rZtdHgsRTJElBEPyRaCHMgkusKmVcJk6zJW6/oKVLiFMoW90G2ROSaKxyu0Xw==",
  bd50d27d5922a52d4e8adcbe94278b7c99bc9aac115b21e28286dc37a8d00eaf,
  "91c9ece565efb45e03617f96ec4ff7ec41ce3dde0bd15955b27879de1a149310": "3StD7PJiw1AU5iCF+Hpjh7uOuxCXv8bBuHPqHH/echxs06KVhn5ZPH0WMKZzjrCtW1zfRYo6gRmhQA9wcCiUNH0yNaox1ULE++UlhI30YN51aktvKZg0RpXrsGRY+Zkf2rcm2ho1Xf0JJRASGNu8PHWagqqQZbZTbYe8u6u2gV2L/lhcamxodT2l9HXgqdQDrDtcE88gn/ZitpLy6Q==",
  cf6cc164117306a525d5c90a155403870ea460e2ec7a55f0ed8ddedb8d039e4f,
  "61c416c45c6c8d5d0954612bac0b0b9a9c15efe82d69528127b595f5a948d2fa": "bT1+LCMtqOZS8jqk9kFOekY35LTgMBpkaMkfVORLKTuiLBnJL4+AHz5dmVTFd/kLLkI9JcH3MHaJCIEfVoTw1QQKKDpDjzDbl8iZD2cdZ1tYzafAKS1svGiP0bgoUW/W7C7bdH3lnDOQ17Tcp0XUPwofg5rhaYXJclg6cYQd29wD58N6jych1WKnEdasd27fHudTg0i2laCVDZxiRQ==",
  "492e1719159f88e6c05353ad986944d0279b0bf171a2f274ea755005f2d0aa68": "3hQ1lxixbXOALetx1bfkI3Pm30yLhPuhGyzEfm9674kWXC8JNL5M87kSuOYzNemSYjlRCDFaRf5hKz/VZKkTwvRVedFUkS3gBmEkEyMdQmBVbidEzUToyI83HyDpvFVx/p4wErkqGGTbFYQH2JzFmfGI35ltbkVAI+UP2vEG/hofIeJL48rUgcdSJvY061amsZ5HA8/pJwY/hsxPXw==",
  "04ad14b7bf6b737a435d11a60509dfdf156bbc4710e68c10bd7d48b12c84f006": "IOKKYT+xzh64CVaqX6FDmM6Yli+cpiTyJ7stfO2kCfLfrtR3E9zfeIwSepol1dOOLxuLVwmKQgqG1zXo5+WmH5GzX7PnbQUDJOMZUD6wNbxf0xJBXennMuovqv3cNVxoRfj3FhIe7GEsbWMoWITSQFcet0d2ah3GgKYPGYkAsoYSLZyZo1T1Y0E9sKsBu8Bsnma9QUAELl5tCSPPNQ==",
  cdd0b27807ce708f322922832749edf12dec26b5a7a3a1b59167926f64b93964,
  ef21ae594095ae6f814f0dd9c7208826fa338816e540c113f8bc58dfca74548f,
  e85614e9d0dc72dfd85ffc5127e24aafc4aa8e1f2175a6b9e6a27457d24e493e,
  "695ac7fffba5793a69e0992d6d7cc8369d31c788ac1667cf29983af14d965c86": "HxIeWsqbg+QqgkcBp2dEPAJAeXSdHayhL0GWr8q8OrrEHEmMnHG4Dsuq1TuqL4lZY1Jn5lZWWCrfzqoHy+5odwBuPukV5Sfj+JdyZODMXCG3F11Clg0ff/1kozmzz9xY74ts6AORhmkqwJ6y96g7y+Hkc4To+I8ABjKm5GNgdlfxwjsyM3WaVc3t9vpJhWIRRPxEnuQTJmhBUrsgrA==",
  "82924c3b8c2467dea75fd039668a27f52dfd6f6bb85ac9728e81df5055299e56": "RZv2y1etTvNL7mxzU4w1CO038gR5Rp/vLmf4oiMS/5qZ4vkqOIoko205ccXmMrXQFl0d5ou/zPCPgGNMt7DgMcen6OceHfOpJ2p1hgpiOf6IUSZFY1Rq+HLp0xaz2++9XeorSLoBbukCe5YJppLEAuH5nyIZgoTUpbmfy6CduLKjB8PUPL1DI8saYZtPNfAe6nuuWDGpoezGPELn0g==",
  e585e4539980f4a3106ea061501368376a06d10dcf5e298946ca55c1455a9a47,
  e27cca000b081cbba52b63f3a0f3a30b2b86e15de3cd516ceb3f357eae984658,
  "6f7a4b1a4f71353763f52c5a9ef40d1e9d890d181e9ca0284edb4dcef794bbd6": "Ew/rpd5Xe/H4yIGmqtYowLHJt+VkJWB141A7RsvVNu7fWMHd42RM6rQ0YlQJS/qhKHOSA9XaJ7C9ZezmLdF9Cfv/mwP0w31D2oqyTxSvhrYU8ya/0l1vwAb83IcgYlr+m73BMWRsr5phOllsEpRqIE77AGCrrtfJ1AQILqkBkFE3v+FU/84QPwyqUfAkm5ssEwv1Pxsh2ajlCJh9kA==",
  faa122ba026ea7c5bcea8c3007b345c83f3fd5a5014d0cd81716d99f4e785c42,
  "740710553641a427ec6a88378ef2973ad95afe23fc0180bdf4090dc1d1c5d535": "xUSLn7nlvV9J/Ou1p7oLgPD1PUPcKlGQZ+6K8XrZgFoQIU+eR+9n3FprwImpBtf4XFLc/p6vMbTmCB0hkB8Iv3MEFbB6H9m/npzplHBU0yrTQKC3HNmZ+A0VbUV8F633c1ZgjVCgmE/5IoAU1UevCGO7PRATIOhViL34crUdJDJaCy2xVaB0SIqCUaEE1jxS9fDSgiucMoZm5fwGlw==",
  "241ef3bac01f2e1352a9496b3176bb5a0cef7c58c7f8b192a39fe7b1b9dd8bcc": "+EVEj0zXKRqyTN0s4I1oU0bB7lE8uA9qDafOSGXYfvk8oeThSxhMFXaU3Cx+uF7byNt1l6U5gtBqjaCGLri5HYSgXUAbnnO+p4+CYSnbj4Hfyd6BVvVerW2zEAcBxBrFMaABCFtFYbY9EmMvGH6ChogSy8FhWDZNw19w+Ja3CY3GwSRHaSvygyvwTB/4oRWD3pxJ6aU1ruegDVtgEw==",
  a575430ac958d7fdb791c266d8022a3930d92c0d11e5b7759f98e154a219d784,
  "6f9969f20f5e7fa4c18776a386f0ae39f724bba39461a62a621ddd12f5afcab6": "jrs+8PWb1Mpzbedhatmiap5sZCZwNDrVaqeDpw26W7rJvRym0OItHYYSBh1OEB6ECuYdSwByfJ9pb/DIKOT0yppWDmpsPWT2AaVqeF2sMwDq7r0MYIzeD946cmQavOEhYtgWB9oiQ5JSgw6fmdgEbz2bUKZXtKzew8bmJq3wKKknwmaoyeSud1MWSfN0R5fLUBbpzwqPvVUZJczDCA==",
  d5e23185ae8b5516c7583e03d93492653507e2d3d720b79ebadf8906bcddc0e8,
  "6319fe1d0c4404bbce3124238c28360e719f2c0c89348f1c37a4fae210c82b1e": "iT1nH0MleM0a7dEHpxjGVZGgjD+HdfRu38u8sxBxz9lk2FoNOT6/I4RqJGpHXc26FUoJX/LYLmQZNQuqvQISEs9NsXzrDNHdezM2kn3h0Td4gNtjyw6fJBLKs3RF8JspvB78f52rk/gdYWPE8o1WVcvViD5K6oBQ/NM/yM2E07jo8amyn3p/oNld7Rv+oSQg0z4/h0aSyYM+aNmMTw==",
  "29e82f8c0ad5ecf5dc142e95d80ada1f9b90ff0a6f7f310134e1005dd0a996d1": "3LZSlW013slSGzcFa/sDJ13stuqcKyZC7c/Ysw8bN9BTaK/dPHsUdyB7LCe0Kz0tRWo8tdG9gQk0Fl65de7NLffNbPcDmwMJckGwuSGpL/QiS9rSaQVneOlx8EMIWCwYKsFOEI5XpCigpJwrWYvB9ivrdtU4i+Sqbpb+hwMpvLYWbGn78uaiBHStQPxvUh5XgtvEv/KNm9LkDmaT4g==",
  "7d19abff1253b590fd1e1de37b55c762a859979191ce4faccabe4e7127e51ed6": "zCCgZbujV97Mjeb3NmuY5913Z6DNs8R794onAtEwBWCGII8R5K3i74tTNVKpFnRdWXkdotARXJaoj0J5Qr7JXVTFFnUjvWZTtKUp0rCFlmLGXc70Ti3KOcflJgdHqAaUIAJ1HFw80Ct6So0GWZ6ecQBiRAOwdmtNoOahBvaL/zjCMn2lD7vydOnKLHFN/OWDRISlS63fVjOBlSoAZw==",
  "9937388887868bcacb78dc5bdff88190ee1cfcbaf49d869c73c4ca3458f278fa": "JGDpEsd5cFnT3f0/iom0VYdcioL92gJlKzacypQEHKvsUhHAZK549lALV7vlGwQcebx8qwSsFVbDtVgo8uYixtladjnmvAE09wf1rxZyW1KmHPBPila/NLLB2J+vMytXw0HwPm/rycG3KiEKPmqDj79Y3rNKr154xLlaCzhv57PHNR2ySNyRDhdi+H3qR3NcB82R/aBWeH0zXZIX1g==",
  "2bca6c80f2f0f0a5c13d76976734a9d22cc633cb9d8af9c850d8c0bb79587789": "XbyxvlP9Zc82pdLWlwckgVDLkwg5KYPQjkIM+wYeJIj+0/nota+rzqTc2KGmJ2pOrnmgh71VfK8sMlvRlvTDp2bl/HXx+MNYP9SW5vv84NmctC9EqR2xogzSjozRsWfzEIc3IJ3UmaKlndKP5JRfzIGcSmH54va7cpUClJL3sjiU3NY8sklrfIOFcuhHTnYfDUGLQmXowT+O9GQrSA==",
  "53cb66e9ae7749ad6b804fc596ba6b245d0fa2a96194d8ff6690e067f1beb72b": "r68KUX1cZSFN8hKfavMTAV18j9LVfu34QCL1ZQIfUb3A1ilBbNtNbE7bYxnnZm/7ynD5MIWbgpMQOUHoaFercTiBUStShsz3iIIxqWQ+ZMdFrUSAPYm4BwYeHzWdzMUGAkNsEp+tUK/Te6lt2FN9yMG0Ne52SUr6e/AIXtjYioR4FW5E0ks2KA+j+sIiQdyuz83G7FxvtKtAJWmF8A==",
  a5da8f4219efc9090ad3c0cb9e18e72b32bcdbf51c8ab320f5bd8f024e64fad2,
  "9458db04e64e28664560aec3768672ca4447680b427b6b2dcd7f32313da9e711": "iBTNRwe5+AQm4D+c3q5bVgND10z6R5ShUJHiPCFVi2zD3z2bqZTtOmeTj+XGBAASHZnr7PCjNfwWeN65jjRrUpdOkvi1Ir91YfyJaV6iH9p89dyNgoqzzJVBK0PhaZ6uXKsAdFfCb8QIu5h3rcbMAbsWVWaFOI+8/Jo9Xsko6zprFmzDsjpz/Sma58/jCRWFLFpOEg4QAf4voyYCQQ==",
  "8df60d35c1b5b285e9351a421241024e5f58cc3e78bf39e68f243b04c899cf12": "KHlDzQKblDu9VE8T1OPDOVeBVfWyK3f/fGX0RG5j9SXFR3+r3wFLAOAIKYJrB2TQGNxksVrlrxmo9JnvnEcrI3UV4KsSNnIPJoZz68rYTykza54IV7rCCAppU5xyofIA5ZtIF9ZC08XT12oM9L9kmrpk8llpuaVBProLOqTjjdfnkEECKGXuKfQGwm15h6hlSV2sCn/GUI1idbV92g==",
  "73858786a6c24128e3949f8e921bf7fe573924818665fd464b8a597abcb3f305": "3mHF+ojPxb+30T1Yzn38POcJ7hr7W5NaFss6hf8WR4Gp1f+apiCIvzBVs5AiINYLl7hbSteGabPErX2UjexF+5nbEGLRE54Z+jFx85i/EidKsEPiCkBhcum7tktmBSwOyaTVKPp0meeAIaJ9t+kYkfxNIX9CVNSA+cGMXTLLpKIhPHbxQIzGGGSoHyE0NJ8Baa5/iuHDGHKNvPDZYw==",
  f211f0804487f274b9d33155463d701e470f52a3b1af84496186b865cffc3290,
  "3169a088b542b9188aa61d38c3b7533d79369348915d5482d5492fb3b6b02252": "e15YeoVjy5CMlJK5FlyGtcOX6pUl+UqJLDIKdvA6BZV6dmxTzZ+yBcDzkgaq5Vf1hFJz+Al+0MAaa/29onOm67MjORaHgSZVnAPB+ywluKyqUqFzw5UyAIzIxAkQ1MWiMe3dEJLszBdYHdjlVOLa3jSK6LSf+WXYgk5P163tPBclCOHl7o3IxTNDBiw4Cxzzd8+SXCh5ZuLB62MRVg==",
  "33d923258ca0287ed51e1335865c8c4abcbdaba9bb886c3688caa24be70d31d7": "mBC2RrGaZRB1fCZUxQUCiznDfapX/EbNtSuW1fw887iIf8aadZjX/YTA+H1MUL/x+YdZueTk6OIA/+kRci0ic3qyizTtrh2YyBleSdM5jCpduCSA+HmNGwha23WzyyT+KmjesclMKjKDKWPe5XYHFizbDCBFE/GqTNT1YPmlSKN0FZuLSczIYHd63Vu0mWbN+FKFE8fx31/oqi5hSQ==",
  de8d8cda4a5872a7fc943cb163caab69fc1212b84fe1788df39676d24d03fb90,
  "9505525ce35e0fbd209d299fde55715f09fcfdaafc3a616d8060c9f4bd0563d7": "ZQXC9YQ25spmusA1d3oKXL4giH9TfNgZ7N9kvbpFBsNRu8IdXj4+lsUVoPK3D/iIaug9plz76mR2Wa/rEAAHc+r95/vdp5hiJQxeR8G7FGN1r97hYh8880iMYcl5TX8bDN2afWniwb2o0C+YmskagS34E/fvqCns3qSPk5jz5nsSMzTB/T+7wFFKObFclBjXLwxbg3Q33GA3qTP48A==",
  "618d531e0906b2791cba9525ba4eaa50ff73155579642dda2a2efe129d4533b0": "MhXLv5Ev1Zd0qdNhFsSQgKdi4P/BG1Q4PZtTrcOGZc7NH+Vg8a5tj9hEfQ+XXTnVTUsshTWjc6SJwYxK/uZHmS446HnI0/KvdsUp7Tf5WUow4f/VN4azgaySQo9qYVLFirbZBSKxXU0MMe9lax0YXNADvxgKxFqXCg93/7vb/rYAdGMWLqyW9zpQbGqhJ9j7qgxPTGJPzY6AAgdEng==",
  "30f89e487a11123190652d3de44e29fc303e63cb182cdc2d4f23a30b547b0e29": "QUi3Ys/eRVkVUmRoBJ4StrmjAOaxC8cxBstMw4UAWIuhMxGdXPgXkBcB6izYNFeflDZYRT05seCUKMLu2AhSgd3Ex9IgPx97/7iZeTMXyBQurUX23F46SzMrCp6VsMDt9PbEOqHm/gQOYeattZtm9DsWyVuqhBGMiCEEXJmYPqK4f19w+8foRwOPmJYZNK/DDTLt06iJ/0zFGGZvJQ==",
  "4d5fe699101677bcf1d2636875edfcd3347f946c3fd8673361e25c0d8664ccd0": "N74k6PVkoUjEnSsVJPGYSOv8a9yEyyXTaceuqngdOSkhRri3ZnxYv3dbELG3BzMbHHDxwHpipwTfujSN+uJTWmpJUjTmoI9KgpvSBg4iJruZPikfc0ijqyFnpa8Mu4yZMQUzj0Ctd+4ki7F2UklOnOm2g98QhBJzN7eNJKGO+oCHEfvnGvU48DDs10YUyFwnBNFVelS/glVYrVGjJw==",
  "70dbef78fc5c152002c9b5f182581f4bcabf2d194ee0e0bc31f0ee5d7ab31a91": "SQ81jk0SdovA+Pp3izfM7wx/IiDnOskaG8naidrKv5IRzIOcFGpNE2k4nEjFln+l1m9DhVk9V5drIWS2TVoMHE/NCHDuKJnUVdziMm5d5br/I92Z/Xcxm0epLuzpEj2oqGXXjZYM9uMo6XtlSkStCeowZ9p2rNoGIhnex5p9Y5dg6ApD2vN7gUptjxu0VTn5u1y3v9fiKrKfeSPUgA==",
  "8a0e9f0f970e8c3216d2265a73285a3ab8d7c7bcb0eea1c0cfe0d6aed9f6cfac": "agX9rAmek4MInijWbTX3pyKqhdSlmLZDQwExmPNLdLi1/pjlMBN1Z/tTl8wSYBB+XROoh3dwdAxa6BO5uzJhZFRHUId32zIuia5LDU70+DaZygxXlazzTzmQ/XdrYSbPfuAr+wzLBi2FCDF09At2VVFBcpxDZ4jpMMNlfh9JMLscUZsQD2WM6zVkRrwSD1RHCHmIpazS7Aediik8Ag==",
  "0967ec8a2b427ace73a56e52f0749a8885aed94f76f98ba4cda604f5b5080a01": "l7S6y7gx18w8nLMU5/pzv5yZAlRpHobcxQ+RNCQH59redzvkVGZjSlJQpp3B1Ffr82haTfUPpfaYLVZfBEV7spITU1j+T0kjz/IBZh2U0Sx65LpBycT2KN2sX6Gsy7DGi51Le0AdvBfpKJBO990zMcPUqw7yOsFjAIkD2j+NPezSH3zCdtvxWhvLzZ66oWe8owB6P4R8FUaOZdKo5Q==",
  f23840b53f882471e775e408de2062f6846af25a5922f22ff45b68ab873f0b17,
  cde200e5e909557a626f3437dec12c4c5d4c6364f5d6bf41981dfa9d61d6f0c7,
  a9a3dcb0ea855910e39259eb96c7a0dac5902f7d5445f4b4a613f7a265dd9a46,
  "16f381f8de70e2c97dd3c4d30d315a4a3562310955eca5a7dd506d9eb22ab877": "CRQLLWm4BILhCGuio6T+OClQGB5BIR/N6gHgm/d+EQPhEHm7BM9bPQds1K+nqGv0jozHMs+bDQRwQAxGDjNUrlAqWVACTXPpNl7Qf/MW+ZwsvGEAZI4RWVAYEkY6jugcZ5lhuazpUel3alrgoowYglyFn08lzB/yqoPjcXfncwPEcROBX+8GCrpUpYIi+KmIXiIPpOSJLdkSPWk4bw==",
  "0f09ed19c7f23d45db6299121f085de366f5cec31753021fbc28ec3a0e4fbe6c": "2PGwwU+L2T3BvUAkDxYef2LL8c57FVogmzhxOInfohaWRvy9duSnRV6TWQZ0sOC7vpo94kNSrxvI/g/60mInvhzG8v+S1A039Re3vr+SQ/7R7mOgw3RcsDBUy2PC2mGczlddNalAZE18MrRSFXwHe62/jHdgDoskedABEoZ85kjDNr42IVVobF/WR1SmrVegHQVlj//W5jpiISZYuQ==",
  "2d5d052de1d90a7fb2f1c4beb876aa0e77a49383405f81409d36ed7492ec2cd9": "Xg4HnWPmFkrn+Utkid3pMN3lUnNGl+E1YpU6GFm7qWCJ9a/U4dLVDtZYYs7tYD7F90zD6Y8EL8AdYHhgRULVJpUI9Z18uAO58UHOMDtvrPupZHetFSJNy1/6cPiUQqko3R8m9D1VkEbb/QxFUH55zoqmNcU6u9bfRVot1ehp4zHY9rsgaF3Aret6X7Rje2q8iR0rT/WlpJuZAG4XZg==",
  "3af6b602985f6b9d6555ba3f59a2ba33d4ec52c8fd27bfc687b1507b430f0a13": "cDH3ZuwducIwKoAsYx21QYeaRUNdWwYBGr2E7n/Dl3bqiks8+cBB5dyZWmpvzXBDAUYtLwth/CXhLL5WK05AD+LLJigFazFYQ7I7uymins7IEnOcakCa2JzVc6NZ/qSIenaZX34w+8O7S+1bYBURA34j5lCmWd/4jGXIgdpuRYQNP7YUF3UHcMKIbB1BDOR19lGhCOU809p2mnor9A==",
  "24baa081d4c88fa60c20bfa82d270ba1d42117eb0c69df1be91f4b6fb009dd06": "o1IsZqgO0N0oSrCauwOSwnT+KbUF64X3rhzlPLCtZdEPv7b2Ieu/rUvTm/JL+ZXGtA4GXp2R6H+Mhu6ngyKtEs33+9swh0KrTe8d/oKsnP9U+yetdl5R+wge1Z8S+yrzSvjH4wmmPM+b9+P9RF2S9403TQ9Udc/6CVfv/xxL2N4URp3+D3qFNoweCE8Okq6dgF7GXxxd13hR9gpOtg==",
  d7553d2dd2cb090ddc964eff28d741946416b83d2798390433ff8f60094a263e,
  b9b4887d7c42b380674097ed8008508d5b3da36bd4418c4b1b139d30da07696c,
  "040425e4358dd8da9e14f9bfdb62f8548d567c95522a1b4dff13f64a8bf3619a": "UKyAEtpnvOsFwHWTxz6zlhe6FeznWRmxkcK2nYM7V9EndDJcx4AXAhhRYEJiYTNkhH92bFU7Wuu4zUEuWYC/lDZN1tjoYRrEh6P8sFNNE00o8S+gFWoVV7xNPIV2sMTZWTgEa2oYBIYPi1ni5b8f44AFDgdXuH8odtKIPXCELlt6+u9JnhZgc82MplgqYn08nBS/9VG/NOMwDWLLBg==",
  a1a655113803b2ef0733fb45b0e7eb57520b6701fd9f7078aa1a7b702072993b,
  ac99ccf81ce48d86a573def1de331153345efdf8c307295960aa30648a01103b,
  d57965bb6e562fd677ab692ce1f976678b22a46583172524aef4750f48f4570f,
  "653b8c1784c58bd7b25f752df966dc3310427efe5510d151562543c345bf7f37": "drylpodgvK01WI/fao0fA8rlrjumfnT9V3IomtXIgrNyU+9XJI14C08oVJm++T+qphmcNu7BgouY+DiYjM6tSrL0ztupIVWZ6XrUtgLrSJ50SjxybduP6JUB2M/arcCpgNW5MrzL3IVGFfQl/oaHu53FOp8RrOkbRbmONk/2FLj1/p+Su3Sku1rYuqZD0ZNN8hO63Y1CPtbP5w8jHg==",
  fd56e7f6562d84a967591fd59d454a69be424426121292852f8888982fc42ebe,
  "1c3bd359d5c767030c8604d7f0c00ef9e80f46930ab859731404545a0def4b7a": "uLZb3XANY1DcbkH7hDJ0RFC51aPoAqF7+OIt1JIV2fMd/polSOj0n/bvht/xH8vf7NUtcuS0VGO86chRr+AANftPmezNWgdxtcVkjsNMNZVtC/hjpCTFfkhpr0V9wq9DjzfK9ZcTumrrFY4VA1yD2bAtAUK4rNdtahHgjpd4sBkz8zT2w4cJ7o7FSs1eZQtHMOhJudTADqYY1eftVQ==",
  c00887fd2c260c7225d4e38ef419a6a1ddc0e2d0ace5f9574cf7ffdb6444b323,
  c1af76359e6bdce4dea21b719202d3357c4f93e6bcdb24ab6e8989164dbb4959,
  "4925fe05059bc4f76a37a0511e76c7faddae867fff154fcfeb195f559ca43069": "j5/OY8GyQVULkg4SIBRL/Kp6IGTJP/P0ziCJy4gbYDkIy/QQQpO5Am+K4yZPIi8xZIJ7mKHcI9kmfUxrd4NkTKffFYx66rvyO0Bx8J6NnwiWmHEYSXBYY99w4E/CFFz00+IDdV/sCk5qGWr+fiZk8bS3gao6M76EChF8G4/Yv7Q5LQpXobFpJTgZuV+wqMo+L9OJh9a2M3FXFLFakw==",
  "8116bacdd18de2ad3eecfdfe9c740c67ed5adfa52461fc3a112175b05d80c2fd": "xUjJlyskYrtX7av9eFHthMz5LpeoXmAgcl9yvD0JJOPhj1DUhILTufycT7HK3ktb0D2EjLs5udnyKIkzoKu56HRgoo0RN7F1skRmr32TU1C8AIGxgj1im2k9jbD/2AqpXvgRY+2jIcDHfMqx8GDlp9E8f7OOSdk7i53VO+p/gw0SN8JHz9cj8thVgxT98CO7RmQEqy/DbtaC8o42LQ==",
  "36a14bce598922536908fa05e90e6ad40703104acac0ad288e436010568e2e04": "6ClQbiVZRYOELiLKDdZ0u/Of3XAHp99zIWVhZk8jCxWsi5ZPegoV7MuogzDPa+KT7wEh6Q7ifG6LCJlM/rP3unUqRbRWCa/STGTMMs2NqKLoQri7okUjdcGNjs7NR+kgZJTgOTAKb7pikQAkAf1ifXfWR79iIYtxN9CJIAKGoMX/m/QjMGkar2bYqnJGzXhaWviCiRO2+j39xVGB2g==",
  "79081413aeadbaf72051676f22d1a7f25fc70268e674f2427f323aefb8f9d737": "Fn7lEtVjZw+glA7RZpmspN3ek1RPmLQ7XOifYkT+YFn8JtRJUs3NBq7NNDjoTy4prR4Yvfwx362J54Ym76zuNnFKG3T0ozsVKu8aS/rjJoU/Av2rI+y233yoo5+Im1xqbY/s6M+nviwgl/4VFoWVw8B2NIannHqyrfQxBXlXb4u8naf5OKCxcXb0xRmGldup/TttLCsx4G1aR4R++g==",
  "32e09b8a66c0d008bf22374f5ac121b93f71bc39df101ae40aca5fa8419bc3af": "pByAJeJfGT5h1NSah/OPwmMdKOS9zfpDaLBcrLhLn1MiaNnpxjSxuUXFKw4+YqUoKI2SmVssOa+AbXztEvvXHobz9+tr0S30Tv5pAy4fgVpbgQeN9dqbM9VG8rawHeOyBP3hVccFEoS1cTQTUMFKPycnflPD4twD7ajvkcDfenOQ+a4c7QhUgl1bfxFft2CpdnwJF9A/ncybTbj+Hg==",
  c7c8b92eaf4d10ad47b81a6467106dcbb9daca1e874bbc536ade495ac4914131,
  "22ac34584bdbe4fad5090e6492b0b25a40b6f128c5e0227b8aa73bd2a04d4199": "8NkIaAk+yWGUsieEhlZ4vlLKMoPY5XLU4iAiK3c5gL8TSMoFfQEkvJGqsdzkTAbXO3U0W5am5fL7AiCFPK4X+J9cwoe7m7cymFdvbdXn49v9hoGSTwYUnYUXenQx56u+E1tgWGO1KNsc6uUEvjqgu5fytrzjvOFTEkx8CiwGU1v4myju8edvKqIO2/pnCXr03OpcmJuHdq+C0MKPUw==",
  "13956f3a27202f1eeb46bbde294d937d6ca2e4445607ca048ac72847499c3739": "djRpfpyLbTXc3/s8uWA0BkAXteOSJgoRs/XRGbN/xt4mnhcbNIaRKPYeulDceYpHhEpIOQn9rP1PHdyn7e0tsTZMaZ1jUWCRLPGZpNnj0HFW3P/80KAJWdtagCfX2glN4hmPGl/uqPiAXd2bjT142py22J6PPNFo8SRlJR+sLkEfat31nV7pIAHPF4jNd/btpAFPLMmZlCGsRUC3fA==",
  c44ed88b10896284ca1c814d375db92ea7c4683c3f099cb712e9efb40051516b,
  "3b5a4119ca14c29804f47be82a40008e7fe039e13080dc9ec0c04dbb44f3858d": "hItodFkB3lZmqnsBHaM2Aq8OO6GrhT7AzJTCuSdC2KWUMm2Z8Sw5akyCSIfvLK4FCc/ewf1MiVHTN5arrPznNe7nPX476gp/N9z5JmM6XuwXay++R8P1u0/QqgjJLC/XIPQDYDaw8bLtWJMmsCZwgiFP/nOsVOAaOl+UC3M7hTDgYkIUX+DYAlaVtYUs3OtKyJ5CQskasAmigCUzJw==",
  "28df807183b4ca9e1a285519e95ec9f459b00f4745418708fc3542cb7437645a": "Nk+dVYpTxIn5oqDTyIoqTqOMl5TcDtF0ls8yEOH3CpwnGvU01+FZ/GFNiRCpuZjqTy9JUZdLT/ozi+Rq3MdhMrkZKCVCGyjAmCqgzyGtwATDiNgbqR5trJdyH720PKFAAs0PaRGsnOu7huzHQPDR9J+L6DuX6ufrg5+P2AtF7XZjWJPTeIRhlWhWA4wG0yid5flj50y9ukLPAh7fCw==",
  "112a78fa32702ad97cdd46f31615255ddf66110b72749832eda1370c7275f4f8": "BaVN+p3xihG5vxRSbyWOckY9Ph3e5/UXCkZefulT3LFJGg77Qkd8L9S6vHMMlx6RkKrxJApJ8ihXwjdG0mAoB6zTws/QketaE9ZUDSl/WZek/avDkfySpjK84lV6nYGRmFGu/xHRMdb9LHFD6J+01UzYea127uJmb8Umssk6tfHd8Oe0r7JbJPq/EO4e6inAOTIFqX3lEcd+Q+3xUA==",
  "47bd2ab0b2ef738e328a3507677185e658dfd5cf23ae6c89a16f742403d8655d": "nA5iwNlwfvgDeW51A42SRKs52fb0X74bW0MRsJ8ZpQz0N3npYXzFQh6fzhxgszJqOFCCpskX270HOCI4wMVyaj1PPiIKP+nJ8OFw8ZmL9QdOi+CII32C5HWQiABUOsH2rNUpoDqsdvZHCd28cFqkHhiLBimotfM15IhVvFNegPdVuutW9c4rBZsfiJTrfv6wQhPxbveKlTl5sCWSzA==",
  a831351769481aa854a127a3d3f0130da7d8e1f74030a7caaa60133acc5b1b67,
  "8666a547e31081dfc5f51899722ff66aefeb09cb18cc6d41df2114f39ea58dd5": "XIEk661TJPmsSWgxogpyrBGVYCUUIUi/EeM2zO9mwlyx3fLYLu9ZL7qyXwbKSX71MQVFWZsyzj5Moo/zae7KiJ1KDQH4zi2OsN5rQGui0amDmpNsQesdTsQg6hcM81CdKhYzuY+gaJnXXBw8GzfTXsHoiW4cU4c5qN0oDyp1g+3wtuAvij7dcrv2Ed1Y5wi+0pKJTOQwYPBIlynYEA==",
  "41a1aef1921e0f8ba0f62fafa6e5155faa689225c2f3f9ab7ef4d57ba553e31c": "UTVZAj7uDotduvzEhaLyNQkbkZlgHrDZz8xaJaUEpoZpzc2Es9c0ZNau/jTRI36E9aux69USgLuO5OWw+Ct4hesgoC5JOhMleXrHViJ9vlxIL4aauJWaYmce9rKdeUHMg3/gIyHvMfVXt5Ui8ys/h5ZFiEdfereDgMWv6HFJlKYQSUTRHTPwRBvNnTroLXWaFi6dkAtPawb4KHWsMQ==",
  "29b8ee2c0dfeb5f44c0cb312f92259f99328a4c88614b2aaf7f529d59ebdbe52": "LfyvHO8hlTqA66OcKXTsyFhjmr/BzYI8XfEW9NKoyVpE/A1wNnCq3QR76tYeMBgEQHgiDsin/8OBDMaL4G75ZhWQvZ26d1nuhqTe/HD2uWFQMoJmKc9kG3CZN5CH2jELE4HF3w+BNDQo7VnQtXHxxuJ5FARu6yUEBQk1xnE9ZK3Rh2ofXPYE0ZtgFb9RQj+ZxivkZ+vud7iYWbockg==",
  "419d2c5eb70e17bb1188de988522dbddbe20539ef6632aa7e1bf966428dfb3d7": "7yP/Kwl/lSLCdAZ9XtzOfta/dhWUUZDACvMP1ZPIH3SsztV4ehDn8WBoII9L2aAQbwoV4yKIdFh8aOQECet5BpgHAUSrEHDN7uk6U1xNScDRwKNSTn9o6jCRgqGiOQOP0BRAxawnQwKFGlJowJyO2dNkBorFFZgugTI5SArCronMvo7fVNJSq8rnG6AwiFjalmlND3MjO8KGh7RKMw==",
  "981b1d5078cfd4d4d544ecb818729d0f5f5da2f142ee138c9fff3a582c346e4a": "zX050rNoPto07FADKyNVn/j57w5Mg6DVXpEpvJWYbHwAQ/22I3h0ObgEpGMT4ehtKyK/LrN59+43/EPRgrnZAox01KQB7c4L0dZWu+sZtsbZIB916xtARPwEZzkNK4FBQ6qb0CYnyHwK0IkHGRpYkFqanNvq15Q8H8SPqtmamVYgdJ9lMilH2z1cZEHOz0BKIPDKrZJ79+j/X06rIg==",
  "5a2d793b9b0d6e18aad35d860d7e67cd7021352dbbaa12250611dacc5a910482": "odgoAqx+sFUCyFb5GG8PGmdZkgBFuNX1iQarYXv4U2G4apIAyCoBmiK95fsOLMK2MewKbuDbaTV9gqB8S0MpRN4/58RWxMlpjs74OXPbZ6ZTJ2gGxbsUL/fRjP1CGAdfxHO0RYnhgqlEkL3W2GzJsh3VIhmHqGJmdv4/PtG6II+FCXLg450MXir1r32br5WV9ok7tPKKDp5tn+KJKA==",
  d2d882b47b1a46b3226fe51f44e5b17d65bd4f8d04628886ff19249b9d198af4,
  add225b0531df988ec44547c37b6f6136a10b02fdbf53ede0bf1557acadc5d70,
  "29ec0b8831d6cea506628e5cf86baacf136057084de66807a303097355bfca31": "Y9X0/TSOxsASqvt+awUN30Iu/omE+713tvOuOoAPJLPSsaY0Qy8jw5hY/SsJsV39qn3vGcKrdZO4Q2Xqo1brnLg2rxnP/2kfYMqlWO8XBsq+m38FBZ5JAUiVL3f+FQzgGfumAv6Atc0yKqMPAU6NKnDTQwR926yXy8spV6YK4as+CBG52fGPiMxbWWBchUBnWc8WR8YPfYDdFFBSdw==",
  "725495d849741b4d63ab0edaf4526ca27d2895cf6791c326b9128427b89269f1": "w6GnCqYU/BHFkS/ETjxrxh7GYYXG0h2j5e/nKKvBHEQReViQQzaU7EViMSXguqQtTY1AhNI+MHxYWthma/mvKFHhpz3z1dMjhCqBJMHPNioZgaAJZaOqHt16Rxt81/XcONlUCjeOeCj29AO6ZGPdyg1umieMCWFYvy6yLx1uJ5IbhHQ7ja8hk8ppZrfkfqDg0AQlDv+y2v9/pN29Zw==",
  f332aab19e2ca16f7f9c48058003bd2bb0f510ce9df83b26a1c874f7991b53c1,
  "06e7b9cc86d1e0289f54d0152adf1e154b95a192cdf826b5134339ca84e6fc91": "giBDloXm/pqqdvsgnzbzSAl2QY1p5K3E6YwUoAyIok4zN3BFR7Sr2MIzFPvRh5uxxOi8uhWuCKigI5EWT9wQWdaK0Rohlx+cPbxpIhSvdnzVA4hKZajWDpIi15EYw9WnqnbY/oKiCo2Oz/oLY9LfQkVWQZpR/B74dk7DvuouBmbFpdx6Jr541pZHAWHdrmLgizTtvqyr35p/7qeveA==",
  "9da92381e12a0a95b69e7fef5879ffa454b9fa2ed9a8cca054920a275aa28ed5": "15CevtMln2x7mftlk1fQoc1eHMcA6VBFDJMgyvjF5Y4bJJ0hkl//SeQ/o5gqI3GMvPG4Bbc19h9T6tZNdzlf8PtURT39IhJPB153/dJf3UaqLuZhALqjNLbZAa6BsH4cyWgvuFTwvrIBt6ZY8QKsHqzAGXY8Ar6JE5BvHYfWWY0rPOUsiRzcQ8ycoqAXP5OJkM/ja+9w4T297Sb53Q==",
  "16c74c65742a2b3caf5d84bb95d3d751990666e2514bf73edb9a038aa98eecf2": "un4H+R0yLI7nM/njMKVfv3AKYXz/B1yXxbYwYhkSxTgV3mIfFsLie/6/XaCQVe/Aj3eEBhMpF1t6L0P86SzvfYFgdF7OabT925frciGU1HCsPmGzC0mnLZ2XpCRFVP5fLQnrYzcGHeAf6eoMQSD7UaY43ej02sRih6n35gkEFkUhZG+wrsqxiycjlnzejtXGm7CMSQBsLH1iphPP/g==",
  c0111e5dd258d5f8a5a6c06580a0b6bcd424d64a82c2c3663674286696b93485,
  "5413e52de07cf745e3aec8dc0711c9ca6fc60aa259225a27bd927cca2718f1fc": "HV5ifGZvtMgrQTbcgroFAfY3YeU0ySeA1ubzBBhysCiVkGQ5jCG8A42hWWfAss6y/1h9FL6CN3vcvXT37+/A8rqBmOF3CaO5lfuM+XHo4Tn6hFuPb3hKw3TszSdZI+0fRGkW1CDd+LW60Evn3hvU7ciSREBeANjN1vW9A7d5OYOd4yvHMya64wNZfMCz5YfxyVFcoCPi+ouHlZeMgg==",
  "55c58ff6fe29e9b97f8f4f3eb1203a33a617ed8c9c41f5513bd997289346d8b6": "stpOw6i/k+0aao+SxdOcZpbLH1HuCfVY8LXnItnfwGWQSUKcmWweph5yiUr8yV9n8ZRZ3e4JhTJX+J74PyuXG0TVrSN/HwoxpW7ew1A5cHplnYWbDATLaTq9iW+soLN2OM34NRDQxwoPu+4xbcnji7dHUVQtnuE+P7ZcTeSOG/5/RlmOPFXhKHR5nU5gKXTvd0Aps6RP+BWKYDPWHQ==",
  bca462345facdc6c56bc28d69e413fd3314ef831adacb17740f1e05243000875,
  "129c90e32482f8c45f9445bd8971808783c4cce09839879743e43a006d5069b6": "d3JYnWsWAEdLixew8n/FfLu1FceHprFDTIOEE+bUWFRwHNg3HVc490zfJDTPP1as5P3D0idkODvE8hS2rUvhGhRiWIVv8VgY/h9KHCi6cANGIa8nH2Vha6YsPYTryqrrzFxeuyI4JVSdeGup4buGCNh+ZpLpLtf3yk9GGrYxUPPxD45vpnFVHDtFxkBal5hGP5OuxkDJmfEVTmnPLA==",
  "83b05999078a2f798cf8fd7a32f2ec4f338ccb5f5e1cdac1cb0f04c1a893b7d7": "1g2etB240DUdnC1OB+NCQU62JLQflecvkhTIEqa8aG3HYD96koqGiy9zfmkuMdC1556xcS3+j3exd/rj+BH/j/jtt0YsMqeXO3QTH0UUdI5hM1Z/PqrpuwPvszDESHT35AmJFhHXWQ54dwV1QpCD+vk59b58ffjo8JCpDmICS9qSF2bmx26c9HrCr6xX04uw9a/8RSv1pctiM27l6w==",
  "912d061236e425a7393f5b1c4a3c45cd266ac31ad8ecff19634887f4c632a762": "De0Shk9VfLNexjK7EoHAKggEtw/KXs0Q/wN9bQ83iV4wybsnhQ4pPsR2uh3a42YvaNDWBEoUDun+6/nJGxzuv0s7c1mu+IOtYIEo8W9wUNDp86uwPKGrZYSANxNgJgWvaqMpaAGPUcl+fSMCzFclNRuNmxz6exD/ZsFyGIaXPunQKqd6VlptqzhE74OCKp5FtcQReJMR6Ca+VQkKLg==",
  "96baba01d434e37f66757ed0d54b71781821bfec58fb62b678f80b4e5d613e0f": "zZQaOoOqLYhwqZ+Env4iCneTn1lh36OKXTQ4ectosQj3cRRBD26UW7AEFdpcIKp95y5pbfXcligE2IXO/SHSQNvi477jUVcITo2VD1LTF1Z93RUcaLnGf4r69gqyckbHjJbU6cFeiCF0MHC+h5l4jW+iA78442YMzrTDSiub8SeWdQTPzCtYSiWbzmk+XppcG/OCr0hbc6LHdrGq/g==",
  "12b7384bdcae68529559f0d20cb1d0084a1315f6d8326aeb5a7e7a4688970b0e": "aRsv3dwaI0fKvb7tsO4H95y9tTzXsAZ82fXAoaDrQnVF/PB6gitQUonfNTFCsEbJ7uFb8ySEMFy1d94P5/NEWDWzhBT9O2ptOaKHgXNTQRHJkRNkvUq/yO0RyeK7OYTWmmOCrYC3cay9KWdMFa1FL5q9HKgICs2zwfxUT7l6LpXkG+8KeA0iiqYyXfX2Orxd5t2CQF6cRfTzfbvtlg==",
  "28ed27ddc6f0a876e6456533cf76d8092a25242d279d01b3a0095c51beaeecf2": "YZKCYNRHftd6GQtvHT6x5hVqb2KNCIGWKGrRen9uIkHMOIKE0hwmzXkiJo0Yf3BzJ8kh61IxQ2r3CLu71YJhsUFc+y/XJ4K7+E08QP8EZ31zfE1uuVP/zpl3F8gVp5TUQ2wS9PtV4UxERAddL4LjwaBKThB5e4a6fDZtKmbEtH37zlDA7UncQBtaehCq+HNYMHwqijYHlCGwtQ91rQ==",
  c34781d57fea4582034ad0af17b7720e77b31098897cb41466225b172a22807f,
  "5d44a732eadf0c6ca9a5af3444db4534d453b0ade4af72e553fe0f304ff5e84a": "75z2RUpp/3enHsU/gg+IYgmkAhG/mVRvOz82Af6CivGI13geXUdDl7T8rbTwECQxAcdct7r3Ge3aKlitQJ2+6zNjPv0+s8eUUENWlbBMkun10RB0mFQekIdoVUkIk0CJ8EZOOjanLJvZpx2OrNhs7GWzf4VaTr/bT7SLcYNlAh6fjuM9p5so3Gnb9XKpjW5SVBZlPq3Ipj25Zb9Hmg==",
  "66eb08f1f8422f94d3d64927d338c20c20000bf67421cf01aecd409210c51f9a": "OniRbD1S7hF9hunnqaysYf+09DxcVT/E0RSBSE/CEDE66yoS68StTf4eVMHHiw7rZFIaMBO0eWPz3i9rJkKEycitTQYeYiMTSWpo99bA+gVrn8UkesMnrCz7ibL26E/FKYWs8se9uKnqdqTbX+jCW4sa3Nu7yNWBKzZf4+Rju/3UIRORnLe9H6M6eDF8EjB6IWbW/ex1uVR10PRBig==",
  cb7d6f396d1fcff84e11038a054ccd4933bfd527a3a94c9465e7669ba4071acf,
  "920008d065a5978e1d4c71a419a2baf13a6db437785c02541c94e163d2fb5efc": "lkgBCN2+2Vu5Lha45aJNVgBExVYFjKBQXyr3fZ4oH+qupAOyIP+vg02EhcQQnoJcM2/vX/69prx7cf5Nck7Dx+vT97zyxUvjalXILDQMhHTYtgyRGLZI8z1zwkDCHasN4J4fUxohBj/wS3jxoFTaRE2xF61Xut2/08Wh1DN2in7A9Q4TSbyv7kPFXtV8ERofqZj3lRzRmbQ5Zr8ZRQ==",
  "9ec8254c1326e819e2352e7d7c596c822960e16cada2255b9bb24418d1c44ed4": "H+SXhmDVOjNpiqLo0Q9pdELBzjrQh3G/nzySXnK5eLBjwtPlKP6PYK36RS3ZzW7yN7GE9o8qxXgDZ8kKNJ+YoHfXEc+G3AuB+18g7c0Zqiuz7h9IvMQjchR9A2xgbCR8IKiXyvhDMAYxpZyk0MEVLUTnLe35MEKYpNkL4ewOYxxzUU/KwgqbhNzMWAAJuDwa88s3qJBIRFUH5lO5og==",
  e631d3ad70d4443d25e9fff5858afc97ca06683b4a0762c83e0ed6495490bf01,
  "75062e5ee833e26659327a3cc0ec56bff52683eb2db5ad96f06b675040b439d1": "R+ZnqUMbTDz8YM+LXGhW34iywPW3s2/USI04LD2uGNQb1aGqd1m+ke/Dw9VKMT3ae0c8nMnYZ6MTTzLSGhQArgynQNSheH3La5hAfzpAe9yh1RLRWhG93fmNECeONH7zCiZJmjbwFuJ6HtIzw1MedgXCWhdnWWXE01lwuKMSZwV/3gW0jPMhwjvS3X47sUCYoXCjpunQqoCQTqwsAQ==",
  b8cc05531961d6f180d21d1b6ea8663b090bee7dc88b1c7d07634d366ec26298,
  "8c0522d71612f11b439156bbf51c1d644203954037c44a384d63abaf4b2007eb": "sGpdS2tx7zgk3nIfHMc4doSex5uBAMurfDFaGrAaiN58v7avp6vMvo5DeHrVOrzdUir3NKWCKgkleVbvybB0Tk2lHjWvbqwsFX+HJGTiAv0xGqerbrFPvJvVwAWiX4DASvQR/sIvuhECJNMIlEfKGAMth+ON45pAbIC1px9/A0JZZnU+/BUKHBrE051j6ESjxtx8raAN2aDU1NfJLQ==",
  "9df8d188bd4f320d2df02c06e631bea9819b3089b2ff49c501ccd56d63165477": "6OVd+nSt4bbMbc5guLUfy9nYnax5d71bTBH56RjP0XEAEX/bgnBOQQrigMVfpavPcqv0Gqbt9SJcfhyUy470XkH0I3iEhSutF/lj4WY9rCb/Tte9N8x87ApyJu+vJPsNygFu7qsE+3TAb6PE+uCDAJF6Js2wkb19KrhDmbpBWdrp1fr4vagtuGEOHUiurQX9Ck9MsOsR9bxaWHkfLw==",
  "4923c57bac436742eb1a7f517a5f358a64139cf7ff75a17ee171aebd4809090c": "6uu9fT3kH8bBBrR7PfzCGzdf28pLcQPPRaR8W5NQaws24ppOfP5Ll4DAV+vG1FbWPNdMozL1FiB0/Hza2huvAa7bxxxlGS6waaL9ahdhFX9feyWnCtTI9VNXu0Y3qR2dnn+vup6WNepwdkSEqHCPWyRNYDoXnX8dXyb6hxJZ/MTUmdcLp1YnSjFxG47a2tV4OyHctwZbr5t2j0OKGQ==",
  b4910ac930d06b9d469899fdefea18b5c99a9dcbda4cc459afbd13bd99a3e9d4,
  fc48d0c0eb3a2805473a87ad25c0680e750206c53f583ef827332f9cc3ca7945,
  f4bbfc9f271ef2b110e36b1388f3cb16aad51579f72f1bfeca5b3365d39afb03,
  "1a1e08894717961c10637dee5b712f6cc708232525997f69203f59dfccded447": "3iOabCk+6V1ko22qqcfAJGiFIrthXapnKKQyprioptf6j2U0TVTj2PcO8YIqDm6M1vK/5zMq5qfIvWtsNJMe/oMNvZUY7ifk2AP+JSReoc5V3ZNo6OPSTSqjBFA1uWsaASEbciprmTktoEnkuQWv1rAH1ttNnsd5b5cS+ocGXhVdiSDaZUp1IxCNzTPCQCYDPggTux7LuaYEE7oV4Q==",
  "7baa2732b7c14a160c2b4d4f7ec5652aec22fe3a5c73bfdce04efa9d209d4540": "YqD5TXTuiOXaQtJ/fBUtCO+0rIUxnJ7pMaDoit7oyWFW0ODkMKEHkKsjCq4vvupOgli33bAEl3ITkb2s8bbu5+pCIBMvM1pjPY4CHFbIwu0NI2Ej94WSh+0x63AIhWr3dRl/KKFj04CSgahICQHoKWSVwh3Y9/CaNk77SVI3sE+lZGGWEPX/uPPZ9M4x9nSnwUfuecdzvMKIw+UbyQ==",
  "123cd2e59019c8fcb2ad06abb28c2d7bbd694a46cb05bffc8580fd0bf72ae742": "D8D2GfQRyclEtiKDWOqoOsSlZqMyYiSMIpAKoI/9wVyR6u/CpDzFhI/X9Rb+JLlq0wY4GZLYFi6+bLCC5syvuImrZgwdMaYeFvG3Wza9mo1qA0lwre2nwVnWBhHEN5MmgpJz5hsRzqLWG9Pc7vwKW6Bz/FBzNopQYe4G++d6RVHdsl0WN9/tSb4Tli5p2ev0ZzxPW0p9gcTjbKUCiA==",
  "2bb0c1dc412e7a64e1836e786ebe41abc48961fe5094214d67e249fa6898f6ff": "qOUmAgeETXvFKBqRN75/jjdReG5VaHDyeBclYpzKLpj5wmYKD6WvC3Z2K8XiDEy/1F1safsYmto+Y4qDdKXmS4FcB1GxtMMZi0Bw9mpzrLdREfNxpluoM5MWzIcbwqvQcVVsTD66UXnbqmGAYRNLwdsuKGB9Shu56zmHNnyRtHioZGtav3QMLZMUVBKUWFsolSW/Uf33LoIbo+kmXA==",
  "80b1432785467ee5230223bb07704558594adcc29a1437e573df00531ac96a70": "0593SaR3hvt1MkAgmsBvPkEwOAFneclE30k01ZcbTILH2vML0IgFioIDmkA8bLCKiqIdPmnU4xt+5xTexVa2jGdoR0UemmIS9WsVbXbRHqHi1VDIU+RfooiXXextu3yGynn+StZ1EomLmbLNg1QC5O9XJj/CND3ijJTTNavsytmmcK+A2hFurjIV4Hj50RAER6X6axFyVlgy8CPfYA==",
  "0d2fbdef4f12d1ae1a2574392c4ccfd321083c8b375274f171b082932609e615": "3/RoL2J6HJPmOh21JlZzy06YskUQ4Y6LzET5tsCQGyju8wz4A5JQ8C80ru9mCWBmIvl/fKCewxG1TkFgVTK5tSnIjew3lvgqqVXLQfUadE4fKniw4GaXS4YUOKETc5wldb8TxUGDotE6pUYuzV3STRWUZSSg3mbte6e3IVQQ4C44d/FokAImv9v31ylcov6jSeNfxI46o/SnKgbcvQ==",
  b8fb41b61dab1ad54c358ce547396123facb3c18c10ba8f5df810628b4011b84,
  "0f2308077d2819ee7375d765869e8d3db27758aa5a6dbd956285d9842654a718": "B8hN+LqqWRqcICIYnSUHglN9Hjfoc4Gr3TeJGoEINmodeW9fM7aHzxzhG2am44irjdkj6UsZAAZH0qaqVQZm4fj/VPA3HcZ1EEJgwGIegm8MPd5y8U89FXiJGLME4uz/R+yH3OUFgX6nIEmeoT+t5VZd8RDiGZEt+Y97AOiY5ZvxLkrbOul2cIUots8WsAEqiVj9RURSXs6XhKbptw==",
  "5aefe1b0a2192cf3c944c51bda32fa8f32201056cb81ab33240f25ce2d7f5734": "BCE8mWEkH7XPYGT0rgDiRTBHBKMO/6Ll6sA1grEO6Mk+Xcff+EVa2OachI+0nVlPXlnuC6UGlXqgwZzCXUrOkMftz0vFC25VeWKp//rwm8kus8cyNF1eRdwgV9k8MpNScFLm7T83c5HX6c2pEzvOXjzIw4lmNOCnG5ndbsOBh+20MSrP2P3vH9FUcgxl7flSLshjldmk6cjZdpfcMg==",
  "0b74aa91d2ccb123ac28aa3029fa0713f38261c6c1e38f73aa03091c553bb40d": "DdUpJjegM4cFvlmuJ7CuXoefiuLVjb53qvpHNPMnie4wEqUjoEgqpQB5laTh6k9AaMeybnwUx9ebZnFZcv/dZqvUuTCgx2hyxVWdMFZuEQ6r47UrWWLOtZ/u3vj81hi8qzYx43QgmAZEMZHQduCXEpAtwYGIDi0pgtMrV2z8BFx9o0tQo0NaFPQr6XJqIuvF1axC7crmB9QVJ52L5w==",
  "057f098a66fa909c10e550d52e2f2f8a28cdf43f819c32f63d2f84b5fa89cd26": "0vhOmePa0aGsjjXNwG2t2J/lKF9nxU01LnW5vk5DEG9vaieilZDEW66zK+SPdCLx8C9xozuz2fnJ4VshSVs6aGIYFHSIF3vfKGPd6OzZ86xsbTaUv3fd1Ip5Qjl5q5HfnEyfeu1vsNj7vSqOj7z/0fiQi4Zvc4uNTFrWSShIAamlBNMY5HP/G3YPT4heSqCyEhqJG3lWRzAzKH3AMA==",
  "64b8194677ed2b432f693e0d8edf486689b51868e23d76960cb74f317004bbca": "/moLoaXTvOEMfHfMGQ0jt4LsIPRGFPKA9Fioee3VtNcmhfDOhBuUhW+nzsOpT5f8dthzJREG3XZ5Y+UQlsVKzp+POVfKvk01uBfmXCRei/+xS84rp/Yzea5Fnd9FYZw5ZKVN0GtUgPTp6PwkQn0zIqF4JHn4WPbflulo4xpmV9iavjhlCSMjrjEiKtK02RkwHxwhTyUL7Lk78GVnFQ==",
  "873ac01ced8f5fa3431c712097b713f4ecb5fd0fd37dc33d136ccfd977de520d": "/DIiQJJJ5Meb5xyt7nJpHFNOR6SEqi6MQOV+cQ47gzBLT26vsU1DLw1AWGGfHa8Ehrpuy10yHbfc0TPweg1ZA7Frpro15Kq+z6NIqirQ/Fu9nvl5Ehh4T00L14r0XUEXfKiwJDXIc+qv7kuqvTN9FAZPPX8V7NgfORy6rmQiyVsWVQKOIIiyCuNNvT055vfAQiGCJHVbKqUUlnTkzA==",
  "94f92bb4054dfb633d8cb4d73313e42ade05d6d72a68c009f77b1b76aaab0132": "GVvscBa8qfcJOrdshsH9IV0iTiJwu0UQt/n5PBleOJddBnGC0eA2y5kAR8jFRkrxFBIxnbWiyfh0N9ol70YTj0XHkXJXpVtOIk41eZ5akVxXWflqHt4buvm7O0iE8UuzZhHeAejBDzz0U2RoIOHKdgsKL/N2mpgSHUUEzg0BpXFkWV1rFTehCw/ZG1MgKcvX4ARta2j2TYNOTFF1nQ==",
  b3c6106abe5e60623006d43cf98a522039059621defb97621bba8f2d904a492c,
  "6462526484959fa36c2debf1eea45952bc92235722b3fce9d52b058312700e4d": "ESOGt/drF9HL38Hhc8u6Jk4n7RIhgdKjRDqW29LgJHoHglZoJ78nh1aJ9YpnDaS4euwBFanE0mEW/g1lD35+hHZijyVlHtugxaC5ULCf+fYXeH1zfC8oK8avcwooPsxrznfg6FojZtdk/bmNbRigmPqSIswiSac4xwcj1XF4mzUJvCin9FlzVVl0EfYYY18Beu0x0Z5Qyyf7BvwZAg==",
  "5ad86b86969a3413a8f9e3959e54e1ce7ab487ca6235310d59bf4c32227cc080": "KguOwQX9J1y7ifWiJQXUxCJDQR4gKydtPQLYrIt2zydyuNjCpb06v0KXvB8yJDzYa9GpoY1OzAk8PAXdNlTER8Hk5zOqYN2f5dXyLQNiwCMRW9WLzODsf68lDR9J5KBAg5HPxsc2YuG1f0Ab9laizOkow9ocv8Z9adtXIa5JUSL7OzoRRYT6fdvdWT/YGKAdl+Alh8qX08gL3rOprw==",
  d1f22fabb9674bbc3dff328465b48e5ea4fc0cb5a8d96feb150e1bd8bd4f0809,
  "335349f675f1e4385c0d61f699abc76eb72b7c4673415a5265ad9146624136d7": "MY220Bu5ipik6xCncjKuJT/zaCNnt7m+oBQSBXYQGn69YG9gBMwrcAb/fYGlTirEXnF6I5ZCRqtRV2xV4Zglia282eYVruHz5o1/yWsmtNWmeJCVbHBd/R7fl8Kecb/pkYb1Z7gBIprkQ8bH6Qa/70LMa3KrkXjO6aPhhL1egWdZsWBCl5XMAZve+jeMtPQYzsoVzNSOVxE4KpzvPQ==",
  "2211209b39a7f556a2629a0a43f2ae63878d3bae59261fc573a02447f56d41a4": "0KkKrnMBGEIdbOPcE8HKuKItZ0u2bjaIIm5R9arYzoYJJtePT5Od5p263wwpSExLip856HOD5dNCmEmH3tqKOlLWS58qhmz101dWmQ7bAwtWAvm7gP6dGHh8sfuo3UnIbe40sGPvsslv4uLArOLQfsuIMTTJeTb7Gnn7mvQkij53ru3/1NVw0brhGS4hTyx6cYzfBKWrFFTIMS+D8g==",
  "77e81734afdf0d575493d964498a3a07742bab5f7548ecee9ea300f2b5250d11": "3eFb6WJ8Ud9FcjyA4NJL0JDLcIliuUP5dy8Tw1N+ES6ENEsUAcjJsLRBjEFaCVlEKBnTM7RJ/C1ThZ8qfY6gPN/nWKSxm9NGT6+d6KaDoH6L/wsLdiKWgQgA/CKEWlhfReJ/TrkNSdUXCK8DUflyJZzmctoOgzScGtqBgbqnR0PR43DA41FAxSVtrVlQ9pArpM7nSmE0W3nrf4sslg==",
  "16d55eaee840e994340c6992e5467cb4a17eff74cc9183e8603341252efadc4e": "6WugNt3FfAbxCz1QYDMbU5Y+tI2mz20Htj9zHS7n4BNPAx2OISWTztpFbOKbKJpWM6IQROdH3qst/VgBE1YMyKW4Mrb/9gFaOvpmFwQ5U9afHtnGDcUqyFBoNNJR28Cbrw3WLvuLyLLOdIEud/O16jEA6ZTWxi655koBQ3G89U/6zzN/AxappGeK9hfU0Lt2bFdOVQZ4zx9lo3jWXA==",
  "9a09f5f3738764341284f69f7401de8269cc23940d00088d79cfbcba249cf02d": "IpzwV6lZ7RLVkgJTnQpI8WfzA48V7XJJHnnUNYgjcVRkQdDAiXNay0rrXABVKoC0Rpo/fB0qvckDw5UyshTWgivzPyCqmy64DBI4KZ33v9SmJS2NU+Qg0iSJE2wwoLtD88Za+YVTFe5NbvQ4ZhLFqEkEnDvh41J+qwPAUtDMGxvhiQu/9PrJuxAdxnNxhsqarOdyzJ0a6GunfL1ROA==",
  ed55ca931b46b0ac7bdd435012b9c38b84d5b491b07910b98ff7536de51f7a65,
  "1351c77f281d816071a303be68a9be5a37243af21b2cbafb4f815b281056de5f": "U9A5QPULz+3k8BHewm2/BQnrZkr2HP5IOy+7C8KL91QZfSN/bv5IBFV2G4Fx/Vvpz/lXdGcbgxJn6FhAX+c3mU2VlZ4qsbiOoUxgjqXEKVhi/vnhvM/t2w+ZiQ5W0TC953EzMGU0YDEnmn3pQvaQ0P1LD8RvlFL6wIjwaE1Gip5Sbn3nwnsyXv4ZOHwP7PIMDRqZinhxeZKFGsjFUQ==",
  "57ce3885946276c2ec64e0f4036186c1c0365910a9fbd95ab0f26da400a2d61e": "fuhXG8v9bezJoi08uR/lw8BgToxe6zjAb21of6Na5b5u/FQnh3n5sxhS25JG/oTG3BSSgWLlUBL+E+sPa5CL6zv2vCq8llEN+jCpvyol4/YxkEXTgx+5dxvO9pWndSlG07u5e/KV5ofmjEA/OQBGy45R4RjFGYRcj+wdBMdV6hTnwJ72bvTI1p22t3yoZnh/GBUuLVGE2m2vTzaI4g==",
  "0034e0f783bb06f305a10568c92189922f70f8576e5e3d309641b0b44e62155f": "rRKERadTwWDK/RO0Y1wt92VgfG3gB71vG2YTGlrh39AE5KZ84WyAJj394UF/oRGlMKqBTHVRKbByGQXcNwXWZ1Ffgxvp2sET7aE21ht4HfVC4DIGEVyCWDi/u2a+SLPVLRriqVpZBH12MACpf8Xd3oeTcopVp84TSWaFKHQ3LxcZOaJ4OcRIRg9nfQcYPDv5wNJTXq52PMIMJi/hxw==",
  "9cc348c62949a399001f3aae3251624db73968c0b818f8d6c964946109686312": "29xPXZxfiI8Ukg/vAgsgumGoNsZB+IMcKtCbd9bNSd64ZlDsjvDNiRjsQt6Z/HSuQnAfH/c87oKo8rt9u33TgwIGpURMnR8KXL8uExBhaibRLuRCFXYKKs3Ahuv6g7vucdDObfwMxeAvIdXAm+vLDJKsKM2kYWPVXV1bCuNwmZdZko+z91HaWpLQuaPFXq28r8ea/gSVjeBZ75fUrg==",
  "9f73554c5ea0c3234326174528dd1b08d2ebe3b233b1308c98db3ff21433f837": "PrBK5EEA6m53Q222bg+0zzvRo7fyU6ZVR31+g5ugKsKmXcayv6ML2j5pjdediIe/gFqX8gBKpRw+NXzO4bk5a2ISgoFqyjr5hxdXvWZtEGiXzDyHWBrixgkGONcCehDgvodAGrlPXOM2HgaHE5uNEHKFi/1mB5ZdFcE3Kmp/f4YnV+LZ/xSfZXsUFAN9q038RBFDpIW5QeBpr2RNnA==",
  "4f746f5933725f65ed14371b3092c272d30d619e48f6f896b34e8825af0dbb8f": "fqUrQem+Kco+D/zR5hNV+e8W8JGDcGBlL0mudf/JyixhBOViimz5oriCHNKO/+iyb1iy8L2ZlgaxfZ+I5Fnk9S6WYLWHb5d0stNoUFj0qaD8Oz+zh/ANttefuVgL9JQmSSNapcTQ47LwmSYWDA2zByOQKH/HQWWyHeG5pb1qoMztvk2FJeT0ID30DQJTyPHt7ZqePz9DKDCoUXe0Og==",
  "4c2324ef1380a5fa40ed58a13fe78f1994341c6c83a0cebc3e4d32cc57313a1d": "zmE1+5n9Z5z78osVwFc2ssS7cxCbJkHz7ckrrizZl1q6QU6JnNYtWpoDldYUwH1yK0H9WTqKoVoc0pvx/xrTeT+4D2lJtU2mBYNde8IWHhtcESEvk+tTW6qENnqKapKbGkk2+99iU81814D7q0B05/N4rV4SYjJx3+ZjWwp930tTYFBGE5Zk7HzAndnlEBHuOoD2z/P2D2Cvu/csTw==",
  "39569ddb70dd8608c2a809785faa2e535d78499ef23a29b2dd08846b85d9a121": "rkovzrWgLK0CqDVjP9UticAgvvWq1SnY0xouA8bPBGEw3RU7I/38tesFlsgPP8qtsxRsgu5hKoAygrfJcfZ/qNGZ0i7ujxZCTpeiHu0tkiP5wfstpL4voy0P3IKRQ11xe688+DSd+2PM3l3SmAznypWPV20v7ilqEwsW9ZszEdzBvuej4HJP76ZJrqjQsY6bDbjV1zDcElaPgoquMA==",
  a5fff3569cf892f548daa0ae0dac68124c53a30471f1a5346a97e12ad8f111a3,
  "345143945a6c1e84762bd1aa33adf3fa947a476beadd463b6902b5cc488475bf": "9LZyFkIMgGnF6ug2JTo+iCx54jW491e4ysyNA3xwb2Xf6ap2sQgUNpxBGaOJKT/f3DDt31TK9+bnC2MNa/sGSYulzkT3M9UVRcNvxJCK2jMJn3PQF2k68m0BgmEAjt2IrmuK5/PQQBIFQ6cSokWJLEVHenMflKNUYPOHMQOJwgvbLlPGsNzWlflDpv04/hM+pZeu2iz4eqylEmGntw==",
  "667247599fccebe7abf07d1faff4cacaeccb58327e897a9326f38dc6e720e7f7": "e5CvpSOGhtK641RHcGMk4b3RNyweBkvXJSfwjeWB0iIp4Gk8Z0nAe1014MhlELsRb+ElYRIzDGuNjX+cDJOxGYtNx//ZSlGLn19/Tc7D8vDhr+Aatx8QA4zLejIIMPjvjJpR/+dbAc0Wv2Cz98xzkvdbQP/mMqlYWShb8LJ6QiqCl/T3qxig7lAZV2My7oq63rOWC4h5ec4IHgzDJA==",
  b8c24c87d05275520bb58825c83a428c15155f3dc93f243bd0da2feb1bb5dc54,
  f95f169d04555d41af124fa54354258c43d9eefa0f3f3de0b63690641078950c,
  beb38ee9684594c61bb2d716309b70e591ce397a5a2e3a80ea401ddb36bbf931,
  "98404ca1e1787588c8712d872ef4f9a1648f6e03d15e47ec47b8e5ae5f585b16": "9SBz6JO3OqG7Bqw2qYpESBC/rdOcwtHBGB5axzjKuZ6MaDd/W2ys+cb6X47nqR6DvNN6lgr1V6oqp+MpAatIfdFsmpOFmgw+UogOGlTLu7iSZoqXhiqsFSX3WVmOlYEolt0ow67VSyDHI+NfgM/hzsACAwEcRpP7veKmPK0yVDCqTbmKwRn59r5bI4ItVkSNpGlRoVRiKeIWXnAGFA==",
  "18798971e8e9ec9585c940753181c395f07193c67827d8d50a066e4a1d76ae38": "KvmFWIhpb4snBEw7KJDXWXITROqH0rO4UKHRT+NHv+vjrJIDTj7kEm31lvz2H5HsHoeS1n18YlmEy3HZ0KpZ2g/PqKZ9G2rllumEM1NV52EfXWZiV97hX/WoWbboMGVMS0N+7TqflV/gY3tkK62ydkJhQeqjbvaN5XY+MJ5qyYVaUl5vD79qDfM/ja7TB9PaOtv9s3yikFEuXlYBDQ==",
  d8f3dc67d0fa88f888f11d412e97cfd3ced0cf15bb0f057472b6d649b9131d2e,
  "981b7532a5104ee4385b0ab8833d8d18b1fa6238290f3ef6ce188ca2f88f73c8": "CZy5VE1u5t+AsHUIT0RgXzqH0euCpzW8QPpycY+kLN8j9KjXnHSlFYEzaQcGVqx8sUqfmJoKuKGbYw0Tjtsitl1PiXprJbHfq6VEaUmoplSE/0JJUULzstUdTYI/4NpYiiqoCYMKFmZoICjPfmXcf1eXNPsTkzMzX4HEcEUMrqpszWecy8yXMgEdKt5hHmGIJJStzxlr236EKF501A==",
  fcd235470362759f3362c67b3735160030332c85d65e6df84d39387d040e8525,
  bb18362e8be79dfb3360bafce0a134544b9179d3e9ffe680f09aded927d5eabf,
  "1dcd3797df3799999fb8ac152d78982467f4f872de4b5d0c1c746099d0c7cf86": "k/qs1oYswsIaWxXi7jsRWqrzq3irhHp+8xP6ALNi1AEU/3AJj06L+U41yeJA+0FySKx6pkieSPFNGxmp9YNA/GmKzXDpXU4Aflymt2JpKABiDhrdcrf6XP+AXO705qVdY1SB0rOPNptYEy2/9q7MostYS5VM6SXMOqa5u2oIOBTuAZaN5mcXsEru0VA/BIMFMLgVU/+r6zR7x/vD4w==",
  d9ef23d6b7b274a88b902ab4d7aa8151ab0f8f21eb67993d56c114b66525300c,
  "2896bff8b145b58775f128a88fa1bc942153891323c1e8025f784953315c22ec": "c5W55oNWcxidbd8qIlFGfF4j4+2I7CrduuaguUkk03z01daQdQ4V8QeT+NW0QOgRA2uWTp3lz1zpwvEOqowoii4So1nIFrgcryOhLAMe4HKo0nPJ/iOZkINlPTraNQzOelILP/e3a3qA92AKPsQwvap/CX/FSy7V43/+S2FHQS3M5aIMXvALJzG5Fgy0zSKjKef7OQpxLiig1P0AwA==",
  "670e2ff9b29439c2cea39af0cccb862b0e133d93de57cb6a8b41dde31a0867a8": "r2RSgym8sNBD2DHg8BdAr5uE5euNmlBlYku6Bl6usuCh2h5+cxGCO3R/OZUv8oqUber4ZyPol0KjcPkhZtiD7z/ncEXPzDmOvdlAsNR76EUyoDnJGoDRUwogKnXVIoR2oFUdOm3FiJb/C0GI8itF1B/Rosk8yw7CV7MJbbwQPw7avb5UaakarlYu7aJUOznLs9owps2xmbye5utSRQ==",
  c577025098dc9cef5685b48144fb19a98c21472d796c2b3da7b1221c9d449b90,
  "61aa83f2c36cfae227ac41c3a571480aa322e807e3272844948651d08634340c": "Xyj3eStCoADASiYnvBxLhdTiR9oPJ2LqzSqt7xjA489nZ0AK4QG9LZRCw/7Ez+MiQXhc+Bm50Sj6OjEQFrDIX8RaEEyjD2oMBgVMbLwOY2CQKOhIPUj4ydIXg/FrzmlMSwgTGmfWg21a8TpuqseUtD5rG8kEaREsNetn+7v2OpYWp6/5vCvBoS+FVHdtBgkp+lqO5oGZlqreqEXoVg==",
  f8adc686a4a0b2ff5adfe188cf13b674c2bb6ed5d0ab91bf070a77177647672c,
  "1c3e5ed6cd53938b957feaf51a9225b6a211c1b1fd1dc61cfc39215520adbbc5": "pui59TGpdB8c4XG65f7uXbnhmLwIX0iAcwWNBO98cBkLmd6ZuSL1wYC3v74Yij6JuZCAQ+vEQijEGs07l08F0JkHVdhT5YG/+Jqj+TpxM4tZIha95in9YZsU1yVipwpZ36nV2aIx1cqXGBR+jdA5xFBfezasMp1+IvV07u9ZvDUT9bqKRLVMgxklkYW04l85e3pv7wf4KCxGAfBQ9g==",
  "5799e5325246d920d4adea345998058a75aed23f46b25e0a0a9a5757def7ee03": "ofctfYNh9kmBhaG1hhNLBYmmkRp0YqlNvG7N2V+JjTtZvo6S2VoqamxX6hn5S/LJd7R4+Z341no+ukKUye3bPO3ld5pH7dnbQDcRbuPnJ1rP9xx+EV/Y8Dlckqta6pClo85LgD5uxWnftsoHRMUa8oO8ODGi/1vqkjr3YbC86bwwN6EZRWVmdqbq7oqSv8EMglgzQvL7WXJvT1W8Xg==",
  c28879f476986a53aa3d11d951cfed833aa3c599bd6762205ee61705dc00d982,
  "81c0543b20cf401e67c2fbdc97d5ba1f8f2bf8b5e4e2e28c7e3cfae60718e7fc": "jK+tG+L8oggTLHJhJUw8mwEDM9h/Zqy59rs0ca74gR9XqYuitIk5lFpcrA8tkxLenjB0fHHLwn7G4zy/N9gCbC8RsXnCUQ91HwmJHmcT1CoD9CJTFF1zi6ELU7tZ3oCchkdhS2irohcLZl2GhXeiwqsbWshw1kKZqRfaBfYScmCR9UBRVJ+Zd80vYmaXG6oz9Mu0Ip9XlvYMKJu3LA==",
  "765678d4cefdb9fb3146a3b28ac21baf09392a89ff8b65b08f85ad4502fe64b7": "MnORQcayAuTs73gXsw0Sgp4EYDdrwVsE6BN2SAuoWJJoRvo+1nuorKxHTrLCd33sAIL09JO8CZ1F9zQwN5+k+tBFbA8Gifp/UMderomDOA8juVn/aFb9+FG6gKryBqZgLrP3mXcideb4VeJAT4qlr192rDuw12IT5oAKGIViYvx2dZu7CIQEYv6O2UbWKmnnZTOBfYuiMMjeLVBKag==",
  "9d38f7d4913dd5fb2f733b819d7e99974d34b20202e76e3ed21fca87ccb2e139": "19gk3caF68g9mz700BiKxgqqhV6RUQqcYZ2kMHIpBsY4xjEf31Tfmwl3QrL0b/sGyqF/KNdDbffevUNpulN/8S9kysi8+jpV/vsyMYm4TBcOQ9CXX7HXLIPietfh679Cj2gNGnkaBY3AngoSVi6tfBmofpxDaWwCzxDJAnF+1+Dlx9fiZvAeQOMzwIonf1N76ch5/N1/XGIuxrK3Ag==",
  "12388411e8de8f7cabbd7c551452e7a974993cc17ab7a3d4c939223dda543ba4": "o0UQuUQPTJQKVtEcs8FtD6pbnOqVKl+sLlnlHPMuDdA850oCqBlrXSC+ffL1bkr0CMcZebEBfNgicZHk5hw20v/SKgo93qr9sQAuZdTA7jMGCZzf8nYr9WrYn1lC3y5Dt/E1jODAQSkw6lhKmApYsGIJ5LJ1lRK3Qej6n55rnleBdIA12HUTo0nU5US8Nl4QXeRVvKBAK47VOyPKIA==",
  "2a79532dd1d2c5cf190c430bc54918c655059e359af7d6d9f11c7c24afda8d71": "AT+/72Z2NFRFFauSY+9fMiwjZmFSiUdCHyVSwQvtA4+/Q1ZQ5dZpWW7x5AwwBdYywZaTWE0gbsMKy+h4iS0V2YTpHiaFmsMQBKkwCFX9IMx1rWMBXXndvRTyKMKdrGNx+KpPxRsmNM7+YWgYKb+EKsYk9UfGNiAVC1DdWKiLANXsLiHwCvegFRWViIIoTGqhpupctnx8pjApNTau3w==",
  f176a2d092bf09cd5c1f97079f7f4da0dba3d002a1c464294a0d0a9d854e7373,
  "531361a88899a51643b094e015de72e4910bef1c2a678eb65d87c19907c4e618": "7bOl9RrWxPgv0ndmBurzRBCCHO+YfwBLB/qR9K00jV3Z8/hEheptTAqKwWxbWAFRSBgwfECtn5DKuymPHi2vPGk89sNS96nxlrOM6FngasOiK51wfeXBGoXVaaCn494LJ8BXuiaxqIl3f+WGmprn+3c42UrLk/4hLBOBAfsRQ/Eu7JBRNMHJiHxI6xLE1+BPMKlCjkAkNHrSplAD1w==",
  c578af126f4d2c99730d577d4c4bf55c240ded46f81bff8163ba1a844a9576b3,
  c03aa1fb5987cc0c3db1ab9d3ec86f58021ea4369c397b7bdf5584bbb421bd18,
  "6f2cee8507f505e6cd640093bb73c31166adb486207448e11869a42081a27741": "xbm6HoMlyjarGSbKFSw1gmounrJpYDhdFJxfvvVSKbUuQTpPhzv9JMfm4XYNGQSMrFz3NUPW28lMw87wknxuIr6M2vqJENm/v1sTZ6OhuFhEolu7mi3TxtnZr512hhhLGqooZWUX9Wd1RfwAQAGkZ7lnCgTbax2PcRNZGvWP4TVVsc2QHfdL8/0OfFHLWpztUldco2cwpyoehl0rtw==",
  ea5bd2bdd9fb16eb4456ac3f60835eaea01503e5ccd85ae656e29074f3babcee,
  "0a767429e104d2e18390e92670882429df0d865b9bba4c8edc940e180ac22b15": "Xah+Sds6Cu6RH+hL8G3gW64lb+YCqlGTGTCe7oag2dDzEUq9GwVQ80SUjKGbF8/LUPofCaYNekolAO4nvZyoK6F53SysL6FXBzhpIqU7RhvpSpYsP3XY3TTEgonDPc+UC+5DojYof6lA6mQTXoDhkkHoUzdODAoVEdF5I8I9GryGzuaf7N9UbRawL/rORemfc4RsO5Xms4gNE9y1BA==",
  "26afdaf05267480d51b467d850612ddcc5f85d220e16648f26246c5f270f9ec7": "IPYu525eDFVYC6+/9+sKhVRA4HUD9L2LQipHOoIOiINgjJRG9dr0Vbs517Mr6AzTY3vAOMz2R/j54sgcruBW4FUsubP/grGUjEJoSePYT6DF62X2JvhuEUPcpaHULZ9y4OGTPHu2CFPiQ76c8munQAbg6utpmSe2lIwnHNQGByYxQTw9WCI70p6ziQEIrDSAfHNf9+iu+D2nTLpdWA==",
  "7a7a700c877abc599c56f1f9d5360b447a593d78524d2a86ab881b3ea071eecc": "8lYohpClRxdpi09nyejbVfp9ZT4fAzFeN62h4f/880LXLvlaA3v812zbFkW5IqRUoAiVZF+3tciy3MqjCzFmN+Patfgr5/4HBkxFVls85U2JEjs3z8j33mvQHjIf8+cNyBtVroJJs2uEOkX2LAOv4fFk8dIKBKu8HH9xUiv22Yypb8F4akQMyaLxwzGl5UvFYUbKluAAugYGst8hUw==",
  ccfb5b5fb686c64ae37e75717ee820b66d28ae5293fd67211475f3f52381467d,
  "883d25ed0754bb086ba1383765b39d61b7bea2635103a40070459d1f19a1c155": "I4dapHTo3V0rt8OeWYJQ+oLQ3Mmd8cG1zsIysJGzng4RNIavMf3xHbYEeZOT/x/2YQ86J2JhELlnkbG0d9h9VeU7AKTIVhnQG3Xt+aW73CYu2mhUN3tAPM7d88Dg4Jr7P2JuzhZ+FcoDfchj3TXCJnPGcAkLSGTb/t7D2Kn3wy1laLzp7ZW+OPuxgLjs7Os1M9fnrhMaQae6Miv6Pw==",
  "06cdad177b5f04916c8b2455b1a1acd0bf7d6619dab8bfd5b263db3a294d9c98": "y47fesAhcylf/KfHN7RrPpjSKluyvD94CYLrMKWSJz44IVjmudDe5ROAiumox7iJprbJAeBdGOwiXa8aGSy6ndsffZxzLZYIiSGtm8bqJL+XaCd6t9j/jPjvGB5eRTanjHdJt/TDcp52V5GFX/mx2Hm5NGWSEu+/YsgE4feDOqATywh5SKgiL7bG7xNYLuAJTB7gQ+F3gVwtHNIg0g==",
  "4c35646b0db60b2bf44352636b49364d6c2f0e1c6c5efeaf4ba6203e6becae76": "mLqRmaU1i1/YwBMCoPH9bG6cQC/qucnUZ/x7Lqf2ApVUvAmX/n7ZiG3NNOq4xrg0wYZexb2ghU+QgeT+hRt6hPX6OJbE14mhu0/bMRswtNl7qqiY5S24Dhk/vv7qBWdGwfAF4PbGTJpo2ERmSbPY/hafNE62+Czg8cX8DZPQgH8Q32MSbHP02RAz5euCyz5cektplBP5+BVydx5U7A==",
  fa0070626b3d3f4170b5435570256407047998aa981c4bdc76213b8079922a26,
  "94fdc778f2e9b18c51a9d0cef66fd41636cf358940388e02ce004ca9f4136865": "aTqmOs2I84WC+cGnJfwhsNpOISKbql3LdBkRQ0E3wQXfgx5+U7+2OXVHxrsnJyg9+BwkZqgE9MxObpB9nXflN4sS06UKfO17Odq4n6zM77Qo4lhZNEpFQz8BjonigcLTMhuoGOlCR0znPUO2nPJgm3cTuHISosifeAFxg6Z/tQ1IsJQknOiQ261socJWrCTW31FH2xyS4WAliHQuRg==",
  "62abe6291462616f512d30ea1560d254f0cf8ff04630a6590d2b0d6889070f24": "EtGocH28Gvvu+LWEoTJc4iZrk3O1M+mtCNPRHEYCLbIPV1jBmT5fGFU9Rp/AeN6we903+8DBXNXMPqZGvRPl7toRT0XcZVcnT6dEcI28+AtNM5gICMp2vcP6IJXnksdIXjYoj4gyd/rfxjuvp0jyYdw3qtZqixXqm3g6IwKBkWAVUmKq0NtU9lQnBfBQMHiDUu51oEwjHWr0plV49Q==",
  "0b9c1b504b5924571a3fffffc9daf6abfe30a2399cc18df82ada0d141e1c7d6f": "QZiD+I268hUkDAhQ6cQuydyejcKnCUv+sWUH6bERLNsGddFlbYDNeEbv9G1wHjq7ZOTokOXLDdxcFJmcr/snqK2qDERIMLd1F/d0dOkqSf9erC9504qZPIUuIWFNgNFqN85rY1SbiOoJAh5AOQjZb1gu42clwP4jkGPzFsaAkCXWBNzv6g7+NKu/KUdajlbOqWT7xYAeetcNcnamiw==",
  "8105b88cd9ddeeea5a9adc050731032561e80a90d0b8a62b5c7f3f8965f8bbd5": "bAe1frJD49KiqGElyr/xgSQ4wC5z6uy3HVrOAL7PlZesx7M6GRzJilYkIBFTyy4QWjk23cCfYwY6P62CPzwFgGAASyJOXlDw94omyRWh8uG/8hHDNeeiLdVaMHwTkmigZxCNrIqv86LO1srKNq6Krshi38B6kaASWvnzcA8AzUdi58PCiLQwrMYVQi/xISZvskTg25H0HGCRrurjgw==",
  a804898fa39a96ba21b3decdd2dcb070c74f6793e75f7e7dc5f9de74ff89a603,
  c2933801842ff5902ab9fb19413ae42087c7b5ff587e2ad08e2ef82a99d842ad,
  "263fb77ef958fc716b1c1f9bc404a84945ce0623d6b467d7c2d6a13d524675ce": "towFmhqlr5L71/2tbs5BPr5TVCn69nOQL616htmOw4X3YDzAQFaG40tl4ptlm4nfYbxfQ+08GPp23/aR17KBNJOjidEaeslMtjdXW2F1hsWsF9GR/n6xmiFEFqPekDYBkeNwHypKAq5seEdslytC+wk8FY5xOaZjIYBR1k82wLKTJDZ50cjbUyLZ4OGLJ+IgsefjaKpRmd3g8frghA==",
  d6cd42a4d0fccb2eb6c27cb5df9f00290c2cc1486708fce0412187b4f7e75b2b,
  "7055d83d3bc7f1e6eb278e86be65b040aabadb499858569357cf0db1017f8f3b": "VYGhjvHjjLQ5hjOMaMUPhzK+N+i8swCQOIoisbyVGad0KbUhfyZMlqjVMZYs9xSzK6NaEi3BIdJoAnKDDPUHkyh6/ZVtTxTVd9Wt/4xFr3Gaf5GeIqwJ4YY9uUb8c9QlWHPMJ8dxoPJ3Q+2czuHS5Fbc128ofx8uk15EQW9FlYbhwwF/Y4srzcm1J19UPCfgKW9xd6uRNM6SuR/dPA==",
  "1507b67541fd80650fcc1e763b25bd58a0c8c046c464b0ecfc303004d6624eea": "xt5Dsp53vFga/1ZdjNkw6tJc4FSwVHpsKnU8h7He6GEAzsCw3XIaXKmunJBohWElOlTxhwZieMBkPXY3j2y5NWWnk/Eoz1WuwBk1klPfa1FAGtaOCeCQcotdBC2dfKid+vl+R3Ed2lNmCkoWnz6/TKtvilt061GxvzernIuC5SEZ48i2CBU0Kx3eIjad5U54rDRlHpQcJzLIX3l3PA==",
  "714139e83a580f46208ec8667efa4ece352963f6375bc064669c26d12a8972a2": "MOB7K5qkUb6+A4EeS4wy6N8zBcPG4LN4mFBceHtxo04mc6GYbDhtERDLtoevsYQ9jXIJdSq5PDOVjQWpTj6YbkR06We88jUbNEoN1tx1jS0nEsZzZcpzPklp++j9ulZ+mqpZu3tdqFRAxEBl8KFFYy1+N89/CWb21W4+S9G6IctN2lzbMr6NTiyDIuQCWqlB6AdLyJ03iAxKq1MRmg==",
  "1cd16daaa068e6fe36228b9a259f3d1e4f97b50101e85a7d0846f2ad6c1fdf47": "Nx4vrNBhJjfIEHOY+PWmLf4FQQPecZp+UU2esOVSmpQwn1xza52hkXzvtGHGpMBv6uZZxZLUAD33ataRabZfPT/LXegtpCxoD9ZMTjf2X4vSTPeuBYwice0cuFyzoxfw7N6+zSJ6of4KD3JsAbFDuNELIM+vVtnhrEJjvJn2q/ddFGSqkZzOMG5Z3xQghQjWKQU9wQKqivrJk6ZYrw==",
  aa385e15fa825e1afab67b7d00064967bd4f83fe4348640d37a54c953e519b80,
  "572572ba39ce3036d06e7d9017c7a8315b71ab1858ac814420ae626462eb2beb": "2gk6DNTT67HPQArYtky11H9C9EPXzo1mCST9z+aV0oyxp1geuLpJm9cJtoAdDu86ZDEuAeB7rKMe/AWfmgsVdxTGiX8owxqs8NgnL8QYJOoL/QTinVcmGcy7b7442PYhiujR8pCNAYatP3DmabNAjrZmAsg/hcQTk19SWjcBT4yLcAFxXOEEX+SeZttrQCv7jCul6B1/WLgR3xmY7g==",
  c6fc71c80a73ea048601b69bfe9e66254edd95527d807a8a8462cb4ca28ef330,
  "4be2aef5fbedb6caac870bec3bc5e8e43bf3c076245fe19e54fe51f810272d94": "g2swdxUh3+vXAnImaUjsbfZSaQ5SHXdaXqA6pre/W5SMrfh903YPclYqvyY0XANn7zV2mKYs6tYTxNyV6/WnCDhi2WPCTQ77lniuabotgeoxMFwSFvasgUCO+ooieNX0rdKhadNI30qWJmk9hVF05tLrJvH/W14vr9+JgS/n+owGPKRaYKYqFSGlXJnDInFkqvjJlaLrFfzPF6cP0Q==",
  "6cf537bcb7f35991db9a5b72af1a1d10fda1bcdff0834e29f6f4a2a93a2c1cbf": "LT4ZRk08mseUSBkgTMfMtUzp7Cu99pgIE4DcTdWcBQwx5p0XVgxAiqplIsDghZxNw0obUTSNxO3y+WlDXQU2EmEPifNee/ejukAZ+Z8T8qqV10edGggnYU4JhwigpY6Uo3TDaPE/PjRFuUROvs+84lSFwzcSLvFL+YGQJa6qcEZOgFTwMfO3rA6z8smplSLfiG9lG0K+wPjkS7Rkng==",
  "531c6afbac74d10dfeedf7c03d765f0fdbba0485147a090a50855ad79d7bfd52": "pw6jt+Fse2GnoElRd8o8tRFleUvVYsVFl8I0paeSPvpOA/u1htZps3vvkHGtus3avGe6OrXnU1go9yss7Zjbd/YkJM8x/VOu3onxBvF+msqfeXkd2IqSdrGw0T23c5NBiMTHovoiBJmCPpeg/qHLxIHN8QCsHWIj5fcDexMR489hOSYXFdw0QHwMgmctEwJH1i3R3gmbqBxNJjTNvA==",
  "9d85358d4b0539116974649928fca94a5e1278a3b4f6b378543c6b449e1a9a23": "6gPI9G+mwRL7P+iMB97i6WNHiBl3hxkUQKlXkObZ5Y/bL0IYjajcOrQC/ouhgRiFD64hw7ZDNG0d29QL+GbwyUhUo8NyDg0Z81n/+0IPnyJ+FboSvsqlbswoOUg2Io8sE+J96y26oan3lqTX2EhKYhXzJgjHf9wRjHYZMqkcGUR6Kmw9lDpuji1IiNLZEi5ab7vm5IYayvRxUbkcCg==",
  "3ccf2701a36bb80df21c157546a36476560eee691da72364a7ab255ddc42c77a": "Ye8hqiJ+8LR6ITyEqtNNrqq7fqnCzihfSu8K+OQBAI2hhOYEruyqvbqZN2T/IrSrZgRxgkoVvFHdWKF87SyEZA/VTAUVwbvra1PMByTP3+6xMiM/4NX9A6n0Pe2KpMoW7vTpGKPHG19bBjYADOavqO0CpLcL1Z3x6hrxg62+fcYk9+B04+yaJd1NymB44VGnLNcXdkM4UfbVhDg4pQ==",
  d755b9fdb6e5637db98c36543b2f23f2bd4a0263550d76d6e887f16865ba36e5,
  a5eae570fdbf64d6e4501dad8201503c94b486b2f3c909c52dfbe6a86f1e5fdb,
  d09b6af4b9f783cfe14258e7e3e2014db434de7db675dab12b113eaa1bbc8091,
  b25439d643776d1363e6e5f076cc69e69542b23a8bc75bae645d86ba6308b51b,
  "32363bb8c547d5cfc49ee5ca3e9f3499dcdc0f295ebdf1447377c2799f02ab77": "F1KLPbPo46g0WsVvr8MtQD5se90AWJSrzg3wdenvNq3ey0xsPtJ8FZOYCgCMCEs5Amwjgr4p8ygzE2GqKrR3uqZifnp3Utdtrn112gaJrsarruFU5XTbK0H0+UlS5m88asrNE3r7wsycV8LW8wdyMBwsPEMLTK1onjvx8xjc+BXlU7CX2Maedzrh3Q2vxv5tYXcq0isrC2UMUMRSYg==",
  "5e8c2d60a3d22af03a3002d1647f72e2431400492eaa7c44974c42a2051547bf": "Lxobup/9jHGvEgN57G5M1QJ41KFUzqR/bFv8bTa1u1KXzo0XlOoKoOyZb/mysL03qbn0Y13EDncyNAwwUXSpoi6Q5FSN1abcRIZykU0dVTzjGcLIWmk73++hIeieFoqLiJ94MOc1OHzTYF9+oeQDKLtRAoqOpnYpsBvF7R64s4e4K3hx1ix2mInuhT/oJPiF2+6X9xW0VBnh2+e9Pg==",
  b5e3995090b2c9066aa3f7aba7ac352b0d31c42855a7cfa5356a360a278ecf79,
  "9f049d5e037910b7433425f54784875626c85ba63cb8ef5cc3650432d2b18f2d": "7fuMXfUd+gTwogiM5VbLeZdB3KVloLAW+YwqN6AZNb21hZU6ILApXR2V0TNiCWNytPex68HeEkwknL0AfYKoo66+10+dcPkmeVrI3q5PbixqqdWidjAv70mSkMChcGv6u2ffINxlpUZGM5hqUD1iqBAq3NRzVE2+YcZHexElR6Sl/ds3z78BcxlTPklM05EZqMJoy4GN/l2hYqR67Q==",
  b8661a62912852f28e3fbbea39ab8059b23ec7f5877f9e920249f7ae026ea9fb,
  "6978537888c9abd7d4ac1d4c6f09aab3e253fabcccd5c27ed446afd3a371bf64": "dQdkGry7C099qOKp70qrDd7SmNe+zRTJ6+kNR78d1pFTNe9VefFoNuj985xqPG9GEhnGxfNBHd4DR/iINZDwFX+n3UD85Fjlo8byoErJ3ZQBroJ16OCWXS+AKS/32kx3AFzFxC3QrxSdZYu03rwK9zb4cuh+2mFCqdGxdauAs0ZXNojTCWHuZaRbsN5Cg49QzXmZ//hGSSDrDYHpHQ==",
  "8c5940859aa886ef2d917a9fdfa4bee647939c1e2b7a7ab7e69b20b5a09fbfa5": "Mt1jb0XxbeVEXdpOBdR+VHrO40nnnnRhzWO/6TAlzkoz+VkGMaivkcb2FBFdhd0sNdXD5dfd3gqD49IQ/QroXG6vJ55ISrody+TTh0SFdhRSmfqliLyds0r9icWevBIzlMTJWG0/J5OmC5KNqQYU2cRApSo6CAvzSGpHP2fiUIH9qabEZ+yAvPSu+CpqwVV1gLMn0NJkF1RzgD3ZtA==",
  "34b61f1a12f59cc020d2dcf90fb2c7a08b8235e5a7530274741ab5de2838860c": "VuITH3PQ6FDXPRyMP8+5eoom5fSelQE12mHxV9jU6JOwpRXBa60kZEkNrqcJhQpnOQstdRMEz7XnzsZShfRwPP5+07EOhpr4xd/EPl+AAb2Qhgy3/Tf69dAS9oq8wgxBES7vS65D6UJAz4tO2MeN1k8gEU7PUKsutzrZj+hFMbIvA9qy3laXh84pbI5JFIL5WpDbA9eRkeCGngaWOg==",
  "25dbfca25cb488e42544cc5741da81bad098eb7984c7a49787c0d36d471decb6": "SeSbfJ+iwiVYX6UXZqn1cNMX0SwuAQsH+sGzjo7btnbbN35+nE4Gk03Wha2W43MfuSQYkR9YvoqoEDlhTq4oB/nW6AouQh8ELUFmi9+W8ZSzHf3A1x7hpn/u82Lw4YA2yJDfMysbiapAogj0xDO/oOcUbywSV8T15V76AwbqgrxFsr95nMwIcNace5D+CL0PtPTu5gIgj4r+vJVnow==",
  "40c325a4252df8271460741868081447a537799c93b640bc1c7914f4d3068c10": "KsC/Zw58sk8p0fme1qaEFp3+abeRt0a6WqS4ts+u+ePjLTrhOQCioht+vcCMkLc35/8TOaI5ppthVPuTSdnRyfqROeM+5Bw4n25MkB8HB9o8NuEOF30s5txrU4i7j3/q2UzC4FicEwpCI/ITDyW7SOhNV5NmG7iANrdEfEZxDByu31ucq42VXB4xXxMrMUfMLhabwcZxvorpMymCwQ==",
  "21331f6705209cf6f8c2af61769417b57d69f7a54c9e3bc86ad7610ea58a0119": "CYgj322kGuCmqwZQ8LbbRswd4kU8RwevUaKEy5VPP6VRnrp/Df6nq57ACqr0sU4TxgRRns/bDE75MksmsglJwK+RHg6xb+jqaADffdYmkRRN7R2eR1iCJwWWAQuo6Rzq0O0bzxRnwSn29DXWsu17hcost3x1zwSoC/SkF9w776+TSaTMgowGjBy1KZ7b6l6FFvX0hTlffNC4eJRMLg==",
  d86d5db639b5a8369c5b56a091e79bb2393a01c5f2eb9801d6ff2651c4207d24,
  "9326bca836aac170713ef6371432d539081ddbf81693dcd9ebba3ffab4021c9a": "1gQUJFnq3v1awH7EYWXw9C2Z0c1DykqVYZMl3vvPokvge/orynOjATLudrNCHyvjNWyqKs6rN/+PdTLnMpOtGq0fFGSlCuYkTGCMcdUfMVI0e5SaerIjBTLReUOaUoPG2fQdiMzbl1o70xTj+iOZEFxE+jtnhpCA4TTSviJUiG/n6ZfJ10CEecj+D8usXCxJpBK5+dqPSE4c/A/aLw==",
  "6529aa0207b5dfce508b36d03e052b0c9580f686d11487f3cdfc1501dd43338d": "5AzWmSPywcpKdJpBRXDIxZdoOmpjjnHCzug4bMUfW9s3UgLDgV8nw3v/PZejE06rwO3tQ8+n7RZ4NKjP38tfVsl+f8P3hDNN05+2yas8DTOtFimcyX1x7QC3Qo2y6FDYNcdzbUxDVoWqh1tmxE3UyurN6/0sKoZZgbPFFVhye962JVb3gEt+cEYY7CsptYmJOs7CJXU8Y/Mrgwnl0A==",
  e5672162ba940d7bde73b51ae8e5d976f1f287e29bf8ecd53583b5ed598708b1,
  a2fbb778e8066d16cb1e48c86985cb290d7f07af896c73ff2b3206705faace66,
  "37165df7c4683bdc58996f60af403f2d86bd031beff570ca1f315fa15f4493f7": "Bu9mEv9d0CFKobXeHauoq/nfrrXJMlktsmjXnTKxweCWyW6RCrMQuAaA/3Dq4JyXozZ562ObW0WeUYKJtu73q5f6lT2FDxVFKfvDaFwuS1SX1gtCs8CdrbYLFWd6l27/WeiQv56+bSdDA+k7PfXNJXddvhYdMJpUmeDBWT4n/kQs4v6XuL/NKvfIsSpd+pCYLsOdlG81BRIJufi4Sg==",
  "211c61e8ea1871e01591ca9f537b21f3366afb521c5aab95ffc71abd64369f75": "WmJ1raNflIq54RjemNqZSDJJLf3QNjq3TAf/K41davuCcvGlZzy8lnHNUWrkp0sMEA5qg7TDVlWfer5u4GqDkK4eFC9fAYLIxj5S3/viumPS18qhG/eugv/bHHui7lcT0G7voA/w4zJOAA+vRXUf0LQcviCOiIizlqMVGz4kXrOVeS1LRiynEcvHVBGgb9aI9zg4Rp9Ttf/Gb/21ug==",
  f9b0678f8d0625761510522d4ff69b02f3c61bd9482b24b94162b915782b219f,
  b95b9b58cc6703376af9050943ea7e59275ee037da719620794b4f868dc7ccb5,
  "778851fb7f51f2ee63163f1dd7f783424b3909e941457392a0a8b65c15c3c4ac": "hrd1HBlz1+6ROc/cMG/aVMsnXTstGqSAK2BsMjhb7SDtrmNKZKFNJAik/HDK2w7IdbDGzABVgC7XvnGoH2NBGj2LxWjntgyhKB0idFTlLrvLtUbgV1nGMgYQMnf58S5FBJeq/gM5npKMgzzDzztniwOxlR8jIJ5nNyRu6C7d301d68pv8KBd/AillJhzOpRRpk21+BHYBaF3TukCHg==",
  "1cefd06451d08a11436a3eee0ff05b3e1ee980440eae9a8e93a3e68a7d24f6ae": "WXUVR6SON3dv69sZ2dGTY8yddI510IRAJg0R34yTkKrJTQAXmQdHnrV9BFm9f15zAq7z/e2/GXybGRYhzJRwK6aRvTYD1bIRAW6oa/UyHJJeqQpKng7EmCfLiYkOGLROZVLCIDiWjzArwgdP8oUzCqmBlm2x/La5j4WRWGNO7PiXe99riXmSNvKzpAaxZgmmMO72yUy3EozS0bghWw==",
  "9430f25f42d7b5b6d5a20f11262c0475d6457ca1afc3bee3b766389523760818": "1VE2l4Pxsu2gH4BN1OsBbnfyWUmKpHMHEOAuG0tQ7ioYcJUbEWJJeoxY+m+ycfkRkfIhFapyMYfnYfTMCH49EKIJgr4c/UG/1ULXc3QB1n6r2DSUjkjoLjLM9wc7V3XX3oFOV39nq9ReAEDyzKUwM0lRofUWBBOQzLeHjMC7KTutXgIl8xgljTkiS8kUVfHonPM2ih3YAUXoiy0f2g==",
  "2ce104fa65f06f49fc493649011a787bf48a048d7f37deb4e1cbef748b4b2314": "o5wd+2iPgaJXjt2EEr4uepT8pNJx6OQM/mdy8u+NqxUxRuk+KzCPS22snvT8WQkdD2K0l515i75WEY8NQmM6PH2hDv2fVF25Qw+o3ApQgtTB6x8yMsB9bx8V1tXrrtGwIjEr/PQYUns/a7yVAFtR6Ly6I8PtNoEq6avacKEtHrRprTWxu6sAX58ps0m0AysGgeRsQBb33pr15rqh8w==",
  "0f2fd2551fc39df07b1bca96a67feb0ad1a73525b999f01be266992de30c01fe": "dSrwFuL7hvLHuBWEyiRMe8+07OWyjqKQoDXcNI/LnBVO1CrOpsvL6mcQ7eGlmhOhlIXsb5TYRe27Pw6FhZh1gmUKrx/gEqOjfSM1PloMtQTmAqzpce0Z2EwuEprLMsVL4Y+fCGIMKYiCWf/qZokZEUGLZSdbSWlbD0ziUAw9Ggk4EC6McWfDgy07xsyNogjXWWKKJCl0Jzqhp26Vjg==",
  "20658cd236e95d2f1792fa7ac0ed9dd081ca1d7e19048fea680ba235f7f0980a": "YAHmY0eQNpJwiQhbqWLn6xseT1aQWCAUuEqwXGjKvYfaHznApl6ORL2wHTuhacrdUzfroq8pLtzoElkbIUsb6iSI1AHYeAaS25PaGS+/6wBxoqyyz2aDwWQKMfZG6s9TtcB/0tFLsBUDMlRV1tbpd3eu9k9N4/JucNFF1LefJjoORePakmgQFwtbYIfIcX+Taf6mVtCETdYTFkUpoQ==",
  a08aee7db0b3cc26dae93f855025b8a4dfa5916d16394e86bf2931e708793c6a,
  "0ad30954b2f4efe19259744604b4085e8e29b28089d3bfe037697c3b75c98ee7": "Aj0it0kK4372igIQ33F18wzVTMlpM6j3UAfGH9ZbAOiXzGVCm/tt0+zvjnLVE9qNnVHA7Z//y7UfyYFnXFigNpMCjyQ9aWBye8YRLjUQOXn7/njxFq1GSwt/dBTB0kUHwAmXPRQhCLfvTL0LvnVoFKaaoOqx1jyuqFLBpUi3HE53sd2sYjsff/0S1tkufkBivdZUkUGMGZOulmQFIg==",
  ce2d7e1aaeee4eb512409932126dcc976b19e0d12c0b02474f562e598b89dbb3,
  "369a77af990c2c9ed8a66bc73b953695d8af343d8e262d2e272a23a877a4001e": "ZqF/BvSk6EccAdkfLVGYS46MObBq23f3lwEXSgpiSAiT/Ok98JRyqdK3geyyb5xBEMm+6X/mVjSmEd0SEjEBxzLCa+SL16ou3VcaAsxLzWKouwuby+odGZuJYRx75LOldt0kVgRePn3LHiEILGdwVrApk8Hv5anH+87pbsVBnD2TJTZL/sU6sSZ/VOJ0EKNUIBBQgkhT8Zp9ApxfXw==",
  "62233616c6b84e062c82d7313cea85d2e6f9262fe4d1ccac0866274cb45e355b": "ByRF0EcOiFEuJTGWL016/4nKonKaEhaJlr0bkeeZz9p4kv7oc/d8jbvOILJaMSqT6QqivwW6dWbLW3wh/38ml33fm7wH3G5CclpcvMG2LD4jMq9bJZU8y2cUzpxcTwx34/avbBhPX1q8Vigl7XmGRmhwwc1KpAVmtl8ArxSQ2ZnzsjNs2ZOhBSpwixTF83TgUVVLlMLDSTKoUZeg7Q==",
  "92385159a9ae2339a80b423a71a9baadfd4da8cb99b39f78556680479aeea52b": "ZrkAGiR1bUe4qXqhJMea3/JoC4yz9in6CKGICQnEqZ6ajTg1eRmn60jIEwdsjf2YnKolWLsowRd+rLrI5Ligdzgfmx4l2FPi5EdWFmTmqwtxl7WFYJY4dWZYdhF0ya6q4Xb2K0nlnLOr0u5W6Fm4s+2eDN5JWz4+zT92CPMCI75ZTem+IFiotIC7FOEhCZe0tG81DWR7PD1/L1G+Cw==",
  d47bc082bb44e2f731330f8668b2a85dca321822b4646c7543fa89885aaaa6a1,
  "26378fc5d7345ddbcaae4fc4d1de968a1d85804595d94afc6b2787bd9095d638": "kLUJcHvMhcpyAsQM8jlL47CtXeuqS/ztnh7SiCxKSjJQCZ8xlzVP1Lmh32VMxcq7hxPXL8dGuH91wnlpLhmMKDKgv04PZuodx1LzONN8H50zyxgSGz8RrKf2fRxzBCz6I1IhXcxn+jevBDjBZb7ypShTsXMH613Fw3y55FgEy09Mme3AzoOpTrhbWrCfB+q2MIyAMWZQT9HLo6ZrRA==",
  e09535b1ad33bcc64baf5291899b66fae3eadf70581ceb4c48b0f96b7cb20831,
  eb6f0d9e82330356a57f9d63d597db78f93f3a9bc3a89ddf5436441cb3d02363,
  f4a137976fe26a606adcdb437d10ccacdb57243f45701b31ed5997f261e60dd2,
  "3aa317eb7d4c56f288f46f16b7963fa31b4340616cc1f6cca4984ca806f60b0c": "lu9/Y6FnMryhnjBHyG7KegP2H1w2xQE24035iWN15uQ4TtnoAEYdPH7wlnLiKp+1dfUvB58nLMedMdB++zs8dB3xHbPfbS5tTbEAp4OsyaPnReGHEFkzz/2OYvBFTJFvPPbu0MfjN6JPR6H94tro9cqKt+/9acXdwOFs8JWCBeNKhcwlPCsols78VAX5djfJGCjHk8aE5fjXkoTYlQ==",
  b53bb3fe084e2ad9651c2619bea617974cebda438e415a37e0744e9a403abc95,
  "610a8c80ed431e02b4ccbfae00104f795b24ce0e0b2fd6e104496167094fe9a8": "fib+PlQozcx4NiAIQiubbaPqJo6oMPvDxipYglt071lR9fYmROt6hscRSILlUtdc/dWs/rQgDXSdxcgMkhT7qmsOQqyz/NXf3IJqelYNXyxsXzjhurao29AGpIl1CX4WuWHf4KKq/Uqe0rsYL0HLqH9LP77g8L40pBe15zbopRWuOWGxgNMehkqWtBWDUNtINys9A6u+UXtrIRJ0VQ==",
  "4791546877207a249c63120c15a51ef91dc6354b5f96b72162b307416678c9cb": "9YMLTgHknvlHPfkWuaOU7CHmSRDTr+4ZOrtRrrR/AyECc3BEfBnNasEI3dBk0k4rw5pT/Rn7FRNqDZW8q66/nqaK90hXZ/rGLl4ueAqhrQPZ+RuJGWgMmhc7JjNTWrD/fR9NZcuoroklwweewoE/hjAvNDdEGhOtfoF5+2dNV6LsnVJ19+JweD7rWZrN6k6DeNZ2fSJ6dn4kY3Cs7w==",
  be07014d9e86585687858a0cdc82bdc28a011d977530b057fbe2889f59cfb1d8,
  "1a1a7ae34104820348360b74bf563afc4108b48b0e049a1c06de489cebf17ba0": "wBg27CT0ex+gpVrMV36pOs++vuRX2GfhhEhvfddUc6iphNppW/MsH6QGFchTn/GFHlUFArP4RbsDcEcltOmT/LitlJJ8N7cFGlP5MT38x8dxs/8fDEvW8o7UeHhiVYWp+Oe6CNuUn+BbQIgFE54eFcLt/kO6b+Fwt006fZ/MHtrP1+k7SFf1SAc7jwQIr6HLlZXOh0XPnBJaFJZ2Dw==",
  "5746f1de7c54aa24791d45e36e312bdc69951cfb787e840becef87808885dbce": "nnHA5muYOBDmSM2c8ZYjxHdtrXvmapZYzZaQH8K80O6F8uDLV9xpVyrrnHokksOvH0rzb8WIiyrsQC13w2lHsJvS/v+NaYfMpuO5Eg0Qme3VYmsAO1FjWbchzU5wuIOCOpBiRCiB6+96X8lOtbhVjuQyHPIGjVCSeCr6a43ZLozlcQobpZgz7LKyLVL/Ef7prdj+JcIBRi9/7fzjtQ==",
  "61c7ee307b6b132c5a94e3ab5d77afae1665c50da8361efa4ace413f79b6d389": "5q2H+ppb1Yz+jjhKeabnJoT+wd9dpZHDtmsj9AhzZNrexQNydoVtsNPv8XERDDeUUXaGAyCA2KMhqwbdCLnn4j/T2+eAzlFRyxCklCqaDywzqhXq8YOyCuTL51H50tD1+mOe9qrzGtcVA6r2uq1qmyZ3mnxCiXu+lGI2FA+MEtPWjlIzRwGmPrpSBgLuBf4chMMROkKkC4fJEUM1kQ==",
  "5fbfb0fd36b0dea732be1bc755dbccd510b90c0404acec4282a0214fbeaec744": "T2OReZzLjxZwfqjRuSRrWVzo312fzY9ZaLMgN8Sam3L/TLtvxy04UqkS0o0f/ABesvAH2REzpntRtZpWzvEj+u+TJvCnc9tM/aayely+hp5rIbCENmvtq+W8y7xongFAE5BusQ+5rT4P/8FNcIpxO0CYAw7xbDor2l94HdeK0t8rErGZqOT7evCv3rhwBVrOjDkkMii5J5Jy5+vU0g==",
  "5fd34baff2bf11756a88a3fecb0d47ece082562ab7f829849e4a251cc51f07b2": "yl4hHUcdd39eZTb3tNPzEGy4/XC3xFTJ2QpFypSd1Gh9ZDuc/GS1XugZQyAN1qq7/QvOCoclPdKv2rNGaUghaE7E3ZX0KbtJU95jIIZsLCRao5jZoBVdQ2/8XuNO9LPStP7/MRNsgqurwIsph3E9Q2PfNNpES+pWEz5AMO8CoyF2pxVrA71QdFSwEUfQWKc0gXXyqyW7TQm4sVsRiA==",
  "1014df0e2d4efeb912981800ae4711e117dfe271dfeee3f646e5249c36d8dc14": "A0bp0ZhEEIvM2POB+Z0ZsYfnxbIdQ6QIrqZ0JdX5zfykqzsf2L9yNscEa50xD7IoXqXFGb1+5LugFe3buqCTfBOH/+zKuYdDxXKSdooV9sxvK4kcUvbRx02Cnx/3BKLIanR49BnJZBz6+ZNywHNOfGGH/HJctFdiIN1kskdpBmjuAAU3SSMRAAW/4vZDOi+SYiECpFJ/0Jr+2e+iEw==",
  "56ca57aeb2a5a8518791c8270fca28e75d3aae0d7016943610b7ad7441092988": "62FZ3/GFPlPbCKC5KilrSXIuCTMqLIaxrDA7nqPs0mWIpUYfhRF9mRiAwDy59YWS1lm2Y5hdW0x1wVvfmfQMblK5izM9ELL3yQqHelaqrswVGrZ9Jz1OShgzAAX0qxlH9QEOnB+0GUv551EPrnxHc7P/AudEoV9LVQF3VVHPS3H/qmugZL55Duetmucu72Xa3uRGtt1CkqW9d4EsYw==",
  "7a1305e32ee3b36fd978aaef8a433a1a0538772b89a7a4eed2c669e3447827eb": "y9YXEG+Z9cW2KqohiiqPk1fn+awbJoL4yiLXyXAsLe/BD07oTdfeA1OzfQGmkseeJMypAZ7YfSy+IVRabqLE2Vv5Gp9vwOV0GGZ10AkJLb8T5bLOkeOamvJoiEWfyL8Tuh/biZ1H2jd8Zc8jEYZflvSRcbCWoJsEH6LD2rruekoV+gGF7vDP4ME5QfaSfD/0Lse/2nn2ENWpmH7ffA==",
  "6ffcba212e35da3ad6fe257ca41c29966e2d4b8faadb835ec6c642b8994ac0a6": "cCd2cHtm4cvoZGAEWxtkh7bHDZbvxNkGVwQiDEt1w5a0t5fu/Dx2pHX5UnvWECEpx3s/Nh6tIuQdMJ48eJPp8wVUkRAmB57rhj2XddCmjxcApQg2MLXFns2HToEcYue2miQXaB/DxyKaI05raoD2Cn+VTPTCm5cgo6oRVg6wdwbITDLytjr3PvEUPg6rLUsZzGIMCLNSOnKca+r+HA==",
  "4a45cbd978b0d6cc5d96670fc32d30b5edb5cd6135a209707f8cf4a8a78135dd": "IgWKXn3EZaTe2zQAKffOD4f05wYUJoBvihtGRWslJwS4i3S9vfxc1V8qwHTAdDdRbtKm/F2pWhYTgCi0vLA64nooKMeCwG90IftCUn3Dxhm5fasCBMAB1Pr8AvPWuNho5xU/Jx0/wQqMTUKMz7Tf9kZ0jYAeAt1/Skz3QJ788wZi/e2u4vK7603PDkf6fXsFMj3zyZgTQYMlSxoVOg==",
  "87b400806f72a3d8b4bf3c90a10aad60f74c3e264e46db66d78d6caba90bf356": "dBtE3evCch6t9W/pyVB0ouFdR1dIF6365HtPsoov1GgYlShjMozcWkaTaXkQE5cJhVPEPdlAODfUOCVrTg9NzZbpHTV+Q6SQWVHgeIm+3UERn4sUmhHFoKck7enfvOpfdxfbQy929kvwCv8aboPYwuyUa4bPGBUMpMJ4mwTITYx+Sh6HbIh1VhesP4IWxtZmlTxPfSgs0Yht5L0mEQ==",
  ed225cc8fbfcb1d625bea64313beddb72fdc4fa54e3c77c72517fa8224f8d5ee,
  c498fee9b8e3a1b08a110783f05854b99dbaf0bf8e4f2ceff84464da0c555e90,
  "0c3d201cf449bef681862b54e4239ab65fa4642572985af1e6d175f404563587": "LEA+xeR5GjVC982xZeVhrke98tmQPsrbg6G07ZJIbUcuFFJUW3uiDXO4nGBPezQ1XRv6/RJ781pcjVc+mwzk5QDKRiGw1EKrCttYLo/i72jzrvic3xmBJe2jJ9z4zHgEZcdNY3UPOd7u3dCblbyJj6BiuA++0rn3bg3F8gevYaeUyLNvgBcquVFPFbjeRP9+LuIxyS2w1aoegW02hg==",
  "1613981b09e0a55a0df856960e29cb659dd09c4449a84d022a5555b5084eccea": "QsDdAJ+Lkon+ibu4hJF75FrQD/gP3M5+uXc7lxSIwsIAznb6pcFAMOpSyfZv00aPygUra8y5U2316pdavfbVrOC7HWTCSUvh0bohbB8tZp3gzHbzQskRFOdPF736uJEkm70H0B9gx/p3TPX2CleQB4pAI0BOnUmr/J4csbhNIpWkP5LwMGNY4xVdPQ+wyt1c8IFLYHUu49iykTvIDA==",
  "34192723bd80771e5362fe2156c8f7123caab04001bfec73c35d426acf34d530": "6YhjTOXaOK81K0LtMDDKtdvUVbzUmKIdMJVh8WKX6o3+sKFP7uQjDrta7kPpfmvoT+ttoz0GqtH+xMj/X47VW0WLAIbtLUAF3GkilQkFMvVDbkmN6dUm8vggUrqSQ+g58WksySEdHO7JYCaFwudaApeI7m36MQ26u4c/ENaaMi7yCzLvNgzLO2WaFR3XaDdG/CZuRQ5vFM3iYNXzCA==",
  "6cdd94a36adbaeeb2e692a5bcdb9f9bc549e1478ea5eeacc342d5648328959a7": "dNSxhFlujIKcn6fvlCzX8XwCA8Fl20rJ9F6y69IW7DY8Kgmf1GMic8UhISF60poB3WnNsq9VOLj1TqSuOb7ZTKwzvF7SX8ThxsFTeIqBvsGlx+WzgsQcZt1GuS+bRFMqlfL1z2Qf8VGurY2Nc9IFUDZ4xsvVL1KtE4KsdXyDzwsDSzGSs6DH3qgG6jT61T3DY5j8IL47Mz/zMQlRSw==",
  "829b3c60c07c7b740939047bc3c6ff42d9f4614d6cb372422fd35f4cd1afdf32": "539/rI+bu0tPtwS0qr2PPZLo2UzlJVoTYjvR9R6IyB5cp3m/ci5l2Q30alDGZYU/sWNHmXjw3TcqP/RV2NNrmH02JVEV8Lt7l/aOyPtMTp7N7Wu8IZpPFlBSdiFiIbimaF3OittZwrTxo/79PiN7Bvf8+v6LjC9LP+8AkVJOm0k3lGurW9Y82Vu9vVta99B5TkinW+aMTswG6XNniQ==",
  b7628a947755b3e3ebea7a9db679c7088da37caafe8f381bf88439b21a4d4be4,
  "38a69878af5861a2bc525bd9c64f5fcd83c8f8a1230a6d6bf23dd8bb00b54aa3": "ltlnLfB3+foQkvH1/sh2JP37Y+WSP31S5Rfk8r32tGjuCplrzfK0sALdX6OGrrOVyz1l/U2sp0RVEpaik6Cquah28wsemPasP+yl33+RBd16EDWYDj3u3fa9nhVLvqqygHFR8/xLhq1Cj4UZMQZtx6eSjjmGy3wnEaAb2hfkAvdQjbCuSIXBdbsvpVTf4Sf6F9tAszGMlE8/KDguQA==",
  d28ed6bb124dfcb2c719d55e9d15278b01145e3eb22f0d3ce98e9dc152df154d,
  "93064b72a62c1fc09b6b53bfdf9868938e83c04d2efbea3bfcf499f205b77290": "P4aqfAcTdrSYu4ED8/XCWbc1BWztJl8OKNSZ7fPSPvwh2sDnmca6JNkeIxPctd+WzDDMzMXWH8Bg88HFZVz2gBPBhseU7A7pUtWErAMslvwFptXupgqnQcOxWRBSxxdp4ctP5TUWMgqafG1yJXY2R+2xvs/F8xVshi5m2TIs+DFqJ+1+ImG0OKnZkXMMsKjLo/RX3C9ish/PZH2f2g==",
  "7749765a56c546c9bd38c1cd3ad1c3e56bf37ead94781448c8ed3e376703152c": "LPvYNV/vGBMTT89sXtFGfNA0lLvSUY7brmC9CAociwoD0bZPxNs8oJ1Cof+cDBn6Ua8TxzoaJxqxgsdz6at/P+trBnITLSYKp38TjlQmQoHZcRmEoXHL9f8siyfEG8pZGfQzkiV66d1CW/QdSya7blPrmlU38kTm/92rRfnjyuzfNvVkWvYhUvvbgw2GSFcrJfOpqc+VZjBiJjyxKw==",
  "695430541afda397e82a232893dc2a9da76fb0825338581e83177254f136f90a": "01uzpiPrgwmXztNn2+es8Cr+d4mZU8J1yu8Qhp4hVzwx/9uTxOCtM6mYOD1LyENgVNLsMSBsBpBdU6HL3AE440Bf7N0/q5asnMNocBfTTcH339fq9iaFlXS8jIGNwMu+SCpKInztpE4QWNrFXJS7PzjPxrXfzazCOwslw/z7E4r0uUAuW6UrRfXurYirXLtOlJLmKdQ2AylMyDoifw==",
  "7ca8e103af1c4dc54967c25f90c9c3231de9e33132cdfcbe967b5e8880b2660a": "dGFzfu0THpJKL7pXB8ETM46Z5WPyjDWEWcA6exMJcILhJF7jz1EPqBFvNxJzmWgND/uoECzlXyPR/y1V9x8QaG9wdKOt5a/wbyUK/P7yBwMhaf1ABM9GQxXarGHTdLZ+E+StyiEOa5JHquWFlXL/cfCqocvHkOuJbcJ51ISQ7TL2CXCLOjnhEuTczadQMK7OclS9+JSO4V02MiDnYw==",
  "872b89f2211d43b27445383286df3806198e0aef110b76d358619f1b79f4af03": "SR/pD2dINCQHCqkTWZpgz7usNBeSsvF1tvHBfldRfPYnLjiG/QjgIPe3lGDwqXEamsghXZu7wxHpwPIgubaKUFOdLRHcfttw5I9Bcg+P+IaGc5Km9kgnpufcMQ1gSeIvWHnQLlFc1aK2jHSqSMh4e2Lb6SxpXJONWCJRTmAVFc5yZphAphv1tcHr/HBtthZPMliiQi96PG9uLphnSg==",
  cc31a0cf3fa2996f3c30f3f0bcf24c4bf994f225a5f76e4ed8bd7c078f0f1c78,
  bf839b74dd80b61df55299d1005fa5e2988b0920c09702746408eb137c2cb5a2,
  "7c5b5fa9feb424ac0b796d7602590f37470ac644ef2af346ce7f8ec986998fd0": "cFk6VCTqZxZNC/EKj6txYDe6ZMB1MZPjaTZuCOHbqaWF+m6VNq5R5CmU3EjPgQvOLgVp/Qezo84yP6zJXff0bRpYVQpDjSoSIBo1eRQ5ODKPWUg3vWCpI+/jwnzQ3Nr08JeZXbfGARWpZrPpza2K5i7UpkjGLdaVI9hY0fZaWE71Mj1KuhIpixytLyDqyJNPeEktZ2E+FdPovygxfw==",
  efb81e471ceb5e38213b57272eb79b6525b75c6a5e6225821ac6a6d38240e1b6,
  "3b0934758debcefa5b97668ed8c0cd55dab56fb7504e4afba0ca54c5a6274585": "6TC9bZroNdWBWXYAmGMy/eMVdE20hSnkMJ4H3iQeu+hsMAtOX1Fj/8LTs5tm2/wgfFhQCIy7ExicoEZtyazocvtm8f3s74tfG8JnY9XmUQDukJKSww0soEwNLDix6WfKjO/HdJRAHB6NYNb6tAzHg7Yyv2m1Vu/trVlL+sZKFAYLqabX4/pF4pjW7xepD1J1Xj9h/K2qSvtrNeYRuA==",
  d8a5ba89cb7ee5da43bab0e58325cdc678a4f321777862c2c7f95c861ecd1878,
  cd886b2b71838081c12d3b6958c1e7e6be691c7478efb508567f5a43011da207,
  "7d638c1451cb019cfe5120aab4b9ff16381b11aff14fef7762410d97c305f4ff": "pmIVqH3HKaGtlJPOyhrV4H+vQpjcSmq5ZU0Z7aJVrHYoJRqoY+/NL2z2AJ7d4tdsTcFnOtNo9n1kqQiIkhGklh7j4IAh2t3Dm9IkXkVO7AaKcz5G4FlDcc5YutWewltyxKrboYrEmO1mEy9iMcLO372mWLJ4dcV0sMLlsG/ePHziHchMDdNF6vzerIH8+rgMkJYOLePZlrCZLxUeuw==",
  "4b9fd5de46cf59def9f52c388550a262592c7cf346c49baf8ad14062d50ddd0a": "Cbb7dZVmPKUFC1tjJDI9W713X64ZlDKKirp4JNOD3uJFwPrqybGtOSDG8TuhEsmT20EXmfB97rx19UQryFRo+8bRXcaz47o3mwenlyhdMMJ+tmSoOfLvDekvwEbCcxN2pfReLvNABg54MfzO2XWqzz08WttHufaZzil4E73Za6sAJuT6eH8pkfFgihYKCNTVjoZKM5n3Q0/OYrQDHg==",
  "3a7c62acf3d2dc3e4077bbf79dcb99e3d5c1fe3f55f5a1a355e42a92f82cfe6b": "UtGncXgMNxQwngXri3M15wwNbcvKDfATF8U7xK9oEtcGoZvT4Npu0Qqrvrsv7vAaoa0/Z4CvCslTRgexKwiR4H7nfedskJRMaI7fN6/ZD/gpknOqfkd/V67oAuCmgPyNJBW/WiqIIvQ/FzNqUDdjEHtwWUfvBWRldO8CZddJCzZubUX3PIwbnG/oyYg+dzGhBsOzRXDQDoy9i5CGJg==",
  fc358f629020a2ec520573636c93ed5f741adbfc50c25fc4c522ca6a2a4dd6b7,
  "1352d9a0f7ebdfb3e7df93cdf02526b8d4fd7e3a8c8e5484c22a52423b0979e2": "ps9AA1iH5Q5M9Xh8yFhtRF2O4O/HTGX2PCdqJ+cAlE2o/C9RsfwWDGuDOE7opp0P4t3KEqT7cFJj6g2PpQYOX7qOWM5W4I8TBLk37QZcAlzo0w0Z+aEx5sNwF8wBdY+UEt5SMt8Sdx2LVCp53gtcxI2qRFTd4hw1P75DOgdccht37XtulAE/7VMZlfRntJL7JZH7C3+FHDW2WIXLgg==",
  "0544858392a655e66953fb228144288ffc38f7122c98154b6d2f943b570b7e31": "aXh6cRMAmK4zqBdbLiBltv93FViQYwJSpaApAgWeKcH87mdAEftbi5c4mSiIWqO5fy0bSfMh6pZAENk2/leMZcM74RbTlwzj9S0X4toZedN2glPHO7graDTVGrI0ixiHv0WDHZYxVmbIRBUnZD9oGZXdbkRM6KVb65R8EiUE014PZUoyK+r4L52CNr7jbDl3PrJ/dQAy8JzlcVNWKg==",
  "4fabcab5ac7f371912c9e30ba6650cd02ae33a953e4c7127cd4bf720b05c1285": "clTHrpMQb7mI7EjAJDnfziC7E5VEkB/Lr9r9jkp+XHqpBP2fkOoZ0WveBGk3LOLoxbj0uxl5HC+x9bZnMMaigyDeSMRn96MVJtpNPzU7rdLaz2A67N+aXKDGASu10plmuU2JLmqvalKWL02G7sSFT7Qq9t8MLO8WxyHJrp0lYSzEjvm9/L80Aq8Mysd+NiOj2kyjDxy/poM0rAdafQ==",
  a0042816e40f3a523a5a2f4b56445ddb1ac3107b2d61f5bf39842a51dc3cdb40,
  face0f572cd513955fc0696c9a86a1358e77b4802998990d80ce32c5513e2e09,
  d84c259f45145894bba4b2ebe861eda685b34eaa3ebc573aa9939382878ea429,
  "9fcff646d25d2068d024a250774885fded52f9a024e7af05b004ff9a0c2502f5": "BWLtrb0mtQm/W6ll5luxtpV4SITn3d/Qm3WVfjgAbWMWnwgb+10pXW6DY28iEVGCR6hBCoxzp/kTaVsITUsACS56TJe/agoUdssV4wTmqfCuJVaCFkoG8jn7zsSXfz5WfU15+YtnbAMxdVs73cN5UedYtVtwxGZZgPBGI2jxcdhDmnFhrqo0s5XwpSyB/0RWsB6kFBIOKO6tl2+IsA==",
  fe5ab9afd01fd627761cb3b5a695ae1d33f78853f6e28cfd2a61fd762be61d02,
  c981338bce6eba1cde12ca1254e3a7249bacc36e1ff79148e9da2236484e40e3,
  f86fdd9835f007f505ba2b0048510e7eda67971d764fe4df1ced128e38c81c8f,
  cc4dde107d7d86a0088ce8ccb506e503a85efa378a716ac53da9f7ebdbbeeb0a,
  d7d12803e48d589df5e381e763a4c2b9617fcfb81c42ce5989d466c5b9b4791d,
  c0a386fd50405badd8a28319e033c77c62d2bd1fc3e295b6a1e69d792c4dc617,
  c0f8dead2f606cbdc8ee2cb52670a6c3dfa1a63d9f4615995603a3dc92bf406a,
  "79eb40d90482138ff340f41c58e0ff1b9d582b970105896186d347bf7b2c4855": "8MsXkZjcptghPNRVmjqbP8abrzx2Ql+nm7kxmoE1sD5ywwbccgnII8vUleBrsmf442vhMqcvUrY2mmuI4mtw5II9EuLz3DfGmO3V53lQG0dQaOGRYEY0Rcypjz7vbUziakm9U+XefPS++JMoi7NEJsICO2cFitAqiDoLK0WGLBFrCaYSKwz0Qg8PirLeTjziXcX4ReDrTtKO12QOcQ==",
  "835c79703cce3af874ae5f929a92088d94fd242409c1c7aa4d7f214d95ecc377": "IiwAIVoRJ8SDCj7VyTZrhAqAAN8jQ5jopZlUEzr3brbBM7JUFrgorl7Mspn14AKXbbRmoSD5vP4iJsAMXJjnj7yWevlbufn/2VeSvRNUizcgj0zOEw36+C/3rtcBCici/hoPhxRHKr9W7jQAR7feAj7E/H8kdFFYXqYc+tGdzxDRCUYApe5eMh5h334x1Pa4XN+0U1My0e18z4cDXQ==",
  "0c5059bcaea423c13d6343efce914eeeada771578ec249bba326d22b2d4bd11b": "mWNurGnYmvnP+Mi2O28w15FeB/094dglycnKW+kwezbF7s6krrhqR710LvagGe84VX6zwb0C4uqVzjFCCy8Eiybda/almbf20nz2faZ9lMaAN4Y04bWzZVjps4BQzkbGLPAyu9bO4S6WZy/IirdLm6mDfoxPdhbfTZCpOP8I8aV5fWur32bme8MO+VCCKdU4fjZjDU34jw1WZE65Nw==",
  ca525cf68722f896e1dc9847bac112d5219452406abe2573d406fbf84b10091e,
  "3c8d39bd8cd831823755cdebace5024375d857e0311cba1c705af54fd4a88227": "njgGm7jDBKRoBpeF6JKj2GebCvlyVc01C80UbuD9mwLEZB97njZHkF2dRuAFq4ixmCTjFBSzQ2j0CkJ4f3Dg9RfH/w6yapsXHai7WCn6nTcOu1go3GuheQvKm2FdrNXIfVHfxbVL3wHlBKRUDLQCbT34jKJrr2f7YyJK8dX6k+B4Hnh0WlPQt0vCHFuDtQKvF00pnkjZ56ookqXTOw==",
  "7d827aeec06acfd7b8c4784f7c3fe4aef1301f0f310ec60613f448e467d99664": "iqpWvVS54UBptpg0zuyuoTjg2B3Ff6vXOt60hrYp5eGH4XScYUxwKI556+WUBVcN3lOD0k2FdlW8Dj2tmYyPdBTJxE3ylziP4PmtFd0K0CdRlj4lLVuNN0zanpPnUIb6oHH0lMxaCsEzECZ8GAuzJ9yBQytJNJMNN7TADub1Vp9Nc31Ig20BvByLnWPo2JD0PQJ2dy/FSsu1UkR5kw==",
  fbd96f5a3c61abd0b01e1d161f9580db57166dea6cd53396cb8c65deafec7d6e,
  cdfaf72183b2cf08e6ac0f352ff40d46aa546fe7d8a9032c897427ff4b18a63e,
  "437b44c527b4c8e3488e699b9e8c7c293aa2d7ee428badbd45b54862fb76180c": "c5mQ/sFAvDQWbE8JX7Ku6q22+KS2hUj7lYDOPeTtz13z3L4I9nEunOmbtlD1PBo2rIHivzOfp33j2oxqaeu6fOp0fjFnn+rgtDMO6oZ7/+NbGIwK+Hf4vkPZMqKk/LPKEnTYnACta2YDa2KPKSbv9GIxN8fxMdUzl3uzysIYzXE2SZQW0x2m2uyIVgrGtrCX0CK8ysepCX7Jd2NylQ==",
  "99d4327af6898636d7880819c8c3e0227ae0297e893266355dd169476bfd9d5f": "DgUtPxVT22vuLTpTDY4QuUvY9YL2kyN/u55UlR46mZmkr0QB8wwrc4nANL07cHKaW/QhmDDUh5eswvJJitWCsOtSK4ZcbIwQ8KkcTXypAXpPHfG24BuXLZZusvfVJDc4xw6zxT70z4MRc/P02KGfmOpBSrhnjQwdFMC8a+Nk8QnAewY3GFsymfc/pRVgRrDlWW0ZJ6ZGt+KfQ7csVg==",
  ee7617c992d511af999be1e0925059f5105744ae9f5b54f7a7bf2cec487c6129,
  "309746b35585037229cbe7b8be711c39156e1ec8c4d9c9feb9ee4bf7fe7e4278": "CAztBe7LFjpKVtDRduNBA5wnB3gdBUNiuH1sqYIiY5iJ/9y+1EZ8qXuyY6k5eVaDU/uPwlFEs42J+utRsXXKjtFzqdjWqD0mMXWdSvxFuV6s/Xk3mUsdb5WCUTxnqmKSLNds0JWLN4GmiU6cT+ykThz4ZFak/BkQSf/774MEjOqpPInGHxWcWB5iwtKfXtyFZIMXpgjzGIguun/nqQ==",
  "65e95dca4a927053a53108c0fff1b87ae09e057c06320fb4c27970c6bce34525": "dxG8oC8I7zTGi/DD15kNzEV58+sLoPLJDpEuQIZVCDe3sMB8lResiwN+HAl96ITmLA5uvGrvbUAGHYwNojyEC3LQjIOOX0kkw9guzAn0UrxPgRORLzHVwNqz6KN+2aWg/86nGTyV1npNAxGJ+fiutW4/Hfqx4IAXN7S2LQHgTD0qfBMtgdOuAWTnCZAsgBglw1HQ356fJnrGRU1ZIg==",
  "06d04e15b65f2a9366e1fe104a0a54a09ed601d8597543abdf6b97fe25c156a1": "kwVY6enhq0g7fL3LybH9qowca83sUTUXNzXCMZcoPH/0ukNs7u2PmARz/KGNeHUHP8JSkkBocZXcIQHrDRvBWqRf2Ouo7QsbYiqPRkkgjKNNP6u7fr2yHtglipeKH4n8XRSPdBY+hjzwb7Nvsr1glJJKYRrOw9RpsP3j4bLzgwxANv6xxN2H7AaFWz988jXKnz3cRe9uujYvwJmTlA==",
  "33eb502b4e53ff0a9a6e0ffabb89d9a9307582d4b9e9e5af8fb4191c6001a8d6": "XYd3T/xiLOZlxaCk0mRqkko4DsJlX2wDc95Pv/Nev/FVH9fPXHXvOhANHy6gB9SPywnnVZy3oDVTft1TwAQoblIOw2WBBcZom5wVJlWCZKjCttKM2jFymf/VZksAEAxgs46/dWEqx2wU7yMTWd6Ix3Bgvbt1jn2RbrRobP+OKpCLVoLNxZL3FLEZWTOyv4v0AJDcbayzz+w+C95olA==",
  cf2a3a446d5428518f57a3b4390de28c3a49199a68e2321e081f5708f073fd86,
  acf94425dadbd1babb955899f384ec824fb84ca1162398a1567171760e600d27,
  "70c134ddeb2eb28ecc9dd0a758cd726a6e84f1209d50579b03867b444a063a2e": "Wan2acFmgZ5HBqG1bOJzABlpyOU0Mn7xW91sAgeTMpcgogj8QylZDSRV+tr8Gnhd4GkQTH6BNp/OzmQrutxR5hvAg8F79O6FJ3dqTax76QwPU/64x5PHz+hnOEUAbl9QBQeIIoFhw0OJHckiYd+Ym38SbCtP1dtwUj5o2CwmgwRtUZDNFPwfMR1JlFWoNfcKYndn51JyPT+NnaeQEA==",
  "02f62325568732f9894371a9b0252fcb92bf2420fdd481990b25d42891f7b520": "QUdSk4wghvbIHM63c9whCGMul7b1P9L9CN1NaY/uHv59kzgkPYWp+Tju/FgJKYALIy4TnVSm+D2pqa7W8D1EcP8uyGCnuLNbreHkFtc86MThf6iqtVPNvH9NaziXjByrAaz9gFYytilih2kkC2afXD6sCUmXg7UHn+Rjd5ee/yzf8awupMnedpX/aaaLsjJSIiZ4tf6caL/5MmjVIg==",
  a11dc3eab1ca1ea9645e900a26f00f929e4ab44a9eb4a9931abb9f9a576bc9b8,
  "28e2d39c7756880510b3a04ff6ad78dc44c63e392b9e814d61d73a8656174d06": "J+bRKwx8skpAmVkha2+2CH6IPOtySrJK1bf8dS1hfDuUOKJ4zS2VAAIEhV+F75SgmIDwu7v78SMo9kIneQu2StsNUjR4hrDvLX5iQoUnnfpxU7dg1dQpZQxi02Uw1Ect+MrS4RdcsK7tOdPQmGyWUmGcGT1cwNvqiqPuftNnbkFtiFK5nI/nWtM3ysgOUUYxNfmOBg9ykY4K2ANKHw==",
  "699331dd5f90bd391797ff420d462b4d63fba251aed18fb2509b2a033728d20e": "1Yd54Yml6aQzdD8qyOoWtg7IZX/Ijhbwdkxy5TF/Vr0RKJ7p6GvLZnBdZi1pUvE6NXb6t8hfHVMiVv36ajDtEqYdiVaetfxbzKCwYAtSEhS5Sk6Nh+npARsV4uK5v2gNLughA+c9/hElp6vXmdMkFX7P7kGeeJoIH6NhNOHD3ExhDY/GaUNwv0kxF1VIQEgE+OUQKAwX0wD8uuaKZg==",
  "83867990a3bd96eb1fc99306ae7d21dfc5acd4a4324acc5b5507f77a63ad8804": "mjqak4XDOdq1VzTp134StoEDRRvcyAyOQQgopwwE9jcJ0/eqXpOvG5EOlktet+3cyID5DQKrIXvLLFIPck/EBeHhijSq9ZyPwwFx98aBDaEEmSzL8QMXp1oEkoC5ywBF2t6F6e04haTrxry/xpvmHr6wbEByUn2qt5zctrGdhKyNmXaa/0vQlo8RBqqY77s0sJ/ApGNYyplJzeTfuA==",
  "3543ddb242ed5f90f4fa9acaeb4a59a2355a0f691d4778ed80ee5e574eab7862": "Nmbdz+/qXjvNK31DeSsEL9g4v4MAto9kqNCgEWeXzuaJnuLO7WdMgPcmf7yWtVyadqb7GoMaK0uS6Q9X4TsmR5nykHxXwZGp8J0hrF+GHVidqkKpBGqNnt2AJ4DtJrcq9sTfHoyVaOrqvvnIpemn23XR2/fwnURe+r85HgOI66gnHjDZPsWqa8yf8NYK4otYoILiirUe5B2vldw3Ag==",
  dc9b063832aea7eaf0d370ce301892a2b2a10c60c1ac91805b73b03c7d7046f2,
  d336c52f0c5e81490643263c3ebc815614967efb9a8ff4c4209e230c5bd3feff,
  "806f697ae91e2d74535df97ead70b573f5dc37c297f6312131be7b06417adefb": "oncK4hrkciiG+NYo0S20X3U3KfFdW1tB+rPetN6BeVNORrPbUcbzTBl5LV6ucw2OLY7Q7Fe9a6oVWJd7btFU20+BZ4AYJPgP8iG5z+667iOdd3HOcwS/gilS4fEQsj3ESvxxBS1yfM+8VzqNSQWN8VzB1NQIRI3TlmY5TjXpqytdE1BdkIbMY09ZqxraCTNJUqdgRpXhbeYwVLPG2g==",
  "2f70b71cbdf9296ba09a24982d6c5a22291ae1b64825a0b7b8141d2402929d00": "p+4edRJw6/U99ejoLQPbbYq2nEsdAM+/ryJ44Ypp6TpdxdmzyWdJpkMAzmiiCejcT+oa8HkHmwKNiRXGgg+3H/IlHqSxDhf4pF+Nrznu+vd5KvrGWvgP9k2+vASWheEJJOPfUDTxB9U2Mufz7eAtf/zaEsjbNtN8G6xAYVnvkVJRDY3gmWZjrfeYg24XGGZljzGq8j4cjhnq+a3R7w==",
  f171e38e4c909078555f7266f9a5210ec17910e1688ac19afc89949e806b62a3,
  "6f2d6ddd458d93b53a0b7ecb4f42e765aaf7e6052ca44cda33f13dd1fabf36ea": "GSdw7oKL7imCqUpE+Vj+K3XeAMmYkazjtf038qpmwyj9BurYSF5WQPIyngK3urFlIiXTbd1RXLeRIp7qQoEO6I5KOYzh1bBLZV5rB2e9RowIazj0Nz/S9iTW9IY/0pW8tafjhzLjQuoz2H6oB0WbYlPdkDvef+72PxsD/k0o2pD1SbfNOOto5moJa+RrbcBLJiCod6ia1CcYJj7vgA==",
  eb551c0918d2690993b3233c4e946ec682b42e22009d69b7f17f53f212340a18,
  a04ab06826e5f24226ad24db4285438d4536e665106006bbe94fc53ed1b0cd51,
  "49b3dfd59260e6033b03444e2ca44fcf7d75c8698fdca649cd5f44043c298f79": "kLJAEi7s6SZBAKRrif7E0NyXBRC6QveusKcAqRLUemL5LQ0JUn01qzLHxPbSKz2ejLpCgZK4tnQP6l04981U8Jdkm69vkzFKmynfQdmRZmmIsLzpYfEfwgFrRQrXggGU/3vT4CuAeani1/z64MkChTMz+Jx26gH7Pw/+iN8MX2OlFLct7EgWXe17ESWcrlTJmbJCagD/hlrQiA1DVg==",
  c6391732a881690937a0264de4e87bf6c8eef178af4093edbc24cd9cfeec8b08,
  "762051c7cadbc8d817d05a78ccefe29585067725386cb3a131ed97140791829d": "mAVPtR9nQw+lufPXTC+P6hJtzGU4PALGLgdpqgpd4yrZuD2oC/JWZ9xwZM/uA8zavBcWPqTbG+twN9jUspU4BpfSeOv/lF41us5UobXRKZmKEy6Ty+8zS8JMCnkF1dXk/zVD/iK5Btnnp51DyLFbdjCRR2eg08bo2qXVRLgpd6C2FHKD8OjaHSytqY3ydTaPXhIoYFMA9wdWYXAadw==",
  e3b7afaf7c5e79d66a0984f7737b774bf4f2687e300b3dd58a23aa4a320908d0,
  "9758a367b4968481ba134972bb08ac3a8f324a836e79c9022c183650d6424c17": "riRkK6wy/ayv9uuNj0fU+Y0Gc0OHpOHGXVNSlZvvG9fJNKd01wa8V21iCnyDxdwV9Nkj3tVz9gkXYGq/mlRdo+euYAEMNQsVoyhyDcvbOCnUq+fHINAFc+Q8k9WBUO/ywL99IpBw06OvJzK9fHkQWpc1/DxT+pulLWfa3gYjSALIsL5WvtsfNZWtlI0uvgg0GLp1E0GIY9RQxHkQbQ==",
  d5a84d89e0e3b677d1228ecff5969eb6d47da8d6e9acab30e8a9a9721aaf8abf,
  "4402f4a794a70205b2a9e56ba53658e5cd4efca271873ac17f1078cd7d37030e": "WVvvl7Wq5mW6Bwpl+uspqsz44nZ+/ppJSeUifQ3OnYIe99QF7lxLgaLuN3YyAjznCei7uEl1fKCijOEP7Tj7WaOT/+cRbISxCVf1NE+t48D0YjzPwruyK6C/KuhgkXybOG0cGnbaS8lqvcT9FlZzbNcGmRBjA78tj+1TaFrfB+kVIV5EYMw5nW4fnDxM3qRTwyA3hZxLNm77WbSAOQ==",
  dc54c747b62f974c1f93e3a7c7722a1d84596e102bd8230a18d3d62a1a642c44,
  b7c15d056924b6547b1b18cef652a71fead4fe4a0a1a4c3e277ae7f19bb0173d,
  "461f1a9c065e8304fb9b6d36cdcead8ef898435ef45bc88ca8dcdce1bdb0fb56": "yDsugQlisxlBoeaR2Dx73KMQ+BAcx6dfLk59eFHHS15W/jCisblSaFexeYw8hsLEblZr+dkeimpeLXvKrEsDEDHgKFXEimwdxuRlOQ4YGi1bn+ibbj0HvAAOWYFUzBx6PFJGdEL+kxVJlNfHJRtAd5I/P3zXoSL0BHPlp/I2jlaxQBDIKax6pnbnOrn7SDaZukjwSEfHj0zRhRWkztA=",
  "5d1348c22b5602189cd7f09dee551619e3be0949f07bed1712ca836b9e27b0f8": "yivYTjymqd+8i3BgUoXHco6AJmwvVkj7Rre7iKj5E8d88XIs3hOTrh37DzIc5uPGxmM3IVR6oCXsSeMGBTKPnqwig3gPozx2Ucm1Wmdg1X3BDqEhVqbBsA6CUbMEgZw2Bz1V5EBEk+xaoxHiD6e1l8yNIS23OIP3KS7aJbM+IpNnVw84BzSxOfWiDo3IgU1baat4W05a17X05L7sfcI="
};
const SALT = "apposition:appsumo:ltd:salt:v1";
const INFO_KEY = "appsumo-key-encryption";
function hashLookup(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}
function deriveKey(code) {
  return Buffer.from(crypto.hkdfSync("sha256", code, SALT, INFO_KEY, 32));
}
function decryptEntry(code, payloadBase64) {
  try {
    const key = deriveKey(code);
    const combined = Buffer.from(payloadBase64, "base64");
    if (combined.length < 28) return null;
    const iv = combined.subarray(0, 12);
    const tag2 = combined.subarray(12, 28);
    const ciphertext = combined.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag2);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}
const registry = registryData;
function isAppSumoCode(rawKey) {
  if (!rawKey) return false;
  const clean = rawKey.trim().toUpperCase();
  return clean.startsWith("APPO-");
}
function resolveAppSumoKey(rawKey, targetTier = 1) {
  if (!rawKey) return null;
  const clean = rawKey.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const hash = hashLookup(clean);
  const encryptedPayload = registry[hash];
  if (!encryptedPayload || typeof encryptedPayload !== "string") return null;
  const entry = decryptEntry(clean, encryptedPayload);
  if (!entry) return null;
  const expiry = entry.exp ?? entry.expiresAt;
  if (expiry && Date.now() > expiry) return null;
  if (targetTier === 3) return { freemiusKey: entry.t3, tier: 3 };
  if (targetTier === 2) return { freemiusKey: entry.t2, tier: 2 };
  return { freemiusKey: entry.t1, tier: 1 };
}
const FREEMIUS_PLAN_IDS = {
  APPSUMO_T1: 70966,
  APPSUMO_T2: 70967,
  APPSUMO_T3: 70968,
  APPSUMO_T1_PRICING: 96960,
  APPSUMO_T2_PRICING: 96962,
  APPSUMO_T3_PRICING: 96964,
  WEB_PRO: 65379
};
function isAppSumoPlan(planId) {
  const n = Number(planId);
  return n === FREEMIUS_PLAN_IDS.APPSUMO_T1 || n === FREEMIUS_PLAN_IDS.APPSUMO_T2 || n === FREEMIUS_PLAN_IDS.APPSUMO_T3 || n === FREEMIUS_PLAN_IDS.APPSUMO_T1_PRICING || n === FREEMIUS_PLAN_IDS.APPSUMO_T2_PRICING || n === FREEMIUS_PLAN_IDS.APPSUMO_T3_PRICING;
}
function canStackAppSumo(planId) {
  const n = Number(planId);
  return n === FREEMIUS_PLAN_IDS.APPSUMO_T1 || n === FREEMIUS_PLAN_IDS.APPSUMO_T2 || n === FREEMIUS_PLAN_IDS.APPSUMO_T1_PRICING || n === FREEMIUS_PLAN_IDS.APPSUMO_T2_PRICING;
}
function resolveCapabilities(planId, isPremiumActive = false) {
  if (shouldBypassGatekeep()) {
    return TIER_3_CAPABILITIES;
  }
  const numericId = Number(planId);
  if (numericId === FREEMIUS_PLAN_IDS.APPSUMO_T3 || numericId === FREEMIUS_PLAN_IDS.APPSUMO_T3_PRICING) {
    return TIER_3_CAPABILITIES;
  }
  if (numericId === FREEMIUS_PLAN_IDS.APPSUMO_T2 || numericId === FREEMIUS_PLAN_IDS.APPSUMO_T2_PRICING) {
    return TIER_2_CAPABILITIES;
  }
  if (numericId === FREEMIUS_PLAN_IDS.APPSUMO_T1 || numericId === FREEMIUS_PLAN_IDS.APPSUMO_T1_PRICING) {
    return TIER_1_CAPABILITIES;
  }
  if (numericId === FREEMIUS_PLAN_IDS.WEB_PRO) {
    return TIER_3_CAPABILITIES;
  }
  if (isPremiumActive) {
    return TIER_3_CAPABILITIES;
  }
  return FREE_CAPABILITIES;
}
function getCurrentCapabilities() {
  if (shouldBypassGatekeep()) {
    return TIER_3_CAPABILITIES;
  }
  const key = getSavedLicenseKey();
  if (!key) {
    return FREE_CAPABILITIES;
  }
  const lease = getHardwareLease();
  const cached = getSavedLicenseState();
  const isActivated = Boolean(cached?.activated || lease && lease.isActive);
  const planId = lease?.planId ?? cached?.planId ?? null;
  return resolveCapabilities(planId, isActivated);
}
const OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1e3;
const ONLINE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1e3;
const isDevMode$1 = () => utils.is.dev;
const shouldBypassGatekeep = () => utils.is.dev && process.env.FORCE_GATEKEEP !== "1";
const getCheckoutUrl = () => buildFreemiusCheckoutUrl(void 0, getMemoryAttribution());
async function activateLicenseKey(key, email) {
  if (!key || key.trim() === "") return { success: false, error: "License key is required." };
  let cleanKey = key.trim();
  if (isAppSumoCode(cleanKey)) {
    const current = getCurrentCapabilities();
    let targetTier = 1;
    if (current.tier === "tier1") targetTier = 2;
    else if (current.tier === "tier2") targetTier = 3;
    const resolved = resolveAppSumoKey(cleanKey, targetTier);
    if (!resolved) {
      return { success: false, error: "Invalid AppSumo redemption code. Please check your receipt." };
    }
    cleanKey = resolved.freemiusKey;
  }
  const machineGuid = getMachineGuid();
  const deviceLabel = getDeviceLabel();
  const appVersion = electron.app.getVersion?.() || "1.2.4";
  const res = await activateFreemiusInstallation(
    cleanKey,
    machineGuid,
    deviceLabel,
    appVersion,
    void 0,
    void 0,
    email
  );
  if (!res.success || !res.data?.id) {
    return {
      success: false,
      requiresEmail: res.requiresEmail ?? false,
      error: res.error || "Activation failed."
    };
  }
  const now = Date.now();
  const installationId = res.data.id;
  const planId = res.data.plan_id || null;
  const payload = `${cleanKey}:${installationId}:${planId}:${machineGuid}:${now}`;
  const lease = {
    licenseKey: cleanKey,
    installationId,
    planId,
    machineGuid,
    deviceLabel,
    lastValidatedAt: now,
    graceExpiresAt: now + OFFLINE_GRACE_PERIOD_MS,
    monotonicCounter: Math.floor(process.uptime()),
    signature: signHardwarePayload(payload, machineGuid),
    isActive: true
  };
  saveLicenseKey(cleanKey);
  saveHardwareLease(lease);
  saveLicenseState({
    activated: true,
    lastChecked: now,
    key: cleanKey,
    installationId,
    planId,
    customerEmail: email?.trim() || null,
    label: deviceLabel,
    machineGuid,
    expiresAt: res.data.expiration || null,
    graceExpiresAt: now + OFFLINE_GRACE_PERIOD_MS,
    isGracePeriod: false,
    isAppSumo: isAppSumoPlan(planId),
    canStack: canStackAppSumo(planId)
  });
  return { success: true, isPremium: true };
}
async function validateLicenseKey(key) {
  if (!key || key.trim() === "") return { success: false, error: "License key is required." };
  const cleanKey = key.trim();
  const lease = getHardwareLease();
  const cached = getSavedLicenseState();
  const installationId = lease?.installationId || cached?.installationId;
  if (installationId) {
    const apiRes = await validateFreemiusInstallation(installationId);
    if (apiRes.success && apiRes.data) {
      const now = Date.now();
      const guid = getMachineGuid();
      const payload = `${cleanKey}:${installationId}:${lease?.planId || null}:${guid}:${now}`;
      if (lease) {
        saveHardwareLease({
          ...lease,
          lastValidatedAt: now,
          graceExpiresAt: now + OFFLINE_GRACE_PERIOD_MS,
          signature: signHardwarePayload(payload, guid)
        });
      }
      const updatedPlanId = apiRes.data.plan_id || cached?.planId || null;
      saveLicenseKey(cleanKey);
      saveLicenseState({
        ...cached,
        activated: true,
        lastChecked: now,
        key: cleanKey,
        installationId,
        planId: updatedPlanId,
        expiresAt: apiRes.data.expiration || cached?.expiresAt || null,
        graceExpiresAt: now + OFFLINE_GRACE_PERIOD_MS,
        isGracePeriod: false,
        isAppSumo: isAppSumoPlan(updatedPlanId),
        canStack: canStackAppSumo(updatedPlanId)
      });
      return { success: true, isPremium: true };
    }
    if (apiRes.error && !apiRes.error.toLowerCase().includes("offline")) {
      deleteLicenseKey();
      return { success: false, error: apiRes.error, isPremium: false };
    }
  }
  return evaluateOfflineGrace(cleanKey);
}
function evaluateOfflineGrace(key) {
  const lease = getHardwareLease();
  const cached = getSavedLicenseState();
  if (lease && lease.isActive && lease.licenseKey === key) {
    const guid = getMachineGuid();
    const payload = `${key}:${lease.installationId}:${lease.planId || null}:${lease.machineGuid}:${lease.lastValidatedAt}`;
    if (lease.machineGuid === guid && verifyHardwareSignature(payload, guid, lease.signature)) {
      if (Date.now() - lease.lastValidatedAt <= OFFLINE_GRACE_PERIOD_MS) {
        if (cached) saveLicenseState({ ...cached, isGracePeriod: true });
        return { success: true, isPremium: true };
      }
      return { success: false, error: "Offline grace period expired. Please connect to the internet." };
    }
  }
  if (cached && cached.activated && cached.key === key) {
    if (Date.now() - (cached.lastChecked || 0) <= OFFLINE_GRACE_PERIOD_MS) {
      return { success: true, isPremium: true };
    }
    return { success: false, error: "Offline grace period expired. Please connect to the internet." };
  }
  return { success: false, error: "Network offline and no valid license lease found." };
}
async function deactivateLicenseKey() {
  const lease = getHardwareLease();
  const cached = getSavedLicenseState();
  const installationId = lease?.installationId || cached?.installationId;
  if (installationId) {
    const key = lease?.licenseKey || cached?.key || getSavedLicenseKey();
    const guid = lease?.machineGuid || getMachineGuid();
    await deactivateFreemiusInstallation(installationId, key || void 0, guid).catch(() => {
    });
  }
  deleteLicenseKey();
  return { success: true, isPremium: false };
}
async function checkPremiumStatus() {
  try {
    if (shouldBypassGatekeep()) return true;
    const key = getSavedLicenseKey();
    if (!key) return false;
    const cached = getSavedLicenseState();
    if (!cached || !cached.activated) return false;
    if (process.env.FORCE_GATEKEEP === "1") {
      const validation2 = await validateLicenseKey(key);
      return validation2.success;
    }
    if (Date.now() - (cached.lastChecked || 0) < ONLINE_CHECK_INTERVAL_MS) return true;
    const validation = await validateLicenseKey(key);
    return validation.success;
  } catch (e) {
    console.error("[Licensing] checkPremiumStatus fallback:", e);
    return false;
  }
}
const handleDeepLink = (url) => {
  if (!url || !url.startsWith("apposition://")) return;
  const attribution = parseAttributionFromUrl(url);
  if (attribution) {
    setMemoryAttribution(attribution);
    saveAttribution(attribution);
  }
  const deepPath = url.replace("apposition://", "");
  if (deepPath.startsWith("workspace/")) {
    const workspaceId = deepPath.replace("workspace/", "");
    if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
      global.appOverlayView.webContents.send("app.deep-link.workspace", workspaceId);
    }
  } else if (deepPath.startsWith("license") || deepPath.startsWith("activate")) {
    try {
      const urlObj = new URL(url);
      const key = urlObj.searchParams.get("key") || urlObj.searchParams.get("license_key");
      const email = urlObj.searchParams.get("email") || urlObj.searchParams.get("user_email") || void 0;
      if (key) {
        activateLicenseKey(key, email).then((result) => {
          if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
            global.appOverlayView.webContents.send("app.deep-link.license", {
              key,
              email,
              success: result.success,
              requiresEmail: result.requiresEmail,
              error: result.error
            });
          }
        });
      }
    } catch (e) {
      console.error("Failed to parse license deep link", e);
    }
  } else if (deepPath.startsWith("oauth-callback") || deepPath.startsWith("auth/callback")) {
    try {
      const urlObj = new URL(url);
      const token = urlObj.searchParams.get("token");
      const code = urlObj.searchParams.get("code");
      const state = urlObj.searchParams.get("state");
      if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
        global.appOverlayView.webContents.send("app.deep-link.oauth", {
          token,
          code,
          state,
          rawUrl: url
        });
      }
    } catch (e) {
      console.error("Failed to parse oauth callback url", e);
    }
  }
};
function initDeepLinking() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      electron.app.setAsDefaultProtocolClient("apposition", process.execPath, [
        path__namespace.resolve(process.argv[1])
      ]);
    }
  } else {
    electron.app.setAsDefaultProtocolClient("apposition");
  }
  const gotTheLock2 = electron.app.requestSingleInstanceLock();
  if (!gotTheLock2) {
    electron.app.quit();
  } else {
    electron.app.on("second-instance", (_event, commandLine) => {
      if (global.mainWindow) {
        if (global.mainWindow.isMinimized()) global.mainWindow.restore();
        global.mainWindow.focus();
      }
      const url = commandLine.find((arg) => arg.startsWith("apposition://"));
      handleDeepLink(url);
    });
    electron.app.on("open-url", (event, url) => {
      event.preventDefault();
      if (global.mainWindow) {
        if (global.mainWindow.isMinimized()) global.mainWindow.restore();
        global.mainWindow.focus();
      }
      handleDeepLink(url);
    });
  }
}
const SENTRY_DSN = "https://3ba04162b13edeaa2ea17feaaabc1f4b@o4511953085005824.ingest.us.sentry.io/4511953228267520";
let isDev = true;
function initMainSentry(isDevMode2) {
  isDev = isDevMode2;
  if (isDevMode2) {
    return;
  }
  try {
    Sentry__namespace.init({
      dsn: SENTRY_DSN,
      release: `apposition@${electron.app.getVersion()}`,
      environment: "production",
      enabled: !isDevMode2,
      sampleRate: 1,
      beforeSend(event) {
        if (isDevMode2) return null;
        return sanitizeSentryEvent(event);
      }
    });
  } catch (err) {
    console.error("Failed to initialize Sentry in main process", err);
  }
}
function captureMainException(err, context) {
  if (isDev) return;
  try {
    Sentry__namespace.captureException(err, {
      extra: context
    });
  } catch {
  }
}
let overlayPreloadPath = "";
const transientSpecs = /* @__PURE__ */ new Map();
function initOverlayProjector(getWindow, preloadPath = "") {
  overlayPreloadPath = preloadPath;
  electron.ipcMain.on(IPC_CHANNELS.OVERLAY.SHOW, (_e, specs) => {
    const win = getWindow();
    if (!win) return;
    const desired = new Set(specs.map((s) => s.id));
    const state = composers.get(win.id);
    if (!state) return;
    let specsForWin = transientSpecs.get(win.id);
    if (!specsForWin) {
      specsForWin = /* @__PURE__ */ new Map();
      transientSpecs.set(win.id, specsForWin);
    }
    for (const spec of specs) {
      const view = ensureView(win, state, spec);
      positionView(view, spec);
      view.setVisible(true);
      specsForWin.set(spec.id, spec);
    }
    for (const id of [...state.stack.transientOrder]) {
      if (!desired.has(id)) {
        hideView(win, state, id);
        specsForWin.delete(id);
      }
    }
  });
  electron.ipcMain.on(IPC_CHANNELS.OVERLAY.INTENT, (_e, intent) => {
    global.appOverlayView?.webContents.send("app:overlay-intent", intent);
  });
}
function ensureView(win, state, spec) {
  const existing = state.views.get(spec.id);
  if (existing && !existing.webContents.isDestroyed()) return existing;
  const view = new electron.WebContentsView({
    webPreferences: {
      preload: overlayPreloadPath,
      contextIsolation: true,
      sandbox: false,
      partition: "persist:overlay"
    }
  });
  view.webContents.loadURL("app://overlay/index.html");
  setTransientOverlay(win, spec.id, view);
  return view;
}
function positionView(view, spec) {
  const rect = { x: spec.x, y: spec.y, width: spec.width, height: spec.height };
  if (isValidPhysicalRect(rect)) view.setBounds(rect);
}
function hideView(win, state, id) {
  hideTransient(win, id);
  const v = state.views.get(id);
  if (v) {
    v.setVisible(false);
    v.setBounds({ x: -1e4, y: -1e4, width: 1, height: 1 });
  }
}
function repositionTransientOverlays(win) {
  const specsForWin = transientSpecs.get(win.id);
  if (!specsForWin) return;
  const state = composers.get(win.id);
  if (!state) return;
  for (const [id, spec] of specsForWin) {
    const v = state.views.get(id);
    if (v) {
      positionView(v, spec);
      v.setVisible(true);
    }
  }
}
function unregisterAppShortcuts() {
  electron.globalShortcut.unregisterAll();
}
async function extractFromMatchingPane(ses, domainFragment, extractorScript, timeoutMs = 800) {
  try {
    const allWc = electron.webContents.getAllWebContents();
    for (const wc of allWc) {
      if (wc.isDestroyed()) continue;
      if (wc.session !== ses) continue;
      const url = wc.getURL() || "";
      if (url.includes(domainFragment)) {
        const evalPromise = wc.executeJavaScript(extractorScript, true);
        const timeoutPromise = new Promise(
          (resolve) => setTimeout(() => resolve(null), timeoutMs)
        );
        const result = await Promise.race([evalPromise, timeoutPromise]);
        if (typeof result === "string" && result.trim()) {
          return result.trim();
        }
      }
    }
  } catch {
  }
  return null;
}
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const GOOGLE_AUTH_COOKIE_NAMES = /* @__PURE__ */ new Set([
  "SAPISID",
  "SID",
  "SSID",
  "HSID",
  "APISID",
  "OSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "ACCOUNT_CHOOSER",
  "LOGIN_INFO",
  "SIDCC",
  "__Secure-1PSIDCC",
  "__Secure-3PSIDCC",
  "LSID"
]);
const googleResolver = {
  providerId: "google",
  domains: ["google.com", "accounts.google.com", "google.co", "google.", "youtube.com", "gmail.com"],
  resolveIdentity: async (ses, cookies) => {
    const googleCookies = cookies.filter((c) => {
      const d = c.domain || "";
      return d.includes("google.") || d.includes("accounts.google") || d.includes("youtube.com") || d.includes("gmail.com");
    });
    const hasAuthCookie = googleCookies.some((c) => GOOGLE_AUTH_COOKIE_NAMES.has(c.name));
    if (!hasAuthCookie) return null;
    let foundEmail;
    let foundName;
    let foundAvatar;
    let foundAliases = [];
    const paneEmail = await extractFromMatchingPane(
      ses,
      "google.",
      `(() => {
          const a = document.querySelector('a[aria-label*="@"], div[aria-label*="@"], a[href*="SignOutOptions"], a[href*="accounts.google.com/SignOutOptions"]');
          if (a) {
            const l = a.getAttribute('aria-label') || a.innerText || a.getAttribute('title') || '';
            const m = l.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
            if (m && !m[1].endsWith('@google.com')) return m[1];
          }
          return null;
        })()`
    ) || await extractFromMatchingPane(
      ses,
      "youtube.com",
      `(() => {
          try {
            if (typeof window !== 'undefined' && window.ytcfg && typeof window.ytcfg.get === 'function') {
              const u = window.ytcfg.get('USER_DISPLAY_NAME') || window.ytcfg.get('LOGGED_IN_USER');
              if (u && typeof u === 'string' && u.trim()) return u.trim();
            }
            const handleEl = document.querySelector('#channel-handle, ytd-channel-name #text, yt-formatted-string#channel-handle, #email, ytd-active-account-header-renderer #email');
            if (handleEl && handleEl.textContent && handleEl.textContent.trim()) {
              return handleEl.textContent.trim();
            }
            const btn = document.querySelector('button#avatar-btn, ytd-topbar-menu-button-renderer, yt-img-shadow#avatar');
            if (btn) {
              const l = btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.getAttribute('alt') || '';
              const m = l.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
              if (m) return m[1];
            }
          } catch {}
          return null;
        })()`
    );
    if (paneEmail) foundEmail = paneEmail;
    if (!foundEmail || foundAliases.length === 0) {
      try {
        const resp = await ses.fetch(
          "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard",
          {
            credentials: "include",
            headers: {
              "User-Agent": CHROME_UA,
              Referer: "https://accounts.google.com/",
              "Sec-Fetch-Site": "same-origin",
              "Sec-Fetch-Mode": "cors",
              "Sec-Fetch-Dest": "empty"
            },
            signal: AbortSignal.timeout(4e3)
          }
        );
        if (resp.ok) {
          const text = await resp.text();
          const cleaned = text.startsWith(")]}'") ? text.slice(4) : text;
          const data = JSON.parse(cleaned);
          const accounts = data?.[1];
          if (Array.isArray(accounts) && accounts.length > 0) {
            const primary = accounts[0];
            if (!foundName) foundName = primary?.[2] || "";
            if (!foundEmail) foundEmail = primary?.[3] || "";
            if (!foundAvatar) foundAvatar = primary?.[4] || void 0;
            if (accounts.length > 1) {
              foundAliases = accounts.slice(1).map((acc) => acc?.[3]).filter((e) => typeof e === "string" && e.includes("@"));
            }
          }
        }
      } catch {
      }
    }
    if (!foundEmail) {
      try {
        const myAcc = await ses.fetch("https://myaccount.google.com/", {
          credentials: "include",
          headers: {
            "User-Agent": CHROME_UA,
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Dest": "document"
          },
          signal: AbortSignal.timeout(4e3)
        });
        if (myAcc.ok) {
          const html = await myAcc.text();
          const m = html.match(/aria-label="Google Account:[^"]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          if (m && !m[1].endsWith("@google.com")) {
            foundEmail = m[1];
          } else {
            const m2 = html.match(/"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/);
            if (m2 && !m2[1].endsWith("@google.com") && !m2[1].endsWith("@example.com")) {
              foundEmail = m2[1];
            }
          }
        }
      } catch {
      }
    }
    if (!foundEmail) {
      for (const c of googleCookies) {
        try {
          const decoded = decodeURIComponent(c.value);
          const match = decoded.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
          if (match && !match[1].endsWith("@google.com") && !match[1].endsWith("@example.com")) {
            foundEmail = match[1];
            break;
          }
        } catch {
        }
      }
    }
    return {
      id: "google",
      providerId: "google",
      email: foundEmail,
      displayName: foundName || foundEmail || "Google Account",
      avatarUrl: foundAvatar,
      aliases: foundAliases.length > 0 ? foundAliases : void 0,
      lastDetectedAt: Date.now()
    };
  }
};
const githubResolver = {
  providerId: "github",
  domains: ["github.com"],
  resolveIdentity: async (ses, cookies) => {
    const ghCookies = cookies.filter((c) => (c.domain || "").includes("github.com"));
    const isLoggedIn = ghCookies.some((c) => c.name === "logged_in" && c.value === "yes");
    const hasSession = ghCookies.some(
      (c) => c.name === "user_session" || c.name === "__Host-user_session_same_site" || c.name === "dotcom_user"
    );
    if (!isLoggedIn && !hasSession) return null;
    const userCookie = ghCookies.find((c) => c.name === "dotcom_user");
    let username = userCookie?.value ? decodeURIComponent(userCookie.value) : "";
    if (!username) {
      const paneUser = await extractFromMatchingPane(
        ses,
        "github.com",
        `(() => {
          const m = document.querySelector('meta[name="user-login"]');
          return m ? m.content : null;
        })()`
      );
      if (paneUser) username = paneUser;
    }
    if (!username) {
      const savedCookie = ghCookies.find((c) => c.name === "saved_user_sessions");
      if (savedCookie?.value) {
        const match = decodeURIComponent(savedCookie.value).match(/:([a-zA-Z0-9_-]+)/);
        if (match) username = match[1];
      }
    }
    return {
      id: "github",
      providerId: "github",
      handle: username ? `@${username}` : void 0,
      email: username ? `@${username}` : void 0,
      displayName: username || "GitHub User",
      lastDetectedAt: Date.now()
    };
  }
};
const microsoftResolver = {
  providerId: "microsoft",
  domains: ["microsoft.com", "login.microsoftonline.com", "live.com", "office.com", "microsoft365.com"],
  resolveIdentity: async (ses, cookies) => {
    const msCookies = cookies.filter((c) => {
      const d = c.domain || "";
      return d.includes("microsoft.com") || d.includes("login.microsoftonline.com") || d.includes("live.com") || d.includes("office.com") || d.includes("microsoft365.com");
    });
    const hasAuth = msCookies.some(
      (c) => c.name === "ESTSAUTHPERSISTENT" || c.name === "ESTSAUTH" || c.name === "RPSSecAuth" || c.name === "WLSSC" || c.name === "SignInStateCookie" || c.name === "DefaultAnchorMailbox"
    );
    if (!hasAuth) return null;
    let email = "";
    const mailboxCookie = msCookies.find((c) => c.name === "DefaultAnchorMailbox");
    if (mailboxCookie?.value) {
      try {
        const decoded = decodeURIComponent(mailboxCookie.value).replace(/^UPN:/i, "");
        if (decoded.includes("@")) email = decoded;
      } catch {
      }
    }
    if (!email) {
      const paneEmail = await extractFromMatchingPane(
        ses,
        "microsoft",
        `(() => {
          const el = document.querySelector('#mectrl_currentAccount_secondary, [data-test-id="user-email"]');
          if (el) {
            const m = (el.innerText || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
            if (m) return m[1];
          }
          return null;
        })()`
      );
      if (paneEmail) email = paneEmail;
    }
    if (!email) {
      for (const c of msCookies) {
        try {
          const decoded = decodeURIComponent(c.value);
          const match = decoded.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          if (match) {
            email = match[1];
            break;
          }
        } catch {
        }
      }
    }
    return {
      id: "microsoft",
      providerId: "microsoft",
      email: email || void 0,
      displayName: email || "Microsoft 365",
      lastDetectedAt: Date.now()
    };
  }
};
const appleResolver = {
  providerId: "apple",
  domains: ["apple.com", "appleid.apple.com", "icloud.com"],
  resolveIdentity: async (ses, cookies) => {
    const apCookies = cookies.filter((c) => {
      const d = c.domain || "";
      return d.includes("apple.com") || d.includes("icloud.com");
    });
    const hasAuth = apCookies.some(
      (c) => c.name === "myacinfo" || c.name === "acn01" || c.name === "aid-auth" || c.name === "scnt"
    );
    if (!hasAuth) return null;
    let email = "";
    const paneEmail = await extractFromMatchingPane(
      ses,
      "apple.com",
      `(() => {
        const el = document.querySelector('[class*="apple-id"], [class*="account-name"]');
        if (el) {
          const m = (el.innerText || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
          if (m) return m[1];
        }
        return null;
      })()`
    );
    if (paneEmail) email = paneEmail;
    return {
      id: "apple",
      providerId: "apple",
      handle: email || void 0,
      email: email || void 0,
      displayName: email || "Apple Account",
      lastDetectedAt: Date.now()
    };
  }
};
const slackResolver = {
  providerId: "slack",
  domains: ["slack.com"],
  resolveIdentity: async (ses, cookies) => {
    const slCookies = cookies.filter((c) => (c.domain || "").includes("slack.com"));
    const hasAuth = slCookies.some((c) => c.name === "d" && c.value.startsWith("xoxd-"));
    if (!hasAuth) return null;
    let label = "";
    const paneLabel = await extractFromMatchingPane(
      ses,
      "slack.com",
      `(() => {
        try {
          if (window.boot_data && window.boot_data.user_name) return '@' + window.boot_data.user_name;
        } catch {}
        const el = document.querySelector('[data-qa="channel_sidebar_name_you"], [data-qa="workspace_name"]');
        return el ? el.innerText.trim() : null;
      })()`
    );
    if (paneLabel) label = paneLabel;
    const isHandle = label.startsWith("@");
    return {
      id: "slack",
      providerId: "slack",
      handle: isHandle ? label : void 0,
      email: void 0,
      displayName: label || "Slack Workspace",
      lastDetectedAt: Date.now()
    };
  }
};
const xResolver = {
  providerId: "x",
  domains: ["x.com", "twitter.com"],
  resolveIdentity: async (ses, cookies) => {
    const xCookies = cookies.filter((c) => {
      const d = c.domain || "";
      return d.includes("x.com") || d.includes("twitter.com");
    });
    const hasAuth = xCookies.some((c) => c.name === "auth_token");
    if (!hasAuth) return null;
    let handle = "";
    const paneHandle = await extractFromMatchingPane(
      ses,
      "x.com",
      `(() => {
        const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        if (btn) {
          const m = (btn.innerText || '').match(/@([a-zA-Z0-9_]+)/);
          if (m) return '@' + m[1];
        }
        return null;
      })()`
    );
    if (paneHandle) handle = paneHandle;
    if (!handle) {
      const ct0 = xCookies.find((c) => c.name === "ct0")?.value || "";
      if (ct0) {
        try {
          const resp = await ses.fetch("https://api.x.com/1.1/account/settings.json", {
            credentials: "include",
            headers: {
              authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
              "x-csrf-token": ct0
            },
            signal: AbortSignal.timeout(4e3)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data?.screen_name) {
              handle = `@${data.screen_name}`;
            }
          }
        } catch {
        }
      }
    }
    if (!handle) {
      const twid = xCookies.find((c) => c.name === "twid");
      handle = twid?.value ? `@user_${decodeURIComponent(twid.value).replace(/\D/g, "").slice(-4)}` : "@x_user";
    }
    return {
      id: "x",
      providerId: "x",
      handle,
      email: handle,
      lastDetectedAt: Date.now()
    };
  }
};
const discordResolver = {
  providerId: "discord",
  domains: ["discord.com"],
  resolveIdentity: async (ses, cookies) => {
    const dCookies = cookies.filter((c) => (c.domain || "").includes("discord.com"));
    const hasAuth = dCookies.some(
      (c) => c.name === "token" || c.name === "__Secure-user_status" || c.name === "OptanonConsent"
    );
    if (!hasAuth) return null;
    let handle = "";
    const paneName = await extractFromMatchingPane(
      ses,
      "discord.com",
      `(() => {
        const panel = document.querySelector('[class*="accountProfileCard"], [class*="nameTag"], [class*="avatarWrapper"]');
        if (panel) {
          const t = (panel.innerText || '').split('\\n')[0].trim();
          if (t) return '@' + t.replace(/^@/, '');
        }
        return null;
      })()`
    );
    if (paneName) handle = paneName;
    return {
      id: "discord",
      providerId: "discord",
      handle: handle || void 0,
      email: handle || void 0,
      displayName: handle || "Discord User",
      lastDetectedAt: Date.now()
    };
  }
};
const gitlabResolver = {
  providerId: "gitlab",
  domains: ["gitlab.com"],
  resolveIdentity: async (ses, cookies) => {
    const glCookies = cookies.filter((c) => (c.domain || "").includes("gitlab.com"));
    const hasAuth = glCookies.some(
      (c) => c.name === "_gitlab_session" || c.name === "remember_user_token"
    );
    if (!hasAuth) return null;
    let handle = "";
    const paneUser = await extractFromMatchingPane(
      ses,
      "gitlab.com",
      `(() => {
        try {
          if (window.gon && window.gon.current_username) return '@' + window.gon.current_username;
        } catch {}
        const m = document.querySelector('meta[name="user-login"]');
        return m && m.content ? '@' + m.content : null;
      })()`
    );
    if (paneUser) handle = paneUser;
    return {
      id: "gitlab",
      providerId: "gitlab",
      handle: handle || void 0,
      email: handle || void 0,
      displayName: handle || "GitLab User",
      lastDetectedAt: Date.now()
    };
  }
};
const figmaResolver = {
  providerId: "figma",
  domains: ["figma.com"],
  resolveIdentity: async (ses, cookies) => {
    const fCookies = cookies.filter((c) => (c.domain || "").includes("figma.com"));
    const hasAuth = fCookies.some((c) => c.name === "figma.session" || c.name === "figma.auth_token");
    if (!hasAuth) return null;
    let handle = "";
    const paneHandle = await extractFromMatchingPane(
      ses,
      "figma.com",
      `(() => {
        try {
          if (window.INITIAL_OPTIONS && window.INITIAL_OPTIONS.user_data) {
            return window.INITIAL_OPTIONS.user_data.email || window.INITIAL_OPTIONS.user_data.handle;
          }
        } catch {}
        const el = document.querySelector('[data-testid="user-menu-button"], [aria-label*="@"]');
        return el ? el.getAttribute('aria-label') || el.innerText : null;
      })()`
    );
    if (paneHandle) handle = paneHandle;
    if (!handle) {
      try {
        const resp = await ses.fetch("https://www.figma.com/api/user/state", {
          credentials: "include",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(4e3)
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.meta?.email) {
            handle = data.meta.email;
          } else if (data?.meta?.handle) {
            handle = `@${data.meta.handle}`;
          }
        }
      } catch {
      }
    }
    return {
      id: "figma",
      providerId: "figma",
      handle: handle || void 0,
      email: handle || void 0,
      displayName: handle || "Figma Workspace",
      lastDetectedAt: Date.now()
    };
  }
};
const notionResolver = {
  providerId: "notion",
  domains: ["notion.so", "notion.site"],
  resolveIdentity: async (ses, cookies) => {
    const nCookies = cookies.filter((c) => (c.domain || "").includes("notion.so"));
    const hasAuth = nCookies.some((c) => c.name === "token_v2" || c.name === "notion_user_id");
    if (!hasAuth) return null;
    let email = "";
    const paneEmail = await extractFromMatchingPane(
      ses,
      "notion.so",
      `(() => {
        try {
          const u = window.__INITIAL_STATE__?.user;
          if (u && u.email) return u.email;
        } catch {}
        const el = document.querySelector('[role="button"][class*="user"], [data-email]');
        return el ? el.getAttribute('data-email') || el.innerText : null;
      })()`
    );
    if (paneEmail) email = paneEmail;
    return {
      id: "notion",
      providerId: "notion",
      email: email || void 0,
      handle: email || void 0,
      displayName: email || "Notion Workspace",
      lastDetectedAt: Date.now()
    };
  }
};
const linearResolver = {
  providerId: "linear",
  domains: ["linear.app"],
  resolveIdentity: async (ses, cookies) => {
    const lCookies = cookies.filter((c) => (c.domain || "").includes("linear.app"));
    const hasAuth = lCookies.some((c) => c.name === "linear:session" || c.name === "koa.sid");
    if (!hasAuth) return null;
    let handle = "";
    const paneHandle = await extractFromMatchingPane(
      ses,
      "linear.app",
      `(() => {
        const el = document.querySelector('[data-testid="user-profile-button"], [aria-label*="@"]');
        return el ? el.getAttribute('aria-label') || el.innerText : null;
      })()`
    );
    if (paneHandle) handle = paneHandle;
    return {
      id: "linear",
      providerId: "linear",
      handle: handle || void 0,
      email: handle || void 0,
      displayName: handle || "Linear Workspace",
      lastDetectedAt: Date.now()
    };
  }
};
const chatgptResolver = {
  providerId: "chatgpt",
  domains: ["chatgpt.com", "openai.com"],
  resolveIdentity: async (ses, cookies) => {
    const oCookies = cookies.filter(
      (c) => (c.domain || "").includes("chatgpt.com") || (c.domain || "").includes("openai.com")
    );
    const hasAuth = oCookies.some(
      (c) => c.name.includes("session-token") || c.name === "oai-did" || c.name === "__Secure-next-auth.session-token"
    );
    if (!hasAuth) return null;
    let email = "";
    const paneEmail = await extractFromMatchingPane(
      ses,
      "chatgpt.com",
      `(() => {
        const btn = document.querySelector('[data-testid="accounts-profile-button"]');
        if (btn) {
          const m = (btn.innerText || btn.getAttribute('aria-label') || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
          if (m) return m[1];
        }
        return null;
      })()`
    );
    if (paneEmail) email = paneEmail;
    if (!email) {
      try {
        const resp = await ses.fetch("https://chatgpt.com/api/auth/session", {
          credentials: "include",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(4e3)
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.user?.email) {
            email = data.user.email;
          }
        }
      } catch {
      }
    }
    return {
      id: "chatgpt",
      providerId: "chatgpt",
      email: email || void 0,
      handle: email || "OpenAI User",
      displayName: email || "ChatGPT Account",
      lastDetectedAt: Date.now()
    };
  }
};
const canvaResolver = {
  providerId: "canva",
  domains: ["canva.com"],
  resolveIdentity: async (ses, cookies) => {
    const cCookies = cookies.filter((c) => (c.domain || "").includes("canva.com"));
    const hasAuth = cCookies.some((c) => c.name === "canva_session" || c.name === "c_user");
    if (!hasAuth) return null;
    let name = "";
    const paneName = await extractFromMatchingPane(
      ses,
      "canva.com",
      `(() => {
        const el = document.querySelector('[data-testid="user-profile-menu"], [aria-label*="Account"]');
        return el ? el.getAttribute('aria-label') || el.innerText : null;
      })()`
    );
    if (paneName) name = paneName;
    return {
      id: "canva",
      providerId: "canva",
      handle: name || void 0,
      email: name || void 0,
      displayName: name || "Canva Workspace",
      lastDetectedAt: Date.now()
    };
  }
};
const vercelResolver = {
  providerId: "vercel",
  domains: ["vercel.com"],
  resolveIdentity: async (ses, cookies) => {
    const vCookies = cookies.filter((c) => (c.domain || "").includes("vercel.com"));
    const hasAuth = vCookies.some((c) => c.name === "_vercel_jwt" || c.name === "current_team");
    if (!hasAuth) return null;
    let handle = "";
    const paneHandle = await extractFromMatchingPane(
      ses,
      "vercel.com",
      `(() => {
        try {
          const m = document.querySelector('meta[name="user-login"], [data-testid="header-avatar"]');
          if (m) return m.getAttribute('content') || m.getAttribute('aria-label');
        } catch {}
        const el = document.querySelector('[data-testid="user-avatar"]');
        return el ? el.getAttribute('aria-label') : null;
      })()`
    );
    if (paneHandle) handle = paneHandle;
    return {
      id: "vercel",
      providerId: "vercel",
      handle: handle ? `@${handle.replace(/^@/, "")}` : void 0,
      email: void 0,
      displayName: handle || "Vercel User",
      lastDetectedAt: Date.now()
    };
  }
};
const stripeResolver = {
  providerId: "stripe",
  domains: ["stripe.com", "dashboard.stripe.com"],
  resolveIdentity: async (ses, cookies) => {
    const sCookies = cookies.filter((c) => (c.domain || "").includes("stripe.com"));
    const hasAuth = sCookies.some((c) => c.name === "merchant" || c.name === "cid" || c.name === "user");
    if (!hasAuth) return null;
    let label = "";
    const paneLabel = await extractFromMatchingPane(
      ses,
      "dashboard.stripe.com",
      `(() => {
        const el = document.querySelector('[data-test="user-menu-button"], [aria-label*="@"]');
        if (el) {
          const m = (el.innerText || el.getAttribute('aria-label') || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
          if (m) return m[1];
          return el.innerText.trim();
        }
        return null;
      })()`
    );
    if (paneLabel) label = paneLabel;
    const isEmail = label.includes("@");
    return {
      id: "stripe",
      providerId: "stripe",
      handle: !isEmail && label ? label : void 0,
      email: isEmail ? label : void 0,
      displayName: label || "Stripe Merchant",
      lastDetectedAt: Date.now()
    };
  }
};
const atlassianResolver = {
  providerId: "atlassian",
  domains: ["atlassian.com", "atlassian.net", "jira.com"],
  resolveIdentity: async (ses, cookies) => {
    const aCookies = cookies.filter(
      (c) => (c.domain || "").includes("atlassian.com") || (c.domain || "").includes("atlassian.net") || (c.domain || "").includes("jira.com")
    );
    const hasAuth = aCookies.some(
      (c) => c.name === "atlassian.account.xsrf" || c.name === "ajs_user_id" || c.name === "cloud.session.token"
    );
    if (!hasAuth) return null;
    let email = "";
    const paneEmail = await extractFromMatchingPane(
      ses,
      "atlassian",
      `(() => {
        const el = document.querySelector('[data-testid="profile-avatar-trigger"], [data-testid="header-profile-menu-button"]');
        if (el) {
          const m = (el.innerText || el.getAttribute('aria-label') || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
          if (m) return m[1];
          return el.getAttribute('aria-label');
        }
        return null;
      })()`
    );
    if (paneEmail) email = paneEmail;
    return {
      id: "atlassian",
      providerId: "atlassian",
      handle: email || void 0,
      email: email || void 0,
      displayName: email || "Atlassian / Jira",
      lastDetectedAt: Date.now()
    };
  }
};
const ALL_RESOLVERS = [
  googleResolver,
  githubResolver,
  microsoftResolver,
  appleResolver,
  slackResolver,
  xResolver,
  figmaResolver,
  notionResolver,
  linearResolver,
  chatgptResolver,
  canvaResolver,
  vercelResolver,
  stripeResolver,
  atlassianResolver,
  discordResolver,
  gitlabResolver
];
const GENERIC_SUFFIXES = [
  " account",
  " workspace",
  " user",
  " connected",
  " id",
  " merchant"
];
const KNOWN_GENERIC_LABELS = /* @__PURE__ */ new Set([
  "google account",
  "google user",
  "@github_user",
  "github user",
  "microsoft 365",
  "microsoft user",
  "apple id",
  "apple account",
  "slack workspace",
  "slack connected",
  "chatgpt account",
  "openai user",
  "figma workspace",
  "figma account",
  "notion workspace",
  "notion account",
  "linear workspace",
  "linear account",
  "canva workspace",
  "canva account",
  "discord user",
  "discord account",
  "@gitlab_user",
  "gitlab account",
  "stripe merchant",
  "stripe account",
  "atlassian / jira",
  "atlassian account",
  "vercel user",
  "vercel account"
]);
function isGenericPlaceholder(val) {
  if (!val || typeof val !== "string") return true;
  const trimmed = val.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  if (KNOWN_GENERIC_LABELS.has(trimmed)) return true;
  return GENERIC_SUFFIXES.some((s) => trimmed.endsWith(s));
}
function mergeSingleIdentity(existing, incoming) {
  if (!existing) return incoming;
  const incomingEmailIsSpecific = !isGenericPlaceholder(incoming.email);
  const existingEmailIsSpecific = !isGenericPlaceholder(existing.email);
  const email = incomingEmailIsSpecific ? incoming.email : existingEmailIsSpecific ? existing.email : incoming.email || existing.email;
  const incomingHandleIsSpecific = !isGenericPlaceholder(incoming.handle);
  const existingHandleIsSpecific = !isGenericPlaceholder(existing.handle);
  const handle = incomingHandleIsSpecific ? incoming.handle : existingHandleIsSpecific ? existing.handle : incoming.handle || existing.handle;
  const incomingNameIsSpecific = !isGenericPlaceholder(incoming.displayName);
  const existingNameIsSpecific = !isGenericPlaceholder(existing.displayName);
  const displayName = incomingNameIsSpecific ? incoming.displayName : existingNameIsSpecific ? existing.displayName : incoming.displayName || existing.displayName;
  const aliasesSet = /* @__PURE__ */ new Set([
    ...existing.aliases || [],
    ...incoming.aliases || []
  ]);
  const aliases = aliasesSet.size > 0 ? Array.from(aliasesSet) : void 0;
  return {
    id: incoming.id || existing.id,
    providerId: incoming.providerId || existing.providerId,
    email,
    handle,
    displayName,
    avatarUrl: incoming.avatarUrl || existing.avatarUrl,
    aliases,
    lastDetectedAt: Math.max(
      incoming.lastDetectedAt || 0,
      existing.lastDetectedAt || 0,
      Date.now()
    )
  };
}
function mergeIdentitiesMap(existingMap = {}, incomingMap = {}) {
  const merged = { ...existingMap };
  for (const [providerId, incoming] of Object.entries(incomingMap)) {
    if (!incoming) continue;
    const existing = existingMap[providerId];
    merged[providerId] = mergeSingleIdentity(existing, incoming);
  }
  return merged;
}
const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
const attachedSessions = /* @__PURE__ */ new Set();
function attachSessionNetworkInterceptor(ses, profileId, onIdentityFound) {
  const partitionKey = ses._partitionKey || profileId;
  if (attachedSessions.has(partitionKey)) return;
  attachedSessions.add(partitionKey);
  const filter = {
    urls: [
      "*://accounts.google.com/*",
      "*://myaccount.google.com/*",
      "*://login.microsoftonline.com/*",
      "*://login.live.com/*",
      "*://chatgpt.com/api/auth/*",
      "*://www.figma.com/api/user/*"
    ]
  };
  try {
    ses.webRequest.onBeforeRequest(filter, (details, callback) => {
      try {
        const urlStr = details.url;
        const parsed = new URL(urlStr);
        const googleLoginHint = parsed.searchParams.get("login_hint") || parsed.searchParams.get("Email") || parsed.searchParams.get("identifier");
        if (googleLoginHint && EMAIL_REGEX.test(googleLoginHint) && !googleLoginHint.endsWith("@google.com")) {
          onIdentityFound(profileId, {
            providerId: "google",
            email: googleLoginHint,
            displayName: googleLoginHint,
            lastDetectedAt: Date.now()
          });
        }
        if (details.method === "POST" && details.uploadData && details.uploadData.length > 0) {
          for (const chunk of details.uploadData) {
            if (chunk.bytes) {
              const bodyText = chunk.bytes.toString("utf8");
              if (bodyText.includes("@")) {
                const match = bodyText.match(EMAIL_REGEX);
                if (match && !match[1].endsWith("@google.com") && !match[1].endsWith("@example.com")) {
                  onIdentityFound(profileId, {
                    providerId: "google",
                    email: match[1],
                    displayName: match[1],
                    lastDetectedAt: Date.now()
                  });
                  break;
                }
              }
            }
          }
        }
        if (parsed.hostname.includes("microsoft") || parsed.hostname.includes("live.com")) {
          const msLoginHint = parsed.searchParams.get("login_hint") || parsed.searchParams.get("username") || parsed.searchParams.get("upn");
          if (msLoginHint && EMAIL_REGEX.test(msLoginHint)) {
            onIdentityFound(profileId, {
              providerId: "microsoft",
              email: msLoginHint,
              displayName: msLoginHint,
              lastDetectedAt: Date.now()
            });
          }
        }
      } catch {
      }
      callback({});
    });
  } catch (err) {
    console.warn(`[NetworkInterceptor] Failed to attach for ${profileId}:`, err);
  }
}
function getPartitionForProfile(profileId) {
  if (!profileId || profileId === "main") return "persist:main";
  try {
    const p = getProfileById(profileId);
    if (p?.is_ephemeral) return profileId;
  } catch {
  }
  return `persist:${profileId}`;
}
function getSessionForProfile(profileId) {
  const partition = getPartitionForProfile(profileId);
  return electron.session.fromPartition(partition);
}
function getProfileIdForSession(ses) {
  const profiles = getProfiles() || [];
  for (const p of profiles) {
    if (getSessionForProfile(p.id) === ses) return p.id;
  }
  return "main";
}
async function clearProviderSessionStorage(ses, domains) {
  for (const d of domains) {
    try {
      await ses.clearStorageData({
        origin: `https://${d}`,
        storages: ["cookies", "localstorage", "serviceworkers", "cachestorage"]
      });
    } catch {
    }
    try {
      const cookies = await ses.cookies.get({ domain: d });
      for (const c of cookies) {
        const scheme = c.secure ? "https" : "http";
        const domain = c.domain?.startsWith(".") ? c.domain.slice(1) : c.domain;
        await ses.cookies.remove(`${scheme}://${domain}${c.path || "/"}`, c.name);
      }
    } catch {
    }
  }
}
function repairCorruptedProfileIdentities() {
  const profiles = getProfiles() || [];
  for (const p of profiles) {
    if (p.identities_json && p.identities_json.includes('"Google Account"')) {
      try {
        const parsed = JSON.parse(p.identities_json);
        let touched = false;
        for (const k of Object.keys(parsed)) {
          if (parsed[k]?.email === "Google Account") {
            delete parsed[k].email;
            touched = true;
          }
        }
        if (touched) updateProfileIdentities(p.id, JSON.stringify(parsed));
      } catch {
      }
    }
  }
}
function broadcastProfilesUpdated() {
  const updated = getProfiles();
  if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
    global.appOverlayView.webContents.send(IPC_CHANNELS.EVENTS.PROFILES_UPDATED, updated);
  }
}
function parseIdentitiesJson(json) {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
class SessionIdentityService {
  observedSessions = /* @__PURE__ */ new Set();
  debounceTimers = /* @__PURE__ */ new Map();
  lastScanTime = /* @__PURE__ */ new Map();
  cachedResults = /* @__PURE__ */ new Map();
  getPartitionForProfile = getPartitionForProfile;
  getSessionForProfile = getSessionForProfile;
  getProfileIdForSession = getProfileIdForSession;
  broadcastProfilesUpdated = broadcastProfilesUpdated;
  attachCookieObserver(profileId) {
    const partition = this.getPartitionForProfile(profileId);
    if (this.observedSessions.has(partition)) return;
    this.observedSessions.add(partition);
    try {
      const ses = this.getSessionForProfile(profileId);
      attachSessionNetworkInterceptor(ses, profileId, (pId, id) => {
        this.registerDiscoveredIdentity(pId, id);
      });
      ses.cookies.on("changed", (_event, cookie) => {
        const domain = (cookie?.domain || "").toLowerCase();
        const matchesAny = ALL_RESOLVERS.some(
          (r) => r.domains.some((d) => domain.includes(d))
        );
        if (!matchesAny) return;
        this.lastScanTime.delete(profileId);
        const timerKey = `${profileId}:${domain}`;
        if (this.debounceTimers.has(timerKey)) {
          clearTimeout(this.debounceTimers.get(timerKey));
        }
        const timer = setTimeout(() => {
          this.debounceTimers.delete(timerKey);
          this.scanProfile(profileId, true).catch(() => {
          });
        }, 1e3);
        this.debounceTimers.set(timerKey, timer);
      });
    } catch (e) {
      console.warn(`[IdentityService] Failed to attach observer for ${profileId}:`, e);
    }
  }
  registerDiscoveredIdentity(profileId, partial) {
    if (!profileId || !partial.providerId) return;
    const current = getProfileById(profileId);
    const existingMap = parseIdentitiesJson(current?.identities_json);
    const providerId = partial.providerId;
    const incoming = {
      id: providerId,
      providerId,
      email: partial.email,
      handle: partial.handle,
      displayName: partial.displayName,
      avatarUrl: partial.avatarUrl,
      lastDetectedAt: Date.now()
    };
    existingMap[providerId] = mergeSingleIdentity(existingMap[providerId], incoming);
    const serialized = JSON.stringify(existingMap);
    if (!current || current.identities_json !== serialized) {
      updateProfileIdentities(profileId, serialized);
      this.cachedResults.set(profileId, existingMap);
      this.broadcastProfilesUpdated();
    }
  }
  async scanProfile(profileId, force = false) {
    const now = Date.now();
    const last = this.lastScanTime.get(profileId) || 0;
    if (!force && now - last < 5e3 && this.cachedResults.has(profileId)) {
      return this.cachedResults.get(profileId);
    }
    const ses = this.getSessionForProfile(profileId);
    const cookies = await ses.cookies.get({});
    const scannedIdentities = {};
    await Promise.all(
      ALL_RESOLVERS.map(async (resolver) => {
        try {
          const identity = await resolver.resolveIdentity(ses, cookies);
          if (identity) scannedIdentities[resolver.providerId] = identity;
        } catch (err) {
          console.warn(`[IdentityService] Resolver error for ${resolver.providerId}:`, err);
        }
      })
    );
    const current = getProfileById(profileId);
    const existingMap = parseIdentitiesJson(current?.identities_json);
    const merged = mergeIdentitiesMap(existingMap, scannedIdentities);
    const serialized = JSON.stringify(merged);
    this.lastScanTime.set(profileId, now);
    this.cachedResults.set(profileId, merged);
    if (current?.is_ephemeral) {
      this.broadcastProfilesUpdated();
    } else if (!current || current.identities_json !== serialized) {
      updateProfileIdentities(profileId, serialized);
      this.broadcastProfilesUpdated();
    }
    return merged;
  }
  async scanAllProfiles() {
    try {
      const profiles = getProfiles() || [];
      for (const p of profiles) {
        this.attachCookieObserver(p.id);
        await this.scanProfile(p.id);
      }
    } catch (err) {
      console.error("[IdentityService] Failed to scan all profiles:", err);
    }
  }
  async disconnectProvider(profileId, providerId) {
    try {
      this.lastScanTime.delete(profileId);
      this.cachedResults.delete(profileId);
      const ses = this.getSessionForProfile(profileId);
      const resolver = ALL_RESOLVERS.find((r) => r.providerId === providerId);
      if (resolver) await clearProviderSessionStorage(ses, resolver.domains);
      const p = getProfileById(profileId);
      const identities = parseIdentitiesJson(p?.identities_json);
      delete identities[providerId];
      updateProfileIdentities(profileId, JSON.stringify(identities));
      this.broadcastProfilesUpdated();
      return { success: true };
    } catch (err) {
      console.error(`[IdentityService] Failed to disconnect ${providerId}:`, err);
      return { success: false, error: err.message };
    }
  }
  init() {
    try {
      electron.ipcMain.on("pane.identity-harvested", (event, identity) => {
        if (!identity || !identity.providerId) return;
        const profileId = this.getProfileIdForSession(event.sender.session);
        this.registerDiscoveredIdentity(profileId, identity);
      });
      repairCorruptedProfileIdentities();
      const profiles = getProfiles() || [];
      for (const p of profiles) {
        this.attachCookieObserver(p.id);
      }
    } catch (e) {
      console.warn("[IdentityService] Failed to initialize hooks:", e);
    }
  }
}
const sessionIdentityService = new SessionIdentityService();
const DEFAULT_CHROME_VERSION = "144.0.7550.80";
const DEFAULT_DESKTOP_UA = typeof process !== "undefined" && process.platform === "darwin" ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${DEFAULT_CHROME_VERSION} Safari/537.36` : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${DEFAULT_CHROME_VERSION} Safari/537.36`;
const FIREFOX_AUTH_UA = typeof process !== "undefined" && process.platform === "darwin" ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0";
function cleanUserAgent(ua) {
  if (!ua) {
    return DEFAULT_DESKTOP_UA;
  }
  const raw = Array.isArray(ua) ? ua[0] : ua;
  if (typeof raw !== "string" || !raw.trim()) {
    return DEFAULT_DESKTOP_UA;
  }
  const cleaned = raw.replace(/Electron\/\S*/gi, "").replace(/Apposition\w*\/\S*/gi, "").replace(/\s{2,}/g, " ").trim();
  return cleaned.length > 10 ? cleaned : DEFAULT_DESKTOP_UA;
}
function isGoogleAuthUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "accounts.google.com" || host.endsWith(".accounts.google.com") || host === "accounts.youtube.com" || host.endsWith(".accounts.youtube.com") || host.includes("google.com") && parsed.pathname.startsWith("/gsi/");
  } catch {
    const lower = url.toLowerCase();
    return lower.includes("accounts.google.com") || lower.includes("accounts.youtube.com") || lower.includes("google.com/gsi/");
  }
}
function generateClientHints(chromeVersion = DEFAULT_CHROME_VERSION, platform = "Windows") {
  const cleanVersion = chromeVersion || DEFAULT_CHROME_VERSION;
  const major = cleanVersion.split(".")[0] || "144";
  const secChUa = `"Not A(Brand";v="8", "Chromium";v="${major}", "Google Chrome";v="${major}"`;
  const secChUaFull = `"Not A(Brand";v="8.0.0.0", "Chromium";v="${cleanVersion}", "Google Chrome";v="${cleanVersion}"`;
  return {
    "sec-ch-ua": secChUa,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${platform}"`,
    "sec-ch-ua-full-version-list": secChUaFull
  };
}
function sanitizeRequestHeaders(headers, clientHints, targetUrl) {
  if (!headers || typeof headers !== "object") return {};
  const result = { ...headers };
  if (targetUrl && isGoogleAuthUrl(targetUrl)) {
    const uaKey2 = Object.keys(result).find((k) => k.toLowerCase() === "user-agent") || "User-Agent";
    result[uaKey2] = FIREFOX_AUTH_UA;
    for (const key of Object.keys(result)) {
      if (key.toLowerCase().startsWith("sec-ch-ua")) {
        delete result[key];
      }
    }
    return result;
  }
  const uaKey = Object.keys(result).find((k) => k.toLowerCase() === "user-agent") || "User-Agent";
  result[uaKey] = cleanUserAgent(result[uaKey]);
  const clientHintKeys = /* @__PURE__ */ new Set([
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-ch-ua-full-version-list"
  ]);
  for (const key of Object.keys(result)) {
    const lower = key.toLowerCase();
    if (clientHintKeys.has(lower) && lower !== key) {
      delete result[key];
    }
  }
  result["sec-ch-ua"] = clientHints["sec-ch-ua"];
  result["sec-ch-ua-mobile"] = clientHints["sec-ch-ua-mobile"];
  result["sec-ch-ua-platform"] = clientHints["sec-ch-ua-platform"];
  result["sec-ch-ua-full-version-list"] = clientHints["sec-ch-ua-full-version-list"];
  const langKey = Object.keys(result).find((k) => k.toLowerCase() === "accept-language") || "Accept-Language";
  result[langKey] = "en-US,en;q=0.9";
  return result;
}
let activeAuthWindow = null;
function isProviderAuthComplete(providerId, url) {
  const lower = (url || "").toLowerCase();
  if (lower.startsWith("apposition://") || lower.includes("#oauth-success")) return true;
  switch (providerId) {
    case "google":
      return !lower.includes("accounts.google.") && !lower.includes("google.com/gsi") && !lower.includes("google.com/signin") && !lower.includes("google.com/servicelogin") && !lower.includes("google.com/o/oauth2") && !lower.includes("accounts.google.com/v3/signin");
    case "github":
      return lower.includes("github.com") && !lower.includes("/login") && !lower.includes("/session");
    case "microsoft":
      return !lower.includes("login.microsoftonline.com") && !lower.includes("login.live.com") && (lower.includes("microsoft.com") || lower.includes("office.com"));
    case "x":
      return (lower.includes("twitter.com") || lower.includes("x.com")) && !lower.includes("/login") && !lower.includes("/i/flow/login");
    case "discord":
      return lower.includes("discord.com") && !lower.includes("/login");
    case "gitlab":
      return lower.includes("gitlab.com") && !lower.includes("/users/sign_in");
    case "slack":
      return lower.includes("slack.com") && !lower.includes("/signin");
    case "apple":
      return lower.includes("apple.com") && !lower.includes("appleid.apple.com/auth");
    default:
      return false;
  }
}
function openConnectAccountModal(options) {
  try {
    if (activeAuthWindow && !activeAuthWindow.isDestroyed()) {
      activeAuthWindow.focus();
      return { success: true };
    }
    const { providerId, loginUrl, profileId = "main", returnUrl } = options;
    const partition = sessionIdentityService.getPartitionForProfile(profileId);
    const isGoogle = providerId === "google";
    const authWin = new electron.BrowserWindow({
      width: 540,
      height: 700,
      center: true,
      title: `${providerId.toUpperCase()} Sign-In`,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#fafaf9",
        symbolColor: "#121212",
        height: 36
      },
      backgroundColor: "#FFFFFF",
      show: false,
      icon: path.join(
        __dirname,
        process.platform === "linux" ? "../../../assets/icon.png" : "../../../assets/icon.ico"
      ),
      webPreferences: {
        partition,
        preload: isGoogle ? path.join(__dirname, "../../preload/authGuard.js") : void 0,
        sandbox: true,
        contextIsolation: !isGoogle
      }
    });
    activeAuthWindow = authWin;
    const authWebContentsId = authWin.webContents.id;
    registerOAuthPopup(authWebContentsId);
    if (isGoogle) {
      try {
        authWin.webContents.setUserAgent(FIREFOX_AUTH_UA);
      } catch {
      }
    }
    authWin.once("ready-to-show", () => {
      if (!authWin.isDestroyed()) authWin.show();
    });
    const notifyAndClose = async () => {
      try {
        if (!authWin.isDestroyed()) {
          const domEmail = await authWin.webContents.executeJavaScript(
            `(() => {
                const el = document.querySelector('a[aria-label*="@"], div[aria-label*="@"], [data-email], #profileIdentifier, div[data-profile-identifier]');
                if (el) {
                  const text = el.getAttribute('data-email') || el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '';
                  const m = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
                  if (m && !m[1].endsWith('@google.com')) return m[1];
                }
                const input = document.querySelector('input[type="email"]');
                if (input && input.value && input.value.includes('@')) return input.value.trim();
                return null;
              })()`,
            true
          ).catch(() => null);
          if (domEmail) {
            sessionIdentityService.registerDiscoveredIdentity(profileId, {
              providerId,
              email: domEmail,
              displayName: domEmail,
              lastDetectedAt: Date.now()
            });
          }
        }
      } catch {
      }
      const identities = await sessionIdentityService.scanProfile(profileId, true);
      const identity = identities[providerId];
      if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
        global.appOverlayView.webContents.send("app.auth-completed", {
          profileId,
          providerId,
          returnUrl,
          identity,
          success: true
        });
      }
      setTimeout(() => {
        if (!authWin.isDestroyed()) authWin.close();
      }, 600);
    };
    const handleNavigation = (_e, navUrl) => {
      if (isProviderAuthComplete(providerId, navUrl)) {
        notifyAndClose();
      }
    };
    authWin.webContents.on("did-navigate", handleNavigation);
    authWin.webContents.on("did-navigate-in-page", (_e, navUrl, isMainFrame) => {
      if (isMainFrame) {
        handleNavigation(_e, navUrl);
      }
    });
    authWin.once("closed", () => {
      unregisterOAuthPopup(authWebContentsId);
      if (activeAuthWindow === authWin) {
        activeAuthWindow = null;
      }
      sessionIdentityService.scanProfile(profileId).catch(() => {
      });
    });
    authWin.loadURL(loginUrl, isGoogle ? { userAgent: FIREFOX_AUTH_UA } : void 0);
    return { success: true };
  } catch (err) {
    console.error(`Failed to open auth modal for ${options.providerId}:`, err);
    return { success: false, error: err.message };
  }
}
class IdleGovernor {
  state = createInitialGovernorState();
  idleCheckInterval = null;
  boundWindow = null;
  isPowerMonitorBound = false;
  getState() {
    return this.state;
  }
  dispatch(action) {
    const [nextState, effects] = reduceGovernorState(this.state, action);
    this.state = nextState;
    this.runEffects(effects);
  }
  runEffects(effects) {
    for (const effect of effects) {
      switch (effect.type) {
        case "SET_HIBERNATION_MINIMIZED":
          hibernationEngine.setAppMinimized(effect.isMinimized);
          break;
        case "TRIGGER_COMPACTION":
          this.executeCompaction();
          break;
        case "TRIGGER_WAKE":
          try {
            global.appOverlayView?.webContents.send("app:idle-wake");
          } catch {
          }
          break;
        case "NOTIFY_RENDERER":
          try {
            global.appOverlayView?.webContents.send("app:governor-state", effect.state);
          } catch {
          }
          break;
      }
    }
  }
  executeCompaction() {
    try {
      if (typeof global.gc === "function") {
        global.gc();
      }
    } catch {
    }
    try {
      electron.session.defaultSession.clearHostResolverCache();
      electron.session.defaultSession.clearAuthCache();
    } catch {
    }
    try {
      if (typeof process.trimWorkingSet === "function") {
        process.trimWorkingSet();
      }
    } catch {
    }
    logger$6.debug("[IdleGovernor] Sub-Zero compaction executed", {
      state: this.state.state,
      compactions: this.state.compactionCount
    });
  }
  bindWindow(win) {
    if (this.boundWindow === win) return;
    this.boundWindow = win;
    win.on("minimize", () => this.dispatch({ type: "WINDOW_MINIMIZE" }));
    win.on("restore", () => this.dispatch({ type: "WINDOW_RESTORE" }));
    win.on("hide", () => this.dispatch({ type: "WINDOW_HIDE" }));
    win.on("show", () => this.dispatch({ type: "WINDOW_SHOW" }));
    this.bindPowerMonitor();
    this.startIdlePoller();
  }
  bindPowerMonitor() {
    if (this.isPowerMonitorBound) return;
    this.isPowerMonitorBound = true;
    electron.powerMonitor.on("lock-screen", () => this.dispatch({ type: "SYSTEM_LOCK" }));
    electron.powerMonitor.on("unlock-screen", () => this.dispatch({ type: "SYSTEM_UNLOCK" }));
    electron.powerMonitor.on("suspend", () => this.dispatch({ type: "SYSTEM_SUSPEND" }));
    electron.powerMonitor.on("resume", () => this.dispatch({ type: "SYSTEM_RESUME" }));
  }
  startIdlePoller() {
    if (this.idleCheckInterval) return;
    this.idleCheckInterval = setInterval(() => {
      try {
        const idleSec = electron.powerMonitor.getSystemIdleTime();
        if (idleSec >= 120 && this.state.state === "ACTIVE") {
          this.dispatch({ type: "SYSTEM_IDLE" });
        } else if (idleSec < 10 && this.state.state === "IDLE") {
          this.dispatch({ type: "USER_ACTIVE" });
        }
      } catch {
      }
    }, 3e4);
  }
  stop() {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
    this.boundWindow = null;
  }
}
const idleGovernor = new IdleGovernor();
function getSafeClipboard() {
  const c = electron__namespace.clipboard || electron__namespace.default?.clipboard || electron.clipboard;
  if (c && (typeof c.write === "function" || typeof c.writeImage === "function" || typeof c.writeText === "function")) {
    return c;
  }
  try {
    const req = typeof require !== "undefined" ? require("electron") : null;
    return req?.clipboard || req?.default?.clipboard || c;
  } catch {
    return c;
  }
}
function getSafeClipboardItem() {
  const ci = electron__namespace.ClipboardItem || electron__namespace.default?.ClipboardItem || electron.ClipboardItem;
  if (ci && typeof ci === "function") return ci;
  try {
    const req = typeof require !== "undefined" ? require("electron") : null;
    return req?.ClipboardItem || req?.default?.ClipboardItem || ci;
  } catch {
    return ci;
  }
}
function getSafeNativeImage() {
  const ni = electron__namespace.nativeImage || electron__namespace.default?.nativeImage || electron.nativeImage;
  if (ni && typeof ni.createFromBuffer === "function") return ni;
  try {
    const req = typeof require !== "undefined" ? require("electron") : null;
    return req?.nativeImage || req?.default?.nativeImage || ni;
  } catch {
    return ni;
  }
}
function getSafeNet() {
  const n = electron__namespace.net || electron__namespace.default?.net || electron.net;
  if (n && typeof n.fetch === "function") return n;
  try {
    const req = typeof require !== "undefined" ? require("electron") : null;
    return req?.net || req?.default?.net || n;
  } catch {
    return n;
  }
}
async function writeImageToClipboard(pngBuffer, dataUrl) {
  if (!pngBuffer || pngBuffer.length === 0) return false;
  const clip = getSafeClipboard();
  if (!clip) return false;
  const resolvedDataUrl = dataUrl || `data:image/png;base64,${Buffer.from(pngBuffer).toString("base64")}`;
  const ClipboardItemClass = getSafeClipboardItem();
  if (typeof clip.write === "function" && typeof ClipboardItemClass === "function") {
    try {
      const pngBlob = new Blob([pngBuffer], { type: "image/png" });
      const htmlBlob = new Blob([`<img src="${resolvedDataUrl}" alt="Copied Image" />`], {
        type: "text/html"
      });
      const item = new ClipboardItemClass({
        "image/png": pngBlob,
        "text/html": htmlBlob
      });
      await clip.write([item]);
      return true;
    } catch (err) {
      console.warn("[clipboardService] W3C clip.write failed, trying legacy fallback:", err);
    }
  }
  try {
    const nativeImg = getSafeNativeImage()?.createFromBuffer(Buffer.from(pngBuffer));
    if (nativeImg && !nativeImg.isEmpty()) {
      if (typeof clip.writeImage === "function") {
        clip.writeImage(nativeImg);
        return true;
      }
      if (typeof clip.write === "function") {
        clip.write({
          image: nativeImg,
          html: `<img src="${resolvedDataUrl}" />`
        });
        return true;
      }
    }
  } catch (fallbackErr) {
    console.warn("[clipboardService] Legacy writeImage fallback failed:", fallbackErr);
  }
  return false;
}
async function captureWebContentsCdp(wc, options = { fullPage: true, copyToClipboard: true }) {
  if (wc.isDestroyed()) return { success: false, error: "WebContents destroyed" };
  try {
    let image;
    let buffer;
    if (!options.fullPage) {
      image = await wc.capturePage();
      buffer = image.toPNG();
    } else {
      const dbg = wc.debugger;
      let attached = false;
      try {
        if (!dbg.isAttached()) {
          dbg.attach("1.3");
          attached = true;
        }
        await dbg.sendCommand("Page.enable");
        const screenshotData = await dbg.sendCommand("Page.captureScreenshot", {
          format: options.format || "png",
          quality: options.quality || 95,
          captureBeyondViewport: true
        });
        buffer = Buffer.from(screenshotData.data, "base64");
        image = getSafeNativeImage().createFromBuffer(buffer);
      } finally {
        if (attached && dbg.isAttached()) {
          try {
            dbg.detach();
          } catch {
          }
        }
      }
    }
    if (!image || image.isEmpty()) {
      return { success: false, error: "Captured image is empty" };
    }
    if (options.copyToClipboard) {
      await writeImageToClipboard(buffer, image.toDataURL());
    }
    let filePath = options.savePath;
    if (!filePath && !options.copyToClipboard) {
      const fileName = `screenshot-${Date.now()}.${options.format || "png"}`;
      filePath = path.join(electron.app.getPath("pictures"), fileName);
      await promises.writeFile(filePath, buffer);
    } else if (filePath) {
      await promises.writeFile(filePath, buffer);
    }
    return {
      success: true,
      dataUrl: image.toDataURL(),
      filePath
    };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}
class MultiPaneSearchCoordinator {
  activeQuery = "";
  paneResults = /* @__PURE__ */ new Map();
  findInPanes(panes2, query, options = {}) {
    const trimmed = (query || "").trim();
    if (!trimmed) {
      this.stopFind(panes2, "clearSelection");
      return;
    }
    this.activeQuery = trimmed;
    const hasTarget = Boolean(options.targetPaneId && panes2.has(options.targetPaneId));
    for (const [paneId, wc] of panes2.entries()) {
      if (!wc.isDestroyed()) {
        if (hasTarget && paneId !== options.targetPaneId) {
          wc.stopFindInPage("clearSelection");
          this.paneResults.delete(paneId);
          continue;
        }
        const reqId = wc.findInPage(trimmed, {
          forward: options.forward ?? true,
          findNext: options.findNext ?? false,
          matchCase: options.matchCase ?? false
        });
        const current = this.paneResults.get(paneId);
        this.paneResults.set(paneId, {
          activeMatch: current?.activeMatch || 0,
          total: current?.total || 0,
          requestId: reqId
        });
      }
    }
  }
  handlePaneResult(paneId, result) {
    const total = typeof result.matches === "number" ? result.matches : typeof result.numberOfMatches === "number" ? result.numberOfMatches : 0;
    const active = result.activeMatchOrdinal || 0;
    const reqId = result.requestId || 0;
    const existing = this.paneResults.get(paneId);
    if (existing && reqId > 0 && existing.requestId > 0 && reqId < existing.requestId) {
      return this.aggregateResults();
    }
    this.paneResults.set(paneId, {
      activeMatch: active,
      total,
      requestId: reqId || existing?.requestId || 0
    });
    return this.aggregateResults();
  }
  aggregateResults() {
    let totalMatches = 0;
    let currentMatchOrdinal = 0;
    let activePaneWithMatch;
    const paneBreakdown = {};
    for (const [id, res] of this.paneResults.entries()) {
      paneBreakdown[id] = { activeMatch: res.activeMatch, total: res.total };
      totalMatches += res.total;
      if (res.activeMatch > 0) {
        currentMatchOrdinal = res.activeMatch;
        activePaneWithMatch = id;
      }
    }
    if (totalMatches > 0 && currentMatchOrdinal === 0) {
      currentMatchOrdinal = 1;
    }
    return {
      totalMatches,
      currentMatchOrdinal,
      paneBreakdown,
      activePaneId: activePaneWithMatch
    };
  }
  stopFind(panes2, action = "clearSelection") {
    this.activeQuery = "";
    this.paneResults.clear();
    for (const [, wc] of panes2.entries()) {
      if (!wc.isDestroyed()) {
        wc.stopFindInPage(action);
      }
    }
  }
}
const multiPaneSearch = new MultiPaneSearchCoordinator();
class PaneWarmSleepService {
  suspendedPanes = /* @__PURE__ */ new Set();
  suspendPaneView(win, paneId, view) {
    if (this.suspendedPanes.has(paneId)) return false;
    try {
      win.contentView.removeChildView(view);
      this.suspendedPanes.add(paneId);
      return true;
    } catch {
      return false;
    }
  }
  resumePaneView(win, paneId, view, insertIndex = 0) {
    if (!this.suspendedPanes.has(paneId)) return false;
    try {
      win.contentView.addChildView(view, insertIndex);
      this.suspendedPanes.delete(paneId);
      return true;
    } catch {
      return false;
    }
  }
  isPaneSuspended(paneId) {
    return this.suspendedPanes.has(paneId);
  }
  async getPaneMemoryMetrics(panes2) {
    const stats = [];
    for (const [paneId, view] of panes2.entries()) {
      if (view.webContents.isDestroyed()) continue;
      stats.push({
        paneId,
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
        isWarmSuspended: this.suspendedPanes.has(paneId)
      });
    }
    return stats;
  }
}
const warmSleepService = new PaneWarmSleepService();
const DEVICE_CONFIGS = {
  iphone_16_pro: {
    width: 393,
    height: 852,
    scale: 1,
    mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  },
  ipad_air: {
    width: 820,
    height: 1180,
    scale: 1,
    mobile: true,
    ua: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  },
  pixel_9: {
    width: 412,
    height: 924,
    scale: 1,
    mobile: true,
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
  }
};
async function setPaneDeviceEmulation(wc, device, orientation = "portrait", scale = 1) {
  if (wc.isDestroyed()) return { success: false, error: "WebContents destroyed" };
  const dbg = wc.debugger;
  try {
    if (!dbg.isAttached()) {
      dbg.attach("1.3");
    }
    if (device === "reset") {
      await dbg.sendCommand("Emulation.clearDeviceMetricsOverride").catch(() => {
      });
      await dbg.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {
      });
      await dbg.sendCommand("Network.setUserAgentOverride", { userAgent: "" }).catch(() => {
      });
      try {
        wc.invalidate?.();
      } catch {
      }
      return { success: true };
    }
    const cfg = DEVICE_CONFIGS[device];
    if (!cfg) return { success: false, error: "Unknown device type" };
    const isLandscape = orientation === "landscape";
    const width = isLandscape ? cfg.height : cfg.width;
    const height = isLandscape ? cfg.width : cfg.height;
    await dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: cfg.scale,
      mobile: cfg.mobile,
      scale: scale > 0 ? scale : 1,
      screenOrientation: isLandscape ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 }
    });
    await dbg.sendCommand("Emulation.setTouchEmulationEnabled", {
      enabled: cfg.mobile,
      maxTouchPoints: 5
    }).catch(() => {
    });
    await dbg.sendCommand("Network.setUserAgentOverride", {
      userAgent: cfg.ua
    });
    try {
      wc.invalidate?.();
    } catch {
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}
const THROTTLE_PROFILES = {
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  slow_3g: {
    offline: false,
    latency: 400,
    downloadThroughput: 400 * 1024 / 8,
    uploadThroughput: 400 * 1024 / 8
  },
  fast_3g: {
    offline: false,
    latency: 150,
    downloadThroughput: 1.6 * 1024 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8
  },
  fast_4g: {
    offline: false,
    latency: 20,
    downloadThroughput: 20 * 1024 * 1024 / 8,
    uploadThroughput: 10 * 1024 * 1024 / 8
  }
};
async function setPaneNetworkThrottling(wc, profile) {
  if (wc.isDestroyed()) return { success: false, error: "WebContents destroyed" };
  const dbg = wc.debugger;
  try {
    if (!dbg.isAttached()) {
      dbg.attach("1.3");
    }
    await dbg.sendCommand("Network.enable");
    if (profile === "reset") {
      await dbg.sendCommand("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1
      });
      return { success: true };
    }
    const cfg = THROTTLE_PROFILES[profile];
    if (!cfg) return { success: false, error: "Unknown profile" };
    await dbg.sendCommand("Network.emulateNetworkConditions", cfg);
    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}
async function extractPaneReaderContent(wc) {
  if (wc.isDestroyed()) return { success: false, error: "WebContents destroyed" };
  try {
    const script = `
      (() => {
        try {
          const doc = document.cloneNode(true);
          const removeSelectors = [
            "script", "style", "noscript", "iframe", "button", "input", "form",
            "select", "textarea", "header", "footer", "nav", "aside", "dialog",
            "menu", "canvas", "video", "audio", "embed", "object", "svg",
            "[role='button']", "[role='dialog']", "[role='banner']", "[role='navigation']",
            "[role='complementary']", "[aria-hidden='true']",
            ".advertisement", ".ad", ".adsbygoogle", "[class*='sponsored']",
            ".cookie-banner", "#cookie-banner", "[id*='cookie']",
            ".popup", ".modal", ".overlay",
            ".newsletter-signup", "[class*='newsletter']", "[class*='subscribe']",
            ".interactive-demo", "[class*='interactive']", "[class*='demo']",
            ".pricing-table", "[class*='pricing']", "[id*='pricing']",
            ".cta", "[class*='cta-']", "[class*='call-to-action']",
            "[class*='social-share']", "[class*='share-bar']", "[class*='share-button']"
          ];
          removeSelectors.forEach(sel => {
            doc.querySelectorAll(sel).forEach(el => el.remove());
          });

          // Strip download buttons and CTA marketing links
          const ctaRegex = /download|subscribe|sign up|join waitlist|claim|lifetime|buy now|get started|\\$\\d+/i;
          doc.querySelectorAll("a").forEach(a => {
            const txt = (a.innerText || "").trim();
            if (!txt || ctaRegex.test(txt) || a.classList.contains("button") || a.getAttribute("role") === "button") {
              a.remove();
            }
          });

          const title = (document.querySelector("h1")?.innerText || document.title || "").trim();
          const byline = (document.querySelector("meta[name='author']")?.getAttribute("content") ||
                         document.querySelector(".byline, [rel='author'], [itemprop='author']")?.innerText ||
                         new URL(window.location.href).hostname || "").trim();
          
          const candidate = doc.querySelector("article, [role='article'], .post-content, .entry-content, .article-body, #article-body, .prose");
          const root = candidate || doc.querySelector("main, [role='main']") || doc.body;

          // Universal Semantic Block Distillation: Extract pure headings, prose, lists, quotes & code
          const blocks = [];
          const seen = new Set();
          const allowed = "h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, table";
          
          root.querySelectorAll(allowed).forEach(el => {
            const text = (el.innerText || "").trim();
            if (!text || seen.has(text)) return;
            if (text.toLowerCase() === title.toLowerCase()) return;
            if (ctaRegex.test(text) && text.length < 50) return;
            seen.add(text);

            const tag = el.tagName.toLowerCase();
            if (tag.startsWith("h")) {
              const hLevel = tag === "h1" ? "h2" : tag;
              blocks.push(\`<\${hLevel}>\${text}</\${hLevel}>\`);
            } else if (tag === "blockquote" || tag === "pre") {
              blocks.push(\`<\${tag}>\${text}</\${tag}>\`);
            } else if (tag === "ul" || tag === "ol") {
              const items = Array.from(el.querySelectorAll("li"))
                .map(li => {
                  const t = (li.innerText || "").trim();
                  return t && !ctaRegex.test(t) ? \`<li>\${t}</li>\` : "";
                })
                .filter(Boolean)
                .join("");
              if (items) blocks.push(\`<\${tag}>\${items}</\${tag}>\`);
            } else if (tag === "p" && text.length >= 15) {
              blocks.push(\`<p>\${text}</p>\`);
            } else if (tag === "table") {
              const tableText = el.innerText || "";
              if (tableText.trim().length > 20) {
                const cleanTable = el.cloneNode(true);
                cleanTable.querySelectorAll("*").forEach(c => {
                  c.removeAttribute("class");
                  c.removeAttribute("style");
                  c.removeAttribute("id");
                });
                blocks.push(cleanTable.outerHTML);
              }
            }
          });

          let htmlOutput = blocks.join("\\n");
          if (!htmlOutput.trim()) {
            // Fallback for minimal pages: extract all visible text blocks from body
            const fallbackParas = Array.from(doc.body.querySelectorAll("div, section, p"))
              .map(el => (el.innerText || "").trim())
              .filter(t => t.length > 25 && !seen.has(t) && !ctaRegex.test(t))
              .slice(0, 15);
            htmlOutput = fallbackParas.map(p => \`<p>\${p}</p>\`).join("\\n");
          }

          const wrap = document.createElement("div");
          wrap.innerHTML = htmlOutput || \`<p>Distilled content from \${title || window.location.hostname}</p>\`;

          // Strip duplicate first heading if it matches title
          const firstH = wrap.querySelector("h1, h2");
          if (firstH && title && (firstH.innerText || "").trim().toLowerCase() === title.toLowerCase()) {
            firstH.remove();
          }

          const rawText = (wrap.innerText || "").trim();
          const words = rawText.split(/\\s+/).filter(Boolean).length;
          const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));

          return {
            title: title || document.title || "Untitled Document",
            byline,
            excerpt: rawText.slice(0, 180).trim() + "...",
            contentHtml: wrap.innerHTML,
            readingTimeMinutes,
            url: window.location.href,
            isArticle: true,
          };
        } catch (e) {
          return null;
        }
      })();
    `;
    const article = await wc.executeJavaScript(script, true);
    if (!article) return { success: false, error: "Could not extract article content" };
    return { success: true, article };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}
async function pickColorFromPane(wc, x, y) {
  if (wc.isDestroyed()) return { success: false, error: "WebContents destroyed" };
  try {
    const img = await wc.capturePage({
      x: Math.max(0, Math.floor(x)),
      y: Math.max(0, Math.floor(y)),
      width: 1,
      height: 1
    });
    const bitmap = img.toBitmap();
    if (bitmap.length < 4) {
      return { success: false, error: "Empty pixel buffer" };
    }
    const b = bitmap[0];
    const g = bitmap[1];
    const r = bitmap[2];
    const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();
    const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    electron.clipboard.writeText(hex);
    return {
      success: true,
      hex,
      rgb: { r, g, b }
    };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}
function initPaneSuperpowerIpc(panes2, getWindow) {
  electron.ipcMain.handle(IPC_CHANNELS.VIEW.CAPTURE_FULL_PAGE, async (_e, paneId) => {
    const view = panes2.get(paneId);
    if (!view) return { success: false, error: "Pane not found" };
    return captureWebContentsCdp(view.webContents, { fullPage: true, copyToClipboard: true });
  });
  electron.ipcMain.handle(IPC_CHANNELS.VIEW.CAPTURE_VIEWPORT, async (_e, paneId) => {
    const view = panes2.get(paneId);
    if (!view) return { success: false, error: "Pane not found" };
    return captureWebContentsCdp(view.webContents, { fullPage: false, copyToClipboard: true });
  });
  electron.ipcMain.on(IPC_CHANNELS.SEARCH.FIND_IN_ALL_PANES, (_e, query, opts) => {
    const wcMap = /* @__PURE__ */ new Map();
    for (const [id, view] of panes2.entries()) wcMap.set(id, view.webContents);
    multiPaneSearch.findInPanes(wcMap, query, opts);
  });
  electron.ipcMain.on(IPC_CHANNELS.SEARCH.STOP_FIND, (_e, action) => {
    const wcMap = /* @__PURE__ */ new Map();
    for (const [id, view] of panes2.entries()) wcMap.set(id, view.webContents);
    multiPaneSearch.stopFind(wcMap, action);
  });
  electron.ipcMain.handle(IPC_CHANNELS.MEMORY.GET_STATS, async () => warmSleepService.getPaneMemoryMetrics(panes2));
  electron.ipcMain.handle(IPC_CHANNELS.MEMORY.SUSPEND_PANE, async (_e, paneId) => {
    const win = getWindow();
    const view = panes2.get(paneId);
    return win && view ? warmSleepService.suspendPaneView(win, paneId, view) : false;
  });
  electron.ipcMain.handle(IPC_CHANNELS.MEMORY.RESUME_PANE, async (_e, paneId) => {
    const win = getWindow();
    const view = panes2.get(paneId);
    return win && view ? warmSleepService.resumePaneView(win, paneId, view) : false;
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.VIEW.SET_DEVICE_EMULATION,
    async (_e, paneId, dev, orientation, scale) => {
      const view = panes2.get(paneId);
      return view ? setPaneDeviceEmulation(view.webContents, dev, orientation, scale) : { success: false, error: "Pane not found" };
    }
  );
  electron.ipcMain.handle(IPC_CHANNELS.VIEW.SET_NETWORK_THROTTLE, async (_e, paneId, prof) => {
    const view = panes2.get(paneId);
    return view ? setPaneNetworkThrottling(view.webContents, prof) : { success: false, error: "Pane not found" };
  });
  electron.ipcMain.handle(IPC_CHANNELS.VIEW.EXTRACT_READER_MODE, async (_e, paneId) => {
    const view = panes2.get(paneId);
    return view ? extractPaneReaderContent(view.webContents) : { success: false, error: "Pane not found" };
  });
  electron.ipcMain.handle(IPC_CHANNELS.VIEW.PICK_COLOR, async (_e, paneId, x, y) => {
    const view = panes2.get(paneId);
    return view ? pickColorFromPane(view.webContents, x, y) : { success: false, error: "Pane not found" };
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.VIEW.COPY_IMAGE,
    async (_e, paneId, x, y, srcURL) => {
      const view = panes2.get(paneId);
      if (view && typeof x === "number" && typeof y === "number" && x >= 0 && y >= 0) {
        try {
          view.webContents.copyImageAt(Math.floor(x), Math.floor(y));
          return { success: true };
        } catch {
        }
      }
      if (srcURL && srcURL.startsWith("data:image/")) {
        try {
          const base64 = srcURL.split(",")[1];
          if (base64) {
            const buf = Buffer.from(base64, "base64");
            const ok = await writeImageToClipboard(buf, srcURL);
            if (ok) return { success: true };
          }
        } catch (err) {
          console.warn("Failed to write data URL to clipboard:", err);
        }
      }
      if (srcURL && (srcURL.startsWith("http://") || srcURL.startsWith("https://"))) {
        try {
          const netClient = view?.webContents.session?.net || getSafeNet();
          if (netClient) {
            const res = await netClient.fetch(srcURL);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              const ok = await writeImageToClipboard(buf);
              if (ok) return { success: true };
            }
          }
        } catch (err) {
          return { success: false, error: err?.message || "Failed to download image" };
        }
      }
      return { success: false, error: "Unable to copy image" };
    }
  );
  electron.ipcMain.on("pane.notification-posted", (e, data) => {
    const senderWc = e.sender;
    const title2 = senderWc?.getTitle() || "App";
    global.appOverlayView?.webContents.send("pane.notification-posted", {
      appId: data.appId || "comm_app",
      appName: data.appName || title2.split(" - ")[0] || "Message",
      title: data.title || "New Notification",
      snippet: data.body || data.snippet || ""
    });
  });
  electron.ipcMain.handle("view.getSearchSuggestions", async (_e, query) => {
    if (!query || query.trim().length < 2) return [];
    try {
      const res = await fetch(
        `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query.trim())}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data[1]) ? data[1].slice(0, 5) : [];
    } catch {
      return [];
    }
  });
}
const configuredSessions = /* @__PURE__ */ new WeakSet();
function configureWebAuthnForSession(sess) {
  if (!sess || configuredSessions.has(sess)) return;
  configuredSessions.add(sess);
  sess.setDevicePermissionHandler(() => false);
  const selectHidHandler = (event, _details, callback) => {
    event.preventDefault();
    callback(void 0);
  };
  const selectAccountHandler = (event, _details, callback) => {
    event.preventDefault();
    callback(null);
  };
  sess.on("select-hid-device", selectHidHandler);
  sess.on("select-webauthn-account", selectAccountHandler);
}
const AUTH_SURFACE_URL = "https://accounts.google.com";
async function purgeGoogleAuthCookies(profileId) {
  try {
    const partition = profileId === "main" ? "persist:main" : `persist:${profileId}`;
    const ses = electron.session.fromPartition(partition);
    const stale = await ses.cookies.get({ url: AUTH_SURFACE_URL });
    await Promise.all(
      stale.map(
        (c) => typeof c.domain === "string" ? ses.cookies.remove(
          `https://${c.domain.replace(/^\./, "")}`,
          c.name
        ) : Promise.resolve()
      )
    );
  } catch {
  }
}
function extractUnreadBadgeFromTitle(title2) {
  if (!title2 || typeof title2 !== "string") {
    return { count: 0, hasUnread: false, rawTitle: "" };
  }
  const clean = title2.trim();
  const parenMatch = clean.match(/[\(\[]([0-9]+|\+?[0-9]+\+?)[\)\]]/);
  if (parenMatch && parenMatch[1]) {
    const num = parseInt(parenMatch[1].replace(/[^0-9]/g, ""), 10);
    return {
      count: isNaN(num) ? 1 : num,
      hasUnread: true,
      rawTitle: clean
    };
  }
  if (clean.startsWith("*") || clean.startsWith("•") || clean.startsWith("●")) {
    return {
      count: 1,
      hasUnread: true,
      rawTitle: clean
    };
  }
  const wordMatch = clean.match(/([0-9]+)\s+(unread|new|notifications?)/i);
  if (wordMatch && wordMatch[1]) {
    const num = parseInt(wordMatch[1], 10);
    return {
      count: isNaN(num) ? 1 : num,
      hasUnread: true,
      rawTitle: clean
    };
  }
  return { count: 0, hasUnread: false, rawTitle: clean };
}
function handleBeforeInputEvent(webContents, event, input) {
  if (input.type !== "keyDown" && input.type !== "keyUp") return;
  const ov = global.appOverlayView?.webContents;
  if (!ov || ov.isDestroyed()) return;
  if (webContents.id === ov.id) {
    return;
  }
  const isMod = Boolean(input.control || input.meta);
  const keyLower = input.key ? input.key.toLowerCase() : "";
  const isArrow = input.key === "ArrowLeft" || input.key === "ArrowRight" || input.key === "ArrowUp" || input.key === "ArrowDown";
  const isReload = isMod && keyLower === "r" || input.key === "F5";
  const isNum = keyLower >= "0" && keyLower <= "9";
  const isZoom = isMod && (input.key === "=" || input.key === "+" || input.key === "-" || input.key === "0");
  const isTabJump = isMod && input.key === "Tab" || input.control && input.key === "Tab";
  const isAppShortcut = input.alt && isArrow || isMod && isArrow || isMod && (keyLower === "w" || keyLower === "t" || keyLower === "k" || keyLower === "l" || keyLower === "d" || keyLower === "f" || keyLower === "p" || keyLower === "n" || keyLower === "m" || keyLower === "e" || keyLower === "i" || keyLower === "[" || keyLower === "]" || keyLower === "\\" || keyLower === "/") || input.alt && (keyLower === "d" || keyLower === "f" || keyLower === "p" || keyLower === "i" || input.code === "Space") || input.alt && (keyLower === "d" || keyLower === "f" || keyLower === "p" || input.code === "Space") || isMod && isNum || input.alt && isNum || isZoom || isTabJump || input.key === "F11" || input.key === "F12" || isReload;
  if (isAppShortcut) {
    event.preventDefault();
  }
  if (input.type === "keyDown" && isReload && webContents.id !== ov.id) {
    if (input.shift) {
      webContents.reloadIgnoringCache();
    } else {
      webContents.reload();
    }
    ov.send("pane.reloaded-wc", webContents.id);
    return;
  }
  const sharedId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
  const payload = {
    webContentsId: webContents.id,
    type: input.type === "keyUp" ? "keyup" : "keydown",
    key: input.key,
    code: input.code,
    control: input.control,
    meta: input.meta,
    shift: input.shift,
    alt: input.alt,
    isAutoRepeat: input.isAutoRepeat,
    isInputFocused: false,
    eventId: sharedId
  };
  if (input.type === "keyDown" && isMod && (keyLower === "f" || keyLower === "k" || keyLower === "l")) {
    ov.focus();
  }
  ov.send("forwarded-key", payload);
}
const OAUTH_DOMAINS = [
  "accounts.google.com",
  "google.com/gsi",
  "firebaseapp.com",
  "github.com/login/oauth",
  "login.microsoftonline.com",
  "appleid.apple.com",
  "discord.com/oauth2",
  "twitter.com/i/oauth2",
  "x.com/i/oauth2",
  "auth0.com",
  "okta.com",
  "id.atlassian.com"
];
const SSO_KEYWORDS = ["login", "signin", "auth", "sso", "oauth"];
const SYSTEM_PROTOCOLS$1 = ["mailto:", "tel:", "slack:", "zoommtg:", "magnet:", "viber:", "tg:"];
function isOAuthOrAuthEndpoint(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return OAUTH_DOMAINS.some((domain) => lower.includes(domain)) || SSO_KEYWORDS.some((kw) => lower.includes(kw));
}
function isGoogleOAuthEndpoint(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes("accounts.google.com") || lower.includes("google.com/gsi") || lower.includes("firebaseapp.com");
}
function evaluateWindowOpenRequest(url, disposition, features) {
  const urlLower = (url || "").toLowerCase();
  const isBlank = urlLower === "about:blank" || urlLower === "about:blank#blocked";
  const isPopup = Boolean(features) && (features.includes("width=") || features.includes("height="));
  const isGoogle = isGoogleOAuthEndpoint(urlLower);
  const isSSO = isOAuthOrAuthEndpoint(urlLower);
  if (SYSTEM_PROTOCOLS$1.some((proto) => urlLower.startsWith(proto))) {
    return {
      type: "OPEN_SYSTEM_BROWSER",
      url
    };
  }
  if (isGoogle || isSSO || isPopup || isBlank) {
    return {
      type: "ALLOW_OAUTH_POPUP",
      width: 600,
      height: 720,
      autoHideMenuBar: true,
      sandbox: true,
      contextIsolation: false,
      isGoogle
    };
  }
  return {
    type: "OPEN_IN_APP",
    url
  };
}
function generateCodeVerifier(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}
function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
function generatePkcePair() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256"
  };
}
function createSignedState(payload, secret) {
  const json = JSON.stringify({ ...payload, ts: Date.now() });
  const data = Buffer.from(json).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}
function verifySignedState(state, secret) {
  if (!state || !state.includes(".")) return null;
  const [data, signature] = state.split(".");
  const expectedSig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  if (signature !== expectedSig) return null;
  try {
    const json = Buffer.from(data, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}
function parseProxyString(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const uriMatch = trimmed.match(/^([a-zA-Z0-9]+):\/\/(?:([^:]+)(?::([^@]+))?@)?([^:/]+)(?::(\d+))?$/);
  if (uriMatch) {
    const rawProto = uriMatch[1].toLowerCase();
    const proto = isSupportedProtocol(rawProto) ? rawProto : "http";
    const user = uriMatch[2] ? decodeURIComponent(uriMatch[2]) : void 0;
    const pass = uriMatch[3] ? decodeURIComponent(uriMatch[3]) : void 0;
    const host = uriMatch[4].trim();
    const port = uriMatch[5] ? parseInt(uriMatch[5], 10) : defaultPortForProtocol(proto);
    if (!host || isNaN(port) || port <= 0 || port > 65535) return null;
    return {
      protocol: proto,
      host,
      port,
      credentials: user ? { username: user, password: pass } : void 0,
      chromiumProxyRules: `${proto}://${host}:${port}`
    };
  }
  const vendorParts = trimmed.split(":");
  if (vendorParts.length === 4) {
    const [host, portStr, user, pass] = vendorParts;
    const port = parseInt(portStr, 10);
    if (host && !isNaN(port) && port > 0 && port <= 65535 && user) {
      return {
        protocol: "http",
        host: host.trim(),
        port,
        credentials: { username: user.trim(), password: pass ? pass.trim() : "" },
        chromiumProxyRules: `http://${host.trim()}:${port}`
      };
    }
  }
  const userPassAtHostMatch = trimmed.match(/^(?:([^:]+)(?::([^@]+))?@)?([^:/]+):(\d+)$/);
  if (userPassAtHostMatch) {
    const user = userPassAtHostMatch[1] ? decodeURIComponent(userPassAtHostMatch[1]) : void 0;
    const pass = userPassAtHostMatch[2] ? decodeURIComponent(userPassAtHostMatch[2]) : void 0;
    const host = userPassAtHostMatch[3].trim();
    const port = parseInt(userPassAtHostMatch[4], 10);
    if (host && !isNaN(port) && port > 0 && port <= 65535) {
      return {
        protocol: "http",
        host,
        port,
        credentials: user ? { username: user, password: pass } : void 0,
        chromiumProxyRules: `http://${host}:${port}`
      };
    }
  }
  return null;
}
function isSupportedProtocol(proto) {
  return proto === "http" || proto === "https" || proto === "socks4" || proto === "socks5";
}
function defaultPortForProtocol(proto) {
  switch (proto) {
    case "http":
      return 8080;
    case "https":
      return 443;
    case "socks4":
    case "socks5":
      return 1080;
  }
}
class ProxyCredentialBroker {
  static instance;
  partitionMap = /* @__PURE__ */ new Map();
  hostPortMap = /* @__PURE__ */ new Map();
  authAttempts = /* @__PURE__ */ new Map();
  initialized = false;
  static getInstance() {
    if (!this.instance) this.instance = new ProxyCredentialBroker();
    return this.instance;
  }
  init(app) {
    if (this.initialized) return;
    this.initialized = true;
    app.on("login", (event, webContents, _request, authInfo, callback) => {
      if (!authInfo.isProxy) return;
      const key = `${authInfo.host.toLowerCase()}:${authInfo.port}`;
      const matchedProxy = this.findProxyForRequest(webContents, authInfo);
      if (matchedProxy && matchedProxy.credentials) {
        if (this.isRateLimited(key)) {
          logger$6.warn(`[ProxyCredentialBroker] Authentication rate-limited for ${key} to prevent freeze.`);
          callback("", "");
          return;
        }
        event.preventDefault();
        logger$6.debug(`[ProxyCredentialBroker] Dispatched credentials for proxy ${key} (${matchedProxy.credentials.username})`);
        callback(matchedProxy.credentials.username, matchedProxy.credentials.password || "");
      } else {
        logger$6.debug(`[ProxyCredentialBroker] No registered credentials for proxy challenge on ${key}`);
      }
    });
  }
  registerProxy(partition, input) {
    const parsed = typeof input === "string" ? parseProxyString(input) : input;
    if (!parsed) {
      this.removeProxy(partition);
      return null;
    }
    this.partitionMap.set(partition, parsed);
    const hostPortKey = `${parsed.host.toLowerCase()}:${parsed.port}`;
    this.hostPortMap.set(hostPortKey, parsed);
    return parsed;
  }
  removeProxy(partition) {
    const existing = this.partitionMap.get(partition);
    if (existing) {
      this.partitionMap.delete(partition);
      const hostPortKey = `${existing.host.toLowerCase()}:${existing.port}`;
      this.hostPortMap.delete(hostPortKey);
    }
  }
  getProxyForPartition(partition) {
    return this.partitionMap.get(partition) || null;
  }
  findProxyForRequest(_webContents, authInfo) {
    const hostPortKey = `${authInfo.host.toLowerCase()}:${authInfo.port}`;
    return this.hostPortMap.get(hostPortKey) || null;
  }
  isRateLimited(key) {
    const now = Date.now();
    const record = this.authAttempts.get(key) || { count: 0, lastAttempt: now };
    if (now - record.lastAttempt > 1e4) {
      record.count = 1;
      record.lastAttempt = now;
      this.authAttempts.set(key, record);
      return false;
    }
    record.count++;
    record.lastAttempt = now;
    this.authAttempts.set(key, record);
    return record.count > 5;
  }
}
const proxyCredentialBroker = ProxyCredentialBroker.getInstance();
class GeoTemporalHarmonizer {
  static instance;
  attachedWebContents = /* @__PURE__ */ new Set();
  geoCache = /* @__PURE__ */ new Map();
  static getInstance() {
    if (!this.instance) this.instance = new GeoTemporalHarmonizer();
    return this.instance;
  }
  /**
   * Harmonizes WebContents with target geo, timezone, and stealth scripts via native CDP.
   * Invariant INV-PRX-03: Debugger attachment failures must never crash or block pane loading.
   */
  async harmonizeWebContents(webContents, geo, customUserAgent) {
    if (webContents.isDestroyed()) return;
    const wcId = webContents.id;
    try {
      if (!webContents.debugger.isAttached()) {
        webContents.debugger.attach("1.3");
        this.attachedWebContents.add(wcId);
        webContents.on("destroyed", () => {
          this.attachedWebContents.delete(wcId);
        });
      }
      await webContents.debugger.sendCommand("Page.enable").catch(() => {
      });
      const geoInjection = geo ? `window.__apposition_geo__ = ${JSON.stringify(geo)};` : "";
      await webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: `${geoInjection}
${ANTI_DETECTION_SCRIPT}`
      }).catch(() => {
      });
      if (geo?.timezone) {
        await webContents.debugger.sendCommand("Emulation.setTimezoneOverride", {
          timezoneId: geo.timezone
        }).catch((err) => {
          logger$6.debug(`[GeoTemporalHarmonizer] Failed to set timezone ${geo.timezone}:`, err);
        });
      }
      if (geo && typeof geo.latitude === "number" && typeof geo.longitude === "number") {
        await webContents.debugger.sendCommand("Emulation.setGeolocationOverride", {
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy: 100
        }).catch((err) => {
          logger$6.debug(`[GeoTemporalHarmonizer] Failed to set geolocation:`, err);
        });
      }
      if (customUserAgent || geo?.locale) {
        await webContents.debugger.sendCommand("Network.setUserAgentOverride", {
          userAgent: customUserAgent || webContents.getUserAgent(),
          acceptLanguage: geo?.locale || "en-US,en;q=0.9"
        }).catch(() => {
        });
      }
      logger$6.debug(`[GeoTemporalHarmonizer] Harmonized WebContents ${wcId} with timezone: ${geo?.timezone || "system"}`);
    } catch (err) {
      logger$6.debug(`[GeoTemporalHarmonizer] CDP Harmonization skipped for WebContents ${wcId}:`, err);
    }
  }
  cacheGeo(host, geo) {
    this.geoCache.set(host.toLowerCase(), geo);
  }
  getCachedGeo(host) {
    return this.geoCache.get(host.toLowerCase());
  }
  detach(webContents) {
    if (!webContents.isDestroyed() && webContents.debugger.isAttached()) {
      try {
        webContents.debugger.detach();
      } catch {
      }
    }
    this.attachedWebContents.delete(webContents.id);
  }
}
const geoTemporalHarmonizer = GeoTemporalHarmonizer.getInstance();
const HTTPS_DIAGNOSTIC_ENDPOINT = "https://ipwho.is/";
const HTTP_FALLBACK_ENDPOINT = "http://ip-api.com/json/?fields=status,message,country,countryCode,city,timezone,lat,lon,query,isp";
const DIAGNOSTIC_TIMEOUT_MS = 6e3;
async function testProxyConnection(rawProxy) {
  const parsed = parseProxyString(rawProxy);
  if (!parsed) {
    return {
      success: false,
      latencyMs: 0,
      error: "Invalid proxy format. Use protocol://[user:pass@]host:port or host:port:user:pass"
    };
  }
  const tempPartition = `ephemeral:proxy-diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ses = electron.session.fromPartition(tempPartition);
  try {
    proxyCredentialBroker.registerProxy(tempPartition, parsed);
    await ses.setProxy({
      proxyRules: parsed.chromiumProxyRules,
      proxyBypassRules: "<-loopback>"
    });
    const startTime = Date.now();
    let data = null;
    try {
      data = await executeDiagnosticRequest(ses, HTTPS_DIAGNOSTIC_ENDPOINT);
      if (data && data.success !== false) {
        const latencyMs2 = Date.now() - startTime;
        const geo = {
          ip: data.ip,
          country: data.country || "Unknown",
          countryCode: data.country_code || "UN",
          city: data.city || "",
          timezone: data.timezone?.id || "UTC",
          latitude: typeof data.latitude === "number" ? data.latitude : 0,
          longitude: typeof data.longitude === "number" ? data.longitude : 0,
          isp: data.connection?.isp || ""
        };
        geoTemporalHarmonizer.cacheGeo(parsed.host, geo);
        return {
          success: true,
          latencyMs: latencyMs2,
          exitIp: geo.ip,
          country: geo.country,
          countryCode: geo.countryCode,
          city: geo.city,
          timezone: geo.timezone
        };
      }
    } catch (httpsErr) {
      const errStr = httpsErr?.message || String(httpsErr);
      if (errStr.includes("CERT") || errStr.includes("certificate") || errStr.includes("SSL")) {
        return {
          success: false,
          latencyMs: Date.now() - startTime,
          error: "Proxy has an invalid or expired SSL certificate (HTTPS blocked)."
        };
      }
      data = await executeDiagnosticRequest(ses, HTTP_FALLBACK_ENDPOINT);
    }
    const latencyMs = Date.now() - startTime;
    if (data && (data.status === "success" || data.success !== false)) {
      const geo = {
        ip: data.query || data.ip,
        country: data.country || "Unknown",
        countryCode: data.countryCode || data.country_code || "UN",
        city: data.city || "",
        timezone: data.timezone || data.timezone?.id || "UTC",
        latitude: typeof data.lat === "number" ? data.lat : data.latitude || 0,
        longitude: typeof data.lon === "number" ? data.lon : data.longitude || 0,
        isp: data.isp || data.connection?.isp || ""
      };
      geoTemporalHarmonizer.cacheGeo(parsed.host, geo);
      return {
        success: true,
        latencyMs,
        exitIp: geo.ip,
        country: geo.country,
        countryCode: geo.countryCode,
        city: geo.city,
        timezone: geo.timezone
      };
    } else {
      return {
        success: false,
        latencyMs,
        error: data?.message || "Failed to retrieve exit IP telemetry"
      };
    }
  } catch (err) {
    const errorMsg = err?.message || String(err);
    logger$6.debug("[ProxyDiagnostics] Proxy test failed:", errorMsg);
    return {
      success: false,
      latencyMs: 0,
      error: formatFriendlyError(errorMsg)
    };
  } finally {
    proxyCredentialBroker.removeProxy(tempPartition);
    ses.clearCache().catch(() => {
    });
  }
}
function executeDiagnosticRequest(ses, endpoint) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const req = electron.net.request({
      url: endpoint,
      session: ses,
      method: "GET"
    });
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          req.abort();
        } catch {
        }
        reject(new Error("Connection timed out (exceeded 6000ms)"));
      }
    }, DIAGNOSTIC_TIMEOUT_MS);
    req.on("response", (response) => {
      let rawData = "";
      response.on("data", (chunk) => {
        rawData += chunk.toString("utf8");
      });
      response.on("end", () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(rawData);
          resolve(parsed);
        } catch {
          reject(new Error("Invalid JSON response from diagnostic service"));
        }
      });
      response.on("error", (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      });
    });
    req.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
    req.end();
  });
}
function formatFriendlyError(raw) {
  if (raw.includes("CERT_DATE_INVALID") || raw.includes("CERT_AUTHORITY_INVALID") || raw.includes("certificate has expired")) {
    return "Proxy SSL certificate is invalid or expired (HTTPS blocked).";
  }
  if (raw.includes("ERR_PROXY_AUTH_REQUESTED")) return "Authentication failed. Incorrect username or password.";
  if (raw.includes("ERR_PROXY_CONNECTION_FAILED") || raw.includes("ERR_SOCKS_CONNECTION_FAILED")) {
    return "Proxy connection failed. Host or port unreachable.";
  }
  if (raw.includes("timed out")) return "Connection timed out. Proxy is unreachable or too slow.";
  if (raw.includes("ERR_NAME_NOT_RESOLVED")) return "Proxy hostname could not be resolved.";
  return raw;
}
function initProxyIpc() {
  electron.ipcMain.handle("proxy.test-connection", async (_event, proxyString) => {
    if (!proxyString || !proxyString.trim()) {
      return {
        success: false,
        latencyMs: 0,
        error: "Proxy string is empty"
      };
    }
    const caps = getCurrentCapabilities();
    if (!caps.allowProxy) {
      return {
        success: false,
        latencyMs: 0,
        error: "Custom proxy routing requires Tier 3 or Pro license."
      };
    }
    return await testProxyConnection(proxyString.trim());
  });
  electron.ipcMain.handle("proxy.get-telemetry", (_event, host) => {
    if (!host) return null;
    return geoTemporalHarmonizer.getCachedGeo(host) || null;
  });
}
function configureSessionProxy(ses, proxyServer, partitionOrProfileId) {
  if (!proxyServer || !proxyServer.trim()) {
    proxyCredentialBroker.removeProxy(partitionOrProfileId);
    if (!partitionOrProfileId.startsWith("persist:")) {
      proxyCredentialBroker.removeProxy(`persist:${partitionOrProfileId}`);
    }
    ses.setProxy({}).catch(() => {
    });
    return;
  }
  const parsed = proxyCredentialBroker.registerProxy(partitionOrProfileId, proxyServer.trim());
  if (!partitionOrProfileId.startsWith("persist:")) {
    proxyCredentialBroker.registerProxy(`persist:${partitionOrProfileId}`, parsed);
  }
  if (parsed) {
    ses.setProxy({
      proxyRules: parsed.chromiumProxyRules,
      proxyBypassRules: "<-loopback>"
    }).catch((err) => {
      console.error(`Failed to configure proxy for ${partitionOrProfileId}:`, err);
    });
  } else {
    ses.setProxy({}).catch(() => {
    });
  }
}
const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const ITERATIONS = 1e5;
function encryptSessionPayload(payload, passphrase) {
  if (!passphrase || passphrase.length < 6) {
    throw new Error("Passphrase must be at least 6 characters long");
  }
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, "sha256");
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const jsonStr = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(jsonStr, "utf8"), cipher.final()]);
  const tag2 = cipher.getAuthTag();
  const bundle = {
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag2.toString("base64"),
    ciphertext: encrypted.toString("base64")
  };
  return JSON.stringify(bundle);
}
function decryptSessionPayload(bundleJson, passphrase) {
  let bundle;
  try {
    bundle = JSON.parse(bundleJson);
  } catch {
    throw new Error("Invalid session bundle format");
  }
  if (bundle.version !== 1 || !bundle.salt || !bundle.iv || !bundle.tag || !bundle.ciphertext) {
    throw new Error("Corrupted or unsupported session bundle");
  }
  const salt = Buffer.from(bundle.salt, "base64");
  const iv = Buffer.from(bundle.iv, "base64");
  const tag2 = Buffer.from(bundle.tag, "base64");
  const ciphertext = Buffer.from(bundle.ciphertext, "base64");
  const key = crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, "sha256");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag2);
  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    throw new Error("Decryption failed: Incorrect passphrase or corrupted data");
  }
}
const activeRelays = /* @__PURE__ */ new Map();
const RELAY_SECRET = "apposition-relay-secret-v1";
const TIMEOUT_MS = 3e5;
function startAuthRelay(targetAuthUrl, profileId = "main", paneId) {
  return new Promise((resolve) => {
    try {
      const pkce = generatePkcePair();
      const server2 = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${server2.address()}`);
          if (reqUrl.pathname === "/callback" || reqUrl.pathname === "/oauth/callback") {
            const state = reqUrl.searchParams.get("state");
            const code = reqUrl.searchParams.get("code");
            const token = reqUrl.searchParams.get("token") || reqUrl.searchParams.get("access_token");
            if (!state || !verifySignedState(state, RELAY_SECRET)) {
              res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
              res.end("<h3>Authentication Failed: Invalid or expired state token.</h3>");
              return;
            }
            const relay = activeRelays.get(state);
            if (relay) {
              const partition = relay.profileId === "main" ? "persist:main" : `persist:${relay.profileId}`;
              const targetSession = electron.session.fromPartition(partition);
              if (token) {
                try {
                  const targetOrigin = new URL(targetAuthUrl).origin;
                  await targetSession.cookies.set({
                    url: targetOrigin,
                    name: "auth_token",
                    value: token,
                    secure: true,
                    httpOnly: true
                  });
                } catch {
                }
              }
              if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
                global.appOverlayView.webContents.send("app.auth-completed", {
                  profileId: relay.profileId,
                  paneId: relay.paneId,
                  code,
                  token,
                  success: true
                });
              }
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end(`
                <!DOCTYPE html>
                <html>
                  <head>
                    <title>Authentication Successful</title>
                    <style>
                      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #FAF9F6; color: #121212; }
                      .card { background: white; padding: 32px 40px; border-radius: 12px; border: 1px solid #E5E5E0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: center; max-width: 380px; }
                      h2 { font-size: 18px; margin: 0 0 8px 0; font-weight: 600; }
                      p { font-size: 13px; color: #78716C; margin: 0; line-height: 1.5; }
                    </style>
                  </head>
                  <body>
                    <div class="card">
                      <h2>Authentication Completed</h2>
                      <p>You can close this tab and return to Apposition. Your workspace is now authenticated.</p>
                    </div>
                    <script>setTimeout(() => window.close(), 1500);<\/script>
                  </body>
                </html>
              `);
              cleanupRelay(state);
            }
          } else {
            res.writeHead(404);
            res.end();
          }
        } catch {
          res.writeHead(500);
          res.end();
        }
      });
      server2.listen(0, "127.0.0.1", () => {
        const address = server2.address();
        const port = typeof address === "object" && address ? address.port : 0;
        const state = createSignedState({ profileId, paneId, port }, RELAY_SECRET);
        const relaySession = {
          port,
          state,
          codeVerifier: pkce.codeVerifier,
          profileId,
          paneId,
          server: server2,
          createdAt: Date.now()
        };
        activeRelays.set(state, relaySession);
        setTimeout(() => cleanupRelay(state), TIMEOUT_MS);
        const parsedUrl = new URL(targetAuthUrl);
        parsedUrl.searchParams.set("redirect_uri", `http://127.0.0.1:${port}/callback`);
        parsedUrl.searchParams.set("state", state);
        parsedUrl.searchParams.set("code_challenge", pkce.codeChallenge);
        parsedUrl.searchParams.set("code_challenge_method", pkce.codeChallengeMethod);
        const finalAuthUrl = parsedUrl.toString();
        electron.shell.openExternal(finalAuthUrl);
        resolve({ success: true, port, authUrl: finalAuthUrl });
      });
      server2.on("error", (err) => {
        resolve({ success: false, port: 0, authUrl: "", error: err.message });
      });
    } catch (err) {
      resolve({ success: false, port: 0, authUrl: "", error: err.message });
    }
  });
}
function cleanupRelay(state) {
  const relay = activeRelays.get(state);
  if (relay) {
    activeRelays.delete(state);
    try {
      relay.server.close();
    } catch {
    }
  }
}
const SYSTEM_PROTOCOLS = [
  "mailto:",
  "tel:",
  "slack:",
  "zoommtg:",
  "magnet:",
  "viber:",
  "tg:"
];
function sendToOverlay(channel, ...args) {
  if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
    global.appOverlayView.webContents.send(channel, ...args);
    return true;
  }
  const mainWc = global.mainWindow?.webContents;
  if (mainWc && !mainWc.isDestroyed()) {
    mainWc.send(channel, ...args);
    return true;
  }
  return false;
}
function handleLinkOpenIntent(intent) {
  if (!intent.url || !intent.url.trim()) return;
  const urlLower = intent.url.trim().toLowerCase();
  if (SYSTEM_PROTOCOLS.some((proto) => urlLower.startsWith(proto))) {
    electron.shell.openExternal(intent.url).catch(() => {
    });
    return;
  }
  let sourcePaneId = intent.sourcePaneId;
  if (!sourcePaneId && intent.sourceWebContentsId) {
    sourcePaneId = viewRegistry.getPaneIdByWebContentsId(intent.sourceWebContentsId);
  }
  sendToOverlay("open-in-new-pane", {
    url: intent.url,
    sourcePaneId,
    disposition: intent.disposition || "split-or-tab",
    isBackground: intent.isBackground ?? false
  });
}
let isInitialized = false;
function initLinkIntentRouter() {
  if (isInitialized) return;
  isInitialized = true;
  electron.ipcMain.on(
    "pane:link-intent",
    (event, data) => {
      handleLinkOpenIntent({
        url: data.url,
        sourceWebContentsId: event.sender.id,
        disposition: data.disposition,
        isBackground: data.isBackground
      });
    }
  );
}
function handleWebContentsWindowOpen(webContents) {
  webContents.setWindowOpenHandler((details) => {
    const decision = evaluateWindowOpenRequest(
      details.url,
      details.disposition,
      details.features
    );
    if (decision.type === "SYSTEM_AUTH_RELAY") {
      startAuthRelay(details.url).catch(() => {
        electron.shell.openExternal(details.url);
      });
      return { action: "deny" };
    }
    if (decision.type === "ALLOW_OAUTH_POPUP") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: decision.width,
          height: decision.height,
          center: true,
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#fafaf9",
            symbolColor: "#121212",
            height: 36
          },
          backgroundColor: "#FFFFFF",
          show: true,
          icon: path.join(
            __dirname,
            process.platform === "linux" ? "../../assets/icon.png" : "../../assets/icon.ico"
          ),
          userAgent: isGoogleAuthUrl(details.url) ? FIREFOX_AUTH_UA : void 0,
          webPreferences: {
            // EXPERIMENT (uncommitted): document-start passkey suppression,
            // same main-world preload rationale as googleAuthModal.ts.
            preload: path.join(__dirname, "../preload/authGuard.js"),
            sandbox: true,
            contextIsolation: false
          }
        }
      };
    }
    if (decision.type === "NAVIGATE_CURRENT_PANE") {
      webContents.loadURL(decision.url);
      return { action: "deny" };
    }
    if (decision.type === "OPEN_IN_APP") {
      handleLinkOpenIntent({
        url: decision.url,
        sourceWebContentsId: webContents.id,
        disposition: details.disposition,
        isBackground: details.disposition === "background-tab"
      });
      return { action: "deny" };
    }
    if (decision.type === "OPEN_SYSTEM_BROWSER") {
      electron.shell.openExternal(decision.url);
      return { action: "deny" };
    }
    return { action: "deny" };
  });
}
function forwardGuestEvents(_win, paneId, view, partition) {
  const ov = () => global.appOverlayView?.webContents;
  const wc = view.webContents;
  const nav = (_e, navUrl) => {
    const currentUrl = navUrl || wc.getURL();
    if (currentUrl && currentUrl.includes("accounts.google.com/v3/signin/rejected")) {
      const pId = partition ? partition.replace(/^persist:/, "") : "main";
      purgeGoogleAuthCookies(pId).then(() => {
        if (!wc.isDestroyed()) wc.loadURL("https://accounts.google.com/");
      }).catch(() => {
      });
      return;
    }
    const title2 = wc.getTitle();
    hibernationEngine.updatePaneUrl(paneId, currentUrl, title2);
    const unread = extractUnreadBadgeFromTitle(title2);
    ov()?.send("pane.unread-badge", { paneId, ...unread });
    ov()?.send(IPC_CHANNELS.EVENTS.VIEW_NAVIGATED, {
      paneId,
      url: currentUrl,
      title: title2,
      canGoBack: wc.navigationHistory?.canGoBack?.() ?? false,
      canGoForward: wc.navigationHistory?.canGoForward?.() ?? false,
      activeIndex: wc.navigationHistory?.getActiveIndex?.() ?? 0,
      historyLength: wc.navigationHistory?.length?.() ?? 1
    });
  };
  wc.on("did-navigate", (_e, navUrl) => nav(_e, navUrl));
  wc.on("did-navigate-in-page", (_e, navUrl, isMainFrame) => {
    if (isMainFrame) {
      nav(_e, navUrl);
    }
  });
  wc.on("page-title-updated", (_e, title2) => {
    const t2 = title2 || wc.getTitle();
    hibernationEngine.updatePaneUrl(paneId, wc.getURL(), t2);
    const unread = extractUnreadBadgeFromTitle(t2);
    ov()?.send("pane.unread-badge", { paneId, ...unread });
    ov()?.send("app:semantic-title", { paneId, title: t2 });
  });
  wc.on("did-finish-load", () => {
    try {
      if (Math.abs(wc.getZoomFactor() - 1) > 1e-3) {
        wc.setZoomFactor(1);
      }
    } catch {
    }
    ov()?.send("pane.finish-load", { paneId, url: wc.getURL() });
  });
  wc.on("did-start-loading", () => ov()?.send("pane.load-start", { paneId }));
  wc.on("did-stop-loading", () => {
    try {
      if (Math.abs(wc.getZoomFactor() - 1) > 1e-3) {
        wc.setZoomFactor(1);
      }
    } catch {
    }
    ov()?.send("pane.loaded", { paneId, url: wc.getURL() });
  });
  wc.on("did-fail-load", (_e, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      ov()?.send("pane.load-error", { paneId, errorCode, errorDescription, url: validatedUrl });
    }
  });
  wc.on(
    "render-process-gone",
    (_e, d) => ov()?.send(IPC_CHANNELS.EVENTS.VIEW_CRASHED, { paneId, reason: d?.reason ?? "crashed", exitCode: d?.exitCode ?? 0 })
  );
  wc.on("audio-state-changed", (_e, audible) => {
    const isAudible = typeof audible === "boolean" ? audible : Boolean(audible?.audible);
    if (isAudible) {
      audioMatrix.handleAudioStarted(paneId, wc);
    } else {
      audioMatrix.handleAudioStopped(paneId);
    }
    ov()?.send(IPC_CHANNELS.EVENTS.VIEW_MEDIA_STATUS, { paneId, isPlaying: isAudible, isAudible });
  });
  wc.on("media-started-playing", () => {
    audioMatrix.handleAudioStarted(paneId, wc);
    ov()?.send(IPC_CHANNELS.EVENTS.VIEW_MEDIA_STATUS, { paneId, isPlaying: true, isAudible: true });
  });
  wc.on("media-paused", () => {
    audioMatrix.handleAudioStopped(paneId);
    ov()?.send(IPC_CHANNELS.EVENTS.VIEW_MEDIA_STATUS, { paneId, isPlaying: false, isAudible: false });
  });
  wc.on("did-first-visually-non-empty-paint", () => {
    const currentUrl = wc.getURL();
    ov()?.send(IPC_CHANNELS.EVENTS.PANE_FIRST_PAINT, { paneId, url: currentUrl });
    ov()?.send(IPC_CHANNELS.EVENTS.VIEW_LOADED, { paneId, url: currentUrl });
  });
  wc.on("context-menu", (_e, p) => {
    handleNativeContextMenuEvent(paneId, p);
  });
  wc.on("found-in-page", (_e, r) => {
    const agg = multiPaneSearch.handlePaneResult(paneId, r);
    ov()?.send("pane.found-in-page", {
      ...r,
      paneId,
      activePaneId: agg.activePaneId,
      activeMatchOrdinal: agg.currentMatchOrdinal,
      matches: agg.totalMatches,
      paneBreakdown: agg.paneBreakdown
    });
  });
  wc.on("before-input-event", (event, input) => handleBeforeInputEvent(wc, event, input));
  handleWebContentsWindowOpen(wc);
}
class ScreenCaptureService {
  pendingRequests = /* @__PURE__ */ new Map();
  hookedSessions = /* @__PURE__ */ new Set();
  hookSession(sess) {
    if (this.hookedSessions.has(sess)) return;
    this.hookedSessions.add(sess);
    sess.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await electron.desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 360, height: 200 },
          fetchWindowIcons: true
        });
        const requestId = `scr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const serialized = sources.map((s) => ({
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail.toDataURL(),
          isScreen: s.id.startsWith("screen:")
        }));
        const timer = setTimeout(() => {
          this.cancelRequest(requestId);
        }, 6e4);
        this.pendingRequests.set(requestId, { requestId, callback, timer });
        global.appOverlayView?.webContents.send("screen-share:request", {
          requestId,
          sources: serialized
        });
      } catch (err) {
        console.error("[ScreenCaptureService] Failed to get sources:", err);
        callback({});
      }
    });
  }
  async getAvailableSources() {
    const sources = await electron.desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 360, height: 200 },
      fetchWindowIcons: true
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      isScreen: s.id.startsWith("screen:")
    }));
  }
  async selectSource(requestId, sourceId) {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);
    if (!sourceId) {
      pending.callback({});
      return true;
    }
    try {
      const sources = await electron.desktopCapturer.getSources({
        types: ["screen", "window"]
      });
      const match = sources.find((s) => s.id === sourceId);
      if (match) {
        pending.callback({ video: match, audio: "loopback" });
        return true;
      }
    } catch {
    }
    pending.callback({});
    return false;
  }
  cancelRequest(requestId) {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      try {
        pending.callback({});
      } catch {
      }
    }
  }
  init() {
    this.hookSession(electron.session.defaultSession);
  }
}
const screenCaptureService = new ScreenCaptureService();
function safeDetachDebugger(target) {
  try {
    const wc = "webContents" in target ? target.webContents : target;
    const isDestroyed = typeof wc.isDestroyed === "function" ? wc.isDestroyed() : false;
    if (isDestroyed) return;
    const dbg = wc.debugger;
    if (dbg && typeof dbg.isAttached === "function" && dbg.isAttached()) {
      dbg.detach();
    }
  } catch {
  }
}
function safeAttachDebugger(wc, protocolVersion = "1.3") {
  if (wc.isDestroyed()) return void 0;
  const dbg = wc.debugger;
  if (!dbg.isAttached()) {
    try {
      dbg.attach(protocolVersion);
    } catch {
      return void 0;
    }
  }
  return dbg;
}
class GhostPool {
  state = createInitialGhostState(DEFAULT_MAX_DORMANT);
  destroyDelegate;
  bindDestroyDelegate(fn) {
    this.destroyDelegate = fn;
  }
  getState() {
    return this.state;
  }
  isDormant(paneId) {
    return this.state.dormantPaneIds.includes(paneId);
  }
  setPaneProtected(paneId, isProtected) {
    const [next, effects] = reduceGhostState(this.state, {
      type: "SET_PANE_PROTECTED",
      paneId,
      isProtected
    });
    this.state = next;
    this.runEffects(void 0, effects);
  }
  stashPane(win, paneId, url, isProtected) {
    const [next, effects] = reduceGhostState(this.state, {
      type: "STASH_DORMANT",
      paneId,
      url,
      isProtected
    });
    this.state = next;
    this.runEffects(win, effects);
  }
  wakePane(paneId) {
    if (!this.isDormant(paneId)) return;
    const [next, effects] = reduceGhostState(this.state, {
      type: "ACTIVATE_PANE",
      paneId
    });
    this.state = next;
    this.runEffects(void 0, effects);
  }
  evictPane(win, paneId) {
    const [next, effects] = reduceGhostState(this.state, {
      type: "EVICT_DORMANT",
      paneId
    });
    this.state = next;
    this.runEffects(win, effects);
  }
  purgeTimers = /* @__PURE__ */ new Map();
  async runEffects(win, effects) {
    for (const effect of effects) {
      switch (effect.type) {
        case "EXEC_STASH_VIEW": {
          if (win && !win.isDestroyed()) {
            hidePane(win, effect.paneId);
          }
          const existingTimer = this.purgeTimers.get(effect.paneId);
          if (existingTimer) clearTimeout(existingTimer);
          const timer = setTimeout(async () => {
            this.purgeTimers.delete(effect.paneId);
            const view = viewRegistry.getView(effect.paneId);
            if (view && !view.webContents.isDestroyed() && this.isDormant(effect.paneId)) {
              try {
                const dbg = safeAttachDebugger(view.webContents, "1.3");
                if (dbg) {
                  await dbg.sendCommand("Memory.forciblyPurgeJavaScriptMemory").catch(() => {
                  });
                  safeDetachDebugger(view);
                }
              } catch {
              }
              try {
                if (typeof process.trimWorkingSet === "function") {
                  process.trimWorkingSet();
                }
              } catch {
              }
            }
          }, 3e4);
          this.purgeTimers.set(effect.paneId, timer);
          break;
        }
        case "EXEC_WAKE_VIEW": {
          const pendingTimer = this.purgeTimers.get(effect.paneId);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            this.purgeTimers.delete(effect.paneId);
          }
          break;
        }
        case "EXEC_EVICT_VIEW": {
          const pendingTimer = this.purgeTimers.get(effect.paneId);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            this.purgeTimers.delete(effect.paneId);
          }
          if (win && this.destroyDelegate) {
            this.destroyDelegate(win, effect.paneId, true);
          }
          break;
        }
      }
    }
  }
}
const ghostPool = new GhostPool();
function initShadowStateIpc() {
  electron.ipcMain.on("vault:save-shadow-state", (event, snapshot) => {
    const paneId = viewRegistry.getPaneIdByWebContentsId(event.sender.id);
    if (!paneId || !snapshot) return;
    if (validateShadowSnapshot(snapshot)) {
      cryoVault.storeShadowState(paneId, snapshot);
    }
  });
  electron.ipcMain.handle("vault:get-shadow-state", (event) => {
    const paneId = viewRegistry.getPaneIdByWebContentsId(event.sender.id);
    if (!paneId) return null;
    return cryoVault.retrieveShadowState(paneId) ?? null;
  });
}
function findPreviousUniqueIndex(all, activeIdx) {
  const active = all[activeIdx];
  if (!active) return activeIdx - 1;
  for (let i = activeIdx - 1; i >= 0; i--) {
    if (all[i] && !isCanonicalSameUrl(all[i].url, active.url)) return i;
  }
  return -1;
}
function findNextUniqueIndex(all, activeIdx) {
  const active = all[activeIdx];
  if (!active) return activeIdx + 1;
  for (let i = activeIdx + 1; i < all.length; i++) {
    if (all[i] && !isCanonicalSameUrl(all[i].url, active.url)) return i;
  }
  return -1;
}
function findPaneIdBySender(panes2, senderId) {
  for (const [id, view] of panes2.entries()) {
    if (view.webContents.id === senderId) return id;
  }
  return void 0;
}
function registerPaneIpcHandlers(panes2) {
  electron.ipcMain.on(IPC_CHANNELS.VIEW.SET_AUDIO_MUTED, (_e, id, muted) => {
    panes2.get(id)?.webContents.setAudioMuted(muted);
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.RELOAD, (_e, id) => {
    panes2.get(id)?.webContents.reload();
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.GO_BACK, (_e, id) => {
    const v = panes2.get(id);
    if (!v || v.webContents.isDestroyed()) return;
    const nav = v.webContents.navigationHistory;
    if (nav && typeof nav.canGoBack === "function" && nav.canGoBack()) {
      const all = nav.getAllEntries();
      const targetIdx = findPreviousUniqueIndex(all, nav.getActiveIndex());
      if (targetIdx >= 0 && typeof nav.goToIndex === "function") {
        nav.goToIndex(targetIdx);
      } else {
        nav.goBack();
      }
    } else if (typeof v.webContents.canGoBack === "function" && v.webContents.canGoBack()) {
      v.webContents.goBack();
    }
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.GO_FORWARD, (_e, id) => {
    const v = panes2.get(id);
    if (!v || v.webContents.isDestroyed()) return;
    const nav = v.webContents.navigationHistory;
    if (nav && typeof nav.canGoForward === "function" && nav.canGoForward()) {
      const all = nav.getAllEntries();
      const targetIdx = findNextUniqueIndex(all, nav.getActiveIndex());
      if (targetIdx >= 0 && typeof nav.goToIndex === "function") {
        nav.goToIndex(targetIdx);
      } else {
        nav.goForward();
      }
    } else if (typeof v.webContents.canGoForward === "function" && v.webContents.canGoForward()) {
      v.webContents.goForward();
    }
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.GO_TO_INDEX, (_e, id, index) => {
    const v = panes2.get(id);
    if (v && !v.webContents.isDestroyed() && typeof index === "number") {
      const nav = v.webContents.navigationHistory;
      if (nav && typeof nav.goToIndex === "function") {
        nav.goToIndex(index);
      }
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.VIEW.GET_NAV_HISTORY, (_e, id) => {
    const v = panes2.get(id);
    if (!v || v.webContents.isDestroyed()) {
      const desc = cryoVault.retrieveDescriptor(id);
      if (desc?.navEntries && desc.navEntries.length > 0) {
        const activeIdx = desc.navActiveIndex ?? desc.navEntries.length - 1;
        return {
          activeIndex: activeIdx,
          entries: desc.navEntries.map((e, i) => ({ url: e.url, title: e.title || e.url, pageState: e.pageState, index: i })),
          canGoBack: activeIdx > 0,
          canGoForward: activeIdx < desc.navEntries.length - 1
        };
      }
      return null;
    }
    const nav = v.webContents.navigationHistory;
    if (!nav) return null;
    const activeIndex = nav.getActiveIndex();
    const len = nav.length();
    const all = typeof nav.getAllEntries === "function" ? nav.getAllEntries() : [];
    const entries = [];
    if (all && all.length > 0) {
      for (let i = 0; i < all.length; i++) {
        const entry = all[i];
        if (entry) entries.push({ url: entry.url, title: entry.title || entry.url, index: i });
      }
    } else {
      for (let i = 0; i < len; i++) {
        const entry = nav.getEntryAtIndex(i);
        if (entry) entries.push({ url: entry.url, title: entry.title || entry.url, index: i });
      }
    }
    return {
      activeIndex,
      entries,
      canGoBack: nav.canGoBack(),
      canGoForward: nav.canGoForward()
    };
  });
  electron.ipcMain.on("view.zoomIn", (_e, id) => {
    const v = panes2.get(id);
    if (v) v.webContents.setZoomLevel(v.webContents.getZoomLevel() + 0.5);
  });
  electron.ipcMain.on("view.zoomOut", (_e, id) => {
    const v = panes2.get(id);
    if (v) v.webContents.setZoomLevel(v.webContents.getZoomLevel() - 0.5);
  });
  electron.ipcMain.on("view.zoomReset", (_e, id) => {
    panes2.get(id)?.webContents.setZoomLevel(0);
  });
  electron.ipcMain.on("view.findInPage", (_e, id, text, opts) => {
    panes2.get(id)?.webContents.findInPage(text, opts);
  });
  electron.ipcMain.on("view.stopFindInPage", (_e, id, action) => {
    panes2.get(id)?.webContents.stopFindInPage(action);
  });
  electron.ipcMain.on("pane.media-timestamp", (e, p) => {
    const id = findPaneIdBySender(panes2, e.sender.id);
    if (id) {
      global.appOverlayView?.webContents.send("app:media-timestamp", { paneId: id, ...p });
    }
  });
  electron.ipcMain.on("pane.scroll-position", (e, p) => {
    const id = findPaneIdBySender(panes2, e.sender.id);
    if (id) {
      if (p?.scrollY !== void 0) hibernationEngine.updateScroll(id, p.scrollY);
      global.appOverlayView?.webContents.send("app:scroll-position", { paneId: id, ...p });
    }
  });
  electron.ipcMain.on("pane.focus-change", (e, f) => {
    const id = findPaneIdBySender(panes2, e.sender.id);
    if (id) {
      if (f) hibernationEngine.setActivePane(id);
      global.appOverlayView?.webContents.send("pane.focus-change", { paneId: id, isFocused: f });
    }
  });
  electron.ipcMain.on("pane.clicked", (e) => {
    const id = findPaneIdBySender(panes2, e.sender.id);
    if (id) {
      hibernationEngine.registerActivity(id);
      global.appOverlayView?.webContents.send("pane.clicked", id);
    }
  });
  electron.ipcMain.on("pane.semantic-title", (e, d) => {
    const id = findPaneIdBySender(panes2, e.sender.id);
    if (id && d?.title?.trim()) {
      global.appOverlayView?.webContents.send("app:semantic-title", {
        paneId: id,
        title: d.title.trim(),
        confidence: d.confidence ?? 1
      });
    }
  });
  electron.ipcMain.on("pane.dynamic-media-status", (e, p) => {
    const id = findPaneIdBySender(panes2, e.sender.id);
    if (id) {
      audioMatrix.handleDynamicStatus(id, p);
      global.appOverlayView?.webContents.send("app:dynamic-media-status", { paneId: id, ...p });
      global.appOverlayView?.webContents.send(IPC_CHANNELS.EVENTS.VIEW_MEDIA_STATUS, {
        paneId: id,
        isPlaying: Boolean(p.isPlaying),
        isAudible: Boolean(p.isAudible)
      });
    }
  });
}
const panes = /* @__PURE__ */ new Map();
function createPane(win, req) {
  const existing = panes.get(req.paneId);
  if (existing && !existing.webContents.isDestroyed()) {
    ghostPool.wakePane(req.paneId);
    hibernationEngine.setActivePane(req.paneId);
    hibernationEngine.registerActivity(req.paneId);
    viewRegistry.deleteHibernated(req.paneId);
    try {
      if (!existing.webContents.debugger.isAttached()) existing.webContents.debugger.attach("1.3");
      existing.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {
      });
    } catch {
    }
    existing.setVisible(true);
    if (isValidPhysicalRect(req.rect)) setPaneBounds(win, req.paneId, req.rect);
    existing.webContents.invalidate();
    global.appOverlayView?.webContents.send(IPC_CHANNELS.VIEW.REGISTER_WEB_CONTENTS, req.paneId, existing.webContents.id);
    FocusArbiter.handlePendingGuestFocus(win, req.paneId);
    return;
  }
  if (existing) destroyPane(win, req.paneId);
  const view = new electron.WebContentsView({
    webPreferences: {
      preload: resolvePreload("pane.js"),
      partition: req.partition,
      contextIsolation: true,
      sandbox: false,
      webgl: true,
      spellcheck: false,
      backgroundThrottling: true
    }
  });
  if (req.userAgent) view.webContents.setUserAgent(req.userAgent);
  try {
    view.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  } catch {
  }
  try {
    view.webContents.setZoomMode("isolated");
    view.webContents.setZoomFactor(1);
  } catch {
  }
  view.setBackgroundColor("#ffffff");
  if (typeof view.setBorderRadius === "function") view.setBorderRadius(12);
  view.webContents.session.setPermissionRequestHandler(
    (_, perm, cb) => cb(["clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(perm))
  );
  configureWebAuthnForSession(view.webContents.session);
  screenCaptureService.hookSession(view.webContents.session);
  try {
    if (!view.webContents.debugger.isAttached()) view.webContents.debugger.attach("1.3");
    view.webContents.debugger.sendCommand("Page.enable").catch(() => {
    });
    view.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {
    });
  } catch {
  }
  const pId = req.partition ? req.partition.replace(/^persist:/, "") : "";
  const profileObj = pId ? getProfileById(pId) : null;
  const proxyHost = profileObj?.proxy_server ? parseProxyString(profileObj.proxy_server)?.host : null;
  const cachedGeo = proxyHost ? geoTemporalHarmonizer.getCachedGeo(proxyHost) : void 0;
  geoTemporalHarmonizer.harmonizeWebContents(view.webContents, cachedGeo, req.userAgent || profileObj?.user_agent).catch(() => {
  });
  bindGuestCursor(view.webContents, req.paneId);
  forwardGuestEvents(win, req.paneId, view, req.partition);
  panes.set(req.paneId, view);
  viewRegistry.registerView(req.paneId, view, req.partition);
  audioMatrix.registerPane(req.paneId, view.webContents);
  let finalUrl = req.url;
  let navEntries = req.navEntries;
  let navActiveIndex = req.navActiveIndex;
  const desc = cryoVault.retrieveDescriptor(req.paneId);
  if (!finalUrl || finalUrl === "about:blank") {
    if (desc?.url && desc.url !== "about:blank") {
      finalUrl = desc.url;
    }
  }
  if ((!navEntries || navEntries.length === 0) && desc?.navEntries) {
    navEntries = desc.navEntries;
    navActiveIndex = desc.navActiveIndex ?? navActiveIndex;
  }
  hibernationEngine.registerPane(req.paneId, finalUrl, req.partition);
  hibernationEngine.registerActivity(req.paneId);
  viewRegistry.deleteHibernated(req.paneId);
  global.appOverlayView?.webContents.send(IPC_CHANNELS.VIEW.REGISTER_WEB_CONTENTS, req.paneId, view.webContents.id);
  const dpr = devicePixelRatioFor(win);
  const hasUrl = Boolean(finalUrl && finalUrl.trim().length > 0 && finalUrl !== "about:blank");
  const targetRect = hasUrl ? req.rect : { x: -1e4, y: -1e4, width: 100, height: 100 };
  const phys = toPhysicalRect(targetRect, dpr);
  placePane(win, req.paneId, view, { ...phys, cssLeft: targetRect.x, cssTop: targetRect.y });
  FocusArbiter.handlePendingGuestFocus(win, req.paneId);
  if (isValidPhysicalRect(targetRect)) view.setBounds(targetRect);
  if (navEntries && Array.isArray(navEntries) && navEntries.length > 0) {
    const targetIdx = navActiveIndex !== void 0 ? Math.max(0, Math.min(navActiveIndex, navEntries.length - 1)) : navEntries.length - 1;
    view.webContents.navigationHistory.restore({
      entries: navEntries,
      index: targetIdx
    }).catch(() => {
      if (hasUrl && finalUrl) view.webContents.loadURL(finalUrl);
    });
  } else if (hasUrl && finalUrl) {
    view.webContents.loadURL(finalUrl);
  }
}
function setPaneBounds(win, paneId, rect) {
  const view = panes.get(paneId);
  if (!view) return;
  const isHidden = rect.x <= -5e3 || rect.width <= 1 || rect.height <= 1;
  if (isHidden) {
    ghostPool.stashPane(win, paneId, view.webContents.getURL());
    return;
  }
  ghostPool.wakePane(paneId);
  if (typeof view.setBorderRadius === "function") view.setBorderRadius(12);
  view.setVisible(true);
  const dpr = devicePixelRatioFor(win);
  const phys = toPhysicalRect(rect, dpr);
  placePane(win, paneId, view, { ...phys, cssLeft: rect.x, cssTop: rect.y });
  view.webContents.invalidate();
}
function destroyPane(win, paneId, keepHibernated = false) {
  const view = panes.get(paneId);
  if (!view) return;
  ghostPool.evictPane(void 0, paneId);
  audioMatrix.unregisterPane(paneId);
  viewRegistry.unregisterView(paneId, keepHibernated);
  if (!keepHibernated) hibernationEngine.unregisterPane(paneId);
  removePane(win, paneId);
  panes.delete(paneId);
  FocusArbiter.handlePaneDestroyed(win, paneId);
  try {
    view.webContents.removeAllListeners();
    safeDetachDebugger(view);
    if (!view.webContents.isDestroyed()) view.webContents.destroy?.() ?? view.webContents.close();
  } catch {
  }
}
function updatePaneProfile(win, paneId, profileId) {
  const existing = panes.get(paneId);
  if (!existing) return;
  const currentUrl = existing.webContents.getURL();
  const userAgent = existing.webContents.getUserAgent();
  const bounds = existing.getBounds();
  let partitionString = profileId ? profileId === "main" ? "persist:main" : `persist:${profileId}` : "persist:main";
  try {
    const p = getProfileById(profileId);
    if (p && p.is_ephemeral) partitionString = profileId;
  } catch {
  }
  destroyPane(win, paneId);
  createPane(win, {
    paneId,
    url: currentUrl || "https://google.com",
    partition: partitionString,
    userAgent,
    rect: bounds
  });
  sessionIdentityService.attachCookieObserver(profileId);
  sessionIdentityService.scanProfile(profileId).catch(() => {
  });
  global.appOverlayView?.webContents.send("pane.profile-updated", { paneId, profileId });
}
function initPaneLifecycle(getWindow) {
  ghostPool.bindDestroyDelegate((w, id, keep) => destroyPane(w, id, keep));
  hibernationEngine.bindLifecycle({
    createPane: (w, req) => createPane(w, req),
    destroyPane: (w, id, keep) => destroyPane(w, id, keep),
    getWindow
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.CREATE_PANE, (_e, req) => {
    const w = getWindow();
    if (w) createPane(w, req);
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.SET_BOUNDS, (_e, paneId, rect) => {
    const w = getWindow();
    if (w) setPaneBounds(w, paneId, rect);
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.DESTROY_PANE, (_e, paneId) => {
    const w = getWindow();
    if (w) destroyPane(w, paneId);
  });
  electron.ipcMain.on("view.updateProfile", (_e, paneId, profileId) => {
    const w = getWindow();
    if (w) updatePaneProfile(w, paneId, profileId);
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.NAVIGATE, async (_e, id, url) => {
    if (!url?.trim()) return;
    const w = getWindow();
    hibernationEngine.updatePaneUrl(id, url);
    hibernationEngine.setActivePane(id);
    hibernationEngine.registerActivity(id);
    if (w) FocusArbiter.focusGuest(w, id);
    if (viewRegistry.isHibernated(id)) {
      await hibernationEngine.wakePane(id, url);
      return;
    }
    if (hibernationEngine.isFrozen(id)) {
      await hibernationEngine.thawPane(id);
    }
    let view = panes.get(id);
    if (!view && w) {
      createPane(w, {
        paneId: id,
        url,
        partition: "persist:main",
        userAgent: "",
        rect: { x: 0, y: 0, width: 800, height: 600 }
      });
      return;
    }
    if (!view || view.webContents.isDestroyed()) return;
    const cur = view.webContents.getURL();
    if (cur && (cur === url || cur.replace(/\/+$/, "") === url.replace(/\/+$/, ""))) return;
    view.webContents.loadURL(url);
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.FOCUS, async (_e, id) => {
    if (hibernationEngine.isFrozen(id)) {
      await hibernationEngine.thawPane(id);
    }
    const w = getWindow();
    if (w) FocusArbiter.focusGuest(w, id);
  });
  registerPaneIpcHandlers(panes);
  audioMatrix.initIpc();
  initLinkIntentRouter();
  initPaneSuperpowerIpc(panes, getWindow);
  initShadowStateIpc();
}
function configureSessionForProfile(profileId) {
  try {
    const profile = getProfileById(profileId);
    if (!profile) return;
    const partition = profile.is_ephemeral ? profileId : `persist:${profileId}`;
    const ses = electron.session.fromPartition(partition);
    sessionIdentityService.attachCookieObserver(profileId);
    const caps = getCurrentCapabilities();
    const proxyServer = profile.proxy_server && caps.allowProxy ? profile.proxy_server : null;
    configureSessionProxy(ses, proxyServer, partition);
    if (profile.user_agent && profile.user_agent.trim()) {
      ses.setUserAgent(profile.user_agent.trim());
    }
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowed = ["notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"];
      callback(allowed.includes(permission));
    });
  } catch (e) {
    console.error("Failed to configure session for profile", profileId, e);
  }
}
function configureAllSessions() {
  try {
    const profiles = getProfiles();
    for (const profile of profiles) {
      configureSessionForProfile(profile.id);
    }
  } catch (e) {
    console.error("Failed to configure sessions on startup", e);
  }
}
function initDbIpc() {
  electron.ipcMain.handle(IPC_CHANNELS.DB.GET_PROFILES, () => {
    configureAllSessions();
    return getProfiles();
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.DB.CREATE_PROFILE,
    async (_, id, name, color, is_ephemeral, proxy_server, user_agent) => {
      const caps = getCurrentCapabilities();
      const profiles = getProfiles();
      if (profiles.length >= caps.maxActiveProfiles) {
        throw new Error(
          `Your current plan includes ${caps.maxActiveProfiles} account${caps.maxActiveProfiles === 1 ? "" : "s"}. Upgrade to Pro to add more accounts.`
        );
      }
      if (proxy_server && !caps.allowProxy) {
        throw new Error("Dedicated proxy routing requires Tier 3. Upgrade to enable proxies.");
      }
      createProfile(id, name, color, is_ephemeral, proxy_server, user_agent);
      configureSessionForProfile(id);
      return { id, name, color, is_ephemeral, proxy_server, user_agent };
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.DB.UPDATE_PROFILE,
    (_, id, name, color, is_ephemeral, proxy_server, user_agent) => {
      const caps = getCurrentCapabilities();
      if (proxy_server && !caps.allowProxy) {
        throw new Error("Dedicated proxy routing requires Tier 3. Upgrade to enable proxies.");
      }
      updateProfile(id, name, color, is_ephemeral, proxy_server, user_agent);
      configureSessionForProfile(id);
      return { id, name, color, is_ephemeral, proxy_server, user_agent };
    }
  );
  electron.ipcMain.handle(IPC_CHANNELS.DB.DELETE_PROFILE, async (_, id) => {
    for (const [paneId, profileId] of viewProfile.entries()) {
      if (profileId === id && global.mainWindow && !global.mainWindow.isDestroyed()) {
        updatePaneProfile(global.mainWindow, paneId, "main");
      }
    }
    let isEphemeral = false;
    try {
      const p = getProfileById(id);
      if (p) isEphemeral = !!p.is_ephemeral;
    } catch {
    }
    deleteProfile(id);
    try {
      const ses = electron.session.fromPartition(isEphemeral ? id : `persist:${id}`);
      await ses.clearStorageData();
    } catch (e) {
      console.error("[Profile Engine] Failed to wipe session data:", e);
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.GET_INITIAL_STATE, () => getInitialAppState());
  electron.ipcMain.handle(IPC_CHANNELS.DB.GET_WORKSPACES, () => getWorkspaces());
  electron.ipcMain.handle(IPC_CHANNELS.DB.CREATE_WORKSPACE, (_, id, name, icon) => {
    const caps = getCurrentCapabilities();
    const existing = getWorkspaces();
    if (existing.length >= caps.maxWorkspaces) {
      throw new Error(
        `Free tier includes ${caps.maxWorkspaces} workspaces. Upgrade to unlock unlimited workspaces.`
      );
    }
    createWorkspace(id, name, icon);
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.UPDATE_WORKSPACE, (_, id, name, icon) => {
    updateWorkspace(id, name, icon);
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.DELETE_WORKSPACE, (_, id) => {
    deleteWorkspace(id);
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.SET_WORKSPACE_DEFAULT_PROFILE, (_, id, profileId) => {
    setWorkspaceDefaultProfile(id, profileId);
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.SET_TAB_DEFAULT_PROFILE, (_, id, profileId) => {
    setTabDefaultProfile(id, profileId);
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.DB.UPDATE_PANE_PROFILES_FOR_WORKSPACE,
    (_, workspaceId, profileId) => {
      updatePaneProfilesForWorkspace(workspaceId, profileId);
    }
  );
  electron.ipcMain.handle(IPC_CHANNELS.DB.UPDATE_PANE_PROFILES_FOR_TAB, (_, tabId, profileId) => {
    updatePaneProfilesForTab(tabId, profileId);
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.GET_TABS, (_, workspaceId) => getTabs(workspaceId));
  electron.ipcMain.handle(IPC_CHANNELS.DB.CREATE_TAB, (_, id, workspaceId, name) => {
    createTab(id, workspaceId, name);
    return { id, workspaceId, name };
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.UPDATE_TAB, (_, id, name, customName) => {
    updateTab(id, name, customName);
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.DELETE_TAB, (_, id) => {
    deleteTab(id);
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.MOVE_NODE_TO_TAB, (_, nodeId, targetTabId) => {
    moveNodeToTab(nodeId, targetTabId);
  });
  electron.ipcMain.handle(IPC_CHANNELS.DB.GET_NODES, (_, tabId) => getNodesForTab(tabId));
  electron.ipcMain.on(IPC_CHANNELS.DB.SAVE_NODE, (_, node) => saveNode(node));
  electron.ipcMain.on(IPC_CHANNELS.DB.DELETE_NODE, (_, id) => deleteNode(id));
  electron.ipcMain.on(
    IPC_CHANNELS.DB.SAVE_TAB_LAYOUT,
    (_, tabId, layoutState) => saveTabLayout(tabId, layoutState)
  );
  electron.ipcMain.handle(IPC_CHANNELS.DB.SET_UI_MODE, (_, mode) => {
    if (mode === "inset" || mode === "overlap" || mode === "collapse") {
      setAppMeta("ui_mode", mode);
    }
  });
}
function initLicensingIpc() {
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.ACTIVATE,
    (_, key, email) => activateLicenseKey(key, email)
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.VALIDATE,
    (_, key) => validateLicenseKey(key)
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.DEACTIVATE,
    () => deactivateLicenseKey()
  );
  electron.ipcMain.handle(IPC_CHANNELS.LICENSING.GET_KEY, () => getSavedLicenseKey());
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.GET_STATE,
    () => getSavedLicenseState()
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.CHECK_PREMIUM,
    () => checkPremiumStatus()
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.GET_CAPABILITIES,
    () => getCurrentCapabilities()
  );
  electron.ipcMain.handle(IPC_CHANNELS.LICENSING.IS_DEV, () => isDevMode$1());
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.GET_CHECKOUT_URL,
    () => getCheckoutUrl()
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.SAVE_ATTRIBUTION,
    (_, ref, affiliateId) => {
      setMemoryAttribution({ ref, affiliateId });
      saveAttribution({ ref, affiliateId });
      return true;
    }
  );
}
const version = "1.4.3";
const tag = "v1.4.3";
const title = "In-App User Feedback & Fast Tab Stability";
const publishedAt = "2026-11-20";
const categories = [{ "category": "Features", "items": [{ "title": "Added a native in-app feedback", "description": "Added a native in-app feedback dialog to easily report bugs, share feature requests, and attach screenshots directly from the bottom-left support menu." }] }, { "category": "Bug Fixes", "items": [{ "title": "Resolved an issue where workspace", "description": "Resolved an issue where workspace screens could prematurely reopen or flicker during fast tab transitions." }] }];
const highlights = [{ "title": "Added a native in-app feedback", "description": "Added a native in-app feedback dialog to easily report bugs, share feature requests, and attach screenshots directly from the bottom-left support menu." }];
const currentRelease = {
  version,
  tag,
  title,
  publishedAt,
  categories,
  highlights
};
const allReleases = /* @__PURE__ */ JSON.parse('[{"version":"1.4.3","tag":"v1.4.3","title":"In-App User Feedback & Fast Tab Stability","publishedAt":"2026-11-20","categories":[{"category":"Features","items":[{"title":"Added a native in-app feedback","description":"Added a native in-app feedback dialog to easily report bugs, share feature requests, and attach screenshots directly from the bottom-left support menu."}]},{"category":"Bug Fixes","items":[{"title":"Resolved an issue where workspace","description":"Resolved an issue where workspace screens could prematurely reopen or flicker during fast tab transitions."}]}],"highlights":[{"title":"Added a native in-app feedback","description":"Added a native in-app feedback dialog to easily report bugs, share feature requests, and attach screenshots directly from the bottom-left support menu."}]},{"version":"1.4.2","tag":"v1.4.2","title":"Responsive Settings Inputs, Keystroke Routing & On-Device License Security","publishedAt":"2026-11-15","categories":[{"category":"Improvements","items":[{"title":"Responsive Settings Inputs","description":"Clicking into license activation and profile settings fields now immediately claims keyboard focus, ensuring smooth text entry without interference from background web pages."},{"title":"Secure On-Device License Protection","description":"License verification and promotional code lookups now run with secure on-device encryption for instant, private offline redemption."}]},{"category":"Bug Fixes","items":[{"title":"Settings Dialog Keystroke Routing","description":"Resolved an issue where background web pages could intercept keyboard strokes when typing inside settings forms and popups."},{"title":"Immediate Promotional Code Redemption","description":"Fixed promotional code stacking in Account Settings so valid codes activate and upgrade tiers immediately with real-time confirmation."}]}],"highlights":[{"title":"Responsive Settings Inputs","description":"Clicking into license activation and profile settings fields now immediately claims keyboard focus, ensuring smooth text entry without interference from background web pages."},{"title":"Secure On-Device License Protection","description":"License verification and promotional code lookups now run with secure on-device encryption for instant, private offline redemption."}]},{"version":"1.4.1","tag":"v1.4.1","title":"Promotional Code Stacking, Expanded Free Tier & Instant Localhost Navigation","publishedAt":"2026-11-11","categories":[{"category":"Features","items":[{"title":"Promotional Code Stacking","description":"Stack additional license and promotion codes directly inside Account Settings to instantly upgrade tiers, unlock more account profiles, and expand multi-device seats."},{"title":"Expanded Free Tier","description":"Free accounts now include up to 5 workspaces and 2 separate account profiles with zero credit card required."},{"title":"Touch-Responsive Workspace Controls","description":"Pane headers now feature touch-responsive quick actions and a dedicated focus mode for distraction-free split-screen workflows."}]},{"category":"Improvements","items":[{"title":"Instant Localhost & Dev Navigation","description":"The searchbar now instantly detects local development servers, custom ports, and internal network addresses, opening them directly without redirecting to web search."},{"title":"Seamless Split Pane Transitions","description":"Eliminated blank search flashes and URL flicker when switching focus between side-by-side panes."}]},{"category":"Bug Fixes","items":[{"title":"Profile Quota Status","description":"Settings and profile menus now accurately display inactive badges only on profiles exceeding your active plan allowance."}]}],"highlights":[{"title":"Promotional Code Stacking","description":"Stack additional license and promotion codes directly inside Account Settings to instantly upgrade tiers, unlock more account profiles, and expand multi-device seats."},{"title":"Expanded Free Tier","description":"Free accounts now include up to 5 workspaces and 2 separate account profiles with zero credit card required."},{"title":"Instant Localhost & Dev Navigation","description":"The searchbar now instantly detects local development servers, custom ports, and internal network addresses, opening them directly without redirecting to web search."}]},{"version":"1.4.0","tag":"v1.4.0","title":"AppSumo Official Launch — Side-by-Side Screen Splitting & Separate Client Logins","publishedAt":"2026-10-23","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.4.0/showcase-00-split-screen.png","categories":[{"category":"Features","items":[{"title":"Side-by-Side Screen Splitting","description":"Snap windows into 2, 3, or 4 side-by-side panes. Keep your storefront, analytics, and project boards visible on one screen without tab juggling."},{"title":"Separate Client Logins","description":"Stay logged into conflicting client accounts simultaneously in dedicated workspaces without signing out or opening incognito windows."},{"title":"1-Second Search (Cmd+K)","description":"Instant keyboard search lets you jump directly to any client tab, document, or workspace in milliseconds."},{"title":"Multi-Device Access","description":"Use your lifetime license across 2 computers (Desktop + Laptop) with 1-click self-service license transfer in Settings."},{"title":"Tactile Restart Curtain","description":"Smooth, instant transition curtain when applying updates with zero window freeze or sudden closures."},{"title":"Nighttime Auto-Updates","description":"Updates apply silently in the background while your computer is idle and plugged in, ensuring you always wake up to the latest build."}]}],"highlights":[{"title":"Side-by-Side Screen Splitting","description":"Snap windows into 2, 3, or 4 side-by-side panes. Keep your storefront, analytics, and project boards visible on one screen without tab juggling."},{"title":"Separate Client Logins","description":"Stay logged into conflicting client accounts simultaneously in dedicated workspaces without signing out or opening incognito windows."}]},{"version":"1.3.9","tag":"v1.3.9","title":"Tactile Restart Transitions, Nighttime Auto-Updates & Window Geometry Persistence","publishedAt":"2026-10-23","categories":[{"category":"Improvements","items":[{"title":"Seamless Update Feedback","description":"The update flow now features refined monochromatic controls and an instant \\"Restarting Apposition\\" transition curtain, providing clear tactile confirmation and removing restart freezes."},{"title":"Nighttime Auto-Apply","description":"Downloaded updates can now apply silently during prolonged system idle when the workstation is closed, plugged into power, and free of playing audio or active calls."},{"title":"macOS Window Maximization & Fullscreen State","description":"The window now reliably restores its exact maximized or fullscreen state when reopened from the Dock after being closed with the red close button, and native macOS Zoom toggling fills the usable display area smoothly without geometry drift."}]}],"highlights":[{"title":"Seamless Update Feedback","description":"The update flow now features refined monochromatic controls and an instant \\"Restarting Apposition\\" transition curtain, providing clear tactile confirmation and removing restart freezes."},{"title":"Nighttime Auto-Apply","description":"Downloaded updates can now apply silently during prolonged system idle when the workstation is closed, plugged into power, and free of playing audio or active calls."},{"title":"macOS Window Maximization & Fullscreen State","description":"The window now reliably restores its exact maximized or fullscreen state when reopened from the Dock after being closed with the red close button, and native macOS Zoom toggling fills the usable display area smoothly without geometry drift."}]},{"version":"1.3.8","tag":"v1.3.8","title":"Atomic Background Updates, Persistent macOS Workspaces & Instant Dock Restoration","publishedAt":"2026-10-22","categories":[{"category":"Improvements","items":[{"title":"Seamless In-Place Auto-Updates","description":"Overhauled the macOS update engine with a detached atomic updater that cleanly preserves executable permissions and security seals, eliminating failed update restarts and looping notifications."},{"title":"Persistent Background Workspace & Instant Dock Restoration","description":"Closing the main window on macOS now keeps your active workspace running smoothly in the background, allowing instant zero-delay restoration when clicking the Dock icon without reloading tabs or freezing."},{"title":"Hardened Linux Package Updates","description":"Streamlined AppImage and package updates with detached process switching and direct 1-click terminal installation commands."}]}],"highlights":[{"title":"Seamless In-Place Auto-Updates","description":"Overhauled the macOS update engine with a detached atomic updater that cleanly preserves executable permissions and security seals, eliminating failed update restarts and looping notifications."},{"title":"Persistent Background Workspace & Instant Dock Restoration","description":"Closing the main window on macOS now keeps your active workspace running smoothly in the background, allowing instant zero-delay restoration when clicking the Dock icon without reloading tabs or freezing."},{"title":"Hardened Linux Package Updates","description":"Streamlined AppImage and package updates with detached process switching and direct 1-click terminal installation commands."}]},{"version":"1.3.7","tag":"v1.3.7","title":"Dedicated Proxy Routing, Global Identity Sync & Smart Screen Splitting","publishedAt":"2026-10-22","categories":[{"category":"Features","items":[{"title":"Dedicated Proxy Routing & Verification","description":"Added native proxy support across custom profiles with one-click connection diagnostics, automated exit location detection, and SSL certificate health checks to ensure external networks are active and secure before browsing."},{"title":"Global Identity & Localized Browsing","description":"Custom profile views now automatically sync their local time, regional timezone, and geographic location to match their assigned network route, enabling seamless localized ad verification and multi-region storefront comparison side-by-side."},{"title":"Advanced Connection Privacy","description":"Added comprehensive privacy shielding to keep local network addresses, connected hardware identities, and real machine locations completely hidden from websites when browsing through custom profiles."},{"title":"Instant Side-by-Side Screen Splitting","description":"Pressing `⌘T` (or `Ctrl+T` on Windows) on a single screen now automatically splits the workspace side-by-side into a dual-view layout, while pressing it when multiple screens are already open creates a clean new tab."},{"title":"Direct New Tab Creation","description":"Added a dedicated `⌘N` (or `Ctrl+N` on Windows) shortcut to immediately open a blank tab from any screen without altering your existing side-by-side layout."}]},{"category":"Improvements","items":[{"title":"Profile Management & Workstation Layout","description":"Upgraded the profile editor into a responsive two-column layout with organized account connections, refined visual accents, and improved menu anchoring that smoothly resets drafts when closed."},{"title":"Native macOS Keyboard Experience","description":"Aligned all keyboard shortcuts with standard macOS and Safari conventions, enabling native Command (`⌘`) key mappings for tabs, history navigation, panel closing, and developer inspection."},{"title":"Clear Command Palette Overlay & Shortcuts","description":"Removed background darkening scrim so split-views stay visible during quick search, and added arrow key navigation hints alongside Escape and Enter."},{"title":"Unified Window Controls","description":"Streamlined window controls into a unified, distraction-free top-right layout across macOS, Windows, and Linux for consistent minimizing, maximizing, and closing."}]},{"category":"Bug Fixes","items":[{"title":"Edge-to-Edge Window Maximization","description":"Resolved an issue on macOS where maximizing the window left the Dock and System Menu Bar visible; the application now launches and expands into a distraction-free, edge-to-edge workspace."}]}],"highlights":[{"title":"Dedicated Proxy Routing & Verification","description":"Added native proxy support across custom profiles with one-click connection diagnostics, automated exit location detection, and SSL certificate health checks to ensure external networks are active and secure before browsing."},{"title":"Global Identity & Localized Browsing","description":"Custom profile views now automatically sync their local time, regional timezone, and geographic location to match their assigned network route, enabling seamless localized ad verification and multi-region storefront comparison side-by-side."},{"title":"Profile Management & Workstation Layout","description":"Upgraded the profile editor into a responsive two-column layout with organized account connections, refined visual accents, and improved menu anchoring that smoothly resets drafts when closed."}]},{"version":"1.3.6","tag":"v1.3.6","title":"Multi-Tier License Activation, Multi-Device Seat Management & Precision Text Selection","publishedAt":"2026-10-07","categories":[{"category":"Features","items":[{"title":"License Activation","description":"AppSumo lifetime keys across all tiers now activate seamlessly with immediate device seat resolution and progressive verification that only prompts for details when necessary."},{"title":"Account & Tiered Upgrades","description":"In-app upgrade prompts now dynamically highlight the exact tier needed when expanding workspace capacity, adding account logins, or configuring dedicated proxies, while Account Settings accurately displays your active tier, free plan status, and device allowances."},{"title":"Multi-Device Seat Management","description":"Added an assigned devices overview to Account Settings, allowing multi-computer license holders to view active workstations and release seats with one click."},{"title":"Founder Launch Offer","description":"Made the limited Founder Lifetime Deal directly accessible and redeemable within the in-app upgrade screen with clear promotional rate disclosures."}]},{"category":"Improvements","items":[{"title":"Visual Polish & Typography","description":"Upgraded the entire application interface to refined executive typography with tabular figures, eliminating layout jitter in tab titles, dock counters, and timestamps across high-DPI displays."},{"title":"Dock & Settings Access","description":"Relocated Settings to the primary bottom-left dock anchor with instant shortcut access, eliminating popover overlaps on active screens."},{"title":"Plan & Capability Specifications","description":"Enhanced the in-app plan comparison matrix with a detailed breakdown of workspace limits, separate client logins, and proxy configuration across all tiers."}]},{"category":"Bug Fixes","items":[{"title":"Web Pane Text Selection","description":"Double-clicking and triple-clicking text in web panes now reliably selects words and paragraphs, restoring standard highlight and copy workflows."},{"title":"Navigation History","description":"Back and forward navigation now skips over duplicate URL redirects and page loops, remembering your full navigation history even after restarting the app or closing tabs, while removing distracting swipe animations to keep page navigation clearly distinct from tab switching."},{"title":"Dropdown & Interaction Stability","description":"Fixed an issue where web dropdown menus could prematurely collapse, and prevented accidental address bar expansion when clicking nearby toolbar controls."}]}],"highlights":[{"title":"License Activation","description":"AppSumo lifetime keys across all tiers now activate seamlessly with immediate device seat resolution and progressive verification that only prompts for details when necessary."},{"title":"Account & Tiered Upgrades","description":"In-app upgrade prompts now dynamically highlight the exact tier needed when expanding workspace capacity, adding account logins, or configuring dedicated proxies, while Account Settings accurately displays your active tier, free plan status, and device allowances."},{"title":"Visual Polish & Typography","description":"Upgraded the entire application interface to refined executive typography with tabular figures, eliminating layout jitter in tab titles, dock counters, and timestamps across high-DPI displays."}]},{"version":"1.3.5","tag":"v1.3.5","title":"Tab & Workspace Persistence, Active Profile Focus Rings & Clean Workspace Teardown","publishedAt":"2026-10-04","categories":[{"category":"Features","items":[{"title":"Tab & Workspace Persistence","description":"Active tabs and split panes now remain loaded and instantly available when minimizing the window, switching workspaces, or navigating between tabs."},{"title":"Workflow State Preservation","description":"In-progress text entries, form fields, and scroll positions are now automatically preserved and restored seamlessly across workspace transitions."},{"title":"Background Media Continuity","description":"Background audio streams and active calls now remain connected without interruption or premature freezing when navigating away."},{"title":"Active Profile Focus Rings","description":"Focus rings now dynamically reflect profile accent colors when switching accounts or air-gapped sessions."}]},{"category":"Improvements","items":[{"title":"Docked Canvas Inset Persistence","description":"Window layout preference for docked inset mode is now remembered and automatically restored on startup."},{"title":"Process Responsiveness","description":"Streamlined background process scheduling for instant response times when multitasking across multiple workspaces."},{"title":"High-Contrast Pricing Overview","description":"Refined pricing overview and license tier displays with high-contrast monochrome aesthetics and improved typography legibility."},{"title":"Workspace Protection & Onboarding","description":"Added inline deletion confirmation to prevent accidental removals, enforced protection on your sole remaining workspace, and set new app installations to start with a single clean default workspace."}]},{"category":"Bug Fixes","items":[{"title":"Workspace Teardown","description":"Resolved an issue where deleting a secondary workspace could leave behind a ghost icon and unresponsive tabs. Workspace teardown is now instantaneous and safely transitions to the fallback workspace."}]}],"highlights":[{"title":"Tab & Workspace Persistence","description":"Active tabs and split panes now remain loaded and instantly available when minimizing the window, switching workspaces, or navigating between tabs."},{"title":"Workflow State Preservation","description":"In-progress text entries, form fields, and scroll positions are now automatically preserved and restored seamlessly across workspace transitions."},{"title":"Docked Canvas Inset Persistence","description":"Window layout preference for docked inset mode is now remembered and automatically restored on startup."}]},{"version":"1.3.4","tag":"v1.3.4","title":"Resilient Auto-Updates & Direct Profile Navigation","publishedAt":"2026-10-04","categories":[{"category":"Features","items":[{"title":"Direct Profile Switcher","description":"The bottom-left profile switcher now directly opens the profile selection popover to instantly switch or manage account profiles."},{"title":"Hover Workspace Stack","description":"Settings, release notes, and feedback buttons now smoothly reveal above the profile switcher on hover, keeping workspace controls accessible without screen clutter."},{"title":"Precision Update Notifications","description":"Automatic version update notifications now proactively appear upon launch with a refined, distraction-free notification capsule that reflects our precision design language."}]},{"category":"Improvements","items":[{"title":"Resilient Multi-Tier Updates","description":"Introduced resilient multi-tier update fallback and seamless state preservation, preventing updates from getting interrupted or losing active tabs and layout sessions."},{"title":"Unified Release Notes Bar","description":"Streamlined the Release Notes view into a single unified action bar, removing redundant update banners and ensuring zero duplicate action prompts."}]}],"highlights":[{"title":"Direct Profile Switcher","description":"The bottom-left profile switcher now directly opens the profile selection popover to instantly switch or manage account profiles."},{"title":"Hover Workspace Stack","description":"Settings, release notes, and feedback buttons now smoothly reveal above the profile switcher on hover, keeping workspace controls accessible without screen clutter."},{"title":"Resilient Multi-Tier Updates","description":"Introduced resilient multi-tier update fallback and seamless state preservation, preventing updates from getting interrupted or losing active tabs and layout sessions."}]},{"version":"1.3.3","tag":"v1.3.3","title":"Persistent Active Tabs & Seamless Auto-Wake","publishedAt":"2026-09-29","categories":[{"category":"Features & Enhancements","items":[{"title":"Persistent Active Tab Continuity","description":"Split panes and views within your active tab now remain fully interactive and visible indefinitely without going to sleep while you are working in the app."},{"title":"Background Resource Conservation","description":"When minimizing the app, active tabs now automatically sleep in the background to free up system memory while preserving active audio playback and live calls."},{"title":"Zero-Click Auto-Wake","description":"Sleeping tabs now wake up and resume their exact scroll position automatically when clicked or when restoring the app window, eliminating the need to click a wake button."},{"title":"Memory Metrics in Command Palette","description":"Real-time memory metrics now display within the Command Palette, highlighting the exact amount of system RAM conserved by sleeping background tabs."}]},{"category":"Improvements & Fixes","items":[{"title":"Modifier & Middle-Click Split Routing","description":"Opening links while holding Ctrl/Cmd or via middle-click opens adjacent split panes up to a balanced quadrant grid, smoothly spilling over into new tabs once the limit is reached."},{"title":"Start Page Sleep Immunity","description":"Start pages and blank tabs are permanently immune to background sleep cycles, preventing unexpected blank reloading or redirect issues."},{"title":"Smooth Omnibar Transition","description":"Omnibar expansion now transitions smoothly without sudden layout shifts or involuntary resizing when searching."},{"title":"Webview Pointer & Cursor Precision","description":"Resolved edge cases causing cursor inversion or sticking during layout transitions and rapid mouse movements across split panels."}]}],"highlights":[{"title":"Persistent Active Tab Continuity","description":"Split panes and views within your active tab now remain fully interactive and visible indefinitely without going to sleep while you are working in the app."},{"title":"Background Resource Conservation","description":"When minimizing the app, active tabs now automatically sleep in the background to free up system memory while preserving active audio playback and live calls."},{"title":"Modifier & Middle-Click Split Routing","description":"Opening links while holding Ctrl/Cmd or via middle-click opens adjacent split panes up to a balanced quadrant grid, smoothly spilling over into new tabs once the limit is reached."}]},{"version":"1.3.2","tag":"v1.3.2","title":"Compact Context Menus, Precision Tools & Split-Screen Showcase","publishedAt":"2026-09-15","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.3.2/context-menu.webp","categories":[{"category":"Features","items":[{"title":"Compact Context Menus","description":"Redesigned the right-click menu into a compact, three-tier rotary layout with quick-navigation controls and smart tool grouping that reduces vertical height by over 60%."},{"title":"Adaptive Tool Memory","description":"Split and capture actions now remember your preferred defaults: clicking the primary button executes immediately, while selecting an alternate from the disclosure tray automatically sets it as your default for single-click actions."},{"title":"Precision Color Loupe","description":"Added a high-precision pixel loupe tool to sample colors directly from any workspace panel and copy color codes directly to the clipboard."},{"title":"Modernized Reader Mode","description":"Distraction-free reading view now features a floating capsule header with reading time estimates, source links, dynamic text sizing, and three calibrated surfaces (White, Sepia, and Charcoal)."},{"title":"Device Hardware Emulation","description":"Preview and test web pages across simulated mobile and tablet screen dimensions (iPhone, Pixel, and iPad) with automatic display fitting, orientation switching, hardware bezels, and one-key desktop escape."},{"title":"Progressive Split-Screen Showcase","description":"Interactive app directory now supports live split-screen previewing (up to 4 apps side-by-side or in a 2x2 grid) and dynamic tab creation for comparing enterprise and productivity tools."},{"title":"Seamless Auto-Updates","description":"In-app updates now download automatically in the background with discreet notifications, live transfer speed, progress tracking, and one-click restart when ready."}]},{"category":"Improvements","items":[{"title":"Native Context Arbiter","description":"Right-clicking video players and interactive web apps (such as YouTube, Figma, and Google Docs) surfaces the web application\'s native menu on the first click, while a consecutive click opens Apposition\'s workspace menu."},{"title":"Developer Tools Submenu","description":"Specialized site and developer inspection tools are organized inside a dedicated submenu, keeping the primary workspace menu clean and accessible for non-technical workflows."},{"title":"Clean Media & Link Actions","description":"Right-clicking images and links organizes copy and navigation actions into clean, dedicated submenus to prevent menu clutter."},{"title":"Shift Bypass Shortcut","description":"Holding Shift while right-clicking anywhere instantly presents Apposition\'s workspace menu, bypassing in-page menus."},{"title":"Empty Panel Context Menu","description":"Right-clicking empty workspace panels provides instant workspace and layout controls, while preserving native text selection inside input fields."},{"title":"Instant Split Hub Access","description":"Creating a split pane immediately loads the workspace hub with instant command bar focus, keyboard shortcuts, and app catalog access."},{"title":"High-Contrast Tab Depth","description":"Tab icons now render inside a crisp, high-contrast container with refined borders and physical depth, ensuring dark brand marks and favicons remain legible across all workspace themes."},{"title":"Dedicated Full App Catalog","description":"The full 50+ application catalog is accessible via a dedicated view at the bottom of the directory with smooth category navigation."},{"title":"Synchronized Update Controls","description":"Synchronized update controls across Settings and the Release Notes viewer, ensuring consistent version status and one-click installation from either view."}]},{"category":"Bug Fixes","items":[{"title":"Clipboard Image Copying","description":"Copying images directly from web pages to the clipboard now functions reliably across all websites."}]}],"highlights":[{"title":"Compact Context Menus","description":"Redesigned the right-click menu into a compact, three-tier rotary layout with quick-navigation controls and smart tool grouping that reduces vertical height by over 60%."},{"title":"Adaptive Tool Memory","description":"Split and capture actions now remember your preferred defaults: clicking the primary button executes immediately, while selecting an alternate from the disclosure tray automatically sets it as your default for single-click actions."},{"title":"Native Context Arbiter","description":"Right-clicking video players and interactive web apps (such as YouTube, Figma, and Google Docs) surfaces the web application\'s native menu on the first click, while a consecutive click opens Apposition\'s workspace menu."}]},{"version":"1.3.1","tag":"v1.3.1","title":"Persistent Media Continuity, Live Audio Equalizer & Tactile Edge Navigation","publishedAt":"2026-09-12","categories":[{"category":"Features","items":[{"title":"Persistent Media Playback Continuity","description":"Streaming media and video playback now reliably remember and restore your exact playback timestamp across page reloads and tab switches, seamlessly resuming where you left off."},{"title":"Interactive Audio Equalizer & Smart Indicator","description":"Active audio sessions now display a synchronized live visual equalizer across workspace tabs and the master dock control, intelligently pausing the animation when audio is muted, paused, or finished."},{"title":"Communicator App Reload","description":"Added a dedicated reload button in the Communicator header to quickly refresh active web apps with visual feedback."}]},{"category":"Improvements","items":[{"title":"Fluid Drag-and-Drop Spatial Previews","description":"When dragging a tab or panel to split the screen or dock against the entire window, existing panels now smoothly glide and compress out of the way with responsive spring transitions, showing an exact live preview of the resulting layout before you release."},{"title":"Tactile Edge Navigation Shelves","description":"Dragging panels to screen edges to navigate between tabs or workspaces now reveals flush, tactile bezel shelves with circular tension rings and target previews, featuring vertical shelves along the window sides for tabs and horizontal shelves along the top and bottom for workspaces."},{"title":"Real-Time Profile Details","description":"The profile switcher now updates instantly when signing into an account in any split pane, and displays connected account counts with detailed hover summaries."}]},{"category":"Bug Fixes","items":[{"title":"Automatic Account Identification","description":"Resolved an issue where signed-in accounts across workspaces were displayed with generic provider placeholders instead of their actual email address or username."},{"title":"Workspace Airspace & Transitions","description":"Resolved an issue where switching workspaces, creating tabs, or splitting panes could cause panels to briefly flicker or display placeholder states, ensuring native web views remain instantly responsive."},{"title":"Continuous Background Web Sessions","description":"Background tabs and workspaces maintain their active state without unexpected reloads, preserving video progress, unsaved form inputs, and active sessions."},{"title":"Communicator Popovers & Settings","description":"Interacting with stack settings, app configuration menus, or account pickers no longer causes the Communicator drawer to inadvertently close."},{"title":"Stable Drag Focus & Screen-Edge Navigation","description":"Resolved an issue where the active panel focus ring could jitter or rapidly ping-pong while dragging panels across workspaces, and eliminated rapid duplicate tab creation when dragging near the screen edges."},{"title":"Intelligent Semantic Tab Naming","description":"Tabs now intelligently resolve authentic board, document, and channel names from live web applications, preventing cryptic database IDs, random alphanumeric routing slugs, or static brand placeholders from appearing on tabs."},{"title":"Intelligent Omnibar & Search Navigation","description":"Searching for apps like Gmail, Figma, or Notion now directly launches the application upon pressing Enter, while queries containing search terms like tutorials or tips dynamically prioritize web search results without false positives."}]}],"highlights":[{"title":"Persistent Media Playback Continuity","description":"Streaming media and video playback now reliably remember and restore your exact playback timestamp across page reloads and tab switches, seamlessly resuming where you left off."},{"title":"Interactive Audio Equalizer & Smart Indicator","description":"Active audio sessions now display a synchronized live visual equalizer across workspace tabs and the master dock control, intelligently pausing the animation when audio is muted, paused, or finished."},{"title":"Fluid Drag-and-Drop Spatial Previews","description":"When dragging a tab or panel to split the screen or dock against the entire window, existing panels now smoothly glide and compress out of the way with responsive spring transitions, showing an exact live preview of the resulting layout before you release."}]},{"version":"1.3.0","tag":"v1.3.0","title":"Introducing the App Directory, Dedicated Release Feed & Fluid Multi-Pane Navigation","publishedAt":"2026-09-11","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.3.0/app-directory.webp","categories":[{"category":"Features","items":[{"title":"Introducing the App Directory","description":"Discover, search, and launch hundreds of web apps organized across curated categories. Features an adaptive layout that provides full app details even in compact split panes, fluid 3D magnetic hover physics, instant keyboard navigation, and zero-stutter scrolling."},{"title":"Dedicated Product Changelog","description":"Browse release notes, search past updates, filter by category, and subscribe via RSS feeds directly inside the app."},{"title":"Tactile App Shortcuts & Split Dock","description":"Pinned shortcuts and stacked split sessions now feature tactile cursor-tracking 3D tilt with smooth elevation, keeping each shortcut isolated while completely preventing dock shift or hover flickering in narrow panels."},{"title":"Flexible Annual Plan","description":"Added a streamlined annual subscription ($120/year) alongside the limited Founder Lifetime License."}]},{"category":"Improvements","items":[{"title":"Minimalist Tab Titles","description":"Refined workspace tabs with a minimalist icon-focused view that smoothly reveals tab titles upon hover, while newly created tabs immediately present clear labels."},{"title":"In-App Release Notes Viewer","description":"Redesigned the update viewer with a spacious layout, one-click update checks, progressive instant loading, and direct web archive navigation."},{"title":"Visual Release Previews","description":"Key milestone release notes now display high-resolution visual previews directly within the in-app release viewer and website feed."},{"title":"Enhanced Motion & Performance","description":"Optimized motion, panel transitions, and scrolling performance across all workspace navigation views."},{"title":"Clean App Catalog","description":"Removed redundant duplicate listings and disambiguated service entries across shared domains."}]},{"category":"Bug Fixes","items":[{"title":"Workspace Airspace & Transitions","description":"Resolved an issue where switching workspaces or splitting panes could cause the address bar to temporarily blank out, the profile badge to flicker, or empty panes to display a blank screen."},{"title":"Search Input & Sleep Recovery","description":"Resolved an issue where opening the App Directory from a new tab could prevent typing into the search bar, and fixed a bug where waking the computer from sleep could cause the interface to temporarily disappear."},{"title":"Command Bar Behavior","description":"Prevented accidental transitions to notes when pressing Escape in the workspace search bar."}]}],"highlights":[{"title":"Introducing the App Directory","description":"Discover, search, and launch hundreds of web apps organized across curated categories. Features an adaptive layout that provides full app details even in compact split panes, fluid 3D magnetic hover physics, instant keyboard navigation, and zero-stutter scrolling."},{"title":"Dedicated Product Changelog","description":"Browse release notes, search past updates, filter by category, and subscribe via RSS feeds directly inside the app."},{"title":"Minimalist Tab Titles","description":"Refined workspace tabs with a minimalist icon-focused view that smoothly reveals tab titles upon hover, while newly created tabs immediately present clear labels."}]},{"version":"1.2.7","tag":"v1.2.7","title":"Smart Window Persistence, Dynamic Omnibar Expansion, and Instant Cold Starts","publishedAt":"2026-09-09","categories":[{"category":"Features","items":[{"title":"Smart Window Persistence & Multi-Monitor Recovery","description":"The desktop app now seamlessly remembers your window size, position, and maximized state across restarts, and automatically rescues windows onto your main screen if an external monitor is disconnected."},{"title":"Dynamic Omnibar Expansion","description":"The address search bar now smoothly expands into available window space when editing and seamlessly morphs back into place upon dismissal, while tab labels compress smoothly under pressure without visual overlap."},{"title":"Semantic Title Distillation","description":"Tabs now automatically distill deep page titles into concise sub-task labels like Proposals, Pull requests, or Inbox instead of repeating brand names, and single tabs collapse into clean icon capsules to keep your workspace header uncluttered."}]},{"category":"Improvements","items":[{"title":"Instant Cold Starts","description":"App startup and workspace launch times are now significantly faster, eliminating initial launch freezes and accelerating background tab hydration."},{"title":"Zero-Flicker Launch","description":"The application now opens instantaneously with a fully rendered workspace, eliminating initial blank window delays and keeping active tabs immediately responsive."}]},{"category":"Bug Fixes","items":[{"title":"Duplicate Split Prevention","description":"Splitting panes via keyboard shortcuts now reliably creates a single new pane, eliminating accidental duplicate splits."},{"title":"Split View Focus Synchronization","description":"Active pane navigation and panel closing now synchronize flawlessly across split views, ensuring shortcuts like Ctrl+W consistently close the selected pane."}]}],"highlights":[{"title":"Smart Window Persistence","description":"Apposition automatically remembers your window positions and multi-monitor layouts across restarts."},{"title":"Dynamic Omnibar Expansion","description":"The address and search bar smoothly adapts to fit long queries and collapses into a compact capsule."},{"title":"Instant Cold Starts","description":"Workspaces and active panes now launch instantaneously with zero initial blank window lag."}]},{"version":"1.2.6","tag":"v1.2.6","title":"Seamless Workspace Dropdowns & Visual Branding Polish","publishedAt":"2026-09-09","categories":[{"category":"Improvements","items":[{"title":"Consolidated Brand Mark","description":"Updated all application installer assets and web icons to consistently display the refreshed brand mark across tabs and installer dialogs."}]},{"category":"Bug Fixes","items":[{"title":"Dropdown Menu Stability","description":"Resolved an issue where dropdown menus, selection filters, and model pickers in web workspaces would immediately collapse when clicked."},{"title":"Address Bar Hijack Guard","description":"Resolved an issue where websites containing embedded frames or interactive widgets could unexpectedly hijack the active tab address bar."}]}],"highlights":[{"title":"Dropdown Menu Stability","description":"Dropdown pickers and menus in web applications now stay open reliably during interaction."},{"title":"Address Bar Hijack Guard","description":"Embedded iframes are prevented from modifying tab address state unexpectedly."}]},{"version":"1.2.5","tag":"v1.2.5","title":"Self-Serve Device Licensing, Polished Brand Identity & 35% Partner Program","publishedAt":"2026-09-08","categories":[{"category":"Features","items":[{"title":"Self-Serve Device Licensing","description":"Added seamless in-app and web license checkout, self-serve device seat management directly from Account settings, and launched the 35% Partner Program."}]},{"category":"Improvements","items":[{"title":"Refreshed Visual Identity","description":"Updated the official application icon, website branding, and browser tab favicons with our new split-monolith visual identity."}]}],"highlights":[{"title":"Self-Serve Device Licensing","description":"Manage active device seats and license transfers directly from your Account settings screen."},{"title":"35% Partner Program","description":"Earn recurring rewards for referring teams and collaborators to Apposition."}]},{"version":"1.2.4","tag":"v1.2.4","title":"Silent Background Updates & Precision Workspace Controls","publishedAt":"2026-09-05","categories":[{"category":"Features","items":[{"title":"Dedicated Drawer Resize Controls","description":"Dedicated drawer resize controls in the header and settings menu to customize your workspace layout with precision."},{"title":"Silent Background Updates","description":"Seamless background application updates that download quietly and apply instantly upon restart without interrupting your work."}]},{"category":"Improvements","items":[{"title":"Smarter Omnibar Search Classification","description":"Reliably differentiates search queries from web addresses, ensuring terms like code snippets or decimal numbers open web searches correctly."},{"title":"Anchored Popover Dialogs","description":"Add App and Stack configuration menus now open cleanly as anchored popovers without dimming the workspace."}]},{"category":"Bug Fixes","items":[{"title":"Search Query Desync Fix","description":"Fixed an issue where search queries typed into the address bar were intermittently dropped or desynchronized when navigating."},{"title":"Google Search Redirection Guard","description":"Resolved unexpected authentication prompts and redirection loops when browsing Google search results."}]}],"highlights":[{"title":"Silent Background Updates","description":"Updates download in the background without popups or work interruptions."},{"title":"Workspace Drawer Controls","description":"Fine-tune sidebar and drawer dimensions with tactile resize handles."}]},{"version":"1.2.3","tag":"v1.2.3","title":"Workspace Isolation & Tab Management Polish","publishedAt":"2026-09-02","categories":[{"category":"Features","items":[{"title":"Strict Workspace Sandboxing","description":"Dedicated profile cookies and storage partitions across isolated tabs."}]},{"category":"Improvements","items":[{"title":"Fluid Tab Switching","description":"Zero-latency keyboard shortcuts to cycle through workspaces and tabs."}]}],"highlights":[{"title":"Strict Workspace Sandboxing","description":"Completely isolated session cookies and partitions per tab."}]},{"version":"1.2.2","tag":"v1.2.2","title":"Connected Account Detection & Precision Workspace Isolation","publishedAt":"2026-08-31","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.2.2/profile-isolation.webp","categories":[{"category":"Features","items":[{"title":"Added automated connected account detection","description":"Added automated connected account detection across workspace profiles with one-click authentication and live session status."},{"title":"Introduced instant email and handle","description":"Introduced instant email and handle copying, account filtering, and refined color themes for profile management."}]},{"category":"Improvements & Fixes","items":[{"title":"Restored seamless pointer event isolation","description":"Restored seamless pointer event isolation across multi-pane split layouts, preventing focus drift when interacting with profile popovers."},{"title":"Enhanced connected account identification and","description":"Enhanced connected account identification and avatar presentation in pane headers, omniboxes, and workspace menus."}]}],"highlights":[{"title":"Added automated connected account detection","description":"Added automated connected account detection across workspace profiles with one-click authentication and live session status."},{"title":"Introduced instant email and handle","description":"Introduced instant email and handle copying, account filtering, and refined color themes for profile management."},{"title":"Restored seamless pointer event isolation","description":"Restored seamless pointer event isolation across multi-pane split layouts, preventing focus drift when interacting with profile popovers."}]},{"version":"1.2.1","tag":"v1.2.1","title":"Floating Communicator Hub, Fluid Spatial Drag, and Workspace Interaction Polish","publishedAt":"2026-08-31","categories":[{"category":"Features","items":[{"title":"Introduced the Communicator Hub","description":"seamlessly access your messengers and work inboxes with instant hover peek, customizable stacks, session-isolated profiles, and full floating palette support."}]},{"category":"Improvements","items":[{"title":"Refined the Communicator Hub with","description":"Refined the Communicator Hub with fluid drag-to-float window physics, magnetic corner docking, and a streamlined capsule header."},{"title":"Streamlined messaging app layouts with","description":"Streamlined messaging app layouts with smooth zero-latency dragging and crisp edge-to-edge content framing for web apps like Gmail and Slack."},{"title":"Improved modal dialogs and overlay","description":"Improved modal dialogs and overlay menus to close smoothly on outside clicks or the Escape key."}]},{"category":"Bug Fixes","items":[{"title":"The floating Communicator now stays","description":"The floating Communicator now stays reliably on top of all workspace panes, eliminates visual bleed-through from background pages, and smoothly dismisses whenever you click outside."},{"title":"Fixed an issue where interacting","description":"Fixed an issue where interacting with web applications and links inside split panels could cause unexpected page reloads or unrendered views."}]}],"highlights":[{"title":"Introduced the Communicator Hub","description":"seamlessly access your messengers and work inboxes with instant hover peek, customizable stacks, session-isolated profiles, and full floating palette support."},{"title":"Refined the Communicator Hub with","description":"Refined the Communicator Hub with fluid drag-to-float window physics, magnetic corner docking, and a streamlined capsule header."},{"title":"Streamlined messaging app layouts with","description":"Streamlined messaging app layouts with smooth zero-latency dragging and crisp edge-to-edge content framing for web apps like Gmail and Slack."}]},{"version":"1.2.0","tag":"v1.2.0","title":"Next-Gen Spatial Engine & Universal Communicator","publishedAt":"2026-08-27","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.2.0/communicator-hub.webp","categories":[{"category":"Features","items":[{"title":"Universal Communicator Hub","description":"Unified floating messaging cluster for Slack, Gmail, Telegram, and Discord."},{"title":"Dynamic Split Panes","description":"Tactile drag-and-drop spatial multi-pane tiling with zero webview reloads."}]}],"highlights":[{"title":"Universal Communicator Hub","description":"Unified floating messaging cluster for all your daily apps."},{"title":"Dynamic Split Panes","description":"Tactile spatial tiling with zero pane reloads."}]},{"version":"1.1.8","tag":"v1.1.8","title":"Stability Fixes, Install Improvements & Google Sign-in Reliability","publishedAt":"2026-08-23","categories":[{"category":"Bug Fixes","items":[{"title":"Fixed a rare crash that","description":"Fixed a rare crash that could close the entire app unexpectedly while browsing."},{"title":"Resolved an issue where certain","description":"Resolved an issue where certain network requests and cross-origin authentications could cause the application to crash unexpectedly."}]},{"category":"Sign-in & Accounts","items":[{"title":"Signing in with Google now","description":"Signing in with Google now works reliably inside panels as well as the dedicated login window - including retries after a failed attempt."},{"title":"Google sign-in no longer interrupts","description":"Google sign-in no longer interrupts you with Windows passkey popups; it goes straight to password entry."}]},{"category":"Improvements","items":[{"title":"Streamlined one-click installation and clipboard","description":"Streamlined one-click installation and clipboard copy commands across download guides."}]}],"highlights":[{"title":"Streamlined one-click installation and clipboard","description":"Streamlined one-click installation and clipboard copy commands across download guides."}]},{"version":"1.1.7","tag":"v1.1.7","title":"Resilient Startup & Seamless Session Recovery","publishedAt":"2026-08-22","categories":[{"category":"Improvements & Bug Fixes","items":[{"title":"Resolved an intermittent startup interruption","description":"Resolved an intermittent startup interruption on desktop sessions and introduced automatic background session self-healing to seamlessly recover tabs and active workspaces."},{"title":"Streamlined cross-platform installer setup with","description":"Streamlined cross-platform installer setup with guided post-download instructions for smoother initial onboarding."},{"title":"Optimized modal rendering layers and","description":"Optimized modal rendering layers and window transitions for smoother workspace interactions."}]}],"highlights":[{"title":"Resolved an intermittent startup interruption","description":"Resolved an intermittent startup interruption on desktop sessions and introduced automatic background session self-healing to seamlessly recover tabs and active workspaces."},{"title":"Streamlined cross-platform installer setup with","description":"Streamlined cross-platform installer setup with guided post-download instructions for smoother initial onboarding."},{"title":"Optimized modal rendering layers and","description":"Optimized modal rendering layers and window transitions for smoother workspace interactions."}]},{"version":"1.1.6","tag":"v1.1.6","title":"Seamless Media Continuity, Instant Tab Restoration & Streamlined Installers","publishedAt":"2026-08-20","categories":[{"category":"Features","items":[{"title":"Background Media Continuity","description":"Playing videos and background audio now persist seamlessly without reloads or interruptions when switching between tabs and workspaces."},{"title":"Workspace-Isolated Audio Indicators","description":"Animated equalizer waves now indicate audio playback strictly within their active workspace."},{"title":"Streamlined Setup & Package Managers","description":"Introduced a distraction-free installation assistant with one-click terminal setup for macOS, Windows, and Linux, plus instant cryptographic verification."}]},{"category":"Improvements & Fixes","items":[{"title":"Instant Tab & Pane Undo","description":"Reopening closed tabs and split panes (Ctrl+Shift+T) is now instant, accompanied by a live visual undo notification showing site favicons."},{"title":"Immediate Split Pane Reflow","description":"Closing split panes now instantly reflows remaining views with zero delay and completely halts background audio upon close."},{"title":"Reliable Keyboard Navigation","description":"Workspace shortcuts now reliably trigger even when active web apps attempt to capture keyboard focus."}]}],"highlights":[{"title":"Background Media Continuity","description":"Playing videos and background audio now persist seamlessly without reloads or interruptions when switching between tabs and workspaces."},{"title":"Workspace-Isolated Audio Indicators","description":"Animated equalizer waves now indicate audio playback strictly within their active workspace."},{"title":"Instant Tab & Pane Undo","description":"Reopening closed tabs and split panes (Ctrl+Shift+T) is now instant, accompanied by a live visual undo notification showing site favicons."}]},{"version":"1.1.5","tag":"v1.1.5","title":"Spatial Navigation, Omnibox Browser Bar & Audio Multitasking","publishedAt":"2026-08-18","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.1.5/apposition-v1.1.5-spatial-navigation.png","categories":[{"category":"Features","items":[{"title":"Top-Center Omnibox Browser Bar","description":"Browser navigation bar with omnibox search suggestions, back/forward history, and quick layout actions."},{"title":"3-Way Spatial Layout Mode","description":"Toggle for docked, floating overlap, and full collapse views with persistent user preferences."},{"title":"Panel Dynamic Island & Focus Mode","description":"Distraction-free single-pane work triggered with Alt+F shortcut."}]},{"category":"Improvements","items":[{"title":"Responsive Soundwave Indicator","description":"Tabs display live soundwaves when audio is playing, with instant one-click muting."},{"title":"Synchronized Spatial Grid","description":"Refined window border margins, split gaps, and drop snap ghosts onto a synchronized grid."}]},{"category":"Bug Fixes","items":[{"title":"Window Control Hit-Testing","description":"Optimized window control responsiveness and hit-testing across all edge layout modes."}]}],"highlights":[{"title":"Top-Center Omnibox Browser Bar","description":"Instant search suggestions and quick layout actions right from the header."},{"title":"3-Way Spatial Layout Mode","description":"Docked, floating overlap, and full collapse workspace arrangements."},{"title":"Audio Indicator & 1-Click Mute","description":"Live soundwaves on active tabs with instant one-click muting."}]},{"version":"1.1.4","tag":"v1.1.4","title":"Multi-Profile Single Sign-On & Persistent Session Sync","publishedAt":"2026-08-18","categories":[{"category":"Features","items":[{"title":"Redesigned the profile manager with","description":"Redesigned the profile manager with an instant Single Sign-On provider bar, streamlined profile settings, and dynamic active pane detection."},{"title":"Added an interactive profile switcher","description":"Added an interactive profile switcher popover with the Alt+P shortcut and full arrow-key keyboard navigation."}]},{"category":"Improvements","items":[{"title":"Opening or splitting panes under","description":"Opening or splitting panes under the same profile now automatically synchronizes login sessions in real time."},{"title":"Profile switching preserves the exact","description":"Profile switching preserves the exact active webpage without accidental sign-outs."},{"title":"Profile switcher rows now feature","description":"Profile switcher rows now feature full-width selection highlights and floating hover micro-actions."}]},{"category":"Fixes","items":[{"title":"Switching profiles on a split","description":"Switching profiles on a split pane now instantly switches session partitions and cookies without latency."},{"title":"Active account logins and cookies","description":"Active account logins and cookies are now reliably preserved across app restarts and system sleep."},{"title":"Workspace quick-switching via Command Palette","description":"Workspace quick-switching via Command Palette now previews icons with keyboard navigation."}]}],"highlights":[{"title":"Redesigned the profile manager with","description":"Redesigned the profile manager with an instant Single Sign-On provider bar, streamlined profile settings, and dynamic active pane detection."},{"title":"Added an interactive profile switcher","description":"Added an interactive profile switcher popover with the Alt+P shortcut and full arrow-key keyboard navigation."},{"title":"Opening or splitting panes under","description":"Opening or splitting panes under the same profile now automatically synchronizes login sessions in real time."}]},{"version":"1.1.3","tag":"v1.1.3","title":"Seamless System Browser Sign-In, Workspace Context Menus & Enhanced Navigation","publishedAt":"2026-08-16","categories":[{"category":"Features","items":[{"title":"Seamless System Browser Sign-In","description":"Sign in to Google Workspace, Slack, Notion, and other protected services using your default browser with 1-click verification."},{"title":"Pane Context Menu & Reload Controls","description":"Right-click anywhere in an active pane to access quick navigation, clipboard tools, pane splitting, and workspace layout controls, or quickly refresh active panes using standard keyboard shortcuts (Ctrl+R / F5 / Ctrl+Shift+R)."},{"title":"History Jump Menu & Navigation Shortcuts","description":"Long-press or right-click the back/forward navigation buttons to open a visual jump menu with site icons, or navigate back and forward instantly using Ctrl+[ and Ctrl+]."},{"title":"Power-User Search Keywords","description":"Address inputs now resolve Google Search directly with instant search engine shortcut keywords for YouTube, GitHub, and Google Drive."}]},{"category":"Improvements","items":[{"title":"Performance & Memory Efficiency","description":"Dramatically reduced memory consumption and input latency when running demanding web applications like Canva and Figma, with smoother split resizing and faster workspace loading."},{"title":"Streamlined Single-Click Setup","description":"Windows installation is now completely silent and lock-free, with instant setup and automatic workspace layout restoration on launch."},{"title":"Fluid Floating Island Transitions","description":"Refined hovering and edge cursor tracking for floating window controls, preventing accidental window collapses and preserving direct click access to underlying web elements."}]},{"category":"Bug Fixes","items":[{"title":"Resilient Split Pane Sessions","description":"Closing a split pane no longer triggers unnecessary page reloads or active session interruptions in adjacent open panes."},{"title":"Reliable Embedded Shortcut Handling","description":"Fixed an issue where keyboard navigation shortcuts could become unresponsive while focused inside web panels, restoring instant focus upon clicking into any pane."},{"title":"Display Scaling Alignment","description":"Resolved an issue where interactive workspace preview tiles appeared scaled down or misaligned on smaller displays."},{"title":"Login Compatibility","description":"Eliminated unexpected firewall prompts and resolved authentication dialog blocks across third-party web services."}]}],"highlights":[{"title":"Seamless System Browser Sign-In","description":"Sign in to Google Workspace, Slack, Notion, and other protected services using your default browser with 1-click verification."},{"title":"Pane Context Menu & Reload Controls","description":"Right-click anywhere in an active pane to access quick navigation, clipboard tools, pane splitting, and workspace layout controls, or quickly refresh active panes using standard keyboard shortcuts (Ctrl+R / F5 / Ctrl+Shift+R)."},{"title":"Performance & Memory Efficiency","description":"Dramatically reduced memory consumption and input latency when running demanding web applications like Canva and Figma, with smoother split resizing and faster workspace loading."}]},{"version":"1.1.2","tag":"v1.1.2","title":"Zero-Reload Split Persistence & 120 FPS Resizing","publishedAt":"2026-08-13","categories":[{"category":"Improvements","items":[{"title":"Added options in the Windows","description":"Added options in the Windows installer to create Desktop and Start Menu shortcuts, and enable one-click launch immediately after installation."},{"title":"Integrated single-instance protection to prevent","description":"Integrated single-instance protection to prevent accidental duplicate instances and ensure smooth window focusing."},{"title":"Pane state and active documents","description":"Pane state and active documents now remain completely persistent without reloading during split navigation, tab changes, and dragging, alongside real-time 120 FPS split resizing."}]},{"category":"Bug Fixes","items":[{"title":"Fixed an issue where first-time","description":"Fixed an issue where first-time installations could render an empty screen by guaranteeing robust default workspace and tab initialization."}]}],"highlights":[{"title":"Added options in the Windows","description":"Added options in the Windows installer to create Desktop and Start Menu shortcuts, and enable one-click launch immediately after installation."},{"title":"Integrated single-instance protection to prevent","description":"Integrated single-instance protection to prevent accidental duplicate instances and ensure smooth window focusing."},{"title":"Pane state and active documents","description":"Pane state and active documents now remain completely persistent without reloading during split navigation, tab changes, and dragging, alongside real-time 120 FPS split resizing."}]},{"version":"1.1.1","tag":"v1.1.1","title":"Layout History, Spatial Keyboard Swapping & Crash Recovery","publishedAt":"2026-08-12","categories":[{"category":"Features","items":[{"title":"Added support for Layout History","description":"Added support for Layout History with Undo (Ctrl+Alt+Z) and Redo (Ctrl+Alt+Y), allowing you to instantly revert layout adjustments."},{"title":"Added keyboard shortcuts (Alt+Shift+Arrows) to","description":"Added keyboard shortcuts (Alt+Shift+Arrows) to swiftly swap adjacent panels or cycle stacking direction at screen edges."},{"title":"Added visual audio activity indicators","description":"Added visual audio activity indicators on active tabs to easily identify audio sources across complex multi-pane workspaces."},{"title":"Added intelligent address bar navigation","description":"Added intelligent address bar navigation for local development ports, alongside a one-click terminal install option."}]},{"category":"Improvements","items":[{"title":"Added tactile splitter handles, clean","description":"Added tactile splitter handles, clean boundary previews when docking panels, and a self-healing layout recovery system."},{"title":"Completely redesigned the pane toolbar","description":"Completely redesigned the pane toolbar with a jitter-free tactile aesthetic and refined double-bezel styling."},{"title":"Upgraded tab hover tooltips to","description":"Upgraded tab hover tooltips to instantly display rich session context with a polished tactile feel."},{"title":"Enhanced workspace docking and pane","description":"Enhanced workspace docking and pane splitting reliability with smoother drag transitions and robust offline session persistence."}]},{"category":"Bug Fixes","items":[{"title":"Fixed a startup crash on","description":"Fixed a startup crash on Windows and macOS caused by an engine compilation mismatch, and ensured the official Apposition icon displays correctly across all desktop platforms."},{"title":"Resolved an issue where dragging","description":"Resolved an issue where dragging panels in workspaces with multiple panes could cause duplicate panels, layout freezes, or dropped keyboard shortcuts."},{"title":"Resolved an issue where closing","description":"Resolved an issue where closing the final tab or pane in a workspace could cause the interface to freeze or display an empty background."},{"title":"Resolved navigation bugs that caused","description":"Resolved navigation bugs that caused the search input to occasionally lose typed text or drop focus when switching workspaces."},{"title":"Resolved an issue where rapidly","description":"Resolved an issue where rapidly switching workspaces could cause tabs to display the wrong environment."}]}],"highlights":[{"title":"Added support for Layout History","description":"Added support for Layout History with Undo (Ctrl+Alt+Z) and Redo (Ctrl+Alt+Y), allowing you to instantly revert layout adjustments."},{"title":"Added keyboard shortcuts (Alt+Shift+Arrows) to","description":"Added keyboard shortcuts (Alt+Shift+Arrows) to swiftly swap adjacent panels or cycle stacking direction at screen edges."},{"title":"Added tactile splitter handles, clean","description":"Added tactile splitter handles, clean boundary previews when docking panels, and a self-healing layout recovery system."}]},{"version":"1.1.0","tag":"v1.1.0","title":"Seamless Updates, Standalone Inspector & Draggable Tabs","publishedAt":"2026-08-12","categories":[{"category":"Features","items":[{"title":"Apposition now automatically detects new","description":"Apposition now automatically detects new versions and lets you restart to apply them with a single click."},{"title":"Added a manual \\"Check for","description":"Added a manual \\"Check for Updates\\" button in the Account Settings menu."},{"title":"Opening the Inspector (F12) now","description":"Opening the Inspector (F12) now launches a clean, standalone floating window instead of squeezing into a sidebar."},{"title":"You can now view our","description":"You can now view our latest release notes in a dedicated popover and submit feedback directly from the new sidebar Support Cluster without leaving your workspace."},{"title":"Opening external links from the","description":"Opening external links from the changelog now seamlessly creates a new workspace tab instead of launching an external browser."}]},{"category":"Improvements","items":[{"title":"Dragging a pane to the","description":"Dragging a pane to the edge of the screen to switch tabs or workspaces is now significantly faster, visually sharper, and correctly transfers the pane without it disappearing."},{"title":"Dragging a pane into an","description":"Dragging a pane into an empty tab now cleanly replaces it with a clear visual drop preview, and moving panes between tabs no longer leaves behind orphaned blank tabs."},{"title":"Dragging the last panel out","description":"Dragging the last panel out of a tab or workspace now automatically cleans up the empty space instead of leaving an abandoned tab."}]},{"category":"Bug Fixes","items":[{"title":"Re-engineered the window manager to","description":"Re-engineered the window manager to completely eliminate cursor jitter and flickering when hovering over panes, while ensuring floating buttons and menus remain perfectly responsive."},{"title":"Resolved multi-window shortcut conflicts, ensuring","description":"Resolved multi-window shortcut conflicts, ensuring actions like splitting panels, closing tabs, and swiping between workspaces are perfectly instantaneous and correctly targeted."},{"title":"Fixed an issue where the","description":"Fixed an issue where the search bar would not automatically receive keyboard focus when opening a new tab or switching back to an empty tab."},{"title":"Resolved an issue that caused","description":"Resolved an issue that caused active workspace panels to unexpectedly refresh or blink when opening the settings menu."}]}],"highlights":[{"title":"Apposition now automatically detects new","description":"Apposition now automatically detects new versions and lets you restart to apply them with a single click."},{"title":"Added a manual \\"Check for","description":"Added a manual \\"Check for Updates\\" button in the Account Settings menu."},{"title":"Dragging a pane to the","description":"Dragging a pane to the edge of the screen to switch tabs or workspaces is now significantly faster, visually sharper, and correctly transfers the pane without it disappearing."}]},{"version":"1.0.0","tag":"v1.0.0","title":"Initial Launch of Apposition","publishedAt":"2026-08-02","categories":[{"category":"Features","items":[{"title":"Multi-Pane Workspace Canvas","description":"The digital workspace designed for deep parallel work without tab chaos."}]}],"highlights":[{"title":"Multi-Pane Workspace Canvas","description":"Organize web applications and accounts in one unified window."}]}]');
function initChangelogIpc() {
  electron.ipcMain.handle(IPC_CHANNELS.CHANGELOG.GET_STATUS, () => {
    const currentVersion = electron.app.getVersion();
    if (currentVersion.includes("-")) {
      return { shouldShowWhatsNew: false, currentVersion, lastSeenVersion: currentVersion };
    }
    const lastSeen = getLastSeenVersion();
    const evaluation = evaluateUpgradeState(lastSeen, currentVersion);
    if (evaluation.isFreshInstall) {
      setLastSeenVersion(evaluation.nextVersionToCommit);
      return {
        shouldShowWhatsNew: false,
        currentVersion,
        lastSeenVersion: null
      };
    }
    if (evaluation.shouldShowWhatsNew) {
      return {
        shouldShowWhatsNew: true,
        currentVersion,
        lastSeenVersion: lastSeen,
        latestRelease: currentRelease
      };
    }
    return {
      shouldShowWhatsNew: false,
      currentVersion,
      lastSeenVersion: lastSeen
    };
  });
  electron.ipcMain.handle(IPC_CHANNELS.CHANGELOG.MARK_SEEN, () => {
    const targetVersion = electron.app.getVersion();
    setLastSeenVersion(targetVersion);
    return { success: true, version: targetVersion };
  });
  electron.ipcMain.handle(IPC_CHANNELS.CHANGELOG.GET_RELEASES, () => {
    return allReleases;
  });
}
function initAuthIpc() {
  electron.ipcMain.handle(
    IPC_CHANNELS.AUTH.CLEAR_SITE_DATA,
    async (_event, origin, profileId) => {
      try {
        if (!origin) return { success: false, error: "Missing origin" };
        const partition = profileId ? profileId === "main" ? "persist:main" : `persist:${profileId}` : "persist:main";
        const targetSession = electron.session.fromPartition(partition);
        await targetSession.clearStorageData({
          origin,
          storages: [
            "cookies",
            "localstorage",
            "serviceworkers",
            "cachestorage"
          ]
        });
        return { success: true };
      } catch (err) {
        console.error("Failed to clear site data:", err);
        return { success: false, error: err.message };
      }
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.AUTH.START_RELAY,
    async (_event, targetUrl, profileId, paneId) => {
      if (!targetUrl) return { success: false, error: "Missing URL" };
      return startAuthRelay(targetUrl, profileId || "main", paneId);
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.AUTH.CONNECT_ACCOUNT,
    async (_event, options) => {
      return openConnectAccountModal(options);
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.AUTH.DISCONNECT_ACCOUNT,
    async (_event, providerId, profileId = "main") => {
      return sessionIdentityService.disconnectProvider(profileId, providerId);
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.AUTH.SCAN_IDENTITIES,
    async (_event, profileId) => {
      try {
        if (profileId) {
          const identities = await sessionIdentityService.scanProfile(profileId);
          return { success: true, identities };
        }
        await sessionIdentityService.scanAllProfiles();
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.AUTH.OPEN_GOOGLE_AUTH,
    async (_event, options) => {
      return openConnectAccountModal({
        providerId: "google",
        loginUrl: options.url,
        profileId: options.profileId,
        paneId: options.paneId,
        returnUrl: options.returnUrl
      });
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.AUTH.EXPORT_VAULT,
    async (_event, profileId, secretKey) => {
      try {
        const partition = profileId ? profileId === "main" ? "persist:main" : `persist:${profileId}` : "persist:main";
        const targetSession = electron.session.fromPartition(partition);
        const cookies = await targetSession.cookies.get({});
        const encrypted = encryptSessionPayload(
          { profileId, cookies, exportedAt: Date.now() },
          secretKey
        );
        return { success: true, payload: encrypted };
      } catch (err) {
        console.error("Failed to export session vault:", err);
        return { success: false, error: err.message };
      }
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.AUTH.IMPORT_VAULT,
    async (_event, encryptedPayload, secretKey) => {
      try {
        const decrypted = decryptSessionPayload(encryptedPayload, secretKey);
        if (!decrypted || !decrypted.profileId || !Array.isArray(decrypted.cookies)) {
          return { success: false, error: "Invalid session payload or key" };
        }
        const partition = decrypted.profileId === "main" ? "persist:main" : `persist:${decrypted.profileId}`;
        const targetSession = electron.session.fromPartition(partition);
        for (const cookie of decrypted.cookies) {
          const scheme = cookie.secure ? "https" : "http";
          const domain = cookie.domain?.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
          const url = `${scheme}://${domain}${cookie.path || "/"}`;
          try {
            await targetSession.cookies.set({
              url,
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              expirationDate: cookie.expirationDate,
              sameSite: cookie.sameSite
            });
          } catch {
          }
        }
        return { success: true, profileId: decrypted.profileId };
      } catch (err) {
        console.error("Failed to import session vault:", err);
        return { success: false, error: err.message };
      }
    }
  );
}
const GMAIL_AMBIENT_CSS = `
  /* 1. Guaranteed Opaque Canvas Pipeline (Eliminates Bleed-Through) */
  html, body, #canvas_frame, .nH, .bkK, .aeN, .AO, .T-I-KE, div[role="main"], .dw, .no, .aKh, .ajl, .aAy, .gb_Ed, .gA {
    background-color: #ffffff !important;
    background: #ffffff !important;
  }
  @media (prefers-color-scheme: dark) {
    html, body, #canvas_frame, .nH, .bkK, .aeN, .AO, .T-I-KE, div[role="main"], .dw, .no, .aKh, .ajl, .aAy, .gb_Ed, .gA {
      background-color: #141415 !important;
      background: #141415 !important;
      color: #e5e5e5 !important;
    }
  }

  /* 2. Hide bulky Google Add-ons right side panel & Meet/Chat widgets */
  [aria-label="Side panel"], div[role="complementary"], .bq9,
  div[aria-label="Meet"], div[aria-label="Hangouts"], div[aria-label="Chat"], .aYF, .aT5 {
    display: none !important;
  }

  /* 3. Streamline Top Search & Header Banner */
  header[role="banner"] {
    padding-left: 8px !important;
    padding-right: 8px !important;
    height: 48px !important;
    min-height: 48px !important;
  }
  header[role="banner"] form {
    max-width: 480px !important;
  }

  /* 4. Streamline Left Sidebar Density */
  .aeN {
    min-width: 180px !important;
  }
  .w-asV {
    width: auto !important;
  }

  /* 5. Precision Grayscale Monochromatic Scrollbars */
  ::-webkit-scrollbar {
    width: 5px !important;
    height: 5px !important;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(120, 113, 108, 0.35) !important;
    border-radius: 4px !important;
  }
  ::-webkit-scrollbar-track {
    background: transparent !important;
  }
`;
const SLACK_AMBIENT_CSS = `
  /* Guaranteed Opaque Canvas Pipeline for Slack */
  html, body, .p-client_container, .p-client, .p-view_contents, .p-workspace_layout {
    background-color: #1a1d21 !important;
  }
  /* Hide desktop download prompts */
  .p-download_banner, .p-get_desktop_app_banner {
    display: none !important;
  }
  /* Sleek scrollbars */
  ::-webkit-scrollbar {
    width: 5px !important;
    height: 5px !important;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(120, 113, 108, 0.35) !important;
    border-radius: 4px !important;
  }
  ::-webkit-scrollbar-track {
    background: transparent !important;
  }
`;
const GENERIC_MESSENGER_CSS = `
  /* Guaranteed Opaque Canvas Pipeline for Generic Messengers */
  html, body {
    background-color: #ffffff !important;
  }
  @media (prefers-color-scheme: dark) {
    html, body {
      background-color: #141415 !important;
    }
  }
  /* Sleek monochromatic scrollbars */
  ::-webkit-scrollbar {
    width: 5px !important;
    height: 5px !important;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(120, 113, 108, 0.35) !important;
    border-radius: 4px !important;
  }
  ::-webkit-scrollbar-track {
    background: transparent !important;
  }
`;
function injectCommunicatorRecipe(webContents, url) {
  try {
    const u = url.toLowerCase();
    if (u.includes("mail.google.com")) {
      webContents.insertCSS(GMAIL_AMBIENT_CSS).catch(() => {
      });
    } else if (u.includes("slack.com")) {
      webContents.insertCSS(SLACK_AMBIENT_CSS).catch(() => {
      });
    } else {
      webContents.insertCSS(GENERIC_MESSENGER_CSS).catch(() => {
      });
    }
  } catch {
  }
}
class CommunicatorService {
  views = /* @__PURE__ */ new Map();
  activeAppId = "slack";
  updateAppUnread(appId, info) {
    global.appOverlayView?.webContents.send("communicator.unread-updated", {
      appId,
      unreadCount: info.count
    });
  }
  getOrCreateView(win, appId, customPartition, customUrl) {
    if (this.views.has(appId)) return this.views.get(appId);
    if (!customUrl) return void 0;
    const partition = customPartition || "persist:main";
    const view = new electron.WebContentsView({
      webPreferences: {
        preload: resolvePreload("pane.js"),
        partition,
        contextIsolation: true,
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: false
      }
    });
    view.setBackgroundColor("#ffffff");
    try {
      view.webContents.setZoomMode("isolated");
    } catch {
    }
    view.webContents.setUserAgent(DEFAULT_DESKTOP_UA);
    bindGuestCursor(view.webContents, appId);
    view.webContents.on("will-navigate", (_e, navUrl) => {
      if (isGoogleOAuthEndpoint(navUrl)) {
        view.webContents.setUserAgent(FIREFOX_AUTH_UA);
      } else if (view.webContents.getUserAgent() === FIREFOX_AUTH_UA) {
        view.webContents.setUserAgent(DEFAULT_DESKTOP_UA);
      }
    });
    view.webContents.on("dom-ready", () => {
      view.webContents.executeJavaScript(ANTI_DETECTION_SCRIPT).catch(() => {
      });
      injectCommunicatorRecipe(view.webContents, view.webContents.getURL());
      try {
        const bounds = view.getBounds();
        const targetZoom = Math.min(1, Math.max(0.72, (bounds.width || 600) / 760));
        view.webContents.setZoomFactor(targetZoom);
      } catch {
      }
    });
    view.webContents.on("did-navigate", () => {
      view.webContents.executeJavaScript(ANTI_DETECTION_SCRIPT).catch(() => {
      });
      injectCommunicatorRecipe(view.webContents, view.webContents.getURL());
    });
    view.webContents.on("page-title-updated", () => {
      const title2 = view.webContents.getTitle();
      const info = extractUnreadBadgeFromTitle(title2);
      this.updateAppUnread(appId, info);
    });
    view.webContents.on("before-input-event", (e, input) => {
      handleBeforeInputEvent(view.webContents, e, input);
    });
    view.webContents.setWindowOpenHandler((details) => {
      if (isGoogleOAuthEndpoint(details.url) || details.url.includes("login") || details.url.includes("auth")) {
        view.webContents.loadURL(details.url);
        return { action: "deny" };
      }
      return { action: "allow" };
    });
    view.webContents.loadURL(customUrl);
    this.views.set(appId, view);
    return view;
  }
  showDrawerView(win, appId, rect, partition, url) {
    this.activeAppId = appId;
    for (const [id, v] of this.views.entries()) {
      if (id !== appId) {
        removeCommunicator(win, id);
        try {
          v.setBounds({ x: -1e4, y: -1e4, width: 0, height: 0 });
        } catch {
        }
      }
    }
    const view = this.getOrCreateView(win, appId, partition, url);
    if (!view) return;
    if (isValidPhysicalRect(rect)) {
      const dpr = devicePixelRatioFor(win);
      const phys = toPhysicalRect(rect, dpr);
      placeCommunicator(win, appId, view, { ...phys, cssLeft: rect.x, cssTop: rect.y });
      view.setBounds(rect);
      try {
        const targetZoom = Math.min(1, Math.max(0.68, rect.width / 820));
        const currentZoom = view.webContents.getZoomFactor();
        if (Math.abs(currentZoom - targetZoom) > 0.02) {
          view.webContents.setZoomFactor(targetZoom);
        }
      } catch {
      }
    }
  }
  async captureAppSnapshot(appId) {
    const view = this.views.get(appId);
    if (!view || view.webContents.isDestroyed()) return null;
    try {
      const image = await view.webContents.capturePage();
      if (image.isEmpty()) return null;
      return image.toDataURL();
    } catch {
      return null;
    }
  }
  destroyView(win, appId) {
    const view = this.views.get(appId);
    if (view) {
      if (win) removeCommunicator(win, appId);
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
      this.views.delete(appId);
    }
  }
  reloadApp(appId) {
    const targetId = appId || this.activeAppId;
    const view = this.views.get(targetId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload();
    }
  }
  hideDrawerView(win) {
    for (const [id, view] of this.views.entries()) {
      removeCommunicator(win, id);
      try {
        view.setBounds({ x: -1e4, y: -1e4, width: 0, height: 0 });
      } catch {
      }
    }
  }
}
const communicatorService = new CommunicatorService();
function initCommunicatorIpc(getWindow) {
  electron.ipcMain.handle("communicator.getState", async () => {
    try {
      return getCommunicatorState();
    } catch (err) {
      console.error("[Communicator IPC] Failed to get state:", err);
      return { stacks: [], providers: [] };
    }
  });
  electron.ipcMain.handle("communicator.createStack", async (_e, id, name, icon) => {
    try {
      createCommunicatorStack(id, name, icon);
      return { success: true };
    } catch (err) {
      console.error("[Communicator IPC] Failed to create stack:", err);
      return { success: false, error: String(err) };
    }
  });
  electron.ipcMain.handle("communicator.updateStack", async (_e, id, name, icon) => {
    try {
      updateCommunicatorStack(id, name, icon);
      return { success: true };
    } catch (err) {
      console.error("[Communicator IPC] Failed to update stack:", err);
      return { success: false, error: String(err) };
    }
  });
  electron.ipcMain.handle("communicator.deleteStack", async (_e, id) => {
    try {
      deleteCommunicatorStack(id);
      return { success: true };
    } catch (err) {
      console.error("[Communicator IPC] Failed to delete stack:", err);
      return { success: false, error: String(err) };
    }
  });
  electron.ipcMain.handle(
    "communicator.createApp",
    async (_e, id, stackId, profileId, name, url, icon) => {
      try {
        createCommunicatorApp(id, stackId, profileId, name, url, icon);
        return { success: true };
      } catch (err) {
        console.error("[Communicator IPC] Failed to create app:", err);
        return { success: false, error: String(err) };
      }
    }
  );
  electron.ipcMain.handle(
    "communicator.updateApp",
    async (_e, id, updates) => {
      try {
        updateCommunicatorApp(id, updates);
        return { success: true };
      } catch (err) {
        console.error("[Communicator IPC] Failed to update app:", err);
        return { success: false, error: String(err) };
      }
    }
  );
  electron.ipcMain.handle("communicator.deleteApp", async (_e, id) => {
    try {
      const win = getWindow();
      communicatorService.destroyView(win, id);
      deleteCommunicatorApp(id);
      return { success: true };
    } catch (err) {
      console.error("[Communicator IPC] Failed to delete app:", err);
      return { success: false, error: String(err) };
    }
  });
  electron.ipcMain.handle("communicator.saveProvider", async (_e, provider) => {
    try {
      saveCommunicatorProvider(provider);
      return { success: true };
    } catch (err) {
      console.error("[Communicator IPC] Failed to save provider:", err);
      return { success: false, error: String(err) };
    }
  });
  electron.ipcMain.handle("communicator.deleteProvider", async (_e, id) => {
    try {
      deleteCommunicatorProvider(id);
      return { success: true };
    } catch (err) {
      console.error("[Communicator IPC] Failed to delete provider:", err);
      return { success: false, error: String(err) };
    }
  });
  electron.ipcMain.handle("communicator.captureSnapshot", async (_e, appId) => {
    try {
      return await communicatorService.captureAppSnapshot(appId);
    } catch (err) {
      console.error("[Communicator IPC] Failed to capture snapshot:", err);
      return null;
    }
  });
  electron.ipcMain.on("communicator.showDrawer", (_e, appId, rect, partition, url) => {
    try {
      const win = getWindow();
      if (win) communicatorService.showDrawerView(win, appId, rect, partition, url);
    } catch (err) {
      console.error("[Communicator IPC] Failed to show drawer view:", err);
    }
  });
  electron.ipcMain.on("communicator.hideDrawer", () => {
    try {
      const win = getWindow();
      if (win) communicatorService.hideDrawerView(win);
    } catch (err) {
      console.error("[Communicator IPC] Failed to hide drawer view:", err);
    }
  });
  electron.ipcMain.on("communicator.destroyView", (_e, appId) => {
    try {
      const win = getWindow();
      communicatorService.destroyView(win, appId);
    } catch (err) {
      console.error("[Communicator IPC] Failed to destroy view:", err);
    }
  });
  electron.ipcMain.on("communicator.reloadApp", (_e, appId) => {
    try {
      communicatorService.reloadApp(appId);
    } catch (err) {
      console.error("[Communicator IPC] Failed to reload app:", err);
    }
  });
}
const patchedSessions = /* @__PURE__ */ new WeakSet();
function configureSessionSecurity(session) {
  if (!session || patchedSessions.has(session) || session.__securityHeadersBound) return;
  patchedSessions.add(session);
  session.__securityHeadersBound = true;
  const chromeVersion = process.versions.chrome || "144.0.7550.80";
  const platformName = process.platform === "darwin" ? "macOS" : process.platform === "linux" ? "Linux" : "Windows";
  const clientHints = generateClientHints(chromeVersion, platformName);
  session.setUserAgent(DEFAULT_DESKTOP_UA);
  configureWebAuthnForSession(session);
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (permission === "geolocation") return false;
    if (permission === "private-network-access" || permission === "local-network-access") {
      if (!requestingOrigin) return false;
      try {
        const url = new URL(requestingOrigin);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
      } catch {
        return false;
      }
    }
    return true;
  });
  let flushTimer = null;
  try {
    session.cookies.on("changed", (_event, cookie, cause) => {
      if ((cause === "explicit" || cause === "overwrite") && (["d", "SID"].includes(cookie.name) || ["token", "session", "auth"].some((k) => cookie.name.includes(k)))) {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
          flushTimer = null;
          session.cookies.flushStore().catch(() => {
          });
        }, 2e3);
      }
    });
  } catch {
  }
  session.webRequest.onBeforeSendHeaders(
    { urls: ["https://*/*", "http://*/*"] },
    (details, callback) => {
      const url = details.url || "";
      if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:") || url.startsWith("ws://")) {
        callback({ cancel: false });
        return;
      }
      if (details.method === "OPTIONS") {
        callback({ cancel: false });
        return;
      }
      if (!details.url || !details.url.startsWith("http://") && !details.url.startsWith("https://")) {
        callback({ cancel: false });
        return;
      }
      try {
        const sanitized = sanitizeRequestHeaders(
          details.requestHeaders || {},
          clientHints,
          details.url
        );
        callback({ requestHeaders: sanitized });
      } catch {
        callback({ requestHeaders: details.requestHeaders || {} });
      }
    }
  );
}
function initSessionSecurity() {
  if (electron.session.defaultSession) {
    configureSessionSecurity(electron.session.defaultSession);
  }
  electron.app.on("session-created", (session) => {
    configureSessionSecurity(session);
  });
  electron.app.on("browser-window-created", (_, popupWin) => {
    const isAppWindow = popupWin === global.mainWindow || popupWin === global.overlayWindow || popupWin.__isMainWindow || popupWin.__isTearWindow;
    if (isAppWindow) return;
    popupWin.webContents.on("will-navigate", (_e, navUrl) => {
      if (isGoogleAuthUrl(navUrl)) {
        popupWin.webContents.setUserAgent(FIREFOX_AUTH_UA);
      }
    });
    popupWin.webContents.on("did-navigate", (_e, navUrl) => {
      if (isGoogleAuthUrl(navUrl)) {
        popupWin.webContents.setUserAgent(FIREFOX_AUTH_UA);
      }
      popupWin.webContents.executeJavaScript(ANTI_DETECTION_SCRIPT).catch(() => {
      });
      const lower = (navUrl || "").toLowerCase();
      if (lower.startsWith("apposition://") || lower.includes("localhost:5174/#oauth-success")) {
        setTimeout(() => {
          if (!popupWin.isDestroyed()) popupWin.close();
        }, 300);
      }
    });
    popupWin.webContents.on("dom-ready", () => {
      popupWin.webContents.executeJavaScript(ANTI_DETECTION_SCRIPT).catch(() => {
      });
    });
  });
  electron.app.on("web-contents-created", (_, webContents) => {
    configureSessionSecurity(webContents.session);
    webContents.on("dom-ready", () => {
      webContents.executeJavaScript(ANTI_DETECTION_SCRIPT).catch(() => {
      });
    });
    webContents.on("did-navigate", () => {
      webContents.executeJavaScript(ANTI_DETECTION_SCRIPT).catch(() => {
      });
    });
    webContents.on("focus", () => {
      if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
        global.appOverlayView.webContents.send("view.focus-wc", webContents.id);
      }
    });
    webContents.on("context-menu", (_event, params) => {
      if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
        global.appOverlayView.webContents.send("view.context-menu-native", {
          webContentsId: webContents.id,
          x: params.x,
          y: params.y,
          linkURL: params.linkURL || "",
          srcURL: params.srcURL || "",
          pageURL: params.pageURL || (typeof webContents.getURL === "function" ? webContents.getURL() : ""),
          selectionText: params.selectionText || ""
        });
      }
    });
    handleWebContentsWindowOpen(webContents);
    webContents.on("render-process-gone", (_event, details) => {
      if (details.reason === "oom" || details.reason === "crashed" || details.reason === "killed") {
        if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
          global.appOverlayView.webContents.send("pane.crashed", {
            webContentsId: webContents.id,
            reason: details.reason,
            exitCode: details.exitCode
          });
        }
      }
    });
  });
  electron.app.on("child-process-gone", (_event, details) => {
    if (details.type === "GPU" && details.reason === "crashed") {
      console.warn("GPU Process Crashed. Electron will restart it.");
    }
  });
}
function initNetworkOptimizer() {
  const defaultSession = electron.session.defaultSession;
  electron.ipcMain.on("net.prefetch", (_, rawUrl) => {
    if (!rawUrl) return;
    try {
      let hostname = rawUrl;
      if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
        hostname = new URL(rawUrl).hostname;
      }
      if (hostname && typeof defaultSession.resolveHost === "function") {
        defaultSession.resolveHost(hostname).catch(() => {
        });
      }
    } catch {
    }
  });
}
function initUpdaterIpc() {
  updateEngine.init();
  electron.ipcMain.handle(IPC_CHANNELS.UPDATER.GET_STATE, () => {
    return updateEngine.getState();
  });
  electron.ipcMain.handle(IPC_CHANNELS.UPDATER.CHECK, async () => {
    return updateEngine.checkForUpdates(false);
  });
  electron.ipcMain.handle(IPC_CHANNELS.UPDATER.DOWNLOAD, async () => {
    return updateEngine.downloadUpdate();
  });
  electron.ipcMain.handle(IPC_CHANNELS.UPDATER.APPLY, async () => {
    return updateEngine.applyUpdate();
  });
  electron.ipcMain.handle(IPC_CHANNELS.UPDATER.OPEN_EXTERNAL, async (_, url) => {
    if (url && (url.startsWith("https://") || url.startsWith("http://"))) {
      await electron.shell.openExternal(url);
      return true;
    }
    return false;
  });
}
function initDiagnosticsIpc(logFilePath, isDevMode2) {
  electron.ipcMain.handle("diagnostics.getHealth", () => {
    return {
      uptimeSec: Math.floor(process.uptime()),
      ...runtimeState.getState()
    };
  });
  electron.ipcMain.handle("diagnostics.getErrors", () => {
    return flightRecorder.getErrors();
  });
  electron.ipcMain.handle("diagnostics.getFlightRecorder", () => {
    return flightRecorder.snapshot();
  });
  electron.ipcMain.handle("diagnostics.toggleGuestNoise", () => {
    const next = !runtimeState.getState().guestLogsMuted;
    runtimeState.setGuestLogsMuted(next);
    return next;
  });
  electron.ipcMain.handle("diagnostics.openLogFile", () => {
    electron.shell.openPath(logFilePath);
  });
}
function initDevCommandBridge(isDevMode2) {
  if (!isDevMode2) return;
  const cmdPath = path.join(electron.app.getPath("userData"), ".apposition-command.json");
  const checkCommand = () => {
    if (!fs.existsSync(cmdPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(cmdPath, "utf8"));
      fs.unlinkSync(cmdPath);
      if (data.command === "reload") {
        if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
          logger$6.info("Soft reloading app overlay view via dev command");
          global.appOverlayView.webContents.reload();
        }
      } else if (data.command === "quit") {
        logger$6.info("Gracefully quitting via dev command");
        electron.app.quit();
      }
    } catch {
    }
  };
  try {
    const dir = electron.app.getPath("userData");
    fs.watch(dir, (_event, filename) => {
      if (filename && filename.includes(".apposition-command.json")) {
        checkCommand();
      }
    });
  } catch {
    setInterval(checkCommand, 1e3);
  }
}
function setupMacApplicationMenu() {
  if (process.platform !== "darwin") {
    electron.Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: electron.app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    }
  ];
  const menu = electron.Menu.buildFromTemplate(template);
  electron.Menu.setApplicationMenu(menu);
}
function initCatalogService() {
  electron.ipcMain.handle(IPC_CHANNELS.CATALOG.GET_DISCOVERED, async () => {
    return getDiscoveredApps();
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.CATALOG.SAVE_DISCOVERED,
    async (_e, app) => {
      saveDiscoveredApp(app);
      return true;
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.CATALOG.DELETE_DISCOVERED,
    async (_e, domain) => {
      deleteDiscoveredApp(domain);
      return true;
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.CATALOG.SAVE_USER_PRESET,
    async (_e, preset) => {
      saveUserPreset(preset);
      return true;
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.CATALOG.GET_USER_PRESETS,
    async (_e, workspaceId) => {
      return getUserPresets(workspaceId);
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.CATALOG.DELETE_USER_PRESET,
    async (_e, id) => {
      deleteUserPreset(id);
      return true;
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.CATALOG.RECORD_SPLIT_SESSION,
    async (_e, session) => {
      recordSplitSession(session);
      return true;
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.CATALOG.GET_LAST_SPLIT_SESSION,
    async (_e, workspaceId) => {
      return getLastSplitSession(workspaceId);
    }
  );
  electron.ipcMain.on(
    "pane.manifest-harvested",
    (_e, data) => {
      if (!data.url || !data.url.startsWith("http")) return;
      try {
        const u = new URL(data.url);
        const domain = u.hostname;
        if (domain === "localhost" || domain.endsWith(".local") || domain === "127.0.0.1" || domain.includes("google.com/search")) {
          return;
        }
        let name = data.title || domain;
        if (name.includes(" - ")) {
          name = name.split(" - ")[0].trim();
        } else if (name.includes(" | ")) {
          name = name.split(" | ")[0].trim();
        }
        const discovered = {
          domain,
          name: name.slice(0, 40),
          url: `${u.protocol}//${u.host}`,
          iconUrl: data.iconUrl,
          themeColor: data.themeColor,
          discoveredAt: Date.now()
        };
        saveDiscoveredApp(discovered);
        global.appOverlayView?.webContents.send(
          "catalog.app-discovered",
          discovered
        );
      } catch (err) {
        console.warn("[Catalog Manifest] Failed to parse harvested URL:", err);
      }
    }
  );
}
const t = server.initTRPC.create();
const router = t.router;
const publicProcedure = t.procedure;
t.middleware;
const createCallerFactory = t.createCallerFactory;
const mediaRouter = router({
  getActiveSources: publicProcedure.query(() => {
    return Array.from(audioMatrix["sources"]?.values?.() || []);
  }),
  toggleMute: publicProcedure.input(zod.z.object({ paneId: zod.z.string() })).mutation(({ input }) => {
    return audioMatrix.toggleMute(input.paneId);
  }),
  setMuted: publicProcedure.input(zod.z.object({ paneId: zod.z.string(), muted: zod.z.boolean() })).mutation(({ input }) => {
    audioMatrix.setAudioMuted(input.paneId, input.muted);
    return { success: true };
  }),
  toggleMasterMute: publicProcedure.mutation(() => {
    return audioMatrix.toggleMasterMute();
  })
});
const screenRouter = router({
  getAvailableSources: publicProcedure.query(async () => {
    return screenCaptureService.getAvailableSources();
  }),
  selectSource: publicProcedure.input(
    zod.z.object({
      requestId: zod.z.string(),
      sourceId: zod.z.string().nullable()
    })
  ).mutation(async ({ input }) => {
    const success = await screenCaptureService.selectSource(
      input.requestId,
      input.sourceId
    );
    return { success };
  }),
  cancelRequest: publicProcedure.input(zod.z.object({ requestId: zod.z.string() })).mutation(({ input }) => {
    screenCaptureService.cancelRequest(input.requestId);
    return { success: true };
  })
});
const hibernationRouter = router({
  wakePane: publicProcedure.input(
    zod.z.object({
      paneId: zod.z.string(),
      overrideUrl: zod.z.string().optional(),
      rect: zod.z.object({
        x: zod.z.number(),
        y: zod.z.number(),
        width: zod.z.number(),
        height: zod.z.number()
      }).optional()
    })
  ).mutation(async ({ input }) => {
    const success = await hibernationEngine.wakePane(
      input.paneId,
      input.overrideUrl,
      input.rect
    );
    return { success };
  }),
  hibernatePane: publicProcedure.input(zod.z.object({ paneId: zod.z.string(), force: zod.z.boolean().optional() })).mutation(async ({ input }) => {
    const success = await hibernationEngine.hibernatePane(input.paneId, { force: input.force });
    return { success };
  }),
  freezePane: publicProcedure.input(zod.z.object({ paneId: zod.z.string() })).mutation(async ({ input }) => {
    const success = await hibernationEngine.freezePane(input.paneId);
    return { success };
  }),
  thawPane: publicProcedure.input(zod.z.object({ paneId: zod.z.string() })).mutation(async ({ input }) => {
    const success = await hibernationEngine.thawPane(input.paneId);
    return { success };
  }),
  warmupPane: publicProcedure.input(zod.z.object({ paneId: zod.z.string() })).mutation(async ({ input }) => {
    if (hibernationEngine.isFrozen(input.paneId)) {
      await hibernationEngine.thawPane(input.paneId);
      return { success: true, action: "thawed" };
    }
    if (hibernationEngine.isHibernated(input.paneId)) {
      await hibernationEngine.wakePane(input.paneId);
      return { success: true, action: "woken" };
    }
    return { success: true, action: "none" };
  }),
  getHibernatedStatus: publicProcedure.input(zod.z.object({ paneId: zod.z.string() })).query(({ input }) => {
    const desc = viewRegistry.getHibernated(input.paneId);
    const isFrozen = hibernationEngine.isFrozen(input.paneId);
    return {
      isHibernated: Boolean(desc),
      isFrozen,
      descriptor: desc || null
    };
  }),
  getStats: publicProcedure.query(() => {
    return hibernationEngine.getStats();
  }),
  setActiveTabPanes: publicProcedure.input(zod.z.object({ paneIds: zod.z.array(zod.z.string()) })).mutation(async ({ input }) => {
    hibernationEngine.setActiveTabPanes(input.paneIds);
    return { success: true };
  }),
  setAppMinimized: publicProcedure.input(zod.z.object({ isMinimized: zod.z.boolean() })).mutation(async ({ input }) => {
    hibernationEngine.setAppMinimized(input.isMinimized);
    return { success: true };
  }),
  setThresholds: publicProcedure.input(zod.z.object({ freezeMs: zod.z.number().optional(), hibernateMs: zod.z.number().optional() })).mutation(({ input }) => {
    hibernationEngine.setThresholds(input.freezeMs, input.hibernateMs);
    return { success: true };
  })
});
const appRouter = router({
  media: mediaRouter,
  screen: screenRouter,
  hibernation: hibernationRouter
});
const createCaller = createCallerFactory(appRouter);
function initTrpcIpcAdapter() {
  const caller = createCaller({});
  electron.ipcMain.handle(
    "trpc-ipc",
    async (_event, req) => {
      try {
        const parts = req.path.split(".");
        let target = caller;
        for (const part of parts) {
          if (target == null) break;
          target = target[part];
        }
        if (typeof target !== "function") {
          throw new Error(`Invalid tRPC procedure path: ${req.path}`);
        }
        const data = await target(req.input);
        return { ok: true, data };
      } catch (err) {
        console.error(`[tRPC-IPC error at ${req.path}]:`, err);
        return { ok: false, error: err?.message || String(err) };
      }
    }
  );
}
let servicesInitialized = false;
function initGlobalServices(logFile, isDevMode2) {
  if (servicesInitialized) return;
  servicesInitialized = true;
  initUpdaterIpc();
  idleAutoUpdater.init();
  setupMacApplicationMenu();
  utils.electronApp.setAppUserModelId(
    isDevMode2 ? "com.jvondev.apposition.dev" : "com.jvondev.apposition.app"
  );
  electron.nativeTheme.themeSource = "light";
  gcDeletedSessions();
  initNetworkOptimizer();
  initSessionSecurity();
  initSessionPersistenceHooks();
  initWindowManagerIpc();
  initViewManager();
  initDbIpc();
  initLicensingIpc();
  initChangelogIpc();
  initAuthIpc();
  initProxyIpc();
  proxyCredentialBroker.init(electron.app);
  sessionIdentityService.init();
  initCatalogService();
  initCommunicatorIpc(() => global.mainWindow || void 0);
  initDiagnosticsIpc(logFile);
  initDevCommandBridge(isDevMode2);
  const guestLogger = createLogger("GUEST");
  electron.ipcMain.handle("pane.ping", () => "pong");
  electron.ipcMain.on("pane.log", (_event, level, ...args) => {
    const msg = args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    if (level === "ERROR") guestLogger.error(msg);
    else if (level === "WARN") guestLogger.warn(msg);
    else guestLogger.debug(msg);
  });
  electron.ipcMain.handle("metrics.memory", () => {
    return Promise.resolve(process.getProcessMemoryInfo());
  });
  electron.ipcMain.on("window.openExternal", (_, url) => {
    if (url && typeof url === "string") {
      electron.shell.openExternal(url);
    }
  });
  initPointerForwarder(() => global.mainWindow || void 0);
  initContextMenuCoordinator(() => global.mainWindow || void 0);
  initOverlayProjector(() => global.mainWindow || void 0, resolvePreload("index.js"));
  initPaneLifecycle(() => global.mainWindow || void 0);
  initTrpcIpcAdapter();
  screenCaptureService.init();
  hibernationEngine.init();
}
velopack.VelopackApp.build().run();
applyBrowserSwitches(electron.app);
const isDevMode = utils.is.dev || electron.app.getName().includes("Dev") || process.env.APP_ENV === "dev";
initMainSentry(isDevMode);
const isShowcase = process.env.APP_ENV === "showcase";
const isolatedDir = process.env.APP_ISOLATED_DIR;
const isCanary = electron.app.getVersion().includes("-") || process.env.APP_ENV === "test";
if (isShowcase || isolatedDir) {
  electron.app.setName("Apposition Showcase");
  try {
    electron.app.setPath("userData", isolatedDir || path.join(electron.app.getPath("appData"), "AppositionShowcase"));
  } catch {
  }
} else if (isCanary) {
  electron.app.setName("Apposition Canary");
  try {
    electron.app.setPath("userData", path.join(electron.app.getPath("appData"), "AppositionCanary"));
  } catch {
  }
} else if (isDevMode) {
  electron.app.setName("Apposition Dev");
  try {
    electron.app.setPath("userData", path.join(electron.app.getPath("appData"), "AppositionDev"));
  } catch {
  }
} else {
  electron.app.setName("Apposition");
}
const gotTheLock = electron.app.requestSingleInstanceLock();
if (!gotTheLock) {
  electron.app.quit();
} else {
  let createMainWindow = function() {
    const win = createWindow();
    const overlay = createAppOverlay(win);
    idleGovernor.bindWindow(win);
    let isShown = false;
    const showWindow = () => {
      if (!isShown && !win.isDestroyed()) {
        isShown = true;
        win.show();
        if (windowStateManager.shouldFullScreen() || process.platform === "darwin" && windowStateManager.shouldMaximize()) {
          win.setFullScreen(true);
        } else if (windowStateManager.shouldMaximize()) {
          win.maximize();
        }
        syncAppOverlayBounds(win);
      }
    };
    const isBackground = process.argv.includes("--hidden") || process.argv.includes("--background-update");
    if (!isBackground) electron.ipcMain.once("app:ui-mounted", showWindow);
    overlay.webContents.once("dom-ready", () => {
      syncAppOverlayBounds(win);
      setTimeout(() => sessionIdentityService.scanAllProfiles().catch(() => {
      }), 15e3);
    });
    const syncPanes = () => {
      syncAppOverlayBounds(win);
      reRoundAllPanes(win);
      invalidateAllPanes(win);
    };
    win.on("enter-full-screen", syncPanes);
    win.on("leave-full-screen", syncPanes);
    win.on("resize", () => {
      syncAppOverlayBounds(win);
      reRoundAllPanes(win);
    });
    win.on("restore", () => {
      syncPanes();
      global.appOverlayView?.webContents.send("app:window-restored");
    });
    const onMetrics = () => {
      if (!win.isDestroyed()) {
        syncAppOverlayBounds(win);
        reRoundAllPanes(win);
        repositionTransientOverlays(win);
      }
    };
    electron.screen.on("display-metrics-changed", onMetrics);
    win.on("closed", () => {
      idleGovernor.stop();
      electron.screen.removeListener("display-metrics-changed", onMetrics);
      unregisterAppShortcuts();
      composers.delete(win.id);
      global.mainWindow = null;
      global.overlayWindow = null;
      global.appOverlayView = null;
    });
    setTimeout(showWindow, 4e3);
    return win;
  };
  const logFile = path.join(electron.app.getPath("userData"), "apposition.log");
  logger$6.setFileSink(logFile);
  runtimeState.init(path.join(electron.app.getPath("userData"), ".apposition-runtime.json"));
  if (isDevMode) {
    printStartupBanner(electron.app.getVersion(), logFile);
    initInteractiveTerminal(logFile);
  }
  process.on("uncaughtException", (err) => {
    runtimeState.incrementError();
    logger$6.fatal("Uncaught Exception in Main Process", err?.stack || err);
    captureMainException(err);
  });
  process.on("unhandledRejection", (reason) => {
    runtimeState.incrementError();
    logger$6.error("Unhandled Rejection in Main Process", reason);
    captureMainException(reason);
  });
  electron.app.on("second-instance", () => {
    const w = global.mainWindow;
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });
  initDeepLinking();
  electron.app.whenReady().then(() => {
    initGlobalServices(logFile, isDevMode);
    createMainWindow();
  });
  electron.app.on("activate", () => {
    const win = global.mainWindow;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      if (windowStateManager.shouldFullScreen() && !win.isFullScreen()) {
        win.setFullScreen(true);
      }
      win.focus();
      hibernationEngine.setAppMinimized(false);
    } else if (electron.BaseWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
  let isApplyingUpdateOnQuit = false;
  electron.app.on("before-quit", async (event) => {
    if (isApplyingUpdateOnQuit) return;
    global.isQuittingApp = true;
    windowStateManager.flushSync();
    if (updateEngine.hasReadyUpdate()) {
      event.preventDefault();
      isApplyingUpdateOnQuit = true;
      try {
        await flushAllSessions();
        await updateEngine.applyOnQuit();
      } catch (err) {
        logger$6.error("Failed to apply update on quit", err?.message || err);
      }
      electron.app.quit();
      return;
    }
    try {
      await flushAllSessions();
    } catch {
    }
  });
  electron.app.on("will-quit", () => {
    idleGovernor.stop();
    hibernationEngine.stop();
    try {
      destroyAllViews();
    } catch {
    }
    closeDb();
    defaultFileSink.close();
  });
  electron.app.on("window-all-closed", async () => {
    try {
      windowStateManager.flushSync();
      await flushAllSessions();
      destroyAllViews();
    } catch {
    }
    electron.app.quit();
  });
}
