"use strict";
const velopack = require("velopack");
const electron = require("electron");
const utils = require("@electron-toolkit/utils");
const path = require("path");
const fs = require("fs");
const child_process = require("child_process");
require("readline");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const os = require("os");
const promises = require("fs/promises");
const http = require("http");
const util = require("util");
const https = require("https");
const Sentry = require("@sentry/electron/main");
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
const logger$5 = new Logger("MAIN");
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
const ANTI_DETECTION_SCRIPT = String.raw`(function() {
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
})();`;
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
    "WebAuthentication,WebAuthenticationConditionalUI"
  );
  app.commandLine.appendSwitch(
    "force-webrtc-ip-handling-policy",
    "default_public_interface_only"
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
    instance.pragma("journal_mode = WAL");
    instance.pragma("synchronous = NORMAL");
    instance.pragma("busy_timeout = 5000");
    instance.pragma("mmap_size = 268435456");
    instance.pragma("temp_store = MEMORY");
    instance.pragma("cache_size = -64000");
  } catch (e) {
    console.warn("[SQLite Pragmas] Non-critical pragma warning:", e);
  }
}
function initDatabase() {
  try {
    const instance = new Database(dbPath);
    applyPragmas(instance);
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
      return freshInstance;
    } catch (fallbackErr) {
      console.error("[SQLite Fatal] Could not create disk DB, using in-memory fallback:", fallbackErr);
      const memInstance = new Database(":memory:");
      applyPragmas(memInstance);
      return memInstance;
    }
  }
}
const db = initDatabase();
initializeDatabaseSchema(db);
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
const FREE_CAPABILITIES = Object.freeze({
  tier: "free",
  maxWorkspaces: 2,
  maxTabsPerWorkspace: Infinity,
  maxActiveProfiles: 1,
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
  maxActiveProfiles: 1,
  maxFloatingPanes: 1,
  allowProxy: false,
  allowCustomUa: false,
  autoTabHibernation: false,
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
  return errCode === "user_email_required" || errCode === "missing_user_email" || errCode === "user_required" || errCode === "missing_user" || errCode === "email_missing" || errCode === "requires_email" || rawErrMsg.includes("user_email") || rawErrMsg.includes("email is required") || rawErrMsg.includes("email required") || rawErrMsg.includes("requires an email");
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
      payload.last_name = parts.length > 1 ? parts.slice(1).join(" ") : "";
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
const OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1e3;
const ONLINE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1e3;
const isDevMode$1 = () => utils.is.dev;
const shouldBypassGatekeep = () => utils.is.dev && process.env.FORCE_GATEKEEP !== "1";
const getCheckoutUrl = () => buildFreemiusCheckoutUrl(void 0, getMemoryAttribution());
async function activateLicenseKey(key, email) {
  if (!key || key.trim() === "") return { success: false, error: "License key is required." };
  const cleanKey = key.trim();
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
    isGracePeriod: false
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
      saveLicenseKey(cleanKey);
      saveLicenseState({
        ...cached,
        activated: true,
        lastChecked: now,
        key: cleanKey,
        installationId,
        expiresAt: apiRes.data.expiration || cached?.expiresAt || null,
        graceExpiresAt: now + OFFLINE_GRACE_PERIOD_MS,
        isGracePeriod: false
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
const FREEMIUS_PLAN_IDS = {
  APPSUMO_T1: 70966,
  APPSUMO_T2: 70967,
  APPSUMO_T3: 70968,
  APPSUMO_T1_PRICING: 96960,
  APPSUMO_T2_PRICING: 96962,
  APPSUMO_T3_PRICING: 96964,
  WEB_PRO: 65379
};
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
function resolveSafeWindowBounds(saved, displays, defaults = DEFAULT_WINDOW_DIMENSIONS) {
  const isMaximized = saved != null ? Boolean(saved.isMaximized) : true;
  const isFullScreen = Boolean(saved?.isFullScreen);
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
const log = createLogger("WINDOW");
class WindowStateManager {
  activeWindow = null;
  lastNormalBounds = { x: 0, y: 0, width: 1200, height: 800 };
  maximized = false;
  fullScreen = false;
  debounceTimer = null;
  displayRemovedListener = null;
  mapDisplays(displays) {
    const primaryId = electron.screen.getPrimaryDisplay()?.id;
    return displays.map((d) => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      isPrimary: d.id === primaryId
    }));
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
  shouldMaximize() {
    return this.maximized;
  }
  shouldFullScreen() {
    return this.fullScreen;
  }
  manage(win) {
    this.activeWindow = win;
    if (this.maximized) {
      try {
        win.maximize();
      } catch {
      }
    } else if (this.fullScreen) {
      try {
        win.setFullScreen(true);
      } catch {
      }
    }
    const onBoundsChange = () => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      if (win.isMaximized() || win.isFullScreen()) {
        this.maximized = win.isMaximized();
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
      if (this.activeWindow.isMaximized()) {
        this.maximized = true;
      } else if (!this.activeWindow.isMinimized()) {
        this.maximized = false;
      }
      this.fullScreen = this.activeWindow.isFullScreen();
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
  const win = new electron.BrowserWindow({
    x: initial.bounds.x,
    y: initial.bounds.y,
    width: initial.bounds.width,
    height: initial.bounds.height,
    icon: resolveAppIcon(),
    transparent: false,
    backgroundColor: "#F7F7F5",
    frame: false,
    show: false,
    webPreferences: {
      preload: resolvePreload("index.js"),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  windowStateManager.manage(win);
  win.__isMainWindow = true;
  global.mainWindow = win;
  global.overlayWindow = win;
  registerComposer(win);
  win.on("minimize", () => hibernationEngine.setAppMinimized(true));
  win.on("restore", () => hibernationEngine.setAppMinimized(false));
  win.on("blur", () => FocusArbiter.blur(win));
  win.on("focus", () => {
    if (!win.isMinimized()) hibernationEngine.setAppMinimized(false);
    const activePaneId = FocusArbiter.getActivePaneId(win.id);
    if (activePaneId) {
      FocusArbiter.focusGuest(win, activePaneId);
    } else {
      FocusArbiter.focusOverlay(win);
    }
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
    logger$5.warn(`[OVERLAY] Render process gone (${details.reason}, code: ${details.exitCode})`);
    if (details.reason !== "clean-exit" && !view.webContents.isDestroyed()) {
      setTimeout(() => {
        if (!view.webContents.isDestroyed()) {
          logger$5.info("[OVERLAY] Reloading app overlay view following crash...");
          loadOverlay();
        }
      }, 500);
    }
  });
  view.webContents.on("did-fail-load", (_event, errorCode, desc, validatedURL) => {
    if (utils.is.dev) {
      logger$5.warn(`[OVERLAY] Load failed (${errorCode}): ${desc} at ${validatedURL}`);
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
function initWindowManagerIpc() {
  electron.ipcMain.on("window.minimize", () => {
    global.mainWindow?.minimize();
  });
  electron.ipcMain.on("window.focus-main", () => {
    FocusArbiter.focusOverlay(global.mainWindow);
  });
  electron.ipcMain.on("app:focus-overlay-window", () => {
    FocusArbiter.focusOverlay(global.mainWindow);
  });
  electron.ipcMain.on("app.openInternalDevTools", () => {
    if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
      global.appOverlayView.webContents.openDevTools({ mode: "undocked" });
    }
  });
  electron.ipcMain.on("app.closeInternalDevTools", () => {
    if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
      global.appOverlayView.webContents.closeDevTools();
    }
  });
  electron.ipcMain.on("window.maximize", () => {
    const win = global.mainWindow;
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });
  electron.ipcMain.on("window.close", () => {
    global.mainWindow?.close();
  });
  initTearWindowIpc();
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
  const isTabJump = isMod && input.key === "Tab";
  const isAppShortcut = input.alt && isArrow || isMod && isArrow || isMod && (keyLower === "w" || keyLower === "t" || keyLower === "k" || keyLower === "l" || keyLower === "d" || keyLower === "f" || keyLower === "p" || keyLower === "n" || keyLower === "m" || keyLower === "e" || keyLower === "[" || keyLower === "]" || keyLower === "\\" || keyLower === "/") || input.alt && (keyLower === "d" || keyLower === "f" || keyLower === "p" || input.code === "Space") || isMod && isNum || input.alt && isNum || isZoom || isTabJump || input.key === "F11" || input.key === "F12" || isReload;
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
const DEFAULT_CHROME_VERSION = "144.0.7550.80";
const DEFAULT_DESKTOP_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${DEFAULT_CHROME_VERSION} Safari/537.36`;
const FIREFOX_AUTH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0";
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
    view.webContents.setZoomMode("isolated");
    view.webContents.setZoomFactor(1);
  } catch {
  }
  view.setBackgroundColor("#ffffff");
  if (typeof view.setBorderRadius === "function") view.setBorderRadius(12);
  view.webContents.session.setPermissionRequestHandler(
    (_, perm, cb) => cb(["clipboard-read", "clipboard-sanitized-write", "media", "display-capture", "fullscreen"].includes(perm))
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
    if (profile.proxy_server && caps.allowProxy) {
      ses.setProxy({ proxyRules: profile.proxy_server }).catch((e) => {
        console.error(`Failed to set proxy for session ${profileId}:`, e);
      });
    } else {
      ses.setProxy({}).catch(() => {
      });
    }
    if (profile.user_agent && profile.user_agent.trim()) {
      ses.setUserAgent(profile.user_agent.trim());
    }
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowed = ["notifications", "geolocation", "media", "screen"];
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
        throw new Error("Your current plan includes 1 account. Upgrade to Pro to add more accounts.");
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
      throw new Error("Free tier includes 2 workspaces. Upgrade to unlock unlimited workspaces.");
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
const version = "1.3.6";
const tag = "v1.3.6";
const title = "Multi-Tier License Activation, Multi-Device Seat Management & Precision Text Selection";
const publishedAt = "2026-10-07";
const categories = [{ "category": "Features", "items": [{ "title": "License Activation", "description": "AppSumo lifetime keys across all tiers now activate seamlessly with immediate device seat resolution and progressive verification that only prompts for details when necessary." }, { "title": "Account & Tiered Upgrades", "description": "In-app upgrade prompts now dynamically highlight the exact tier needed when expanding workspace capacity, adding account logins, or configuring dedicated proxies, while Account Settings accurately displays your active tier, free plan status, and device allowances." }, { "title": "Multi-Device Seat Management", "description": "Added an assigned devices overview to Account Settings, allowing multi-computer license holders to view active workstations and release seats with one click." }, { "title": "Founder Launch Offer", "description": "Made the limited Founder Lifetime Deal directly accessible and redeemable within the in-app upgrade screen with clear promotional rate disclosures." }] }, { "category": "Improvements", "items": [{ "title": "Visual Polish & Typography", "description": "Upgraded the entire application interface to refined executive typography with tabular figures, eliminating layout jitter in tab titles, dock counters, and timestamps across high-DPI displays." }, { "title": "Dock & Settings Access", "description": "Relocated Settings to the primary bottom-left dock anchor with instant shortcut access, eliminating popover overlaps on active screens." }, { "title": "Plan & Capability Specifications", "description": "Enhanced the in-app plan comparison matrix with a detailed breakdown of workspace limits, separate client logins, and proxy configuration across all tiers." }] }, { "category": "Bug Fixes", "items": [{ "title": "Web Pane Text Selection", "description": "Double-clicking and triple-clicking text in web panes now reliably selects words and paragraphs, restoring standard highlight and copy workflows." }, { "title": "Navigation History", "description": "Back and forward navigation now skips over duplicate URL redirects and page loops, remembering your full navigation history even after restarting the app or closing tabs, while removing distracting swipe animations to keep page navigation clearly distinct from tab switching." }, { "title": "Dropdown & Interaction Stability", "description": "Fixed an issue where web dropdown menus could prematurely collapse, and prevented accidental address bar expansion when clicking nearby toolbar controls." }] }];
const highlights = [{ "title": "License Activation", "description": "AppSumo lifetime keys across all tiers now activate seamlessly with immediate device seat resolution and progressive verification that only prompts for details when necessary." }, { "title": "Account & Tiered Upgrades", "description": "In-app upgrade prompts now dynamically highlight the exact tier needed when expanding workspace capacity, adding account logins, or configuring dedicated proxies, while Account Settings accurately displays your active tier, free plan status, and device allowances." }, { "title": "Visual Polish & Typography", "description": "Upgraded the entire application interface to refined executive typography with tabular figures, eliminating layout jitter in tab titles, dock counters, and timestamps across high-DPI displays." }];
const currentRelease = {
  version,
  tag,
  title,
  publishedAt,
  categories,
  highlights
};
const allReleases = /* @__PURE__ */ JSON.parse(`[{"version":"1.3.6","tag":"v1.3.6","title":"Multi-Tier License Activation, Multi-Device Seat Management & Precision Text Selection","publishedAt":"2026-10-07","categories":[{"category":"Features","items":[{"title":"License Activation","description":"AppSumo lifetime keys across all tiers now activate seamlessly with immediate device seat resolution and progressive verification that only prompts for details when necessary."},{"title":"Account & Tiered Upgrades","description":"In-app upgrade prompts now dynamically highlight the exact tier needed when expanding workspace capacity, adding account logins, or configuring dedicated proxies, while Account Settings accurately displays your active tier, free plan status, and device allowances."},{"title":"Multi-Device Seat Management","description":"Added an assigned devices overview to Account Settings, allowing multi-computer license holders to view active workstations and release seats with one click."},{"title":"Founder Launch Offer","description":"Made the limited Founder Lifetime Deal directly accessible and redeemable within the in-app upgrade screen with clear promotional rate disclosures."}]},{"category":"Improvements","items":[{"title":"Visual Polish & Typography","description":"Upgraded the entire application interface to refined executive typography with tabular figures, eliminating layout jitter in tab titles, dock counters, and timestamps across high-DPI displays."},{"title":"Dock & Settings Access","description":"Relocated Settings to the primary bottom-left dock anchor with instant shortcut access, eliminating popover overlaps on active screens."},{"title":"Plan & Capability Specifications","description":"Enhanced the in-app plan comparison matrix with a detailed breakdown of workspace limits, separate client logins, and proxy configuration across all tiers."}]},{"category":"Bug Fixes","items":[{"title":"Web Pane Text Selection","description":"Double-clicking and triple-clicking text in web panes now reliably selects words and paragraphs, restoring standard highlight and copy workflows."},{"title":"Navigation History","description":"Back and forward navigation now skips over duplicate URL redirects and page loops, remembering your full navigation history even after restarting the app or closing tabs, while removing distracting swipe animations to keep page navigation clearly distinct from tab switching."},{"title":"Dropdown & Interaction Stability","description":"Fixed an issue where web dropdown menus could prematurely collapse, and prevented accidental address bar expansion when clicking nearby toolbar controls."}]}],"highlights":[{"title":"License Activation","description":"AppSumo lifetime keys across all tiers now activate seamlessly with immediate device seat resolution and progressive verification that only prompts for details when necessary."},{"title":"Account & Tiered Upgrades","description":"In-app upgrade prompts now dynamically highlight the exact tier needed when expanding workspace capacity, adding account logins, or configuring dedicated proxies, while Account Settings accurately displays your active tier, free plan status, and device allowances."},{"title":"Visual Polish & Typography","description":"Upgraded the entire application interface to refined executive typography with tabular figures, eliminating layout jitter in tab titles, dock counters, and timestamps across high-DPI displays."}]},{"version":"1.3.5","tag":"v1.3.5","title":"Tab & Workspace Persistence, Active Profile Focus Rings & Clean Workspace Teardown","publishedAt":"2026-10-04","categories":[{"category":"Features","items":[{"title":"Tab & Workspace Persistence","description":"Active tabs and split panes now remain loaded and instantly available when minimizing the window, switching workspaces, or navigating between tabs."},{"title":"Workflow State Preservation","description":"In-progress text entries, form fields, and scroll positions are now automatically preserved and restored seamlessly across workspace transitions."},{"title":"Background Media Continuity","description":"Background audio streams and active calls now remain connected without interruption or premature freezing when navigating away."},{"title":"Active Profile Focus Rings","description":"Focus rings now dynamically reflect profile accent colors when switching accounts or air-gapped sessions."}]},{"category":"Improvements","items":[{"title":"Docked Canvas Inset Persistence","description":"Window layout preference for docked inset mode is now remembered and automatically restored on startup."},{"title":"Process Responsiveness","description":"Streamlined background process scheduling for instant response times when multitasking across multiple workspaces."},{"title":"High-Contrast Pricing Overview","description":"Refined pricing overview and license tier displays with high-contrast monochrome aesthetics and improved typography legibility."},{"title":"Workspace Protection & Onboarding","description":"Added inline deletion confirmation to prevent accidental removals, enforced protection on your sole remaining workspace, and set new app installations to start with a single clean default workspace."}]},{"category":"Bug Fixes","items":[{"title":"Workspace Teardown","description":"Resolved an issue where deleting a secondary workspace could leave behind a ghost icon and unresponsive tabs. Workspace teardown is now instantaneous and safely transitions to the fallback workspace."}]}],"highlights":[{"title":"Tab & Workspace Persistence","description":"Active tabs and split panes now remain loaded and instantly available when minimizing the window, switching workspaces, or navigating between tabs."},{"title":"Workflow State Preservation","description":"In-progress text entries, form fields, and scroll positions are now automatically preserved and restored seamlessly across workspace transitions."},{"title":"Docked Canvas Inset Persistence","description":"Window layout preference for docked inset mode is now remembered and automatically restored on startup."}]},{"version":"1.3.4","tag":"v1.3.4","title":"Resilient Auto-Updates & Direct Profile Navigation","publishedAt":"2026-10-04","categories":[{"category":"Features","items":[{"title":"Direct Profile Switcher","description":"The bottom-left profile switcher now directly opens the profile selection popover to instantly switch or manage account profiles."},{"title":"Hover Workspace Stack","description":"Settings, release notes, and feedback buttons now smoothly reveal above the profile switcher on hover, keeping workspace controls accessible without screen clutter."},{"title":"Precision Update Notifications","description":"Automatic version update notifications now proactively appear upon launch with a refined, distraction-free notification capsule that reflects our precision design language."}]},{"category":"Improvements","items":[{"title":"Resilient Multi-Tier Updates","description":"Introduced resilient multi-tier update fallback and seamless state preservation, preventing updates from getting interrupted or losing active tabs and layout sessions."},{"title":"Unified Release Notes Bar","description":"Streamlined the Release Notes view into a single unified action bar, removing redundant update banners and ensuring zero duplicate action prompts."}]}],"highlights":[{"title":"Direct Profile Switcher","description":"The bottom-left profile switcher now directly opens the profile selection popover to instantly switch or manage account profiles."},{"title":"Hover Workspace Stack","description":"Settings, release notes, and feedback buttons now smoothly reveal above the profile switcher on hover, keeping workspace controls accessible without screen clutter."},{"title":"Resilient Multi-Tier Updates","description":"Introduced resilient multi-tier update fallback and seamless state preservation, preventing updates from getting interrupted or losing active tabs and layout sessions."}]},{"version":"1.3.3","tag":"v1.3.3","title":"Persistent Active Tabs & Seamless Auto-Wake","publishedAt":"2026-09-29","categories":[{"category":"Features & Enhancements","items":[{"title":"Persistent Active Tab Continuity","description":"Split panes and views within your active tab now remain fully interactive and visible indefinitely without going to sleep while you are working in the app."},{"title":"Background Resource Conservation","description":"When minimizing the app, active tabs now automatically sleep in the background to free up system memory while preserving active audio playback and live calls."},{"title":"Zero-Click Auto-Wake","description":"Sleeping tabs now wake up and resume their exact scroll position automatically when clicked or when restoring the app window, eliminating the need to click a wake button."},{"title":"Memory Metrics in Command Palette","description":"Real-time memory metrics now display within the Command Palette, highlighting the exact amount of system RAM conserved by sleeping background tabs."}]},{"category":"Improvements & Fixes","items":[{"title":"Modifier & Middle-Click Split Routing","description":"Opening links while holding Ctrl/Cmd or via middle-click opens adjacent split panes up to a balanced quadrant grid, smoothly spilling over into new tabs once the limit is reached."},{"title":"Start Page Sleep Immunity","description":"Start pages and blank tabs are permanently immune to background sleep cycles, preventing unexpected blank reloading or redirect issues."},{"title":"Smooth Omnibar Transition","description":"Omnibar expansion now transitions smoothly without sudden layout shifts or involuntary resizing when searching."},{"title":"Webview Pointer & Cursor Precision","description":"Resolved edge cases causing cursor inversion or sticking during layout transitions and rapid mouse movements across split panels."}]}],"highlights":[{"title":"Persistent Active Tab Continuity","description":"Split panes and views within your active tab now remain fully interactive and visible indefinitely without going to sleep while you are working in the app."},{"title":"Background Resource Conservation","description":"When minimizing the app, active tabs now automatically sleep in the background to free up system memory while preserving active audio playback and live calls."},{"title":"Modifier & Middle-Click Split Routing","description":"Opening links while holding Ctrl/Cmd or via middle-click opens adjacent split panes up to a balanced quadrant grid, smoothly spilling over into new tabs once the limit is reached."}]},{"version":"1.3.2","tag":"v1.3.2","title":"Compact Context Menus, Precision Tools & Split-Screen Showcase","publishedAt":"2026-09-15","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.3.2/context-menu.webp","categories":[{"category":"Features","items":[{"title":"Compact Context Menus","description":"Redesigned the right-click menu into a compact, three-tier rotary layout with quick-navigation controls and smart tool grouping that reduces vertical height by over 60%."},{"title":"Adaptive Tool Memory","description":"Split and capture actions now remember your preferred defaults: clicking the primary button executes immediately, while selecting an alternate from the disclosure tray automatically sets it as your default for single-click actions."},{"title":"Precision Color Loupe","description":"Added a high-precision pixel loupe tool to sample colors directly from any workspace panel and copy color codes directly to the clipboard."},{"title":"Modernized Reader Mode","description":"Distraction-free reading view now features a floating capsule header with reading time estimates, source links, dynamic text sizing, and three calibrated surfaces (White, Sepia, and Charcoal)."},{"title":"Device Hardware Emulation","description":"Preview and test web pages across simulated mobile and tablet screen dimensions (iPhone, Pixel, and iPad) with automatic display fitting, orientation switching, hardware bezels, and one-key desktop escape."},{"title":"Progressive Split-Screen Showcase","description":"Interactive app directory now supports live split-screen previewing (up to 4 apps side-by-side or in a 2x2 grid) and dynamic tab creation for comparing enterprise and productivity tools."},{"title":"Seamless Auto-Updates","description":"In-app updates now download automatically in the background with discreet notifications, live transfer speed, progress tracking, and one-click restart when ready."}]},{"category":"Improvements","items":[{"title":"Native Context Arbiter","description":"Right-clicking video players and interactive web apps (such as YouTube, Figma, and Google Docs) surfaces the web application's native menu on the first click, while a consecutive click opens Apposition's workspace menu."},{"title":"Developer Tools Submenu","description":"Specialized site and developer inspection tools are organized inside a dedicated submenu, keeping the primary workspace menu clean and accessible for non-technical workflows."},{"title":"Clean Media & Link Actions","description":"Right-clicking images and links organizes copy and navigation actions into clean, dedicated submenus to prevent menu clutter."},{"title":"Shift Bypass Shortcut","description":"Holding Shift while right-clicking anywhere instantly presents Apposition's workspace menu, bypassing in-page menus."},{"title":"Empty Panel Context Menu","description":"Right-clicking empty workspace panels provides instant workspace and layout controls, while preserving native text selection inside input fields."},{"title":"Instant Split Hub Access","description":"Creating a split pane immediately loads the workspace hub with instant command bar focus, keyboard shortcuts, and app catalog access."},{"title":"High-Contrast Tab Depth","description":"Tab icons now render inside a crisp, high-contrast container with refined borders and physical depth, ensuring dark brand marks and favicons remain legible across all workspace themes."},{"title":"Dedicated Full App Catalog","description":"The full 50+ application catalog is accessible via a dedicated view at the bottom of the directory with smooth category navigation."},{"title":"Synchronized Update Controls","description":"Synchronized update controls across Settings and the Release Notes viewer, ensuring consistent version status and one-click installation from either view."}]},{"category":"Bug Fixes","items":[{"title":"Clipboard Image Copying","description":"Copying images directly from web pages to the clipboard now functions reliably across all websites."}]}],"highlights":[{"title":"Compact Context Menus","description":"Redesigned the right-click menu into a compact, three-tier rotary layout with quick-navigation controls and smart tool grouping that reduces vertical height by over 60%."},{"title":"Adaptive Tool Memory","description":"Split and capture actions now remember your preferred defaults: clicking the primary button executes immediately, while selecting an alternate from the disclosure tray automatically sets it as your default for single-click actions."},{"title":"Native Context Arbiter","description":"Right-clicking video players and interactive web apps (such as YouTube, Figma, and Google Docs) surfaces the web application's native menu on the first click, while a consecutive click opens Apposition's workspace menu."}]},{"version":"1.3.1","tag":"v1.3.1","title":"Persistent Media Continuity, Live Audio Equalizer & Tactile Edge Navigation","publishedAt":"2026-09-12","categories":[{"category":"Features","items":[{"title":"Persistent Media Playback Continuity","description":"Streaming media and video playback now reliably remember and restore your exact playback timestamp across page reloads and tab switches, seamlessly resuming where you left off."},{"title":"Interactive Audio Equalizer & Smart Indicator","description":"Active audio sessions now display a synchronized live visual equalizer across workspace tabs and the master dock control, intelligently pausing the animation when audio is muted, paused, or finished."},{"title":"Communicator App Reload","description":"Added a dedicated reload button in the Communicator header to quickly refresh active web apps with visual feedback."}]},{"category":"Improvements","items":[{"title":"Fluid Drag-and-Drop Spatial Previews","description":"When dragging a tab or panel to split the screen or dock against the entire window, existing panels now smoothly glide and compress out of the way with responsive spring transitions, showing an exact live preview of the resulting layout before you release."},{"title":"Tactile Edge Navigation Shelves","description":"Dragging panels to screen edges to navigate between tabs or workspaces now reveals flush, tactile bezel shelves with circular tension rings and target previews, featuring vertical shelves along the window sides for tabs and horizontal shelves along the top and bottom for workspaces."},{"title":"Real-Time Profile Details","description":"The profile switcher now updates instantly when signing into an account in any split pane, and displays connected account counts with detailed hover summaries."}]},{"category":"Bug Fixes","items":[{"title":"Automatic Account Identification","description":"Resolved an issue where signed-in accounts across workspaces were displayed with generic provider placeholders instead of their actual email address or username."},{"title":"Workspace Airspace & Transitions","description":"Resolved an issue where switching workspaces, creating tabs, or splitting panes could cause panels to briefly flicker or display placeholder states, ensuring native web views remain instantly responsive."},{"title":"Continuous Background Web Sessions","description":"Background tabs and workspaces maintain their active state without unexpected reloads, preserving video progress, unsaved form inputs, and active sessions."},{"title":"Communicator Popovers & Settings","description":"Interacting with stack settings, app configuration menus, or account pickers no longer causes the Communicator drawer to inadvertently close."},{"title":"Stable Drag Focus & Screen-Edge Navigation","description":"Resolved an issue where the active panel focus ring could jitter or rapidly ping-pong while dragging panels across workspaces, and eliminated rapid duplicate tab creation when dragging near the screen edges."},{"title":"Intelligent Semantic Tab Naming","description":"Tabs now intelligently resolve authentic board, document, and channel names from live web applications, preventing cryptic database IDs, random alphanumeric routing slugs, or static brand placeholders from appearing on tabs."},{"title":"Intelligent Omnibar & Search Navigation","description":"Searching for apps like Gmail, Figma, or Notion now directly launches the application upon pressing Enter, while queries containing search terms like tutorials or tips dynamically prioritize web search results without false positives."}]}],"highlights":[{"title":"Persistent Media Playback Continuity","description":"Streaming media and video playback now reliably remember and restore your exact playback timestamp across page reloads and tab switches, seamlessly resuming where you left off."},{"title":"Interactive Audio Equalizer & Smart Indicator","description":"Active audio sessions now display a synchronized live visual equalizer across workspace tabs and the master dock control, intelligently pausing the animation when audio is muted, paused, or finished."},{"title":"Fluid Drag-and-Drop Spatial Previews","description":"When dragging a tab or panel to split the screen or dock against the entire window, existing panels now smoothly glide and compress out of the way with responsive spring transitions, showing an exact live preview of the resulting layout before you release."}]},{"version":"1.3.0","tag":"v1.3.0","title":"Introducing the App Directory, Dedicated Release Feed & Fluid Multi-Pane Navigation","publishedAt":"2026-09-11","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.3.0/app-directory.webp","categories":[{"category":"Features","items":[{"title":"Introducing the App Directory","description":"Discover, search, and launch hundreds of web apps organized across curated categories. Features an adaptive layout that provides full app details even in compact split panes, fluid 3D magnetic hover physics, instant keyboard navigation, and zero-stutter scrolling."},{"title":"Dedicated Product Changelog","description":"Browse release notes, search past updates, filter by category, and subscribe via RSS feeds directly inside the app."},{"title":"Tactile App Shortcuts & Split Dock","description":"Pinned shortcuts and stacked split sessions now feature tactile cursor-tracking 3D tilt with smooth elevation, keeping each shortcut isolated while completely preventing dock shift or hover flickering in narrow panels."},{"title":"Flexible Annual Plan","description":"Added a streamlined annual subscription ($120/year) alongside the limited Founder Lifetime License."}]},{"category":"Improvements","items":[{"title":"Minimalist Tab Titles","description":"Refined workspace tabs with a minimalist icon-focused view that smoothly reveals tab titles upon hover, while newly created tabs immediately present clear labels."},{"title":"In-App Release Notes Viewer","description":"Redesigned the update viewer with a spacious layout, one-click update checks, progressive instant loading, and direct web archive navigation."},{"title":"Visual Release Previews","description":"Key milestone release notes now display high-resolution visual previews directly within the in-app release viewer and website feed."},{"title":"Enhanced Motion & Performance","description":"Optimized motion, panel transitions, and scrolling performance across all workspace navigation views."},{"title":"Clean App Catalog","description":"Removed redundant duplicate listings and disambiguated service entries across shared domains."}]},{"category":"Bug Fixes","items":[{"title":"Workspace Airspace & Transitions","description":"Resolved an issue where switching workspaces or splitting panes could cause the address bar to temporarily blank out, the profile badge to flicker, or empty panes to display a blank screen."},{"title":"Search Input & Sleep Recovery","description":"Resolved an issue where opening the App Directory from a new tab could prevent typing into the search bar, and fixed a bug where waking the computer from sleep could cause the interface to temporarily disappear."},{"title":"Command Bar Behavior","description":"Prevented accidental transitions to notes when pressing Escape in the workspace search bar."}]}],"highlights":[{"title":"Introducing the App Directory","description":"Discover, search, and launch hundreds of web apps organized across curated categories. Features an adaptive layout that provides full app details even in compact split panes, fluid 3D magnetic hover physics, instant keyboard navigation, and zero-stutter scrolling."},{"title":"Dedicated Product Changelog","description":"Browse release notes, search past updates, filter by category, and subscribe via RSS feeds directly inside the app."},{"title":"Minimalist Tab Titles","description":"Refined workspace tabs with a minimalist icon-focused view that smoothly reveals tab titles upon hover, while newly created tabs immediately present clear labels."}]},{"version":"1.2.7","tag":"v1.2.7","title":"Smart Window Persistence, Dynamic Omnibar Expansion, and Instant Cold Starts","publishedAt":"2026-09-09","categories":[{"category":"Features","items":[{"title":"Smart Window Persistence & Multi-Monitor Recovery","description":"The desktop app now seamlessly remembers your window size, position, and maximized state across restarts, and automatically rescues windows onto your main screen if an external monitor is disconnected."},{"title":"Dynamic Omnibar Expansion","description":"The address search bar now smoothly expands into available window space when editing and seamlessly morphs back into place upon dismissal, while tab labels compress smoothly under pressure without visual overlap."},{"title":"Semantic Title Distillation","description":"Tabs now automatically distill deep page titles into concise sub-task labels like Proposals, Pull requests, or Inbox instead of repeating brand names, and single tabs collapse into clean icon capsules to keep your workspace header uncluttered."}]},{"category":"Improvements","items":[{"title":"Instant Cold Starts","description":"App startup and workspace launch times are now significantly faster, eliminating initial launch freezes and accelerating background tab hydration."},{"title":"Zero-Flicker Launch","description":"The application now opens instantaneously with a fully rendered workspace, eliminating initial blank window delays and keeping active tabs immediately responsive."}]},{"category":"Bug Fixes","items":[{"title":"Duplicate Split Prevention","description":"Splitting panes via keyboard shortcuts now reliably creates a single new pane, eliminating accidental duplicate splits."},{"title":"Split View Focus Synchronization","description":"Active pane navigation and panel closing now synchronize flawlessly across split views, ensuring shortcuts like Ctrl+W consistently close the selected pane."}]}],"highlights":[{"title":"Smart Window Persistence","description":"Apposition automatically remembers your window positions and multi-monitor layouts across restarts."},{"title":"Dynamic Omnibar Expansion","description":"The address and search bar smoothly adapts to fit long queries and collapses into a compact capsule."},{"title":"Instant Cold Starts","description":"Workspaces and active panes now launch instantaneously with zero initial blank window lag."}]},{"version":"1.2.6","tag":"v1.2.6","title":"Seamless Workspace Dropdowns & Visual Branding Polish","publishedAt":"2026-09-09","categories":[{"category":"Improvements","items":[{"title":"Consolidated Brand Mark","description":"Updated all application installer assets and web icons to consistently display the refreshed brand mark across tabs and installer dialogs."}]},{"category":"Bug Fixes","items":[{"title":"Dropdown Menu Stability","description":"Resolved an issue where dropdown menus, selection filters, and model pickers in web workspaces would immediately collapse when clicked."},{"title":"Address Bar Hijack Guard","description":"Resolved an issue where websites containing embedded frames or interactive widgets could unexpectedly hijack the active tab address bar."}]}],"highlights":[{"title":"Dropdown Menu Stability","description":"Dropdown pickers and menus in web applications now stay open reliably during interaction."},{"title":"Address Bar Hijack Guard","description":"Embedded iframes are prevented from modifying tab address state unexpectedly."}]},{"version":"1.2.5","tag":"v1.2.5","title":"Self-Serve Device Licensing, Polished Brand Identity & 35% Partner Program","publishedAt":"2026-09-08","categories":[{"category":"Features","items":[{"title":"Self-Serve Device Licensing","description":"Added seamless in-app and web license checkout, self-serve device seat management directly from Account settings, and launched the 35% Partner Program."}]},{"category":"Improvements","items":[{"title":"Refreshed Visual Identity","description":"Updated the official application icon, website branding, and browser tab favicons with our new split-monolith visual identity."}]}],"highlights":[{"title":"Self-Serve Device Licensing","description":"Manage active device seats and license transfers directly from your Account settings screen."},{"title":"35% Partner Program","description":"Earn recurring rewards for referring teams and collaborators to Apposition."}]},{"version":"1.2.4","tag":"v1.2.4","title":"Silent Background Updates & Precision Workspace Controls","publishedAt":"2026-09-05","categories":[{"category":"Features","items":[{"title":"Dedicated Drawer Resize Controls","description":"Dedicated drawer resize controls in the header and settings menu to customize your workspace layout with precision."},{"title":"Silent Background Updates","description":"Seamless background application updates that download quietly and apply instantly upon restart without interrupting your work."}]},{"category":"Improvements","items":[{"title":"Smarter Omnibar Search Classification","description":"Reliably differentiates search queries from web addresses, ensuring terms like code snippets or decimal numbers open web searches correctly."},{"title":"Anchored Popover Dialogs","description":"Add App and Stack configuration menus now open cleanly as anchored popovers without dimming the workspace."}]},{"category":"Bug Fixes","items":[{"title":"Search Query Desync Fix","description":"Fixed an issue where search queries typed into the address bar were intermittently dropped or desynchronized when navigating."},{"title":"Google Search Redirection Guard","description":"Resolved unexpected authentication prompts and redirection loops when browsing Google search results."}]}],"highlights":[{"title":"Silent Background Updates","description":"Updates download in the background without popups or work interruptions."},{"title":"Workspace Drawer Controls","description":"Fine-tune sidebar and drawer dimensions with tactile resize handles."}]},{"version":"1.2.3","tag":"v1.2.3","title":"Workspace Isolation & Tab Management Polish","publishedAt":"2026-09-02","categories":[{"category":"Features","items":[{"title":"Strict Workspace Sandboxing","description":"Dedicated profile cookies and storage partitions across isolated tabs."}]},{"category":"Improvements","items":[{"title":"Fluid Tab Switching","description":"Zero-latency keyboard shortcuts to cycle through workspaces and tabs."}]}],"highlights":[{"title":"Strict Workspace Sandboxing","description":"Completely isolated session cookies and partitions per tab."}]},{"version":"1.2.2","tag":"v1.2.2","title":"Connected Account Detection & Precision Workspace Isolation","publishedAt":"2026-08-31","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.2.2/profile-isolation.webp","categories":[{"category":"Features","items":[{"title":"Added automated connected account detection","description":"Added automated connected account detection across workspace profiles with one-click authentication and live session status."},{"title":"Introduced instant email and handle","description":"Introduced instant email and handle copying, account filtering, and refined color themes for profile management."}]},{"category":"Improvements & Fixes","items":[{"title":"Restored seamless pointer event isolation","description":"Restored seamless pointer event isolation across multi-pane split layouts, preventing focus drift when interacting with profile popovers."},{"title":"Enhanced connected account identification and","description":"Enhanced connected account identification and avatar presentation in pane headers, omniboxes, and workspace menus."}]}],"highlights":[{"title":"Added automated connected account detection","description":"Added automated connected account detection across workspace profiles with one-click authentication and live session status."},{"title":"Introduced instant email and handle","description":"Introduced instant email and handle copying, account filtering, and refined color themes for profile management."},{"title":"Restored seamless pointer event isolation","description":"Restored seamless pointer event isolation across multi-pane split layouts, preventing focus drift when interacting with profile popovers."}]},{"version":"1.2.1","tag":"v1.2.1","title":"Floating Communicator Hub, Fluid Spatial Drag, and Workspace Interaction Polish","publishedAt":"2026-08-31","categories":[{"category":"Features","items":[{"title":"Introduced the Communicator Hub","description":"seamlessly access your messengers and work inboxes with instant hover peek, customizable stacks, session-isolated profiles, and full floating palette support."}]},{"category":"Improvements","items":[{"title":"Refined the Communicator Hub with","description":"Refined the Communicator Hub with fluid drag-to-float window physics, magnetic corner docking, and a streamlined capsule header."},{"title":"Streamlined messaging app layouts with","description":"Streamlined messaging app layouts with smooth zero-latency dragging and crisp edge-to-edge content framing for web apps like Gmail and Slack."},{"title":"Improved modal dialogs and overlay","description":"Improved modal dialogs and overlay menus to close smoothly on outside clicks or the Escape key."}]},{"category":"Bug Fixes","items":[{"title":"The floating Communicator now stays","description":"The floating Communicator now stays reliably on top of all workspace panes, eliminates visual bleed-through from background pages, and smoothly dismisses whenever you click outside."},{"title":"Fixed an issue where interacting","description":"Fixed an issue where interacting with web applications and links inside split panels could cause unexpected page reloads or unrendered views."}]}],"highlights":[{"title":"Introduced the Communicator Hub","description":"seamlessly access your messengers and work inboxes with instant hover peek, customizable stacks, session-isolated profiles, and full floating palette support."},{"title":"Refined the Communicator Hub with","description":"Refined the Communicator Hub with fluid drag-to-float window physics, magnetic corner docking, and a streamlined capsule header."},{"title":"Streamlined messaging app layouts with","description":"Streamlined messaging app layouts with smooth zero-latency dragging and crisp edge-to-edge content framing for web apps like Gmail and Slack."}]},{"version":"1.2.0","tag":"v1.2.0","title":"Next-Gen Spatial Engine & Universal Communicator","publishedAt":"2026-08-27","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.2.0/communicator-hub.webp","categories":[{"category":"Features","items":[{"title":"Universal Communicator Hub","description":"Unified floating messaging cluster for Slack, Gmail, Telegram, and Discord."},{"title":"Dynamic Split Panes","description":"Tactile drag-and-drop spatial multi-pane tiling with zero webview reloads."}]}],"highlights":[{"title":"Universal Communicator Hub","description":"Unified floating messaging cluster for all your daily apps."},{"title":"Dynamic Split Panes","description":"Tactile spatial tiling with zero pane reloads."}]},{"version":"1.1.8","tag":"v1.1.8","title":"Stability Fixes, Install Improvements & Google Sign-in Reliability","publishedAt":"2026-08-23","categories":[{"category":"Bug Fixes","items":[{"title":"Fixed a rare crash that","description":"Fixed a rare crash that could close the entire app unexpectedly while browsing."},{"title":"Resolved an issue where certain","description":"Resolved an issue where certain network requests and cross-origin authentications could cause the application to crash unexpectedly."}]},{"category":"Sign-in & Accounts","items":[{"title":"Signing in with Google now","description":"Signing in with Google now works reliably inside panels as well as the dedicated login window - including retries after a failed attempt."},{"title":"Google sign-in no longer interrupts","description":"Google sign-in no longer interrupts you with Windows passkey popups; it goes straight to password entry."}]},{"category":"Improvements","items":[{"title":"Streamlined one-click installation and clipboard","description":"Streamlined one-click installation and clipboard copy commands across download guides."}]}],"highlights":[{"title":"Streamlined one-click installation and clipboard","description":"Streamlined one-click installation and clipboard copy commands across download guides."}]},{"version":"1.1.7","tag":"v1.1.7","title":"Resilient Startup & Seamless Session Recovery","publishedAt":"2026-08-22","categories":[{"category":"Improvements & Bug Fixes","items":[{"title":"Resolved an intermittent startup interruption","description":"Resolved an intermittent startup interruption on desktop sessions and introduced automatic background session self-healing to seamlessly recover tabs and active workspaces."},{"title":"Streamlined cross-platform installer setup with","description":"Streamlined cross-platform installer setup with guided post-download instructions for smoother initial onboarding."},{"title":"Optimized modal rendering layers and","description":"Optimized modal rendering layers and window transitions for smoother workspace interactions."}]}],"highlights":[{"title":"Resolved an intermittent startup interruption","description":"Resolved an intermittent startup interruption on desktop sessions and introduced automatic background session self-healing to seamlessly recover tabs and active workspaces."},{"title":"Streamlined cross-platform installer setup with","description":"Streamlined cross-platform installer setup with guided post-download instructions for smoother initial onboarding."},{"title":"Optimized modal rendering layers and","description":"Optimized modal rendering layers and window transitions for smoother workspace interactions."}]},{"version":"1.1.6","tag":"v1.1.6","title":"Seamless Media Continuity, Instant Tab Restoration & Streamlined Installers","publishedAt":"2026-08-20","categories":[{"category":"Features","items":[{"title":"Background Media Continuity","description":"Playing videos and background audio now persist seamlessly without reloads or interruptions when switching between tabs and workspaces."},{"title":"Workspace-Isolated Audio Indicators","description":"Animated equalizer waves now indicate audio playback strictly within their active workspace."},{"title":"Streamlined Setup & Package Managers","description":"Introduced a distraction-free installation assistant with one-click terminal setup for macOS, Windows, and Linux, plus instant cryptographic verification."}]},{"category":"Improvements & Fixes","items":[{"title":"Instant Tab & Pane Undo","description":"Reopening closed tabs and split panes (Ctrl+Shift+T) is now instant, accompanied by a live visual undo notification showing site favicons."},{"title":"Immediate Split Pane Reflow","description":"Closing split panes now instantly reflows remaining views with zero delay and completely halts background audio upon close."},{"title":"Reliable Keyboard Navigation","description":"Workspace shortcuts now reliably trigger even when active web apps attempt to capture keyboard focus."}]}],"highlights":[{"title":"Background Media Continuity","description":"Playing videos and background audio now persist seamlessly without reloads or interruptions when switching between tabs and workspaces."},{"title":"Workspace-Isolated Audio Indicators","description":"Animated equalizer waves now indicate audio playback strictly within their active workspace."},{"title":"Instant Tab & Pane Undo","description":"Reopening closed tabs and split panes (Ctrl+Shift+T) is now instant, accompanied by a live visual undo notification showing site favicons."}]},{"version":"1.1.5","tag":"v1.1.5","title":"Spatial Navigation, Omnibox Browser Bar & Audio Multitasking","publishedAt":"2026-08-18","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.1.5/apposition-v1.1.5-spatial-navigation.png","categories":[{"category":"Features","items":[{"title":"Top-Center Omnibox Browser Bar","description":"Browser navigation bar with omnibox search suggestions, back/forward history, and quick layout actions."},{"title":"3-Way Spatial Layout Mode","description":"Toggle for docked, floating overlap, and full collapse views with persistent user preferences."},{"title":"Panel Dynamic Island & Focus Mode","description":"Distraction-free single-pane work triggered with Alt+F shortcut."}]},{"category":"Improvements","items":[{"title":"Responsive Soundwave Indicator","description":"Tabs display live soundwaves when audio is playing, with instant one-click muting."},{"title":"Synchronized Spatial Grid","description":"Refined window border margins, split gaps, and drop snap ghosts onto a synchronized grid."}]},{"category":"Bug Fixes","items":[{"title":"Window Control Hit-Testing","description":"Optimized window control responsiveness and hit-testing across all edge layout modes."}]}],"highlights":[{"title":"Top-Center Omnibox Browser Bar","description":"Instant search suggestions and quick layout actions right from the header."},{"title":"3-Way Spatial Layout Mode","description":"Docked, floating overlap, and full collapse workspace arrangements."},{"title":"Audio Indicator & 1-Click Mute","description":"Live soundwaves on active tabs with instant one-click muting."}]},{"version":"1.1.4","tag":"v1.1.4","title":"Multi-Profile Single Sign-On & Persistent Session Sync","publishedAt":"2026-08-18","categories":[{"category":"Features","items":[{"title":"Redesigned the profile manager with","description":"Redesigned the profile manager with an instant Single Sign-On provider bar, streamlined profile settings, and dynamic active pane detection."},{"title":"Added an interactive profile switcher","description":"Added an interactive profile switcher popover with the Alt+P shortcut and full arrow-key keyboard navigation."}]},{"category":"Improvements","items":[{"title":"Opening or splitting panes under","description":"Opening or splitting panes under the same profile now automatically synchronizes login sessions in real time."},{"title":"Profile switching preserves the exact","description":"Profile switching preserves the exact active webpage without accidental sign-outs."},{"title":"Profile switcher rows now feature","description":"Profile switcher rows now feature full-width selection highlights and floating hover micro-actions."}]},{"category":"Fixes","items":[{"title":"Switching profiles on a split","description":"Switching profiles on a split pane now instantly switches session partitions and cookies without latency."},{"title":"Active account logins and cookies","description":"Active account logins and cookies are now reliably preserved across app restarts and system sleep."},{"title":"Workspace quick-switching via Command Palette","description":"Workspace quick-switching via Command Palette now previews icons with keyboard navigation."}]}],"highlights":[{"title":"Redesigned the profile manager with","description":"Redesigned the profile manager with an instant Single Sign-On provider bar, streamlined profile settings, and dynamic active pane detection."},{"title":"Added an interactive profile switcher","description":"Added an interactive profile switcher popover with the Alt+P shortcut and full arrow-key keyboard navigation."},{"title":"Opening or splitting panes under","description":"Opening or splitting panes under the same profile now automatically synchronizes login sessions in real time."}]},{"version":"1.1.3","tag":"v1.1.3","title":"Seamless System Browser Sign-In, Workspace Context Menus & Enhanced Navigation","publishedAt":"2026-08-16","categories":[{"category":"Features","items":[{"title":"Seamless System Browser Sign-In","description":"Sign in to Google Workspace, Slack, Notion, and other protected services using your default browser with 1-click verification."},{"title":"Pane Context Menu & Reload Controls","description":"Right-click anywhere in an active pane to access quick navigation, clipboard tools, pane splitting, and workspace layout controls, or quickly refresh active panes using standard keyboard shortcuts (Ctrl+R / F5 / Ctrl+Shift+R)."},{"title":"History Jump Menu & Navigation Shortcuts","description":"Long-press or right-click the back/forward navigation buttons to open a visual jump menu with site icons, or navigate back and forward instantly using Ctrl+[ and Ctrl+]."},{"title":"Power-User Search Keywords","description":"Address inputs now resolve Google Search directly with instant search engine shortcut keywords for YouTube, GitHub, and Google Drive."}]},{"category":"Improvements","items":[{"title":"Performance & Memory Efficiency","description":"Dramatically reduced memory consumption and input latency when running demanding web applications like Canva and Figma, with smoother split resizing and faster workspace loading."},{"title":"Streamlined Single-Click Setup","description":"Windows installation is now completely silent and lock-free, with instant setup and automatic workspace layout restoration on launch."},{"title":"Fluid Floating Island Transitions","description":"Refined hovering and edge cursor tracking for floating window controls, preventing accidental window collapses and preserving direct click access to underlying web elements."}]},{"category":"Bug Fixes","items":[{"title":"Resilient Split Pane Sessions","description":"Closing a split pane no longer triggers unnecessary page reloads or active session interruptions in adjacent open panes."},{"title":"Reliable Embedded Shortcut Handling","description":"Fixed an issue where keyboard navigation shortcuts could become unresponsive while focused inside web panels, restoring instant focus upon clicking into any pane."},{"title":"Display Scaling Alignment","description":"Resolved an issue where interactive workspace preview tiles appeared scaled down or misaligned on smaller displays."},{"title":"Login Compatibility","description":"Eliminated unexpected firewall prompts and resolved authentication dialog blocks across third-party web services."}]}],"highlights":[{"title":"Seamless System Browser Sign-In","description":"Sign in to Google Workspace, Slack, Notion, and other protected services using your default browser with 1-click verification."},{"title":"Pane Context Menu & Reload Controls","description":"Right-click anywhere in an active pane to access quick navigation, clipboard tools, pane splitting, and workspace layout controls, or quickly refresh active panes using standard keyboard shortcuts (Ctrl+R / F5 / Ctrl+Shift+R)."},{"title":"Performance & Memory Efficiency","description":"Dramatically reduced memory consumption and input latency when running demanding web applications like Canva and Figma, with smoother split resizing and faster workspace loading."}]},{"version":"1.1.2","tag":"v1.1.2","title":"Zero-Reload Split Persistence & 120 FPS Resizing","publishedAt":"2026-08-13","categories":[{"category":"Improvements","items":[{"title":"Added options in the Windows","description":"Added options in the Windows installer to create Desktop and Start Menu shortcuts, and enable one-click launch immediately after installation."},{"title":"Integrated single-instance protection to prevent","description":"Integrated single-instance protection to prevent accidental duplicate instances and ensure smooth window focusing."},{"title":"Pane state and active documents","description":"Pane state and active documents now remain completely persistent without reloading during split navigation, tab changes, and dragging, alongside real-time 120 FPS split resizing."}]},{"category":"Bug Fixes","items":[{"title":"Fixed an issue where first-time","description":"Fixed an issue where first-time installations could render an empty screen by guaranteeing robust default workspace and tab initialization."}]}],"highlights":[{"title":"Added options in the Windows","description":"Added options in the Windows installer to create Desktop and Start Menu shortcuts, and enable one-click launch immediately after installation."},{"title":"Integrated single-instance protection to prevent","description":"Integrated single-instance protection to prevent accidental duplicate instances and ensure smooth window focusing."},{"title":"Pane state and active documents","description":"Pane state and active documents now remain completely persistent without reloading during split navigation, tab changes, and dragging, alongside real-time 120 FPS split resizing."}]},{"version":"1.1.1","tag":"v1.1.1","title":"Layout History, Spatial Keyboard Swapping & Crash Recovery","publishedAt":"2026-08-12","categories":[{"category":"Features","items":[{"title":"Added support for Layout History","description":"Added support for Layout History with Undo (Ctrl+Alt+Z) and Redo (Ctrl+Alt+Y), allowing you to instantly revert layout adjustments."},{"title":"Added keyboard shortcuts (Alt+Shift+Arrows) to","description":"Added keyboard shortcuts (Alt+Shift+Arrows) to swiftly swap adjacent panels or cycle stacking direction at screen edges."},{"title":"Added visual audio activity indicators","description":"Added visual audio activity indicators on active tabs to easily identify audio sources across complex multi-pane workspaces."},{"title":"Added intelligent address bar navigation","description":"Added intelligent address bar navigation for local development ports, alongside a one-click terminal install option."}]},{"category":"Improvements","items":[{"title":"Added tactile splitter handles, clean","description":"Added tactile splitter handles, clean boundary previews when docking panels, and a self-healing layout recovery system."},{"title":"Completely redesigned the pane toolbar","description":"Completely redesigned the pane toolbar with a jitter-free tactile aesthetic and refined double-bezel styling."},{"title":"Upgraded tab hover tooltips to","description":"Upgraded tab hover tooltips to instantly display rich session context with a polished tactile feel."},{"title":"Enhanced workspace docking and pane","description":"Enhanced workspace docking and pane splitting reliability with smoother drag transitions and robust offline session persistence."}]},{"category":"Bug Fixes","items":[{"title":"Fixed a startup crash on","description":"Fixed a startup crash on Windows and macOS caused by an engine compilation mismatch, and ensured the official Apposition icon displays correctly across all desktop platforms."},{"title":"Resolved an issue where dragging","description":"Resolved an issue where dragging panels in workspaces with multiple panes could cause duplicate panels, layout freezes, or dropped keyboard shortcuts."},{"title":"Resolved an issue where closing","description":"Resolved an issue where closing the final tab or pane in a workspace could cause the interface to freeze or display an empty background."},{"title":"Resolved navigation bugs that caused","description":"Resolved navigation bugs that caused the search input to occasionally lose typed text or drop focus when switching workspaces."},{"title":"Resolved an issue where rapidly","description":"Resolved an issue where rapidly switching workspaces could cause tabs to display the wrong environment."}]}],"highlights":[{"title":"Added support for Layout History","description":"Added support for Layout History with Undo (Ctrl+Alt+Z) and Redo (Ctrl+Alt+Y), allowing you to instantly revert layout adjustments."},{"title":"Added keyboard shortcuts (Alt+Shift+Arrows) to","description":"Added keyboard shortcuts (Alt+Shift+Arrows) to swiftly swap adjacent panels or cycle stacking direction at screen edges."},{"title":"Added tactile splitter handles, clean","description":"Added tactile splitter handles, clean boundary previews when docking panels, and a self-healing layout recovery system."}]},{"version":"1.1.0","tag":"v1.1.0","title":"Seamless Updates, Standalone Inspector & Draggable Tabs","publishedAt":"2026-08-12","categories":[{"category":"Features","items":[{"title":"Apposition now automatically detects new","description":"Apposition now automatically detects new versions and lets you restart to apply them with a single click."},{"title":"Added a manual \\"Check for","description":"Added a manual \\"Check for Updates\\" button in the Account Settings menu."},{"title":"Opening the Inspector (F12) now","description":"Opening the Inspector (F12) now launches a clean, standalone floating window instead of squeezing into a sidebar."},{"title":"You can now view our","description":"You can now view our latest release notes in a dedicated popover and submit feedback directly from the new sidebar Support Cluster without leaving your workspace."},{"title":"Opening external links from the","description":"Opening external links from the changelog now seamlessly creates a new workspace tab instead of launching an external browser."}]},{"category":"Improvements","items":[{"title":"Dragging a pane to the","description":"Dragging a pane to the edge of the screen to switch tabs or workspaces is now significantly faster, visually sharper, and correctly transfers the pane without it disappearing."},{"title":"Dragging a pane into an","description":"Dragging a pane into an empty tab now cleanly replaces it with a clear visual drop preview, and moving panes between tabs no longer leaves behind orphaned blank tabs."},{"title":"Dragging the last panel out","description":"Dragging the last panel out of a tab or workspace now automatically cleans up the empty space instead of leaving an abandoned tab."}]},{"category":"Bug Fixes","items":[{"title":"Re-engineered the window manager to","description":"Re-engineered the window manager to completely eliminate cursor jitter and flickering when hovering over panes, while ensuring floating buttons and menus remain perfectly responsive."},{"title":"Resolved multi-window shortcut conflicts, ensuring","description":"Resolved multi-window shortcut conflicts, ensuring actions like splitting panels, closing tabs, and swiping between workspaces are perfectly instantaneous and correctly targeted."},{"title":"Fixed an issue where the","description":"Fixed an issue where the search bar would not automatically receive keyboard focus when opening a new tab or switching back to an empty tab."},{"title":"Resolved an issue that caused","description":"Resolved an issue that caused active workspace panels to unexpectedly refresh or blink when opening the settings menu."}]}],"highlights":[{"title":"Apposition now automatically detects new","description":"Apposition now automatically detects new versions and lets you restart to apply them with a single click."},{"title":"Added a manual \\"Check for","description":"Added a manual \\"Check for Updates\\" button in the Account Settings menu."},{"title":"Dragging a pane to the","description":"Dragging a pane to the edge of the screen to switch tabs or workspaces is now significantly faster, visually sharper, and correctly transfers the pane without it disappearing."}]},{"version":"1.0.0","tag":"v1.0.0","title":"Initial Launch of Apposition","publishedAt":"2026-08-02","categories":[{"category":"Features","items":[{"title":"Multi-Pane Workspace Canvas","description":"The digital workspace designed for deep parallel work without tab chaos."}]}],"highlights":[{"title":"Multi-Pane Workspace Canvas","description":"Organize web applications and accounts in one unified window."}]}]`);
function initChangelogIpc() {
  electron.ipcMain.handle(IPC_CHANNELS.CHANGELOG.GET_STATUS, () => {
    const currentVersion = electron.app.getVersion();
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
  electron.ipcMain.handle(IPC_CHANNELS.CHANGELOG.MARK_SEEN, (_, version2) => {
    const targetVersion = version2 || electron.app.getVersion();
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
const patchedSessions = /* @__PURE__ */ new WeakSet();
function configureSessionSecurity(session) {
  if (!session || patchedSessions.has(session) || session.__securityHeadersBound) return;
  patchedSessions.add(session);
  session.__securityHeadersBound = true;
  const chromeVersion = process.versions.chrome || "144.0.7550.80";
  const clientHints = generateClientHints(chromeVersion, "Windows");
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
const DEFAULT_CACHE_QUOTA_BYTES = 250 * 1024 * 1024;
class StorageQuotaService {
  isPruning = false;
  async prunePartition(partition, thresholdBytes = DEFAULT_CACHE_QUOTA_BYTES) {
    try {
      const ses = electron.session.fromPartition(partition);
      const cacheSize = await ses.getCacheSize();
      if (cacheSize > thresholdBytes) {
        logger$5.info(
          `[StorageQuota] Partition ${partition} cache (${Math.round(cacheSize / 1024 / 1024)}MB) exceeds quota (${Math.round(thresholdBytes / 1024 / 1024)}MB). Pruning transient caches...`
        );
        await ses.clearStorageData({
          storages: ["shadercache", "serviceworkers", "cachestorage"]
        });
        await ses.clearCache();
        logger$5.info(`[StorageQuota] Partition ${partition} cache successfully pruned.`);
        return true;
      }
    } catch (err) {
      logger$5.debug(`[StorageQuota] Failed to prune partition ${partition}:`, err);
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
        logger$5.debug(`Flush failed for ${part}`, err);
      }
    }
    await electron.session.defaultSession.flushStorageData();
  } catch (e) {
    logger$5.warn("Failed to flush session storage", e);
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
    logger$5.debug(`Failed to attach cookie monitor for ${partition}`, e);
  }
}
function initSessionPersistenceHooks() {
  try {
    electron.powerMonitor.on("suspend", async () => {
      logger$5.info("System suspending - flushing session data to disk");
      await flushAllSessions();
      await storageQuota.pruneAllPartitions();
    });
    storageQuota.initBackgroundPruner();
    electron.powerMonitor.on("resume", () => {
      logger$5.info("System resumed from suspend - verifying app overlay and views");
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        syncAppOverlayBounds(global.mainWindow);
      }
      const overlay = global.appOverlayView;
      if (overlay && !overlay.webContents.isDestroyed()) {
        if (overlay.webContents.isCrashed()) {
          logger$5.info("[OVERLAY] Detected crashed overlay on wake, reloading...");
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
    logger$5.warn("PowerMonitor / Cookie monitor hook unavailable", e);
  }
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
const logger$4 = createLogger("UPDATE");
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
        logger$4.warn("Velopack UpdateManager init failed", err?.message || err);
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
      logger$4.warn("Velopack check failed", err?.message || err);
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
      logger$4.error("Velopack download failed", err?.message || err);
      throw err;
    }
  }
  async applyUpdate() {
    const um = this.getManager();
    if (!um || !this.pendingUpdateInfo) {
      throw new Error("No downloaded update to apply on Windows.");
    }
    logger$4.info("Applying Velopack update silently and restarting...");
    um.waitExitThenApplyUpdate(this.pendingUpdateInfo, true, true);
    electron.app.quit();
  }
}
const GITHUB_REPO = "jvondev/apposition-releases";
const LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const FALLBACK_CDN = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/releases.json`;
async function fetchLatestRelease() {
  try {
    const res = await fetch(LATEST_API, {
      headers: { "User-Agent": "Apposition-Desktop-Client" }
    });
    if (res.ok) {
      const data = await res.json();
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
const logger$3 = createLogger("UPDATE");
const execFileAsync = util.promisify(child_process.execFile);
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
    const release = await fetchLatestRelease();
    if (!release) return { hasUpdate: false };
    const currentVersion = electron.app.getVersion();
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
    logger$3.info(`Downloading macOS DMG from ${this.downloadUrl} to ${dmgPath}`);
    await downloadFileWithProgress(this.downloadUrl, dmgPath, onProgress);
    this.downloadedDmgPath = dmgPath;
    logger$3.info("macOS DMG download verified.");
  }
  async applyUpdate() {
    if (!this.downloadedDmgPath || !fs.existsSync(this.downloadedDmgPath)) {
      throw new Error("Downloaded DMG not found.");
    }
    const dmgPath = this.downloadedDmgPath;
    const tempDir = electron.app.getPath("temp");
    const mountDir = path.join(tempDir, `apposition-mount-${Date.now()}`);
    const destApp = "/Applications/Apposition.app";
    try {
      logger$3.info(`Mounting DMG ${dmgPath} to ${mountDir}`);
      await fs.promises.mkdir(mountDir, { recursive: true });
      await execFileAsync("hdiutil", ["attach", dmgPath, "-nobrowse", "-quiet", "-mountpoint", mountDir]);
      const entries = await fs.promises.readdir(mountDir);
      const appFolder = entries.find((e) => e.endsWith(".app"));
      if (!appFolder) {
        throw new Error("Could not find .app in mounted DMG.");
      }
      const srcApp = path.join(mountDir, appFolder);
      logger$3.info(`Replacing ${destApp} with ${srcApp}`);
      if (fs.existsSync(destApp)) {
        await fs.promises.rm(destApp, { recursive: true, force: true });
      }
      await fs.promises.cp(srcApp, destApp, { recursive: true });
      await execFileAsync("xattr", ["-dr", "com.apple.quarantine", destApp]).catch(() => {
      });
      await execFileAsync("hdiutil", ["detach", mountDir, "-quiet"]).catch(() => {
      });
      await fs.promises.rm(dmgPath, { force: true }).catch(() => {
      });
      logger$3.info("macOS in-place update completed. Relaunching application...");
      electron.app.relaunch({ execPath: path.join(destApp, "Contents/MacOS/Apposition") });
      electron.app.quit();
    } catch (err) {
      logger$3.error("Failed to perform in-place macOS update", err?.message || err);
      await execFileAsync("hdiutil", ["detach", mountDir, "-quiet"]).catch(() => {
      });
      throw err;
    }
  }
}
const logger$2 = createLogger("UPDATE");
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
        terminalCommand: "sudo dpkg -i apposition_*.deb"
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
    logger$2.info(`Downloading Linux AppImage from ${this.downloadUrl} to ${appImagePath}`);
    await downloadFileWithProgress(this.downloadUrl, appImagePath, onProgress);
    await fs.promises.chmod(appImagePath, 493);
    this.downloadedAppImagePath = appImagePath;
    logger$2.info("Linux AppImage download verified and made executable.");
  }
  async applyUpdate() {
    const currentAppImage = process.env.APPIMAGE;
    if (!this.downloadedAppImagePath || !currentAppImage || !fs.existsSync(this.downloadedAppImagePath)) {
      throw new Error("Target AppImage executable not found.");
    }
    logger$2.info(`Replacing ${currentAppImage} with ${this.downloadedAppImagePath}`);
    const targetDir = path.dirname(currentAppImage);
    const tempInSameDir = path.join(targetDir, `.${path.basename(currentAppImage)}.update-${Date.now()}`);
    try {
      await fs.promises.copyFile(this.downloadedAppImagePath, tempInSameDir);
      await fs.promises.chmod(tempInSameDir, 493);
      await fs.promises.rename(tempInSameDir, currentAppImage);
      await fs.promises.rm(this.downloadedAppImagePath, { force: true }).catch(() => {
      });
      logger$2.info("Linux AppImage in-place update completed. Relaunching application...");
      electron.app.relaunch({ execPath: currentAppImage });
      electron.app.quit();
    } catch (err) {
      await fs.promises.rm(tempInSameDir, { force: true }).catch(() => {
      });
      logger$2.error("Failed to perform in-place Linux update", err?.message || err);
      throw err;
    }
  }
}
const logger$1 = createLogger("UPDATE");
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
    logger$1.info(`Streaming Tier 2 fallback binary from ${this.downloadUrl} to ${destPath}`);
    await downloadFileWithProgress(this.downloadUrl, destPath, onProgress);
    if (process.platform !== "win32") {
      await fs.promises.chmod(destPath, 493).catch(() => {
      });
    }
    this.downloadedFilePath = destPath;
    logger$1.info("Tier 2 fallback binary verified and staged.");
    return destPath;
  }
  async applyUpdate() {
    if (!this.downloadedFilePath || !fs.existsSync(this.downloadedFilePath)) {
      throw new Error("Staged fallback installer not found.");
    }
    const installerPath = this.downloadedFilePath;
    logger$1.info(`Executing fallback update via: ${installerPath}`);
    if (process.platform === "win32") {
      const child2 = child_process.spawn(installerPath, ["/SILENT"], {
        detached: true,
        stdio: "ignore"
      });
      child2.unref();
      electron.app.quit();
      return;
    }
    if (process.platform === "linux" && process.env.APPIMAGE) {
      const currentAppImage = process.env.APPIMAGE;
      await fs.promises.copyFile(installerPath, currentAppImage);
      await fs.promises.chmod(currentAppImage, 493);
      electron.app.relaunch({ execPath: currentAppImage });
      electron.app.quit();
      return;
    }
    const child = child_process.spawn(installerPath, [], { detached: true, stdio: "ignore" });
    child.unref();
    electron.app.quit();
  }
  getRescueUrl() {
    return this.rescueUrl || "https://github.com/jvondev/apposition-releases/releases/latest";
  }
}
const fallbackEngine = new FallbackEngine();
const logger = createLogger("UPDATE");
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
  init() {
    logger.info(`UpdateEngine using driver: ${this.driver.name} (v${electron.app.getVersion()})`);
    setTimeout(() => this.checkForUpdates(true).catch((e) => logger.warn("Startup check failed", e?.message)), 1e4);
    setInterval(() => this.checkForUpdates(true).catch((e) => logger.warn("Periodic check failed", e?.message)), 4 * 3600 * 1e3);
    electron.powerMonitor.on("resume", () => this.checkForUpdates(true).catch((e) => logger.warn("Resume check failed", e?.message)));
  }
  getState() {
    return this.state;
  }
  broadcast(nextState) {
    this.state = nextState;
    const payload = { state: nextState };
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send(IPC_CHANNELS.EVENTS.UPDATE_STATE_CHANGED, payload);
    }
    if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
      global.appOverlayView.webContents.send(IPC_CHANNELS.EVENTS.UPDATE_STATE_CHANGED, payload);
    }
  }
  async checkForUpdates(isBackground = false) {
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
          logger.warn("Tier 1 check failed, attempting Tier 2 fallback", err?.message);
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
          this.downloadUpdate().catch((e) => logger.warn("Auto-download failed", e?.message));
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
            logger.warn("Tier 1 download failed, cascading to Tier 2", e?.message);
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
  async applyUpdate() {
    if (this.state.status !== "ready") {
      return { success: false, state: this.state, error: "Update is not ready to apply." };
    }
    try {
      logger.info("Executing pre-update state snapshot and session flush...");
      await flushAllSessions();
      if (this.state.tier === 2) {
        await fallbackEngine.applyUpdate();
      } else {
        await this.driver.applyUpdate();
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
          logger$5.info("Soft reloading app overlay view via dev command");
          global.appOverlayView.webContents.reload();
        } else if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          logger$5.info("Soft reloading main window via dev command");
          global.mainWindow.webContents.reload();
        }
      } else if (data.command === "quit") {
        logger$5.info("Gracefully quitting via dev command");
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
velopack.VelopackApp.build().run();
applyBrowserSwitches(electron.app);
const isDevMode = utils.is.dev || electron.app.getName().includes("Dev") || process.env.APP_ENV === "dev";
initMainSentry(isDevMode);
const isShowcase = process.env.APP_ENV === "showcase";
const isolatedDir = process.env.APP_ISOLATED_DIR;
if (isShowcase || isolatedDir) {
  electron.app.setName("Apposition Showcase");
  try {
    const targetDir = isolatedDir || path.join(electron.app.getPath("appData"), "AppositionShowcase");
    electron.app.setPath("userData", targetDir);
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
  let boot = function() {
    initUpdaterIpc();
    electron.Menu.setApplicationMenu(null);
    utils.electronApp.setAppUserModelId(
      isDevMode ? "com.jvondev.apposition.dev" : "com.jvondev.apposition.app"
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
    sessionIdentityService.init();
    initCatalogService();
    initCommunicatorIpc(() => global.mainWindow || void 0);
    initDiagnosticsIpc(logFile);
    initDevCommandBridge(isDevMode);
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
      electron.shell.openExternal(url);
    });
    const win = createWindow();
    const overlay = createAppOverlay(win);
    initPointerForwarder(() => global.mainWindow || void 0);
    initContextMenuCoordinator(() => global.mainWindow || void 0);
    initOverlayProjector(() => global.mainWindow || void 0, resolvePreload("index.js"));
    initPaneLifecycle(() => global.mainWindow || void 0);
    initTrpcIpcAdapter();
    screenCaptureService.init();
    hibernationEngine.init();
    let isShown = false;
    const showWindow = () => {
      if (!isShown && !win.isDestroyed()) {
        isShown = true;
        if (windowStateManager.shouldMaximize()) {
          win.maximize();
        }
        win.show();
        syncAppOverlayBounds(win);
      }
    };
    electron.ipcMain.once("app:ui-mounted", showWindow);
    overlay.webContents.once("dom-ready", () => {
      syncAppOverlayBounds(win);
      setTimeout(() => sessionIdentityService.scanAllProfiles().catch(() => {
      }), 15e3);
    });
    setTimeout(showWindow, 4e3);
    win.on("resize", () => {
      syncAppOverlayBounds(win);
      reRoundAllPanes(win);
    });
    win.on("restore", () => {
      syncAppOverlayBounds(win);
      reRoundAllPanes(win);
      invalidateAllPanes(win);
      global.appOverlayView?.webContents.send("app:window-restored");
    });
    electron.screen.on("display-metrics-changed", () => {
      syncAppOverlayBounds(win);
      reRoundAllPanes(win);
      repositionTransientOverlays(win);
    });
    win.on("closed", () => {
      unregisterAppShortcuts();
      composers.delete(win.id);
    });
    electron.app.on("activate", function() {
      if (electron.BrowserWindow.getAllWindows().length === 0) boot();
    });
  };
  const logFile = path.join(electron.app.getPath("userData"), "apposition.log");
  logger$5.setFileSink(logFile);
  runtimeState.init(path.join(electron.app.getPath("userData"), ".apposition-runtime.json"));
  if (isDevMode) {
    printStartupBanner(electron.app.getVersion(), logFile);
    initInteractiveTerminal(logFile);
  }
  process.on("uncaughtException", (err) => {
    runtimeState.incrementError();
    logger$5.fatal("Uncaught Exception in Main Process", err?.stack || err);
    captureMainException(err);
  });
  process.on("unhandledRejection", (reason) => {
    runtimeState.incrementError();
    logger$5.error("Unhandled Rejection in Main Process", reason);
    captureMainException(reason);
  });
  electron.app.on("second-instance", () => {
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      if (global.mainWindow.isMinimized()) global.mainWindow.restore();
      global.mainWindow.focus();
    }
  });
  initDeepLinking();
  electron.app.whenReady().then(boot);
  electron.app.on("before-quit", async () => {
    windowStateManager.flushSync();
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
      await flushAllSessions();
      destroyAllViews();
    } catch {
    }
    if (process.platform !== "darwin") electron.app.quit();
  });
}
