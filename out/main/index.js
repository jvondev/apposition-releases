"use strict";
const velopack = require("velopack");
const electron = require("electron");
const utils = require("@electron-toolkit/utils");
const path = require("path");
const fs = require("fs");
const child_process = require("child_process");
require("readline");
const Database = require("better-sqlite3");
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
  /\[Featurebase SDK\]/i,
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
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("max-active-webgl-contexts", "32");
  app.commandLine.appendSwitch("hide-scrollbars");
  if (process.platform === "darwin") {
    app.commandLine.appendSwitch("disable-skia-graphite");
  }
  if (process.platform === "linux") {
    app.commandLine.appendSwitch("ozone-platform-hint", "auto");
    app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");
  }
  app.commandLine.appendSwitch(
    "disable-features",
    "MediaRouter,WebAuthentication,WebAuthenticationConditionalUI,WebAuthenticationPermitLocalhost,FedCm,AiaFetching"
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
    VIEW_LOADED: "view.loaded"
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
const DEFAULT_FREEZE_THRESHOLD_MS = 15 * 60 * 1e3;
const DEFAULT_HIBERNATE_THRESHOLD_MS = 60 * 60 * 1e3;
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
function toCdpModifiers(modifiers) {
  return typeof modifiers === "number" && Number.isFinite(modifiers) ? modifiers : 0;
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
    ensureDebugger(view);
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
    } else {
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
      const dbg = ensureDebugger(view);
      if (dbg) {
        dbg.sendCommand("Input.dispatchMouseEvent", {
          type: msg.type === "mousedown" ? "mousePressed" : msg.type === "mouseup" ? "mouseReleased" : "mouseMoved",
          x: localX,
          y: localY,
          button: btn,
          buttons: msg.buttons,
          clickCount,
          modifiers: toCdpModifiers(msg.modifiers),
          pointerType: "mouse"
        }).catch(() => {
        });
      } else {
        try {
          if (isMove) {
            view.webContents.sendInputEvent({
              type: "mouseMove",
              x: localX,
              y: localY,
              modifiers: electronMods
            });
          } else if (msg.type === "mousedown") {
            if (btn !== "none") {
              view.webContents.sendInputEvent({
                type: "mouseDown",
                x: localX,
                y: localY,
                button: btn,
                clickCount,
                modifiers: electronMods
              });
            }
          } else if (msg.type === "mouseup") {
            if (btn !== "none") {
              view.webContents.sendInputEvent({
                type: "mouseUp",
                x: localX,
                y: localY,
                button: btn,
                clickCount,
                modifiers: electronMods
              });
            }
          }
        } catch {
        }
      }
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
  dbg.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {
  });
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
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send("app:toast", {
            message: "Screenshot copied to clipboard",
            type: "success"
          });
        }
      } catch (err) {
        console.error("Failed to capture screenshot", err);
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send("app:toast", {
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
        if (global.overlayWindow && !global.overlayWindow.isDestroyed()) {
          global.overlayWindow.webContents.send("pane.focused", paneId);
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
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send("partition.cookie-changed", {
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
    if (global.mainWindow && !global.mainWindow.isDestroyed()) global.mainWindow.webContents.send(IPC_CHANNELS.EVENTS.UPDATE_STATE_CHANGED, payload);
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
  const win = new electron.BrowserWindow({
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
    icon: resolveAppIcon(),
    transparent: false,
    backgroundColor: "#F7F7F5",
    // Invariant: frame: false strips native window frame and traffic lights across all platforms.
    frame: false,
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: resolvePreload("index.js"),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  if (process.platform === "darwin") {
    try {
      win.setWindowButtonVisibility(false);
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
const registryData = {
  "APPO-WMBC-ARVM-AMMY": { "index": 0, "t1": "sk_oP=*?W#yYjSyl&9rF!=.~SS5k2iS2", "t2": "sk_QMhQZ6LqGmivWsZ6gtj~tDa=IZ:lJ", "t3": "sk_mDuD^xeyyasc5F#b:Rf-*Ib+j;G&j" },
  "APPO-JYUA-AXMS-73QC": { "index": 1, "t1": "sk_a4I9YAq%YOUPknu^iV2&!&oIccmdy", "t2": "sk_WccsRg_c2p-G+sGV1Lfs@?blAWlfb", "t3": "sk_2n%!MvXFkcZ;d72Bx.i_vb4-wK5K2" },
  "APPO-3JWF-WXER-HKU9": { "index": 2, "t1": "sk_3jwD:bMzk?PX:OBdnDy5ldRT^ueAv", "t2": "sk_g0o03U-+jUTa2-XV%~j0@cd8RzIj9", "t3": "sk_aN%Qe;c5qMr@g^EV*ekDWGf2=klXz" },
  "APPO-6PYV-82QN-M9LF": { "index": 3, "t1": "sk_mIZsVa4tY9wi4EwzTw+hqHpYJS1SV", "t2": "sk_6?CG!vEN+OkXB~N5iS7d&VP9oDjhs", "t3": "sk_G07iT151hAkRu1z7i?y#Bd7dh~;cw" },
  "APPO-E2JW-ATZ3-8L4T": { "index": 4, "t1": "sk_kT6;1kUH%^xe?y2i7&474MYBQ7H?n", "t2": "sk_1uokP;;!E;sbX^dmO=jRChxn~nT.e", "t3": "sk_jT!oKW;NzLU_9#mUU=2Ci~J=iy2?G" },
  "APPO-RQSF-3SE3-HMJK": { "index": 5, "t1": "sk_Wkxfo*IiJV6b9F:r0ZkwlAt@WQxYr", "t2": "sk_0svAqrIZtoXC0HkjQ:SGuZ-E:Flxg", "t3": "sk_JYa@lsSYNEa@cN4HI^=h0wb8JQSlc" },
  "APPO-ZK68-CHY5-LRAW": { "index": 6, "t1": "sk_aSSTq&p#9+jl=;r:_.O=Ch%3Q?Xtp", "t2": "sk_eC^?ob?U@p9xJvY;P7sMSpe+*8YaN", "t3": "sk_gWN+9hPeyMGJabTUE5OK?O7T3%kvG" },
  "APPO-WN3Y-H33E-KR48": { "index": 7, "t1": "sk_210kJtDShzMEGfaJt!!Z.v4;0p&=9", "t2": "sk_eOG9?Xct:IkeNXuB_0~Ay&;uzd~6G", "t3": "sk_DK_DLkN&HVl&mp6Bb7#nHH-!~niyd" },
  "APPO-KMZ3-ZL59-4AH6": { "index": 8, "t1": "sk_45aF:=swSL-Mbnk!:d8Q-VA8%1W9Q", "t2": "sk_qFfTHAC5dkYgZkAm*b#w!2+G4AvwD", "t3": "sk_bfA3FVFi+Z4!FF*aNIVZV_yO!NQ8Q" },
  "APPO-5BEL-FL93-EJ5X": { "index": 9, "t1": "sk_6o_yaRBu&eiAag=li=Dg-Umnj!o?T", "t2": "sk_yff&VE?k6W:GNjMoSj@9ryWvN^x3w", "t3": "sk_rB2c7kKECZ?F^JluZr1RteHVrR+dz" },
  "APPO-QKHT-D38X-KY8Z": { "index": 10, "t1": "sk_FBO%Isb:F8TQxW&u.yBAhbh2f_f%u", "t2": "sk_yKR*6v+8Yl_gaS~VITUDoQqeL=2.J", "t3": "sk_Pnv#tB*LJye#QcWw9rXjP5TYai^!p" },
  "APPO-MH7K-ASHJ-3NLU": { "index": 11, "t1": "sk_7nk!9M9B61Q^2yikWFDx0*gGcx=n1", "t2": "sk_Nw0;fOFbJ%WF~T8Xg~IZYm5+ZNnfo", "t3": "sk_oaH7!zNRDOiMq?sKeYvv:.N+Lnz2Z" },
  "APPO-T993-WSV3-HJG2": { "index": 12, "t1": "sk_BGeIfZ5pVbJ4kCb;ec4xri^YLnB1N", "t2": "sk_Qhe@5CX-U::0WDXaGznh9sFGPyZWV", "t3": "sk_gBEL=P&83U9?KBJly;OikgIIl:8a5" },
  "APPO-U4DZ-L96E-YRX2": { "index": 13, "t1": "sk_ucl^O1RZYZxpnOx2p33#VBN%uR%zk", "t2": "sk_EgMr3SaGmyM^A6D7DA;2cEfuD3i*4", "t3": "sk_GwLZsdYl+IgaLbfeg5iC1YCNJgoK5" },
  "APPO-FGQU-EPZ3-A368": { "index": 14, "t1": "sk_UlX#*:cc6s!X-JzG-L7aT&1wb8!BQ", "t2": "sk_7b3LR#VcVi6nvj#=d*mx5-9dhSeaP", "t3": "sk_gL0ocYAjHCovodkR!IofaO:Me?G?x" },
  "APPO-AGXA-43SL-H6YT": { "index": 15, "t1": "sk_HUAAY-=9Kvah*ul:iT=+0tH5Vi?EC", "t2": "sk_X=PKUP.*sO7p!pX97hVSWlR&XyE&d", "t3": "sk_WVS13+#Sv=yY.BBORw86a=E!TU@wc" },
  "APPO-XD3T-F99J-L44S": { "index": 16, "t1": "sk_2G4gfY3oxYu1*9UFfA#b@t*YbVw0B", "t2": "sk_5Zpv6iHSz6.8H2yW35^zU4606BICt", "t3": "sk_Y9FT03eHq8&v?kAEt5+:PDHs6SdY6" },
  "APPO-E5A2-WYAS-7YBH": { "index": 17, "t1": "sk_xr%B8#CglAtW1#XMkVWoAA_YR=beg", "t2": "sk_f_^aoDQeF%ls09Pu1z+pxYRoB_1qo", "t3": "sk_TzD_t=R%jgSvuno3taeYQUBrnXnn3" },
  "APPO-DBTX-M2PL-TPPK": { "index": 18, "t1": "sk_bqzQ1=xN=.97%Xiq#pckS5G9a:v:a", "t2": "sk_KoNmCJ1v:H~teu@TylkcUdV+LcB9h", "t3": "sk_A+3iGO7bTag4V56gnYIbYx63Iw5^s" },
  "APPO-K6ZQ-ERU3-VAPR": { "index": 19, "t1": "sk_RI1d.ri;-l^oUzhB30u1v~yEQ!uan", "t2": "sk_gH.i~pQvnInm16SEc5z5h:uHX_-Yt", "t3": "sk_Gni7#%lzzSi+FyE+tR733x.%tPj=k" },
  "APPO-MX4T-U6XJ-AMTM": { "index": 20, "t1": "sk_7wW!PegTn?gVh=dZZ4e2X+BUr3^hI", "t2": "sk_k7b?wmJRYT3Wa6i1acA#LOQachMF5", "t3": "sk_rA@-WoZGPhR+UPs=Rre~#UYp35D0c" },
  "APPO-5N6T-NXNJ-PBSD": { "index": 21, "t1": "sk_BnOzDZpj9nJLXKa=JDbNsg7kWx~bZ", "t2": "sk_xITTm8FLVLJ:OPNNd!DrhGF&YxH7j", "t3": "sk_EJ0ee3_7O0Rl8dO!lo%PjtCfZH#ed" },
  "APPO-MHC2-8DBR-Z2G2": { "index": 22, "t1": "sk_E*VnG!8*rX:aDSld@K%bBArMKD+tp", "t2": "sk_mJN4-%vuJ*Cf4tasXnIh1.dlV=jI5", "t3": "sk_VsJsDDLXIwyhaJ+YDm7_aX@VV=X^R" },
  "APPO-6CKN-4UMT-TKBV": { "index": 23, "t1": "sk_G!DOi8LQ9RaW4O!:z775eh+gPrp?F", "t2": "sk_rImDfV~0KXuVka0mu-4^5f-6i^2Lh", "t3": "sk_k5nA3B8hdYsVnvZ5CVXkhuKMNdJ+c" },
  "APPO-ZJ93-C5HV-D4X4": { "index": 24, "t1": "sk_nDh=FHe9yBH=UsV&4fVBnoBuRqB3Z", "t2": "sk_8^myhFyq;1Nk7jiV8_BV+^UZ?=oWT", "t3": "sk_P^@ev:p@me?Wo#mbm0tP9;&Z2fUZe" },
  "APPO-HQSV-CAGR-MW3X": { "index": 25, "t1": "sk_Qf=+_5WM*Evt?tv@A;NBjTqrPG+EV", "t2": "sk_4rl+rZ1FT9vyN:h3^4bXcX@d_t:hS", "t3": "sk_V4x8aAa#YQcb^oYAY0D+~&wcB@pAg" },
  "APPO-5BUW-UFNP-3YAT": { "index": 26, "t1": "sk_r@iMUZyWyR%65D4q2:ZJqV@ct_bY7", "t2": "sk_D~chIZ5z!4Y1:IqWGP4LHJ3uYfxTN", "t3": "sk_O&UuCBVGBy7_v?.N3Uug-dfJ*IDTD" },
  "APPO-KDTY-8FNA-CUMM": { "index": 27, "t1": "sk_5!q=5NfvVPaqa4VIP~~F=g1@=G_qP", "t2": "sk_0c8i-MispnhY&gQgnGAZVsikqBkGX", "t3": "sk_Tgt+bi=bTZmCa331_.#qGB=J57fzi" },
  "APPO-7JPC-XXDY-Q5SX": { "index": 28, "t1": "sk_EKlW~3_^V230ameSEIVmWBY!L00fX", "t2": "sk_ajjlLEJY6VMYCjBdkIk9VF!9cK1Y7", "t3": "sk_15nk~~n&frfo.SOHk8-EoBIK!Pdpc" },
  "APPO-4HTL-VYKA-JZLF": { "index": 29, "t1": "sk_Qe3SzlqNJWCft;p-!SK*%Evv*Aixh", "t2": "sk_tERzYPePr%Muc7_zqJe#uoWBPnrUx", "t3": "sk_LgLf^VfCnmGjMS&+x~XQPD3ZYa9-l" },
  "APPO-XKPD-QZHN-5C39": { "index": 30, "t1": "sk_DrG&Z7.BxUFD^rzCIO:UP3_A@UNqM", "t2": "sk_B+I;RlAN=re^m1k-tFmr3ujdt0Z=A", "t3": "sk_K16Nezh_maZUwtwdHE=BARW.5i-KI" },
  "APPO-L3FN-XYZ3-Y2LS": { "index": 31, "t1": "sk_UGM9Ap=trvbF-9!DX0:W;jKVmpkwS", "t2": "sk_9iOkib~ZmhmqHkwG^6ocI^#ehJ9gk", "t3": "sk_Oe;:UyUYtiA7Zj*+8Ny_dNXEK@m=C" },
  "APPO-GBFB-DZ34-X29W": { "index": 32, "t1": "sk_ed6euZYh5j3pJ!3tkG6h6coe59z?u", "t2": "sk_r_-w6%_AyYO@:3bgrVq+m=%VhJhwZ", "t3": "sk_NFU3@nr.yX~~rDQ5#m0DfLLu6LuHe" },
  "APPO-7QT5-X24Y-73E3": { "index": 33, "t1": "sk_c_@W*j0Aa8i;ugqPWxP6w*Y6.TunZ", "t2": "sk_L5G291aZRx7i&TaUBeka3@DwXezU8", "t3": "sk_yWM3PPolu?B2UgPV8duKcGLB80~m1" },
  "APPO-X7FG-NFJZ-5P4A": { "index": 34, "t1": "sk_1&bZ6OoUQ?qndzscsAlX8PLii&J6d", "t2": "sk_G-0@XaOi3_aP+R_S:2OPIqdkrD^z6", "t3": "sk_wS:Bf;@7SRm#S:.mRKmu3nuOK2aGs" },
  "APPO-MKHZ-TZGF-E5R8": { "index": 35, "t1": "sk_qgLpv+g8^YsyZShB1934%VNEU~~bt", "t2": "sk_Al9ffog+b8dDq~nYo0hFoH;F~o!uF", "t3": "sk_c9!ENBjiv5JXyZQ^H#~OTVxUh_jdJ" },
  "APPO-V2D8-TWKC-8LS7": { "index": 36, "t1": "sk_HWJhgk8!R::+nz!HBFcJ;5IS592%R", "t2": "sk_D=oR*&1z!h-yPC#Y#l@1x~vK!vBn3", "t3": "sk_TWmbio_mR=LabfzR:iojDEw^9+vEn" },
  "APPO-T8M7-5NN2-WLK3": { "index": 37, "t1": "sk_81qBD~igGHTI?wNOArT2&vqF~c!EV", "t2": "sk_sbiP_B6@yruvk5Q?Snd4GKUHWcygv", "t3": "sk_lx!2-EXj2zE;unCPODZ*l7QqX&mug" },
  "APPO-2UZA-6NYC-GKYY": { "index": 38, "t1": "sk_l4KglwHa3&^+wnGkmfhR1Q8J2_;fg", "t2": "sk_4PVVaJZXQ&xtDNzYitzj@5CGcCS1H", "t3": "sk_e3H?z7l.8H=gNe+D8cjUmz*zq~%lM" },
  "APPO-9ZFA-P4N4-WLCU": { "index": 39, "t1": "sk_T%4JYDBBXvc;sTp4P*z1-YP+!JjL3", "t2": "sk_wYkrC8VeN%!vulB27X^p#y?IMrv!u", "t3": "sk_hky09uI3Q*~&CAgNhMNwI4m=peOlp" },
  "APPO-FDGM-DT6A-Z2BT": { "index": 40, "t1": "sk_c%wDk;djKd7^ql&rFF=k8tOrzeoOM", "t2": "sk_O#-&8MO9cTtq?^I:MNidA6W1e-0.7", "t3": "sk_gp-xUK.eF~0^f0_UkGyj4O~9f98VU" },
  "APPO-DTLQ-D5Y9-A43D": { "index": 41, "t1": "sk_b0OMN@ScPJVSgI=Mc&&@8UP2~IL#h", "t2": "sk_KQTcMf.UqXKX!2sCxrVKiGID*zCSg", "t3": "sk_DFevHU*pbZVWg%z2?&L0tSguOm=%M" },
  "APPO-PU4R-8ZDP-GHAK": { "index": 42, "t1": "sk_zIkVUT#7OYcEZFW%?U;+vYJ#45Qrs", "t2": "sk_kh&5.hCz9RC9%116m^pMIJW%pvqCC", "t3": "sk_W-BsX&0t@zsZQ%lh53nmBxka.H25s" },
  "APPO-FQFK-2PMX-CGMX": { "index": 43, "t1": "sk_YR#A@!YJ8.u%O~kqkV636-;?0RA1A", "t2": "sk_RL^L!BjZmQEdVZi:RLde~I7dqBKiP", "t3": "sk_ffO%;yWX9LadQ+94^&Usu1yU6oWV5" },
  "APPO-4WW9-XQAE-KU7A": { "index": 44, "t1": "sk_paw5sOJXLEfB=z0@@F+lJHArcakTG", "t2": "sk_tnJ+:UsM-_o_CFBBI2dp4E=?PlG!d", "t3": "sk_lqKt=Z?byDGr59Jk5Y@SpXza-!1Ie" },
  "APPO-6WPT-6KKS-6A4M": { "index": 45, "t1": "sk_W.SNsgo^Fqpadb1coU..=HEGdbyPW", "t2": "sk_bYZE~Cuw=qdZ7tbtf!fjMp@aFPb7g", "t3": "sk_BHHzOGxfj4Zl?GZcLUdpD6n;95yL5" },
  "APPO-32TU-2DEM-NDX7": { "index": 46, "t1": "sk_l5H~~BKnj#EfwvadJy+AvDrL0H_fj", "t2": "sk_msj9U~m~I.EZY:D1xZUbC++Y&s=zh", "t3": "sk_I!c_CEwl?6Sp%ElfG^amPo~fBsL4A" },
  "APPO-JC8Y-GEHG-FVPM": { "index": 47, "t1": "sk_U?xNquye?D%MfZ6M@t^!boHKQ#I3o", "t2": "sk_UNvC_GGFa9R;pG!jzYviDgNaKNbmW", "t3": "sk_xcz%qSc^jMNyd%aM?+99OR%p:~Pna" },
  "APPO-6FKN-HUF3-G6LJ": { "index": 48, "t1": "sk_G~&%4_hvHR2SPWKs=cQP%xbJOH5?m", "t2": "sk_wpGN3uU~Q4%ki-A9exy3b+IypIQ1T", "t3": "sk_Tp6!xRreQO^kZrE^JD2U&RR.PCsiy" },
  "APPO-YY4R-T2JV-VREH": { "index": 49, "t1": "sk_rz4hu7.X_6s2LUtIEs=^HAKSYWs.1", "t2": "sk_lT!aVg**Ktf;IgSQ:#-nmgw=95Xd2", "t3": "sk_IUHyDcX69DGAv4+KTwY%%c&k=P~ig" },
  "APPO-P2ZT-FPY8-VNKM": { "index": 50, "t1": "sk_x5wS1;f9OLZo@?HsEv_HMh^j+Hoos", "t2": "sk_F28cnI.4jb=2F*d3SM~7jG@^bTjIZ", "t3": "sk_i_N9JLHDW3FyaclCSdq&^W!=6gxLP" },
  "APPO-56V3-9F6X-HJ49": { "index": 51, "t1": "sk_neyB&;QWiFm;BCBFtjiLU5CQE6uq7", "t2": "sk_V#BreUv1L8KJc@B6JXHxTy4q:Cd*d", "t3": "sk_h-3eBAk!fdjH2HJ1^A?8e&-KDmxIj" },
  "APPO-CMRZ-RDUL-7V8Q": { "index": 52, "t1": "sk_0Sb%dQxYq09:+OVXbO3LlrqPbEaGc", "t2": "sk_wt07UP9UyBut&KUm2hSYfOZy_5i=M", "t3": "sk_NNxE6nkHqP5t!MF1yIF!&kg?_tTjj" },
  "APPO-KFR7-9GAQ-Y9PF": { "index": 53, "t1": "sk_MoVm29BA@bQLbmX7Gr7Zb.EkFyVGL", "t2": "sk_eJ3H;gpqKiwK~KbXg#Ma4wT!y#5Ak", "t3": "sk_jknd8=Y3Q:rw=@fMp4A4NmjrV:fJb" },
  "APPO-XSPP-GBCH-FYAU": { "index": 54, "t1": "sk_WzN3hr^+t:iqL*OPXMF.yX-T.s**e", "t2": "sk_E3m*Lfse89Ehs#Phn#I=pb08HGZeS", "t3": "sk_I8gwK04-d#WRQ:4!7@eLhX7IR9&kr" },
  "APPO-38VD-9ZGC-M6RY": { "index": 55, "t1": "sk_KrXzir24A212S7V6SpZS?muIk~RBb", "t2": "sk_lN3aiJ=CnlEQ@18cS&K*E_O?t5-1V", "t3": "sk_Dz*L:b4K~r2aF-C!8ndrCiS:;wJ0c" },
  "APPO-MEJR-U5RJ-3HGD": { "index": 56, "t1": "sk_r.I==^uO2*vBpgJ.#=8J!.+s=CLPL", "t2": "sk_BdUioOIt40-M5GaDcJS@zx?znkHik", "t3": "sk_vbf^Sqjq=k5jnR3F%gZRd0niFr-ah" },
  "APPO-KGBT-4TXA-ZXZ7": { "index": 57, "t1": "sk_ko&KwrMqG-yh~+3OQ3DLyIimWnDia", "t2": "sk_4bx+fI*7mR?HST169u_#iMDsqIMMo", "t3": "sk_3I+Us#P=aq8Q_?;RQlVm0.n@:jCLO" },
  "APPO-CDY3-2LV8-5XAN": { "index": 58, "t1": "sk_SpjyIbF-r8A*-92Ewa+t!rc;Z2D8i", "t2": "sk_QnmD+WKv68:K=oI6-hK3hDF_G-H4i", "t3": "sk_Eo0zC^zTtTn~:pAPzSejOTCyJEL;B" },
  "APPO-9W89-3HH7-WHS6": { "index": 59, "t1": "sk_W!:uXtk.Wz~JVjjxA17IQx&qzn?%W", "t2": "sk_B7rTMOFRjsVow~L8ioCAZ=dLQ&%dG", "t3": "sk_muSsxEMpg+0pZs_^LXb0&0;9yzSWm" },
  "APPO-BQ7A-JY4Y-L729": { "index": 60, "t1": "sk_O_rUnUO=bb0!ncyyGD.pU-lZJxEKF", "t2": "sk_PrAmcPdzg!IS.37J0Eb%j_+PQL_?1", "t3": "sk_P?zc9V&dGY%~~4VEPuLy=-cv+QchX" },
  "APPO-35Q7-BRML-M8AL": { "index": 61, "t1": "sk_t*d7oSY&_d-V;+&V&IEV^AI%v%zMo", "t2": "sk_u*Z?7=qKISy=-eMroQ-kUAAM@.Hd7", "t3": "sk_JjS65d@cY5VIZ!klx?njDwrwx4^!n" },
  "APPO-68QE-75ZU-PQLY": { "index": 62, "t1": "sk_d3D?~tTiWxkq;h~Hj0EuIcl3:*Zu8", "t2": "sk_zN1~cmaLW;pTAXC7P?u+3JSbNWw7t", "t3": "sk_PLdMe3ILTB5jIBT-2L7zW=Na&idj8" },
  "APPO-NKKU-LBNS-JF8J": { "index": 63, "t1": "sk_1uU6+WmPHzp:Z*rE_qLU:BVkT=JTR", "t2": "sk_tswoO7_:ZXAaYz-ysN#Lmw9vEezB6", "t3": "sk_tJoVAlfQZAf;Fx&L8r7iFE^ZZLp0X" },
  "APPO-9KMD-X5ZJ-J2JJ": { "index": 64, "t1": "sk_e&tl@t-y_#f?yEZvFF2@M*ISqPwGQ", "t2": "sk_R@wNv3gf6xAmc;Rf:SS_k?JC*s4jt", "t3": "sk_h2Azh-pywfXVJd&7Oqjy111YKPJx3" },
  "APPO-NF5J-EVYN-HMYH": { "index": 65, "t1": "sk_o1OMZ_zP6060&x21a?2juIqZsWo.T", "t2": "sk_TTKdPH5VZF#v;;ZC;:cvC-VNl2*WH", "t3": "sk_1K87==ylGK.T?Cv_3TtTmaK63*#XL" },
  "APPO-BS5F-LX94-J4CQ": { "index": 66, "t1": "sk_u%F%3O2IO&CV1S:pKjGG2DyZP#A.m", "t2": "sk_813XY6Z59A*nAJX8HPleY*-#MS;#e", "t3": "sk_up8bz#PsSt1aD=Jl1T*gGmo2+=.8A" },
  "APPO-XQG5-9L5V-WU5W": { "index": 67, "t1": "sk_fp-glPSrT8=bV2L^@M6c2m4K9:Mri", "t2": "sk_tByb3&qaN4=0UVfiY*NAEQ3Eilwin", "t3": "sk_cfU3Jcr?P_Cxad~Y:EK;tJ08fLu=o" },
  "APPO-DLYG-UP38-HQW8": { "index": 68, "t1": "sk_rx--Ii^87WDoxDYNiadw5w#dqh1Bh", "t2": "sk_Eo6dMS3w&35uGU3=XLgKTD&EEYr7G", "t3": "sk_Wg=2v+Jj81g.:LJyI&bdXiQ?_TF-4" },
  "APPO-CL7N-JGBT-S3B6": { "index": 69, "t1": "sk_aXpMDMyq38R;p-5Yn5%9siy9Hm0cF", "t2": "sk_8=Cx0G;V4q&A!*dQQB338n^FVt&YQ", "t3": "sk_gSGu5HI=BaCeX6Za^DQ6QhAV^xCAO" },
  "APPO-323Q-UT6B-VDFY": { "index": 70, "t1": "sk_P*u~.uT.AseZlQsE?1Sb77Rhkn6FP", "t2": "sk_rP#jawXSqXUr?oBufGr^#I5eZ~;Ai", "t3": "sk_E3s~h&dS8e3FmVUQ+hmlV6B-y=izq" },
  "APPO-LLRY-PJKM-7CZM": { "index": 71, "t1": "sk_gxl9Ef.sQJdlEPK+qT6K6+!?XeEqc", "t2": "sk_yg^~t.Ix@Zy?TU25f:uwsWj&OwtYO", "t3": "sk_dvV;wP!bq4tk!HX8iL.3kKNArNSUU" },
  "APPO-NGPX-CDDS-UQTF": { "index": 72, "t1": "sk_oP;&-#2mm;O16D7heeOWi0=FFr*fb", "t2": "sk_ZzcLQSGV3-w&f6khN0JjH&an4wdyg", "t3": "sk_k2?2vV&~gd@Vy%CN7Dz2Lm!v8Dr*y" },
  "APPO-9FFR-ZLGP-GC5J": { "index": 73, "t1": "sk_X&q&IPKOGFPq+Z9M;27d*Q_KK;T*j", "t2": "sk_sbMj^^PFN2LQaPd2NpH0cFsAmxiRq", "t3": "sk_i_Ii@3x^jZROM~SI5CUUUzlGKy!+S" },
  "APPO-X4U9-BXPM-DTSD": { "index": 74, "t1": "sk_h.Irk?JYu?TYM4NH92TpQH:a;I&T4", "t2": "sk_1==C2.@G^.-#rd!9fpe~5RjCPy5No", "t3": "sk_v2EJ86Tuzzvn.rJs_=7Zc=%ErcYDE" },
  "APPO-DFZE-VJE8-MGSB": { "index": 75, "t1": "sk_EhKb!8_=Q;koF^=50H.z:oTqQaUGp", "t2": "sk_GYcncy+.!YL1nB.+lW0niI!sG=fH8", "t3": "sk_CPy5;OB*4%e^O.PYzW_LLS+u=1waa" },
  "APPO-YRT4-4H7V-4QTE": { "index": 76, "t1": "sk_C+Rys%!K_p^q?;wQl44sDElfp%OII", "t2": "sk_r7Y8GDD%hrMK&r9:n8cs46QstL3%I", "t3": "sk_srl%&8nw54~KH5G@F9yZX1VP-A^6T" },
  "APPO-U8AB-EJ9D-MAG2": { "index": 77, "t1": "sk_8f@a_aBe_CcXRK&=uEQU*%K~fxNje", "t2": "sk_80P2!n?4l7C*E.lq*Sw*l%YAf2xaG", "t3": "sk_mtII4w:-QpU:^?AEAPw179Q8VeBiU" },
  "APPO-CWLX-TE2Q-J2V4": { "index": 78, "t1": "sk_na&77m-1%zH+vZvwmZrgnIrsH0yeC", "t2": "sk_p7W1h*q_@0&BC3P:xlp-G^e5&Z9xx", "t3": "sk_nblz78G!RtFmseBG?Ws*;O%P3rAXO" },
  "APPO-QUZX-2MFQ-P6SR": { "index": 79, "t1": "sk_AczSh&Ye%=woM+Hk8c5_J:ORHUfsy", "t2": "sk_PO%4rK~0+PLy-y@T?2udG2Qg+hV@u", "t3": "sk_no7MAUcop%YaC?+SmmFhSr-!4r0f6" },
  "APPO-SY9H-KMWT-94PC": { "index": 80, "t1": "sk_CNTlIQO^4CFa.bxwQ6zKUQ-UOhm+M", "t2": "sk_og1MNRq3mhqC&uwIG0DzvE?D~wHAW", "t3": "sk_kyzJ0gmkpDoWw~_=NfKgFlkn+*=br" },
  "APPO-RXCK-V3KY-2W4L": { "index": 81, "t1": "sk_xqwT+5w%#+cQhErvO6c#4%s-BQ?Tl", "t2": "sk_Z6EyzSaCroHNF@r20&EAMky8I@B1E", "t3": "sk_JmTI_z3QA7=qM^pS8Ig?r;mXSTdYF" },
  "APPO-EY89-2NMV-AR2K": { "index": 82, "t1": "sk_UoKiteam+t&2PU2:oU~ps.OSzMyMd", "t2": "sk_cTk5yp%0zqlE*wZ.LhRnWjwOI&B:I", "t3": "sk_z8he26.HF^Mp*3LxG@oZeQJn?x@eJ" },
  "APPO-ELJB-P8VF-3TGE": { "index": 83, "t1": "sk_SmoQQBAn4HUgG@6OyGX:;E:hF=9Pm", "t2": "sk_3+!UE_*0bHc0w0J@UC0vIyvofqB~B", "t3": "sk_5KW_kdQb~I~.;iam7mPd#O0=R:j74" },
  "APPO-P2XA-KPSR-CU7U": { "index": 84, "t1": "sk_d_!r@g&!5s87kT=-qk!+#qT=*_c:W", "t2": "sk_Ve77?swNzx@oo@iZnGXo-SV%lFG?G", "t3": "sk_YO&YV&;GW&t=*AhrU:zWZMfGIF;hb" },
  "APPO-UXHB-2YQT-7CSM": { "index": 85, "t1": "sk_c+cw%o.Y+1Ouw#z^qASUKi8lDcT2M", "t2": "sk_8DOyi!XhpMZ2YSXJieY=QXh05EvyW", "t3": "sk_0bzM^gg1!2lE08#iIZbjx:NJWxUuu" },
  "APPO-5CLZ-R7UD-DU8B": { "index": 86, "t1": "sk_lYu@sh?HYKy46+gtoSiTIPOXcBYnB", "t2": "sk_1HGq0R^5A99Eo8j#oK&Wyl3F4!RdZ", "t3": "sk_2DJSZmR:G.WW+3t-MzVIOql&rBtv5" },
  "APPO-GVYU-VENP-T3FK": { "index": 87, "t1": "sk_7MK&M0&?EaK4OaY2mqw#f~G33=L.I", "t2": "sk_a68IvSX#HeKrZ@cxYF^*UIVQZrlwh", "t3": "sk_9PZWT3t%L%^wYRMm@aCsX2vUCZnfO" },
  "APPO-GKWG-RQRV-EFTF": { "index": 88, "t1": "sk_CI9S8yi-NZH1X?iieh._LviAsgp^V", "t2": "sk_s5+vA-22oRlBpL3F1u?G-Rsb9H~vZ", "t3": "sk_xiNF=ARHZ-5Ecw*TwJ.QHD_0:EgoA" },
  "APPO-CR48-C8BT-6YTM": { "index": 89, "t1": "sk_5LYiYK;XP;EyUa;7_JKyg&Zz2-Hn2", "t2": "sk_Lv@z#*YeB^CH-o7lEE5.g?@0Kcs67", "t3": "sk_QqnPHuQo2X@dSXD0sfrU9a#I#oU3Z" },
  "APPO-WZPT-VJD5-XGHX": { "index": 90, "t1": "sk_fM=a+6U7IyvZ*L3K3ZjbLETLLGUo7", "t2": "sk_s^GQTPK?UDNfmL%5dG!8ST*M!Q2kk", "t3": "sk_n*u:BBbjfT&Ob;V&&JiVy^V*XZ_RB" },
  "APPO-GKGR-6CKY-DA9J": { "index": 91, "t1": "sk_T_BHY_FidqdgfPW+5.QD_=d=Ar&Ts", "t2": "sk_9cY2r=^_oXqJDIdGNbm3mG9Dnxzot", "t3": "sk_U^MT4l!qk56I&IF_InmkpluMw5;tt" },
  "APPO-E869-P4JB-VJGW": { "index": 92, "t1": "sk_po_J!Z@q_f+2+T;nnro3nHxFtB0C8", "t2": "sk_S_dwPUVuoqPT:j-AF+i9=K;AC%~pl", "t3": "sk_wZK1*OX9dzYN_AdB?4coBzSmNpnZr" },
  "APPO-2WAY-53FC-7773": { "index": 93, "t1": "sk_L&nk=&_mGJQEN+v5eh91mj3qYd_XI", "t2": "sk_RcbU@fYhYwMuU^l*YC63%bc;R4Wu9", "t3": "sk_sk1MgzG6PYiQ5yI&w9Ul@?NZ::hKj" },
  "APPO-YJMY-GY4Z-G8P7": { "index": 94, "t1": "sk_s^L7q%NbW+ZVLIJhwxJhzDxqDEEc4", "t2": "sk_o~pdo~XZu+=Ot*jRrYFH4*G:70u;x", "t3": "sk_e9_N-n2U7_-R7jK:n2jV^FSxG;uYP" },
  "APPO-DYN6-LAJV-V9AB": { "index": 95, "t1": "sk_rBN-jUTewOF22bK:2j?^2D~:dr_La", "t2": "sk_Xr7fz6A&;TLeayZw?zuUHrHK%tn^s", "t3": "sk_2WgT*9hEw9~sXtZV@PmFW+22B9E+r" },
  "APPO-8XN8-RBVG-FGVR": { "index": 96, "t1": "sk_z7Dnd9?uS6=R&ZgqK9wYtH;Q6+hDc", "t2": "sk_jegz7%CyLrdF#fDuIx4eN1l15x5PO", "t3": "sk_87%4vxb1!l^hF.=6@%S-JRXMcAqFY" },
  "APPO-MU2X-N3E9-WAW8": { "index": 97, "t1": "sk_6Q&LB!HTX68Abg-lGRLTWvf#d:obt", "t2": "sk_8&*wr*l_#MYqUh+uhh8@NPJR-R?iI", "t3": "sk_r%Vtzm?p3JxFR=k+7%U5uT2~WEZ0Q" },
  "APPO-5BMG-77HV-29EX": { "index": 98, "t1": "sk_7NLAO^8vW*ZX#7vTw#yGaxe~1C#;O", "t2": "sk_N_hlo7ML%Lm2&FY1?!hG3s4Dl?E.Y", "t3": "sk_wHsAXlVO?93hQU18avI*W6gKI3z.m" },
  "APPO-DZ5H-SUFP-23WH": { "index": 99, "t1": "sk_eB9!g&zTd27ac-~J~kSkl14c^Bnxt", "t2": "sk_97V+qR@:j#TL+dQmYK*q6fp6A6NWd", "t3": "sk_AiJ=Ov&tE*u^#n^DiO5@l3NR%4+2d" },
  "APPO-43Z5-7W6E-49P3": { "index": 100, "t1": "sk_X;sA=nkleeTe@xijUELUF3DDP_xiY", "t2": "sk_yCGyrg_Nee+#j2n!G08pMm?xsHHD8", "t3": "sk_Z^D~73-xRxbj+ysDy1o!1*_.U1QBM" },
  "APPO-VYKA-YV4U-SPRP": { "index": 101, "t1": "sk_ROjuz?cxNIhJ+gE?KDP1Zjs&OLsjY", "t2": "sk_Vq2??AkWES~TlabuuAjdBG1;LwFCd", "t3": "sk_9o&8CrPQ:mmz&NcEHG7mH9SL~o8L1" },
  "APPO-Y87Y-6TXD-Z8T9": { "index": 102, "t1": "sk_Dzk9@k+2~#c7F3NAA+oY@j_&v:Vlj", "t2": "sk_O%bu^Q~=pd6F32%QeE3tc#S7ki3!w", "t3": "sk_7-Q~tTwfCR--mfahNFuFezt9q:2TI" },
  "APPO-BNH9-CVVF-RXCN": { "index": 103, "t1": "sk_XPyVT?2?fgk~;nIUKXq60O9y%p#+b", "t2": "sk_sWa75u*P~c=8@+9Yi65X~csNQMax9", "t3": "sk_b9dAd=b-W*NRBxnGc-*f&E!Or7Qmk" },
  "APPO-DLU7-3ABF-MJSS": { "index": 104, "t1": "sk_jSPem23uDz@L2%9vhh1VwA~8=4*5p", "t2": "sk_HssmZ9=ays-HAMmNWo6kGpq0;Qigy", "t3": "sk_X~kb#esUqt~3iC=8WJ:1&-ef7VU67" },
  "APPO-U5X5-3MPG-Q6NG": { "index": 105, "t1": "sk_oup?k0p;Bv4?UrLE*SQ94Y2dMMO+r", "t2": "sk_zcYI-+qK8h;KS4smC24qHh5-ZddKi", "t3": "sk_HMM#m=9JvHgeO52oLXv+oL:IgH_+9" },
  "APPO-GEEW-CEHF-YET8": { "index": 106, "t1": "sk_RDqq+Y_J-#:.rMhBB5Rf_a*po29zc", "t2": "sk_uA~3a;c#.+4iM%-&CwI*#WL^d7+HN", "t3": "sk_9?UR#fQ&KqIOSynG9mQ;?q2QF3PLN" },
  "APPO-3V4G-L44N-8TWC": { "index": 107, "t1": "sk_ZeOz-dzQWq3v*Eud@tnZz:Qu#8Mb7", "t2": "sk_l~VzD0Onv&L9ESvX02*:qCDq590qt", "t3": "sk_Hv~ff~Iw@OC?5vlTmvC7G=vyTThFa" },
  "APPO-W9UN-R6X5-GMGT": { "index": 108, "t1": "sk_NjO#gR#6G:~o*F%bOaSV0aqJBJSXe", "t2": "sk_7vLtq4&6gKQ!hP+QtubIiBvqP7F-1", "t3": "sk_arj8TL4#RKxu!wjq#M!1VBzd4quIe" },
  "APPO-SFYH-7QMU-4HYA": { "index": 109, "t1": "sk_Wimq3*EIa1qsbq4Ql4UY_D+b?yAWl", "t2": "sk_6P#n0djusAMNvVmTr^M8FR3JxuNOC", "t3": "sk_p4Q=a2Wvl04RGTUPuHN0DCH6FgVdB" },
  "APPO-47C9-XHST-K2L7": { "index": 110, "t1": "sk_9nEhyd.B%?-S6QTJk1F_WJ;u.1#mO", "t2": "sk_NOPwOY6Ci2!fu#@W0UC&U@6#M7jqO", "t3": "sk_WY4o!6k@1vRDKgd4tf3HPhU:STgh7" },
  "APPO-95FM-WGHZ-2F6W": { "index": 111, "t1": "sk_EDQxxwA0Hmf5-40@SW34Ns#&2J@l2", "t2": "sk_fqS%W4!VZ;6Dfp!%Q.=Ci7QHjHgwH", "t3": "sk_2Yx~T4xZwya8y%BF3vbto9Z@W=n04" },
  "APPO-WGKQ-4M3N-Y7UE": { "index": 112, "t1": "sk_cQp:L0_KG#C*qRF3_V^WBQ%SaFS#E", "t2": "sk_u~O&t7Qqf*5Kuf79wI2GwnrXYhDSe", "t3": "sk_SYti!*:;UqnhJbekmo8c060KjPCmX" },
  "APPO-N8K9-XF8L-NN2P": { "index": 113, "t1": "sk_r;?jm61tD7k&DE7&cAN7u5_b:AiR8", "t2": "sk_m~Y^XXQzeVHE&qUFCjqM==GiHKWek", "t3": "sk_HM-RnH1fxW%u2?usIvkL=MigMJkp3" },
  "APPO-683J-CD4J-92WB": { "index": 114, "t1": "sk_J@Sgt&JPP.90d%bmIH^S6mZXH2PTS", "t2": "sk_LwXNuZzMfE5FrE#+mJQ+i=4EV!Rqa", "t3": "sk_bdzIx.jc@lFcWVFs76E0xEo~J%@qt" },
  "APPO-5WYG-G7C5-ZNUH": { "index": 115, "t1": "sk_5!G*ASpFoCHX1z6t=4AebX?k_-H3l", "t2": "sk_uTAv72H0jx9UT+-HOAjKb.8bA:sFP", "t3": "sk_TtklW0uglj2Lz2y5QQZ*N^1m;7JX5" },
  "APPO-MRDZ-MS6V-9BEV": { "index": 116, "t1": "sk_EUy2u1y7qSg#5*2nc^*oPXH!y_&WD", "t2": "sk_qOCp7ID;njIGvv0S630M4COk!n-Ra", "t3": "sk_gLgcQR*020hFP-3+I6FJspT3S.B7o" },
  "APPO-8TT7-7GQZ-DV5A": { "index": 117, "t1": "sk_Wj=w^lA.NBlk_bQEIa8Bvxwslj6JZ", "t2": "sk_E&5DoM*EG??gwd4Hy1LlUf=*nrfxY", "t3": "sk_tILKEWIoM1~j_CLy_jI.u6lT.s@!n" },
  "APPO-4LSK-3PEE-ER6Y": { "index": 118, "t1": "sk_bpinRnZ?Q^dnLFOrl9x=YB&Npq#hB", "t2": "sk_umGwM_2XFtkhkDgdsRUJ0XPCHEG_V", "t3": "sk_n!PRq;;zw17#nMaCxslG8nl&8oj6I" },
  "APPO-78FJ-BTCF-M626": { "index": 119, "t1": "sk_8roU4n@FAOzK&g2-_KKKdBG85ym32", "t2": "sk_g6F6T8Cxxr3!ET4&m6z9;.Tr4;zmU", "t3": "sk_FxLB81j-jwrU:55vF0hn.tFK15xg4" },
  "APPO-QC2P-L96Z-KG8C": { "index": 120, "t1": "sk_2u1eoB43LV?#7#cQbb2.9Fd1MFRfa", "t2": "sk_ulSEmdCkKyEs+sB!mfmHM.lFY4Wpd", "t3": "sk_2qDU^wmv=~YBQ20sPfz6onsoI.+YJ" },
  "APPO-BDZU-GAL4-FC67": { "index": 121, "t1": "sk_Nip_ij1#iBK&9*2bB117=#gIaap:w", "t2": "sk_ag^hkJK-hP:yOa^Oep7l4EN4w5LvE", "t3": "sk_tXm8K*IHJ3TLK=?kKDHbWb6hQ?@ih" },
  "APPO-UL6U-Q7GC-XCBG": { "index": 122, "t1": "sk_q:UZ0dvOwQ-#p3q1.3gQf.;qA#oCH", "t2": "sk_b;a.Yz2BG5f@kwgr40&b_Cr^KAlBs", "t3": "sk_Vq+pzDmSgS4hK_uF1E3lf5rB^Md+P" },
  "APPO-FE2B-F76M-WWKM": { "index": 123, "t1": "sk_M^ap^1eZ%zYrLD!!c9TCPG&%JhtQx", "t2": "sk_bK&.XEU=^ecub#M-sBcOTNL-a;SZL", "t3": "sk_Sn0GEoYGYu+ka?-F;u^4p823KegFO" },
  "APPO-DK75-GNK5-G8PH": { "index": 124, "t1": "sk_Y1#E=6!ZACA;Jw??^~&576bjztj.y", "t2": "sk_Khk&JG1E@Kr9A39YhnP+McpUhk3Hy", "t3": "sk_tb8a4e9nNJTYF-XI:@QK;#vO8q=H1" },
  "APPO-AL7C-A785-DGUQ": { "index": 125, "t1": "sk_pejF+?d:oo^439a0QimxlT+2L5kNS", "t2": "sk_1RY*JRm6PM6X2X-W1XlWmyQR2eBAa", "t3": "sk_wltsrKMy44XvF3g7nDk~rSZB7yR68" },
  "APPO-TWAV-6FNG-3S93": { "index": 126, "t1": "sk_K9AB8@fFIruy9e3nV:trZULQafeuk", "t2": "sk_ZZH1#&*ye0%CI_hunTcmyHGt-F;eZ", "t3": "sk_W@a=oitW%+aySW_NRcgfE9F7E!gYh" },
  "APPO-876B-5ZEH-9VHR": { "index": 127, "t1": "sk_DMdMB;67EfmxclQ7wAVpS1b^-c&kf", "t2": "sk_CCAqz:zJV#hAw:@bTWSc;M4Lw0S9b", "t3": "sk_WG8qAiS#oGB*qAYYR91frrxseq1-h" },
  "APPO-8ZD5-PMSV-GGH6": { "index": 128, "t1": "sk_qUuE3dz#B3cO7-W:-VFA2kZEp_k5S", "t2": "sk_dbZ45;ayO=.U&_JQXBJ?Y-za:Zh+S", "t3": "sk_mkFW=WD+^q&:Rn2Yf@RzVWAFLZjNZ" },
  "APPO-6CRF-HUQ9-AQV3": { "index": 129, "t1": "sk_PaYWy3KbuM%OybKSd!m5yROxiR?af", "t2": "sk_d::Xl-db-?-+A%9^MPF?o!.r4:@-l", "t3": "sk_E;Bw!lNnj77;xbbg4%9VjUeQLZ^GA" },
  "APPO-PBLZ-EB4Z-4YE5": { "index": 130, "t1": "sk_nd0EcO6LuNHslyuUTg;NcwQUjT.4e", "t2": "sk_ed#zvu;0Xr;q8Jha553:7Z&jSWKWd", "t3": "sk_35Cdy5n6z:zd_yccZTFfDp2rJG7KV" },
  "APPO-75TS-6AER-KBYR": { "index": 131, "t1": "sk_j-BXFyM~T&OVd^dQ_Y%C-d!hKAvoV", "t2": "sk_M%lr+w^Si+ymlkblrrX0SUcG~GN9T", "t3": "sk_z%R..Ly-ILl5kC!Ei-f_tN@m8S5GQ" },
  "APPO-3C3B-646A-YA62": { "index": 132, "t1": "sk_IZNMj-Ja~stx8oE2J!1VVfw=zsZnZ", "t2": "sk_uj5lgfJ5j192lvRynO#cZmZtMl=Sw", "t3": "sk_vfOihY%VQU3lJ;K%l%ZhOO9.cKv39" },
  "APPO-VVR4-PHLL-UKV9": { "index": 133, "t1": "sk_Sg=zh+oEqqNfkvuojv!-L-~t%RbmP", "t2": "sk_EKdCc?kwg79l76c1=%WmagG^-Gkq9", "t3": "sk_q:Yct@APn5f-y0b+:WVc;&KdNw+gp" },
  "APPO-T68Y-DSAP-FLE4": { "index": 134, "t1": "sk_b#Gblt6_SPE_fubd6K+JKfBYoyqzX", "t2": "sk_G%y2XWh~g6+?GIY3adwc=aLeQ.Phs", "t3": "sk_Vy;:3bS3C26xa0R7X~3gY=mKvTGOz" },
  "APPO-HSTU-PEHG-LASN": { "index": 135, "t1": "sk_qvZJ4ucZOck7tAL^-AuA8hP.@V&bC", "t2": "sk_l_I&VI8:F#iLYs+.OwreJne@ciUNd", "t3": "sk_z*F?l+V&:=iem:wM-^z6J9r?rzIHh" },
  "APPO-P68M-EQUJ-97LN": { "index": 136, "t1": "sk_nB880_o6w6o9YHLxS4JSQV.u%&iuJ", "t2": "sk_c4=QKB94686ed%Uaf7HB4p3x7byUV", "t3": "sk_CFN+Eaz~@.z3xeH+mBt&pjiEub:o0" },
  "APPO-6H8A-A38X-LJAL": { "index": 137, "t1": "sk_VjCTGB@cA&pOah*R?rTK=3hQEJ#26", "t2": "sk_Zw;_?y_C!ZKT;j34ygecV33axaM*X", "t3": "sk_2&sSoa.d0?HWhfwfYn9xMs:L13zOJ" },
  "APPO-379U-WSLQ-VZKR": { "index": 138, "t1": "sk_s0bx#Qo0a#Ia+9;DltiFA_:t#86+k", "t2": "sk_z_!sAt;nPLHNW=N!E1kCTdrmDL11f", "t3": "sk_dx^qOoS&dNoEJU7^+1__s5CS*^zT8" },
  "APPO-AQ7A-NM9N-X9YP": { "index": 139, "t1": "sk_Zz6f;uf98jPm%cGBd%esQqV6KyWHD", "t2": "sk_9FC~Od@5.WkBog4NzldyRO7G+cSHL", "t3": "sk_gFI;Q1?CGhtU9l~#%Qe-ZXB6#QOCA" },
  "APPO-5HM4-UGXL-A3DL": { "index": 140, "t1": "sk_zx%*IO^K9=mlyj;vEC*h1xVlUu4s5", "t2": "sk_FLO7I8feA_TVqwH1VFm7du1s0fxox", "t3": "sk_ly9u5du84Ys&#siW?XP?Cjy:.yNNC" },
  "APPO-SGDD-DSVJ-QU6V": { "index": 141, "t1": "sk_D*IEQ%56f+SUBOGGceTQGZkSC+1&T", "t2": "sk_z&GZ3Aq@%Zw;8.GMC;cz*H!=?wb9C", "t3": "sk_tX1l2RS:&!0xl*kwzieAtGEj*XGa8" },
  "APPO-WUJM-86PR-5PG8": { "index": 142, "t1": "sk_MB5~_fWLRDU.dT4&!=lUC1lIOBcd5", "t2": "sk_nO5?Zb@6;wQEp_69y0Wk*zEg1HcKq", "t3": "sk_LDPk5_2x!-JPwv+SV7GCHv:+~6nw9" },
  "APPO-P5FW-8YWR-V6LE": { "index": 143, "t1": "sk_u3PP%~B:RXAda:u3:zDUY!m!ch=wZ", "t2": "sk_NR8:;NkjA6ZV=:%8GWqOBsdq.fQ&Z", "t3": "sk_Y:Z86&FYRlti*D43p-vEc0nV9E07C" },
  "APPO-D5VG-67V9-N42G": { "index": 144, "t1": "sk_tWNjgX;BbxagkC+S1%2ugRXzlPr7Z", "t2": "sk_X~rQm20o90SRW9N_H1Vy!P!FcHfwt", "t3": "sk_10tZ;oIjm93*l*JbvsWrws-P=L8yb" },
  "APPO-SYHZ-SXQT-79ET": { "index": 145, "t1": "sk_o6B;Lu%#Bu:z0TOjs3iQwyU2wWR6q", "t2": "sk_Jg6Ypg8~-%W=J+2#zry&iTR;ykd6A", "t3": "sk_JGpclBc?SXV.pXE%mkr~&_T&!:Sou" },
  "APPO-TKNN-VGWM-A2X8": { "index": 146, "t1": "sk_o60ofd@C1K6@qjH_q4IWT0w_PeB2q", "t2": "sk_WdK&+5cq2Gl~J4-;mzW=zb2DXsomR", "t3": "sk_hHt-XwzQDGnF0q*kXzl.qqEcsFi;G" },
  "APPO-QH2Y-9P7W-33MZ": { "index": 147, "t1": "sk_KY2u#yJ6tB9V_;@#ZQb1:^!b&-jog", "t2": "sk_3~?3c:NJpmU=?~d~U178NVQo_*0!L", "t3": "sk_RuRT5*iB9.BO!Ng*zniou98Aqb1bG" },
  "APPO-SZZE-KHRZ-N397": { "index": 148, "t1": "sk_UXmp~~drcazS6jss+CV2qcDJIwe5c", "t2": "sk_3Q7R=!W+R=~@@ToWmvqAkYy+4ErlA", "t3": "sk_W2x9GjGjiq-V9&phJczMQ7%Xq@WLs" },
  "APPO-YDTR-NAH6-KSMD": { "index": 149, "t1": "sk_1==Q8;Oa.rcFhp_1-2+a#Ah=sS_Vv", "t2": "sk_ijT_:3~OlTn8OIQ*s2~%-MmyK*!_e", "t3": "sk_O!79MOCDHiDBUA&!w8z:Cu%Xi4mVn" },
  "APPO-C9D7-DW7Y-DB7S": { "index": 150, "t1": "sk_kvsysVlTMdV!LOareJvOAGB2U+7!d", "t2": "sk_g1Vg+hf4xt6QFBRSdeQ_16^Jila8v", "t3": "sk_hRc2QvccyX:.e96;-P9Dr#mGY%vcn" },
  "APPO-BW2R-9BGF-LV4B": { "index": 151, "t1": "sk_vZ?4Xj?6yx&y=%RZp#?pQT?cjn-pJ", "t2": "sk_I@HsmISAk9+jHZqAZCTHjYPin1#JL", "t3": "sk_8#v:vq!Znl%NvBevgz?RbiOxsFB36" },
  "APPO-EA6N-JWZA-DS55": { "index": 152, "t1": "sk_NRv6bEuPr2D@^S-c0f3JeN&-yn!wV", "t2": "sk_pmp=%p7Y8Z&uu.VtYP4YCYiusghve", "t3": "sk_Pn*j=U1h!ca=Sw0?ihYOl@?IUpHWQ" },
  "APPO-QTR2-4G9G-47FH": { "index": 153, "t1": "sk_uw~-nUTP6yuKB5*vl=zpuidsyLl-0", "t2": "sk_AJT7z;YZ.gT*dL^YgYEjzfrd1drEf", "t3": "sk_Bx4Mk59&TNMsCCL%HFg^ijfgwGEIx" },
  "APPO-UWGY-B2UZ-5LQG": { "index": 154, "t1": "sk_OZg*gJow#YH^C72&~Uvlymql7&-@b", "t2": "sk_p2??dj!w~QHq#I^wQA&cF^_PU.hbT", "t3": "sk_IT:sMVKzh#SVlD@+M%e.n.!4%PyWx" },
  "APPO-DM4R-QC9N-RQJK": { "index": 155, "t1": "sk_Yrt2qAGuxnDU#:=.uYuYfEu?FL~uR", "t2": "sk_T~UVpB+^hRrs&z;=DiJtFMtq+A8nd", "t3": "sk_9A=iX6=NyO0@pb3TROO-HhYuie.+l" },
  "APPO-DB5E-NJDF-HCS8": { "index": 156, "t1": "sk_diMc:x7Sx*SWwys1~HFiR1aWL:izE", "t2": "sk_x=CUK@H^8daT&jM1LNIgVKo88Gr=I", "t3": "sk_hxBqtxCwvRtq6xab&h7x_plt#mTMl" },
  "APPO-TQRC-GTD7-79PP": { "index": 157, "t1": "sk_B9gdb9=OWClZ#5GRV;@Hoo?%gx!Oa", "t2": "sk_8E0u*B*VVP-u_@aBk=Q;VW-:BSt%Y", "t3": "sk_XqXSh4IsE:xciQ~!U.nj3xjod3hZx" },
  "APPO-MX57-JXTL-NRBW": { "index": 158, "t1": "sk_RWEgOFO+0vpGcecODb#cYAub1#~@4", "t2": "sk_F:xq#Pyckv7-juZ_h@@M0@hV^-H=m", "t3": "sk_RPT@dCqK+4nR2=L=IsiOj--dCmk!Z" },
  "APPO-5Y76-GHWT-KKHY": { "index": 159, "t1": "sk_8YPRZf8hGru~XiYA391bQ-FzsB:+K", "t2": "sk_zn#aU~u0y~=vfNDXI89vS%fiJBwoW", "t3": "sk_2JOm3TGm#cI3_MSjn==ocPSi=g.Uz" },
  "APPO-D4XL-JEY8-6JAT": { "index": 160, "t1": "sk_ppAG~DJbt?Zma*;_X414DLvz_:LWR", "t2": "sk_5J_+c2tupbr3@MH*#UJR_5*G?SbFC", "t3": "sk_38keo#rU::pKX9kyUNGV@UM=eiIeL" },
  "APPO-T6FG-R7LQ-TZXR": { "index": 161, "t1": "sk_B9!-Il3eg~btVb!1KLhhWQ:^gB9AI", "t2": "sk_BQnUm#e?=kOJRomI.6+TD%AKB~JOf", "t3": "sk_fUXbntQ1HQPRX;aFuvB=DlWmB7XhD" },
  "APPO-69F7-KPM5-6XD5": { "index": 162, "t1": "sk_0O2Iz0Or4XwJmuBtXrUj0xDMb5+n7", "t2": "sk_SoeAW=-tFUnFOxJCuTII##W_CM2:T", "t3": "sk_7W+eYWlrkM&Bm2tyO*0.LC@&0LxBx" },
  "APPO-SD8R-M3RW-SLWV": { "index": 163, "t1": "sk_Jyz0qvM_g:pqAhf;h2oVIUuFei7W1", "t2": "sk_rS__AP:CNH6*49AiuyAevBAlW@Rmp", "t3": "sk_C0k:flF_?=4m6QufH^:NVTWW#Ps^0" },
  "APPO-R394-5ZTR-SBCL": { "index": 164, "t1": "sk_d^#I0AQ-m=gh6L~ESqZiC0rM7LbPU", "t2": "sk_0qmDV~sGIPqbE1Wm@gpH5aorjHsvd", "t3": "sk_CwYj~iDTt8w2t#:M~KD7aOH0Buk6A" },
  "APPO-BP4T-AEFG-YV8G": { "index": 165, "t1": "sk_aqAOZ=@Z;pNo2#5a1tbz~f:EEA_bW", "t2": "sk_PPeq*xg~A^Ao%sDxEc^xwzx^yHypz", "t3": "sk_ejQqRICJWPXjhLa=mfU~6?_Q104O5" },
  "APPO-3EAX-MFBJ-AM5Y": { "index": 166, "t1": "sk_BZeQDz?*-B-iP:s!Bf2~3%FNy22Nq", "t2": "sk_MGgW_&jRPf=5g;MhX?ccVgDdW0Y;4", "t3": "sk_6P^C*CrOM:o7+SeSJ9?x~sFAz9yFl" },
  "APPO-WEQK-C3KM-MLGM": { "index": 167, "t1": "sk_0O9WwJ1OXrAnFSFS?2G~hK;:46wBm", "t2": "sk_NNTj2Jl3yY77KIW?rLazSC^VxxpUy", "t3": "sk_V5vDaQVl~_*ZdPfZNKuWEz@!:_nBs" },
  "APPO-NAVB-SSQX-PXJY": { "index": 168, "t1": "sk_ljtC#%bOqP@NJaz8AR&h1e-xwN:.Y", "t2": "sk_THyLvjHxt.#.1wQ-PO2~Nef+hUBOb", "t3": "sk_7&XwM+pXu.m%lee3vmk6Y2l?F3r?Z" },
  "APPO-FEQE-DRQ3-H9GN": { "index": 169, "t1": "sk_dLlsz@RWS9_pPu2XG6E!HjGu%MF&4", "t2": "sk_5&KJWD0*Uvt!PCSBe0TZo!+9wdm~4", "t3": "sk_E+^MJBoB6yHA:FW.J.6JCUFF&aE0K" },
  "APPO-FAA2-WXGZ-NSHZ": { "index": 170, "t1": "sk_Z^^VqNC18P1pu;xSk^fYe0OYHz0t0", "t2": "sk_h&sUoQ8KjyIEtfT@:#!i8aU1*vh:J", "t3": "sk_QwD1YPT%L4@SQ6hsM^q&WZ;FG?aAv" },
  "APPO-TVMK-NLU5-7VFZ": { "index": 171, "t1": "sk_hezThhw^Uzv*us2L37mk.L~@KCc@o", "t2": "sk_O;-G~v4LOfZ1Q85?KHCnYbFEfniq2", "t3": "sk_VJP;FLsZZ&@^O&su;K^P^B6Mu@Ft3" },
  "APPO-GBTH-TW8S-9BTX": { "index": 172, "t1": "sk_c:=~Hu_mozDn:cU62HV!uuKQFtf:J", "t2": "sk_NSd%xadR2_!nF=f45scEO1I&_u3be", "t3": "sk_hE_8ITBo-O+wvBl68R7j0frTOk%iu" },
  "APPO-PRYN-KMS7-HMDP": { "index": 173, "t1": "sk_W%QGWS6:-+.~cIp1zSFgFc&8~NvXS", "t2": "sk_AP?CXw;?vmhk*LTg+kPwE?f@=tP!E", "t3": "sk_iHk9S!CCeIZ^-31#fJvZkbrXdG9Vs" },
  "APPO-N2HL-Z6YR-GRM2": { "index": 174, "t1": "sk_e&RvqIK;P;^dorQCm-P-JhdCE2M&k", "t2": "sk_S=nGy?H=R@64Y&-lvDLns;bP=4ha8", "t3": "sk_o=ZiE*2K.J_4z9~9AyewEL;3V3898" },
  "APPO-MEDM-K6HC-5SCN": { "index": 175, "t1": "sk_h^JkfXs+Nqs.yYtt62Utfcj7dx2*O", "t2": "sk_l%hZ^Q1Dgfx.iU#I:YNv~fWmlR3CP", "t3": "sk_cM1W@F?:GDWG6d-Eor1AT5#HqL&ZL" },
  "APPO-BAM2-F3ZC-U5UH": { "index": 176, "t1": "sk_fl=r+jo5HQTroP~O;AU5&Fx0P~V7b", "t2": "sk_02sW~.Pu6XDvsbQr2?w7S:PfFHhpI", "t3": "sk_gC+mIS5XGAxt0Ge_O1koKANR_pMnQ" },
  "APPO-HHRT-FJT2-762D": { "index": 177, "t1": "sk_jT@lpVGrwybCzLI-E2N:Aw~Vwnd01", "t2": "sk_YxM_vL1G~iVESme7!sAKArK=6bp#e", "t3": "sk_f@JWCK=hUK#jDJ5_2X+P#dZ7supQ0" },
  "APPO-X74A-2HCU-9FWV": { "index": 178, "t1": "sk_pLYNYd5:kpkT:d;bZ~%gS5s~u1Du6", "t2": "sk_KIqCJp#DlDr=pPAcJ@Q:_q+sEumxq", "t3": "sk_yg~#B9lrq0d*vbUgX9CKw#*RWTLwW" },
  "APPO-25MC-LGHV-GV87": { "index": 179, "t1": "sk_HOH-fax^6rkJq%iq:wl26Qo~B1.mr", "t2": "sk_pLt.mZ_Tycm*LkTNic#95H9p90@cN", "t3": "sk_2ggT8Tn.J;xUNv^4O!3UOhmJ0_Ccz" },
  "APPO-YDV5-UA5D-E9B3": { "index": 180, "t1": "sk_Qc^54Dqx54zpV^H.lF;SBq:^4GC!C", "t2": "sk_mx6BBC8mar:Whwb44O2Pl-_DF-o0T", "t3": "sk_BeF-EK??%HRX=gE+CI.4.CP6zB5c6" },
  "APPO-2T8A-2S7J-AL57": { "index": 181, "t1": "sk_CTcz1^~?Q;jbzQaXgeNessxrla!F6", "t2": "sk_zM=zt&:aHZew2zzv=%Q-FbyzBgsw7", "t3": "sk_tLRIPtAU*tWyFguW2Q_fI!2ln~?Zo" },
  "APPO-JBCJ-E57U-84KG": { "index": 182, "t1": "sk_cZSzSA5;mr&Fex^~&6jL.IWdP2?jh", "t2": "sk_rA9KE!0@hd?HKX@Xd!eW#-ke~8O!f", "t3": "sk_vgAE54Vfj%xheCjT6g@;?KpXq1tuR" },
  "APPO-5SRN-ZURE-8J93": { "index": 183, "t1": "sk_r_7R_zdL7NVSCUC%sQs_=2.*7vS_m", "t2": "sk_R?@AZgF#?FeLoe~XdKzdNITCSzQRH", "t3": "sk_Dn+Zu5;rERa-8ltS:Jtlo!8??F.5m" },
  "APPO-YWTJ-MLVT-B9RJ": { "index": 184, "t1": "sk_7c^-;kA_X4?huD6lRUtaqpCCd035G", "t2": "sk_cp?kC4@lwAdjpYpx~FWw:#N-Ju26I", "t3": "sk_7efYt5wi9M368V3977b8sgdk3C-8c" },
  "APPO-JLPD-YDFT-2WTU": { "index": 185, "t1": "sk_BdRWZgi2h;EEFXyqwh@qHDc.bMC-K", "t2": "sk_SV3Vnmv6.jJD9Tu9LGllCzqwJ!!ks", "t3": "sk_uAX.*5;GVUc3=DrO%HU5=eP-uL6B4" },
  "APPO-BBE8-AR2Z-U4BK": { "index": 186, "t1": "sk_qNTZ:PS1JOLnpY8~deAfRCJj;tB+K", "t2": "sk_4Ajjn:Bzs-puR&pDwOd5Ub@qoycTq", "t3": "sk_GFAbWC~BypK9*RWXM^qT18saoL#VO" },
  "APPO-6T25-Y5EU-XRT5": { "index": 187, "t1": "sk_WloVkmX#4%%~L7ra-A4jvG86&L;.G", "t2": "sk_biVv@-1pA7k+A&Bu51WveBmJw0:wZ", "t3": "sk_hR@PmV=4ae+xW4ID8K4*Twe%sA&Q0" },
  "APPO-89HZ-WJZ9-K43J": { "index": 188, "t1": "sk_i4dbx~CtOUSwK8_kiPnqyyPMmxT.K", "t2": "sk_R50AtzEb24sUM&#tG+xbRTlN:H97c", "t3": "sk_V=Gj_q=_7K7tA~sBc+~%g_5N~NA;W" },
  "APPO-BN9U-3E9U-XSKY": { "index": 189, "t1": "sk_qC*4iMij##@.vLMr74itaCB0Y+qGQ", "t2": "sk_DK&y.:B1M&ksi_zgJx%k5-;.T@14U", "t3": "sk_v.tk.g6N5~E.XK0?2#DHX87Bqa;:J" },
  "APPO-CT3W-PDNU-KQ7R": { "index": 190, "t1": "sk_bUYw5Efrgk^xPnsEY%K*8*6X+Rf?v", "t2": "sk_Vu@OOb@k^eaycH+acPeHa2V?MvqQ2", "t3": "sk_0A-!eQGeTXGp=hlTuqDGY^;~iSCVH" },
  "APPO-9Z9T-PKEY-VRRV": { "index": 191, "t1": "sk_0+qHD4w+&DlW1IgT^Om:xYa6#j=CS", "t2": "sk_hzcpoS%Ik3wb?Vg.Fh-aGR:ut~^vo", "t3": "sk_1?e!@q5ZJ.?ImQ.VV-8i0DGa~XH8j" },
  "APPO-LVHZ-CKMW-M45X": { "index": 192, "t1": "sk_WizO6:lX8nPyeYP2Xs@vZJaW0B-C6", "t2": "sk_LJ;OV;BOrBK7hr*11mQjiQGJfNH?t", "t3": "sk_is?YY5Rhrwz96Vh?4c_fDKaCTHUdP" },
  "APPO-LZDY-SK4S-K83L": { "index": 193, "t1": "sk_N.%*GoA6-s^Hrb.:xfWc.Lzs;;jxc", "t2": "sk_2eVL:BhfWkU5C5gIf0%XMsNvwdy0G", "t3": "sk_ONTKaq%bTKjAJVp!kdHsauL%1gibO" },
  "APPO-RRDT-EEKW-HES4": { "index": 194, "t1": "sk_2cO5wr9_%%n3Wc?HaPoq^apjOhg19", "t2": "sk_j93U#?njOLQdb4N%47=t~@Z4Z;^!m", "t3": "sk_y.D-RReX~I!nr&vvgVaYyC4TO1vEc" },
  "APPO-Q87K-VZ8Z-67C9": { "index": 195, "t1": "sk_awlHb%QSA;?HlIw-+_b#-Brz6@6K5", "t2": "sk_mVc!?fg@.Wk~AC8hCt=9I!H+mI##N", "t3": "sk_d3Q^q0QJWAj+DT+#K=Bg-:1AZCPGD" },
  "APPO-SBP3-AMZW-AHGV": { "index": 196, "t1": "sk_i31R-kGwbrVlr-Jn9U-UYeYX#7MJc", "t2": "sk_n7l5yFx+V&RJl0FaMHg+I&*k*0-7s", "t3": "sk_dMQ^@Gw05wzGVmPPeJ44_kyMAbsBX" },
  "APPO-J58F-UZKT-DDY8": { "index": 197, "t1": "sk_qkb#:?U2wlt?JqC=ja2bSsQpKDHTE", "t2": "sk_RkDT:0CZ0Tqmz_Z+xf~r;0FE0zD*M", "t3": "sk_g+kSU!pyYu_;@lwbP7f!&!aBhKI_P" },
  "APPO-6X5L-CECY-E3J7": { "index": 198, "t1": "sk_X_5xVDC7ynVh@@.FsCG#I=#qdu+^3", "t2": "sk_HFtZEYs?:+2Sj1#PGDvOK=g9WB&xZ", "t3": "sk_b6^0.0TY#j@ggiPlWZq77_sRBTvVn" },
  "APPO-V9K5-FAW3-TA2N": { "index": 199, "t1": "sk_nW0H4wsgQLN+k:P;:=YNhcbr#?FUK", "t2": "sk_j;k^f;fCfyCT#vH:-5^k1t3CpR~gH", "t3": "sk_038gi8KHxiVxXxv8@OY~__LW7Qiyx" },
  "APPO-BVSW-VY75-ESXB": { "index": 200, "t1": "sk_K4q~6+-5uORqWpQ#+YQb+tOp98*Jd", "t2": "sk_0!j.m7_J24NHUgNj^:@B.BmZWTsA9", "t3": "sk_B2pV-tE^eUs4;f:*_CZM5?bv~de-w" },
  "APPO-YRZU-EBAK-S8L3": { "index": 201, "t1": "sk_A0YkN9Umv4y!e=3Pi21=&PNrSoBXL", "t2": "sk_Tfb!g:YxTcYjuFyPyfdf71A*DwdjN", "t3": "sk_RCMM5LE.LZeDJMtuxIHvpU9-Wnx1D" },
  "APPO-DSA2-HA56-ZVFH": { "index": 202, "t1": "sk_iLW~jhX:dc*tQKurGHfUm.#WLPxnG", "t2": "sk_sOcqt#n%P-YWCRtWul^OsMe5b.nn1", "t3": "sk_KwDciW4ZOX-wzy5JE.HM2ePPUQ&vk" },
  "APPO-RYPH-XPRB-FLQH": { "index": 203, "t1": "sk_D5=DH!~wtbBm-*.^dkIB3@x7i_kjl", "t2": "sk_Ar7hJO+bGI25~-fG0RIS+gV&tZwLw", "t3": "sk_Htuf8XT1FH&wsU@LnUT%9nrK*47.R" },
  "APPO-6CL5-GKW6-HPKU": { "index": 204, "t1": "sk_m@LKtQ_TOTiQZAj9n@8xmQsOdAo!d", "t2": "sk_U.fsUgjrgy4KD=klaSA0DkCD%GZdm", "t3": "sk_73MnW4gmOCOUrb_FvvkL03-YA+QiW" },
  "APPO-QQP8-ERSU-NEAF": { "index": 205, "t1": "sk_7F4xOnTn&.tbDwq9^:@WY&FK8IRmF", "t2": "sk_dWjj~p?G@aZKfXOwv84mDWB^^1mLj", "t3": "sk_0jmPUUYP8s&E_8A9+-n-K&jfk-lnp" },
  "APPO-KYVD-CC4U-L8UM": { "index": 206, "t1": "sk_7SHlrG5Ks:kFA@3XM&V6f2zFmw%a7", "t2": "sk_OT^!wn?Rwv%b::-e?bux@wxwRGQs7", "t3": "sk_n!BuR@QgFhyv8+_#SOmw#QC*Cc:-D" },
  "APPO-LFHV-GVLA-GRNQ": { "index": 207, "t1": "sk_BbspKrRYSxVEF1GWHJhr0yfFb^NP6", "t2": "sk_XZB4rB.&SjDZuvDQajdRY+bAVBa:S", "t3": "sk_f1U2IuPi6fZ0IAiU5#12Hdiba^yns" },
  "APPO-VUN3-934W-CEZY": { "index": 208, "t1": "sk_UHNMDCad6+IkR?motuHtA^%lRI0JB", "t2": "sk_JIMM=HB6KxKrmo-LEdAPn1C~pu^_m", "t3": "sk_KL_f6Wvc#flu3f%E*v@zndI63DFLQ" },
  "APPO-DP6C-U8R7-TLTL": { "index": 209, "t1": "sk_PD%QNrC@l1W0h9QWcMhZq.9=C?t5n", "t2": "sk_ygzUOj:D:lBWy&?y!m9#e4SbxrMKr", "t3": "sk_JeIY:DKSux2qJ4.A.%:JBM?oDBXB9" },
  "APPO-BHTQ-E6TE-6UPD": { "index": 210, "t1": "sk_wpWu-h7rdQ5:hcEA=ur6s1;Kp@Txp", "t2": "sk_Xz!_FtKvYIvjq3&;@f+=FZxN.nl21", "t3": "sk_H8Hl9!~kZ.1I9;Yc;&grOJ_gGi?a9" },
  "APPO-2GMY-3KAS-YQFP": { "index": 211, "t1": "sk_LO7F@6e5~wE*kPy+YiNfnA?GpE;+i", "t2": "sk_031K2M88*-UgBkCmhJoGOS:&Oxsr9", "t3": "sk_01y.eEZq^t#MAQFh8ivH_OTBS*&8n" },
  "APPO-LYQG-QXE9-KC7J": { "index": 212, "t1": "sk_JH!4zl~E%+Zerve+#r:LY0l+pm~dJ", "t2": "sk_Z?_Q?.1x-gGHq-diNy-Dzb19F6bEA", "t3": "sk_ciJGBR.AlRIaaIean^sllJo+V^q16" },
  "APPO-JWXA-KZ9J-UHLR": { "index": 213, "t1": "sk_I8qfl~feD5m*Ue:_3g?ZbM5&Pkm1z", "t2": "sk_Tg:FiFboFks~m7JD@BzK3mR10Kg%K", "t3": "sk_cKh*VKq@RHtIlgaGTsVm73Qfbhik9" },
  "APPO-YH3G-R7F8-AKE9": { "index": 214, "t1": "sk_t.l.VnphQzN;Xd5g6?O!J~l-pJRJB", "t2": "sk_spoOVodW@RP;n2dJR=O@On#s3XpVP", "t3": "sk_7O7QspmEq0*q2L4BT6I97.f09NfVt" },
  "APPO-FAA4-TBEB-LPX3": { "index": 215, "t1": "sk_Cy8Nyy3gHH@QfrjXyFPBPdOp~rACq", "t2": "sk_RRh!IE:Z7%H6eA#_IgQo3Xl8oixH5", "t3": "sk_O1@.:NMg~NeoEQCIFXukV=hxxo0jU" },
  "APPO-ZYLQ-QYWZ-WLHK": { "index": 216, "t1": "sk_O:;vWEt_V**&-mMZ=xR5&71ObAXVy", "t2": "sk_38=?s-ZK8RAKlDS^!rID_k4_Kmw8k", "t3": "sk_Y;zzhT.yPMu#h70~KiE-8wAiUP;Q9" },
  "APPO-FTRF-8Q3D-XY7V": { "index": 217, "t1": "sk_FbO&-_E173^*F:DR%&L*9TCsbSlfQ", "t2": "sk_FE!T#YhW%u2#4UZIniD?J5A;d?SEQ", "t3": "sk_LP%zS1EF^eb^5k_5@cihP2BHg9:TH" },
  "APPO-UDZ4-FLZR-J5NE": { "index": 218, "t1": "sk_GYI~B:WHsih-~CsLlfVY!!*iMTCp5", "t2": "sk_qZ6vWG3ouHDVfWM51rx&!h#rUYIzx", "t3": "sk_M_?CBAKW7NQMoUAZIBXVxXqw-PsB1" },
  "APPO-ERCA-VKKJ-W4H6": { "index": 219, "t1": "sk_N?YR~GXyoex7q8JRkrc6-SLL^a_#t", "t2": "sk_QSgy3Xlr~trg;6TJBb;syBE~S:r~X", "t3": "sk_YqmhVaKwHJ!uqGL-Oa5z!2ShCEN;f" },
  "APPO-QUZS-GNKV-UZAC": { "index": 220, "t1": "sk_c1UCbpeQkzp#;KtL+_K.96=SVG+Wn", "t2": "sk_Eh2R.=gYP6D7GzAc^K9.b4pEL9vcz", "t3": "sk_pkyV;@U;+.EqMri1rmq3Y^Ab=&78T" },
  "APPO-3EL8-GG2R-UW4C": { "index": 221, "t1": "sk_e;J7T0#uX~ZErTTMrRhZ+ys&=6fYR", "t2": "sk_FQ.#p@7VnZN1sTks^tfJMqR-ER&&c", "t3": "sk_vtj?ISfD4?2J7bI_X1=0+Ye2^J;cm" },
  "APPO-FD7J-BA3E-5ZBL": { "index": 222, "t1": "sk_yW_GTtwblY*YgxSzsXFT;qSk^biKO", "t2": "sk_dQgSRG-d+oL8cYFetfQ&ka54VhbAF", "t3": "sk_J?=XB;mOtcH8#jqQisGRh*&-G%nUG" },
  "APPO-A2JW-P8HQ-NRDK": { "index": 223, "t1": "sk_ch~H3*EV9OTQOmId;&1~dUMR@qOPh", "t2": "sk_suFsU1S%gT;8-ctAhfWaThsCYXQcM", "t3": "sk_qs3cBDBMNx;yLo:qSrl0N5x&EwaOP" },
  "APPO-WE3R-A8NB-7QE7": { "index": 224, "t1": "sk_aCeAIAmFz.E:%A@U@f8VN;.jc1N@H", "t2": "sk_F!Hz2pg%TMJ?3#Dpgs;Ks5hp?w8fQ", "t3": "sk_AEZ+bXxXQ.mFBnn:0Y=Oi!jOPq3m2" },
  "APPO-A4WE-LCRX-HR6T": { "index": 225, "t1": "sk_P--:Asxvna~oFdyG_.oKWcw3k2Ber", "t2": "sk_xeeK9haQf*t98V%n41g7rwYA=;9SK", "t3": "sk_K;##pd*O9eNC*iRJ;+vtYfPT&0g8W" },
  "APPO-MDXC-957Y-CSJ5": { "index": 226, "t1": "sk_kDKi^y+v3wr3;H3_ek@_w?%!0IWYX", "t2": "sk_I8C-pl&.=OE+agFqL@gZW.wrK.E!F", "t3": "sk_T0L%iz=4vDUBp@^Ay~Of;wSqIHI1P" },
  "APPO-VUFB-WXUB-NDCJ": { "index": 227, "t1": "sk_e*QB#e~I_pBq;WA3Su*@;^yzEHKV2", "t2": "sk_N6yY*F1:pXbB?ZQrVA_BvUnQp%;*P", "t3": "sk_fU7WR1Zqkm-Ex.sg.yFKgyVABsN#t" },
  "APPO-LDQR-YT2G-42NK": { "index": 228, "t1": "sk_PVm--eLa.7YGrSxo58s^gVmsDQETM", "t2": "sk_Q&p.J00#3:IYe3Vp8f.n+*%d#38FI", "t3": "sk_2gPW2N_Ix.r?Ild1KZQoqImb*-Tsy" },
  "APPO-KTUX-W3BV-5SK3": { "index": 229, "t1": "sk_BMB+*wJ&LP?YTDk=v7EI#lsoReTW8", "t2": "sk_Fk;2MDTJc#i=;HaewhPafXLcqqMmZ", "t3": "sk_VW-UKS1pJEKBkK&fT6@iBPjn!*Y0J" },
  "APPO-FM72-H5QJ-FG8A": { "index": 230, "t1": "sk_nK65PrSlQYjB9:oPdL_6AZ?qVc6~k", "t2": "sk_4&Hmr%7mOf7Lbg%Lk4eV*9o7hwJH0", "t3": "sk_H@sn:Gloh;~P!j6:yfjG:SUNGXN7s" },
  "APPO-RWVL-LBWD-LPL3": { "index": 231, "t1": "sk_cU6nL1jZ2uMNGdw:MyUfzf+3xYypw", "t2": "sk_BxEbT#O397ESqBZiJ9gNz1+8IkDl7", "t3": "sk_dd2WbBgif~:=jZcmS&&5jh#niA=eT" },
  "APPO-F857-XRQN-KJNN": { "index": 232, "t1": "sk_yV-@nC@2w=?WPfp;g.%9j_AgqEl4y", "t2": "sk_fRCSyq7H?W-uluH%xGcBT2FP^zd#M", "t3": "sk_kG0^q#Gm9C8FOy.X0-q_5ZIu2z3yI" },
  "APPO-AM7T-RGQU-V3KU": { "index": 233, "t1": "sk_QlCKmfP#+=Wpd*L3%P0E8r9!.KoFv", "t2": "sk_adQxRSTu_P8S8IKILKU~tLuLXL=yW", "t3": "sk_4W:ws-G!QFFUTLOjK:4vY4u:Bk6TP" },
  "APPO-LZ7D-U55Y-XAN4": { "index": 234, "t1": "sk_i;iXw00-ZR=ReOcM3OutuR7mHdz~I", "t2": "sk_SOaE.61A-c2~jc6DbP7QsFun1+j3l", "t3": "sk_4?a?!Tp=94x2CxLF?KHUPFcB%Trjw" },
  "APPO-KJ3J-AR44-95PV": { "index": 235, "t1": "sk_RBH.ECpu+Ag~?ns^Q8lt3H+2J+&-g", "t2": "sk_JTPu0;mQW_wzu@!Xcjoqk_Na_dk3f", "t3": "sk_9GqNX-8sqkQ@4D~=K^s#3#HGXACJj" },
  "APPO-9VQX-PXWX-FUND": { "index": 236, "t1": "sk_3osncOclQooemeJYNkSOuti84%zzK", "t2": "sk_TOE?zCtz6;Vrz%n_9ua3H~KJyl65z", "t3": "sk_6Aa09pBNFA1G7On08PO=CTJpeZ@4h" },
  "APPO-HD72-6CY3-HKGA": { "index": 237, "t1": "sk_BBSiv@IN^f4%!PGcM1~&wkpG+6gwl", "t2": "sk_lfap#j%YMsUWjPv0SMNIFfAcr&p8Q", "t3": "sk_bNK6hT1osxQ9J;:+.VGnsA@;xxa7X" },
  "APPO-RMSF-MSC8-CVJK": { "index": 238, "t1": "sk_r%YSVOAYH8Q1sj^-i?KhHC;#Ue3Yj", "t2": "sk_uc7AIbdmp.zAW9KvaBOw3Tnbl=kaD", "t3": "sk_D?fIVf5AHi~rAtI@IzgOOl~VpDD?i" },
  "APPO-LH46-38KN-9MGE": { "index": 239, "t1": "sk_HOfH@eVfVFPW%fVhq+%9fL=guUi%I", "t2": "sk_HTsN6hYHzH031nl7eXj5N3JsskCQr", "t3": "sk_lLikbhG7fNruZmQc7VwvY!RiauqNu" },
  "APPO-8868-8P4R-DKHL": { "index": 240, "t1": "sk_UbCD74~X%rP:N+e.0;+!Xh_n*CG4G", "t2": "sk_sgWp*GUs_w3VJx?JW9CCpWmXWmjS9", "t3": "sk_a;-#b6580g5^*YYl4JH5ZIRPKF7Fo" },
  "APPO-GY7P-C72V-927B": { "index": 241, "t1": "sk_rX@rU2?tw!SKAPo8P0QsvZ+v6GKsh", "t2": "sk_8rokb:M0DJP+iLj!RGZnLNgzhcJXE", "t3": "sk_PTlSkQa0ss5wu&ncubKzak?~dHHqK" },
  "APPO-D9N7-55S4-T4QF": { "index": 242, "t1": "sk_OMuWA9Wv7lAkPPTE@HPdvqwWpWzzX", "t2": "sk_Stk#aK0R%BLj^wi!a#=&EMCby!^wC", "t3": "sk_P7ErSef7x5Ig65GYG+Q3H@&3d^;=e" },
  "APPO-6AUM-5UWZ-CRCP": { "index": 243, "t1": "sk_nCk-uhoqwVHe#jD4wm#7Bbo3GrR%W", "t2": "sk_h+ZUT:hYZN.owxm@m@BoI^.0:*JYN", "t3": "sk_tDr;z3W9KwnpIe_N&E7lj+sFPwQcK" },
  "APPO-WW2J-TZDW-LZS9": { "index": 244, "t1": "sk_I5P3%f::iB_+lSmLW_bXVtB@OXG.c", "t2": "sk_9A%N1K;&PW*Wm8q=#+pedXkFAR^ev", "t3": "sk_63^=uX4fhT2OhAV3v-S13Q~+#?;EK" },
  "APPO-TLUJ-JJB5-TED9": { "index": 245, "t1": "sk_TvWR!ghDTiKH!2.knwIS;3JY&Io8Z", "t2": "sk_el@3Y;R;yTH4M0FWPfan#F2;MMA8R", "t3": "sk_sh8i&h=-@Rued#Py7^9AN4!?.c;gH" },
  "APPO-9EFD-6CYQ-6FZS": { "index": 246, "t1": "sk_42TG37=sEA#4Hw#USDTb%zZsMPm^n", "t2": "sk_tPRI9Wjd6dA5W!;?RVFRIUPM#R&uU", "t3": "sk_jJ?5~Chr2TeWP57AH4%brlxwo.1Zm" },
  "APPO-2VBE-VYZQ-2W9G": { "index": 247, "t1": "sk_c!z_Y9ZR&jdc?4j&+g5x1xDDR*H#w", "t2": "sk_z*P#CR@hcUh=8%Hn5*jF?@lh2Ph_Y", "t3": "sk_VHzuWa%X2eYm2s&?BY37vTiR_7lCT" },
  "APPO-MAYJ-XSV6-VHRG": { "index": 248, "t1": "sk_CFY6;V&IRX5ww1.GZasfw^aMb2j1t", "t2": "sk_H1ik1jNZrT=CD9=oXpKV14A&~fY1R", "t3": "sk_4XbQIV9i1ZrGI-a#sEKnm_U&FvUv8" },
  "APPO-KBN9-359W-KSPP": { "index": 249, "t1": "sk_r@57Ra3iWNFcPsx3PdW1Q1+6CWeF6", "t2": "sk_4R5LfK^;q.p#*3eEty=%jarxq1d^p", "t3": "sk_I.tC+6WQYiF^EOfG*4fHgxClqU5wU" },
  "APPO-U8EW-WB9W-P8EJ": { "index": 250, "t1": "sk_YeOZ^!AX@#m2!6Ww_-.LziF_^G+*b", "t2": "sk_f8YV@v=0A?y2-@cfvEFqT;1J=HRPj", "t3": "sk_iUQl;#;M~Yycpd9h@Q9t#+Yw;t+Yu" },
  "APPO-28C5-4S3N-MHZV": { "index": 251, "t1": "sk_IXSLWOj^PeR@I;QWbTVVkYsygaG@G", "t2": "sk_U.G.+9Ys2Z@6y;*_3-F!@VC&HA@42", "t3": "sk_4~?:wdi5qPjpu^NKQfNy571Tn%Cz2" },
  "APPO-NKNY-BJY3-DNCD": { "index": 252, "t1": "sk_143nl*:8^gYCZfU+Cf^jb3nPHqiRB", "t2": "sk_6sQgG&;zvWwrjsL9hDTtToJs@p^?m", "t3": "sk_wDGJkpa7dEq_x4#;lu0_?.q@R!egQ" },
  "APPO-FMWY-64T8-PWHE": { "index": 253, "t1": "sk_l!2m@88QuP%kUaeHzwCfCw;o1T5sn", "t2": "sk_0&Gn=-nnx082bgLpaY*.mx#~#La@b", "t3": "sk_zO6OpJjsI=:VWq5bB9fUjQ0.plmOZ" },
  "APPO-RXX5-MQBJ-NXHV": { "index": 254, "t1": "sk_ayIdl*&L+CBI@I9U2hzP*G9Pd5utb", "t2": "sk_wXvOP_V%.El+f9&8iG1bla6nlO-G2", "t3": "sk_1PMi8R4Eb_M~L7q2pg40xqnSde?Xw" },
  "APPO-FRGD-B3NB-JY9W": { "index": 255, "t1": "sk_iWZBpbCXOk1RB1Fg0RhsiNFt1-M69", "t2": "sk_teiWp*dsYigo7RMj~+o3p?ix:38RH", "t3": "sk_ZXjNLl~QZCiMjzh_10Y2?3t3sHj.3" },
  "APPO-7KFD-FWAT-LBZE": { "index": 256, "t1": "sk_lNt_iYfjJq-T?.#A9xrXIqscFcY@t", "t2": "sk_YE!VY&2R@+bfd-86iZ335~wS4zSo0", "t3": "sk_1!cun!4!6hB~VyNEkzlv*MJ@RtQ#2" },
  "APPO-XDJE-X96J-8T9X": { "index": 257, "t1": "sk_9ZJ_Hog-6m^:lfOPc@ZLDA6*adNjp", "t2": "sk_l:.4!HfV77i_VWVA#_H8-^pd^yo#W", "t3": "sk_DYJzckP6^%RfyON5CrQfjLGGHE&hL" },
  "APPO-ZADM-K9J2-5SKU": { "index": 258, "t1": "sk_oU:5%3yl.A#u=_e0tBhp2*TFd8~TG", "t2": "sk_m!QF?JZ;cH#3B=8Jzi9=6;Y6p!Eac", "t3": "sk_U#G!JL_aU-z!Xa-4;S@oyd!xm4C;n" },
  "APPO-B73U-8W4F-MZWV": { "index": 259, "t1": "sk_ouir9np_VI&Sxw:9zUaF4Tv*^VOGn", "t2": "sk_V0~OHlBz-EK?hTEXIt!tdF3a~vy%q", "t3": "sk_nl:lTY!FELnd@7pjQW*;2T5MW?SzT" },
  "APPO-JDYM-RUQR-T4G7": { "index": 260, "t1": "sk_yexosD1~CWs4AbMG*q*#j8T9TCg&n", "t2": "sk_sqFeKm@u3xAr=+=j%7E2.xZS!0@XX", "t3": "sk_4F8f;A3IGZRlY62cE;*+CWkbiR-zG" },
  "APPO-8T8U-6Y7V-5RGT": { "index": 261, "t1": "sk_qNwu7#yQZyXG0+SJH4fhcWT?Lp+5Q", "t2": "sk_esza00dv;aIVjXe6jnf#BzvB!32Ex", "t3": "sk_im+rXZ1HQR^GaKH*xBuyrB0yo3OH0" },
  "APPO-LQEX-RBYF-RTQT": { "index": 262, "t1": "sk_FG554GRiMiF28lC8v:SDoqnvLUqLq", "t2": "sk_D;Eqg!OpN-?;pD*HQ_d?2a#bNsKOB", "t3": "sk_Te9=Cc4V!VMBHrtCG^xtOnhFAjX~K" },
  "APPO-KKKA-5HQ7-N522": { "index": 263, "t1": "sk_GNoKyv*wDQP:vM-sEi%;l!GFq+.D7", "t2": "sk_sj9mxegZact4A!-+:Un7Eck!~lTN9", "t3": "sk_Uoq&0?GNNA%algmDunQqFeu@ZBbr5" },
  "APPO-TQ7W-DM3W-2E2Y": { "index": 264, "t1": "sk_d.=hATqmhiiMco^lv2_D75AH4fLX1", "t2": "sk_fPa_8:J8K*yCuSGCD%bLqoY?GqCCm", "t3": "sk_fvGvmOgjwDeP%!f?wqQpKG-Suj?e2" },
  "APPO-6ZUS-3UP4-V6G2": { "index": 265, "t1": "sk_g+%Jsch#m~8Z.9Hz~1@4@n_5xG2=e", "t2": "sk_Y1DAZxVYqAle17^g:J2uMcZ+our_R", "t3": "sk_IanUMoW-6;LHid%LJA+A?KOJMks?P" },
  "APPO-9M2W-A7W4-FNZ2": { "index": 266, "t1": "sk_gLiVmb!;S2p*txIENhBzg:Ge3dJd1", "t2": "sk_sfg&f~w2YNL!3yc:bd?5G=9f@LXbs", "t3": "sk_wc^#_8U-=&5bGlrPbRbmjaKPopdBV" },
  "APPO-Y4TH-LNHY-NDP8": { "index": 267, "t1": "sk_PDVWyq%@lQwp~3wh^+oI^XHBHq5Fo", "t2": "sk_5DTlRp!!SSYmqAUMxz@q@Ca59tJf2", "t3": "sk_nBcmNIkpG^cWmKaxVuvkWLsE00#5M" },
  "APPO-AWK2-ZQWG-7795": { "index": 268, "t1": "sk_5_TvUgV;1N-kitE7VPw~6FTDxSnRB", "t2": "sk_O=woE8l4FoKG_.;##f*Yeru=GmZff", "t3": "sk_MwM%vrENT!kUZhM38i9m-?TO#~fhO" },
  "APPO-G5Z7-LFHH-SG3G": { "index": 269, "t1": "sk_mV*6~;_NQ8;5W_6DHSq^Od=FF+l+P", "t2": "sk_0ut#h5R%%=3#9b@cqmLpzRoq.fT9W", "t3": "sk_a^O%nIC-8;VE?hG&eXC:d_~hU=R^L" },
  "APPO-WJJ9-PVB8-ALPL": { "index": 270, "t1": "sk_UmNCN~nUWlOyzsy4*xJF!=GCRC?Gi", "t2": "sk_J0BWLJ^L=fo^1gk^sTD-GHJ#qA:^B", "t3": "sk_d!:@s:&Yo*6r7dj^AHd2GFa6FcShT" },
  "APPO-LUZS-4H4R-A4UY": { "index": 271, "t1": "sk_5LxB7McS5kSUb;RXiZ2?MKmWEUxpE", "t2": "sk_IF-6esAxI^^DJH1jK+RJ^;%.ClGAG", "t3": "sk_kI%WnJqv*C&e-X9SCD+Z?FyV.GMpg" },
  "APPO-Z3PQ-HQUL-RKXR": { "index": 272, "t1": "sk_LoWKp6CcFeCZHjc&w#rjfZkCUgW75", "t2": "sk_Te!1lqWR9=_v7o_Y7S3BMnd~wtzwy", "t3": "sk_T.QK!ubVM2Rc~RNo6b@MQjE34DhCS" },
  "APPO-6FYU-ZQWT-4Y4K": { "index": 273, "t1": "sk_qDU82@E!B6_ImTJ1?nJWBGF#5JD~O", "t2": "sk_C2h-NEfWhMhq?b?wPar#gh=c^Kde3", "t3": "sk_J^k1fRtZD.3U^Nr^z+VTKfKZwUtru" },
  "APPO-XABS-A5SB-YWV4": { "index": 274, "t1": "sk_iS?_lUX2r&~Ohs%R0jTu2OrYJs35I", "t2": "sk_ZyKsi:CUYS.d_oDCG6*T!ZYtMbqzi", "t3": "sk_nw4?H1BNrFdE5Y1AbShBDDFJTJ;0t" },
  "APPO-H68S-JJNH-UDTY": { "index": 275, "t1": "sk_tTH#9LWCt^.FN0mVZZ3O:!S.~@IuW", "t2": "sk_tygWbTQ~I09ly^.^BY2jjjWY~Sy&P", "t3": "sk_k;nXJ!:I&Hj5CHIs6kkZTv.@Wx8:u" },
  "APPO-5VC6-ERTW-STJV": { "index": 276, "t1": "sk_ThgI8*vN2qgzj;@D6kUwb~tK#su&r", "t2": "sk_J~HS.UbaN@AWVR_~A~tYQS&vAYxaU", "t3": "sk_LnLsfV_MpOjPvj;!:NCCeWqoqgFG0" },
  "APPO-MH4B-7TMG-BA4C": { "index": 277, "t1": "sk_YZ182D!:Ys.2:a~XjR.~R;sG73+DF", "t2": "sk_Dv:19bpQg.LA0^y:ah.SoXamrYlgn", "t3": "sk_m:e-SI~7d=#4B_Ex!!rD_4&9pid;a" },
  "APPO-LNSX-AJBY-8AAE": { "index": 278, "t1": "sk_1d;WsBvyHBcJc8j!a?lgL.NI6!%dq", "t2": "sk_v6IzGZ?_j+v=TyYQVyF50rLy^ngeh", "t3": "sk_r;z4ywy9F0^iI%LcQkC4sKtP0*=v7" },
  "APPO-K6XE-3NN4-RX3N": { "index": 279, "t1": "sk_Os!JvYq8gcU_sGDxVo6X+KIfUAXPX", "t2": "sk_V3810=o4-.HGPcoFX~MHdN5ySvsML", "t3": "sk_o@3ZO~-I6yyCh1q*7QpT*wEiQlxCP" },
  "APPO-47W5-T9AT-5JHC": { "index": 280, "t1": "sk_P;L1G*#xXzXpB.HbS^!LHC2_BjiKt", "t2": "sk_r-R&!IPKY?VYxhZSO2T3L_ST.Onjf", "t3": "sk_ZxZh@nD+.+qM*rUF+I&#:XaWqw0J1" },
  "APPO-LT6V-72HL-CEBD": { "index": 281, "t1": "sk_7:njaU8IiOSNop?hdljoVd+ec@J:8", "t2": "sk_EvoSqg;HyU^tMd9Wma-qe4c.*YmGc", "t3": "sk_37cWItL9zn4_vnWgMm-A1sO9B6!Wb" },
  "APPO-UB98-E6BF-HV33": { "index": 282, "t1": "sk_E&b1~N7G#tKgT*#gIBcpQC9BIy60p", "t2": "sk_Mfdmu+~xVc@bH:cfto&ha#ch1Lh*M", "t3": "sk_Y_WCSJ5=gnsDn7c%fEJm38@R+KHHs" },
  "APPO-DK2L-S4HG-7ZBF": { "index": 283, "t1": "sk_eA+i0TrlyeI!OMQ;X=8XHn5yftRS9", "t2": "sk_abmZ1hvG6eyx-%@ePO@8xEnZvTi9x", "t3": "sk_6TG8e-ytll!TB=F&qf10NETPQ^:AM" },
  "APPO-F4KR-RQF5-TJLS": { "index": 284, "t1": "sk_HI67l6GOn9w995jZBO%am=STnBu*W", "t2": "sk_B~?=:LFOl%ab.4T.h8ol1OS:P*acW", "t3": "sk_O2-86Uc71gYn.~uIWs8DqGC35gy6W" },
  "APPO-TLA3-DNRS-ZYYY": { "index": 285, "t1": "sk_0@k#%BGW%___d5!Zs5nvJ%yZgV-gL", "t2": "sk_4TYxG=Ky3Qa%X20%PIWt!Uo#YXAiM", "t3": "sk_HzPhq*hz-9shdWn-75.I~QN+=rDdc" },
  "APPO-R4L5-CBH2-V5N8": { "index": 286, "t1": "sk_Mb5RyMD!0sp~1p+8;zB~=+q4eh-wK", "t2": "sk_sp3hIdPuGaf;qUytA.:-MVyqg9npQ", "t3": "sk_EJ5tJsrFmk=kBU=dP-6Zz@Q216PDi" },
  "APPO-XQF7-YC7S-6RL6": { "index": 287, "t1": "sk_2yto#w3.6cqZ4AquG;qovpV3-ty&7", "t2": "sk_Lp4skG758o5ePCcc*h@McJR.2q.EH", "t3": "sk_Z_D6k8RoORa^6ISlmcJ#W&VUzljVC" },
  "APPO-5GZ4-FPKY-44WZ": { "index": 288, "t1": "sk_y-?WGOH2lJHIZN^sVT&jMTXl~kmfm", "t2": "sk_3OWp_XeGBwf&C~xM+3:Nmd+:e9s:A", "t3": "sk_j.c%^+4P!yJ..=d*@+S9A^gGVNeNz" },
  "APPO-MNR6-69MB-PQKB": { "index": 289, "t1": "sk_h%0%;CkqP@UP!ox#!PcTE_ompSN5C", "t2": "sk_z?_4VlgJV%FJ.k87Fozfg:0d1Ahz4", "t3": "sk_9GE~U*?q3!Jd83aS+iOIQnG@b#~qn" },
  "APPO-W6W5-GES7-GMDF": { "index": 290, "t1": "sk_AYM=*q1pyVV&e9:o_a:?JS83-..KA", "t2": "sk_VcP@!wGn.UjH%O%TPiJ.Rj~tE6@^a", "t3": "sk_i8i=qlnqB@rGckBq;oyevN2^rjnNR" },
  "APPO-37CP-3Y5M-ZDBF": { "index": 291, "t1": "sk_j7M%UGm~u_w5fzgO4f^!Vlb_9Dj_n", "t2": "sk_ZlCA~-ei*tJ+K&W:*_cUp!#m7y=9c", "t3": "sk_ai^?b?eXF5&m4;_=Slq?LhuXy&We2" },
  "APPO-FQA4-6TTB-MTDN": { "index": 292, "t1": "sk_Nkb2Cb5uBU%!IKZPZ6P^zON2K-7d7", "t2": "sk_m:qI^PY~9@vmL?EO.3qa@&R8K.WLE", "t3": "sk_Zr^GHVmPM-di27i3mJrdF!?x=V*rc" },
  "APPO-LCNU-BPKC-B8GJ": { "index": 293, "t1": "sk_WD0aH0cEfeAgKM.WH.Ti_b+5vF#d4", "t2": "sk_lL~;+?Cc?ZhExK1Oo7AN*s!+d+Wds", "t3": "sk_As:C8vo_#;QZ8oO4u:knQ:cr&J.mF" },
  "APPO-XNTM-NB96-PK8G": { "index": 294, "t1": "sk_TYc+snEo%s_&p^5;aMmMYMgS5_~;C", "t2": "sk_jeHky%lWZ*4FJ64vaB.dw=HazA9Kb", "t3": "sk_ngNE%ChMhQO2cV-wGhThH;=ts9h6J" },
  "APPO-7Q4M-XDY6-MMZJ": { "index": 295, "t1": "sk_mMZre%#bAFyK2:7Cbn3&+1&NMLokw", "t2": "sk_G;.PoTGId#5slFWrst.UN@Tc_GZYx", "t3": "sk_Rs4~ygpZ7&Xt!w;vJqak.s9^@Ig.V" },
  "APPO-QQ7P-5EBG-VM84": { "index": 296, "t1": "sk_oOp-zw;pH1ZF+LfRyYYh&87y!UYOC", "t2": "sk_0WUM#09!~+JxyhPR2Sv?.3K6?At.h", "t3": "sk_TpU885Q88jzv3#+bzECBkVz6a~F&B" },
  "APPO-YKRR-Q37A-VPBP": { "index": 297, "t1": "sk_RmBGWCtmNBj36@1.H;z9ov_FYBimB", "t2": "sk_kG@;2jWF~37-6F+_4AAd.BJvMwvou", "t3": "sk_B0y7kw4jt2PVd!eWZ=gedTz6qi0&m" },
  "APPO-XCQL-P42A-WP9Q": { "index": 298, "t1": "sk_4uM-M+1+MsZXKk^y~Et_F~iq+^bhW", "t2": "sk_5:-reRrja.WQQ7?TVSZjeMPrdL-Y0", "t3": "sk_k_aeZmaP?#-Y:i%eB0.gx0;x2LJbD" },
  "APPO-KTBG-XH8A-FQ97": { "index": 299, "t1": "sk_kgB-Aa%Pfmwp+;Xj0uwSe%1i@=#1r", "t2": "sk_6vgUG%C@9nTOaCl&v=8C1NYJ%6o25", "t3": "sk_12w%sRGq;v-y_A~^btx1zM3Df:o.Q" },
  "APPO-R8Y2-5WWU-ZYQM": { "index": 300, "t1": "sk_4bhNT!6e.IKuuaSAkKfhWl?nB?PPT", "t2": "sk_og%wHPc%_ZLz#~XJ-:LsGGde+IXvU", "t3": "sk_urQvg+hVv4Iia4!K2N^k&;OUtzq*q" },
  "APPO-TFJL-RQTP-8DGA": { "index": 301, "t1": "sk_wKIIO:Ya8w%M_qnJ6aq#3CO2g.98e", "t2": "sk_0emaIE1~slH^zq??egrncXIl?aqaM", "t3": "sk_r*76AD%5;2PQW3.FxgoUksFVG%N:i" },
  "APPO-PEEK-Z99C-QUQ3": { "index": 302, "t1": "sk_Bu:d4Eb-XFZ8=X2g4R5Aw+&xBK%xS", "t2": "sk_sF+tlPewf#jRnwCtf+@cN:1:+AXVg", "t3": "sk_1fDsJx=&ejDqe^AA_xKB+QRAA3gjd" },
  "APPO-TNXX-S4DL-CJ6D": { "index": 303, "t1": "sk_JaLQN#L9FF*FcGicHa.ehPJ@dT~DK", "t2": "sk_K9syLl7z5sq99f!uxt7IfaKauRSEk", "t3": "sk_vfqe=I^R7gKQ4y;BI^&F0F4Tk+J82" },
  "APPO-9T2H-LZU3-H2MU": { "index": 304, "t1": "sk_1bz%r%9Z-eqe9%PxE3O_VCE&*L%UE", "t2": "sk_dg%#=kc1CeUE+pwR:rnDz^xy1b4Ra", "t3": "sk_Os@p^931_A8cc62*I;76Z*x9eA@FD" },
  "APPO-YH6Z-63KC-ZEVV": { "index": 305, "t1": "sk_OEi6WfvxR6ZPPp!.Dl@HJCBpw4~Em", "t2": "sk_fm9%gWeuAGT#Lt^2W527bnoQ-rht8", "t3": "sk_Ra:t8h:0Mplhp6xGpCkZom!?h#Okx" },
  "APPO-HXRB-UVU6-22MB": { "index": 306, "t1": "sk_IeDO_H4DY&bzV.F_b#KLvJpBX*6SY", "t2": "sk_92i4Y3m::1DM*DniG?rWRr6+OXtrd", "t3": "sk_5f;^Ngs&jYE2#n;gf^nSCk=n-0jke" },
  "APPO-3C4V-A4K7-22RZ": { "index": 307, "t1": "sk_I.H^YSG?^;d=i6SzUTzpd?zE1:mFF", "t2": "sk_t~.?3+;Xx2Geu%3C_EtF*+cOm!GD6", "t3": "sk_6?r6qC9C&*%PbYAE&*~&R^tY=m8Kj" },
  "APPO-KBCA-V6ZM-LS7M": { "index": 308, "t1": "sk_5mk5YpeO%#G3H33pCG:9@NIq3l%l0", "t2": "sk_Cw^s2.UW.vaG@s:dzaV-;ab5B2Upw", "t3": "sk_GiG28Lr8hWzKJxrEm%_%sqE%KlmqN" },
  "APPO-6RFQ-HWXY-85GJ": { "index": 309, "t1": "sk_DapwA.g5bd3&H:Nw.;:pcJlG?6;=z", "t2": "sk_CkaW:AeTKI*wHg#_*wu*^Q:8VWJFr", "t3": "sk_Gh7:^4dh&tb@_x=9!tsj9=#L4r4;5" },
  "APPO-5W2R-WUBK-4XEV": { "index": 310, "t1": "sk_CnXe?b0.E2vaPRERNSslkAZk0H-Cp", "t2": "sk_Gbh=RoFwf*p:3PP%nqbtI_IC9DzXQ", "t3": "sk_w116RA:qUq&U@j2#:.Wqi6@0%6dF1" },
  "APPO-W3UJ-H5EV-8SRN": { "index": 311, "t1": "sk_VM?TQiS:Nt%5GT9*ZqzilEa+3^L5T", "t2": "sk_nqvlB3z~uS!@1TtMT@Bg2537y*r36", "t3": "sk_AtJ4JMpo?#Q!OCP^IcQ7?i0*.J5@a" },
  "APPO-S376-8PJL-LPFD": { "index": 312, "t1": "sk_iG7kDB?.+9AurbV0ORC^HFBg~FJbq", "t2": "sk_4i93D1+qw6N=bbO8od1+_0Zh^ta%r", "t3": "sk_vJ^yogL&ENd8BBm9bIyxX#g5h;c2d" },
  "APPO-R8KX-SZ57-AKVB": { "index": 313, "t1": "sk_B6^tu&ftX+zCbE&uObo%%CG2eHnIx", "t2": "sk_8Qi.A^~A~Mt9AvY6SRK~LtxhEGgav", "t3": "sk_YtqCSckheLnDcEEp#~UpcZ2hIL8-K" },
  "APPO-YTUV-JW96-UPHF": { "index": 314, "t1": "sk_mLtXGKB?-:!4K!o~HYiJGGM#F?wRi", "t2": "sk_oHQ~tOulM1fbzB8jm@s4ishW~P%UY", "t3": "sk_ago^s.~EsPp3Vi+bw#?U8t-hMXcGL" },
  "APPO-AQJF-UYBU-QHMS": { "index": 315, "t1": "sk_f*ZMbIW6=-F%Ns7Vjb*Q2iqnLUKLY", "t2": "sk_u._!%^W+AlGzE2pH&tqyd_^Ni9+UM", "t3": "sk_uLEkvy~EZOX%k#0_wo~at^@Jfg:cn" },
  "APPO-TAR2-BPTS-BXBD": { "index": 316, "t1": "sk_Dk3jureYv!clBB@Um@x6vt.kSMDeR", "t2": "sk_9%ng66Nuf-d^UeAV6EF!mRU^NLlBL", "t3": "sk_3X!D:Y+gD.DZizS4#tv5Fx7r76QBu" },
  "APPO-3V8A-4K29-DVTG": { "index": 317, "t1": "sk_rMhWlR2BoG97u=:JB4A-sHhXuxHRt", "t2": "sk_DGGVRePq0JZItl=D-Z_7p:BQS5?.l", "t3": "sk_inpjWF!xx*fkS74:~4bsJpVdZG_@a" },
  "APPO-W3FG-6Q7E-7S5L": { "index": 318, "t1": "sk_UM*FQSc3MZdu*wUnliPsZDTlJyBHt", "t2": "sk_F3Rh_v9xo0MRqGE_4Vj~JtM:iA.n3", "t3": "sk_MoxzhiA%f8&fIrMe~erde2u+-@0^C" },
  "APPO-6SG4-3HVX-FN45": { "index": 319, "t1": "sk_zrS?:VMmD+lEinrZGrg:;-JM.xqVD", "t2": "sk_9%t;YItjXmS:-0NjeP-&uKSQWtX;E", "t3": "sk_uyK8U%EK%t=eF1LR;=nrTonKzyfYd" },
  "APPO-UQVC-A4DK-FPF8": { "index": 320, "t1": "sk_Sl+A4upeCzG*q=w?T9NTIsq9s^N=a", "t2": "sk_h!kR&_;WM8%Ata0Se%BuUcKVKf0Rt", "t3": "sk_DUTsWCbjWaT:kX?.q-FEk.IsLTjHA" },
  "APPO-RFKA-VLPK-HHQW": { "index": 321, "t1": "sk_nEhp3@WZFG0O#xw+sl4tUJXDOPpV8", "t2": "sk_BnJ80j2%pntN:VMs&h-E3#:+JAjHF", "t3": "sk_uFoyHw#jCzR?4ABj%OXQ0*+pS2q9G" },
  "APPO-644G-2FHD-CBXJ": { "index": 322, "t1": "sk_9duuTRHEAX8UjFV.Kf?UY7P1.LC.i", "t2": "sk_tlO._LKoy-T9AYVjawtk2vE53_cE0", "t3": "sk_deFrMPP&C_xVC500DU5z~+wNc6RM4" },
  "APPO-NG8C-Z9MB-DGGY": { "index": 323, "t1": "sk_fu.9gNs1-gj4lfG_A!5u1&DA9=VSQ", "t2": "sk_hHlqy9R8NsB4a5C9SS%l%5~YMUg5s", "t3": "sk_Mn4lCE4Hmf8W_Ka7x&EUjn;3Ha7^h" },
  "APPO-37GK-FR28-65V9": { "index": 324, "t1": "sk_Vah5VCjjba!^o*F#8d?9R;XFv^THg", "t2": "sk_ZS@1mXFzfZ3EI16Hl1sSvatwTYtuZ", "t3": "sk_y?#WBkCDILwhcx?dUPea=oGtjpEPu" },
  "APPO-4V3B-BGCC-G4UT": { "index": 325, "t1": "sk_QVDRdaUo7VRg82JWWr&;FQUv?-C#a", "t2": "sk_ms8TpJF63Oiw+8cSf~7cifXw.QWBx", "t3": "sk_aZYTVzd^n3~zLRj^la!jV6_dNP*~5" },
  "APPO-X826-KGEL-PWKV": { "index": 326, "t1": "sk_m2&gkvH0:mGGLH4rPhZaTh3rQ#76q", "t2": "sk_MD!*4&FO9mQKVshe4:w5nX#=&K5H4", "t3": "sk_fo1aJrP8iQC7J9E8i-TUogQMBrc+c" },
  "APPO-CPXS-8QSB-UHBU": { "index": 327, "t1": "sk_3:.i2DJm&rjPB~#7mmEUOwnT0u9oz", "t2": "sk_h4DVe377:NW.Vf5!5ts10-hqNoozl", "t3": "sk_8=l7vRz1#A.0;UD:8;Y~3?re1ZOJc" },
  "APPO-VFL5-QPQP-LJ78": { "index": 328, "t1": "sk_Y*_cL+mVXSCvT3@bG!DUrdFnR5Y^x", "t2": "sk_4my1Rc-GvnSp0ibElklz*FcJA-khB", "t3": "sk_mQ^V~0E350wYB-;03*AJ!GI@2YYvf" },
  "APPO-8W78-EZKF-5WLA": { "index": 329, "t1": "sk_Zhm:xpqbMdKRSi4;0wv=e7QmB*NSg", "t2": "sk_RRzD*afe4t54_!3Nwat=TwR.K25:i", "t3": "sk_XjvEbbvND;8K&;?q5IQImVI%M+5XL" },
  "APPO-UMVU-BZGD-MX68": { "index": 330, "t1": "sk_fFz0p@?DC5f&Tgj+VT@b.~U21^@hq", "t2": "sk_y?2*ON#-dI#*-jTgYwT3&M4IepWrf", "t3": "sk_T&;^Q:hKzELZ1woH3FKJgba1&MhPG" },
  "APPO-ZKA9-XNFG-VEP6": { "index": 331, "t1": "sk_hkL+D1zh;^%?zT&!+F;T%?aT1xEZl", "t2": "sk_I939J6obn34%QXAx02j06bHti7%OL", "t3": "sk_pg&0P3iI#tgNyBBS3dkbXa@a%eQ6G" },
  "APPO-8X35-R6N8-DAJL": { "index": 332, "t1": "sk_GFIr^1GY0craFu50dP#LeJ+R^gTQI", "t2": "sk_4*H2ut9j+4TPsi5n2x%+_1;CwZAnp", "t3": "sk_injP_d+46jicSw@3ZrrY!xg=bT.U3" },
  "APPO-XCUK-5CQG-TCV9": { "index": 333, "t1": "sk_CsMd8;bF&1=vD6*cs@YTwY09XM#h3", "t2": "sk_8;btNJLJg?t.FY^qrwl5qEE;Q^T+6", "t3": "sk_9+z+Ec^;3*pxUVoA;y.KAbh09IQ3I" },
  "APPO-9ZBS-H4GT-FLX9": { "index": 334, "t1": "sk_oXfS-YyBpc_RLT0mTucDs+GUwUM&Q", "t2": "sk_InjWN5TGzjo=pH!yllFySkA4%3fbM", "t3": "sk_r~PHrXWS4VlLwh1SLhk6X~-q-8z8Q" },
  "APPO-BRCS-EL9Y-GP88": { "index": 335, "t1": "sk_cyIXmKc4RY%B@:&yDf7+%3VU0juUL", "t2": "sk_hhrsu;%SPiq1Jk%@ntoZ+e1n4gj5E", "t3": "sk_Fyxdx@3lVge.anew2bP+#IP-wDVnW" },
  "APPO-7FX9-Z6V4-5GCG": { "index": 336, "t1": "sk_zgrOX@t:l?ReQ^*73JOD&O%cv2=pQ", "t2": "sk_A^A%HX8_y7FNSDmvF3Mh?F6#Bf.hQ", "t3": "sk_oJG+3pkt5U0VDcyQ?UN6Qs6oHMQNo" },
  "APPO-4ULG-TB6Z-KUFF": { "index": 337, "t1": "sk_vyIA&iK&13dV0AqeRg@aaT%-g@K0g", "t2": "sk_oS6fjrcJnTN0rq=Wz;=d@H69joExo", "t3": "sk_b7exmR64thSoll0@a0S.*GWrAB-ss" },
  "APPO-TNQH-TA6C-CW6A": { "index": 338, "t1": "sk_13KRmEkFSGLUOVmJCKJx!4IU4xOUn", "t2": "sk_UDxu^=p~za_saQsx2#EnKW6IwG837", "t3": "sk_wf~MYc54Lj&%@n-Gl.~eZ3rRIy1Xx" },
  "APPO-KHDA-5BDP-2334": { "index": 339, "t1": "sk_k~J64+&2_ET!^nqq?~@m#C1ww2ej5", "t2": "sk_6yU&tOx9ikt*@UT0.h2bRnV5u2cfn", "t3": "sk_h4?Tl-K=nZ_G9xFcY8@@+jS1NAm26" },
  "APPO-9BGN-VF2B-YJU5": { "index": 340, "t1": "sk_HcrRK-a4?WZZ0Trut~bFJYtQNJHsx", "t2": "sk_QxV96k1xWXyo3G?3B1L#9_4x@1pN1", "t3": "sk_7m7G.~85&6yXmxT@_!fSV+*ucQnWE" },
  "APPO-5A8J-AWFV-ZSXV": { "index": 341, "t1": "sk_OSFd-6cgP.r0d8q6Mg5B6R_~7!9Vb", "t2": "sk_Cu=+4SA1!9Z=^hesnU9RX4Hddj82g", "t3": "sk_PUEnyqUHBUyMj.u-McEo3HM1YyM7q" },
  "APPO-5YPR-GUUZ-YENV": { "index": 342, "t1": "sk_MP.!CLAh2MQTSsuK4.?d_=eARHGJi", "t2": "sk_jB3KxY~K-A:s-An@A58dQkV^S~1zS", "t3": "sk_XAPJy5DxP._+yrHiMVWkN;73mAyim" },
  "APPO-QL6D-SVGN-6Y92": { "index": 343, "t1": "sk_A?g;FeyEeUH?Xk0hJ*p!6SbCGfShK", "t2": "sk_N5FkmZ+*VDNWD?_FU.^mQ%qS757%H", "t3": "sk_Osuvau5gN1xw&ZD+d?!*5@BgF:I.s" },
  "APPO-7T34-2GK8-QD8S": { "index": 344, "t1": "sk_bwYV2BsaQ@OI~Ws:t*Kn=:*sg;KG9", "t2": "sk_NcTtEGW%8oMZrO-&DZJp#B;z2O+4h", "t3": "sk_lE.oSYu8ee6vMwRCDV53&76-LXhxp" },
  "APPO-B6Q3-SNHP-CXTN": { "index": 345, "t1": "sk_GF?@3iYjrW49MuL?IrUAQYg!jfjaH", "t2": "sk_X2E8?iisXsY%kkV+3NjmWZQ#7X-he", "t3": "sk_O@+5ZIv=&C2wZL~aLm1f;1swHnhxS" },
  "APPO-Y8PC-8UPZ-EQJP": { "index": 346, "t1": "sk_KhR&fX4pk+x5oNN925OqQcCv^f.n7", "t2": "sk_qV1pSU*ja!U~GXn6aTAyDmC=fEFns", "t3": "sk_o0j~E^EY!!p^n3uo~^xlnWtqs39XO" },
  "APPO-LR5F-KTMK-H7Q6": { "index": 347, "t1": "sk_Abtan:wrACl4!u9Eqm~:p7uxVNUW4", "t2": "sk_rCmQvZA:C?-@3l+XJPRi+_r2hn~#G", "t3": "sk_ws=!MI!Um?k3pn6HPes0:7Lr7f#8P" },
  "APPO-NE8Y-2LLV-Y34C": { "index": 348, "t1": "sk_CDL8wfWq-FQ6@109gHwOGH;HEy&_U", "t2": "sk_mge9u6SFx_k!TR?YPC7kRu_ZKiels", "t3": "sk_7hftKNc=drU.1yrEH?W3kBtEo5E!w" },
  "APPO-PQHD-RGCA-KUU4": { "index": 349, "t1": "sk_GgGoUTMr~+^=d^y69!NEP#jWnZE?i", "t2": "sk_RlqMJQHOx*E#L!~Z&mN.^l!NN0esg", "t3": "sk_dD2Q1o&6#jxWuLa~H10YyvP+JG3QI" },
  "APPO-V5UY-DV3N-DGVV": { "index": 350, "t1": "sk_l%@36s2Ohr+%R*NKC5@-kOg~J-O8E", "t2": "sk_xQ=ihcE1#92r1ZkI=n5hC2r#?*xNi", "t3": "sk_PAw!UV=p=y.~UFNi4P*s3W!0PazSs" },
  "APPO-K4C9-GMC8-Y4A5": { "index": 351, "t1": "sk_4VPB85^ZF_z~2D@y?9_1=A0N8RRlp", "t2": "sk_5ic8o%5P6@pRdE~M%!r_Tsz5*LjWF", "t3": "sk_g.MUVPtt9axSp3HJ2#Szyzj&+y@69" },
  "APPO-A9J2-AKUF-7VX5": { "index": 352, "t1": "sk_W3w2g7Z2dIgEWSeh*UP67fThKpgCf", "t2": "sk_I8jL@Pmc2sC9-c6Yv=~IXcIIsQg+O", "t3": "sk_30O%X=5a4F8SaMYcvdex-fu*eloXb" },
  "APPO-JWKV-8B7S-5NHL": { "index": 353, "t1": "sk_bcWj0aMhGxkV~xc6evSH-zj17*:;S", "t2": "sk_2@nCdA!f2*h3IVL2GMOUvF6IdM35m", "t3": "sk_2LOKRQbvPSWQ%Xtpzk^2Yv8#+U+=N" },
  "APPO-JQR6-U5A5-WRYU": { "index": 354, "t1": "sk_fCZg~hz;?vP4aC1p%ln=vTc1U1ciu", "t2": "sk_o_;WSY%7UZhP~EDPmV.KPCU65@RcO", "t3": "sk_vwDO&bpuB~b.s*KAfnQ0VoPKy=XJ4" },
  "APPO-26J6-T5Z5-TFXJ": { "index": 355, "t1": "sk_Jmklq3~kg_Deh!jx11hKP5bfY9&cO", "t2": "sk_Xc@k6~&5~OU27!wtm~~cbJ:0#qfBD", "t3": "sk_OK%+?Z?VwlbAslieyL=Usr3HZh+Ap" },
  "APPO-ZNJX-RNQQ-QEA2": { "index": 356, "t1": "sk_zD+yeC*v;Gt0Bdq.!l!rqcbyK~_PR", "t2": "sk_tCefXfS#637dYrFf3NJgpRjq=1%BB", "t3": "sk_Md%ZKX?M;GNEkuV?ydo?3_h@%?0vm" },
  "APPO-8X8B-W3HH-4DEZ": { "index": 357, "t1": "sk_12Wfy1!!3aH0*MsyzhB77IzR#Z.RM", "t2": "sk_J0_qtD^uC1HQ-oJ+kuh.@@+k#W#Yq", "t3": "sk_c;VVjS4MgiKcLWr9IHZ1gQ7K^NtJb" },
  "APPO-LEKR-7RTS-U4S4": { "index": 358, "t1": "sk_77xOCM;lne208gyw2D&nrwenb*M-S", "t2": "sk_SPk&%KxQk*@Qw*y;QM4^jug:uZ.0a", "t3": "sk_S.FL04s:pa=o1:xqeM-U-lMW6:YyC" },
  "APPO-LKWN-WNW9-9EXZ": { "index": 359, "t1": "sk_St_:5ZaTTDnWYvVtEIXkSs?FF&361", "t2": "sk_f=76_?XLF;pa3;jkQaEyoir9#77zK", "t3": "sk_0xYYX1a&Rt3H&aA9=2p*Sy__JfULE" },
  "APPO-XFJ9-QSKX-3G8L": { "index": 360, "t1": "sk_noy*gIc1Kl9lpOxh:4EK%PRLvId7Z", "t2": "sk_L~4:rnW%-ML#QmRYPEB.a&Wf6*f!c", "t3": "sk_kABSwN28h0J%WXDa5MnK@p1~^&8uK" },
  "APPO-FVHJ-4J4E-N4WT": { "index": 361, "t1": "sk_YFlEFxed^_!X2_M0.pp~p8pJra4m2", "t2": "sk_goNHQ!CT:YS3FGSxW60yMQfZZel?u", "t3": "sk_8%IY=4OupATX!Fhk#b#X#A-Br0ZTM" },
  "APPO-WMBA-GLF6-ZPN4": { "index": 362, "t1": "sk_xbjFCZb8*8+mQzzphsUi_lt54OcXU", "t2": "sk_zkjr%7Y;@QtJ!+c.xGWWj6NhC2FAh", "t3": "sk_tSIuGZRR*%NSg!1%vgqa=bvET7NgO" },
  "APPO-3MWS-SDWD-G67S": { "index": 363, "t1": "sk_kAoO=jEaZ&7H!nvPbF~;Ts12Cu.Cq", "t2": "sk_66h&Xbh-gvFQ!%bHz1ZSrT!&V1GRa", "t3": "sk_Mzf&^ih97~svmxa%Shl+DFccQU.wg" },
  "APPO-XFAM-VRDB-U7YR": { "index": 364, "t1": "sk_Go*+?KF-6cU!sU7;lTGu6yF=sAA~3", "t2": "sk_m;9xB4b.XDjlLFK9ZX3m1g2=:zLUk", "t3": "sk_M@K_lg*~-@:b?POQ!@%n.&8hfveOw" },
  "APPO-DFTF-P8B2-PQEH": { "index": 365, "t1": "sk_yi@Rbc#D!muYY03a.o9&Dh:fr:h!B", "t2": "sk_l3cusl5BOFDkUzRHqlBvO1+ih09qE", "t3": "sk_Q0pJme*;U5CoXjKv%2RI#8j^U4UFd" },
  "APPO-WPWC-WWXA-A2CZ": { "index": 366, "t1": "sk_W31!WBxjZn@+DwNpPv_qFBVDI3nNC", "t2": "sk_d7j?ZUzE0+Qu:-qtC#f7UwFQIUP=t", "t3": "sk_AUFS.UUa*6U&_dyWiw+WjeIQ8C:bD" },
  "APPO-2F7M-MPCA-9QNT": { "index": 367, "t1": "sk_ZtTxlW-sw=0ao:hCeXLrT_z8R&XSZ", "t2": "sk_SbjlNFTabM5;4mXkDQ7t.yUDzfRqe", "t3": "sk_8tWp!H;;Pl*VOY&F:RkUZ4K.ikweW" },
  "APPO-55J9-ARWE-WVUR": { "index": 368, "t1": "sk_oQ4d-FPyY%sPc.=rRytcNAU;rkoZ8", "t2": "sk_Y1uGo=s6_=p.LFTtUIL-.krYP+%ss", "t3": "sk_N2!6g-2avC~?xY-%!Bvx?BMlkCk*N" },
  "APPO-85JQ-WSCY-ULH7": { "index": 369, "t1": "sk_J@^F4?=y5;*9!M_RkgDM9yP=D^8n5", "t2": "sk_FemcaibSM6252#zq4c?GxAWAK0Mgz", "t3": "sk_uWk~zwd.2NYHTG~RLF:Y*M~aLtOAp" },
  "APPO-QYN4-98XN-QLWV": { "index": 370, "t1": "sk_uHD9&*gE2WJDaj^hlKG&gmJ+ATYxv", "t2": "sk_oZjohgMb-lki:U@pl*i#ALV^~HcME", "t3": "sk_m9+qSPSxovj3a0epaL*HENLR4XinG" },
  "APPO-XJSY-GVV6-BYWQ": { "index": 371, "t1": "sk_vyiV9p.N*gq~wEE;tMRaN51GQ0vFB", "t2": "sk_r+S7dKB9ISE;Cc&aXZIB0lX.K8;SD", "t3": "sk_d1@yxv2ba;27-9R*JyS9WDxl^.HUp" },
  "APPO-SB8L-ZRW2-4QHN": { "index": 372, "t1": "sk_C:5bM3vh*jPWm%EyF@2=XeHKyDyq4", "t2": "sk_L-1@&8Girjhb;pSC8GgvOBnjexi2p", "t3": "sk_Mco^;jrx:*?wdQJA#o6dDm6v!cn_s" },
  "APPO-V4SS-LWC4-YND9": { "index": 373, "t1": "sk_AxI-z;rkcPscEoZaBtFXcIh+J&2nr", "t2": "sk_u#a11xCwhlWe&#3f#j0LOZ17Y^u!m", "t3": "sk_s~H1@cb%2J=Z_tVC;w4;UE1-X:C-O" },
  "APPO-CLG9-ZLBM-7E2L": { "index": 374, "t1": "sk_GEvtZ8YgFZXys%@%LD49x^In4SzSe", "t2": "sk_INRSC2APvFHd5&2_oR5k+uIz%4HzG", "t3": "sk_tT9nVyoU04?8JfneBSoGn;a7kNRem" },
  "APPO-HCWJ-7J8R-TAKC": { "index": 375, "t1": "sk_2!UeXNagTCAtX&Wjk?xB?+xpce6Zv", "t2": "sk_T^JwcH+1;j1:=TJjXw4RwXk6Dsu-p", "t3": "sk_i?d+Jd^;F?wRRBMIn6I_78KRJYn0W" },
  "APPO-DNTC-UDY3-DSPZ": { "index": 376, "t1": "sk_d#@XHbWTrRse4^3Gg0;+jw9ytAN3M", "t2": "sk_p#QwJT0BRTIBYZrkLXnv+Zism=hFt", "t3": "sk_RN&A!g@~sOZ^N8F%d?4F.W0#.f6Mu" },
  "APPO-6URQ-DBGS-JRU8": { "index": 377, "t1": "sk_VdByub6U~.mzDe3?em-?vCuSlT9bM", "t2": "sk_ZdiVrKhYLrDayDX7Uqi~&h-1Eokle", "t3": "sk_c3cf0-;WiUm8N;JUzVlkV^RzKQ%k2" },
  "APPO-QH49-PNGZ-A84K": { "index": 378, "t1": "sk_6@&_q.TAJK_Qax2l8R1Z;SeKzr_:o", "t2": "sk_9fp+~stIvJiH62Jiu%Tk@8G_B=TkX", "t3": "sk_x0H?XS6bH9Jr1GH&q3+hGua#?SBH3" },
  "APPO-JTKR-N368-GJS8": { "index": 379, "t1": "sk_lJ;.BNff.C8BMJ09F=yUh9e~&!D=t", "t2": "sk_40+eZJOc-aKuu+ynB+@Oy?-;WMj7n", "t3": "sk_LX;TW**w3L0Bmg~QYPqlUAvj:;QWd" },
  "APPO-RJ2B-TQBT-VYA7": { "index": 380, "t1": "sk_X@lx9ssCD9-aGJ8as6n:q:NSMeZcH", "t2": "sk_nJ_wucPrcI8&;=XzpApC8&fiVTRua", "t3": "sk_YaKIS&SPx?gCrY6x!EVeQ^-SNsd9n" },
  "APPO-29ZX-ZEJS-6AQM": { "index": 381, "t1": "sk_Teu?:E8M6;-zO6XzZ@kIV*KFhpuMb", "t2": "sk_z#iX:MMd*0tRO:dQAxs-FyJ:W6xJf", "t3": "sk_17+AU*UrV&ef%NSrxB.3TS4+kkY0V" },
  "APPO-L3EE-SKKU-5DB2": { "index": 382, "t1": "sk_ksMMQ%xZI9dp_lhp3N=;4d1TS_;Mu", "t2": "sk_JYQmUKBzXmtFU@Mfizh%7!+c36u.T", "t3": "sk_W*.dqy97^=-#B&rnawQ*IL237A0vi" },
  "APPO-FJ8M-P3ZC-D4RL": { "index": 383, "t1": "sk_32&*y3K*mnyhvYwjJTznht;2*%ubQ", "t2": "sk_K*^4yX:#I3KARwsWaHDdo7CtXaJ&s", "t3": "sk_FT#3oj_?+H.z~QmRY4rN^OMUXrgAh" },
  "APPO-JCLB-TEZJ-PGDU": { "index": 384, "t1": "sk_s~.JKS3e!HIuA2c@2465R1;ES7^^u", "t2": "sk_Vng@zQjjP-QjLwu!cofJj6WpVwjuY", "t3": "sk_hsoSD%qi*lh#Cmgsj~SeI5u+4Bqgd" },
  "APPO-88ZW-683D-9ZUS": { "index": 385, "t1": "sk_S-R6t&ghisjr-dD8mst22.=:#CuYq", "t2": "sk_PiFPB%.5Gb@ge&~vs53o.?V~sKrge", "t3": "sk_Qg4;=!gl*YJIJ#dFdO*s=XR7cTzMe" },
  "APPO-8MV7-7FZG-7GQ8": { "index": 386, "t1": "sk_Cc+W_RjfKnr:tuRtj0BRx?siGrb2O", "t2": "sk_uVsM6qi&A_+Yh4uQiR8vS*-ib#~U5", "t3": "sk_Mmf&~ws.13lf.#7GdOeKq+;H%X:-Y" },
  "APPO-E7WQ-VEY7-3MNU": { "index": 387, "t1": "sk_sjGJmp6dFYJ?Dx.g^~ed_ayo2S@7e", "t2": "sk_qMWofJU9*_j1Ja56Q08K@EGVnav.7", "t3": "sk_Up_@rcfpCi-jLF4rTVE2lwvkGm;TQ" },
  "APPO-7MF2-RVRM-PU6N": { "index": 388, "t1": "sk_a~ZSJopOU7&hIVzQikP&.Y2~DR9uQ", "t2": "sk_X.Kd.I~eJbV.=tgetVkjBh%%:^.@B", "t3": "sk_O:-b#ZBMiyCBtH^G6em8a@Qv++QR2" },
  "APPO-9LV4-94LB-EBC4": { "index": 389, "t1": "sk_nVE-ij.ia5lz~Z7b+G?%=75~_3M79", "t2": "sk_BzN:4zQj?I*?vF6T=kHZi6fluBkeq", "t3": "sk_OgExq:63O%02toQRj^*ut_lZC8b%3" },
  "APPO-PZAQ-59WL-87ZL": { "index": 390, "t1": "sk_O&ti#1rkPiK3oXIB^BWIG+FlM1%u6", "t2": "sk_7yr~M_=Brq.+OwQSk@:%@I%egUxKD", "t3": "sk_H2-l7KyRp!4BOXHE7cBc.9_pP;oWY" },
  "APPO-RHZF-2KES-QCVF": { "index": 391, "t1": "sk_Jg#sN--v5A9W5NNy@vj?iq:F!V-Ha", "t2": "sk_1&8s?%CKqLXci_Pl&-b_InEmFx5_f", "t3": "sk_4n8I6wi1Y;9win;Pxh..c2?@rFklZ" },
  "APPO-8E66-2HMY-4UCU": { "index": 392, "t1": "sk_6=6J5xICk?2epY3XbNfq&fur.9x7L", "t2": "sk_PMy6:x?AHU8@:a&Czprw1eHiOG.vI", "t3": "sk_J?h:~oURKg2Yam1JXr4.bi~Jy44sD" },
  "APPO-VMHH-2Z7X-YGCC": { "index": 393, "t1": "sk_oIyVjB@%mI;E1CYZ2Lq?C~T8M*qpa", "t2": "sk_Ui8B?sH24-K6~H?!bLkYIyWMheR5P", "t3": "sk_Ct.PgFE#zpNX2~?IH!%VgchovZ~x2" },
  "APPO-ET74-KELC-8NF9": { "index": 394, "t1": "sk_n++amky@%rrc2?V~E0B*VG5UqJ8cM", "t2": "sk_QkBuxf;aw*r%cr22.u7Oo0?kYXcs0", "t3": "sk_vnv~0NW4NV~R_kyfj%4ouU=P_#.lt" },
  "APPO-4M47-CR5C-T4P3": { "index": 395, "t1": "sk_EK~a1qU#p!;mo#F8hjJ%4DlMpjX^1", "t2": "sk_f:bI:H2-27o5qTEop5zST3uowkS~8", "t3": "sk_2!yG&i^lvxXx~P~E#Mv1nY_I+fkYe" },
  "APPO-D5HC-DCU3-57HU": { "index": 396, "t1": "sk_gOgFS*eJ*6y&&~=5~J&Go4KJNa3#R", "t2": "sk_wo7l2tutilEapVeLlYoj8;o2ADlO2", "t3": "sk_zM!#GpyrtcqksxnQp*LOY_Lf~0GUf" },
  "APPO-6U2D-22WX-9ZYY": { "index": 397, "t1": "sk_t6VB%sYNNt4FpM&m_=7ZmOu%ruX@x", "t2": "sk_3W;x@zl@eR%m4Br!kzvfK?DrD=E%a", "t3": "sk_W@9lpA=^-l_Cs7^@;OT1yZr+dc;Y3" },
  "APPO-YC7Q-LJ43-Q7N3": { "index": 398, "t1": "sk_k2_nxLdDzWgOisk!jJr~s:jTejOpP", "t2": "sk_yEjbztkMv5r%hTdZ:Oe#d6M^EZHQH", "t3": "sk_uHBdD~btE6XGTHuci!oHfHeDlkkOg" },
  "APPO-NJL9-42XW-4JRQ": { "index": 399, "t1": "sk_grJLMVcbY1h8HyJCyp8@wA@uXA2h8", "t2": "sk_EmVHuM2~ayeL?!M-FDxu#tgo3wx!B", "t3": "sk_s57Vr^oyvWj;BT@J1NPxp.6?+9EYZ" },
  "APPO-DULB-FDYB-KV5N": { "index": 400, "t1": "sk_qvduafb&0sRe;Br%GVR%O#oI&;pyK", "t2": "sk_UJ4cs-G9NA*:H@+56Igt;4JVc6~cW", "t3": "sk_A53lXK.sX;=dLCFu!uCarFwCH7kRH" },
  "APPO-FUSM-3YPH-SXCH": { "index": 401, "t1": "sk_rcMZsaKauY2;tYEH6cZmq^t+J&gEJ", "t2": "sk_wUExO;1l=Al.0?:h+ba:vJ&HcgXAh", "t3": "sk_88vukCpA=QpLrwQcamKuV&5&caYys" },
  "APPO-WYXB-5HGR-XHAE": { "index": 402, "t1": "sk_EVyj0sJQ*-h8waIcxAYm1ceqxty45", "t2": "sk_a.#eMYa=?.nX7;ZyGz2^w9jy1~mR6", "t3": "sk_RuDVMhDHYFsAg.=7-R5dOXmCMl-ca" },
  "APPO-DTXJ-BHGX-PE9K": { "index": 403, "t1": "sk_5qM^B8mq*5U9EOTrvuOiC=5!ii!=F", "t2": "sk_K.eQS-2B8WWan4d#=R1k8v89MwJ+2", "t3": "sk_Y:qiD9boAxYp*#sbY:N~mjTYe!X1j" },
  "APPO-FPYW-3UWS-QKH6": { "index": 404, "t1": "sk_yHm=Y!-POSEM@Ke?JjL6Dt!i*uQNz", "t2": "sk_x?!aw06.~RYswZ;rbPv+IP1bMq~=X", "t3": "sk_exSJXs70B~NHBQ*dw5^z@Bba.iu&D" },
  "APPO-GHRQ-T4EJ-WY36": { "index": 405, "t1": "sk_0wmhjyy6.n^CV5WACnK#0Y&:_%6gZ", "t2": "sk_62.8&*iaBB:8l9UjS.;O^;C8*z-mc", "t3": "sk_998erpZ%b8rY18dzg#wcZPY=mUoOT" },
  "APPO-AAXZ-AJJZ-2H98": { "index": 406, "t1": "sk_y!.J#Y:KL6wv4pY8478u~p?xLfepV", "t2": "sk_hd=diG3BbzL&lu*%xVJsLN!*j1nGL", "t3": "sk_U%f=ns5yEnhzhuCak23al&lDG~!FM" },
  "APPO-7BBH-TTBF-J6A7": { "index": 407, "t1": "sk_EW:+-6?FZOK0Ni^ZgCO@@^r-g*Rvy", "t2": "sk_8&Qt!pOS%Q0Nca+!+c6Ya*-Xos+Tr", "t3": "sk_ETs#8wA1t^+osGgX4a7_ifSOl&MWm" },
  "APPO-58C2-F9K7-LFB9": { "index": 408, "t1": "sk_WLvFLhSj66pjx6U3HNMS;4-SwkKHN", "t2": "sk_KehB=C;r%?ZiEs@!yjn-~iL&3Oemw", "t3": "sk_d4AhR~W?~OH?NJ3B_O8rkHsV4#yzF" },
  "APPO-JP96-CL5D-G92Q": { "index": 409, "t1": "sk_DqtINoBUWR6N+y%G@@fx;wKi=xN:B", "t2": "sk_uGP@%uMzDtSfhB5CytC*x9?YI??-u", "t3": "sk_GRnCbSqmg6&9ZU~EatEj*-!4fvcif" },
  "APPO-53SS-8GMZ-BZHN": { "index": 410, "t1": "sk_pOp:Tek^72j9gkSk^ig?T-ZxCrQ6l", "t2": "sk_0Cs3qLw?0&.b_AS@-CcjF&M7:M#TR", "t3": "sk_V*=rr;rJ9sKU5F.LSE;+%FBkfI#yy" },
  "APPO-JFR4-4ULE-3ZDZ": { "index": 411, "t1": "sk_MJ=f4fqAG4Q_SgJqjRz*PyqBpH-fS", "t2": "sk_xre#Mf3KanV?^1%Kir&&kBP22u;fN", "t3": "sk_5W@&xavF%_d4jPZisDwm:;ehBdj7j" },
  "APPO-AMZS-MFP5-VG6V": { "index": 412, "t1": "sk_74N5QSs;yphEb9n00W48NDQnM8Brv", "t2": "sk_aN?gIO;4MQ9sx1I;_e^Ki!z5Ic4UL", "t3": "sk_X5Gq=W8%BL@sZEcTBMgJnXWbnRSt4" },
  "APPO-Y6L8-3UBJ-9JLP": { "index": 413, "t1": "sk_Oj2-aFAYRsE;a3o7TWXmp7iLVX_eG", "t2": "sk_pS55nHNScivH!Vydllxiic1D#LowZ", "t3": "sk_l:_@j^hz6hMMRXxn8g8Zk4b&l**.2" },
  "APPO-H7EQ-HZJZ-57WG": { "index": 414, "t1": "sk_I0?XYozXiLLn+Z+wlsAE3Wsn52w4V", "t2": "sk_YnF7*LvAu!tYRdq_di#v0367ewZ0z", "t3": "sk_6UtBwu6EcZEETwpWcVlMl.RB3m~v1" },
  "APPO-U4AV-SXK3-DQZ6": { "index": 415, "t1": "sk_EWp2?oly^2pdggE0gzskDlXE8QUSt", "t2": "sk_3I6+p0gW@+#fzmGpCyEe_@_~bb26p", "t3": "sk_ak7+ezTmQ@^e&bRjDN~*37IH++2UT" },
  "APPO-XNRL-DDCM-9FJV": { "index": 416, "t1": "sk_LQ3AfS690H9%Y*btZgcn%PTI%M-KV", "t2": "sk_2gZQUlxtTde6fcekGJlRTJl23HoMJ", "t3": "sk_xAaOwuPEIPu%EK~-iIj:SJKO9_T@u" },
  "APPO-MT5Z-MQBX-CFBT": { "index": 417, "t1": "sk_dat1s.&P6hUPe0*1taAU!6eMP&.:3", "t2": "sk_e6gRgP5CP&@3vGrL#9P:-f7Ml@16t", "t3": "sk_a!t:^Mo9@xR_4%vVxpOseqNyCgvzg" },
  "APPO-NRP7-F6Z3-ZZLG": { "index": 418, "t1": "sk_o*GiWRz%.8anODSs;*B?jIqQMomQc", "t2": "sk_p.nXL7c#.!Gt&6yvhfx&WMRW.yzPm", "t3": "sk_k4*&ps.QUVx+c~=IaGJJu?jZ71b~0" },
  "APPO-EGTS-V9K7-C7G9": { "index": 419, "t1": "sk_j6=SH=5elbuWSnO0mO.3.y_pE-qbU", "t2": "sk_u%qtk#-rCfdFA**azbIa+lwzYYyAA", "t3": "sk_Mq7gFw&5Erp2u~pp&-;hNk9pJW_18" },
  "APPO-Z4MF-GLTF-9S2V": { "index": 420, "t1": "sk_MFb%Fkxn.D;O;Dp:qlz4@waRGq?!x", "t2": "sk_s?7~V;8^idPCnvZbDAhmJTM3W~OLU", "t3": "sk_8#vj;duN*x=S;s~:wOFt35f-l;cQb" },
  "APPO-DVCE-DDH4-SAJZ": { "index": 421, "t1": "sk_BVIuC-bmxchj.q^wxtP#@vygjsiWk", "t2": "sk_y=y3OXxvX*t1XN9amR:MQlDu!0@q9", "t3": "sk_N0sRb#^AqDPq#N^yk4%sLZq-l4QLx" },
  "APPO-TMJ2-ZA6V-6URK": { "index": 422, "t1": "sk_ZInu-wKGlG1^7rk~pO+EQ4G4YvbB6", "t2": "sk_Wn6PAVj&welm%#2o@I_!Suio@APaX", "t3": "sk_Juoh%IU+-mfu?z?&6oETdvYi4eRgx" },
  "APPO-HRHS-H48M-KRLR": { "index": 423, "t1": "sk_0G.H?+d^;H;QpCVL4bIf2-aO=-Urn", "t2": "sk_X8-:&!Sarr6L#J1_vQOTm=LDb++XR", "t3": "sk_U~%xPLp^M.NrIFWDmMW8m4PCMjP*m" },
  "APPO-Q22W-AF6H-WPGZ": { "index": 424, "t1": "sk_Z6Lcp0Juqt&C.8z2yuA2C*yFUrerE", "t2": "sk_0TLb&R15Tk8zQlXB3#4I5oc0Y01rA", "t3": "sk_cFf#.ZFe0BnkXc=QH@Y^kTI!IA5PD" },
  "APPO-CJHB-GC3L-YQ63": { "index": 425, "t1": "sk_m&t6smaiTXf&?PgINwOZ-rclBmUqZ", "t2": "sk_bHVVK*%?bJB39gnng=ke!:@_KkGIX", "t3": "sk_R3RNVQeUO?u490VjICIk91wc~#CmA" },
  "APPO-L5WR-5478-3NCF": { "index": 426, "t1": "sk_yfed:+U952t^?FZqsN*;MCqDu2Y7J", "t2": "sk_letRe!9jUK2L-&m.UdPWb00sq3FqM", "t3": "sk_rKjR:mymk%hmu!-EMDh7=.iM_RdW9" },
  "APPO-3T9H-TTX3-NJDP": { "index": 427, "t1": "sk_hUxedZsV1iH0quABww;df=7lJCxvT", "t2": "sk_hV?e;K7l63fmBAktrmRj.jyWi+TST", "t3": "sk_sSi5U=Gc:L81f8r1HTJOYOtnaMz;e" },
  "APPO-HSVH-2EZZ-2YA6": { "index": 428, "t1": "sk_go.7ZTyAS~Q!8aX_6+3hom_oNC_GW", "t2": "sk_AunJT=jUA6l66v:9%#uEbb-UyNX~p", "t3": "sk_jDj&AOnc:G;#.lXvu*b6k4S8a9n0m" },
  "APPO-S5LX-QD3R-Q6XY": { "index": 429, "t1": "sk_LS^3uKWpRZka6-nh8Cmp6FJau4ouJ", "t2": "sk_mqfFP08o:H3B?AGG%_z@Z6Nwp:3Pf", "t3": "sk_k%~39Z96MNR85HbQqwMUcFN2aw.;N" },
  "APPO-N2RE-W5DN-PB24": { "index": 430, "t1": "sk_hmwOIZ4h*sKgs9%ee9Smm46y~4qBS", "t2": "sk_FBZQG8zK_aTcqC%qp*RY01ho3Jgr1", "t3": "sk_9+l73+8k5?LiN#!h=l1BtR4-Eg.*z" },
  "APPO-AT7V-WYD9-DSJQ": { "index": 431, "t1": "sk_F;e~p:v3vpwR.68%?Sw:7BOHx6wF9", "t2": "sk_3+:OQfgV3Yh*2naACPf:pgjxf;CvD", "t3": "sk_v^cc!8Szlxt^?;U^vHYSyiLMOZvHG" },
  "APPO-X8RU-26W5-L47V": { "index": 432, "t1": "sk_Hk*rGw0pdJXwMM0oBVmtM?BR-k;Gx", "t2": "sk_z~DT^jbbF4%:lY2dqiYP^:mjSP*~n", "t3": "sk_x-k5t0qPbA^=b1I&HY;M6!7rQU6%c" },
  "APPO-TKRQ-HCSV-ZZUR": { "index": 433, "t1": "sk_LI%&m.s:ZwAvw@B_%p4~mL9isp2Ga", "t2": "sk_zVdTFf4?Q+~V5_D:xLQWCy@Cf@3J7", "t3": "sk_K@HcsI0jFPIiJvBlvWi3-:.K;TrTg" },
  "APPO-L87W-LTBA-7BDT": { "index": 434, "t1": "sk_iVNIOWUXd^v^Zf#&GhBZ2EGM=NOLa", "t2": "sk_ju*+o.PvJIn9ClnV^_*Q-8h3a@FsA", "t3": "sk_Pu0Rr?hYSDLhMyo-2kv+VKHLHC6zp" },
  "APPO-YU5G-YN3E-YSXX": { "index": 435, "t1": "sk_yWz^eu+uG73inzKvBn9Rc~jO0i1^V", "t2": "sk_3_@GL?=bc2*r~59BgbY@^cHwwv2WV", "t3": "sk_y6&A58oKY*:314Dh3LZx7jUDg0XMS" },
  "APPO-U3NU-RTRH-JR5W": { "index": 436, "t1": "sk_cpQn*-bTl!Yvjrb%4lx~Mk#MDyNoS", "t2": "sk_Sjji%:0^0j0sB.AriE8Mf%wObu4K2", "t3": "sk_Kor:1HbK?g@YreHt_O!6tE?Rf1M8L" },
  "APPO-LFMF-EKQQ-QDCH": { "index": 437, "t1": "sk_C~4EvXcb@6*PLomBE27Q*Yt.~%57Y", "t2": "sk_v;:8k%I7fyyf*PzaQMrjm9G5U13Zu", "t3": "sk_s*VQ?1Fj2f;Zp2C+NVv&r+R9o5:qd" },
  "APPO-CGR6-AL8W-MLPH": { "index": 438, "t1": "sk_uU&@Rx*AKqkq!;q5s~w1Y~S5J^Liz", "t2": "sk_pQs;zDiDO:ol=RY^Un*%!y0F@n:Zk", "t3": "sk_LrI4dqtfU0y8m-:Mbba%NNX82StWf" },
  "APPO-SCGP-2VXY-WXFA": { "index": 439, "t1": "sk_6NKfy@6.3FjOnlVGw#+ojods5!5U1", "t2": "sk_cB5tGg8mh80xK+m8AHFLlfhvBD9-5", "t3": "sk_ogBxdn:mf=KYfTaf@R!-6xa#AL:v1" },
  "APPO-ZY8M-KTWN-XT8L": { "index": 440, "t1": "sk_D#4vu=b*bUD1l#8vEU@b0N:udhfRB", "t2": "sk_HX~hy&J6u_F:NQjWx%VCuSGidj5uP", "t3": "sk_S:ay#*h8*Jza.5L.2M9tN9xAKeUjY" },
  "APPO-33JC-5PNW-48Q9": { "index": 441, "t1": "sk_QVNVdH!fp:-F-x5aCTk!%2LpZ2#Ru", "t2": "sk_faM+IXbzs+?Ldy78lk61Cm=NtPjln", "t3": "sk_zlqZBrB8oH3+ROcI1M440g9mv6+Hw" },
  "APPO-5R3C-9WJP-KQFK": { "index": 442, "t1": "sk_oLLW1eR+-0YT!?g3%0a8ZYRuhm3O9", "t2": "sk_E2F#Fjq#hRk41H5UYylRXA3d0K.4S", "t3": "sk_5DF^8*6kyRJg:R:J3kJuPR!RBf5Bc" },
  "APPO-Q9WD-35UT-KAUC": { "index": 443, "t1": "sk_rs-IB-~E06fSTe.6.!nfCIS6gBMKF", "t2": "sk_X2CYoKd%W:f1DMYnJGmS%@Op#M0uM", "t3": "sk_Qu*mEYSCnm=n34@0cE6L-315G_^kd" },
  "APPO-NMRK-893N-MYSZ": { "index": 444, "t1": "sk_UGqqR7_?Mo3^W0L0OvvxaLu#JvPGM", "t2": "sk_jPeqWb8Vvdp#B@0DP&V-dGF9B-QvC", "t3": "sk_X-+A=9CLz+:iu-A51j2&#x7jPX.Ep" },
  "APPO-AEHG-DHCG-Z2WE": { "index": 445, "t1": "sk_m!55tSxQcIPlLxy!t##ksBsMT%9#c", "t2": "sk_VpSbDs8mP5?g!*ZX4;VzCJY80yGOB", "t3": "sk_ao051sUXzeq.mgiUA5c1^:U6hIJ5c" },
  "APPO-QHQN-KEQM-TKNJ": { "index": 446, "t1": "sk_l5+FBZ7=CuDf:+-G=kOO*C0RQRp%l", "t2": "sk_EdPkhNo%xMMOoXt@M1+@@&rsvCEXX", "t3": "sk_K-?g9StJ%x2drAMdbuS-19_mdvRRo" },
  "APPO-DQTU-PJHV-2XNX": { "index": 447, "t1": "sk_JYV?naoM~*Sqqhox5.w&QS:E9!sQC", "t2": "sk_UYf^XEc+h^J~5%=ZgQ9!g8M*=dr8y", "t3": "sk_kcPGM&TVFW#=!N*Lv_4AG-5kq4_KG" },
  "APPO-2XJV-89KU-XV5C": { "index": 448, "t1": "sk_eD%_:Ly+_CpnQvm86UM3ESdz?84@Y", "t2": "sk_KrSZ4CDXJ^l2;4^n8L.UC~iiq!&t4", "t3": "sk_k:%udwKTyS!@R96RKG71oi~~W+l16" },
  "APPO-HD22-LNBP-KC7T": { "index": 449, "t1": "sk_PVUCtqa8R3M:1@C*yOmY1^l1e78VP", "t2": "sk_aGEfLNMEREtSp0Kuh#ibcwo#Y:DUb", "t3": "sk_Wtl*ekkXG@FJyqSY8kR8pG2SFregA" },
  "APPO-NUG6-NSPJ-YDAZ": { "index": 450, "t1": "sk_5f2vNKWU5Cu6IBSaI&daOr*2!bJ2Z", "t2": "sk_x;dqm7U68szHNmn#47ORHRC1=#B.j", "t3": "sk_fZLR1!yU7z^yw*NgDn476k*_TbxYO" },
  "APPO-BVY9-KXBL-2PSN": { "index": 451, "t1": "sk_DykZ^Q7kCA~9.oxom6#Ch9n*YdwR0", "t2": "sk_O0Xh*=FQb?kyz_xVrxf?#.skZIBLt", "t3": "sk_pM!:uue4VXPggYGy4;nU-v*KQsqkP" },
  "APPO-5GCR-3GDU-GUWD": { "index": 452, "t1": "sk_o@4#O5z1=uuxH~OSxiieDQ8-hs2Zt", "t2": "sk_8uze@f3+g2ij=!y0B1gXGapf@QrlF", "t3": "sk_8e.AHMru~g@~aYi52vnQ:pwY1x5-L" },
  "APPO-Q5H8-6MEW-QJQQ": { "index": 453, "t1": "sk_m*m:6qa?;Y#VA40nrT#S#04M;v4BM", "t2": "sk_mCW5:PQ9c8UBjatnxDMp;Hv_M+Vtk", "t3": "sk_0GA-t:yns3;aK0I^z~cd@.G?b6rSo" },
  "APPO-MN4C-L8LW-PT6T": { "index": 454, "t1": "sk_u&TxyNx_Ort7R#+rKfu8Zc:C.oCOt", "t2": "sk_kkh0&9WYlg.#.3vLl^;Hw_CmNn1HM", "t3": "sk_4B91ZpBRlGeQsbu+ZNfwV=4X8_muc" },
  "APPO-8GL6-W8NR-7JBA": { "index": 455, "t1": "sk_cQe3e*c+o:#xKvazdR3;^_dL6nP*g", "t2": "sk_k9R01NrNc72G:xHrR1_ti0l5L~:gu", "t3": "sk_UFgj_C6#d6HCINUMRFnZ?iD^QJfF9" },
  "APPO-HULQ-YGCN-9738": { "index": 456, "t1": "sk_RQa^d8#Y9K*PL3^-TYImmxPlk3Wdb", "t2": "sk_J#t^:IGpo#Bb!3elVg&J@1-!~~rql", "t3": "sk_6W%Yni=k@:9VR9pE7_%sDWi#&BCdp" },
  "APPO-NQGY-4AJN-5MW2": { "index": 457, "t1": "sk_hvIqq3A96MVkQ%aWw1#knwFnJb;hz", "t2": "sk_RYp&zlkY*Hv2A_P4KlQf#ob#XEWEC", "t3": "sk_W6SI6nR&eShtLlba:c!oLa=Z.8-Ps" },
  "APPO-7VZ9-UEQ2-7B9J": { "index": 458, "t1": "sk_UOUKYH2u&?lZjiv*78DUrA1FB0pPM", "t2": "sk_R4PLBL~H=AqMT;7Z_=UyMOIcFih+I", "t3": "sk_ZrVcV*tskL;SBbAauwtcH2t1WOKzF" },
  "APPO-64X4-W9ET-HL4H": { "index": 459, "t1": "sk_9^l:.d2x8WL9F7ZUcqR7s&9GMa!mZ", "t2": "sk_DBiR~dTvW#S:lr8Jp+SS6K2;zv#b9", "t3": "sk_Fedp?-nFWD6bFC=T&I%L~ysJy-p2E" },
  "APPO-8HGS-YAA6-KCE7": { "index": 460, "t1": "sk_CdJJME^nv#U3a0_mmdyh^uiof9BTG", "t2": "sk_hKleGReOe@n78oO#U=-lG7p1P+P-P", "t3": "sk_P+bA:Ck*LAevnznXMbdKzV3rvE^Td" },
  "APPO-BGWY-GP4L-77QK": { "index": 461, "t1": "sk_mYuc4~4mw=1Q7fcJ.6:u~@G&xDgat", "t2": "sk_66zN5FqGlyT~5-ld0V@nmGvW.N..6", "t3": "sk_iVZKt*CHZ1-I&Obdjc^8KVI!ne7q5" },
  "APPO-QED9-G4Z3-VGC7": { "index": 462, "t1": "sk_ZlJ^0;ppsCYF~26^@H4RMC?EtyQvb", "t2": "sk_l1iN*~MdJ-R~PJe^ofCZ4A%V=LkGX", "t3": "sk_wVp-tXH#2t?GCvHI4;F!QKv8JAWYW" },
  "APPO-RE53-87K6-L2M9": { "index": 463, "t1": "sk_KDL_ALC0:1zP#vcPl~5qmIN&wO&~a", "t2": "sk_twai~nO52@7m#2JnC^-SdX4;KRJFx", "t3": "sk_D!r4LMgui?zboUu*B5F3d2ycG@*QG" },
  "APPO-VT9C-H292-63XU": { "index": 464, "t1": "sk_V%9n3!l^^w+V-ph~MX=Tg.;EXIJ%x", "t2": "sk_Wz:Jzt%peBW9E~Rn_a3nh..pW;+4f", "t3": "sk_w:~c4yJ=apyK:lu9mhmB*h45HFVhk" },
  "APPO-USJ3-A7XM-B56Z": { "index": 465, "t1": "sk_UWKZ5flgE64Q7&OQG8HhTF9NZEqTx", "t2": "sk_dZIAF5ub%awxa4Bzh~zEN53MXxIk5", "t3": "sk_A-W#q8BE8wViDVa~_8;xI%f%MVQoS" },
  "APPO-86JR-WLDY-CTHW": { "index": 466, "t1": "sk_QFs;ouwWH7oU+lqRaedBfvqSVT8H8", "t2": "sk_iVh_tGR3AyTMb-YXPcBa#hGgaK*DX", "t3": "sk_R-sP^#DLrXZsZcT_RI3qtK0@!AGxv" },
  "APPO-NPT7-WX96-CCEN": { "index": 467, "t1": "sk_YW5+FDEA8G@*x-I3!^LUW^Vn8CMtr", "t2": "sk_MhF+L_%4a%irtLM1~A*zF3w&U&S-1", "t3": "sk_z1c:ax*~~vJWSsMFsbzxWJvT@N0J2" },
  "APPO-PKDC-QQSM-C5QB": { "index": 468, "t1": "sk_US66CcvQvDz.M1iAr7HrqUZVY8a2K", "t2": "sk_5O4?k_-e&d.VTTkYbd=xRO4cHjk#o", "t3": "sk_86lO~FB:.Z*MHX8w9Jl;dP2?c.3Ul" },
  "APPO-8BFK-48JP-8VH6": { "index": 469, "t1": "sk_qP+xuFAyWwq%g^k*o9v+!~gKPMn*s", "t2": "sk_rE?QHCBWdg2FPQU.teacS!SEtZ5%z", "t3": "sk_bHtjP^TrQB*RW3HaF1+w=qNBZTyyW" },
  "APPO-XZY8-XM63-Q4R6": { "index": 470, "t1": "sk_Dhfq6iTh;l6ru=5c~HNZUPotR*66v", "t2": "sk_y3j*b5TkvFpsk6^JK7IZ*LuYXoSi6", "t3": "sk_oI;5x_r23KglnR63LwJWxfisoux?2" },
  "APPO-93SC-6VM7-HCKS": { "index": 471, "t1": "sk_LP:o-d.Vvp;@Of+-~6x;0hm1%+iLw", "t2": "sk_CL+y68&jizGNP*35%SjH95^&yGt-h", "t3": "sk_YlyzPRG8?JBHbIUrlPH?p6snjBUXG" },
  "APPO-QAL5-7LUT-6LCT": { "index": 472, "t1": "sk_5poMG.K2eG--9-N9gc7Bk5PWkebkn", "t2": "sk_C@BkTA4lymKEy~NL08.OWQ@e71QkL", "t3": "sk_eSxjSAVWbI2*_t&G!xzuV_xRCLPJo" },
  "APPO-XBFB-7DUM-V5E3": { "index": 473, "t1": "sk_GiMuJ0:qY+h%f=j1I0u*evX_B_Yiv", "t2": "sk_AYtU*MK:EoHPXy%:9&kHG?.7~VDs7", "t3": "sk_sEYHlinnUxnOPkfYE;vDt!1rG64yA" },
  "APPO-PP9A-FMBC-UAD8": { "index": 474, "t1": "sk_Qo;OkVO1N&CiLnKkD?ogGxP4aW;m1", "t2": "sk_3UMIEv&_vHS:qMt9:Sv4qB9xX6Xtz", "t3": "sk_K&rPV0x;yS+PU5sK*gho698G=Frv7" },
  "APPO-CJP2-3FMM-QQUL": { "index": 475, "t1": "sk_gF+TWNv~_qNJqj3RJet1R^L4Yb7v2", "t2": "sk_v+nuC;C:7+~Y8B:L789X:RiOtZ:.r", "t3": "sk_3l~9RvwBa2lK%C!ndJxm=Vf.ZpGG4" },
  "APPO-G8T3-WQYB-ECSR": { "index": 476, "t1": "sk_Fow^@FI-PQxKCMI?zO:HW@f%onwG4", "t2": "sk_sgSBBIk9s:Jo_c5AsWWC!MIK*9q.G", "t3": "sk_L%mEgx6:#6hueHYZ0e2NcdsRDrl^E" },
  "APPO-4YCX-KVNW-L9ZX": { "index": 477, "t1": "sk_h^@ain;25I-p@%AdP#r=8YBQA:;vm", "t2": "sk_azcw!CV028U~l046&br.O&CFx%EnQ", "t3": "sk_KxJk6!-hl_qHt3qZ5Ze2a5ftLm8tg" },
  "APPO-RRCH-Q9RL-WYYM": { "index": 478, "t1": "sk_IwO?lAskm:3iCxsHIEJX2XptMus=E", "t2": "sk_P96T7Lipm7?.2qf+S7GLy3-n+UHcP", "t3": "sk_6~96.qKS#RMoNi;rCo8BAUbu~RjrM" },
  "APPO-HUU5-ZHMB-XR7T": { "index": 479, "t1": "sk_7Uuf7qpx-T3QF_50*l;76SiyH0tbf", "t2": "sk_YvRI&V0L?TJOkaAsqLAKR~thk=N%9", "t3": "sk_TKtqArjDSi76~6v!eG=O7mo@~UzIg" },
  "APPO-Q8PK-6MLK-34RK": { "index": 480, "t1": "sk_zk0ksUF3LxeBkUC.T-!-=#20IGywc", "t2": "sk_XezC5R4b?nhWX&*9vFnkcCG+c.F#B", "t3": "sk_4mLOC9~v6n7*JVH+?g?Vdu9?zUNXt" },
  "APPO-YYMT-TMMX-GGHZ": { "index": 481, "t1": "sk_k~ho=4ARz#r~T3XpTPBG4IWeggsc3", "t2": "sk_5i0G.s0EAZjc.;6_oERA1+-CovShA", "t3": "sk_xVaS1v8Z6S+eB*9g.0FuDivpy_uPr" },
  "APPO-SRYP-B7GE-TPLS": { "index": 482, "t1": "sk_LXceB@hHDI#LJOo0pwd55Eugo~+5h", "t2": "sk_g@k!&vEI5fwrO&6.3?bwoMLwi.GED", "t3": "sk_OcrEBfQ1Fi6C2;P^W-Vr+zV=:HbY6" },
  "APPO-LDWB-HPES-YGG2": { "index": 483, "t1": "sk_F-67H=@ovULC;0?G1xq4YH4g8JAPK", "t2": "sk_fqa%B7+sjaFh+j*hzu.LCz_IA.0qS", "t3": "sk_JJ@8Rt2#;9M3SH_UP6IupVI&_78aX" },
  "APPO-GAE6-ETDV-4ZY4": { "index": 484, "t1": "sk_rSi+Yo8t4?xDi;C@bi7oBn5B8o80v", "t2": "sk_0z+6GPfUCnX*S#&;mNz5q#0P_dzIJ", "t3": "sk_7~+hsj9oyqT2XRD-5h-GQ4v_;Ojxt" },
  "APPO-94ZE-ZWGC-894D": { "index": 485, "t1": "sk_iyfOie%=is9a+MQVuBUcbH!;rT+BQ", "t2": "sk_WM5qfVrK+0A2a@O?=r3G!~X;^nM^2", "t3": "sk_B33%9^@PDBZ7?r+hgC-2vHQ?fNc~w" },
  "APPO-M5TS-9XWT-Z2ZQ": { "index": 486, "t1": "sk_QSO69Rgm8;RLG0XOT%AGrupnl^#RK", "t2": "sk_9!~9HtC!XNB?J*W0F=DO?KgzCv&?c", "t3": "sk_biA0P-6J_HtnF9ztB-:p_1CpZYXdf" },
  "APPO-KJZ2-EUUD-WTUB": { "index": 487, "t1": "sk_k^MTZCrq#Jr6%.skgu*ViMe3x&M~j", "t2": "sk_3Ctfh%BQ;BU8uRB4Wc;tUh6SoGMmy", "t3": "sk_gjO~mi!*KYaay4d#+cm;VZvt78zwY" },
  "APPO-AKRW-DZDH-XM6P": { "index": 488, "t1": "sk_tinTO9P7NQmELylT598S!6lbvfb2z", "t2": "sk_yco5#IBI7@.%of=jPSv_u*lP~S_+O", "t3": "sk_aODtvWB=gd4KnFy0?U:L;KDwupX3v" },
  "APPO-T5W6-T2HA-2TJW": { "index": 489, "t1": "sk_cLqpm0*i?M@~t4?Sf=E4opcqtA2b2", "t2": "sk_JRsksD2b?dfiUi~06-hV=tvI*mMzN", "t3": "sk_xLRn1Cdvnn&L~h^pUvUD:QZ=RzZQ2" },
  "APPO-F4Q8-2MM9-KRF8": { "index": 490, "t1": "sk_H-p@b1jyjHm!cldB0h6R+#kuNhlO1", "t2": "sk_NpgTk2S9e2_oypHW_ACI+Agk7b6_A", "t3": "sk_yYBOH?:wtaGI_ud*yxDu%caOw-zD5" },
  "APPO-72EY-J74X-VXDJ": { "index": 491, "t1": "sk_BaTi^=G3AH4^P;Je3MoAYMw5C6lCQ", "t2": "sk_BO91+kPI;11GOMODvQ%qUGWI~zGmy", "t3": "sk_CQ*rI5rT#:Yhvp0l-BFr.kz&za_xH" },
  "APPO-5VVM-BYAV-EAN8": { "index": 492, "t1": "sk_XHFkaCONb=*NB*zuN.rKlX4^O+rjH", "t2": "sk_Apjei1AuHdghN0g*Gb1_D5ff~kOgg", "t3": "sk_S!7jNSq5j.aZrC7jT?PuU&~.bc7a5" },
  "APPO-GSRK-5RFV-DQBQ": { "index": 493, "t1": "sk_vVxL.-%3&834R*bCWDxBR;:FWe^O4", "t2": "sk_EbE8f90V*wkZ6nYK520jWw+T2~RUi", "t3": "sk_4?wr=teltQ:K;@Iiycif=o42nGEFX" },
  "APPO-RZ8T-PLT7-8DC6": { "index": 494, "t1": "sk_VGquOOJ.HIV-PLjnrzEjmbh%D1#Ry", "t2": "sk_wRDvu%hClY@s~?LV:C:o5H4O8Hsot", "t3": "sk_O=JO:Q*sCbPkd79ovL~MWfAC;jy?I" },
  "APPO-WRCW-FC76-ME86": { "index": 495, "t1": "sk_s&LJ0FYCE1FD^5uxP;Gk+*eMvvhrx", "t2": "sk_pD2qsVat.O=98Wxe~DX%7i20bEGzu", "t3": "sk_v1I%.IZG^CxkmyKsgR0OYMS55^OBz" },
  "APPO-BUY6-WUJR-U882": { "index": 496, "t1": "sk_Bi!tmM-4RVNN%~Ye94_S^u?RoKc31", "t2": "sk_ZZrhXE5ge7I;U8HUQ.3_hY.C&k#~F", "t3": "sk_e4EJ3z+wxDsV_Vjm1f2aU1Uo7dsFy" },
  "APPO-CEJX-VGTZ-57HL": { "index": 497, "t1": "sk_nnhSUC7IA&hYa7~iuYp%AwzcyXzpG", "t2": "sk_yY^mci3Y=H~?0a-E@Q#Hfyt7_NWKN", "t3": "sk_18GKuxC7&&Sp06tcO0sy~romt0iqx" },
  "APPO-J824-692V-5CLZ": { "index": 498, "t1": "sk_Awdsdc3K5sZdeCghZjs7lzB@;:m.J", "t2": "sk_EOx~B#:s!4Ju-L@1ZF2#J1.V3jXcw", "t3": "sk_oyax2Au^lck?^41%c=x+j~D7gvP.e" },
  "APPO-UP9D-L4SV-QECC": { "index": 499, "t1": "sk_azHo%Rhk~*sCRA%%mwQLkWZzFyxSY", "t2": "sk_zOyJuDvQ1ST^xKt8LHoQZ-EHjKVmd", "t3": "sk_jzZjI3mUlv3t5K899v_l%1u%9B#Db" },
  "APPO-BKXJ-NLXD-WYD3": { "index": 500, "t1": "sk_wiV@IF&bBWYrBM2j:E;Vjz7zMMvVs", "t2": "sk_L#vdphzd;Y6Y~hkeBhuyJmdWgqsu7", "t3": "sk_JFevg1?vQz@4^S^gM~vo3bv0qX5mP" },
  "APPO-X7WP-HSLW-3XKY": { "index": 501, "t1": "sk_uAYG_YM13Rc57ygsN*7#OB6p#tyCN", "t2": "sk_l?&d8wuMJ2Et13LE2.tToJmf1^1eF", "t3": "sk_Qmr9DYixknr!1r4svyGj=~gOXZI^E" },
  "APPO-RM5U-KNHQ-U6K6": { "index": 502, "t1": "sk_5g@mB=?Hs1HUdOTf3N0dv%qJs^A2w", "t2": "sk_cWp#d7*?8VcF@sJ:~mOszL_m#=y&D", "t3": "sk_a8t1NZi&LQ9e*H!&=OahxFydCRUKs" },
  "APPO-2CDV-LNFA-FYZH": { "index": 503, "t1": "sk_4-JJ2OiTPhoP~D&b.?n:-u*h9W.pq", "t2": "sk_V~#hf=EN;_U8bJ1miLe8RT**Y2WIK", "t3": "sk_SNI8uBL*i#c1;BQ&C.F^wF5DSZ;qV" },
  "APPO-3AKK-S7D6-QDBW": { "index": 504, "t1": "sk_C7sZeZ-68x*hfFR^PioE%DnJSj~4a", "t2": "sk_gtc1aHX5-K31FdqVbTzZk%j=#cKCU", "t3": "sk_zf;9YL8tC@!2&%!kBI4NLmM.NRSKC" },
  "APPO-PHA8-5KBL-RJM5": { "index": 505, "t1": "sk_X!.+jqI6475=t^mY*ysR8u55Jq8ER", "t2": "sk_RsQp@#mJE5xu0mWuxez!vPG_FDLas", "t3": "sk_ipS_HoO+AsCW%MJmh-#RvU;Q*5^o5" },
  "APPO-B6AS-BQKT-UX5U": { "index": 506, "t1": "sk_P3zuOrUw3~rJDHc;HDKxiGbFCDFdd", "t2": "sk_k@78a;nVs2.BWiYQhJ4nMPGd*V3=w", "t3": "sk_X5#uCYA78Htv8Zel?u8TSEQTQy?FN" },
  "APPO-Y682-C84M-XUSK": { "index": 507, "t1": "sk_5%-*?j5yBI6TWKGEa&*42UYCrwT!u", "t2": "sk_rvSS;@&dpH^t258Dw4e=X*478KVDW", "t3": "sk_Q*KAJ5bowlTz5vO5Inry#M2XZ5HmG" },
  "APPO-6XAE-5SYK-K3AQ": { "index": 508, "t1": "sk_i_e:H1lbh4WK8U3O&bD;jPXn2PNgX", "t2": "sk_0gzsChEy0EHOQicRLH=UR;5qxi59f", "t3": "sk_OAJFqlL~DUAFD~7N;WWBWsl;PseSF" },
  "APPO-8RFL-6BWA-E9GU": { "index": 509, "t1": "sk_F-gEV7#yo+&jwMyFuVH3rv#s4.vJY", "t2": "sk_F7zXZCLYuwZBD:khhvq#0_m5Ua*&n", "t3": "sk_U_27m_d.Ce*w~gUi;z+jFKCBfN%+8" },
  "APPO-H4AX-R6B3-CQHV": { "index": 510, "t1": "sk_Ej.Q*Zer6?KQ7jXS+36z@NnqcBe!Q", "t2": "sk_YmwmQyh@ofL%?3v9VFxUgcO?yh%wS", "t3": "sk_B!LSJbp.1^+sWIy:=r.2G^Clh=KHO" },
  "APPO-922K-7EJU-WC4B": { "index": 511, "t1": "sk_Mc_N;bbz9&h7X~4@f*z._QH=:GKJG", "t2": "sk_xahJT3k9M_pW9nnY=Z=-HXxQm6mqJ", "t3": "sk_8_eC:1gcxdTWA:AG0@LuSNlEki7?d" },
  "APPO-7RPE-8BZK-94MB": { "index": 512, "t1": "sk_4REzT-ZIFC.E!Bl42=uoz23QcF=ka", "t2": "sk_PO^Q&ejD0rZZ6~c&h0.+7*BhHf~rV", "t3": "sk_7#b+*:u^8!lHJ:-RZ0B&+I-l*-IKx" },
  "APPO-NBT8-GQRH-2J5S": { "index": 513, "t1": "sk_ZcXPtVHFrmWdN4FGW0oLKM5ls1!pO", "t2": "sk_g%MKgTl;y1jc?*4aoWV+TfPqOhrUM", "t3": "sk_m^_cU@amEQHVN!084ak46~ss4c7Tf" },
  "APPO-ZAWJ-5HV3-YKAX": { "index": 514, "t1": "sk_7:CRcSOKNAx~8vQgI3*gh+mtrm3@8", "t2": "sk_K^U=9.IRG*f2RA~K_7=.Pq~@EM?Gi", "t3": "sk_3*nik!GE1T+4un+z3~Se:YeH0U;~m" },
  "APPO-PZPJ-7LNL-HPGN": { "index": 515, "t1": "sk_8OI%=kLzohpzS*lWYjUrwV.JIVY@K", "t2": "sk_myZe8ncFugKUBknUt#I.?_dolyal7", "t3": "sk_CeQ@429U*vx&41Hg=QR@ZYvjps+~o" },
  "APPO-SP36-KGEU-ZZSX": { "index": 516, "t1": "sk_BQd_S*kWjCp0tG:jpzrDi:sGlY@;Z", "t2": "sk_GjlW^t6?Bi78E&2Ql:H5o0xDz_tKL", "t3": "sk_ao?;;Z8PU_0XO%._Ya2amiD&UQoSs" },
  "APPO-Z7HZ-LTMK-799K": { "index": 517, "t1": "sk_p#:SQaVKh-Bn%pgI_X7GO;ra:y%NW", "t2": "sk_1wmkVL?O;Q^4OieVM2Ri?5P8tV_a4", "t3": "sk_bt@KLIUx~1bw.kT79M-~TLDs-xR%6" },
  "APPO-LLGQ-42MY-TDDN": { "index": 518, "t1": "sk_xuaCCSy@gu2mHl&UB4O~P8=h2dA*r", "t2": "sk_Owls@^m6+pbO0EOQuQ^F~19u~VE3i", "t3": "sk_jF_vox=BhvE6#f@wz?JMDT30Psyd6" },
  "APPO-G2M3-MZJW-TYVZ": { "index": 519, "t1": "sk_0.=O3:4Jqkcz0lPp0?t!jz*S-_hwY", "t2": "sk_4ZoSI%3z1tTw5B5gSqcTQ*H^lt^bp", "t3": "sk_LJVv+MRcCmqhU-bV1pNR2k6pB~G+h" },
  "APPO-89CK-NHQA-DJAY": { "index": 520, "t1": "sk_9VfOWg11*JlkzQB^;rz:3cWxrRQ2f", "t2": "sk_n.zOVX@P#oJ^Iqvhb~X.:-2%@&8Wq", "t3": "sk_Yb_D:~r?BX;Bkbsh143Jg4^_:12w2" },
  "APPO-9DZB-AEGX-ZN5J": { "index": 521, "t1": "sk_2KE+G=v^nvvtZQ!5cL2Q95ztcum#C", "t2": "sk_4enS51WK29owl6Pe2Zbw=BE:@1eSG", "t3": "sk_Az*GYhB6ECp_o~BMO8Ddf*jNyHc_3" },
  "APPO-TGQB-7NFE-WSLJ": { "index": 522, "t1": "sk_KyKw6-7TDG^uQUJ~*=oa2VVqT03fN", "t2": "sk_LG!wxvMpBc=RTYu30-~P6k:plups8", "t3": "sk_hZ.XY_vY9Epi*c+XI*aD2%?qq1Q^t" },
  "APPO-9ALH-6SU8-MQXW": { "index": 523, "t1": "sk_SQ23Bm@NuPf0=%qJ0c@+mC#%MXlHw", "t2": "sk_3-Hh:#ED=EY0~d0+TcLADr3Ex#mmN", "t3": "sk_wPrxBi#bI&DReop-zT_bKAQ~i8:Pf" },
  "APPO-B878-ENKN-4SAP": { "index": 524, "t1": "sk_J4.D1TK~w;d%_hj:El35&l7K67T4U", "t2": "sk_x&r~ou_P4eWqa=pENT70cGFbh0z5X", "t3": "sk_9cwjp!bwBpxqWn._7b_0Vd=gmb9FW" },
  "APPO-T2QJ-NEVS-4UTE": { "index": 525, "t1": "sk_L&?y;7sjRN#Fv2@s*Z#SI0x-X~+lV", "t2": "sk_xqbW:RIw15+411TZAp*74kdmlxnCl", "t3": "sk_NCfr+w^vDVL4f+P;#2=6X3CD0w&ZK" },
  "APPO-HBS6-H5F7-UMZX": { "index": 526, "t1": "sk_GVikSED@NcQYzY_IIG8qlbtOc*u#G", "t2": "sk_1@DtUJyV&OBwsi&tMEZN!UjEYt!mO", "t3": "sk_mmx.M+ZD:LVQQetXfOt#7FUY:H+-i" },
  "APPO-AC4R-FJPN-RG4J": { "index": 527, "t1": "sk_S_OZs2?2CGe4VeAo*WRIcMeXNtmAB", "t2": "sk_T88d2:jt-xAI*x3gOyp3Rqj#SXN?K", "t3": "sk_T@:mLolCnxdhk&f8x4Ys:C:KZruLY" },
  "APPO-FRXD-8FZJ-B5H7": { "index": 528, "t1": "sk_f-G!?q=nB?6wnEp;xZ5U_dOf!uruW", "t2": "sk_bGHu~ZFUxa1iOatIR7sgO4e36S2jX", "t3": "sk_io!F?lWK0bfh&f=tf5C#JNW~MSc+T" },
  "APPO-Q6U5-KEQ2-9KEB": { "index": 529, "t1": "sk_Ll6p=nGbw72L2Dd0yZ~B0A2t5gOU4", "t2": "sk_cCGLnlNA=Dzf1-~:F@5dXg6n_eVlH", "t3": "sk_FByiHW1o;^;t^mA-+7D.2K71grsBw" },
  "APPO-E4VS-TSPX-VSM5": { "index": 530, "t1": "sk_JLO_*I_G=zq7g-tIvfdk3Za5:er=W", "t2": "sk_pC6t4Sug?:zhkPNA#8Yk;7B&M9J:D", "t3": "sk_Ww;_EaIcGCmmcUZy6YmWTs+-5UvJn" },
  "APPO-QKM5-P4G8-8VQ4": { "index": 531, "t1": "sk_P52o4o1aNgEz7lAE.*G!J=q.@Uf!I", "t2": "sk_M11iOEh51LDNv18C;1h2UJ-KtYHwq", "t3": "sk_gphH3jC;n=zJ;2R+ZBzLA8+H9GfcP" },
  "APPO-NBBJ-8PZT-ZSQ8": { "index": 532, "t1": "sk_V^QpLy9u7gH2gqABWgNyx3y%01!kh", "t2": "sk_L4y3nD?AEh=nyS@*~f2H+4283tprT", "t3": "sk_HVUVwsvyg+Q_herq_6MqRXGYK1%ZW" },
  "APPO-K6T5-5H2J-VWJL": { "index": 533, "t1": "sk_jR&ey1R_6TeBZ43=EP22S9f?uN!uD", "t2": "sk_5A%0HEg4_LlPsKue%H::bTKK1oBEB", "t3": "sk_PvC01jGs04undD2cV^a5XL5+nbx.F" },
  "APPO-FL6B-FHK8-U5M7": { "index": 534, "t1": "sk_Vs47GjafM51m!NaiUl~YMGM9n5F7q", "t2": "sk_U6X#2iO;6mdOSVBHW2P*bLh=9nj0d", "t3": "sk_k+tQwUG%@NWJ.vr^@BMMWj2i7XX63" },
  "APPO-4DZQ-EZKG-TPGK": { "index": 535, "t1": "sk_756lkii@i7_VCF;P?Q61!hS_BRYqn", "t2": "sk_VUmQ4PO&#T+~=UWM7Ee9:N@*fT600", "t3": "sk_W@4~RN8o_&Pog?@avI.5EaolRE&?9" },
  "APPO-JGCT-5RGK-52BE": { "index": 536, "t1": "sk_t-BZKKo#^M?_45zQJp6;LU~3KqwH7", "t2": "sk_p4r3Xq#HT4H!+:paumtFEytxlCU_8", "t3": "sk_rpvI1g1APE~MBKpmNsEoGd.dyhtlJ" },
  "APPO-NG78-VM5X-S3XS": { "index": 537, "t1": "sk_vo;QU.U@zzM5qp*+xhLtwMco4tYUJ", "t2": "sk_qTwq=2DCf9V%=OP3~q+-xk&vLtDNm", "t3": "sk_kp=!.n~i_?XayDTtQeUO@_Q_ijD~d" },
  "APPO-KMRX-S5GZ-V4DS": { "index": 538, "t1": "sk_fvm3V0+V7OOK_ecHmyKfBdT.40hvQ", "t2": "sk_C_rDs*?Mz=yhvrEDi:n;RFR*hot-d", "t3": "sk_uKf-thW*nb:cG.JGBG#tzrJje5k1p" },
  "APPO-HN5Q-2J7P-WU2L": { "index": 539, "t1": "sk_IGRq?O8%JQPla!LKn~8*mcViMHRUh", "t2": "sk_c7Qj.HXaJSqaeJtWU81IBqyKMQ+!Y", "t3": "sk_U*xU**M-WV#2=*RmHeHb8~:&KGu9N" },
  "APPO-TH5K-8SX9-MD6E": { "index": 540, "t1": "sk_7g=uUKO*^TXL:xP~R0ReaVw;5+@&L", "t2": "sk_S~AVO5LmI7MLw7G~_m8JUVsJ;hOWQ", "t3": "sk_9J6dxrY=%mFT4+2jz7%XiBvyGTE_I" },
  "APPO-D5KR-JYT3-DPYG": { "index": 541, "t1": "sk_iV?x~P^dOCjF*ch~CfC#gvn?.N.xN", "t2": "sk_37DmNJDW#*7E!LZJbi;&q?F6!Xydh", "t3": "sk_Y!=L&F1g~KF_eX?&=Vq=cEN0n.n?p" },
  "APPO-WWZN-MNBL-H5K9": { "index": 542, "t1": "sk_rH~noL^FU=X%KUT6c5^34L?fk.TQ9", "t2": "sk_r5-18rMVrt&3cwyua_%t+1yO33k;c", "t3": "sk_Eq4?DN:0cRg=VsSG=MGWCwO%uMB?P" },
  "APPO-4J79-8WKR-FBM8": { "index": 543, "t1": "sk_v7L-zgBq^XVDFtorEqze3-n37-8~D", "t2": "sk_2CjIeaovO_H0^EYF0DvRCZF3yMq8x", "t3": "sk_A!&&bk8;Z0-t9QVJqX8g*xkbfBmKP" },
  "APPO-PH3R-4K47-RSX3": { "index": 544, "t1": "sk_yhH8BdTL@TpDs8voG#*AZMB@JyRqf", "t2": "sk_J+9MFglU8+;wEor1q?4HrbA11V6T0", "t3": "sk_BVDnBvB4qG9+p8Y5b*l3YO:9e?Dek" },
  "APPO-ZQZ7-PHN3-H28Q": { "index": 545, "t1": "sk_uhoZvx3M1f+bG6XKql6JX?IGo9wv9", "t2": "sk_5iB#YnA8PgcT%9dHJQ7zv.G%u!;.9", "t3": "sk_6kwiAN-:T8B39kIhpPokBlFiwTAzR" },
  "APPO-TCAC-LHPB-D8HN": { "index": 546, "t1": "sk_X?s-rTahdIS#MpDKCaFCyWJU#~%ST", "t2": "sk_ZqdRO+?bVA+gsK!G&?9B!p-_P^&:b", "t3": "sk_ma8jbAJnJM~CDg!vl_+l7rIiRb!gB" },
  "APPO-FRUT-X673-29G8": { "index": 547, "t1": "sk_j@Asli2!MJn0NR^:eG2+5Iq6FiyUN", "t2": "sk_ZwQb^CE0bwdMiIux%+w3*%*_1EUXC", "t3": "sk_Rgty^hb9GoAhhGHyqCdu5B-kog=od" },
  "APPO-BP98-NWGW-JAXC": { "index": 548, "t1": "sk_15+XG0!D1C9=1H?Fy0&h8HBJyTw7T", "t2": "sk_a1c40aKTE-Ra0J8j:Hkkz_E!7UX*u", "t3": "sk_1O_AmhKlpoIcLlHE9VduW^PX0S%oi" },
  "APPO-EHY6-5V2R-LA68": { "index": 549, "t1": "sk_C_WSK6dia#nzJ9Ex^b^faLyAJQ*cC", "t2": "sk_T=jRbfWKTRfO%rfQ?-x;43@s*v&9o", "t3": "sk_UKZ50lMZ%pyh?v~=raxl6bxfJtkNH" },
  "APPO-CL6R-2L89-ZFLE": { "index": 550, "t1": "sk_6FIlBOJWg#HvrAfjU#_G8o2%.wxtg", "t2": "sk_YeglkYb3rtd*Bf!4JbtNCwqemvYHv", "t3": "sk_GS!t+@@Mi9@+m-xofR@eD0+!wSvhB" },
  "APPO-UBBZ-WJUN-KVPP": { "index": 551, "t1": "sk_KGWJFW2NS~RM#.Q8I^@YVbc3%&6Js", "t2": "sk_gy*9PLytho!yh%:I;=&24M7FHv&3j", "t3": "sk_W_NqCSgma_dx*IvAnf34;LbI!HHZT" },
  "APPO-V75H-4TEB-6D7D": { "index": 552, "t1": "sk_Pwr:9m3qPzYXKwU78MLW50T%Af:%8", "t2": "sk_q#%.uk8D~.01;.HUDJe5V-BvEdU9c", "t3": "sk_mm!NV3YWL::tX~B:M;?%Kh0Nem*yx" },
  "APPO-UDNB-MDRH-R399": { "index": 553, "t1": "sk_GkR7R4%_pDQA7+@SxDN4F.noj@?-5", "t2": "sk_2p5DKDzZ7KE79^F:rVSAsLYm3GzoO", "t3": "sk_EF^CcUTPk20uLyE#Y660;r&z-Mf?x" },
  "APPO-3PDS-NPQH-KX72": { "index": 554, "t1": "sk_8P*!%a3&TemX:.t4qhJaz9:Tm&+Oc", "t2": "sk_gx0F.n+5iu*YSGQNxV:~:9wC#Hjb7", "t3": "sk_k^G+88U%Jv9T26+7By~5AFe@V&NPF" },
  "APPO-YJYE-D6ST-U6WC": { "index": 555, "t1": "sk_U-IWL&qo;4&X^Zb+tUOZLO2Vi_^Fn", "t2": "sk_qCX?0v3BO~B41%ZA_Mb.KJEy3DZ9R", "t3": "sk_rL7+-IkS:+MWi3LDiV&PfU7MdLncK" },
  "APPO-E79A-VXVW-FDLP": { "index": 556, "t1": "sk_i#8@hFcG%zM4+VdKc0Gj.#3BxcxHK", "t2": "sk_x+D+KIUanXx9qefV7PfFQ:weMuc.O", "t3": "sk_T*rbNKEo0@M~Za;l7aNOp1HaF4d7N" },
  "APPO-WRYT-S3X7-V2N5": { "index": 557, "t1": "sk_VFo:wn6M!oZLhJr?YV?RjC*hY?55o", "t2": "sk_Q%Zra6eR3Cf;0eH!t?Np^vgzScsCv", "t3": "sk_t+~wB_k574xrI:iG#x^71yjjV~BiC" },
  "APPO-5MCZ-U6EM-3M7E": { "index": 558, "t1": "sk_o5nblwx6Rg0p3;J7fmIv&!CpR*41W", "t2": "sk_0TrJu3vnItOr~0_?p^7sZh=hMN4@i", "t3": "sk_sZ@e-jIbx57m5b5fQfd5wkA_t+pGi" },
  "APPO-3S65-ELHD-YRZJ": { "index": 559, "t1": "sk_90-+A!?xDXff@O8O32.x#:hVk9W:y", "t2": "sk_aZas5YmPblw!yBYXvqpQDrJEOs6DP", "t3": "sk_sR.+S;d&4fxqdB8mqVz.%6aXw+Lvn" },
  "APPO-PMAC-Y6UT-SKTL": { "index": 560, "t1": "sk_LguP^:@*@?WT1d=1K?CD1ks.@To1B", "t2": "sk_fZ_G1E6a!#*-!.3pBuHNa.y~pp~O0", "t3": "sk_1Lfu-Y:CJn~!~b*ni%HS^RBbJl-sV" },
  "APPO-PPGR-JFU4-A2N3": { "index": 561, "t1": "sk_3mrk=eg_YYMThWo^Qt55yalTLRDoR", "t2": "sk_VXWcNGaQ4PP:OWu-Wt=IwKYDfq~Aq", "t3": "sk_Edt2N8H42Tr^r&0=6N1KRAoCv-=Fq" },
  "APPO-P8B4-5XUP-4XEL": { "index": 562, "t1": "sk_vwTIApPiZZwfTZOanPqV@ne3g#nSz", "t2": "sk_4KBmu#efTkQ^astHsYOU1F?SRo.gJ", "t3": "sk_deitqosZR9d3^?Ft*0Y^htM2-rjty" },
  "APPO-ED9J-Y6HY-2ZFM": { "index": 563, "t1": "sk_auhllTm6rM;9ljd7R#T1~HPcagt+y", "t2": "sk_F.!:5j@u!+QHW832h*iO.9kDo~+J6", "t3": "sk_Vk2b&~*x=osm*ch.XHTFK24NcV7hX" },
  "APPO-EXBV-AZ5X-6BQU": { "index": 564, "t1": "sk_XYg@Xhf:NgBy6&W+@Q6ZI61BQS1WN", "t2": "sk_De%Q=VTK_?BPSiNcSAztUk67:^n3c", "t3": "sk_u9RhcWX=fvxN&9*eDk3gr@:Rw!!nW" },
  "APPO-UEUM-UMYV-P467": { "index": 565, "t1": "sk_Y;6*y:!W6EtHadOT=^?*vY^DyTFrx", "t2": "sk_0yIn_A4~*;;;5IziuX+yHmt@JQtdN", "t3": "sk_8W.Gz-AIq2mA+MkC7dBP87QVsHY#p" },
  "APPO-X4WE-PDBN-KHBY": { "index": 566, "t1": "sk_VJfVrINM0q;YguJJ_vjxW2qUYKJ3l", "t2": "sk_n~fEy_;3Fd.^^Z%@Lnigk*jKz.C#p", "t3": "sk_GFChnVKuLyx5?:MymXj&n+IgXwT0I" },
  "APPO-A6KH-2MEW-TJ92": { "index": 567, "t1": "sk_Dk.r_AJpix.%7;e&9p#Vlj1Ctf85y", "t2": "sk_mc3qE;3%t3j@5VFCU1:DF#uFjpjdV", "t3": "sk_ZR1fKvWhgx?d.OkDp6=1q0=N#bp:a" },
  "APPO-HQW9-Q6XQ-YT84": { "index": 568, "t1": "sk_Q3&95;QH4n:Ey9r0U:jT#*y~!Sn+j", "t2": "sk_GPG;4d%;~H!.r9b68JSc@ZVHvmCKQ", "t3": "sk_n2*#Y8^ux7vLec?*A~KlH:3227zBH" },
  "APPO-7J62-8RBA-7UHG": { "index": 569, "t1": "sk_jMScQq%!hyM9#8Q*C1s8ArF!Hgevv", "t2": "sk_Po6n:&beJkm0lSyZ:VdzKw_&rCM@R", "t3": "sk_oBcWz#Dg!p2G=aT6UBkZ:SQiZwC4z" },
  "APPO-2KVJ-PVMX-TPED": { "index": 570, "t1": "sk_dBq:8GXr+aKm;O=8ZPKHVE7A4kC2e", "t2": "sk_VHzozk;6fFuB5mpxiA_u0rMnPc+!a", "t3": "sk_iElwy-VlVDunH3=G.fi9Jq&eK@ghn" },
  "APPO-QUGM-6YUY-HHSY": { "index": 571, "t1": "sk_Am4mYb+FBEEyhO.g.cxg_?Mh#yvfO", "t2": "sk_S8@jQQ.-O#yvywlc=:kJPlq4O?3_t", "t3": "sk_vs:pZJxPt-iRJuF%jeWmhtnOFv-MU" },
  "APPO-U74M-7CTT-NXFX": { "index": 572, "t1": "sk_RYkd%kH9HG0ix+WOdCnrJ5.C-^+%9", "t2": "sk_bh#L:S+wrLSG4?UyI9LqLtI#JHAVJ", "t3": "sk_lOcZ5rP2y&85#kmKDf6Cm35hqN!6H" },
  "APPO-L9N4-BXYA-RUKJ": { "index": 573, "t1": "sk_XRGz&eEny.XSc0NG80g2p9-b&2Juf", "t2": "sk_r7=@d@QG2n_BK&hz9x-3c5I=kgRo4", "t3": "sk_gVd.-FatwvB~*O-BM#O?ge5lZdnDQ" },
  "APPO-LSKF-LGX3-XKYH": { "index": 574, "t1": "sk_a+K0gt^nE7;bNvNvTI==8I;wVqEO5", "t2": "sk_xQ%jbt-75&V~7eDS??1*PhY.VBwLp", "t3": "sk_Ob0Ef~fD8P2Wc.l^GHI+8YbX=SI#z" },
  "APPO-RYJ7-ZJ29-7Y5S": { "index": 575, "t1": "sk_VyO%Ihq01:qMXTPw!5z;mR@Yll3fZ", "t2": "sk_MbpS2;J9bZK~whwO*qqH6UPwvXGC6", "t3": "sk_oYxrF.Um%o0&1GK_h2eU!fSGve5Wv" },
  "APPO-C7YR-XDE9-J62M": { "index": 576, "t1": "sk_1zTIJoC^rxx!y=B@_pwidCoqw&m*v", "t2": "sk_qp=odnb7WyZ8PS0QsrwKDC=lLL6ao", "t3": "sk_pcA6ZO5ijNU%!tq!24@IeOS_*uAoe" },
  "APPO-7KYS-2QDY-2XR2": { "index": 577, "t1": "sk_JjWSXnC9fI&:@Frn8ESyr4GT0EiiC", "t2": "sk_rBtnepZ&fB!cGAPtp**s0US8P16Fp", "t3": "sk_W8S7+=PRM6U7%7@:gOigsb7XEC_Uj" },
  "APPO-ZBBE-GQR2-6KAC": { "index": 578, "t1": "sk_kFqhI-u;4uM~j=UBx;DhpY4pN!Uva", "t2": "sk_rR7A@ROc~;^xR+O;G6dkjx1ToMPMt", "t3": "sk_V6EqU-W*1Z3#Dnp3Hr^=tDirwrZOd" },
  "APPO-68Q5-B997-YDEK": { "index": 579, "t1": "sk_r&.dP!ye@85*n^IN:NNrD.?zwTS#s", "t2": "sk_1Ytyzjpd%iQY~KIRuN#Zh@xA83d8V", "t3": "sk_R^U3whdRMI6B?A5YhOd&=+6HQrvpl" },
  "APPO-LNY2-8GRN-DGZN": { "index": 580, "t1": "sk_asVjWnx5P%Nf_6Q_?mQX5eczR0FAC", "t2": "sk_D6_bF9dB&vr=&?aI-?fTZUL;JcJrD", "t3": "sk_SX-si:5eJa?0DQtgnTz4j;Q59#=3j" },
  "APPO-N6JL-Y4BA-UG8A": { "index": 581, "t1": "sk_cF-M%SbE6qSa-ghkvX3cSkB&25%6V", "t2": "sk_dXuiH%c#&~Vu5-=.-~Xe6J%oc=q11", "t3": "sk_aI1s@L4.r+Da&VCIIi^_dvz?F%4gi" },
  "APPO-T28W-LQQJ-9V78": { "index": 582, "t1": "sk_TqG.Gte7f:&Y?x&5viLlC4ycAYs5K", "t2": "sk_A5dmhlGyJ;.rU9J1j~3SSJ7R-3Jqw", "t3": "sk_qevC^iC!q^VuasT*o=:0mfyiN+wTC" },
  "APPO-MNW3-YN23-MLTZ": { "index": 583, "t1": "sk_eJNfv%kI9sfF:zHqvPD%W:T7+idjh", "t2": "sk_JUuz.*#fVQX?oXWDo:zhFQAKw%AX7", "t3": "sk_8G3;#ik.q8+M3YrE4~=9bn=;cm6Mq" },
  "APPO-GUR2-9ZFC-TYFU": { "index": 584, "t1": "sk_J2B~F?qnh0:5p;*GW!n9YPM3Q.iok", "t2": "sk_J_Bus@S=S*6pp40gpH;pQ=Tj^4!Td", "t3": "sk_9o%ax7ax.%86lafL+@k8EBo3cnROq" },
  "APPO-M9SD-5RV9-XYFD": { "index": 585, "t1": "sk_ovs@E!6Y?E594!g==QLXBRt5vy~Ov", "t2": "sk_H~:&8K?aN.T7js;IY~ieJEe7#glJl", "t3": "sk_4Eh^K6stEllkkXt50JI%iDlKh_WJg" },
  "APPO-DB9U-7NPF-NT7M": { "index": 586, "t1": "sk_a2?*Z0xyA1Ytqv8_tkT~e9sSdQ~wW", "t2": "sk_i5x?xsmRyT#cEYZw1*Ne.X~M!AHPW", "t3": "sk_uv!M!hW_7vn2~DnMo:T79olBG&Y2t" },
  "APPO-WU4E-PPW4-QXBF": { "index": 587, "t1": "sk_z7=HjhtVySk46cKZu0wLjxr0O-YJj", "t2": "sk_n0JG!X3b26xqXwzBn5bM9PYbj@&mT", "t3": "sk_naj9mTibTW#n2eQuqjSQbPvilW9NG" },
  "APPO-9X2D-CX28-596M": { "index": 588, "t1": "sk_KuKaxbX%poH1*:Cn?TO_o1lLELf+6", "t2": "sk_Dc9rCWIlxT0I7nKaQdISITy:~d6kp", "t3": "sk_1=~&%hco:LEXMx^4c&~C=*uneH-Yb" },
  "APPO-7ZQY-BW6N-UVRU": { "index": 589, "t1": "sk_IUgW51nLXbisrTgEc9pg;L6q-Td41", "t2": "sk_YIUdhuq7U;N-:#eLQY9H3uSSpVYiB", "t3": "sk_H#P7+I:qcsws_d1:rys:ot+CotBmm" },
  "APPO-6SYK-TMET-YBHX": { "index": 590, "t1": "sk_O~1er#pa4jlKkTAAAuLf#*4kj!yLc", "t2": "sk_Hp3UKijNc9^G=F.7?@S9=&MD;Bma2", "t3": "sk_z%Hq%FebqJ*~ouC%ht3wRxotrGZfn" },
  "APPO-R2QN-4UEM-L3TB": { "index": 591, "t1": "sk_C?ULTv~p~Qlr7_f4%7nfII01JZL:N", "t2": "sk_XfAeiEkVeJ;0^R7x%3W6R9kL%Yz*S", "t3": "sk_n5dK5vC+N50^B%X3DfwR2^.h^~euZ" },
  "APPO-ZPUJ-GRX8-5V6W": { "index": 592, "t1": "sk_XBn30tAjpw?vW&@4%iIp&&cCy2~Ld", "t2": "sk_y3XJ0uBS&wpLgEEg:!axD%bT;BG2y", "t3": "sk_t*a*_gt*k+&+7J55Yz~XlMkAmf#+Z" },
  "APPO-ZQJM-CL6N-83L2": { "index": 593, "t1": "sk_N3jRO9-zY9Mx51~hE3^eMxz!FWb0G", "t2": "sk_AYFc5vzm83ZoGs&5K#~xV3FWJJC?9", "t3": "sk_JyM:Bgkl#D&Ll*dx.wdZ:a!*Dx@Gl" },
  "APPO-C6WV-9KBT-76FT": { "index": 594, "t1": "sk_shg0WaDu4XSt^AH4Wo7dME=OdE4N9", "t2": "sk_QB+PvB%~*qVY4~5=?07VO0F^#NE4u", "t3": "sk_n+vNj%ApH!apI^RE+O.tl1c-h8IeA" },
  "APPO-QJ7P-M2NK-K2S8": { "index": 595, "t1": "sk_QeP@_t?M+gydT3js84m*FM2?Z0ulx", "t2": "sk_RU@Ca3avqEErGseJT=+*Ved?8m:Cj", "t3": "sk_A:aZlp_IwYHM1tCe:_eWIsv1Dp;cv" },
  "APPO-J77U-BJNP-3QMF": { "index": 596, "t1": "sk_NHR!aUAEzz5@C6VXDP=@rY3~*c_!j", "t2": "sk_gt1C*C!XX7luOpGi#YNot8G8lxIHI", "t3": "sk_Byhe+x7P8YA:.CAWiE7K#z5.Wj*.x" },
  "APPO-4LGR-BXFT-PTSC": { "index": 597, "t1": "sk_IL@yK=gQx~I9vNAogHIjj!^:DBcTZ", "t2": "sk_hkSzs8%z%UD6zk;fgEP@pcGO7QMeF", "t3": "sk_s-*p0CeoQXtUtXF7d*#lT6@_gdFi5" },
  "APPO-D92P-QZUT-2AUN": { "index": 598, "t1": "sk_2lV@zyNhz=j7CLIF#gH.iKWV_*tnB", "t2": "sk_QZ=2U.f=m54+E.Vq3nJz3LmMHFiFN", "t3": "sk_5-De12eUrU?zBQ-PT@GsI0IH.PBNX" },
  "APPO-DTY3-L3SR-2GA8": { "index": 599, "t1": "sk_kYYeP+-z#t3!kfjWU0mH^Iyozx:yt", "t2": "sk_HnpIZY#qBUs4h^9LV3FRs8o6_D.=F", "t3": "sk_4Fzq&+u=AWB-:Wcn88ABm;hXk@tY9" },
  "APPO-9HBY-27VN-A2TR": { "index": 600, "t1": "sk_4HZiP-Mlk@@?03:+sJ;-QerKL~*&O", "t2": "sk_H3aT3IKoHAZVfmerKvhqHLqPt6j~j", "t3": "sk_pFxU7ahb;+mPkyfcicJPlSct@rFSZ" },
  "APPO-2FDH-8Q4S-KPGQ": { "index": 601, "t1": "sk_LM0F=u.u5d&E42Pnu4ol&stM!b-b8", "t2": "sk_V-!832h3eAkVmd7TP5;LwIirtu?rg", "t3": "sk_tQmf:m3J~ex^NXGEuMExG#EwN:Zmn" },
  "APPO-SB6D-NBF5-2LZ7": { "index": 602, "t1": "sk_Kj4?vE&CCYF.tHM!^4#Osa9~EsIBQ", "t2": "sk_PKNwE1@!Qvrbx+#Rdj~M&6I^Ig.Zw", "t3": "sk_9R;uTl5_l!Iw:TH66-4*&%FPS1!sZ" },
  "APPO-NX7G-VT2M-ZYE7": { "index": 603, "t1": "sk_lBr#KGhCUf4Ut3hsCwKm;W#kFDgXO", "t2": "sk_a2ULgloYSCk_cw4-?JxBiPZBi=X;n", "t3": "sk_fk-Ss2F?7nb%iQ8^g&j9wkQXi-:?v" },
  "APPO-29KZ-C7PN-DTE4": { "index": 604, "t1": "sk_i*^vUU72~T7^!&u::PnGhe&6@B!jI", "t2": "sk_MqHdlPeA_fUNg@+rVKiHri4Xa0oCz", "t3": "sk_3w;O*^3xd3*WoXqxM6^n:FH71;Lbu" },
  "APPO-DC9D-EX4U-U7HZ": { "index": 605, "t1": "sk_cOZeZ8tu=B;~tj8jK-pxyi#5L^AmD", "t2": "sk_l+VQri&SdEallMApOjShZ;?=BtE1Z", "t3": "sk_0p=;*%M7w++auS73FWX74=0:!#&3v" },
  "APPO-6JGS-CLDF-NYBN": { "index": 606, "t1": "sk_IOT~b58L0s#A1.-y7L5!uWT65khzn", "t2": "sk_w;7YKXf:Ul!zIpnlTWo&*QZQsE=Ms", "t3": "sk_0LdAvZvs:NXshJe!ytbuKaM%Fmc~p" },
  "APPO-4XBY-PZHL-GPYL": { "index": 607, "t1": "sk_q=NM^!tzc9HfBA9s!tUXuVGDidCFH", "t2": "sk_zn4-AhdHFeK8tBX11W1J92_eILUl2", "t3": "sk_l0-@0?ady@vCT:M_hZlID-xejzc!v" },
  "APPO-U8E5-H23K-69QU": { "index": 608, "t1": "sk_BaHEN1wPUmk#3z8oyM:zU7JRBZqev", "t2": "sk_wN#Xu:ounTUh:xOEll#R8U&-Xe#Te", "t3": "sk_qMBWn9vb=@to5qmx%@WEljBbyf=^z" },
  "APPO-F48E-SDKW-4UJM": { "index": 609, "t1": "sk_dQr?K.1O7;U&sdMhgzy:mA?Ss?PRx", "t2": "sk_akPnD8#^BgsFtd+I1vx%LDx+;oP;2", "t3": "sk_bcx7%aC2jlGAPig?dqg_#j%AA.4@E" },
  "APPO-PMCE-TC5A-GMM9": { "index": 610, "t1": "sk_9Ys~*89dgPpkgd-b=OpxqSj3Y3.Pf", "t2": "sk_j!YMs87LBaR^1!1c*j#+n*BjRYtlb", "t3": "sk_Q&nF9Xkk^65Zr@0o61B%YBb_cl3KZ" },
  "APPO-32P6-NJQY-FD7H": { "index": 611, "t1": "sk_VRDqMsg-q%6TXwvF+AHk4H*UTrO#U", "t2": "sk_h.~_MBo.r0-td+dyPP;&Ts8yziImX", "t3": "sk_O~Im=mSE%=tHbT=^Z.zQ.3*7sz4d8" },
  "APPO-2YYB-4KP3-7L2Y": { "index": 612, "t1": "sk_PZYsB0Wx~X:w9PW6sIVaqa=Ure=en", "t2": "sk_V?T:HJe710MWmWo+Phg0B+C3:9jeB", "t3": "sk_wR5d@?d5E8di:UWnmFWz;0ydH9eUb" },
  "APPO-GEE8-7RT6-RYT8": { "index": 613, "t1": "sk_I!Bvyh2LjG7-MFeC8hPP:xc*h1oFp", "t2": "sk_eH5o^_YXZm!WYNSpF+~2i-*&**Efr", "t3": "sk_g~?iCktjpq2rG1BGgffK#%-:t@W9a" },
  "APPO-5AX5-XXJX-TYAW": { "index": 614, "t1": "sk_k##Wvu3MNlUj2&44+KOI_xU.sOqH4", "t2": "sk_qb^srii-cPDx*iJLtJ&39A?:X*;Bx", "t3": "sk_gbMph4~7=GoiMIqo-7q;kxv^Vx+nI" },
  "APPO-45LM-JQUD-VZTN": { "index": 615, "t1": "sk_QK?T3+JgNz;;6LQ5.X&-0%?#*kTIa", "t2": "sk_Sz~_cAypT.QOd^0grN^ZZb;oEjaGD", "t3": "sk_9:h^c8JUVr!xTgzQI-D1eBf92t!Qs" },
  "APPO-EWBH-MUEZ-8V7N": { "index": 616, "t1": "sk_QkR5qnRA@x3MFK~jorf-YLztIcrHx", "t2": "sk_2W_PtWrGAwT9hJ~K?mKcHX9OB%d_q", "t3": "sk_5j7z#8urr1nF+z4WXQ?~WAfYe^o83" },
  "APPO-8GAL-8WGL-CHS3": { "index": 617, "t1": "sk_MXl4qQ8wRv*ND9lFIg8Gw@XTOx5+1", "t2": "sk_9krGmzbQF2gN=0nznuBtIcpyl:^Oq", "t3": "sk_uTG3s-c0k3rxjLaFKL1qb?Yo3YGy1" },
  "APPO-NG46-WKAS-UDWW": { "index": 618, "t1": "sk_CPnvH%r3&ff;TiW7lgy%t~!P_LwDS", "t2": "sk_u^s0*4hb3tEbAg79:~xDg84owM!=T", "t3": "sk_VCUl*S07%Fd1Flrcn%YGy9HywPqdh" },
  "APPO-J5Q8-BL66-99L7": { "index": 619, "t1": "sk_6gOWC5Kt^g.&PYDsabOBLsB^hRp.g", "t2": "sk_Hn:8#~SKYGhz^TJ_*0PGJ@Ado1Yqc", "t3": "sk_5!8doMbQ@K4&OMr_5WgDJs@OK:!hr" },
  "APPO-UGX4-QZFY-UPSX": { "index": 620, "t1": "sk_dDls6IzPT6C=UwaKFXhoDFZo6sPv4", "t2": "sk_DdJpbegND8t.KP3d?^fq3pILuY#UO", "t3": "sk_HxlE?+ToYBwdruOq-gf%Xvv-LORdQ" },
  "APPO-NA3L-V356-2FPM": { "index": 621, "t1": "sk_A5ph*?m~gbxsJ+9bjDZ+6fw?mH7W5", "t2": "sk_X!t3J@Q#4+j80HaaTNwq&jNJv.^Ro", "t3": "sk_5MnPn!vscEMw3n^#Ia~2X4X1D8JN6" },
  "APPO-28JM-8XC3-ZSLY": { "index": 622, "t1": "sk_Dz=ODw0K^B5gMf_4Wv8+.r_bt22ZG", "t2": "sk_I2!3+!mw_LKjwYuRSgdyZqD.LFI6m", "t3": "sk_x^twF^K0baMFzolTT!7~e:Zap~iyg" },
  "APPO-B3X8-DQAX-EU82": { "index": 623, "t1": "sk_Z_!~;YBV~4YJOy0?xxkQXp_et3v&6", "t2": "sk_u?0B^8GkrsRciHcca7no*A8MRL1Xs", "t3": "sk_PxpTBbAM^o?nzfbGL0g&k0+q4ElMb" },
  "APPO-5YGE-YZK9-MJK6": { "index": 624, "t1": "sk_K:0M0^Twyy.TsUw!U#qDdhd5.i5eY", "t2": "sk_aEzOUvf^M77ZX%ybl00n3qiGy*9iy", "t3": "sk_g9S*vE6-!KF4j~p1l+8S7zBbE0Tsh" },
  "APPO-KTRW-3VD2-A93W": { "index": 625, "t1": "sk_Wpur+Z~~yeo:2ddMe8R^H=oS&l5wZ", "t2": "sk_MDYiwx-xUktzO8znNnPUT@;^L-D;b", "t3": "sk_CFa&j&%ZQ&rxr^yqerHA3F@A%G.;z" },
  "APPO-RHKA-B5H6-VPSX": { "index": 626, "t1": "sk_qw8aQpzE2.M*R!AW?L%gvmq#Q?S8W", "t2": "sk_Z34DHWSifgtJKw!bZhvPS1b1Xr2sW", "t3": "sk_I^DKSbOU~DnJFBML?EP0bwD!#ZR!l" },
  "APPO-YRSK-FWKR-JQYA": { "index": 627, "t1": "sk_L2WBEFqeyZe5E-dNW4+Y+.fS-?SHD", "t2": "sk_LofVZArI5g5dpu3dq4uvOx:#:u!rX", "t3": "sk_tl6LwkRtm;I%PGs^CmGI*lQLZauAn" },
  "APPO-R97E-8BZG-5W59": { "index": 628, "t1": "sk_9+C79lN%m?r=&09sDSxklt#HVq825", "t2": "sk_w4t~-Db1J6+SC^r-v_KFXsYgF_9;f", "t3": "sk_iHrQDhRQNrEH;AV2AhcaL#&Np9^fr" },
  "APPO-TK8U-K6X9-XYCF": { "index": 629, "t1": "sk_gFnptsuZ8ivLO37D^a9iyGY?V9#ns", "t2": "sk_X#p6n#Y~yYBXfICu8rC8~nFh@swfG", "t3": "sk_xv+8lnfH!@bG.k:e^N*cy0nmDNmrp" },
  "APPO-2EQ4-R9JZ-LDUU": { "index": 630, "t1": "sk_d9Ci90xy#QpZFxI3jjOn0UT!tg;6w", "t2": "sk_6:rqdScH:UaHF1@j*EeUS?oL#aos2", "t3": "sk_MsyD.f=z4P:Ug6j?Hg?QlW5_A8oIU" },
  "APPO-ELBM-AB8G-3JDX": { "index": 631, "t1": "sk_lepPM~xsVXdhkF-~;J8MQ-QTG!Dya", "t2": "sk_yLcECie5UsQVv3nM;hr;DA-V*:!9O", "t3": "sk_QC!ArP+tEO&Rsvk=:1xE4tL8SJ4z4" },
  "APPO-C8GT-FQEX-VSWL": { "index": 632, "t1": "sk_c#eqeDwA5uqqBNuSsyH-_Av96*m57", "t2": "sk_9m:tkbHPPxLIsIEfJISpu&cTGnelR", "t3": "sk_iWRFZUdcp5iX%XnSNvu=KGxoL9~9Z" },
  "APPO-Y58Z-LGTR-4KEG": { "index": 633, "t1": "sk_so.%N&8qY0v%kEFR8z?PoZVSqCRfA", "t2": "sk_gl7rZ;I!Bm=k=7TiY^V;8AD%9WA2L", "t3": "sk_RP4J7VGR:*3LoEyp0RG3z=F8zuoYb" },
  "APPO-6D8Q-JDC4-R6XM": { "index": 634, "t1": "sk_h!bK~K;DK#K~TRpxJkxYN;@Nk1lpD", "t2": "sk_y=o9eWZQGw^lAB?bOHEV^OGrh9%?o", "t3": "sk_jqPxZ-i+NQoBYYW~kWUUhgoYLjrDs" },
  "APPO-A9BN-GSK4-L6LX": { "index": 635, "t1": "sk_ZZe=hg-DhP6++;U~NxBSIl:QY-sLE", "t2": "sk_kAJqohy859B_?k!*@ZTfZ:TY_DlAQ", "t3": "sk_X#EXxh0fg15rC20VUqE~Rpu5i@UxA" },
  "APPO-XWFE-EP6N-NHPP": { "index": 636, "t1": "sk_y*VV2!e~Om@c5Xia=m%sR8-d073St", "t2": "sk_zG-6g#q6mDSv.~a5n@OR#W%y3_Bjf", "t3": "sk_59c0@U@toCH#3c:7q=oLO@08aMEI4" },
  "APPO-VPYC-RK5G-BCVV": { "index": 637, "t1": "sk_tn77V:R+#KRL1:E2?bmevv4+xt1=P", "t2": "sk_AYwJT+Gq#*4*.lEb01k^2fwgh9RBu", "t3": "sk_WA-vv73I~7?l1R&BimAwW_T-dZLbU" },
  "APPO-CE93-A3KC-9DCW": { "index": 638, "t1": "sk_7_TSlep~3J_R9SGl000tJuNLgq797", "t2": "sk_Xi~~jI2ci^%G^gU59%eE9b%=u+Nl8", "t3": "sk_uFkbriF42rj3p~*ffhjPqi.No.b=7" },
  "APPO-FEQW-VNEV-3JF7": { "index": 639, "t1": "sk_Ga!w6iIrR4:FNoo7K!c?4dVvMYYcF", "t2": "sk_Rzk3TxRCCUE+MRfU7o*PEg7*Dy?^E", "t3": "sk_sviua+9DB=K_JN.0Zf9LfCm;?heni" },
  "APPO-JRB2-7U2Y-3LA6": { "index": 640, "t1": "sk_GmhPvnP7DVj5?S:Rn+d;YE.Ncf7XH", "t2": "sk_I_WXajwoBj%~Z6wA^ekHa?p!dK+jg", "t3": "sk_hcepkxgKdB_W*TrqyHAhlS.yE?1uv" },
  "APPO-QPNU-AZUD-QL7A": { "index": 641, "t1": "sk_k#QuM~MXeSC#9gJRA+yvE@JVZB:~N", "t2": "sk_9Bc-f^^XNVhLbrsw&uubdFd9orgCg", "t3": "sk_v^UMrkFKCh-8oDm+!=3kXqOBs5Nta" },
  "APPO-KT9U-PSVQ-JKLL": { "index": 642, "t1": "sk_pt!aqi%jk9J.a2Yz2N&#7aYP~tzZ8", "t2": "sk_PDCHm;OsJowm1hkhDUXz6W1X;?dgV", "t3": "sk_3coZBp0A9EMYgVR+IOhd5P?owHKfn" },
  "APPO-T24X-USBE-2FL7": { "index": 643, "t1": "sk_v_iai&GRILSD_eO2cNW5_84D.2VSX", "t2": "sk_Jx0Ao.XHT0ANJ=Kki6;F^K4npaudn", "t3": "sk_r5SSw3;?.i_+qscf*&VQcKpHJiq.0" },
  "APPO-9JWU-ECHR-Z9C9": { "index": 644, "t1": "sk_wJm%um2VVB8x5AJ+w=_NYlp:66?KF", "t2": "sk_xCT^7t?njSKdYBSaFaI*iM8Dg+O8o", "t3": "sk_Ylur^N5Ipdk7NgPLsdf:ZJWFn0FqI" },
  "APPO-DCCZ-E3UV-U3QM": { "index": 645, "t1": "sk_XJFZ355+C8S%g:CbBEeuTM%gF6N6T", "t2": "sk_gKj*~U!sM6RI_Smm@DCe%ra%RLLHr", "t3": "sk_yV%gDb1E.V#3enm4cKV=H-kBTqa#x" },
  "APPO-4KXF-AK2X-G4EV": { "index": 646, "t1": "sk_ngMWK^!eK7N&Kr5E3H@1QhZd5J9lp", "t2": "sk_erw7_7Zeu:pVdCa9jx9wzZsWvU19o", "t3": "sk_70QHsyqbEbX=bUXrF%oC;r~;I0maK" },
  "APPO-LFQB-V652-M4EL": { "index": 647, "t1": "sk_FR6rYWSgqvE#sx2j.DXhj%4TYsE@9", "t2": "sk_4!NFYNy-N5xFGLwxM0glmZXYpB+Vk", "t3": "sk_Xpx-oTu6mlJ%@6jWPvSoeC*vjgZET" },
  "APPO-4H6W-TH7V-P8ZW": { "index": 648, "t1": "sk_Vv-pF5:j4iii*wXgqClIu4GXzgSKP", "t2": "sk_T=_:23yn=i@*svNVYoYBVBe_TJGut", "t3": "sk_jj~UW~P&ZBfQ@S5vs3Wl2mQNYsfba" },
  "APPO-SXLL-R2SV-5NSP": { "index": 649, "t1": "sk_85yVPvzc?^Yki+r3t*!@qg@MGH8vm", "t2": "sk_9J0&Z0:l;!Ff;&BN-MsnUPB9SDbzY", "t3": "sk_sh1M:M7^4z1yGn^b*F%Lc0fC+i~8A" },
  "APPO-JRGT-6Q6B-Z64J": { "index": 650, "t1": "sk_H:OOjrd-x&3?b-h02@3X~?dYRhpEU", "t2": "sk_R9Q5+R8w;b^k%nJ:mYOR2bBm6&ORD", "t3": "sk_B*@7B-Fx*UkBHNB=9h@7tzyOH#A+4" },
  "APPO-75L7-HY8S-8HAM": { "index": 651, "t1": "sk_LPoD&Q3nt_3Ft^k9H6iMc6eR.7~xB", "t2": "sk_I_LmkH&p~F+~wS~#zh%~ZgxThEDWm", "t3": "sk_Ui+@;B;_HNAKS~uPfxwh#INbD?@%v" },
  "APPO-DQTE-SDLY-38JQ": { "index": 652, "t1": "sk_rtauvxt~jLN2qr?5tnq-emh?ZmN8k", "t2": "sk_k%PndRgzMU%p6WYY!%XL?5PqU##-n", "t3": "sk_cX*g^C2lq^K:%!bf#54WWsT.rxd2v" },
  "APPO-AAC9-4CCG-YS2K": { "index": 653, "t1": "sk_o6RG%O7L~vIKsZqNt?VjdUthL&HOD", "t2": "sk_8MRSnRZfVDpy.9lK+T:JFkT9Yfc4e", "t3": "sk_E9%s7pk5WabO7u8LtGx@3#Qep-o^9" },
  "APPO-XNXQ-84D7-YURS": { "index": 654, "t1": "sk_PM1V6KYsUUH^h~mXC.8r^pIRoZao6", "t2": "sk_n;xn*2Y:b5XFT_Ul7#flGF4T%QfwX", "t3": "sk_YcfCLscTpUrosT:@7c+5T:Zg=v20o" },
  "APPO-5NUF-MSVC-Q7Y3": { "index": 655, "t1": "sk_cW&3n1Qz#9WX5Y7aF&b7%BC_qBt*N", "t2": "sk_U-@1hubHlaa0%uLM!g#KJdbNgynSw", "t3": "sk_mwE@^I5;3^b;ki%mOqR&wtQPXy;EC" },
  "APPO-DM2Y-ZYSW-HZQN": { "index": 656, "t1": "sk_fQkQNoQNIrh!BC3R!*o*s0Yjo1seH", "t2": "sk_Y#r?oF?jlxsSUR7EI05zxQ-Yop*9n", "t3": "sk_SfZvc0KvrLth*gfRTYAR:!jKs*38U" },
  "APPO-VVFP-AYC3-SNNZ": { "index": 657, "t1": "sk_Ox9=*iHC+&Bxic*M=lVE!3qpM=%@O", "t2": "sk_iIvkTAE%?YHk@I?=nS?!6Uajd=9HI", "t3": "sk_WdCO8gNP^Vo!Mp3wFy0XsubtEudH0" },
  "APPO-KDP9-T55C-Y39H": { "index": 658, "t1": "sk_8Q8lEv9*_l9LNT3aE8@KJkH!+vfWj", "t2": "sk_hQcSxNjyTy4n!r_1?b:#5AoSTk*07", "t3": "sk_LI^We3CaCFszPkDh?6sMuc#RF:9*f" },
  "APPO-GTV6-U5R4-Y3VT": { "index": 659, "t1": "sk_cNVkBgCxFXYtK~7F3OU?;mFMqL_&Q", "t2": "sk_ig+WMi9l:CM9j%pr-&R!fw!W326UB", "t3": "sk_xCLeXOdV~SKofN7xFMUk!qLC05k%o" },
  "APPO-KWFB-WCRG-Z8CQ": { "index": 660, "t1": "sk_ONpV:3G=S9ska%p:bkUwR~SnpjW5J", "t2": "sk_ltKTafiIP10Q96n3?7C^g0g9=BIa8", "t3": "sk_8d8548DOkuw8~KVYqSs^C*X=g0vYp" },
  "APPO-UZSV-7GXM-H6DU": { "index": 661, "t1": "sk_8Fp&%htteH~szDL59w=*@dxvh-ueu", "t2": "sk_eSibW;.H@I?EDRz&:I@*aiL8SQUSX", "t3": "sk_x#e5FKGL@ovOqT4gO1_wog#VsnNCc" },
  "APPO-99JD-LDZJ-TPCR": { "index": 662, "t1": "sk_3xGi;:X_hnkLZijQ:pPn&bG8.NN:E", "t2": "sk_a~&V3Y6=s.+1W7bQz0=ExKB?V_H5v", "t3": "sk_g+z53**w_^gh62s*Wb.F=%^Vf=?xK" },
  "APPO-WFCF-UKYJ-W4A7": { "index": 663, "t1": "sk_Fye_4pdrw!^Rt@+XeP7koV:*iFSeB", "t2": "sk_BCs=JtUyurfZO8&#8s=eR~-0CZasR", "t3": "sk_fps@wZ?PNY;u4tUBz#qbN^TAzt^Sf" },
  "APPO-HJXU-F7SY-UZ5Z": { "index": 664, "t1": "sk_nd9x!gjMYRhsgN%@MQb.XUS:q6!ZX", "t2": "sk_z=~+Py25Cwcs5h@E1VZgE5q91?fhR", "t3": "sk_Te.aOQUw;ZRepVI9.BpwWlP59zoqq" },
  "APPO-KWRG-PEJH-K9WZ": { "index": 665, "t1": "sk_nsw3Wk0AurDpAB^=V~oSbqvRDTV:5", "t2": "sk_R5NeSD-hJK_5V:Z7q.QiW!?PPCpe8", "t3": "sk_gQQ5*nedyu88Q1mm=6tD1=C:ei_Od" },
  "APPO-BY9A-TFJX-DNTM": { "index": 666, "t1": "sk_08;nKx-2rf70D90tz%Uvuzn1~4#HC", "t2": "sk_dINCdj3WeOCyPmcWQ.-KZ?#PNWwB8", "t3": "sk_qaXPpnvg7tSgy1P:WzMMJ:5^kGXmG" },
  "APPO-7KAE-F3F9-46NZ": { "index": 667, "t1": "sk_mzd~nn%9XESfrI7#XsO3#_!*^z46F", "t2": "sk_3X0YOdJ?!vEUJ.qnObFz&H:^D?~6s", "t3": "sk_n3GQxdwJ=vS+_LS*Ka6b0uCTXpl~c" },
  "APPO-8XQ6-8K8T-CQ9X": { "index": 668, "t1": "sk_W-C9=R-zVkR+#PUeYmP1#kC.?pzSc", "t2": "sk_3k?5!VxZGAy2X3.t-TkNY7peNlZ!h", "t3": "sk_0-oz3V#vfHkljZ=@m+7U+rxXUXh7O" },
  "APPO-2RPL-LG83-A3XB": { "index": 669, "t1": "sk_Q;YN!SpOuaqni=!DnwftqB;c?^GAF", "t2": "sk_CCt7VB:5wT#2t@#V&a822%-0gn#i1", "t3": "sk_VIu=fm&a*xr4@?-~3L4SU1=M6kY-Z" },
  "APPO-X2UE-P44D-8UZL": { "index": 670, "t1": "sk_PtroX93KqPGgs-sIA9%ZCd;j8jM-c", "t2": "sk_3M==cchV_:kMX1*w@:a1u#zO97hj7", "t3": "sk_xA+gDxQ3ui2#.wD.xyWut.xs37xGu" },
  "APPO-XT3T-X5TU-XSFJ": { "index": 671, "t1": "sk_y?ReawTN:lE=f46c&oSZoHaw;90iL", "t2": "sk_1%E0-!x=oTI%o7UvW^0X7E5Q1H.zE", "t3": "sk_7GS9Ya~F*%g6dg+1mSsZ-@?u1#Pnu" },
  "APPO-67YP-GGUB-ZP7S": { "index": 672, "t1": "sk_n?h1P4jBH?=jt;2.ZhlH=1siCb9Vr", "t2": "sk_O+OCi3?f&h&M.IeD%BHen:.V*JFwf", "t3": "sk_n0PzYCY2LZFQ+BT@EI~9GZ!1rsy0y" },
  "APPO-46ST-5K4G-Z6HL": { "index": 673, "t1": "sk_G-TtmGullg.;FL~Gg_?n%M+@bhEXV", "t2": "sk_0a1q?ArgV=9=u%_q4#aR7h^1?_wr5", "t3": "sk_9b72OU*-p5;45?@cp-PN7-kJ6+n;W" },
  "APPO-CUVF-V7CU-5JCD": { "index": 674, "t1": "sk_6maj?sW+i_G3JoS@rlemLP@D4JIEE", "t2": "sk_oQU8h9eG4tvRAfVs4z@FAU~5d.ppC", "t3": "sk_il*lc;GNcG~b7-Q5cm-vA.Xwh=q=s" },
  "APPO-7NGM-6BXX-63Y6": { "index": 675, "t1": "sk_mHkOq-cMKxj+nR%3l_A%P&kLE2fGF", "t2": "sk_B49h75qHM=OCn6SQzaIDlCD59n~Si", "t3": "sk_CE%y!il~jAcFmZzKL!%6~RCQVay5P" },
  "APPO-ACUA-D3UJ-48L6": { "index": 676, "t1": "sk_dSLu08O@gPQMeZqlMch.MC?!0YQAM", "t2": "sk_Pf;4p@UwmYMqw8DRUsf4i~zUpfVHe", "t3": "sk_hOxb.qdMW?O_mx2Yr:qb4VP2b*LzK" },
  "APPO-W4AD-CJ2N-L9MD": { "index": 677, "t1": "sk_BR8;HBW5xx!XSA7_f?Hnh.MpbST=s", "t2": "sk_W9FvcOUlP3&F35;Hza_3CAtu.#s6C", "t3": "sk_vzYtmS0yl7RFJ3Fa;2AzW@8?EZ@.9" },
  "APPO-GT77-GMTL-YXVU": { "index": 678, "t1": "sk_wxA.niAtyL=Cr.nQw1YKGfYg8Yc:1", "t2": "sk_kW9GgFv*:I8GrG9qykD;n1Aua~qbD", "t3": "sk_2P!fQ+1~RF@^1TnPsL5lMZKKtbfFb" },
  "APPO-F8LT-GUZ7-BHH9": { "index": 679, "t1": "sk_BTy2w8o:&deK+5y%g4C=KaZ~_?Xa0", "t2": "sk_HBgDy%;o.fC@+.^34NLpS@*KD&ait", "t3": "sk_zEdPoV:K?BBSGjYYYeUW4=vM_6V4e" },
  "APPO-ZJ83-AU6J-P4JQ": { "index": 680, "t1": "sk_n!krWawbpUOcN=8XsS.;e7+Vq*?R3", "t2": "sk_1tkZ;z=!45qrL_6VLP:cjWxh7R67P", "t3": "sk_lV0tDlm*rQHYFSR&QXkrMJGoV0AMx" },
  "APPO-9PT2-YRN8-85AJ": { "index": 681, "t1": "sk_r#3rwgjHbyAJXC8HZCIEVs&mN*+eb", "t2": "sk_Mmv@2KKT4%J*3V~*0QeZVFYb%dL0P", "t3": "sk_rp&C6l^&GcD2iQ:9hxD^HZkhHojfE" },
  "APPO-AMTK-WLMT-8UBL": { "index": 682, "t1": "sk_oCP#o4%vdZ9Z:oBL=qsgiLpIetEhY", "t2": "sk_2y78_A-7i%lcs4Y95Lx%aHKEqES%w", "t3": "sk_LuTeLh0-V=Xya2gTpsz1yg!E_jP#x" },
  "APPO-LJET-MVH4-7DHB": { "index": 683, "t1": "sk_Vz#aZ^;.tHjui:@ybrs~xx.%?v:6r", "t2": "sk_WZ@ivU&3eN#ijpciHqTtRYC&fHs1G", "t3": "sk_DNgX;R:d!3MhOvq5GWBns#vV7fIsZ" },
  "APPO-KJA8-YK3L-RN5Z": { "index": 684, "t1": "sk_RLqVMWz;#GnlFpzg?qzj%9L&~_J^S", "t2": "sk_pv?:9Vg1iMsJ?bQ-yD&3j?M16%uNJ", "t3": "sk_P2EHKRaSAm:@G9.MK05Xwi1Z&5lGb" },
  "APPO-GQNK-X7YL-GYLN": { "index": 685, "t1": "sk_F4y7yKgsD.!BdPvNU*LM0d.R%e8N9", "t2": "sk_r%L:l!a!UxE#S.15%;gnZQU;Q;6^n", "t3": "sk_9L2KsJG*vR0aH4Nsq.a_j%B2S%oAi" },
  "APPO-8BAK-PW6F-9A7F": { "index": 686, "t1": "sk_Vug@ZyAOyVer2#6%KdoZ6az%wO10e", "t2": "sk_ZcLc4~NCZVKOx#1R@Ch4OQ#apB29x", "t3": "sk_89o%*6XFjb;LNUfJazf^Wg~krCp85" },
  "APPO-Q3RU-9JQ3-WBMH": { "index": 687, "t1": "sk_B9Z@qCTrG@?tk1!=?a=ldMwBGXl5A", "t2": "sk_2.c^LM*P_L34wo_^e_V4Sg.5Y;DbA", "t3": "sk_wn#HNI-fSHP!e;Ki7~VRAtj608=bf" },
  "APPO-Q8MZ-AY5V-TDGZ": { "index": 688, "t1": "sk_hhs_MG?FV3jtlVkBF-l%OCG7N~?QZ", "t2": "sk_O!neqplK5_xaYo3dJBC5rav_IpklE", "t3": "sk_l+AcarmZCPVjIi;l_Z-w?_nfnsVGC" },
  "APPO-EBZ8-DSLE-FE46": { "index": 689, "t1": "sk_2d1~dF5iT-5RokG3zLP4g@xh-Y~u2", "t2": "sk_U+XC4t7LYrz6pUy2bV*S6kv!MQHgV", "t3": "sk_ulrv=GehZ&EKr+!^4XrR2q6lGP*xM" },
  "APPO-PYBV-UX8Z-ST3W": { "index": 690, "t1": "sk_kqak?yu;aubAf*Dh.^W9vpyNc&FzZ", "t2": "sk_3Dfy*9c4=hcy8O4Uh5:I2Pk5VVo@o", "t3": "sk_Pu.#NmLyQUT9TfmxZd8cUQw^0Zta0" },
  "APPO-48N5-54ZP-6WHP": { "index": 691, "t1": "sk_BC~sCpFsVi%#ss7guc_%TPczlb=ok", "t2": "sk_CO*5c240y#z+m2#7YO#s0J?jlVo@b", "t3": "sk_c~2WZN?Dp4;mJ#Xfel~aGXpI&+5_4" },
  "APPO-6PWD-T2EG-9S3W": { "index": 692, "t1": "sk_U#1MKOfvuM8qIs48Z-qlc8n*r5zcQ", "t2": "sk_XkcxnK3&G^M@QhW!ykeeWS#2KRpO5", "t3": "sk_AiRTEN5w:YM3OI:m-SY=P#eVSZgS9" },
  "APPO-AX5T-8MUF-ATTF": { "index": 693, "t1": "sk_YKusP3Gi274I6-fIo4z9Mh7NyV#jn", "t2": "sk_3#Vt^%At6w1cFwR~Fe*5gt.yJ!QTT", "t3": "sk_FR:nb4.9wXI=CfnX%Ek9v@Y3tn=lT" },
  "APPO-RA3W-H4Z9-7Z3J": { "index": 694, "t1": "sk_syprfaC@+gdeV_a:JPfok~6F8q-DN", "t2": "sk_vn@ZH4:cc9h+UndG;TZ1hK6gjDK=f", "t3": "sk_avda4eDmVlD@XBJ5t%#Vzk51VBuxM" },
  "APPO-AWG5-N69E-UTP2": { "index": 695, "t1": "sk_Xq6_=z?8.R3DmYXtYbZjK+uY.Fpzg", "t2": "sk_hllGt8Hj1Rf*VKD;kQ5Jlnmi-O9~B", "t3": "sk_X5;PYfku5V@YT2EVZ_HcFd~AVM?eH" },
  "APPO-SH4U-35MV-Q9R6": { "index": 696, "t1": "sk_T+SV&mBIY6TkKKqHh1jYIC1TX+J4x", "t2": "sk_N2=14hUY+J66!Q@ngQ&?BGTA;*&Z3", "t3": "sk_WGHlXr_JWbN3D1pG%YEXniM1PrQWN" },
  "APPO-JEQ3-T29Z-V8PJ": { "index": 697, "t1": "sk_QRV#cgYH4~*mvkZn33tE^RtIA^8R8", "t2": "sk_CQJGq=No#agn*QMTj8NIbO9UbU@!F", "t3": "sk_nWk2aL;r7zs1OJsBIS3EUcWbP~D^C" },
  "APPO-DBQ8-SD4D-GRY5": { "index": 698, "t1": "sk_HHp_MVk9j^O-mion-Zz*NdY:8D;.d", "t2": "sk_V5^jTfwrJF+YKudQy3CimW%VdLn1u", "t3": "sk_NDrwaihPm8DLvZ?AU1l;h.OzZX!3q" },
  "APPO-KZHK-N73E-XPLQ": { "index": 699, "t1": "sk_zvQ2DD36m=pRX+m.HdBO^eei2Rct2", "t2": "sk_9.vtxcPdYnodlVM-9W#k@5ktjGcBh", "t3": "sk_zrob~4yKYGtI8r!hW51Z+HWGrUAOc" },
  "APPO-9V4X-N8TJ-A4H8": { "index": 700, "t1": "sk_b5~voL6khE6gSsRCaU.dcP4Tg4I5V", "t2": "sk_NIv90fmV-E-rn@Ru8e?-M%UOHQlvT", "t3": "sk_Pvg;xsv!so7vsy_jXF.cDx4.Ys@P5" },
  "APPO-HNQ5-JLXM-KMXP": { "index": 701, "t1": "sk_fMiBG0G2aaEicYav5m@kP#B9ffzCe", "t2": "sk_sI%L!cv~l+52fYk*u4XAyw:r3ECvY", "t3": "sk_66QW7%VEEGZ#a_f=I?Ol;%qX1Jns5" },
  "APPO-T2AG-VYJW-CS4D": { "index": 702, "t1": "sk_Y1!GxvKxHx@:Y7N&-1HiDl~^H*sDB", "t2": "sk_e:BNbmh=Be%IyqppnLP+mTyvEkJPS", "t3": "sk_kevrI~!=xXTEE2M@dQuPm-K&dOCNk" },
  "APPO-MM7H-R847-PXC4": { "index": 703, "t1": "sk_s4DdHsDr5Z.v=UR1e!p^@::U&Cqxu", "t2": "sk_LBLuhe?2Ripy*C@VwCrt5Qx9naQu7", "t3": "sk_C;obvd9+nBh+W!6utnj?8RQZr^*iL" },
  "APPO-GRJ4-BSMU-GG8A": { "index": 704, "t1": "sk_GV*I9:!+yHMBJWomu3FfG;G0VT!1h", "t2": "sk_G9ccywM;Q4IJjL;ww;IC0~fyu24GD", "t3": "sk_J+yd;WpQxGCZ;JryFmYbrRJuII%ht" },
  "APPO-CYF4-J697-E2YL": { "index": 705, "t1": "sk_0KX+FZ7Dj_k#+E&^=cO3Lg1LT=A+R", "t2": "sk_RE2P4hoMDzouHTsK#9.zV5y+o66XY", "t3": "sk_hSfZvCvhs3?5sGmxE4aU-2mjv#;?a" },
  "APPO-ZJ8Y-EEEB-QMDK": { "index": 706, "t1": "sk_sFD6r:8RML-Vt*lLjj3gYb;KssRdz", "t2": "sk_q?WxN08FdkXZvdU~^BJZ0m6LFc@T3", "t3": "sk_04%if9BJBQ6E5R.Mz8%*Qqc~0^&6S" },
  "APPO-GDBC-YXRX-9K9Q": { "index": 707, "t1": "sk_SX8+Z&2HH.Z=mNCf*HZo-pIllh!0Y", "t2": "sk_kTISd3cyN-#WB3u#fPwAnh-+i?32U", "t3": "sk_t@is@FhmG8b2^1F~_9hVGIvV8mTZv" },
  "APPO-UFQS-LBC4-A6V3": { "index": 708, "t1": "sk_X+Rgr#W#9BecQnmYpOLHG!@*+5Yz2", "t2": "sk_ps*ZsW&^vX_eE54H?HuzxWklPj.SP", "t3": "sk_v2706D6~ViD3:K_V%yV%+ru~3wYvT" },
  "APPO-AENY-VQPU-Y3DT": { "index": 709, "t1": "sk_g&FdB1~=Uhjo#%rwfqFPY*Fdul.%s", "t2": "sk_K6h3O0!cH@~bjU3pUKmo8GHs~fKCA", "t3": "sk_v4FO8fZ&g-XYppBSRQiOK1.O5.y-8" },
  "APPO-8S3F-NGXG-CXYS": { "index": 710, "t1": "sk_Yrhd%JhTMpu_-XYQ^cJ9bxF_mlJSY", "t2": "sk_m_c-;nZ!V.Q521SIgZ@eBl4nY:to0", "t3": "sk_ijM22CNWU94?tFpARxnxPHDmBkA*6" },
  "APPO-865E-QU8G-SP3A": { "index": 711, "t1": "sk_f28rzcoV*7Jkij722S0mRB??66B2u", "t2": "sk_ajScTKi?TfKPl2T=rdXwIB30BTc+D", "t3": "sk_3r3WLQJ?02Gys!qL0-Lz@WT.vN.wD" },
  "APPO-4DZ9-8ZBC-LSDB": { "index": 712, "t1": "sk_MrWL_8?T_#Vab6tHW1f4!c;Crk3Pw", "t2": "sk_v0hPDk4zLbxlkJXisTHT5Ka!J%7QS", "t3": "sk_NOEP_Hl?AXs8RqaEWs!W:NBl+mS26" },
  "APPO-TNMX-JRJY-5UQ7": { "index": 713, "t1": "sk_NFCv@zo3yxyd3@#7d2!p8y;qZ+%W3", "t2": "sk_jM=XG@5nTGNN1@S9I7%JAAUvabyzc", "t3": "sk_Ig#U0I_0xC8.&:!pdUNAIox1C6gmD" },
  "APPO-JL79-SKFM-XUPM": { "index": 714, "t1": "sk_7uL8MPMD?TUoP4s+OKyDau-IVE1*O", "t2": "sk_1VOXcUS~s;WZJ6dZziJ*-eioPCLad", "t3": "sk_m9XGs#?uMtlsJLnV+2AIwKJA:CpP7" },
  "APPO-S842-7WTT-PF7Z": { "index": 715, "t1": "sk_aQ+uElRgb9J_J!c*DrYF9iCxKve6r", "t2": "sk_OK+v-DzmarABagV;_B.4itBM9kdlE", "t3": "sk_v43Iw#Sy&?:JIERzN-CXUj~l*z@wA" },
  "APPO-2NYD-74SB-8ZMD": { "index": 716, "t1": "sk_8Zzgk5vpV:XG2x4R:dgMFk&C4&c&t", "t2": "sk_5Xf3haZpo.wnOCHTJ#xKCvRm6cqOZ", "t3": "sk_6&Jp;.15l.J;xo08Rl.Yb^yJaheUr" },
  "APPO-6SFM-ZNXH-LEDC": { "index": 717, "t1": "sk_43.GANQ_F+6=8+UcojF^oeyJ6.bDe", "t2": "sk_tuj.cdaPItMm#@Vj@UVG#?y5bgsGo", "t3": "sk_V?2et*:bZg8XWq7N-+:JY-.kQD*-c" },
  "APPO-X5GC-985P-D6AK": { "index": 718, "t1": "sk_v7J:gsf3X;D59~ADOQZLf=woCxzwX", "t2": "sk_Kfh2EX8MDvAt6=tjR!KLWPJXOt7zh", "t3": "sk_rU3d#@Un%W#o.FYLxsB;0hH+5=JWN" },
  "APPO-WFRJ-YYKJ-X4DE": { "index": 719, "t1": "sk_PJu4gii;^Mm5re^F019Fgd!aSy-wz", "t2": "sk_0MEqi@r@qo*CT?A^Bn2r9ts0yAI82", "t3": "sk_3%PtwVvB0gu2zJ1y-41+zzyJ*7_Rn" },
  "APPO-BPZZ-ANDR-YCYU": { "index": 720, "t1": "sk_k4Iu#zWh:m+6Veoe~kfXFw;eOT.kk", "t2": "sk_t7&-v+noEAeIHkBZ%2u^o5dcun~9P", "t3": "sk_ouoX46db;eVujz_5PHPls1^8mN#6V" },
  "APPO-AD67-HB9F-RXWQ": { "index": 721, "t1": "sk_6atCQrOcnng9KXvk-iIGh8.=wPRAL", "t2": "sk_Zsu9c^-a95:5Ho~7?qCO28HSQ-EXl", "t3": "sk_9v9qI!O;*OKD%EWLbi#78xOnMvpXs" },
  "APPO-V5FC-EPM7-HGVP": { "index": 722, "t1": "sk_2F0DK.N1cu_-WI2^^xY0TFZ:qzlLs", "t2": "sk_4kEpav4~UDC1+x8USyHZ@:-^EKg#y", "t3": "sk_B~_C@K#.7.ZWqD30VlA@&fDcfWux2" },
  "APPO-D5SM-Q9YB-RNWN": { "index": 723, "t1": "sk_5CuwqpTnZ5Dvj4rjC9^+YY#q?6S58", "t2": "sk_7CIp!fEBP^m~~X4hln%0Q3BDTx*E5", "t3": "sk_4NkiNWQ?O?2Ck7%S8:#RMb=znF6hB" },
  "APPO-CAPE-STDY-7C8Y": { "index": 724, "t1": "sk_3sOd&qo#*KduadIBjLXQVyX2u^KPW", "t2": "sk_HL8j&.iRWogmrahSAMhnM2=Qub.1d", "t3": "sk_5SkOl7A^Snax?u#AK17j1G#Tjm3F3" },
  "APPO-97LQ-CQY2-DVB3": { "index": 725, "t1": "sk_E@HAo2L*l^-Vr+Z!yxsx0Ti8i5=?7", "t2": "sk_HCnh8EjrP*OPYpCV35IS;O2dWWK%K", "t3": "sk_uy_DO5#IXU3L=Em_Wf:?cttr!?=d8" },
  "APPO-TX8L-K82F-4BTM": { "index": 726, "t1": "sk_OJ_n=E9~Y+SUQDJcJ#f*br-@?VERb", "t2": "sk_iUJ6urjxGwei:3124E3PU2Z6Y-O7s", "t3": "sk_ze%_7P@U3QP#4Zw*ZDD&vCj#dZ_Mf" },
  "APPO-LYVT-K656-CAV3": { "index": 727, "t1": "sk_1j6GrVNGejRur4^!#xm&mG%Nq+S@a", "t2": "sk_L+YHhe8ldZ3!8=?eT7Mb0;koTTmeJ", "t3": "sk_14DTQBGOP0^e#%%K=9ba~1fk+rQKf" },
  "APPO-DKRK-N3Y7-EPJQ": { "index": 728, "t1": "sk_dVzDE7jVo2veH5zP5F#dbF:dDak0Y", "t2": "sk_H~_i0&#aF&Z8quKXLv9YK7yys&2XV", "t3": "sk_ph0_;jIXla:5l:~a0%yt50EdKSv0f" },
  "APPO-CT5Q-BBSD-FPNH": { "index": 729, "t1": "sk_QH^Ih#!SC7QfGZB49bYtwPGY_zvSh", "t2": "sk_J@R16WAJLEThm0bSXx;^OL6~Olbct", "t3": "sk_71Of7cmFQCEmP^ue@pJt?T@d@h#Mk" },
  "APPO-KQGY-9TX6-4WU8": { "index": 730, "t1": "sk_CoI=m+rf7J.IK+MvpR@jT=XD!.Npq", "t2": "sk_KrvCY^VA3MxXrd7*TO@4ok3!_gG+Y", "t3": "sk_MI4AHJp+xxL@Eew9qgo.PVH#QQLUv" },
  "APPO-MX3D-H7KZ-SG7G": { "index": 731, "t1": "sk_R-t8XWvvSXiuYw?V8bI:NIHgjDIyK", "t2": "sk_BX09ND-.WR5Crb0F!8XQ+Azni*jto", "t3": "sk_pFz@m4Sy7%U#n#tyjOpZabhvG-j6h" },
  "APPO-GCG2-3LBV-QTXN": { "index": 732, "t1": "sk_f*k-DOIL^6gPCT=nj+csQ#n7xLa_K", "t2": "sk_r=RLRb%cr*PKkGq.A==NwMhANiPTy", "t3": "sk_vJnq#UxAw#IMqpkpT*+IMb@aF1:2D" },
  "APPO-RRKP-77UP-MANC": { "index": 733, "t1": "sk_Bi6LS~aqrNt^9Uw9LO5~!XiIl~ITp", "t2": "sk_t~ZMYgzK#TvgWkvxzLJ&m+-d#:GC4", "t3": "sk_vRA~~!46PJbHUYGi7QO7jMlS4s0Fc" },
  "APPO-8ZJ8-TY9R-6AKE": { "index": 734, "t1": "sk_d5kgc^M^@~vHTO+*!ebzU5v&cyi*g", "t2": "sk_obp;A@#jj?g42^%a.O~lLPW?0G@Mf", "t3": "sk_Mns44P0VhL06~m?F;w4YI_zOXQk&T" },
  "APPO-HVEE-CNET-LCVJ": { "index": 735, "t1": "sk_GO*Ln_s=%.&FF!M@dgJI9oB8ZQ&K3", "t2": "sk_S0EQ4_?VF@MM*-3xOrI9mBEuCGJBn", "t3": "sk_v&+*O9OTRuBtv.jOW!%i81jeqYi!H" },
  "APPO-RERG-NBE8-MBVC": { "index": 736, "t1": "sk_0;qa2ikc0jk-NIDAMxBs@AKTJ;v^0", "t2": "sk_exgTEw0_LtZ2k@dTa?:XQ9WGYI3#f", "t3": "sk_BqA-BP#ZqlPf:jHq?3M?UrKQDqbhO" },
  "APPO-3QMJ-W59C-5DME": { "index": 737, "t1": "sk_CAn*;X?SlhfzLiHsBew:~-nWSuQAk", "t2": "sk_u8KGkbWM@C:-nj:Qu3YNspG;wULzu", "t3": "sk_IyV#:?PLVHgQY_+teVXs*V5xdpl5x" },
  "APPO-QW3A-NZTT-EK3F": { "index": 738, "t1": "sk_G.WMK~uLB_;RPj*C*JZ4mS*R?lt+j", "t2": "sk_v_-A;Bt~ThJQRRPuxqqwcMMYYB7Si", "t3": "sk_z^4%.=%FPvOa_To+#J+G%M.2lELTN" },
  "APPO-K9GV-EJES-S2CC": { "index": 739, "t1": "sk_l^MiA97#~xa:av+LYdsy5+4!1:BVM", "t2": "sk_be~hbNXa@81;qGMKCBmS_D3mU&DrW", "t3": "sk_JfS8U*=jMuvOx2W4j&-U3R+WgaKMp" },
  "APPO-AFA7-YSPL-VFMH": { "index": 740, "t1": "sk_26IqLR*5j?37o*6;~P7-7E#651VVS", "t2": "sk_8sTIgP^_WJ+B*%d4SZHbt7GIb?Vwi", "t3": "sk_EbRkGLm7jM#:Yp*_quzy:0GBWNv@r" },
  "APPO-6GM2-ET4P-Q72N": { "index": 741, "t1": "sk_Lo+n~xXK2x_yyKm~_@RPFfTSFCSSe", "t2": "sk_hEI+NK%cVIF~KbJEqE^To7m0!6%jn", "t3": "sk_E+;3ikObNg&k:+Omm;toan=J7_YO8" },
  "APPO-4WVF-6GQW-YYW8": { "index": 742, "t1": "sk_D.zqTc1W7wM*Hy1+?WT333V.x4~xD", "t2": "sk_I~W_VKC%X=euRI8HU#-Ytf-H#gSF1", "t3": "sk_fN~R;-m7*d3SPZ!I43xw@l@BEZu%U" },
  "APPO-T3G7-XE57-9H5U": { "index": 743, "t1": "sk_3*f5NPnjWrmOP#wneu-Dgf5r2bQmA", "t2": "sk_N9:D2PopUNuuOW_na=AtiR=#QWtqg", "t3": "sk_d12wmEXgf3wMwpmWwgPOOkCFGB_:T" },
  "APPO-7C7A-45BQ-R3TM": { "index": 744, "t1": "sk_k#_pFjgY9ClqwZDS*cQ%Zx%Sq^Bxt", "t2": "sk_HZ=rGd~EC@LgbIQ!RV4K0DXtw2m%Q", "t3": "sk_E@~r!g-j;=_&a&I@^r!:MmVLw:!EC" },
  "APPO-CYEM-FXCS-69YY": { "index": 745, "t1": "sk_T@:ZBBQEhfm?yFciNUC41j=RywtNE", "t2": "sk_XNNu-tALnt2Lr@@!QrKz!^*zk5Onm", "t3": "sk_0XOSmg&MuOiJUTp8y+RQAel7bc;~2" },
  "APPO-ZABX-ZY5F-TZGV": { "index": 746, "t1": "sk_MprHW0ozBPZaL8YO#!PrTr-U&SQ:B", "t2": "sk_d^ODpZtYa1u#1JDg^0un9C=^&.n1M", "t3": "sk_Xbi2IpBsxpaf2%WFvDkHt!G2u^1LF" },
  "APPO-HH98-T4FQ-QEB2": { "index": 747, "t1": "sk_7#-jErmi4OABV_s9*dPcD;RkHQQ:x", "t2": "sk_foTP4~VNHenu1qAE-!T7I+&o@-xcf", "t3": "sk_OG*4ZDREeO^uZypOxeJw.CG8UGb?y" },
  "APPO-KMLK-U9RV-D2MS": { "index": 748, "t1": "sk_BYOFJ@s+rvBF^aoHi9~X66_@4uG2f", "t2": "sk_1?WG&enBBI3*J~*KM:e!#s3hz8cPA", "t3": "sk_q@c+Lh*0TMVtO_Whib7@xgaNZlWH8" },
  "APPO-3SLW-7D2N-BCCD": { "index": 749, "t1": "sk_CyGVB^S--B-V4KAa#Fwd5lBcr=+BV", "t2": "sk_aVDb8fx**+~W.7bs=PjGRF8rxB?%e", "t3": "sk_qOCWou?~H2l=Te.yj@9%_i;ro?ns8" },
  "APPO-H23J-JC4D-7NZU": { "index": 750, "t1": "sk_uFvUYH6uNo*YjWOwy~xJL!PS5r.PR", "t2": "sk_3!gZpR4:MojU5h%Jnf8;Q#*5QuCBU", "t3": "sk_ma021FfWbQl3^el&;ey6f1RPM#Eo8" },
  "APPO-W4CW-R5BM-4NVQ": { "index": 751, "t1": "sk_t@HQ.B0lSZP4pPByCD:03r2tWc=wk", "t2": "sk_RW0a2LT*U&oL6bL=_b9tO+6k0WA+S", "t3": "sk_d_%xZ#A7m4?AwAF+5Jp*T^+tjmYKl" },
  "APPO-VK7N-CEWB-C9QY": { "index": 752, "t1": "sk_xcvlWX51h4TTQG3ALU85laZcI#R@p", "t2": "sk_Hi%5@X~0Oq.5a0SmqzaTOyGiyKFVl", "t3": "sk_H!u1r4S:^px6sAHio@iM%C=qcvqiN" },
  "APPO-Q9J2-PGAC-SCZE": { "index": 753, "t1": "sk_Kt@8YZveeZO?_+F4=D.fE*RexwbrC", "t2": "sk_cTGTtE@w:8Njo.eSa;Rbe=mahD_H1", "t3": "sk_i@uen59F^+4W0B+5?UVcrqpm4m1&Z" },
  "APPO-9YBT-ZW83-EKZJ": { "index": 754, "t1": "sk_uqTJ^TJ_ZFJNL=%Dc#@sXwtXJVlu5", "t2": "sk_OCCBiAUnHRFUPROv1twKx=;htHAFE", "t3": "sk_4xH?yUg2sqJZGd02=RAlT8vm95sXg" },
  "APPO-P2N7-C3GR-TR5V": { "index": 755, "t1": "sk_SX-?=c;pnxSxXGFK.;NBtbX.F4J-d", "t2": "sk_SN~ybz^XvTZ_;x7&J-+JdfnmQsbtc", "t3": "sk_8BozR;Kj^+R8NvL4cKdKu#?a*M.Rv" },
  "APPO-P8VF-Y7YU-YC8F": { "index": 756, "t1": "sk_6o&XCu&cu-lV3&6jWY!P#U?8oamyU", "t2": "sk_G^h10U%UpXn@z=aoAn.;3BGYm_iYi", "t3": "sk_Pb?~Jfo@AhJNjos.29rzba_q-kHxZ" },
  "APPO-HQ6M-M9JN-MBMX": { "index": 757, "t1": "sk_Qtsg8sZ-TZ.HbNC*yFU8&??8jcR63", "t2": "sk_6jSV%!J_W7I_weZruIuLiC#kl#y&C", "t3": "sk_g94P2?LOJ_p=HERa7V=cu6j~Mi:h8" },
  "APPO-WSM9-42F9-A2MW": { "index": 758, "t1": "sk_AcYFO%06woa~r%IrL_QPh3UkZ4t4T", "t2": "sk_6_IO!7N?p31BN7V4%t1r+3BI:uP#L", "t3": "sk_5G;kn7B:o#V?D49B!G=icuYCPgm:l" },
  "APPO-QCYS-AD2N-239S": { "index": 759, "t1": "sk_3QA.3nkQncPGRNdj2OI=l7Nc?8@zW", "t2": "sk_Iw1uE+R;vvV+-@A6J-H@x3K_MhiZX", "t3": "sk_c;PHU3H1blhLJ;:;dmP&HKRpqp?wn" },
  "APPO-4HMX-QK7E-9JCZ": { "index": 760, "t1": "sk_A8:yT4KAJV7xr2L=T_Pds=If3OWzr", "t2": "sk_nAHyhk?vuO8z~lYr%#ff@#;oXN+yG", "t3": "sk_8oDi%LeT8pntcThPLXYDTmhK#nx-P" },
  "APPO-8Y86-JDLF-F4M4": { "index": 761, "t1": "sk_E3JPWbslqXCDD@iZ5z!L^?kAImOMZ", "t2": "sk_jk^:_i#*x4sO~*g9xub08=k0z*-WW", "t3": "sk_Y8!s2oZ5n0I0cR3j~RuW*wUCaLtTm" },
  "APPO-AMYB-NC3N-6227": { "index": 762, "t1": "sk_40OD:0zq?iWthK*+:KQSiHWFRzOLT", "t2": "sk_1z4F7x~VO;kE@zYmmqeCi1EkyEx5E", "t3": "sk_RFM;+c4:Jc2:btn5dF0:1&FW~zN7I" },
  "APPO-U2AD-ZZC7-NETZ": { "index": 763, "t1": "sk_pKzYx18rlEfzBxtR0CaAJq=~Bd7Xy", "t2": "sk_wcsRf:u#tA+QIhh3L0*PzJBkbhrft", "t3": "sk_T60fK^VEzKNm:TRpNuOsKn3Z8VM*E" },
  "APPO-43QR-GGZQ-QPYL": { "index": 764, "t1": "sk_yo_O:&pwlsIt~PfH;cFNQ~YMrz~JP", "t2": "sk_6b9ptZOF%PeTa1MSog*eV9czddApv", "t3": "sk_cOGH:ral:-6Brg-#r~+4q.8b.@DSX" },
  "APPO-M9ST-J9LQ-G2UD": { "index": 765, "t1": "sk_n9STWXkw5rr5cyQyUEi6Me-Gz-Ufs", "t2": "sk_8xn+.aoe.E1kz14:D01UHxU&Uc=Ux", "t3": "sk_AhZh_oHKf3e;R-3oI@k^:zAuemJsX" },
  "APPO-FXBJ-YQYD-D82B": { "index": 766, "t1": "sk_OJU-Gjr@;AmS=N7zfnUwrXcFt!o;b", "t2": "sk_lZ~n_35hdd%b&Pd0BfSq5#M-?izf9", "t3": "sk_knTJF:0;a.-d.#GS8ah%pg=0rD.ov" },
  "APPO-CE4U-JFPL-8U84": { "index": 767, "t1": "sk_Y^#YBZ@OiIG?bxh*X9Vwu3*~a.lRF", "t2": "sk_47N^lOWh^p0YZE*Woghc+BZ3~9TW2", "t3": "sk_RkIV^5Z0K1HAc.cDhLmPrQjo?6K~V" },
  "APPO-QHXE-6ZY3-XG33": { "index": 768, "t1": "sk_I:oQsJ#Wynf%G_M98G2GS1y;-hwc9", "t2": "sk_kxPw_TdN9%u9fOz:1s-DM*7q=0TfS", "t3": "sk_75njzwR?NkrAk&yVXa&1XiM:EQI@T" },
  "APPO-P7P5-KK4V-XGS3": { "index": 769, "t1": "sk_27=LQOUN7c&-Yr+ax3XxHg*vmJxBi", "t2": "sk_MO-7a%NeEJ9Elt._+p_b?5SiNJnnC", "t3": "sk_W.I%%apEmAxXrlWbd:P=:owMdF0ns" },
  "APPO-3GFV-GMDJ-UEBV": { "index": 770, "t1": "sk_g-!Yv8*ss+lXDQNMNtp8l_t7GZB5l", "t2": "sk_G=RCODzZJ+gZ*iAxRhAS4E_HJT^vN", "t3": "sk_r@aTlE-d0y966*rRgS2NuQPgs^V9g" },
  "APPO-ESHZ-82J3-FZ39": { "index": 771, "t1": "sk_0KpgiD.bkH-#yE;=TTrxr*W!ido@g", "t2": "sk_5rjqMm0-^1+I@Rut9~oHh4GH!ho~v", "t3": "sk_BIyxt;u-d6%l*c6J?C1q=YHxgf=rJ" },
  "APPO-3A5Z-D4JM-YVVT": { "index": 772, "t1": "sk_HKeD2=c#VU^wOCxZy4r*!fBgZRCxP", "t2": "sk_JYDi.r5oGq+I%+Qf3kx79P*AapX#R", "t3": "sk_W;^!1~?vw;4jC@.Dy^%dW-^G~5-Yj" },
  "APPO-954A-EDTB-M8Z9": { "index": 773, "t1": "sk_KKS19elMY1eu&7VI.!locqe=rJ!Kc", "t2": "sk_Qd0.L_Fwcw+~PsBRSBL%rrk2dcXPq", "t3": "sk_d1qWR*?@GqwSeg4h.FSge72HqlBZV" },
  "APPO-AS4Q-UJ6A-ATAT": { "index": 774, "t1": "sk_fZK@5WCOwhEIdQ.HNU^Z4f~YeK^EE", "t2": "sk_o0?krR9mtZjBrM*KjaiuQy:!WCpqp", "t3": "sk_c9A8JbHQ7olZGP2Ek.5fioP_t@=oF" },
  "APPO-UU7Y-43MK-5DQM": { "index": 775, "t1": "sk_xl:7GPdGBg6&MMaHEfAgi6?do:YCY", "t2": "sk_aRUJYFBQ:5M8&rRbmU3qGk:WjhJ?c", "t3": "sk_KA3&RvD+SXa3-~cT@R=YBFnHx3LQP" },
  "APPO-937E-4N74-3WB3": { "index": 776, "t1": "sk_K-zOj.no=bN9cd#H1XHUUi7^1b*BC", "t2": "sk_J#HN4pH~Pt5BZTKzS!oZT9lDS@=NU", "t3": "sk_9ZLcrB6ZpX8m74coFR7y4miJZTp.h" },
  "APPO-42ED-7XD7-6CQT": { "index": 777, "t1": "sk_wFqw&QB7x8RSf@CY^#*om^pNPzp%3", "t2": "sk_BpKKArcTuds8EY?Nl:4-%1*vU^v&j", "t3": "sk_V~?hJ680FiH6dY%RyRkXMaS6=^OF6" },
  "APPO-N9UC-SRS9-R4R6": { "index": 778, "t1": "sk_svSSHRPAu=CQ@hq%G^+-L2DZywBVa", "t2": "sk_4XKHS7wyYED8e2pp#mpqY~Dy-e#hi", "t3": "sk_WHjg+_y3z09*v*HH^OEl9UGB1zdL3" },
  "APPO-2LVS-GXNS-K9D9": { "index": 779, "t1": "sk_OlHep6GONx;Zw=EOZXIXJ+#_;hORg", "t2": "sk_ELW5:Q7*s6*&CeW5WV%-I@kb6!TAy", "t3": "sk_vLLXdx!c+2h.5^J?LFcoc%hHR.Qfg" },
  "APPO-7SHF-VETU-SSQ6": { "index": 780, "t1": "sk_RI#RN!WbZiM2Yn_NZIxqDDSPfmg_4", "t2": "sk_T8GUq?8N%L?lA0^93lHYYCRwyejOY", "t3": "sk_Z:Au!=KpnnfsC?aiUssvp3FxbDFG8" },
  "APPO-V7E7-GYX3-GCTB": { "index": 781, "t1": "sk_mn8eK;ieY7jh#Hf%EgI0G6*3SUJ%I", "t2": "sk_Vtkye_87lCDPdQ^n_M!T-t%*WndHX", "t3": "sk_O~sGfgQQ!ejvvOH^2Ry2=%Z0eQ&+w" },
  "APPO-W6J6-URY4-DNGT": { "index": 782, "t1": "sk_Ic0gFI*M@wucBd;f_lNxyfAFNp#L9", "t2": "sk_JsJ:^fN5GjpAEBo0qhSuKXjdYUKUP", "t3": "sk_ymWK@m_73v!LuRvj-ey-Z-4^24nBB" },
  "APPO-F6TG-6F89-AGHW": { "index": 783, "t1": "sk_B~=-r:JK=ay=N#WZ4zBuzt-##DXQ3", "t2": "sk_H=CV&lpd&AS_a3SrlcceWs+W_8#W2", "t3": "sk_3_wdHw*0u%%WEtQl=HKTdxvJw;j99" },
  "APPO-C8PY-68NT-KNGW": { "index": 784, "t1": "sk_XhTZJLDWrJynTRSx+A!C7;13hIpfp", "t2": "sk_M@W*nn!XqMpTkGUtSRfZR6hqOcmLs", "t3": "sk_1cI%RBi8l4h9EvHCQi2p.JS3iKbi4" },
  "APPO-4AQ9-22YX-L36P": { "index": 785, "t1": "sk_Aa-HhVK;z*adG7&uNyFGaf6&PYfOk", "t2": "sk_g1c~_:@?X2ojxkuFA3_U:d=%@Nk!A", "t3": "sk_O@p6OT3MtzG+idzVixaLE?ZrBlYLs" },
  "APPO-ZV7Z-9YYG-NKBD": { "index": 786, "t1": "sk_Wx0ubmiZ==rLC!i+gvo1L%PCPe:-y", "t2": "sk_Q7Z6g;qU92UcA?KKcKhT&!.SH;-HR", "t3": "sk_L.M&i.r.q%=nJEF^;wBc6@Z~p*O6y" },
  "APPO-K2T2-FXSW-AL4Q": { "index": 787, "t1": "sk_Hbc^kb!@o_*J!bvl7b9&wheg?BzaI", "t2": "sk_PlN=g.#^GbHvxtlc8M23%W:2m#ULK", "t3": "sk_LZSU0Cg%_ljODU*cP#8cg%Fq=Tzn3" },
  "APPO-MHKS-NWNU-XV9D": { "index": 788, "t1": "sk_z9hA9~lDX*W&qa+rQEVv!wamee#tC", "t2": "sk_rb06cY#&ZzUf+~;7nWmwIWn?LGW3c", "t3": "sk_vpU!so+Am*4~E-zVG6Aaxt*BLrU34" },
  "APPO-BSTD-EQJP-ZNPR": { "index": 789, "t1": "sk_Lj3*r5kCG=%U.leRA*elMOY&46_*o", "t2": "sk_D^Ay0HjJaA!-W.m2dfW++3bb=+wRs", "t3": "sk_7x%Px2gTTwCvZIrN+o;lge6SswM00" },
  "APPO-R6DE-DXAW-53B8": { "index": 790, "t1": "sk_d+%YpvI*6~89vjyrJGM8.RLu1%7!a", "t2": "sk_GfwzE?H3k?KslkCn+ZJj^cM-ulPYI", "t3": "sk_5?bO@b.^7Gd3CGEY30W?3i-rDz7y1" },
  "APPO-BP9T-W8TS-YZ7S": { "index": 791, "t1": "sk_vF2q?Zaj30=0q&9fiMl9.mZx+Ksht", "t2": "sk_JWLcfBE?7FZ:cpyP#mUTX.?0GREQa", "t3": "sk_zc%gq8@Py^:Cl_4m1e~md4eCZArwY" },
  "APPO-AKLL-88BU-QX5L": { "index": 792, "t1": "sk_WIm~HyxK~%X!W5.k7:z_tA&bi.E34", "t2": "sk_n5K67JQe0jcYUL1elXTrnqb6MpQWk", "t3": "sk_rj*yGPlj81K~aXn9@qPy3P%EF~uq9" },
  "APPO-YZB3-7J7Q-98DA": { "index": 793, "t1": "sk_MvSR!0ZF7n9I3!^90Uzu-*GAn+A~f", "t2": "sk_kv+vdEOw#+H:1~_wC+0ujVB+xvA#h", "t3": "sk_29fXTuy_0o085F5EH!vySnN~K@Bon" },
  "APPO-DXPG-SFZC-QYQG": { "index": 794, "t1": "sk_yOu-O:Lt5tWzx39^=rTZMJlv:W-4F", "t2": "sk_1=*mjV8P@~3_I!-JgC*HGYVR.k@?1", "t3": "sk_NbcYRwGqH4kkpgA1&l2ypCn@g?kiV" },
  "APPO-XHES-6B9H-8S46": { "index": 795, "t1": "sk_F72g^Fk-eiJf+u:T=y+8O&M8oo-dQ", "t2": "sk_K4j7B9=erv?hYd==7JSD=4w?&I@0y", "t3": "sk_KL3@6BHFXQb8+B=lODjdOZo@a8RKN" },
  "APPO-347M-LHVD-PGGR": { "index": 796, "t1": "sk_cl&iXA!2K-.pvD!mYsBzRF+7.CwX1", "t2": "sk_gm.xk.P0mAPN@.A&^P.d26SUNn5^8", "t3": "sk_H&s+d5xsELv&W!_j05NylkuiivoIi" },
  "APPO-JXPY-SFLL-YVNZ": { "index": 797, "t1": "sk_Bf~zFzWoMoqKvcP&WNRzk=0^jg6:N", "t2": "sk_d.WpVYeu~VKsK@p#MC=vqteDGs!Mq", "t3": "sk_9o4AwtA&ICFGppEsepW.k4I7Hg9eU" },
  "APPO-QN3Q-3K4P-K7GT": { "index": 798, "t1": "sk_afpRLr=Y:rWz-hE*lDURzfb~ISB92", "t2": "sk_oGM0Kh8lpq*RUOL4dpB7yH2I090FO", "t3": "sk_UO8kpCjFV&u@ff=ZEX-:#Lh7do%Zq" },
  "APPO-SXF3-2PJM-NW3G": { "index": 799, "t1": "sk_jz#kaZS0F9Zi647=vxRMD=@@^@=@2", "t2": "sk_jv.MJI;reqaJ2kl8foVhf@BxO0P1B", "t3": "sk_ww#vM@rt04Qev6DK;1tR4Zurqp*+y" },
  "APPO-393J-MG78-7X3Q": { "index": 800, "t1": "sk_He2FXj*M?u2DhT^YLkiFyAdQ_h_pH", "t2": "sk_Z?uVg2!M*0EkhM!CpUGz=zuH=FbrW", "t3": "sk_mJ%JIRs-RY7j&oMk;^DUrXJ65Oy#k" },
  "APPO-3NN2-3VGP-JEV4": { "index": 801, "t1": "sk_8nyEkR2aKUx2.%fsG:4.D&&q45jle", "t2": "sk_VFJW.Bc!92CG#XpG5H0jfg9?TV-c7", "t3": "sk_1cD-nLw-Sjc!tW69HF+Md2w530EaY" },
  "APPO-3LTF-2ZCB-NRPM": { "index": 802, "t1": "sk_Hy9AO@5TFdXvAuAV&@jOBkg-pKQ@5", "t2": "sk_6l:jb^-1pN&dKRI3:!GOAC*KZp6L7", "t3": "sk_Z4DMv.0F_ryXGcbULk2EYEL2ZALWC" },
  "APPO-NFX2-FY6K-DXV8": { "index": 803, "t1": "sk_hbTlqT9L:2rI-vaPjBX3nCYV8g?lV", "t2": "sk_NWoD^sLl*yaoen?IeG~Vh6r.QLuCV", "t3": "sk_v*y9Pf9PH~9Ou^q*HNa@2pyDoj+FY" },
  "APPO-5QY6-7ZBV-XNTC": { "index": 804, "t1": "sk_3iiscs;wi:yzw*IJvGp13g5ArZ4Cs", "t2": "sk_i8p2_pNw@Tn^jgH&MkpW4.~&Nm!qJ", "t3": "sk_N4cdm.EoI^4@90@xeOSAD@Y:exY&V" },
  "APPO-Q4EY-GET3-VKFP": { "index": 805, "t1": "sk_HZg528;?r0bohK-NRCGD_rBsae;M0", "t2": "sk_nO%*Yc~_R8Tl#7aQ4BiIxwbrH_6z1", "t3": "sk_y0mjxwoKnx-+rCxL!?v4?:.Bk;7fK" },
  "APPO-674Z-8954-XAJA": { "index": 806, "t1": "sk_d2T_LsL?FrOx:NQ3sJfrf%p3x@?zV", "t2": "sk_4SQiNviq9VYReFO_St45Ueqe_u^BP", "t3": "sk_1Tw9EI^l_b9w_60!jq^zx7U;~D~VL" },
  "APPO-K2U7-WRQS-ZXBQ": { "index": 807, "t1": "sk_3.NCX~uJm*ruogFNh6XD9jxMb?d5Q", "t2": "sk_8V3u5bzR!;H3r^_=fK2ob+;.qM%8s", "t3": "sk_sd;bs40g8~41AynOgeNoN:AF8AtvK" },
  "APPO-A8UB-LDVK-VD8F": { "index": 808, "t1": "sk_gnr7kGxyO=EzXVc7ZzfrbBKq?^L_k", "t2": "sk_dmtAT4sLlfEVBc@.Q#QSejc-XOtc9", "t3": "sk_k81pPQIsIalyKdE58?1W.WgUpFScQ" },
  "APPO-6JUQ-A55B-FKCA": { "index": 809, "t1": "sk_hB-g;+ZAMyZJ@4~JJRjDE-hBitlwg", "t2": "sk_REOc8Tph+tFGbOGFq?h1ko#y?&iOa", "t3": "sk_E~IvJAq.zBgNG_H1tn~~w*uVhON37" },
  "APPO-HUSP-X24M-P45E": { "index": 810, "t1": "sk_6PriMgjV:V%%sM?gNnIB&6U-iMW;j", "t2": "sk_SPRl?^=m;ZRHPs?wc2#ydpweN97jC", "t3": "sk_h&n:3eN*I1:_oq#CsJu&0!qN~2jaG" },
  "APPO-D4Y8-9RC4-BGB2": { "index": 811, "t1": "sk_kf+L@%xM2T9Ebcj~RpC4=s%Bj_=qL", "t2": "sk_0A6VYWr-Tt?xWLq9m%v053L!6kKMT", "t3": "sk_EavEyACXGoYu5M@2Rs3VpQCPp.5bm" },
  "APPO-QVCE-Y9FM-8YPC": { "index": 812, "t1": "sk_zBXa+tvEY77;y;PnDvf?__l^JIv4P", "t2": "sk_HA%EZA#V7NNhElLb#X%RglZ39BkKg", "t3": "sk_wQSz.PKc7FGpJq7Kfeo-U1.ZpxADZ" },
  "APPO-4YCX-ZHMN-Y7ZZ": { "index": 813, "t1": "sk_3kS#fpdt;8UsMeXZEZ@H?r!!q86*h", "t2": "sk_Zw-CqXGrQglAjUFzXv:!iZdS3E0uz", "t3": "sk_RwdVWe@UCcnDoT*II#9s_C.1kFWek" },
  "APPO-46SQ-QMNP-LLE4": { "index": 814, "t1": "sk_c*JcoqIMWq615zalSBtGwdl=3q-eS", "t2": "sk_SagXm2=&smIPeK_uOa:GQy1bPH0vl", "t3": "sk_U~j?x9iXYh7@IW**0:9J-fjfwWnGR" },
  "APPO-CHQW-HM4M-2PSM": { "index": 815, "t1": "sk_t&a6Hg5KZ_%1t+b*djSOFw@#aimuT", "t2": "sk_tjRMg8XYNXh@3%IeF_X:!fou+in~C", "t3": "sk_Ze11Z&;-j-Jhw%?way8nyGvPrbrat" },
  "APPO-BQCX-9ZR8-QX48": { "index": 816, "t1": "sk_96clW^5I+.%K#S&DnqBTEb=G3DLpz", "t2": "sk_CynRVHx=#@dK^&^azVmNnn&eyqZdB", "t3": "sk_1a%p=fG_1CMB%rF13R&2NJ.O*KRwQ" },
  "APPO-H2CK-W7BG-GVQD": { "index": 817, "t1": "sk_qE59?3#GvAn_*R1;Itmck3#GGRT%y", "t2": "sk_TWze@5aD@n:mb8*eBhQxybstlszHJ", "t3": "sk_N#rCNdvE%m7%TOf!6:hS*OF+Y0SXu" },
  "APPO-39S9-2H8Q-9YXA": { "index": 818, "t1": "sk_jbvOp;Ewn19nsAv#8q#oSKIFni;58", "t2": "sk_DUkYBiotTwZX4HQ!@9i_hGrIP%6^y", "t3": "sk_e:cG8J=nqLt44UEcJJKzLAMkug54f" },
  "APPO-H6SU-SZVX-4D65": { "index": 819, "t1": "sk_P4e-nKDO=#S-_0PFTvvdsn#~J441X", "t2": "sk_Z8MR%DPEQTmUbwx2bxbWtWvL:Fb.g", "t3": "sk_qqH0GwpIr87b;spwV@Fq%=!Ijbx#v" },
  "APPO-VZB8-ZKS3-HJ4U": { "index": 820, "t1": "sk_xi?4u0?Qi!-_!4N*BU04fDG7EzSPL", "t2": "sk_c~RC%r5ctNrH~H5mmI_Ui*+sd-cGX", "t3": "sk_GX2rAFKh#VZiQym2W%HuTcr2Tqs0x" },
  "APPO-XS93-6RVU-L674": { "index": 821, "t1": "sk_mAI+sH#?L23O:Lt1=FXAd3Y:h0K4D", "t2": "sk_E~v?mt.*9k^y*It6-Cj#9j4k7*R@T", "t3": "sk_gWQwNNbnCD-a8vRdb@7_SG_#DC1kJ" },
  "APPO-JYM3-L4SJ-RLEN": { "index": 822, "t1": "sk_9V:i^iTaCb^hCsj_Vt2CweB=I.IJy", "t2": "sk_By2~0I!q?Jkxed#cX=%CmZUGwW=.q", "t3": "sk_YA%Y9iH^%KqO=M!KQl%08xZT3n_@6" },
  "APPO-2WEW-WX53-YB9X": { "index": 823, "t1": "sk_0d5ti9#OABF?=&DZ_zTBUK4r1dc?t", "t2": "sk_kOg31p1sMGfF1P:1xQkqT4zOvAb@I", "t3": "sk_P.A6uDhP%l+A6=j%rIOX1Tz0%AMX2" },
  "APPO-GLJC-JTWX-QV95": { "index": 824, "t1": "sk_nQM9Ny:Flr?Q_*S&4pJAVgsWRBNkj", "t2": "sk_J2u?7n2HyIHo_y2s4UR5#PZM;zzp0", "t3": "sk_ByLdCUJM?IdiGQLw@^LrGg2l:r8XD" },
  "APPO-KRT3-C7XA-Q9JH": { "index": 825, "t1": "sk_KC@LGWS_TI77cK:Cf=kom~q_GJcrD", "t2": "sk_T7VDdltu!Dj*?=_crHu#B0dx?l^#o", "t3": "sk_zQc1uCr:Ex9g5s?2A;MIdYblz-4ES" },
  "APPO-M2GK-PX42-7E7Q": { "index": 826, "t1": "sk_B==Hncpneh*h-~0uUjR@vV:1CXE@X", "t2": "sk_rCn5UFu=PiODYmGa*Nu=;!I_MidAh", "t3": "sk_P%t0aA1yOQx6qC;S5n:3CcR_vQmgD" },
  "APPO-A5LN-P37P-AS2H": { "index": 827, "t1": "sk_YBnI+DECB!vAc@6_o+KO!OxxpsZtJ", "t2": "sk_RT9r%&X=bU%mV=g!3&QVXx~_1gWlh", "t3": "sk_p5fXMJ^JuBH4SoUzPadB@E5QP09eN" },
  "APPO-TS7H-DRDB-H2NT": { "index": 828, "t1": "sk_gCJ?TPz%^hl?9QL%+uPZ.Qabw4dA4", "t2": "sk_l3XH:zTRiAQd?Xu1NEs%#;Jkz^xuo", "t3": "sk_UunBFKROWnM-jL=T49l-wiLhd9~*a" },
  "APPO-N3BM-Y2VS-WQLF": { "index": 829, "t1": "sk_Hio5paomQxQ0AU_4y81W#J:qu+FBa", "t2": "sk_0JjCV9ce4&wZdVJ9BG#hOz&xCiSt7", "t3": "sk_N_^f.OUn-Tf~6g+CanOVI5r3+daMf" },
  "APPO-5LBU-FPYW-DZ78": { "index": 830, "t1": "sk_tA6HvS;aZhqLBN&bjtmkap7hpb5~n", "t2": "sk_t&J-sufP2*pVdaY6m5vW1ubwvRzSa", "t3": "sk_lJcgCG~GXB?-.86Q0n?6xJjh_*tzH" },
  "APPO-BCZJ-XHNR-67GB": { "index": 831, "t1": "sk_o6d!elhlVVzdsM=&;mfc%e+rYD?Ar", "t2": "sk_LQZG1s^5P~x.Q&HA5Ov.h@&FbtEEQ", "t3": "sk_nWhpeO=INl7vqgbNvE5AV+TTErwDr" },
  "APPO-5RYQ-QA3G-9XKV": { "index": 832, "t1": "sk_tW:l9VowK-=EUBDg%B5u~6Rnl!trm", "t2": "sk_kAl?-BjKDHRI+iNqqBKm886E7d7:t", "t3": "sk_PT;g4@axzE*qX.K.VCA9iue3h6i!U" },
  "APPO-4T73-KDTW-2J9F": { "index": 833, "t1": "sk_BhHuD8Lx6o^4;=pPN;cLcIIbxnT=l", "t2": "sk_IfA7Gv##3j23Z7:bcHAcGot%wDlYv", "t3": "sk_hkTL=imH2VoQExVVydSMJIM:7B*ic" },
  "APPO-CZR9-9YAJ-BH4L": { "index": 834, "t1": "sk_cECt3VAM7MYaCI&^u6#nxrTUwDp26", "t2": "sk_0zV9&%uEH3=-xX*?LesJLLvSCnwgy", "t3": "sk_niwS1:BT:u#QNS56CHT4QYDW:dhao" },
  "APPO-J935-26LK-GDNS": { "index": 835, "t1": "sk_LWyDnTE~up3J52Ki+m_PQ:43_:==D", "t2": "sk_H;lf#p@JA.W*Zn:^eQQiTwjx2oliT", "t3": "sk_R:^ZChhlfX0mgb@rBU5W~&IXWXKV7" },
  "APPO-4Y9N-LSGY-YTGY": { "index": 836, "t1": "sk_4.IKt:_+.!F5c_-@*dDtUP^N@ITwm", "t2": "sk_zBRO2w&o?sJiIjqqi^.f!b^Rf.6yz", "t3": "sk_qBhkbD~snrcpMhV&w8_hs=dr~EVSb" },
  "APPO-WGRP-UWK9-YFRR": { "index": 837, "t1": "sk_4l#NyG@9Avw69XQn~vQB*1e0D.J@1", "t2": "sk_hKgHR^_NQUSb2g3kE%w2Xy!4aasmg", "t3": "sk_ztyr:6xLi:d3~w5=oKPIKPa!U~TzL" },
  "APPO-P2LU-6NS2-PGZ2": { "index": 838, "t1": "sk_idE-Dc*4k?E;PaAsJUoeU?eiR;nuB", "t2": "sk_UyizsGMBSmLppJ~EogPrZwbceVoWB", "t3": "sk_oPs_+Y!2^RJ;@DM^5sez3+ke@GVk5" },
  "APPO-NZMU-GC2Z-9TW6": { "index": 839, "t1": "sk_j&-4rx%aQlYJtM!96McQnxIP#W3wQ", "t2": "sk_PAi!rAvFW0~T@lW1WqxBxiPXGwN4P", "t3": "sk_Rf:tcRug63;F=_spa_e%O_=je?CLF" },
  "APPO-S46E-W3GS-ESHB": { "index": 840, "t1": "sk_dUQG;N^0:rLJ4&#T&ro0=M~:zm&GF", "t2": "sk_MnX5t9?UG4o:CYA*;UG~jPnSeFFx2", "t3": "sk_dYYLEkBcA@jLX7Ek+kM2YXRqi0J.S" },
  "APPO-SJXY-FKGJ-9VU2": { "index": 841, "t1": "sk_8.z+d^!4&S#+qq:H;b3+6J?1Jo.86", "t2": "sk_5%0?@!z*aU4^%DWo#jiMxUH*VZtu0", "t3": "sk_n:UAiSY#r?HJgwMd.KMQfAZ-v~#Vj" },
  "APPO-3GSS-PTDR-KC8U": { "index": 842, "t1": "sk_T9K0hGQIG%8N2JBRUE=2VWDhN8rJh", "t2": "sk_B9h:zYgq8c4so+-T9F31OLQLze*pA", "t3": "sk_vifp&XQ3-dVb@JQSD.-6jmAmug*Lz" },
  "APPO-LBA5-UR88-FVCD": { "index": 843, "t1": "sk_U1^M?!xhf83q=XY*x#=^G!19YR!2W", "t2": "sk_F#Sfwn9op7+YdJlVA35xpxr!lN7Pi", "t3": "sk_CrGx!@*ax&-;_7mNE:5RlW+iS^4Kx" },
  "APPO-AV8E-7WV2-8KCL": { "index": 844, "t1": "sk_KHluULQkXsS:443jp:2aoqTL=CHpo", "t2": "sk_NQKO%O#EJ:P@PL.~s3PsQ^o?U?s4E", "t3": "sk_DvaFQrMrL5=5XuV1=NMOO!%#1=OBH" },
  "APPO-CRUK-7L6S-VPY3": { "index": 845, "t1": "sk_dt-J7#;4WeL55Aao6WRQULLZ;wNyn", "t2": "sk_4H!VJ*Sj4BXf+G_W?n0M2cQ;yib7E", "t3": "sk_VXz#Ezc6Q!y3dmSNIw9dBW5U^0cbi" },
  "APPO-APRJ-9V6J-KRU9": { "index": 846, "t1": "sk_Z4r=&8GGe16y6.&ZvTvq-emJr%j.H", "t2": "sk_XbW*=gtZ1MImgIzbAqclWWpGY#8*c", "t3": "sk_q26?6a:8-e@~eg?f+Tcg~WY;9oKsq" },
  "APPO-3A65-LZ9X-D8C3": { "index": 847, "t1": "sk_S_FoDn@N:;U!rXol=&aGiOk9E%Z2Q", "t2": "sk_YD_%.T*Ga5eYsxV59lLRcBg7dStOC", "t3": "sk_2N-dj*%b;KS.1x@&Ku^MSU4k~I;ey" },
  "APPO-4ZAL-EVMJ-V3YK": { "index": 848, "t1": "sk_ileFy0wOPr_.=fjq;2wy+i^!EC-!8", "t2": "sk_Z*_We?+^FwOSOB%YIwvN3*P-E_NAi", "t3": "sk_V7pk5E&D2_tvcAyDs?BZ?l#Cm;C9I" },
  "APPO-64SV-4EXS-TGEL": { "index": 849, "t1": "sk_nTXE:lPKiHr&:AFSLM^x1_R+p.a=l", "t2": "sk_zKb0Y6Cev7xD_q?9Zj*?KxrAfB;Qe", "t3": "sk_R7W-9C9&&8zFbeDHxj@RI:?:^2JZH" },
  "APPO-A5TN-Y8U7-RALN": { "index": 850, "t1": "sk_X+Ljl!t%lUcdN_ThO9:mN=3DS:RII", "t2": "sk_xj?2x_m%pFOdUpnbYKEbx@^h-d%0J", "t3": "sk_C6gn~&R3j-wVbegL=*W40KU@;;;cM" },
  "APPO-R5SL-35V3-F9AP": { "index": 851, "t1": "sk_H*!YPQ58Mym?a-XVq1CRO?+:=vO~C", "t2": "sk_y:D;c6V9gn;5nfFeDGm8HP9q5FN%X", "t3": "sk_6Op+7.?zN^WYYVdWUuiJbxp#KQwIw" },
  "APPO-8TGT-GZ3Q-YZ2X": { "index": 852, "t1": "sk_grzfIh?Bi.kuB^dO*k:t1w%;XM:Mt", "t2": "sk_xkIPZ5T2i#++97Bpi~EPV^IpBtNxh", "t3": "sk_Sgknngjq4#5:nUoLlbsQssCBV%d*G" },
  "APPO-JXG7-R48N-RNRQ": { "index": 853, "t1": "sk_Su4*e6jm&ANeBfnwaG0Lvf5sI5d6O", "t2": "sk_H!1a#?JsEcKdoIR3:Iv^@81~cu#jh", "t3": "sk_hxa!Z?z!:SL&I05E+%a&9VVPBQd16" },
  "APPO-53Q7-WWTB-TGKV": { "index": 854, "t1": "sk_ne-cK;aoB6=t#i5QZYf~=#AhX-u2O", "t2": "sk_CXn2~FBZBHzdYvaUN6Na6;1Hp6hZ4", "t3": "sk_8c2bGZE9?.~NxDHLDk252x@Rf1Icb" },
  "APPO-7JGV-WY9N-G5AV": { "index": 855, "t1": "sk_vf#txnQbZv-gqL52q&HeY!wm_S=V1", "t2": "sk_aSDsI^jE9wQXfH.Fx:mh_^lGOuYlC", "t3": "sk_E1j73pRm1BIOsuxu6_u-r32chcjq6" },
  "APPO-VYRM-KU8Y-YG5R": { "index": 856, "t1": "sk_G?6ADTomGJf5%c_dLYMFLx67KnuGW", "t2": "sk_AADHEUNtSA#LVlUnxcD.GpaHn*JcE", "t3": "sk_Qr;zT2CWebXFzttGDNiBu4kJ&nO+n" },
  "APPO-WNZQ-C7AL-KRQM": { "index": 857, "t1": "sk_JIs@VHkw-cA_G!fh*KB!yM9vxAl@n", "t2": "sk_p!IVBUWjrOTR3dAbj_iOZVNLOC;.m", "t3": "sk_B@#R2WASG5G2~F;pC7B5B+Lj@u~nB" },
  "APPO-FSSA-CFNL-42BC": { "index": 858, "t1": "sk_ftXVV%;pm*wZ_%YGYng60JCf@k5VH", "t2": "sk_W8tnI?Drd:D3Dvw;8ID0^k*m8GM?f", "t3": "sk_PnM*Llo?A3X?!cggm8l.qfSmpFQsA" },
  "APPO-D23N-VLAU-PTRM": { "index": 859, "t1": "sk_g4=mb*OV#Mv~Q.1^&T?JShdM%1DBt", "t2": "sk_l%~r7OX2Z0_0&tEtiu^KIMyPV1Z?E", "t3": "sk_QTS:V-%lmlTJcP^x&.8EvyEfPY?vd" },
  "APPO-VKHR-L2WU-YZCZ": { "index": 860, "t1": "sk_ri9Xq.OwU0c-kn^MaB?VpX_fGz1yL", "t2": "sk_j:p:-O9gl*@1K++RG^7XOM%^@xW@e", "t3": "sk_shG+us~t4p!*q#VY*blwV*2;NL=9i" },
  "APPO-V43R-TP8P-2RWG": { "index": 861, "t1": "sk_UXE;4OPHgf~Q4L_Za7Zf=QWVYWp~1", "t2": "sk_qAolAU!0a~wjS#ai2^#16XQIRwrwZ", "t3": "sk_5FO2%;SvW%98wqVaDi-rJHrOF:cUa" },
  "APPO-AT8D-6DFN-EYCB": { "index": 862, "t1": "sk_Oy!P3GFX;*Q5qIn^i+4pNiajzUpQY", "t2": "sk_L*P.WPs;9gtCuLx?DbhX?e6s8#7.9", "t3": "sk_93.0Nz.NtqYEu3To-67PVnBWe%?b6" },
  "APPO-CMDP-H5UD-PW4N": { "index": 863, "t1": "sk_nLB@jIjjlxVu@:fdUpK5UdPMF.EZQ", "t2": "sk_E5pduT:qA#&9VVZ6@hTAPvVcEcaFj", "t3": "sk_nY9:ajNZHE4t3@NUvmsZWJz#U4jyl" },
  "APPO-RANB-DWKD-MGAZ": { "index": 864, "t1": "sk_pC3!R~?_OA!.q~^wRQnNWJf~*W8kJ", "t2": "sk_nBhO?WQtpc7VMz1ca.QgefxOv0YX6", "t3": "sk_V7*_XYojFu0u9rOvoe%zOo!7g0x~s" },
  "APPO-VLUY-XXZM-5D5E": { "index": 865, "t1": "sk_mTnH~?LaJ&rLS=-8oDDAeRb8Qh:.h", "t2": "sk_5lw^Kz0TfL9sAGxU8=mvDwdR-VcQ2", "t3": "sk_tNrljnXJ70w69V#_DcOP_O#bHgDc8" },
  "APPO-9UG5-HM7A-4NJ9": { "index": 866, "t1": "sk_msZe!BVGhF2.^fKgV0v#maVRF87gj", "t2": "sk_6.K!QcHIUrj+!HLF@ty9?j2nNlmwe", "t3": "sk_4B?J16-dUX080JkIsb8:Da_!hCymr" },
  "APPO-W4VY-TZU5-YV6S": { "index": 867, "t1": "sk_CwxQKvFvDIJkMfIWBh%qpU24;3B.N", "t2": "sk_j@NwuiokY#5-%xMB9soKi;H;:-h-5", "t3": "sk_9N.1p^No=?@dNx3%YRmiX%KkMBoqK" },
  "APPO-EJUU-XB7W-58UX": { "index": 868, "t1": "sk_jnJ9ZddCI.CIBUYqDHT88WxLKTh%l", "t2": "sk_cp8zV2woVPxk@h;5;L*2sOIUdiHoi", "t3": "sk_Mgp3ii7Iux:f!1a.aMH2UpIcp9CC6" },
  "APPO-ZJ2J-VARR-UEPX": { "index": 869, "t1": "sk_Re0LpET:N1.DV0P:xHk5ci%zfn&;b", "t2": "sk_MQA!dJ_v@=OHXYTp?Zm9Bp8Tkym#N", "t3": "sk_oDqI5C*@l2ZS;D2@xC5q0~kSIUwfG" },
  "APPO-FFPZ-SRQ2-ETUD": { "index": 870, "t1": "sk_eN_;0#1F&odaYxI6ep_ZhN;LN^JiD", "t2": "sk_9g^@8f=82vrXuu%WA+DLa+IG1qI3k", "t3": "sk_G56*z3c8I=DCh-LxV:ryo4FeeT4Cx" },
  "APPO-3Q4R-YY3J-MKS2": { "index": 871, "t1": "sk_t+c0R+#;CCi+axZr1+2sh!CfyUn66", "t2": "sk_9QBH*5;c8PWSrmsSf%vFV5OIP-I:P", "t3": "sk_XoDQCf9Ld_0j5p9cQpiZJAXqbJ@%E" },
  "APPO-V5YP-NHQQ-8ETV": { "index": 872, "t1": "sk_KOfISCMe0Ch_POo2NydDXb~zuWyaG", "t2": "sk_ieuy8?zJMykmA:rZU3e7bRr0JXYJl", "t3": "sk_tUCTY:V:jD:ztY07ee=ENLLeIUe+d" },
  "APPO-VX79-WLKN-E89X": { "index": 873, "t1": "sk_pQ#U5aUxeyLbY_.kflFE_Q62ed3A9", "t2": "sk_pKjf@ohg?v^;KdqgjaF&&*FwVafxv", "t3": "sk_QMZ!dUKNNvKOo_!;?fO3q5vm-LgoZ" },
  "APPO-MVU6-UTCN-AU59": { "index": 874, "t1": "sk_mfyX;kvrjJ:PmRi#H_%qfFmw!BURc", "t2": "sk_XoMQ7OI*Vf!p0.-kONct5RrM6IP=4", "t3": "sk_GKV*MrPc4K6BiJvyBbA6iL7G_by5w" },
  "APPO-566V-NGKH-D8X7": { "index": 875, "t1": "sk_5LKpCa5yT^.AJqWmrD1DWcjbmNhjy", "t2": "sk_7Ru47i?oLEVd8JcqcKU%+%tWNFKzK", "t3": "sk_52TmzFKI+7iFMpYIBODa%m&EYzs*d" },
  "APPO-S66L-4AAM-VD7A": { "index": 876, "t1": "sk_GcmrTDB-o%ne1.v=^ODQDckpc:j=y", "t2": "sk_L9e1OJ?7Oe1I7Nv9Pet1-@bm:@pZM", "t3": "sk_S7D=68Yt59!^Zbl3dc-Q~~-2b4b?D" },
  "APPO-882U-DSWG-5TTH": { "index": 877, "t1": "sk_aFd;pA-Llb6&G3.z-rDEH6^MVx;Yw", "t2": "sk_lxT.GrH3u-lxdTn1HJ81jsPRLd.VD", "t3": "sk_MMK?#+r1W?M7PfbP9~D:QR!3OY%#e" },
  "APPO-LNNU-CVG6-SW4D": { "index": 878, "t1": "sk_Z19J7OJD%9xRgGCqq-W6YY2KmHNLH", "t2": "sk_aUZoH+i7jokxB47x5O%bET^KAzOqL", "t3": "sk_ffJa5aA;JTv1AJ31#3cgYx83_TpHw" },
  "APPO-CZUF-GF5Z-D6FS": { "index": 879, "t1": "sk_gC%uRejQIwrX#YxVH0@q~r*0m0+Bm", "t2": "sk_oiD_WY+HVd%cvpCQIKoO=!ddkESdh", "t3": "sk_qNlInx%=K3tj1ctdZENgMK2nA7Vn1" },
  "APPO-FUQC-QP62-A3H7": { "index": 880, "t1": "sk_ps4g8M~TRaT1GX7AUiB%U1.gLg+XR", "t2": "sk_Rwz9qBgECW6Yd0q@7Kyed?nu4P.f6", "t3": "sk_5+pNN0oipAcOUZaA5i:uukn=GrY?y" },
  "APPO-KVG2-6KDY-CP6X": { "index": 881, "t1": "sk_i_XBDfbB%PQWE?:ifEt4A1gBWM1CT", "t2": "sk_ZY_PwPOtJYl&MqLN5;w+5!v=@Tk*P", "t3": "sk_gsHW6%aLNtnyqa?it4=%YR=h.e3@Q" },
  "APPO-R95W-LDS3-LTUH": { "index": 882, "t1": "sk_35b+gz=qt9:V?w!JPXLocGEQIWN.i", "t2": "sk_gjQ:CTGG&coZbu+QZ?FI3*^QdcYqj", "t3": "sk_xUWJ-?eXp0hp*wOt77Bv-JM?s+WKF" },
  "APPO-VHQR-QG26-9AA7": { "index": 883, "t1": "sk_w=~DnZ_;VqN^!o30LZB%YkiQq6r.v", "t2": "sk_o-9zYPrS8^9SRkh@HRG%sTTGg;j*3", "t3": "sk_dlPW+@&_M^qYwgpsXhoUUr;ZOq-vU" },
  "APPO-FS4J-8LJ5-JZL6": { "index": 884, "t1": "sk_NokR-uz^~YRyOEV1x;Jh3EG8Z18#h", "t2": "sk_F6TmzEuW5ZWPN+jgq=Kv9g!SJ8vTi", "t3": "sk_v1sW!+zYHH?rJ2:O^l_Jk!cJ0DDGo" },
  "APPO-YTP3-HN4C-FP34": { "index": 885, "t1": "sk_9VEw!Ud4ATBb7zZ1rb+_dwDJcJ&*h", "t2": "sk_0b*2o.Q_R-2TV-@9IDuJFdC7~gc_5", "t3": "sk_lqKTy?NbR:mr.aOPXwQ1.:P=@ec#6" },
  "APPO-9QWV-RL3B-87QY": { "index": 886, "t1": "sk_w&pQSqAf;-KYaF&iW#8a9+%YdL:=A", "t2": "sk_F~VaWFT&_16Ar:~;~zFz!!&0lGL7K", "t3": "sk_2!v:_-Gzswa?YxG&o3KkH!HE0Qo7e" },
  "APPO-LZCD-R2S8-ZDCB": { "index": 887, "t1": "sk_0A4@!p7:zypU2a0xJdkFP5vFuP:3M", "t2": "sk_6I3GYbvIcBu6bAqUQ6d6=7R8MKMw5", "t3": "sk_VM8zf8_Y3-wU6QCI&1M#N?5vk%M%c" },
  "APPO-9BQK-YSJV-7TR5": { "index": 888, "t1": "sk_nyRI1k1J7dosTHk0y#D&oks::zGUq", "t2": "sk_yg!tY*VE@aYtsIqbwbHwrE-M%g7ts", "t3": "sk_87sb0DyeFa2I1QlL0os6^%yFS;HF5" },
  "APPO-4MC2-UQ2C-TGMB": { "index": 889, "t1": "sk_0INSAgO@lkavgQ=WNB~dfUMdBBo6n", "t2": "sk_Jm-B!#upxo_?rATF2:jCA@aq&F-3x", "t3": "sk_w1RG*XEvX?oQt4V;9s@CPn-RKK@nF" },
  "APPO-EL5Z-MYCS-GACK": { "index": 890, "t1": "sk_U~zhJ-q30TV409^diNtk=qNy*N2CN", "t2": "sk_2;DY=pnianG!MJ84Vi^^._E0JtNON", "t3": "sk_g~;Tk4;@d.xMB_aWm5NT+AK3=l#nY" },
  "APPO-4VPC-QWZV-7FY4": { "index": 891, "t1": "sk_M??f~Qe3TGpkrvblG1FrUg.VcatdY", "t2": "sk_IDPc?ZmVB;3CTXuRJo.5KVq33%:Pb", "t3": "sk_tS~fMOvMZHJ9g&@IOaGMGAJcp@pAp" },
  "APPO-6CW3-4XW2-LTGX": { "index": 892, "t1": "sk_b1zuxX2F7Yh4bJLVuw!E8N2Sl#vHN", "t2": "sk_f?SD;2*kuBXIbiawMM7?zQarrl^Dr", "t3": "sk_d..T&OMT+E6?&B_2KVI%as:2Y7FzD" },
  "APPO-SJPL-DD34-7YBB": { "index": 893, "t1": "sk_pCZ%oBLOf*4x=8On#8!@KOr43squu", "t2": "sk_xCeeFXP:!Pq-pOjMh?=6NAROje;er", "t3": "sk_J*t+DLQ5t?kJAocFZ=bF_GMltLLix" },
  "APPO-2S4C-BW9A-M6KE": { "index": 894, "t1": "sk_FsonDqTcQRnsq1mfrA_NGo:g3PQEt", "t2": "sk_hdY!!usf1O.+U24M1cJcFswgf!CYk", "t3": "sk_44~YW+#*YtIz%+tPH;5#S58&FRL~b" },
  "APPO-CTMA-CAH5-TJ4R": { "index": 895, "t1": "sk_hNaSyKlx?.XKDtG2ouy9;VBGN~QN3", "t2": "sk_rzbysPj:6LN+PF3*_6~8y%~c_Ra*F", "t3": "sk_E~_u#*lh4d3g#PBdw=JujRVHhp%dS" },
  "APPO-WJ8S-TPGF-WM3E": { "index": 896, "t1": "sk_XK1lb#:jYhvOdMv5l~%-Oy?7wMiK1", "t2": "sk_s!*R&7TPLk%^jo=2PTvROm9wRl!8m", "t3": "sk_OBj56#UPNJ9P!Zkv%wKKQ8.3lDYeg" },
  "APPO-4MPL-53A2-JFSA": { "index": 897, "t1": "sk_3Wi2;z3?Be:&OnxxBnDW1~mu@1WyU", "t2": "sk_Ao:AmkowUzA%TyJv1S_tyoGh=^hNe", "t3": "sk_Wzbl0~UHsW2De0MGsU71TSm_hR_iv" },
  "APPO-6C9M-GMVP-YVPY": { "index": 898, "t1": "sk_KunOr22uOHTCs&Cx=*pb^ziU5*;KI", "t2": "sk_qu_aoN0Q8*p^XxmXn3w62Z?Ci!WKb", "t3": "sk_TW;Lmc7u12!!6!AViA-Ssru*_q@eF" },
  "APPO-GXJN-5W7T-YRK5": { "index": 899, "t1": "sk_z;:U576Hqf@tXlrcS3gwv?XStY31I", "t2": "sk_9.b!*so9ZiFGx^9sDYh~qcyrn_~NL", "t3": "sk_Q0Q~c4n@-5K?Sv=z^rMizLxU3-3fK" },
  "APPO-5X4L-PLRM-FWLT": { "index": 900, "t1": "sk_oU%i8Kj0hU_*kVh1#xL4R6brGlT~Q", "t2": "sk_aCVtIN~^rEVs#2:xPsJJA#BgG_AMP", "t3": "sk_C3M*a~@~3n!DGBm?:GFPdXKufAqKd" },
  "APPO-XDGV-9LSG-2M49": { "index": 901, "t1": "sk_Eg8liXYU!hh%K*lJ~I0hyh-Rjl+ko", "t2": "sk_0ao;I@p=Le3QrKmYAdxgfTNWZ30Aq", "t3": "sk_WkVivlR^ZJ5CQ;c.WnX:=W3NyW46x" },
  "APPO-2GHS-JXN6-P6A8": { "index": 902, "t1": "sk_hon#Pz*GiLxt=f*#fxZ^%!sc3Y&Zy", "t2": "sk_zI1c#%BzTPinb5am+hT3V&AqN30Ot", "t3": "sk_tJz!7Twg6&.vS!5ukloFaT2i&U4#v" },
  "APPO-RSFY-GPLE-3G3J": { "index": 903, "t1": "sk_i^9SE#@mzu2gA?w@nYAT5Dk?mS71I", "t2": "sk_vL!bzR.GlWe~=l=T-@N0iNZ0@Sd%Y", "t3": "sk_r&&E5.rnN6QoZpB9_w+Yvwt0W^ZKq" },
  "APPO-M3GY-GPUA-Q39F": { "index": 904, "t1": "sk_VV:+A%ef&Efv-8URd^!1@HTuDHDSl", "t2": "sk_X;C.y_Sv65Fxu9!Xvyv4m;s;86I24", "t3": "sk_ZUu457h*vQSUWpGSZnI=xM#d7Paj5" },
  "APPO-RABN-V6SU-T5JD": { "index": 905, "t1": "sk_u.?##kaT&Gs=u@~13slNR*ieTR3~g", "t2": "sk_RMcUuSJ*DezG2brw%cw!TAAqa~mlZ", "t3": "sk_u7w+@s4vUqL5w1@^^+4A#Jt8F=#W4" },
  "APPO-MSCS-M6VX-54Q7": { "index": 906, "t1": "sk_NHlT~T1yupX1bOkJonT_uIlVdod2x", "t2": "sk_O5CpB%J1BL0;19Sf9TncoYIoqC3~g", "t3": "sk_etEc4Qoi*f^2w0vmGNiphxxPPx+ps" },
  "APPO-PYB4-G5QR-E9T3": { "index": 907, "t1": "sk_GHdS#AjB.qNwfTA=heYcR%Uac4z4K", "t2": "sk_eB5Cus?nba6h9jdV%*m+^+CWnlxar", "t3": "sk_T0!.daR9?IXp3ip1LNKyA4Fm;EdK1" },
  "APPO-NEPG-KR5W-VCLG": { "index": 908, "t1": "sk_mvFnR8.+9vXhN-sNd%iF1UJJ8_B-m", "t2": "sk_NbEcu?%ap9uIO3gXNS=S?*:INUf~z", "t3": "sk_cdmUd@!QJiggeVNGtPjD2NNbi=~&T" },
  "APPO-RWF9-62KF-PBDK": { "index": 909, "t1": "sk_3ag-Kem&+4=BZD&2KcGk#Oz;*%2fw", "t2": "sk_i~08pKRQtXUmA9-FKMj*%6m*hc-*G", "t3": "sk_1grCw5k?Cb2rtx8?#F29s.%atEDFW" },
  "APPO-SGFK-V9XZ-ZZTQ": { "index": 910, "t1": "sk_FCla?x6@*#4PV44=-a!_=^1NnJ*mX", "t2": "sk_tsXCWJg3@h*uGer9=ub:%@?O~Rveo", "t3": "sk_oONFh7QS08:8kzMakAkXV?c!&0VGR" },
  "APPO-Y4DD-WHFT-V27V": { "index": 911, "t1": "sk_xe1T9fyT7r_PiPlrK!FNI06Lk&TiF", "t2": "sk_I?U6k*yY&vIxrIgW:o*B0Zqyi7Q?m", "t3": "sk_lfF;_xoB0u2Kz5H&1_E?ML9dzMoja" },
  "APPO-RAMP-49GX-RYLF": { "index": 912, "t1": "sk_V&k^^5GYa;Np9gVk@Xx~L;@?vrOVM", "t2": "sk_4Vq--JWu7Y*xD&G~KZITuWvHxT9Wv", "t3": "sk_W7PglEb~v;_SSxi^AT@kO;Bke@~ka" },
  "APPO-SKKK-3ECU-N73J": { "index": 913, "t1": "sk_A-3%gOa9gX7?zjcoG5*3B9eaZgxrP", "t2": "sk_KLZ5lIXNbtPvVW0n.!Um@3QB*IXBK", "t3": "sk_GyyhQDbYFUnb;NSv56DMw5rr9lBIO" },
  "APPO-EHHQ-GD45-UWB9": { "index": 914, "t1": "sk_C;Sh!IzJbPfgPr+5G4Pj;i%09^-^u", "t2": "sk_qU5B4HY*Mga;UAGgNH*UppQYYB+PR", "t3": "sk_g-0AdN!g#1V57c;pMnCVbXhb#9lv6" },
  "APPO-P4MX-CE6C-3J9T": { "index": 915, "t1": "sk_vr4T5i+&PbWlZkcb0#_?JGe?@3@Ee", "t2": "sk_qyd5G2FqO9?n*dw:_+bIsgruR4ui0", "t3": "sk_aq*7s_w=@@lqzMP:fZfJB1JKjOt1u" },
  "APPO-NCNN-WSPA-9NLF": { "index": 916, "t1": "sk_opmMc_3ii13UnxTx:6PW2Kfsh6ePp", "t2": "sk_kc#DD^A8O&Zw~R2wh=yTqdff0tR!C", "t3": "sk_pdD&slM00PA#Z6luIB6:w!^P6fvPe" },
  "APPO-E6K3-9KNA-E5SY": { "index": 917, "t1": "sk_Ggzfs0w_cFDtNHUpQu:ewdR=pF0YQ", "t2": "sk_mtT!HUaIW6%C^s:D?qq8zUZ3WKV#t", "t3": "sk_Ip8Xigha~5J+Y4Jx~~Z4Z@AlqruQa" },
  "APPO-E28B-E456-BQV8": { "index": 918, "t1": "sk_8C0@XsgwR;5Y924*a2g2!oO__HR#w", "t2": "sk_fIC?0@E*.wwQdERKj8&PW7_cFN1qr", "t3": "sk_O8NJ59kCetK-!2zSc@&A@*cqe;uwa" },
  "APPO-CQHK-QMD6-77CS": { "index": 919, "t1": "sk_B%..aMLud3VqL?n#m*0ZpY?hAY2Sx", "t2": "sk_8k2=-GZWvLo3!@H2WC?FqLg7erP:A", "t3": "sk_m_FkmX!o*5*1-xa!jWFq?NElc;q6C" },
  "APPO-UVWC-PPC6-9W8H": { "index": 920, "t1": "sk_ed%s%wDsG%pylPL4CydD&+Hp_QF?b", "t2": "sk_FzUd^ws8v9XT~Cl~59#z?v~#m_Qgx", "t3": "sk_u6bM0pLp.2WcRQC!OAc=ldQtlK!4X" },
  "APPO-4BPW-34D9-MTHR": { "index": 921, "t1": "sk_h391aAQVYzAbCa?#%^Kdpnnse0;N5", "t2": "sk_b;;wcwn&IQQoT#teh#@LBM&z8HzRM", "t3": "sk_Tcm1mqzic:@-DUSPR*53;1VCn~nL0" },
  "APPO-E36V-BT2K-3MK8": { "index": 922, "t1": "sk_M5tK-KUFgsX7#hj*I?cP!2z6w&jHU", "t2": "sk_lJtr9;Pegl3NRw1uZgJk!VG0o-y*Z", "t3": "sk_ub^MJUv5vg0J-PCTMIFhacGVsH^Hx" },
  "APPO-PB3S-Q5UR-VVCV": { "index": 923, "t1": "sk_bD;ww9!!QlY@MdJ*gV~Q6-i-sjb.d", "t2": "sk_kc9tiOl:Q*9o1:PUd=:+1iq..XZEB", "t3": "sk_lY?1p?&b7^O#Q*?3W.w3G=@q5#UtM" },
  "APPO-9GJ7-EEK2-2AVS": { "index": 924, "t1": "sk_ioyNpQ326YVfI?X@kZtsSM75zj2hV", "t2": "sk_B-Zg03jEA12KTJG1Am+QyZd5wg%-V", "t3": "sk_D3g95L#thBa#C_;vF:;uD%63SiT.r" },
  "APPO-DMAU-PNMA-X7YT": { "index": 925, "t1": "sk_9mt~B:iw^OKo+PC&eJ:@8gt2Xk9%X", "t2": "sk_w?X1oQJ9_Z!Jl_qy;cWF7kh0xl0EL", "t3": "sk_kp+I0sFr5g@jMCBSQt.Y^Fl=4kOXg" },
  "APPO-3JDQ-LNVJ-QUXN": { "index": 926, "t1": "sk_U-ulu4Zk6SOV&e*q_PX3S19!M1JKk", "t2": "sk_rdB:^gImq~Dn+YjqOVHweZQ355t!T", "t3": "sk_Oj!nh3iyA1PE-#zGBDU^VGC7h^u46" },
  "APPO-WQLK-HMRN-5BUR": { "index": 927, "t1": "sk_jb1qotc*8STBk#Vuef+=f=*_p*_Ir", "t2": "sk_s3ycVBscxHY;:_pfNyXN205tj%8g1", "t3": "sk_bx~mmi=Mk4#i?Bln1&OJoj_BMWu9C" },
  "APPO-5VEK-6VNV-PLBQ": { "index": 928, "t1": "sk_SFSk-2=I9hh#~O&EK-@gx;CURXu~4", "t2": "sk_d=n;lbDj1F6Q_l=kl+pEi~.VcWh7O", "t3": "sk_l-LEU4b*pjqq.wrpfkr~h~OT-A~YN" },
  "APPO-XHCC-3W7B-42KL": { "index": 929, "t1": "sk_rk9ULtMamSWGA0jV!3xkWJNcWj&eb", "t2": "sk_7lst6X7VSI1@i!&mp~z1vFK5~3e%E", "t3": "sk_m+@5@^4w-r0L.^Y!#g*R9jK6?a6Kh" },
  "APPO-D9DW-KNH9-YDUR": { "index": 930, "t1": "sk_7i@OX2u3jN#.aOw45HtXcT+uvNBu7", "t2": "sk_R^Zx*0^E^w#::EutfRS8rIL@hafP0", "t3": "sk_YUQpWzVw.dZioIJGYa8;@9eF6W#;6" },
  "APPO-MX9G-A48V-8CDU": { "index": 931, "t1": "sk_5m:0Dn4#Q;81YL;^?fUVhAw=hS?fK", "t2": "sk_rCP+V.:P;j4gvS:XkZjMJ~n-KMN#f", "t3": "sk_qxzibl7k22.9#j9Ic3Efc&?H^QM9k" },
  "APPO-6BUQ-QQQY-N4ZW": { "index": 932, "t1": "sk_liAEG=F9bMYxoEdkS!kJ~L!rlee4l", "t2": "sk_LHeb_Cg#o1@HBZugoN=HnI?Z7;!3z", "t3": "sk_JB1@Z~&Hu6eUB%i2SM-v*agM9oQIA" },
  "APPO-GHL7-QUD4-3A4U": { "index": 933, "t1": "sk_nDCQC%mwBcDWX9EkqsZ__FlQZS^g3", "t2": "sk_HLgfA15TFRAZFYFzgHC=7SZmI-ZBx", "t3": "sk_b+v=H:Rr=RZ3HQW1I?Ig8y*tsfvrm" },
  "APPO-K7XD-9CJH-6CXU": { "index": 934, "t1": "sk_08A4lrBu9RxYf4t:w+5.rgGfr!E9o", "t2": "sk_p&wYz4&o9F1L;-Z=^:v-2BNf3U6FX", "t3": "sk_z6Q4f?9pzw9TlVWsN&bFIp?eu~XPS" },
  "APPO-V9SC-W4QS-YAAL": { "index": 935, "t1": "sk_SZUrZfQ8@pg#ySZy&u+j292qs#Jnc", "t2": "sk_O=Cq2g=EYzNfUO*xxXK82tzvFB:zG", "t3": "sk_AiPrgQh+*4EC4vhe9hHffA--Bhmua" },
  "APPO-EUS4-DVUW-93U8": { "index": 936, "t1": "sk_R#N1sB_K+m!0kDQn2WShosFX#NM!k", "t2": "sk_fVNR*zy6a-?w3uo^ZGQD%cmPC6xEj", "t3": "sk_TKh3TM_n%R6-y7szr_PLD4dg~#3Nt" },
  "APPO-TXF6-N43Q-HVC3": { "index": 937, "t1": "sk_hc#D&cR6Qfxqd_lkfv66iL%04ZnPo", "t2": "sk_z1hx*1yimQ.M&wtWyTxof!~~C%b_Z", "t3": "sk_1=TkXKf9:5JDjhWcVM*89e6E~.lmI" },
  "APPO-2C64-8PF4-JWQQ": { "index": 938, "t1": "sk_er3.Bv#J~+sJR#b3&QQ0egIJ%x6y4", "t2": "sk_hInShcqycd7XR=eP0BcX~U#-f~M%V", "t3": "sk_4F5TuWsr@~#8sZsRC2inseapD=c!t" },
  "APPO-4NJE-XW4N-8XEM": { "index": 939, "t1": "sk_itEcv#PGQ^d81QuSLVo;I;tJqcyQS", "t2": "sk_9!+UnDk_%qv9vOTtBggev7@rZ^Kfo", "t3": "sk_G4kFCXd-LpUV!:L!EX5Q--~YdL07Y" },
  "APPO-AFME-5L6P-KNJD": { "index": 940, "t1": "sk_jtpOBxvhB*SzKDOS&X45T;6R%H#+o", "t2": "sk_S^y=qd%D-:wqacgRqG*muqL5O:WxW", "t3": "sk_LD5ZwVXr=BB~ND0HgL*T=IeR9@@bY" },
  "APPO-4QJX-VD25-QX9H": { "index": 941, "t1": "sk_NDMt12r#tjkbxf9iLWp2~ulk5n;@B", "t2": "sk_ImiNKX^:lB_M8jN=*YLNHI.W+.WXF", "t3": "sk_AX8H^-gd!;AN5wA-EH8zQls.UoGbh" },
  "APPO-NL6N-FPFJ-QK3M": { "index": 942, "t1": "sk_p~y~p.I?8R7og=axuyU.CiCET-!Qb", "t2": "sk_duEvl^LwL87?DP9zYot2onfe#t:Mg", "t3": "sk_3M0+=Su+UL@JnBYCh%o7UFbPV#8#U" },
  "APPO-W8U4-BDJJ-Q5ZV": { "index": 943, "t1": "sk_Rbw;&OdxQMmLs2x8HrBAfF6qOowCB", "t2": "sk_MGoK7lixwhTxhVrv&OVA9AzMBmxuW", "t3": "sk_y+qeXSpX8n%.46xCUs@d*L*wpV3Yv" },
  "APPO-FVYJ-5U2Y-XX56": { "index": 944, "t1": "sk_Wy&vG;JZ9&jp!pE6?v6Jmc#-KWxkr", "t2": "sk_EI?tL#2oc:fk-Vsg~+3nijY_mi4UB", "t3": "sk_6z5b*_Kbws52PjGdhh2vKTraQ_YKo" },
  "APPO-2X9W-4UDH-3JUV": { "index": 945, "t1": "sk_6!65vP=C%AVc6pf.Hj0e*r*Y%6u!f", "t2": "sk_IPd5*x-ipv#LeD^F=%b5psn1^DTNf", "t3": "sk_y73MTfk&P;gdsY_bg7p.OOB~BEfVd" },
  "APPO-LTM4-8H4M-JT8T": { "index": 946, "t1": "sk_s+mrjIIVkR4xIU#RA#.l3Q_-hOx?X", "t2": "sk_54VfguN_+oe+5b#IMnyov;n8~5Cxb", "t3": "sk_9AmO3pj=?T3r~_D869EZZ4nCEs:2O" },
  "APPO-BB79-M5AP-SS8L": { "index": 947, "t1": "sk_k7^%oET#kHVaSN1FQm.!MrB:EFHU5", "t2": "sk_p3@_%oI#k=lR&QBUdwIkti~Je^Mdd", "t3": "sk_6EiYxy68#s-+@iARHCbWP!*je@zHo" },
  "APPO-DZUA-DWNX-GRVC": { "index": 948, "t1": "sk_KhXa?G5mcRA=vRw_g:uvV4d%p.EOU", "t2": "sk_u~OW!&JqsYq8zzGONPi3qBJM&q@J7", "t3": "sk_TjeH0vvIqx;kwvOMtBgjI=t=i+Y;h" },
  "APPO-ETTF-SY5U-XFYH": { "index": 949, "t1": "sk_q^G?TzR-~9^MdcyvS_RS3gG2Fp5Q5", "t2": "sk_coLS+0s-V:1dwX=RY:mKQucOzTqqw", "t3": "sk_smOU*ReBrjfL61xxT1Ck*GhBh4rvH" },
  "APPO-JER6-7EDP-Y67D": { "index": 950, "t1": "sk_mH=q6^U#85rKOAAEc1d0SQi1jTCdI", "t2": "sk_Y:IN:b5KH^5^1P7+^-OthB&l?dw~b", "t3": "sk_rAZL:YRGYd#Mfv+YazlSN.5MrorZf" },
  "APPO-982L-8RAS-WD3F": { "index": 951, "t1": "sk_W_GMbQ_Vx3aEKh1eiAFN5r+vUni^B", "t2": "sk_9%;+5+0~q!LKYlX4h%VZj^yf##qs8", "t3": "sk_GvB9NSLRAU==PSqjk3yB2kKiv_hN3" },
  "APPO-YTQJ-MUZ2-H2SN": { "index": 952, "t1": "sk_i-Q=*VEFB&AoIIHQq#Knup?pKN&Ny", "t2": "sk_eNe2L7RpzH!N?7iaj%5N=w7mZqM:S", "t3": "sk_BK66486XV-EWV2HWtc.hmjHf:=#hI" },
  "APPO-ZC9S-ZG67-65QX": { "index": 953, "t1": "sk_5A*nM:;DspMgk4@oK9h&n*2Ui3yjr", "t2": "sk_XmXtXm8PI4pibGYFUnuNxwaDpr0IW", "t3": "sk_8tdXLnREl5F6q0*nyYIqmk0JojTk2" },
  "APPO-BDZF-QX6W-F7MB": { "index": 954, "t1": "sk_Q9v@buxlb=8XjQt@uig&#At7j3n#9", "t2": "sk_IgVYd..*9mQPxF~5xdPLs2C:oJAq5", "t3": "sk_AN#F=Zy;tl_RIAQSbyvk*A^:0?sRC" },
  "APPO-77MF-8ZPF-4NGK": { "index": 955, "t1": "sk_245UJZoqtARlEwBN8EQNzfS1MP6!6", "t2": "sk_B9Ypi;oB6:yQh8L=MIqaHSrlf^S1N", "t3": "sk_keE~TwClwkXHEqys7UfYdKMQRbgl4" },
  "APPO-ZUPR-8BKF-ZH5B": { "index": 956, "t1": "sk_opam9JkbN%#CMePAxMT+hlV0?WDix", "t2": "sk_ILKSL3OD6fyHHkuvz=iUBn6SH?4fq", "t3": "sk_Ry~M6_.6UDy%jCBM4Fz3!euyMDA2H" },
  "APPO-G3UR-6MND-8L3P": { "index": 957, "t1": "sk_3G^yE!c0HExmgbt@OWSKt#DXj0P_g", "t2": "sk_V^Ajgj4?+4.gi-~3qZv5P5cUIM:?x", "t3": "sk_LZ4yOEc-Bvpig@3AS4&OPoXx:;G3N" },
  "APPO-QUNZ-C3ZZ-8AXA": { "index": 958, "t1": "sk_2VWAHK9KhJ1gIf_a-.dLk3fZ6batJ", "t2": "sk_C6*Fm.hEuNv7Aw=wDkQgTP@U-sOZJ", "t3": "sk_DJoJS~+X9hd*0JbeaR:lnZp;O6Smh" },
  "APPO-8R2P-EANT-HW2A": { "index": 959, "t1": "sk_2Zs=*B?VdA96VXEZRN_L^=aw*+BX5", "t2": "sk_WaVWFZ*LRAdt0._RhK0JH8cpnybgC", "t3": "sk_IiBHh7gg2ajj10_r;hN0gOhZUz84e" },
  "APPO-CCB4-JN5U-XCP5": { "index": 960, "t1": "sk_s9#~Tc.WO7-VZ+G4lf3uBdnN8sXRc", "t2": "sk_k4RQa#T5W1?4SHcr.z.OPXnhr+E.b", "t3": "sk_ZTA@qkJEjNGH^y.9=USFi+c3UFy~P" },
  "APPO-PHHH-ZEL8-DMNZ": { "index": 961, "t1": "sk_f0@cWL=JnXA?k&h:dKWRG;Oc9+2Xu", "t2": "sk_w?E0KzJAxx#L@HyS&@!WIEqh3=LsL", "t3": "sk_5s-!p&a#LW;e?gw:yi8c*^lUUZd5J" },
  "APPO-2FP3-ZVRC-2534": { "index": 962, "t1": "sk_nR27-Or_sT9%0;WIi!BoM^hoXBU@o", "t2": "sk_uJP%M9H3EI14Z-2ZLVy%O.Duz6WTE", "t3": "sk_6WDBGW_SZDxsi;Ub#9._hRUUT0y&g" },
  "APPO-A764-N386-YUS9": { "index": 963, "t1": "sk_FngcOG%7bX0kAHXiBFQ^hId26F9Po", "t2": "sk_w2Lo+9&WwtQ+4TXd6StR&Jd%XT?#v", "t3": "sk_9r:AAe.3aq9et;ts*~3xET4U*W.zG" },
  "APPO-C53M-8T2H-PQ9E": { "index": 964, "t1": "sk_uS5r+jU7DL3EXUjp5DKOWiG+g!3r8", "t2": "sk_0cDzXjZZIm.0d;zX0lH^.MC7v004c", "t3": "sk_pap*8cF@7CjF*7EM+sjGF%lQqjdek" },
  "APPO-CMXJ-PHAM-GH2A": { "index": 965, "t1": "sk_uL%2KyYWcP+AuIca7V7&dd?f-#cET", "t2": "sk_jku%M5tE3Qqz%G1A*PZ0cIPFzvd2w", "t3": "sk_wy:t+Giq2z#*czu~Ne0mVH68SS.#r" },
  "APPO-4GY5-BHCR-C32L": { "index": 966, "t1": "sk_v#gJ.Vvg0-j?X%VZyno@!_^PC@Dp8", "t2": "sk_vtXEa5v#GpON_fI?P~%Z1x31nvsGs", "t3": "sk_nL15N&8J9C-BiwZU02Z@aK5fIQIZx" },
  "APPO-ADQR-BR65-YHVJ": { "index": 967, "t1": "sk_UeTN6P#1=z2-4brJg-pi*c1V?DfJW", "t2": "sk_ZiN1.GtxELB&fJ+OwW^s*XPn^_4gh", "t3": "sk_7wKq#VoD?R5pzV05WiV=~95t~tbyH" },
  "APPO-7REV-39S9-B325": { "index": 968, "t1": "sk_h*8wKyZCaUcrj;Dbl:r-O?MKVW2DZ", "t2": "sk_T7I&ejZX0~7+?ShW:b@a?1KhPgtKi", "t3": "sk_2gVLFe.u@uc9QKAcz&mqd%?3@F:F7" },
  "APPO-K8V9-BE7X-QUSQ": { "index": 969, "t1": "sk_MFTH;P4:cZFHD9dc+ug@Bvo?Np.of", "t2": "sk_wB6*#tYaG&Oir-Jfb98RdU0Q5Z@xB", "t3": "sk_tbsTm-D3%_DGRgOf&yEMS4iq6ZZ+F" },
  "APPO-AEH7-AMGZ-5HBT": { "index": 970, "t1": "sk_UL^7L~f*13^~dhSr*#l5#iZ_Myg4h", "t2": "sk_84e.NgvSZB6?L5LjTcIH11ylqO9bo", "t3": "sk_kw!YO3H6#u4Tp3hUVQHew!IOw2mG5" },
  "APPO-YA9R-55NH-BG3G": { "index": 971, "t1": "sk_XbRcoMCQ!e_hy=xze5_SSTus^r68E", "t2": "sk_6pL;.k:+hIshQSu+tzL3nWd3-~CpN", "t3": "sk_Ju+zC!unLDa@wd26u~o&3UYrnes@F" },
  "APPO-CKQR-D9CM-7ZCY": { "index": 972, "t1": "sk_83VAH2&;pdnI!K?2eUI&ET3CN+MGC", "t2": "sk_w38Vv-HKtIC7*%mMN1tEnPDMQ+A!x", "t3": "sk_W~=5*Rpw.dp21hPfSl=!3oBCSma;E" },
  "APPO-9J97-TZPA-YYVL": { "index": 973, "t1": "sk_YiR:Xd3;_6TRYQ8:Mujix#5NMi=L5", "t2": "sk_ZT&^mkuP4C!MK:wlSBj8dN9~YjB-z", "t3": "sk_A?9R5edn1Notw*EuCk!kWz3+c8tf5" },
  "APPO-RFSL-AKBG-QL4W": { "index": 974, "t1": "sk_iEEHTu2n.2aJC;UNKOJj#GAqpgxom", "t2": "sk_PR@1b.UBM^6TBUu8WNYX:qtd3ZhEN", "t3": "sk_qd#_6OwtSQj4yLTBT=^ybj8aUAV:P" },
  "APPO-HW6Z-AUU3-KPBU": { "index": 975, "t1": "sk_DH;Og:5K_33YlgMAkI~Wo!x=Znp~4", "t2": "sk_9D3@lb.AOpiW4v#j9Y7Pluomz=ewO", "t3": "sk_dPNb#EMZ0T3sTeGIT5HKg7_S=q7Im" },
  "APPO-65SQ-V8Q6-9WK2": { "index": 976, "t1": "sk_UMUQnrrhQ_ceM3Yl8bdal0PhD6%eI", "t2": "sk_xG_uwz7:H;Tx0d9oLTHIf1nbSJf6B", "t3": "sk_LNB9n!JM76H3-uE=_F8vK7BPiSO9x" },
  "APPO-VR5T-FQAN-RU9G": { "index": 977, "t1": "sk_gJf0Y&Z&ppZ~+12T#0*u7Ow5scjia", "t2": "sk_eAsb6-E:2927XvGn=dpfX8awi4WBR", "t3": "sk_uT4=grDRBOmbcbqK&DvCYQe-ww#WD" },
  "APPO-VWL7-AEJS-W96A": { "index": 978, "t1": "sk_oUC0y+g+Vl#MDcD5o+jyZgdjwK#qy", "t2": "sk_0MUlk%CUp7kfEr~FU4ra1^.phTfiX", "t3": "sk_bq*04TZO;hk!%2VmNKAq_810v@cCc" },
  "APPO-BE6Q-YQEA-AAQU": { "index": 979, "t1": "sk_rz2wzuu0!wl5vD&L=MHaJ-JOh%9n5", "t2": "sk_iNOhT*~:wvu~p^s5*qj7cRCp01s8u", "t3": "sk_iTR=abN4J0^ypi3oU_o2B?d-6OTRc" },
  "APPO-6PFA-78N4-L5BD": { "index": 980, "t1": "sk_2xfbhWTe2?sbtjcL^2nlnzsd58oka", "t2": "sk_brJJXOz3hy77Nb1zw7W5aMS%UAMoh", "t3": "sk_f+C40-WwYrfFvx4^MYUgV+_ShFUAz" },
  "APPO-VMZK-M726-5ELB": { "index": 981, "t1": "sk_8ntr3.aA!F2O+kxog-lJ-haMKKu*v", "t2": "sk_DI#~.-!4J+OQP8lFC.3tYPDw6b.&G", "t3": "sk_Kpc=pU7hWsT2-2nTvJKpOMR~V7u85" },
  "APPO-CR5M-AKKC-ATN3": { "index": 982, "t1": "sk_p*8+G%Fn_CRJs2OZX+NP1gMt2KDea", "t2": "sk_wkrBf-~IHJNf=;Lje2usJlX*gi%.N", "t3": "sk_wU~sOh=eg0Mur2u4?%o*7iOTvrLxx" },
  "APPO-3NR3-C6M5-2B65": { "index": 983, "t1": "sk_fAU+JIJC3Jo&2O%M=18aztQO8FhqS", "t2": "sk_Mf~s4d%r2o.6dTB7s.9%uaR4iMOXf", "t3": "sk_dgybB%4ugW;vpV1dF5ay6F9w9iLSo" },
  "APPO-J3T3-RLZ9-YWE8": { "index": 984, "t1": "sk_qcsj@CY94A3P3lsGqQ3Fruu=Otwbr", "t2": "sk_02YMRZEpzVD^=gW6bcQLtU.MsIP3F", "t3": "sk_Z;AIYv:I~C23^ubwHn%QU48Qnn+Ux" },
  "APPO-C9R6-XEXW-2WYH": { "index": 985, "t1": "sk_KxG:1=9VNOv8bYywckWM-sZy0m;%O", "t2": "sk_T9fjOJ80P:4S1E%l&m%~rCfv!b~DO", "t3": "sk_ZDoiNzJ:yo&lYzn3@idhQXlIiiCKg" },
  "APPO-RQN5-5MWY-S4NJ": { "index": 986, "t1": "sk_A2E~!YE%hA_a+sfrnK3UvMx8P?N^r", "t2": "sk_s#?g#u4NDHqlmXUEf395=&c75LV?d", "t3": "sk_dk6~.^wUWded6vmZUIF.=RbOO0Pu8" },
  "APPO-FDTG-YAMY-U96Z": { "index": 987, "t1": "sk_K=8L7I#1FL%;AQYr8W6YYKAlOOKav", "t2": "sk_ALYtxLEKlVQ3yayV!uy5P^edW=fwa", "t3": "sk_w-TkHXpMVpVC9X~pcEnBHkETA8?d2" },
  "APPO-JTFP-6E4C-S3UA": { "index": 988, "t1": "sk_aSEaI*mitkM1Ghh2M&O%bpwfhSDfI", "t2": "sk_XNRETyaquPMBJ!ttwc;rF3yS1hu:R", "t3": "sk_ZOKDND!8JjWEk6oLO=FbcZueuK+Ne" },
  "APPO-DNQG-VZWN-DFKT": { "index": 989, "t1": "sk_mQFVNq6Ybm@VltvXzAL_w3hCH+N?E", "t2": "sk_3.uKAJ%zjYx-TH%y8Fmi+6?ss0_0L", "t3": "sk_MSQLVQ!d4G.SAK*EJ9D?CH^8SlS0T" },
  "APPO-69KV-MKCD-ZEX4": { "index": 990, "t1": "sk_wmV%DAi=LUWnRArZdlI~qk!vMF~Qu", "t2": "sk_eo@Ze_cCU:*%Zt2zPTpr&?XAN*qdI", "t3": "sk_VokgMbJB#wdZIQsj6T8Tq^z7YzxKi" },
  "APPO-4TPW-WRWJ-VFWU": { "index": 991, "t1": "sk_2MoTvvakA49aXI8a5A247%~cxn*?I", "t2": "sk_mgo12rniaA2bZAr:3YL5TkPjExf0r", "t3": "sk_v.^VxRMg=g1crDVYWP1tz~i@OXP89" },
  "APPO-SBZN-VYMT-QJCD": { "index": 992, "t1": "sk_d&urn9^D!ycJ%A?eLiV7NZ1R4DPiW", "t2": "sk_GJ_lrezS9U2q.x%29#R^nId8#vpda", "t3": "sk_Q~=QU6TAdrifxYP+6V_3W-S9JhC^S" },
  "APPO-PJ2U-EQ98-39VT": { "index": 993, "t1": "sk_mheUD.TZpcU&NS#j.+!OhPiUB=F3q", "t2": "sk_RS?iLQ6x*~&Tx5A8JXP#KbD&WZ!o4", "t3": "sk_N=w:1Sm.HAsQx8sKB_Zc!S7K5%nxr" },
  "APPO-FCYA-G89X-CY6Z": { "index": 994, "t1": "sk_hU7JN%*Pzjv=w8&r-5uQNnXkAhDvg", "t2": "sk_3N*Kp^Qr5KJ2bdFD^PKtU2Vvq:Nn9", "t3": "sk_qrRvLS1H~1V8zb^ZdqzKVrqUk=V.j" },
  "APPO-LUBN-ZSG8-MP9B": { "index": 995, "t1": "sk_kl8smvp2b+#7P1-O!ls!%MoRb+2*P", "t2": "sk_sp7hlElJdsFqDhAo*Y0y:NBWGS4yt", "t3": "sk_WZTbQC3?O9SOJ#xfDfz*LphojL+Rc" },
  "APPO-A983-298M-TMHD": { "index": 996, "t1": "sk_ij~NkIvz+@i6@NDdHTe^%bnQpJ2nm", "t2": "sk_zhpg-KWlZ9t9;MT~TqSA0Sl;2-xd2", "t3": "sk_4#2d.j5aDgHCluPMYap.cHZa;Q1EK" },
  "APPO-3WTA-25XY-ARZ7": { "index": 997, "t1": "sk_I.RV^mY4tMr%76!bEl2ykzUvI48uL", "t2": "sk_T21%76K*2ff%AOq-kn-TAm!fX%%YQ", "t3": "sk_aTBa!DlDq%1WV*Y4.+yN?AG48H%wB" },
  "APPO-HF9P-HHQV-JRGT": { "index": 998, "t1": "sk_vVf+dpkiR!MbseJ*2YJXh1+I*I4=k", "t2": "sk_MT;tBm*Y9weOgqKM:RMndO&Xx--@o", "t3": "sk_pzB8ydS1dz7Zu5e5xWeyKid-#6u?H" },
  "APPO-P56T-FVMF-2T8T": { "index": 999, "t1": "sk_PuHRTO!BVDM5^UspzG1cFEDE3v2gm", "t2": "sk_EVDDafjak8Ldrkq?x_KssQ~4&^s+A", "t3": "sk_Sp7:%Tn10r8?-GJl=:Ns36kI-!j?d" }
};
const registry = registryData;
function isAppSumoCode(rawKey) {
  if (!rawKey) return false;
  const clean = rawKey.trim().toUpperCase();
  return clean.startsWith("APPO-");
}
function resolveAppSumoKey(rawKey, targetTier = 1) {
  if (!rawKey) return null;
  const clean = rawKey.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const entry = registry[clean];
  if (!entry) return null;
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
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send("app.deep-link.workspace", workspaceId);
    }
  } else if (deepPath.startsWith("license") || deepPath.startsWith("activate")) {
    try {
      const urlObj = new URL(url);
      const key = urlObj.searchParams.get("key") || urlObj.searchParams.get("license_key");
      const email = urlObj.searchParams.get("email") || urlObj.searchParams.get("user_email") || void 0;
      if (key) {
        activateLicenseKey(key, email).then((result) => {
          if (global.mainWindow && !global.mainWindow.isDestroyed()) {
            global.mainWindow.webContents.send("app.deep-link.license", {
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
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send("app.deep-link.oauth", {
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
  if (global.mainWindow && !global.mainWindow.isDestroyed()) {
    global.mainWindow.webContents.send(IPC_CHANNELS.EVENTS.PROFILES_UPDATED, updated);
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
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send("app.auth-completed", {
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
  const ov = global.appOverlayView?.webContents || global.mainWindow?.webContents;
  if (!ov || ov.isDestroyed()) return;
  if (global.appOverlayView && webContents.id === global.appOverlayView.webContents.id) {
    return;
  }
  if (global.mainWindow && webContents.id === global.mainWindow.webContents.id) {
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
  if (input.type === "keyDown" && isReload && global.mainWindow && webContents.id !== global.mainWindow.webContents.id) {
    if (input.shift) {
      webContents.reloadIgnoringCache();
    } else {
      webContents.reload();
    }
    if (!global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send("pane.reloaded-wc", webContents.id);
    }
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
              if (global.mainWindow && !global.mainWindow.isDestroyed()) {
                global.mainWindow.webContents.send("app.auth-completed", {
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
  if (global.mainWindow && !global.mainWindow.isDestroyed()) {
    global.mainWindow.webContents.send(channel, ...args);
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
  });
  wc.on("did-start-loading", () => ov()?.send("pane.load-start", { paneId }));
  wc.on("did-stop-loading", () => {
    try {
      if (Math.abs(wc.getZoomFactor() - 1) > 1e-3) {
        wc.setZoomFactor(1);
      }
    } catch {
    }
    ov()?.send("pane.loaded", { paneId });
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
  wc.on("did-first-visually-non-empty-paint", () => ov()?.send(IPC_CHANNELS.EVENTS.VIEW_LOADED, { paneId }));
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
    const view = panes.get(id);
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
const version = "1.4.1";
const tag = "v1.4.1";
const title = "Promotional Code Stacking, Expanded Free Tier & Instant Localhost Navigation";
const publishedAt = "2026-11-11";
const categories = [{ "category": "Features", "items": [{ "title": "Promotional Code Stacking", "description": "Stack additional license and promotion codes directly inside Account Settings to instantly upgrade tiers, unlock more account profiles, and expand multi-device seats." }, { "title": "Expanded Free Tier", "description": "Free accounts now include up to 5 workspaces and 2 separate account profiles with zero credit card required." }, { "title": "Touch-Responsive Workspace Controls", "description": "Pane headers now feature touch-responsive quick actions and a dedicated focus mode for distraction-free split-screen workflows." }] }, { "category": "Improvements", "items": [{ "title": "Instant Localhost & Dev Navigation", "description": "The searchbar now instantly detects local development servers, custom ports, and internal network addresses, opening them directly without redirecting to web search." }, { "title": "Seamless Split Pane Transitions", "description": "Eliminated blank search flashes and URL flicker when switching focus between side-by-side panes." }] }, { "category": "Bug Fixes", "items": [{ "title": "Profile Quota Status", "description": "Settings and profile menus now accurately display inactive badges only on profiles exceeding your active plan allowance." }] }];
const highlights = [{ "title": "Promotional Code Stacking", "description": "Stack additional license and promotion codes directly inside Account Settings to instantly upgrade tiers, unlock more account profiles, and expand multi-device seats." }, { "title": "Expanded Free Tier", "description": "Free accounts now include up to 5 workspaces and 2 separate account profiles with zero credit card required." }, { "title": "Instant Localhost & Dev Navigation", "description": "The searchbar now instantly detects local development servers, custom ports, and internal network addresses, opening them directly without redirecting to web search." }];
const currentRelease = {
  version,
  tag,
  title,
  publishedAt,
  categories,
  highlights
};
const allReleases = /* @__PURE__ */ JSON.parse('[{"version":"1.4.1","tag":"v1.4.1","title":"Promotional Code Stacking, Expanded Free Tier & Instant Localhost Navigation","publishedAt":"2026-11-11","categories":[{"category":"Features","items":[{"title":"Promotional Code Stacking","description":"Stack additional license and promotion codes directly inside Account Settings to instantly upgrade tiers, unlock more account profiles, and expand multi-device seats."},{"title":"Expanded Free Tier","description":"Free accounts now include up to 5 workspaces and 2 separate account profiles with zero credit card required."},{"title":"Touch-Responsive Workspace Controls","description":"Pane headers now feature touch-responsive quick actions and a dedicated focus mode for distraction-free split-screen workflows."}]},{"category":"Improvements","items":[{"title":"Instant Localhost & Dev Navigation","description":"The searchbar now instantly detects local development servers, custom ports, and internal network addresses, opening them directly without redirecting to web search."},{"title":"Seamless Split Pane Transitions","description":"Eliminated blank search flashes and URL flicker when switching focus between side-by-side panes."}]},{"category":"Bug Fixes","items":[{"title":"Profile Quota Status","description":"Settings and profile menus now accurately display inactive badges only on profiles exceeding your active plan allowance."}]}],"highlights":[{"title":"Promotional Code Stacking","description":"Stack additional license and promotion codes directly inside Account Settings to instantly upgrade tiers, unlock more account profiles, and expand multi-device seats."},{"title":"Expanded Free Tier","description":"Free accounts now include up to 5 workspaces and 2 separate account profiles with zero credit card required."},{"title":"Instant Localhost & Dev Navigation","description":"The searchbar now instantly detects local development servers, custom ports, and internal network addresses, opening them directly without redirecting to web search."}]},{"version":"1.4.0","tag":"v1.4.0","title":"AppSumo Official Launch — Side-by-Side Screen Splitting & Separate Client Logins","publishedAt":"2026-10-23","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.4.0/showcase-00-split-screen.png","categories":[{"category":"Features","items":[{"title":"Side-by-Side Screen Splitting","description":"Snap windows into 2, 3, or 4 side-by-side panes. Keep your storefront, analytics, and project boards visible on one screen without tab juggling."},{"title":"Separate Client Logins","description":"Stay logged into conflicting client accounts simultaneously in dedicated workspaces without signing out or opening incognito windows."},{"title":"1-Second Search (Cmd+K)","description":"Instant keyboard search lets you jump directly to any client tab, document, or workspace in milliseconds."},{"title":"Multi-Device Access","description":"Use your lifetime license across 2 computers (Desktop + Laptop) with 1-click self-service license transfer in Settings."},{"title":"Tactile Restart Curtain","description":"Smooth, instant transition curtain when applying updates with zero window freeze or sudden closures."},{"title":"Nighttime Auto-Updates","description":"Updates apply silently in the background while your computer is idle and plugged in, ensuring you always wake up to the latest build."}]}],"highlights":[{"title":"Side-by-Side Screen Splitting","description":"Snap windows into 2, 3, or 4 side-by-side panes. Keep your storefront, analytics, and project boards visible on one screen without tab juggling."},{"title":"Separate Client Logins","description":"Stay logged into conflicting client accounts simultaneously in dedicated workspaces without signing out or opening incognito windows."}]},{"version":"1.3.9","tag":"v1.3.9","title":"Tactile Restart Transitions, Nighttime Auto-Updates & Window Geometry Persistence","publishedAt":"2026-10-23","categories":[{"category":"Improvements","items":[{"title":"Seamless Update Feedback","description":"The update flow now features refined monochromatic controls and an instant \\"Restarting Apposition\\" transition curtain, providing clear tactile confirmation and removing restart freezes."},{"title":"Nighttime Auto-Apply","description":"Downloaded updates can now apply silently during prolonged system idle when the workstation is closed, plugged into power, and free of playing audio or active calls."},{"title":"macOS Window Maximization & Fullscreen State","description":"The window now reliably restores its exact maximized or fullscreen state when reopened from the Dock after being closed with the red close button, and native macOS Zoom toggling fills the usable display area smoothly without geometry drift."}]}],"highlights":[{"title":"Seamless Update Feedback","description":"The update flow now features refined monochromatic controls and an instant \\"Restarting Apposition\\" transition curtain, providing clear tactile confirmation and removing restart freezes."},{"title":"Nighttime Auto-Apply","description":"Downloaded updates can now apply silently during prolonged system idle when the workstation is closed, plugged into power, and free of playing audio or active calls."},{"title":"macOS Window Maximization & Fullscreen State","description":"The window now reliably restores its exact maximized or fullscreen state when reopened from the Dock after being closed with the red close button, and native macOS Zoom toggling fills the usable display area smoothly without geometry drift."}]},{"version":"1.3.8","tag":"v1.3.8","title":"Atomic Background Updates, Persistent macOS Workspaces & Instant Dock Restoration","publishedAt":"2026-10-22","categories":[{"category":"Improvements","items":[{"title":"Seamless In-Place Auto-Updates","description":"Overhauled the macOS update engine with a detached atomic updater that cleanly preserves executable permissions and security seals, eliminating failed update restarts and looping notifications."},{"title":"Persistent Background Workspace & Instant Dock Restoration","description":"Closing the main window on macOS now keeps your active workspace running smoothly in the background, allowing instant zero-delay restoration when clicking the Dock icon without reloading tabs or freezing."},{"title":"Hardened Linux Package Updates","description":"Streamlined AppImage and package updates with detached process switching and direct 1-click terminal installation commands."}]}],"highlights":[{"title":"Seamless In-Place Auto-Updates","description":"Overhauled the macOS update engine with a detached atomic updater that cleanly preserves executable permissions and security seals, eliminating failed update restarts and looping notifications."},{"title":"Persistent Background Workspace & Instant Dock Restoration","description":"Closing the main window on macOS now keeps your active workspace running smoothly in the background, allowing instant zero-delay restoration when clicking the Dock icon without reloading tabs or freezing."},{"title":"Hardened Linux Package Updates","description":"Streamlined AppImage and package updates with detached process switching and direct 1-click terminal installation commands."}]},{"version":"1.3.7","tag":"v1.3.7","title":"Dedicated Proxy Routing, Global Identity Sync & Smart Screen Splitting","publishedAt":"2026-10-22","categories":[{"category":"Features","items":[{"title":"Dedicated Proxy Routing & Verification","description":"Added native proxy support across custom profiles with one-click connection diagnostics, automated exit location detection, and SSL certificate health checks to ensure external networks are active and secure before browsing."},{"title":"Global Identity & Localized Browsing","description":"Custom profile views now automatically sync their local time, regional timezone, and geographic location to match their assigned network route, enabling seamless localized ad verification and multi-region storefront comparison side-by-side."},{"title":"Advanced Connection Privacy","description":"Added comprehensive privacy shielding to keep local network addresses, connected hardware identities, and real machine locations completely hidden from websites when browsing through custom profiles."},{"title":"Instant Side-by-Side Screen Splitting","description":"Pressing `⌘T` (or `Ctrl+T` on Windows) on a single screen now automatically splits the workspace side-by-side into a dual-view layout, while pressing it when multiple screens are already open creates a clean new tab."},{"title":"Direct New Tab Creation","description":"Added a dedicated `⌘N` (or `Ctrl+N` on Windows) shortcut to immediately open a blank tab from any screen without altering your existing side-by-side layout."}]},{"category":"Improvements","items":[{"title":"Profile Management & Workstation Layout","description":"Upgraded the profile editor into a responsive two-column layout with organized account connections, refined visual accents, and improved menu anchoring that smoothly resets drafts when closed."},{"title":"Native macOS Keyboard Experience","description":"Aligned all keyboard shortcuts with standard macOS and Safari conventions, enabling native Command (`⌘`) key mappings for tabs, history navigation, panel closing, and developer inspection."},{"title":"Clear Command Palette Overlay & Shortcuts","description":"Removed background darkening scrim so split-views stay visible during quick search, and added arrow key navigation hints alongside Escape and Enter."},{"title":"Unified Window Controls","description":"Streamlined window controls into a unified, distraction-free top-right layout across macOS, Windows, and Linux for consistent minimizing, maximizing, and closing."}]},{"category":"Bug Fixes","items":[{"title":"Edge-to-Edge Window Maximization","description":"Resolved an issue on macOS where maximizing the window left the Dock and System Menu Bar visible; the application now launches and expands into a distraction-free, edge-to-edge workspace."}]}],"highlights":[{"title":"Dedicated Proxy Routing & Verification","description":"Added native proxy support across custom profiles with one-click connection diagnostics, automated exit location detection, and SSL certificate health checks to ensure external networks are active and secure before browsing."},{"title":"Global Identity & Localized Browsing","description":"Custom profile views now automatically sync their local time, regional timezone, and geographic location to match their assigned network route, enabling seamless localized ad verification and multi-region storefront comparison side-by-side."},{"title":"Profile Management & Workstation Layout","description":"Upgraded the profile editor into a responsive two-column layout with organized account connections, refined visual accents, and improved menu anchoring that smoothly resets drafts when closed."}]},{"version":"1.3.6","tag":"v1.3.6","title":"Multi-Tier License Activation, Multi-Device Seat Management & Precision Text Selection","publishedAt":"2026-10-07","categories":[{"category":"Features","items":[{"title":"License Activation","description":"AppSumo lifetime keys across all tiers now activate seamlessly with immediate device seat resolution and progressive verification that only prompts for details when necessary."},{"title":"Account & Tiered Upgrades","description":"In-app upgrade prompts now dynamically highlight the exact tier needed when expanding workspace capacity, adding account logins, or configuring dedicated proxies, while Account Settings accurately displays your active tier, free plan status, and device allowances."},{"title":"Multi-Device Seat Management","description":"Added an assigned devices overview to Account Settings, allowing multi-computer license holders to view active workstations and release seats with one click."},{"title":"Founder Launch Offer","description":"Made the limited Founder Lifetime Deal directly accessible and redeemable within the in-app upgrade screen with clear promotional rate disclosures."}]},{"category":"Improvements","items":[{"title":"Visual Polish & Typography","description":"Upgraded the entire application interface to refined executive typography with tabular figures, eliminating layout jitter in tab titles, dock counters, and timestamps across high-DPI displays."},{"title":"Dock & Settings Access","description":"Relocated Settings to the primary bottom-left dock anchor with instant shortcut access, eliminating popover overlaps on active screens."},{"title":"Plan & Capability Specifications","description":"Enhanced the in-app plan comparison matrix with a detailed breakdown of workspace limits, separate client logins, and proxy configuration across all tiers."}]},{"category":"Bug Fixes","items":[{"title":"Web Pane Text Selection","description":"Double-clicking and triple-clicking text in web panes now reliably selects words and paragraphs, restoring standard highlight and copy workflows."},{"title":"Navigation History","description":"Back and forward navigation now skips over duplicate URL redirects and page loops, remembering your full navigation history even after restarting the app or closing tabs, while removing distracting swipe animations to keep page navigation clearly distinct from tab switching."},{"title":"Dropdown & Interaction Stability","description":"Fixed an issue where web dropdown menus could prematurely collapse, and prevented accidental address bar expansion when clicking nearby toolbar controls."}]}],"highlights":[{"title":"License Activation","description":"AppSumo lifetime keys across all tiers now activate seamlessly with immediate device seat resolution and progressive verification that only prompts for details when necessary."},{"title":"Account & Tiered Upgrades","description":"In-app upgrade prompts now dynamically highlight the exact tier needed when expanding workspace capacity, adding account logins, or configuring dedicated proxies, while Account Settings accurately displays your active tier, free plan status, and device allowances."},{"title":"Visual Polish & Typography","description":"Upgraded the entire application interface to refined executive typography with tabular figures, eliminating layout jitter in tab titles, dock counters, and timestamps across high-DPI displays."}]},{"version":"1.3.5","tag":"v1.3.5","title":"Tab & Workspace Persistence, Active Profile Focus Rings & Clean Workspace Teardown","publishedAt":"2026-10-04","categories":[{"category":"Features","items":[{"title":"Tab & Workspace Persistence","description":"Active tabs and split panes now remain loaded and instantly available when minimizing the window, switching workspaces, or navigating between tabs."},{"title":"Workflow State Preservation","description":"In-progress text entries, form fields, and scroll positions are now automatically preserved and restored seamlessly across workspace transitions."},{"title":"Background Media Continuity","description":"Background audio streams and active calls now remain connected without interruption or premature freezing when navigating away."},{"title":"Active Profile Focus Rings","description":"Focus rings now dynamically reflect profile accent colors when switching accounts or air-gapped sessions."}]},{"category":"Improvements","items":[{"title":"Docked Canvas Inset Persistence","description":"Window layout preference for docked inset mode is now remembered and automatically restored on startup."},{"title":"Process Responsiveness","description":"Streamlined background process scheduling for instant response times when multitasking across multiple workspaces."},{"title":"High-Contrast Pricing Overview","description":"Refined pricing overview and license tier displays with high-contrast monochrome aesthetics and improved typography legibility."},{"title":"Workspace Protection & Onboarding","description":"Added inline deletion confirmation to prevent accidental removals, enforced protection on your sole remaining workspace, and set new app installations to start with a single clean default workspace."}]},{"category":"Bug Fixes","items":[{"title":"Workspace Teardown","description":"Resolved an issue where deleting a secondary workspace could leave behind a ghost icon and unresponsive tabs. Workspace teardown is now instantaneous and safely transitions to the fallback workspace."}]}],"highlights":[{"title":"Tab & Workspace Persistence","description":"Active tabs and split panes now remain loaded and instantly available when minimizing the window, switching workspaces, or navigating between tabs."},{"title":"Workflow State Preservation","description":"In-progress text entries, form fields, and scroll positions are now automatically preserved and restored seamlessly across workspace transitions."},{"title":"Docked Canvas Inset Persistence","description":"Window layout preference for docked inset mode is now remembered and automatically restored on startup."}]},{"version":"1.3.4","tag":"v1.3.4","title":"Resilient Auto-Updates & Direct Profile Navigation","publishedAt":"2026-10-04","categories":[{"category":"Features","items":[{"title":"Direct Profile Switcher","description":"The bottom-left profile switcher now directly opens the profile selection popover to instantly switch or manage account profiles."},{"title":"Hover Workspace Stack","description":"Settings, release notes, and feedback buttons now smoothly reveal above the profile switcher on hover, keeping workspace controls accessible without screen clutter."},{"title":"Precision Update Notifications","description":"Automatic version update notifications now proactively appear upon launch with a refined, distraction-free notification capsule that reflects our precision design language."}]},{"category":"Improvements","items":[{"title":"Resilient Multi-Tier Updates","description":"Introduced resilient multi-tier update fallback and seamless state preservation, preventing updates from getting interrupted or losing active tabs and layout sessions."},{"title":"Unified Release Notes Bar","description":"Streamlined the Release Notes view into a single unified action bar, removing redundant update banners and ensuring zero duplicate action prompts."}]}],"highlights":[{"title":"Direct Profile Switcher","description":"The bottom-left profile switcher now directly opens the profile selection popover to instantly switch or manage account profiles."},{"title":"Hover Workspace Stack","description":"Settings, release notes, and feedback buttons now smoothly reveal above the profile switcher on hover, keeping workspace controls accessible without screen clutter."},{"title":"Resilient Multi-Tier Updates","description":"Introduced resilient multi-tier update fallback and seamless state preservation, preventing updates from getting interrupted or losing active tabs and layout sessions."}]},{"version":"1.3.3","tag":"v1.3.3","title":"Persistent Active Tabs & Seamless Auto-Wake","publishedAt":"2026-09-29","categories":[{"category":"Features & Enhancements","items":[{"title":"Persistent Active Tab Continuity","description":"Split panes and views within your active tab now remain fully interactive and visible indefinitely without going to sleep while you are working in the app."},{"title":"Background Resource Conservation","description":"When minimizing the app, active tabs now automatically sleep in the background to free up system memory while preserving active audio playback and live calls."},{"title":"Zero-Click Auto-Wake","description":"Sleeping tabs now wake up and resume their exact scroll position automatically when clicked or when restoring the app window, eliminating the need to click a wake button."},{"title":"Memory Metrics in Command Palette","description":"Real-time memory metrics now display within the Command Palette, highlighting the exact amount of system RAM conserved by sleeping background tabs."}]},{"category":"Improvements & Fixes","items":[{"title":"Modifier & Middle-Click Split Routing","description":"Opening links while holding Ctrl/Cmd or via middle-click opens adjacent split panes up to a balanced quadrant grid, smoothly spilling over into new tabs once the limit is reached."},{"title":"Start Page Sleep Immunity","description":"Start pages and blank tabs are permanently immune to background sleep cycles, preventing unexpected blank reloading or redirect issues."},{"title":"Smooth Omnibar Transition","description":"Omnibar expansion now transitions smoothly without sudden layout shifts or involuntary resizing when searching."},{"title":"Webview Pointer & Cursor Precision","description":"Resolved edge cases causing cursor inversion or sticking during layout transitions and rapid mouse movements across split panels."}]}],"highlights":[{"title":"Persistent Active Tab Continuity","description":"Split panes and views within your active tab now remain fully interactive and visible indefinitely without going to sleep while you are working in the app."},{"title":"Background Resource Conservation","description":"When minimizing the app, active tabs now automatically sleep in the background to free up system memory while preserving active audio playback and live calls."},{"title":"Modifier & Middle-Click Split Routing","description":"Opening links while holding Ctrl/Cmd or via middle-click opens adjacent split panes up to a balanced quadrant grid, smoothly spilling over into new tabs once the limit is reached."}]},{"version":"1.3.2","tag":"v1.3.2","title":"Compact Context Menus, Precision Tools & Split-Screen Showcase","publishedAt":"2026-09-15","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.3.2/context-menu.webp","categories":[{"category":"Features","items":[{"title":"Compact Context Menus","description":"Redesigned the right-click menu into a compact, three-tier rotary layout with quick-navigation controls and smart tool grouping that reduces vertical height by over 60%."},{"title":"Adaptive Tool Memory","description":"Split and capture actions now remember your preferred defaults: clicking the primary button executes immediately, while selecting an alternate from the disclosure tray automatically sets it as your default for single-click actions."},{"title":"Precision Color Loupe","description":"Added a high-precision pixel loupe tool to sample colors directly from any workspace panel and copy color codes directly to the clipboard."},{"title":"Modernized Reader Mode","description":"Distraction-free reading view now features a floating capsule header with reading time estimates, source links, dynamic text sizing, and three calibrated surfaces (White, Sepia, and Charcoal)."},{"title":"Device Hardware Emulation","description":"Preview and test web pages across simulated mobile and tablet screen dimensions (iPhone, Pixel, and iPad) with automatic display fitting, orientation switching, hardware bezels, and one-key desktop escape."},{"title":"Progressive Split-Screen Showcase","description":"Interactive app directory now supports live split-screen previewing (up to 4 apps side-by-side or in a 2x2 grid) and dynamic tab creation for comparing enterprise and productivity tools."},{"title":"Seamless Auto-Updates","description":"In-app updates now download automatically in the background with discreet notifications, live transfer speed, progress tracking, and one-click restart when ready."}]},{"category":"Improvements","items":[{"title":"Native Context Arbiter","description":"Right-clicking video players and interactive web apps (such as YouTube, Figma, and Google Docs) surfaces the web application\'s native menu on the first click, while a consecutive click opens Apposition\'s workspace menu."},{"title":"Developer Tools Submenu","description":"Specialized site and developer inspection tools are organized inside a dedicated submenu, keeping the primary workspace menu clean and accessible for non-technical workflows."},{"title":"Clean Media & Link Actions","description":"Right-clicking images and links organizes copy and navigation actions into clean, dedicated submenus to prevent menu clutter."},{"title":"Shift Bypass Shortcut","description":"Holding Shift while right-clicking anywhere instantly presents Apposition\'s workspace menu, bypassing in-page menus."},{"title":"Empty Panel Context Menu","description":"Right-clicking empty workspace panels provides instant workspace and layout controls, while preserving native text selection inside input fields."},{"title":"Instant Split Hub Access","description":"Creating a split pane immediately loads the workspace hub with instant command bar focus, keyboard shortcuts, and app catalog access."},{"title":"High-Contrast Tab Depth","description":"Tab icons now render inside a crisp, high-contrast container with refined borders and physical depth, ensuring dark brand marks and favicons remain legible across all workspace themes."},{"title":"Dedicated Full App Catalog","description":"The full 50+ application catalog is accessible via a dedicated view at the bottom of the directory with smooth category navigation."},{"title":"Synchronized Update Controls","description":"Synchronized update controls across Settings and the Release Notes viewer, ensuring consistent version status and one-click installation from either view."}]},{"category":"Bug Fixes","items":[{"title":"Clipboard Image Copying","description":"Copying images directly from web pages to the clipboard now functions reliably across all websites."}]}],"highlights":[{"title":"Compact Context Menus","description":"Redesigned the right-click menu into a compact, three-tier rotary layout with quick-navigation controls and smart tool grouping that reduces vertical height by over 60%."},{"title":"Adaptive Tool Memory","description":"Split and capture actions now remember your preferred defaults: clicking the primary button executes immediately, while selecting an alternate from the disclosure tray automatically sets it as your default for single-click actions."},{"title":"Native Context Arbiter","description":"Right-clicking video players and interactive web apps (such as YouTube, Figma, and Google Docs) surfaces the web application\'s native menu on the first click, while a consecutive click opens Apposition\'s workspace menu."}]},{"version":"1.3.1","tag":"v1.3.1","title":"Persistent Media Continuity, Live Audio Equalizer & Tactile Edge Navigation","publishedAt":"2026-09-12","categories":[{"category":"Features","items":[{"title":"Persistent Media Playback Continuity","description":"Streaming media and video playback now reliably remember and restore your exact playback timestamp across page reloads and tab switches, seamlessly resuming where you left off."},{"title":"Interactive Audio Equalizer & Smart Indicator","description":"Active audio sessions now display a synchronized live visual equalizer across workspace tabs and the master dock control, intelligently pausing the animation when audio is muted, paused, or finished."},{"title":"Communicator App Reload","description":"Added a dedicated reload button in the Communicator header to quickly refresh active web apps with visual feedback."}]},{"category":"Improvements","items":[{"title":"Fluid Drag-and-Drop Spatial Previews","description":"When dragging a tab or panel to split the screen or dock against the entire window, existing panels now smoothly glide and compress out of the way with responsive spring transitions, showing an exact live preview of the resulting layout before you release."},{"title":"Tactile Edge Navigation Shelves","description":"Dragging panels to screen edges to navigate between tabs or workspaces now reveals flush, tactile bezel shelves with circular tension rings and target previews, featuring vertical shelves along the window sides for tabs and horizontal shelves along the top and bottom for workspaces."},{"title":"Real-Time Profile Details","description":"The profile switcher now updates instantly when signing into an account in any split pane, and displays connected account counts with detailed hover summaries."}]},{"category":"Bug Fixes","items":[{"title":"Automatic Account Identification","description":"Resolved an issue where signed-in accounts across workspaces were displayed with generic provider placeholders instead of their actual email address or username."},{"title":"Workspace Airspace & Transitions","description":"Resolved an issue where switching workspaces, creating tabs, or splitting panes could cause panels to briefly flicker or display placeholder states, ensuring native web views remain instantly responsive."},{"title":"Continuous Background Web Sessions","description":"Background tabs and workspaces maintain their active state without unexpected reloads, preserving video progress, unsaved form inputs, and active sessions."},{"title":"Communicator Popovers & Settings","description":"Interacting with stack settings, app configuration menus, or account pickers no longer causes the Communicator drawer to inadvertently close."},{"title":"Stable Drag Focus & Screen-Edge Navigation","description":"Resolved an issue where the active panel focus ring could jitter or rapidly ping-pong while dragging panels across workspaces, and eliminated rapid duplicate tab creation when dragging near the screen edges."},{"title":"Intelligent Semantic Tab Naming","description":"Tabs now intelligently resolve authentic board, document, and channel names from live web applications, preventing cryptic database IDs, random alphanumeric routing slugs, or static brand placeholders from appearing on tabs."},{"title":"Intelligent Omnibar & Search Navigation","description":"Searching for apps like Gmail, Figma, or Notion now directly launches the application upon pressing Enter, while queries containing search terms like tutorials or tips dynamically prioritize web search results without false positives."}]}],"highlights":[{"title":"Persistent Media Playback Continuity","description":"Streaming media and video playback now reliably remember and restore your exact playback timestamp across page reloads and tab switches, seamlessly resuming where you left off."},{"title":"Interactive Audio Equalizer & Smart Indicator","description":"Active audio sessions now display a synchronized live visual equalizer across workspace tabs and the master dock control, intelligently pausing the animation when audio is muted, paused, or finished."},{"title":"Fluid Drag-and-Drop Spatial Previews","description":"When dragging a tab or panel to split the screen or dock against the entire window, existing panels now smoothly glide and compress out of the way with responsive spring transitions, showing an exact live preview of the resulting layout before you release."}]},{"version":"1.3.0","tag":"v1.3.0","title":"Introducing the App Directory, Dedicated Release Feed & Fluid Multi-Pane Navigation","publishedAt":"2026-09-11","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.3.0/app-directory.webp","categories":[{"category":"Features","items":[{"title":"Introducing the App Directory","description":"Discover, search, and launch hundreds of web apps organized across curated categories. Features an adaptive layout that provides full app details even in compact split panes, fluid 3D magnetic hover physics, instant keyboard navigation, and zero-stutter scrolling."},{"title":"Dedicated Product Changelog","description":"Browse release notes, search past updates, filter by category, and subscribe via RSS feeds directly inside the app."},{"title":"Tactile App Shortcuts & Split Dock","description":"Pinned shortcuts and stacked split sessions now feature tactile cursor-tracking 3D tilt with smooth elevation, keeping each shortcut isolated while completely preventing dock shift or hover flickering in narrow panels."},{"title":"Flexible Annual Plan","description":"Added a streamlined annual subscription ($120/year) alongside the limited Founder Lifetime License."}]},{"category":"Improvements","items":[{"title":"Minimalist Tab Titles","description":"Refined workspace tabs with a minimalist icon-focused view that smoothly reveals tab titles upon hover, while newly created tabs immediately present clear labels."},{"title":"In-App Release Notes Viewer","description":"Redesigned the update viewer with a spacious layout, one-click update checks, progressive instant loading, and direct web archive navigation."},{"title":"Visual Release Previews","description":"Key milestone release notes now display high-resolution visual previews directly within the in-app release viewer and website feed."},{"title":"Enhanced Motion & Performance","description":"Optimized motion, panel transitions, and scrolling performance across all workspace navigation views."},{"title":"Clean App Catalog","description":"Removed redundant duplicate listings and disambiguated service entries across shared domains."}]},{"category":"Bug Fixes","items":[{"title":"Workspace Airspace & Transitions","description":"Resolved an issue where switching workspaces or splitting panes could cause the address bar to temporarily blank out, the profile badge to flicker, or empty panes to display a blank screen."},{"title":"Search Input & Sleep Recovery","description":"Resolved an issue where opening the App Directory from a new tab could prevent typing into the search bar, and fixed a bug where waking the computer from sleep could cause the interface to temporarily disappear."},{"title":"Command Bar Behavior","description":"Prevented accidental transitions to notes when pressing Escape in the workspace search bar."}]}],"highlights":[{"title":"Introducing the App Directory","description":"Discover, search, and launch hundreds of web apps organized across curated categories. Features an adaptive layout that provides full app details even in compact split panes, fluid 3D magnetic hover physics, instant keyboard navigation, and zero-stutter scrolling."},{"title":"Dedicated Product Changelog","description":"Browse release notes, search past updates, filter by category, and subscribe via RSS feeds directly inside the app."},{"title":"Minimalist Tab Titles","description":"Refined workspace tabs with a minimalist icon-focused view that smoothly reveals tab titles upon hover, while newly created tabs immediately present clear labels."}]},{"version":"1.2.7","tag":"v1.2.7","title":"Smart Window Persistence, Dynamic Omnibar Expansion, and Instant Cold Starts","publishedAt":"2026-09-09","categories":[{"category":"Features","items":[{"title":"Smart Window Persistence & Multi-Monitor Recovery","description":"The desktop app now seamlessly remembers your window size, position, and maximized state across restarts, and automatically rescues windows onto your main screen if an external monitor is disconnected."},{"title":"Dynamic Omnibar Expansion","description":"The address search bar now smoothly expands into available window space when editing and seamlessly morphs back into place upon dismissal, while tab labels compress smoothly under pressure without visual overlap."},{"title":"Semantic Title Distillation","description":"Tabs now automatically distill deep page titles into concise sub-task labels like Proposals, Pull requests, or Inbox instead of repeating brand names, and single tabs collapse into clean icon capsules to keep your workspace header uncluttered."}]},{"category":"Improvements","items":[{"title":"Instant Cold Starts","description":"App startup and workspace launch times are now significantly faster, eliminating initial launch freezes and accelerating background tab hydration."},{"title":"Zero-Flicker Launch","description":"The application now opens instantaneously with a fully rendered workspace, eliminating initial blank window delays and keeping active tabs immediately responsive."}]},{"category":"Bug Fixes","items":[{"title":"Duplicate Split Prevention","description":"Splitting panes via keyboard shortcuts now reliably creates a single new pane, eliminating accidental duplicate splits."},{"title":"Split View Focus Synchronization","description":"Active pane navigation and panel closing now synchronize flawlessly across split views, ensuring shortcuts like Ctrl+W consistently close the selected pane."}]}],"highlights":[{"title":"Smart Window Persistence","description":"Apposition automatically remembers your window positions and multi-monitor layouts across restarts."},{"title":"Dynamic Omnibar Expansion","description":"The address and search bar smoothly adapts to fit long queries and collapses into a compact capsule."},{"title":"Instant Cold Starts","description":"Workspaces and active panes now launch instantaneously with zero initial blank window lag."}]},{"version":"1.2.6","tag":"v1.2.6","title":"Seamless Workspace Dropdowns & Visual Branding Polish","publishedAt":"2026-09-09","categories":[{"category":"Improvements","items":[{"title":"Consolidated Brand Mark","description":"Updated all application installer assets and web icons to consistently display the refreshed brand mark across tabs and installer dialogs."}]},{"category":"Bug Fixes","items":[{"title":"Dropdown Menu Stability","description":"Resolved an issue where dropdown menus, selection filters, and model pickers in web workspaces would immediately collapse when clicked."},{"title":"Address Bar Hijack Guard","description":"Resolved an issue where websites containing embedded frames or interactive widgets could unexpectedly hijack the active tab address bar."}]}],"highlights":[{"title":"Dropdown Menu Stability","description":"Dropdown pickers and menus in web applications now stay open reliably during interaction."},{"title":"Address Bar Hijack Guard","description":"Embedded iframes are prevented from modifying tab address state unexpectedly."}]},{"version":"1.2.5","tag":"v1.2.5","title":"Self-Serve Device Licensing, Polished Brand Identity & 35% Partner Program","publishedAt":"2026-09-08","categories":[{"category":"Features","items":[{"title":"Self-Serve Device Licensing","description":"Added seamless in-app and web license checkout, self-serve device seat management directly from Account settings, and launched the 35% Partner Program."}]},{"category":"Improvements","items":[{"title":"Refreshed Visual Identity","description":"Updated the official application icon, website branding, and browser tab favicons with our new split-monolith visual identity."}]}],"highlights":[{"title":"Self-Serve Device Licensing","description":"Manage active device seats and license transfers directly from your Account settings screen."},{"title":"35% Partner Program","description":"Earn recurring rewards for referring teams and collaborators to Apposition."}]},{"version":"1.2.4","tag":"v1.2.4","title":"Silent Background Updates & Precision Workspace Controls","publishedAt":"2026-09-05","categories":[{"category":"Features","items":[{"title":"Dedicated Drawer Resize Controls","description":"Dedicated drawer resize controls in the header and settings menu to customize your workspace layout with precision."},{"title":"Silent Background Updates","description":"Seamless background application updates that download quietly and apply instantly upon restart without interrupting your work."}]},{"category":"Improvements","items":[{"title":"Smarter Omnibar Search Classification","description":"Reliably differentiates search queries from web addresses, ensuring terms like code snippets or decimal numbers open web searches correctly."},{"title":"Anchored Popover Dialogs","description":"Add App and Stack configuration menus now open cleanly as anchored popovers without dimming the workspace."}]},{"category":"Bug Fixes","items":[{"title":"Search Query Desync Fix","description":"Fixed an issue where search queries typed into the address bar were intermittently dropped or desynchronized when navigating."},{"title":"Google Search Redirection Guard","description":"Resolved unexpected authentication prompts and redirection loops when browsing Google search results."}]}],"highlights":[{"title":"Silent Background Updates","description":"Updates download in the background without popups or work interruptions."},{"title":"Workspace Drawer Controls","description":"Fine-tune sidebar and drawer dimensions with tactile resize handles."}]},{"version":"1.2.3","tag":"v1.2.3","title":"Workspace Isolation & Tab Management Polish","publishedAt":"2026-09-02","categories":[{"category":"Features","items":[{"title":"Strict Workspace Sandboxing","description":"Dedicated profile cookies and storage partitions across isolated tabs."}]},{"category":"Improvements","items":[{"title":"Fluid Tab Switching","description":"Zero-latency keyboard shortcuts to cycle through workspaces and tabs."}]}],"highlights":[{"title":"Strict Workspace Sandboxing","description":"Completely isolated session cookies and partitions per tab."}]},{"version":"1.2.2","tag":"v1.2.2","title":"Connected Account Detection & Precision Workspace Isolation","publishedAt":"2026-08-31","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.2.2/profile-isolation.webp","categories":[{"category":"Features","items":[{"title":"Added automated connected account detection","description":"Added automated connected account detection across workspace profiles with one-click authentication and live session status."},{"title":"Introduced instant email and handle","description":"Introduced instant email and handle copying, account filtering, and refined color themes for profile management."}]},{"category":"Improvements & Fixes","items":[{"title":"Restored seamless pointer event isolation","description":"Restored seamless pointer event isolation across multi-pane split layouts, preventing focus drift when interacting with profile popovers."},{"title":"Enhanced connected account identification and","description":"Enhanced connected account identification and avatar presentation in pane headers, omniboxes, and workspace menus."}]}],"highlights":[{"title":"Added automated connected account detection","description":"Added automated connected account detection across workspace profiles with one-click authentication and live session status."},{"title":"Introduced instant email and handle","description":"Introduced instant email and handle copying, account filtering, and refined color themes for profile management."},{"title":"Restored seamless pointer event isolation","description":"Restored seamless pointer event isolation across multi-pane split layouts, preventing focus drift when interacting with profile popovers."}]},{"version":"1.2.1","tag":"v1.2.1","title":"Floating Communicator Hub, Fluid Spatial Drag, and Workspace Interaction Polish","publishedAt":"2026-08-31","categories":[{"category":"Features","items":[{"title":"Introduced the Communicator Hub","description":"seamlessly access your messengers and work inboxes with instant hover peek, customizable stacks, session-isolated profiles, and full floating palette support."}]},{"category":"Improvements","items":[{"title":"Refined the Communicator Hub with","description":"Refined the Communicator Hub with fluid drag-to-float window physics, magnetic corner docking, and a streamlined capsule header."},{"title":"Streamlined messaging app layouts with","description":"Streamlined messaging app layouts with smooth zero-latency dragging and crisp edge-to-edge content framing for web apps like Gmail and Slack."},{"title":"Improved modal dialogs and overlay","description":"Improved modal dialogs and overlay menus to close smoothly on outside clicks or the Escape key."}]},{"category":"Bug Fixes","items":[{"title":"The floating Communicator now stays","description":"The floating Communicator now stays reliably on top of all workspace panes, eliminates visual bleed-through from background pages, and smoothly dismisses whenever you click outside."},{"title":"Fixed an issue where interacting","description":"Fixed an issue where interacting with web applications and links inside split panels could cause unexpected page reloads or unrendered views."}]}],"highlights":[{"title":"Introduced the Communicator Hub","description":"seamlessly access your messengers and work inboxes with instant hover peek, customizable stacks, session-isolated profiles, and full floating palette support."},{"title":"Refined the Communicator Hub with","description":"Refined the Communicator Hub with fluid drag-to-float window physics, magnetic corner docking, and a streamlined capsule header."},{"title":"Streamlined messaging app layouts with","description":"Streamlined messaging app layouts with smooth zero-latency dragging and crisp edge-to-edge content framing for web apps like Gmail and Slack."}]},{"version":"1.2.0","tag":"v1.2.0","title":"Next-Gen Spatial Engine & Universal Communicator","publishedAt":"2026-08-27","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.2.0/communicator-hub.webp","categories":[{"category":"Features","items":[{"title":"Universal Communicator Hub","description":"Unified floating messaging cluster for Slack, Gmail, Telegram, and Discord."},{"title":"Dynamic Split Panes","description":"Tactile drag-and-drop spatial multi-pane tiling with zero webview reloads."}]}],"highlights":[{"title":"Universal Communicator Hub","description":"Unified floating messaging cluster for all your daily apps."},{"title":"Dynamic Split Panes","description":"Tactile spatial tiling with zero pane reloads."}]},{"version":"1.1.8","tag":"v1.1.8","title":"Stability Fixes, Install Improvements & Google Sign-in Reliability","publishedAt":"2026-08-23","categories":[{"category":"Bug Fixes","items":[{"title":"Fixed a rare crash that","description":"Fixed a rare crash that could close the entire app unexpectedly while browsing."},{"title":"Resolved an issue where certain","description":"Resolved an issue where certain network requests and cross-origin authentications could cause the application to crash unexpectedly."}]},{"category":"Sign-in & Accounts","items":[{"title":"Signing in with Google now","description":"Signing in with Google now works reliably inside panels as well as the dedicated login window - including retries after a failed attempt."},{"title":"Google sign-in no longer interrupts","description":"Google sign-in no longer interrupts you with Windows passkey popups; it goes straight to password entry."}]},{"category":"Improvements","items":[{"title":"Streamlined one-click installation and clipboard","description":"Streamlined one-click installation and clipboard copy commands across download guides."}]}],"highlights":[{"title":"Streamlined one-click installation and clipboard","description":"Streamlined one-click installation and clipboard copy commands across download guides."}]},{"version":"1.1.7","tag":"v1.1.7","title":"Resilient Startup & Seamless Session Recovery","publishedAt":"2026-08-22","categories":[{"category":"Improvements & Bug Fixes","items":[{"title":"Resolved an intermittent startup interruption","description":"Resolved an intermittent startup interruption on desktop sessions and introduced automatic background session self-healing to seamlessly recover tabs and active workspaces."},{"title":"Streamlined cross-platform installer setup with","description":"Streamlined cross-platform installer setup with guided post-download instructions for smoother initial onboarding."},{"title":"Optimized modal rendering layers and","description":"Optimized modal rendering layers and window transitions for smoother workspace interactions."}]}],"highlights":[{"title":"Resolved an intermittent startup interruption","description":"Resolved an intermittent startup interruption on desktop sessions and introduced automatic background session self-healing to seamlessly recover tabs and active workspaces."},{"title":"Streamlined cross-platform installer setup with","description":"Streamlined cross-platform installer setup with guided post-download instructions for smoother initial onboarding."},{"title":"Optimized modal rendering layers and","description":"Optimized modal rendering layers and window transitions for smoother workspace interactions."}]},{"version":"1.1.6","tag":"v1.1.6","title":"Seamless Media Continuity, Instant Tab Restoration & Streamlined Installers","publishedAt":"2026-08-20","categories":[{"category":"Features","items":[{"title":"Background Media Continuity","description":"Playing videos and background audio now persist seamlessly without reloads or interruptions when switching between tabs and workspaces."},{"title":"Workspace-Isolated Audio Indicators","description":"Animated equalizer waves now indicate audio playback strictly within their active workspace."},{"title":"Streamlined Setup & Package Managers","description":"Introduced a distraction-free installation assistant with one-click terminal setup for macOS, Windows, and Linux, plus instant cryptographic verification."}]},{"category":"Improvements & Fixes","items":[{"title":"Instant Tab & Pane Undo","description":"Reopening closed tabs and split panes (Ctrl+Shift+T) is now instant, accompanied by a live visual undo notification showing site favicons."},{"title":"Immediate Split Pane Reflow","description":"Closing split panes now instantly reflows remaining views with zero delay and completely halts background audio upon close."},{"title":"Reliable Keyboard Navigation","description":"Workspace shortcuts now reliably trigger even when active web apps attempt to capture keyboard focus."}]}],"highlights":[{"title":"Background Media Continuity","description":"Playing videos and background audio now persist seamlessly without reloads or interruptions when switching between tabs and workspaces."},{"title":"Workspace-Isolated Audio Indicators","description":"Animated equalizer waves now indicate audio playback strictly within their active workspace."},{"title":"Instant Tab & Pane Undo","description":"Reopening closed tabs and split panes (Ctrl+Shift+T) is now instant, accompanied by a live visual undo notification showing site favicons."}]},{"version":"1.1.5","tag":"v1.1.5","title":"Spatial Navigation, Omnibox Browser Bar & Audio Multitasking","publishedAt":"2026-08-18","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.1.5/apposition-v1.1.5-spatial-navigation.png","categories":[{"category":"Features","items":[{"title":"Top-Center Omnibox Browser Bar","description":"Browser navigation bar with omnibox search suggestions, back/forward history, and quick layout actions."},{"title":"3-Way Spatial Layout Mode","description":"Toggle for docked, floating overlap, and full collapse views with persistent user preferences."},{"title":"Panel Dynamic Island & Focus Mode","description":"Distraction-free single-pane work triggered with Alt+F shortcut."}]},{"category":"Improvements","items":[{"title":"Responsive Soundwave Indicator","description":"Tabs display live soundwaves when audio is playing, with instant one-click muting."},{"title":"Synchronized Spatial Grid","description":"Refined window border margins, split gaps, and drop snap ghosts onto a synchronized grid."}]},{"category":"Bug Fixes","items":[{"title":"Window Control Hit-Testing","description":"Optimized window control responsiveness and hit-testing across all edge layout modes."}]}],"highlights":[{"title":"Top-Center Omnibox Browser Bar","description":"Instant search suggestions and quick layout actions right from the header."},{"title":"3-Way Spatial Layout Mode","description":"Docked, floating overlap, and full collapse workspace arrangements."},{"title":"Audio Indicator & 1-Click Mute","description":"Live soundwaves on active tabs with instant one-click muting."}]},{"version":"1.1.4","tag":"v1.1.4","title":"Multi-Profile Single Sign-On & Persistent Session Sync","publishedAt":"2026-08-18","categories":[{"category":"Features","items":[{"title":"Redesigned the profile manager with","description":"Redesigned the profile manager with an instant Single Sign-On provider bar, streamlined profile settings, and dynamic active pane detection."},{"title":"Added an interactive profile switcher","description":"Added an interactive profile switcher popover with the Alt+P shortcut and full arrow-key keyboard navigation."}]},{"category":"Improvements","items":[{"title":"Opening or splitting panes under","description":"Opening or splitting panes under the same profile now automatically synchronizes login sessions in real time."},{"title":"Profile switching preserves the exact","description":"Profile switching preserves the exact active webpage without accidental sign-outs."},{"title":"Profile switcher rows now feature","description":"Profile switcher rows now feature full-width selection highlights and floating hover micro-actions."}]},{"category":"Fixes","items":[{"title":"Switching profiles on a split","description":"Switching profiles on a split pane now instantly switches session partitions and cookies without latency."},{"title":"Active account logins and cookies","description":"Active account logins and cookies are now reliably preserved across app restarts and system sleep."},{"title":"Workspace quick-switching via Command Palette","description":"Workspace quick-switching via Command Palette now previews icons with keyboard navigation."}]}],"highlights":[{"title":"Redesigned the profile manager with","description":"Redesigned the profile manager with an instant Single Sign-On provider bar, streamlined profile settings, and dynamic active pane detection."},{"title":"Added an interactive profile switcher","description":"Added an interactive profile switcher popover with the Alt+P shortcut and full arrow-key keyboard navigation."},{"title":"Opening or splitting panes under","description":"Opening or splitting panes under the same profile now automatically synchronizes login sessions in real time."}]},{"version":"1.1.3","tag":"v1.1.3","title":"Seamless System Browser Sign-In, Workspace Context Menus & Enhanced Navigation","publishedAt":"2026-08-16","categories":[{"category":"Features","items":[{"title":"Seamless System Browser Sign-In","description":"Sign in to Google Workspace, Slack, Notion, and other protected services using your default browser with 1-click verification."},{"title":"Pane Context Menu & Reload Controls","description":"Right-click anywhere in an active pane to access quick navigation, clipboard tools, pane splitting, and workspace layout controls, or quickly refresh active panes using standard keyboard shortcuts (Ctrl+R / F5 / Ctrl+Shift+R)."},{"title":"History Jump Menu & Navigation Shortcuts","description":"Long-press or right-click the back/forward navigation buttons to open a visual jump menu with site icons, or navigate back and forward instantly using Ctrl+[ and Ctrl+]."},{"title":"Power-User Search Keywords","description":"Address inputs now resolve Google Search directly with instant search engine shortcut keywords for YouTube, GitHub, and Google Drive."}]},{"category":"Improvements","items":[{"title":"Performance & Memory Efficiency","description":"Dramatically reduced memory consumption and input latency when running demanding web applications like Canva and Figma, with smoother split resizing and faster workspace loading."},{"title":"Streamlined Single-Click Setup","description":"Windows installation is now completely silent and lock-free, with instant setup and automatic workspace layout restoration on launch."},{"title":"Fluid Floating Island Transitions","description":"Refined hovering and edge cursor tracking for floating window controls, preventing accidental window collapses and preserving direct click access to underlying web elements."}]},{"category":"Bug Fixes","items":[{"title":"Resilient Split Pane Sessions","description":"Closing a split pane no longer triggers unnecessary page reloads or active session interruptions in adjacent open panes."},{"title":"Reliable Embedded Shortcut Handling","description":"Fixed an issue where keyboard navigation shortcuts could become unresponsive while focused inside web panels, restoring instant focus upon clicking into any pane."},{"title":"Display Scaling Alignment","description":"Resolved an issue where interactive workspace preview tiles appeared scaled down or misaligned on smaller displays."},{"title":"Login Compatibility","description":"Eliminated unexpected firewall prompts and resolved authentication dialog blocks across third-party web services."}]}],"highlights":[{"title":"Seamless System Browser Sign-In","description":"Sign in to Google Workspace, Slack, Notion, and other protected services using your default browser with 1-click verification."},{"title":"Pane Context Menu & Reload Controls","description":"Right-click anywhere in an active pane to access quick navigation, clipboard tools, pane splitting, and workspace layout controls, or quickly refresh active panes using standard keyboard shortcuts (Ctrl+R / F5 / Ctrl+Shift+R)."},{"title":"Performance & Memory Efficiency","description":"Dramatically reduced memory consumption and input latency when running demanding web applications like Canva and Figma, with smoother split resizing and faster workspace loading."}]},{"version":"1.1.2","tag":"v1.1.2","title":"Zero-Reload Split Persistence & 120 FPS Resizing","publishedAt":"2026-08-13","categories":[{"category":"Improvements","items":[{"title":"Added options in the Windows","description":"Added options in the Windows installer to create Desktop and Start Menu shortcuts, and enable one-click launch immediately after installation."},{"title":"Integrated single-instance protection to prevent","description":"Integrated single-instance protection to prevent accidental duplicate instances and ensure smooth window focusing."},{"title":"Pane state and active documents","description":"Pane state and active documents now remain completely persistent without reloading during split navigation, tab changes, and dragging, alongside real-time 120 FPS split resizing."}]},{"category":"Bug Fixes","items":[{"title":"Fixed an issue where first-time","description":"Fixed an issue where first-time installations could render an empty screen by guaranteeing robust default workspace and tab initialization."}]}],"highlights":[{"title":"Added options in the Windows","description":"Added options in the Windows installer to create Desktop and Start Menu shortcuts, and enable one-click launch immediately after installation."},{"title":"Integrated single-instance protection to prevent","description":"Integrated single-instance protection to prevent accidental duplicate instances and ensure smooth window focusing."},{"title":"Pane state and active documents","description":"Pane state and active documents now remain completely persistent without reloading during split navigation, tab changes, and dragging, alongside real-time 120 FPS split resizing."}]},{"version":"1.1.1","tag":"v1.1.1","title":"Layout History, Spatial Keyboard Swapping & Crash Recovery","publishedAt":"2026-08-12","categories":[{"category":"Features","items":[{"title":"Added support for Layout History","description":"Added support for Layout History with Undo (Ctrl+Alt+Z) and Redo (Ctrl+Alt+Y), allowing you to instantly revert layout adjustments."},{"title":"Added keyboard shortcuts (Alt+Shift+Arrows) to","description":"Added keyboard shortcuts (Alt+Shift+Arrows) to swiftly swap adjacent panels or cycle stacking direction at screen edges."},{"title":"Added visual audio activity indicators","description":"Added visual audio activity indicators on active tabs to easily identify audio sources across complex multi-pane workspaces."},{"title":"Added intelligent address bar navigation","description":"Added intelligent address bar navigation for local development ports, alongside a one-click terminal install option."}]},{"category":"Improvements","items":[{"title":"Added tactile splitter handles, clean","description":"Added tactile splitter handles, clean boundary previews when docking panels, and a self-healing layout recovery system."},{"title":"Completely redesigned the pane toolbar","description":"Completely redesigned the pane toolbar with a jitter-free tactile aesthetic and refined double-bezel styling."},{"title":"Upgraded tab hover tooltips to","description":"Upgraded tab hover tooltips to instantly display rich session context with a polished tactile feel."},{"title":"Enhanced workspace docking and pane","description":"Enhanced workspace docking and pane splitting reliability with smoother drag transitions and robust offline session persistence."}]},{"category":"Bug Fixes","items":[{"title":"Fixed a startup crash on","description":"Fixed a startup crash on Windows and macOS caused by an engine compilation mismatch, and ensured the official Apposition icon displays correctly across all desktop platforms."},{"title":"Resolved an issue where dragging","description":"Resolved an issue where dragging panels in workspaces with multiple panes could cause duplicate panels, layout freezes, or dropped keyboard shortcuts."},{"title":"Resolved an issue where closing","description":"Resolved an issue where closing the final tab or pane in a workspace could cause the interface to freeze or display an empty background."},{"title":"Resolved navigation bugs that caused","description":"Resolved navigation bugs that caused the search input to occasionally lose typed text or drop focus when switching workspaces."},{"title":"Resolved an issue where rapidly","description":"Resolved an issue where rapidly switching workspaces could cause tabs to display the wrong environment."}]}],"highlights":[{"title":"Added support for Layout History","description":"Added support for Layout History with Undo (Ctrl+Alt+Z) and Redo (Ctrl+Alt+Y), allowing you to instantly revert layout adjustments."},{"title":"Added keyboard shortcuts (Alt+Shift+Arrows) to","description":"Added keyboard shortcuts (Alt+Shift+Arrows) to swiftly swap adjacent panels or cycle stacking direction at screen edges."},{"title":"Added tactile splitter handles, clean","description":"Added tactile splitter handles, clean boundary previews when docking panels, and a self-healing layout recovery system."}]},{"version":"1.1.0","tag":"v1.1.0","title":"Seamless Updates, Standalone Inspector & Draggable Tabs","publishedAt":"2026-08-12","categories":[{"category":"Features","items":[{"title":"Apposition now automatically detects new","description":"Apposition now automatically detects new versions and lets you restart to apply them with a single click."},{"title":"Added a manual \\"Check for","description":"Added a manual \\"Check for Updates\\" button in the Account Settings menu."},{"title":"Opening the Inspector (F12) now","description":"Opening the Inspector (F12) now launches a clean, standalone floating window instead of squeezing into a sidebar."},{"title":"You can now view our","description":"You can now view our latest release notes in a dedicated popover and submit feedback directly from the new sidebar Support Cluster without leaving your workspace."},{"title":"Opening external links from the","description":"Opening external links from the changelog now seamlessly creates a new workspace tab instead of launching an external browser."}]},{"category":"Improvements","items":[{"title":"Dragging a pane to the","description":"Dragging a pane to the edge of the screen to switch tabs or workspaces is now significantly faster, visually sharper, and correctly transfers the pane without it disappearing."},{"title":"Dragging a pane into an","description":"Dragging a pane into an empty tab now cleanly replaces it with a clear visual drop preview, and moving panes between tabs no longer leaves behind orphaned blank tabs."},{"title":"Dragging the last panel out","description":"Dragging the last panel out of a tab or workspace now automatically cleans up the empty space instead of leaving an abandoned tab."}]},{"category":"Bug Fixes","items":[{"title":"Re-engineered the window manager to","description":"Re-engineered the window manager to completely eliminate cursor jitter and flickering when hovering over panes, while ensuring floating buttons and menus remain perfectly responsive."},{"title":"Resolved multi-window shortcut conflicts, ensuring","description":"Resolved multi-window shortcut conflicts, ensuring actions like splitting panels, closing tabs, and swiping between workspaces are perfectly instantaneous and correctly targeted."},{"title":"Fixed an issue where the","description":"Fixed an issue where the search bar would not automatically receive keyboard focus when opening a new tab or switching back to an empty tab."},{"title":"Resolved an issue that caused","description":"Resolved an issue that caused active workspace panels to unexpectedly refresh or blink when opening the settings menu."}]}],"highlights":[{"title":"Apposition now automatically detects new","description":"Apposition now automatically detects new versions and lets you restart to apply them with a single click."},{"title":"Added a manual \\"Check for","description":"Added a manual \\"Check for Updates\\" button in the Account Settings menu."},{"title":"Dragging a pane to the","description":"Dragging a pane to the edge of the screen to switch tabs or workspaces is now significantly faster, visually sharper, and correctly transfers the pane without it disappearing."}]},{"version":"1.0.0","tag":"v1.0.0","title":"Initial Launch of Apposition","publishedAt":"2026-08-02","categories":[{"category":"Features","items":[{"title":"Multi-Pane Workspace Canvas","description":"The digital workspace designed for deep parallel work without tab chaos."}]}],"highlights":[{"title":"Multi-Pane Workspace Canvas","description":"Organize web applications and accounts in one unified window."}]}]');
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
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send("view.focus-wc", webContents.id);
      }
    });
    webContents.on("context-menu", (_event, params) => {
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send("view.context-menu-native", {
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
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send("pane.crashed", {
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
        } else if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          logger$6.info("Soft reloading main window via dev command");
          global.mainWindow.webContents.reload();
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
    } else if (electron.BrowserWindow.getAllWindows().length === 0) {
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
