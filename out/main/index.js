"use strict";
const velopack = require("velopack");
const electron = require("electron");
const utils = require("@electron-toolkit/utils");
const path = require("path");
const fs = require("fs");
const child_process = require("child_process");
require("readline");
const Database = require("better-sqlite3");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const Sentry = require("@sentry/electron/main");
const promises = require("fs/promises");
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
const logger = new Logger("MAIN");
const createLogger = (domain, opts) => new Logger(domain, opts);
function printStartupBanner(version = "1.1.3", logFile = "apposition.log") {
  const isDev2 = typeof process !== "undefined" && process.env.NODE_ENV !== "production";
  if (!isDev2) return;
  console.log("");
  console.log("  \x1B[1m\x1B[37mApposition " + version + " (Development Environment)\x1B[0m");
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
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("max-active-webgl-contexts", "32");
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096");
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
    "IntensiveWakeUpThrottling,MediaRouter,WebAuthentication,WebAuthenticationConditionalUI,WebAuthenticationPermitLocalhost,FedCm"
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
const isDevMode$2 = utils.is.dev || electron.app.getName().includes("Dev") || process.env.APP_ENV === "dev";
const dbFileName = isDevMode$2 ? "apposition_state_dev.db" : "apposition_state.db";
const dbPath = path.join(electron.app.getPath("userData"), dbFileName);
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
db.exec(`
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
`);
try {
  db.exec("ALTER TABLE tabs ADD COLUMN layout_state TEXT");
} catch (e) {
}
try {
  db.exec("ALTER TABLE profiles ADD COLUMN is_ephemeral INTEGER DEFAULT 0");
} catch (e) {
}
try {
  db.exec("ALTER TABLE profiles ADD COLUMN proxy_server TEXT DEFAULT NULL");
} catch (e) {
}
try {
  db.exec("ALTER TABLE profiles ADD COLUMN user_agent TEXT DEFAULT NULL");
} catch (e) {
}
try {
  db.exec("ALTER TABLE profiles ADD COLUMN identities_json TEXT DEFAULT NULL");
} catch (e) {
}
try {
  db.exec(
    "ALTER TABLE workspaces ADD COLUMN default_profile_id TEXT DEFAULT NULL REFERENCES profiles(id) ON DELETE SET NULL"
  );
} catch (e) {
}
try {
  db.exec("ALTER TABLE workspaces ADD COLUMN icon TEXT DEFAULT NULL");
} catch (e) {
}
try {
  db.exec(
    "ALTER TABLE tabs ADD COLUMN default_profile_id TEXT DEFAULT NULL REFERENCES profiles(id) ON DELETE SET NULL"
  );
} catch (e) {
}
try {
  db.exec("ALTER TABLE tabs ADD COLUMN custom_name TEXT DEFAULT NULL");
} catch (e) {
}
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
function getWorkspaces() {
  const count = db.prepare("SELECT COUNT(*) as c FROM workspaces").get();
  if (count.c === 0) {
    createWorkspace("ws_personal", "Personal");
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
  const tabs = db.prepare("SELECT id FROM tabs WHERE workspace_id = ?").all(id);
  for (const t of tabs) {
    deleteTab(t.id);
  }
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
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
    const activeWsId = workspaceId || workspaces[0]?.id || "ws_personal";
    let tabs = getTabs(activeWsId);
    if (!tabs || tabs.length === 0) {
      const defaultTabId = `tab_${activeWsId}_main`;
      createTab(defaultTabId, activeWsId, "Main");
      tabs = getTabs(activeWsId);
    }
    return {
      workspaces,
      activeWorkspaceId: activeWsId,
      tabs,
      activeTabId: tabs[0]?.id || `tab_${activeWsId}_main`
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
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) as m FROM communicator_apps WHERE stack_id = ?").get(stackId).m;
  db.prepare(
    "INSERT INTO communicator_apps (id, stack_id, profile_id, name, url, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, stackId, profileId || "main", name, url, icon || "globe", maxOrder + 1, Date.now());
}
function updateCommunicatorApp(id, updates) {
  const current = db.prepare("SELECT * FROM communicator_apps WHERE id = ?").get(id);
  if (!current) return;
  const name = updates.name ?? current.name;
  const url = updates.url ?? current.url;
  const icon = updates.icon ?? current.icon;
  const profileId = updates.profileId ?? current.profile_id;
  const stackId = updates.stackId ?? current.stack_id;
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
    SAVE_TAB_LAYOUT: "db.saveTabLayout"
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
    PICK_COLOR: "view.pickColor"
  },
  SEARCH: {
    FIND_IN_ALL_PANES: "search.findInAllPanes",
    STOP_FIND: "search.stopFind"
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
    GET_KEY: "licensing.getKey",
    GET_STATE: "licensing.getState",
    CHECK_PREMIUM: "licensing.checkPremium",
    IS_DEV: "licensing.isDev"
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
  EVENTS: {
    VIEW_NAVIGATED: "view.navigated",
    VIEW_MEDIA_STATUS: "view.media-status",
    VIEW_CRASHED: "view.crashed",
    PROFILES_UPDATED: "app.profiles-updated",
    CONTEXT_MENU_NATIVE: "view.context-menu-native",
    VIEW_LOADED: "view.loaded"
  }
};
function getMachineKeyFilePath() {
  const userDataPath = electron.app.getPath("userData");
  return path.join(userDataPath, "apposition_machine.key");
}
function getOrCreateMachineKey() {
  const keyPath = getMachineKeyFilePath();
  if (fs.existsSync(keyPath)) {
    try {
      const hex = fs.readFileSync(keyPath, "utf8").trim();
      if (hex.length === 64) {
        return Buffer.from(hex, "hex");
      }
    } catch (e) {
      console.error("Failed to read machine key", e);
    }
  }
  const newKey = crypto.randomBytes(32);
  try {
    const userDataPath = electron.app.getPath("userData");
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    fs.writeFileSync(keyPath, newKey.toString("hex"), "utf8");
  } catch (e) {
    console.error("Failed to write machine key", e);
  }
  return newKey;
}
function encrypt(text) {
  try {
    const key = getOrCreateMachineKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${encrypted}:${authTag}`;
  } catch (e) {
    console.error("Encryption error", e);
    return text;
  }
}
function decrypt(encryptedText) {
  try {
    const key = getOrCreateMachineKey();
    const parts = encryptedText.split(":");
    if (parts.length !== 3) {
      return "";
    }
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (e) {
    console.error("Decryption error", e);
    return "";
  }
}
const POLAR_ORGANIZATION_ID = process.env.MAIN_VITE_POLAR_ORGANIZATION_ID || "5078246f-4a2f-45ff-8efa-0c42ddc4016e";
const POLAR_API_URL = process.env.MAIN_VITE_POLAR_API_URL || "https://api.polar.sh";
function getSavedLicenseKey() {
  try {
    const row = db.prepare("SELECT value FROM licensing WHERE key = 'license_key'").get();
    if (row && row.value) {
      return decrypt(row.value);
    }
  } catch (e) {
    console.error("Failed to get saved license key", e);
  }
  return null;
}
function saveLicenseKey(key) {
  try {
    const encryptedKey = encrypt(key);
    db.prepare(
      "INSERT OR REPLACE INTO licensing (key, value) VALUES ('license_key', ?)"
    ).run(encryptedKey);
  } catch (e) {
    console.error("Failed to save license key", e);
  }
}
function getSavedLicenseState() {
  try {
    const row = db.prepare("SELECT value FROM licensing WHERE key = 'license_state'").get();
    if (row && row.value) {
      const decrypted = decrypt(row.value);
      return JSON.parse(decrypted);
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
    db.prepare(
      "INSERT OR REPLACE INTO licensing (key, value) VALUES ('license_state', ?)"
    ).run(encryptedState);
  } catch (e) {
    console.error("Failed to save license state", e);
  }
}
function isDevMode$1() {
  return utils.is.dev;
}
function shouldBypassGatekeep() {
  return utils.is.dev && process.env.FORCE_GATEKEEP !== "1";
}
function getDeviceLabel() {
  try {
    return `${os.platform()}-${os.arch()}-${os.hostname()}`;
  } catch (e) {
    return "Desktop App User";
  }
}
async function activateLicenseKey(key) {
  if (!key || key.trim() === "") {
    return { success: false, error: "License key is required." };
  }
  const label = getDeviceLabel();
  try {
    const response = await fetch(
      `${POLAR_API_URL}/v1/customer-portal/license-keys/activate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: key.trim(),
          organization_id: POLAR_ORGANIZATION_ID,
          label
        })
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[Polar API Error]", response.status, errorData);
      let message = `Invalid license key (Error ${response.status})`;
      if (typeof errorData.detail === "string") {
        message = errorData.detail;
      } else if (Array.isArray(errorData.detail)) {
        message = errorData.detail[0]?.msg || message;
      } else if (errorData.message) {
        message = errorData.message;
      }
      return { success: false, error: message };
    }
    const data = await response.json();
    const customer = data.license_key?.customer;
    saveLicenseKey(key.trim());
    saveLicenseState({
      activated: true,
      lastChecked: Date.now(),
      key: key.trim(),
      activationId: data.id,
      label,
      expiresAt: data.license_key?.expires_at || null,
      customer: customer ? {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        avatar_url: customer.avatar_url
      } : null
    });
    return { success: true };
  } catch (e) {
    console.error("Failed to activate license key via Polar", e);
    return {
      success: false,
      error: e.message || "Network error. Please check your connection."
    };
  }
}
async function validateLicenseKey(key) {
  if (!key || key.trim() === "") {
    return { success: false, error: "License key is required." };
  }
  try {
    const response = await fetch(
      `${POLAR_API_URL}/v1/customer-portal/license-keys/validate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: key.trim(),
          organization_id: POLAR_ORGANIZATION_ID
        })
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[Polar API Validation Error]", response.status, errorData);
      let message = `Validation error (${response.status})`;
      if (typeof errorData.detail === "string") {
        message = errorData.detail;
      } else if (Array.isArray(errorData.detail)) {
        message = errorData.detail[0]?.msg || message;
      } else if (errorData.message) {
        message = errorData.message;
      }
      return { success: false, error: message };
    }
    const data = await response.json();
    const isValid = data.status === "granted" || data.valid === true;
    if (!isValid) {
      return { success: false, error: "License key is invalid or expired." };
    }
    saveLicenseKey(key.trim());
    const cachedState = getSavedLicenseState() || {};
    const customer = data.customer || data.license_key?.customer;
    saveLicenseState({
      ...cachedState,
      activated: true,
      lastChecked: Date.now(),
      key: key.trim(),
      expiresAt: data.expires_at || data.license_key?.expires_at || null,
      customer: customer ? {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        avatar_url: customer.avatar_url
      } : cachedState.customer
    });
    return { success: true };
  } catch (e) {
    console.error("Failed to validate license key via Polar", e);
    const cachedState = getSavedLicenseState();
    if (cachedState && cachedState.activated && cachedState.key === key.trim()) {
      const daysSinceCheck = (Date.now() - (cachedState.lastChecked || 0)) / (1e3 * 60 * 60 * 24);
      if (daysSinceCheck <= 7) {
        return { success: true };
      } else {
        return {
          success: false,
          error: "Offline grace period expired. Please connect to the internet."
        };
      }
    }
    return {
      success: false,
      error: e.message || "Network error. Please check your connection."
    };
  }
}
async function checkPremiumStatus() {
  try {
    if (shouldBypassGatekeep()) {
      return true;
    }
    const key = getSavedLicenseKey();
    if (!key) {
      return false;
    }
    const cachedState = getSavedLicenseState();
    if (!cachedState || !cachedState.activated) {
      return false;
    }
    const timeSinceLastCheck = Date.now() - (cachedState.lastChecked || 0);
    if (timeSinceLastCheck < 12 * 60 * 60 * 1e3) {
      return true;
    }
    const validation = await validateLicenseKey(key);
    return validation.success;
  } catch (e) {
    console.error("[Licensing] checkPremiumStatus safe error fallback:", e);
    return false;
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
  unregisterView(paneId) {
    const view = this.activeViews.get(paneId);
    if (view) {
      this.webContentsIdToPaneId.delete(view.webContents.id);
      this.activeViews.delete(paneId);
      this.viewProfiles.delete(paneId);
      this.stashedBounds.delete(paneId);
      this.hibernatedViews.delete(paneId);
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
const hibernatedViews = viewRegistry.hibernatedViews;
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
            headers: { "User-Agent": CHROME_UA, Referer: "https://accounts.google.com/" },
            signal: AbortSignal.timeout(1200)
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
          headers: { "User-Agent": CHROME_UA },
          signal: AbortSignal.timeout(1200)
        });
        if (myAcc.ok) {
          const html = await myAcc.text();
          const m = html.match(/aria-label="Google Account:[^"]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          if (m && !m[1].endsWith("@google.com")) foundEmail = m[1];
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
      email: foundEmail || "Google Account",
      displayName: foundName || foundEmail || "Google User",
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
      handle: username ? `@${username}` : "@github_user",
      email: username ? `@${username}` : "@github_user",
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
      email: email || "Microsoft 365",
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
      handle: email || "Apple ID",
      email: email || "Apple Account",
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
    return {
      id: "slack",
      providerId: "slack",
      handle: label || "Slack Workspace",
      email: label || "Slack Connected",
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
            headers: {
              authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
              "x-csrf-token": ct0
            },
            signal: AbortSignal.timeout(1200)
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
      handle: handle || "Discord User",
      email: handle || "Discord Account",
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
      handle: handle || "@gitlab_user",
      email: handle || "GitLab Account",
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
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(1200)
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
      handle: handle || "Figma Workspace",
      email: handle || "Figma Account",
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
      email: email || "Notion Workspace",
      handle: email || "Notion Account",
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
      handle: handle || "Linear Workspace",
      email: handle || "Linear Account",
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
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(1200)
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
      email: email || "ChatGPT Account",
      handle: email || "OpenAI User",
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
      handle: name || "Canva Workspace",
      email: name || "Canva Account",
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
      handle: handle ? `@${handle.replace(/^@/, "")}` : "Vercel User",
      email: handle ? `@${handle.replace(/^@/, "")}` : "Vercel Account",
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
    return {
      id: "stripe",
      providerId: "stripe",
      handle: label || "Stripe Merchant",
      email: label || "Stripe Account",
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
      handle: email || "Atlassian / Jira",
      email: email || "Atlassian Account",
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
class SessionIdentityService {
  observedSessions = /* @__PURE__ */ new Set();
  debounceTimers = /* @__PURE__ */ new Map();
  lastScanTime = /* @__PURE__ */ new Map();
  cachedResults = /* @__PURE__ */ new Map();
  getPartitionForProfile(profileId) {
    if (!profileId || profileId === "main") return "persist:main";
    try {
      const p = getProfileById(profileId);
      if (p?.is_ephemeral) return profileId;
    } catch {
    }
    return `persist:${profileId}`;
  }
  getSessionForProfile(profileId) {
    const partition = this.getPartitionForProfile(profileId);
    return electron.session.fromPartition(partition);
  }
  attachCookieObserver(profileId) {
    const partition = this.getPartitionForProfile(profileId);
    if (this.observedSessions.has(partition)) return;
    this.observedSessions.add(partition);
    try {
      const ses = electron.session.fromPartition(partition);
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
  async scanProfile(profileId, force = false) {
    const now = Date.now();
    const last = this.lastScanTime.get(profileId) || 0;
    if (!force && now - last < 5e3 && this.cachedResults.has(profileId)) {
      return this.cachedResults.get(profileId);
    }
    const ses = this.getSessionForProfile(profileId);
    const cookies = await ses.cookies.get({});
    const identities = {};
    await Promise.all(
      ALL_RESOLVERS.map(async (resolver) => {
        try {
          const identity = await resolver.resolveIdentity(ses, cookies);
          if (identity) {
            identities[resolver.providerId] = identity;
          }
        } catch (err) {
          console.warn(`[IdentityService] Resolver error for ${resolver.providerId}:`, err);
        }
      })
    );
    const serialized = JSON.stringify(identities);
    this.lastScanTime.set(profileId, now);
    this.cachedResults.set(profileId, identities);
    const current = getProfileById(profileId);
    if (current?.is_ephemeral) {
      this.broadcastProfilesUpdated();
    } else if (!current || current.identities_json !== serialized) {
      updateProfileIdentities(profileId, serialized);
      this.broadcastProfilesUpdated();
    }
    return identities;
  }
  async scanAllProfiles() {
    try {
      const profiles = getProfiles();
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
      if (resolver) {
        for (const d of resolver.domains) {
          try {
            await ses.clearStorageData({
              origin: `https://${d}`,
              storages: ["cookies", "localstorage", "serviceworkers", "cachestorage"]
            });
          } catch {
          }
          const cookies = await ses.cookies.get({ domain: d });
          for (const c of cookies) {
            const scheme = c.secure ? "https" : "http";
            const domain = c.domain?.startsWith(".") ? c.domain.slice(1) : c.domain;
            try {
              await ses.cookies.remove(`${scheme}://${domain}${c.path || "/"}`, c.name);
            } catch {
            }
          }
        }
      }
      const p = getProfileById(profileId);
      let identities = {};
      if (p?.identities_json) {
        try {
          identities = JSON.parse(p.identities_json);
        } catch {
        }
      }
      delete identities[providerId];
      updateProfileIdentities(profileId, JSON.stringify(identities));
      this.broadcastProfilesUpdated();
      return { success: true };
    } catch (err) {
      console.error(`[IdentityService] Failed to disconnect ${providerId}:`, err);
      return { success: false, error: err.message };
    }
  }
  broadcastProfilesUpdated() {
    const updated = getProfiles();
    if (global.appOverlayView && !global.appOverlayView.webContents.isDestroyed()) {
      global.appOverlayView.webContents.send(
        IPC_CHANNELS.EVENTS.PROFILES_UPDATED,
        updated
      );
    }
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send(
        IPC_CHANNELS.EVENTS.PROFILES_UPDATED,
        updated
      );
    }
  }
  init() {
    this.scanAllProfiles().catch(
      (e) => console.warn("[IdentityService] Background scan failed:", e)
    );
  }
}
const sessionIdentityService = new SessionIdentityService();
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
      const identities = await sessionIdentityService.scanProfile(profileId);
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
    authWin.webContents.on("did-navigate-in-page", handleNavigation);
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
function configureSessionForProfile(profileId) {
  try {
    const profile = getProfileById(profileId);
    if (!profile) return;
    const partition = profile.is_ephemeral ? profileId : `persist:${profileId}`;
    const ses = electron.session.fromPartition(partition);
    sessionIdentityService.attachCookieObserver(profileId);
    if (profile.proxy_server) {
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
      const isPremium = await checkPremiumStatus();
      if (!isPremium) {
        const profiles = getProfiles();
        if (profiles.length >= 2) {
          throw new Error("Free tier limits exceeded: Max 2 session profiles.");
        }
      }
      createProfile(id, name, color, is_ephemeral, proxy_server, user_agent);
      configureSessionForProfile(id);
      return { id, name, color, is_ephemeral, proxy_server, user_agent };
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.DB.UPDATE_PROFILE,
    (_, id, name, color, is_ephemeral, proxy_server, user_agent) => {
      updateProfile(id, name, color, is_ephemeral, proxy_server, user_agent);
      configureSessionForProfile(id);
      return { id, name, color, is_ephemeral, proxy_server, user_agent };
    }
  );
  electron.ipcMain.handle(IPC_CHANNELS.DB.DELETE_PROFILE, async (_, id) => {
    for (const [paneId, profileId] of viewProfile.entries()) {
      if (profileId === id) {
        const view = activeViews.get(paneId);
        if (view) {
          const currentUrl = view.webContents.getURL();
          if (global.mainWindow) {
            global.mainWindow.contentView.removeChildView(view);
          }
          activeViews.delete(paneId);
          viewProfile.delete(paneId);
          electron.ipcMain.removeAllListeners(`view.updateProfile.${paneId}`);
          const createHandler = electron.ipcMain.listeners("view.create")[0];
          if (createHandler) {
            createHandler(null, paneId, currentUrl, "main");
          }
        }
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
  electron.ipcMain.handle(IPC_CHANNELS.DB.CREATE_WORKSPACE, async (_, id, name, icon) => {
    const isPremium = await checkPremiumStatus();
    if (!isPremium) {
      const workspaces = getWorkspaces();
      if (workspaces.length >= 2) {
        throw new Error("Free tier limits exceeded: Max 2 workspaces.");
      }
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
  electron.ipcMain.handle(IPC_CHANNELS.DB.CREATE_TAB, async (_, id, workspaceId, name) => {
    const isPremium = await checkPremiumStatus();
    if (!isPremium) {
      const tabs = getTabs(workspaceId);
      if (tabs.length >= 3) {
        throw new Error("Free tier limits exceeded: Max 3 tabs per workspace.");
      }
    }
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
}
function initLicensingIpc() {
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.ACTIVATE,
    (_, key) => activateLicenseKey(key)
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.LICENSING.VALIDATE,
    (_, key) => validateLicenseKey(key)
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
  electron.ipcMain.handle(IPC_CHANNELS.LICENSING.IS_DEV, () => isDevMode$1());
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
  const tag = cipher.getAuthTag();
  const bundle = {
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
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
  const tag = Buffer.from(bundle.tag, "base64");
  const ciphertext = Buffer.from(bundle.ciphertext, "base64");
  const key = crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, "sha256");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    throw new Error("Decryption failed: Incorrect passphrase or corrupted data");
  }
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
const activeRelays = /* @__PURE__ */ new Map();
const RELAY_SECRET = "apposition-relay-secret-v1";
const TIMEOUT_MS = 3e5;
function startAuthRelay(targetAuthUrl, profileId = "main", paneId) {
  return new Promise((resolve) => {
    try {
      const pkce = generatePkcePair();
      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${server.address()}`);
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
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        const state = createSignedState({ profileId, paneId, port }, RELAY_SECRET);
        const relaySession = {
          port,
          state,
          codeVerifier: pkce.codeVerifier,
          profileId,
          paneId,
          server,
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
      server.on("error", (err) => {
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
  s.stack.panes.set(paneId, r);
  s.views.set(paneId, view);
  const dpr = devicePixelRatioFor(win);
  const w = r.width / dpr;
  const h = r.height / dpr;
  const targetTop = s.stack.communicator ? s.views.get(s.stack.communicator.id) : s.views.get(APP_OVERLAY_ID);
  const children = win.isDestroyed() ? [] : win.contentView.children;
  const at = targetTop ? children.indexOf(targetTop) : children.length;
  attach(win, view, at !== -1 ? at : children.length);
  if (typeof view.setBorderRadius === "function") {
    view.setBorderRadius(12);
  }
  const cssRect = { x: r.cssLeft, y: r.cssTop, width: w, height: h };
  if (rect && isValidPhysicalRect(cssRect)) view.setBounds(cssRect);
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
function removeCommunicator(win, appId) {
  const s = registerComposer(win);
  const view = s.views.get(appId);
  if (view) detach(win, view);
  s.views.delete(appId);
  s.hidden.delete(appId);
  if (s.stack.communicator?.id === appId) {
    s.stack.communicator = void 0;
  }
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
function hitTestPaneAt(win, cssX, cssY, dpr = devicePixelRatioFor(win)) {
  const s = registerComposer(win);
  const hit = hitTestPaneAtPhysical(s.stack, cssX, cssY, dpr);
  if (!hit) return void 0;
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
function resolvePreload(name) {
  return path.join(__dirname, "../preload", name);
}
function resolveAppIcon() {
  const ico = path.join(electron.app.getAppPath(), "assets/icon.ico");
  const png = path.join(electron.app.getAppPath(), "assets/icon.png");
  return process.platform === "win32" ? ico : png;
}
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
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
  win.__isMainWindow = true;
  global.mainWindow = win;
  global.overlayWindow = win;
  registerComposer(win);
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
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    view.webContents.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    view.webContents.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  setAppOverlay(win, view);
  global.appOverlayView = view;
  global.overlayWindow = win;
  syncAppOverlayBounds(win);
  view.webContents.once("dom-ready", () => {
    view.webContents.send("app:env", { nativeViews: true });
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
    global.mainWindow?.focus();
    global.mainWindow?.webContents.focus();
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
function bindGuestCursor(wc) {
  wc.on("cursor-changed", (_e, type) => {
    global.appOverlayView?.webContents.send(IPC_CHANNELS.OVERLAY.CURSOR, type);
  });
}
function handleBeforeInputEvent(webContents, event, input) {
  if (input.type !== "keyDown") return;
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
  if (isReload && global.mainWindow && webContents.id !== global.mainWindow.webContents.id) {
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
  const ov = global.appOverlayView?.webContents || global.mainWindow?.webContents;
  if (ov && !ov.isDestroyed()) {
    if (isMod && (keyLower === "f" || keyLower === "k" || keyLower === "l")) {
      ov.focus();
    }
    ov.send("forwarded-key", payload);
  }
}
function extractUnreadBadgeFromTitle(title) {
  if (!title || typeof title !== "string") {
    return { count: 0, hasUnread: false, rawTitle: "" };
  }
  const clean = title.trim();
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
const SYSTEM_PROTOCOLS = ["mailto:", "tel:", "slack:", "zoommtg:", "magnet:", "viber:", "tg:"];
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
  if (SYSTEM_PROTOCOLS.some((proto) => urlLower.startsWith(proto))) {
    return {
      type: "OPEN_SYSTEM_BROWSER",
      url
    };
  }
  if (disposition === "new-window" || isPopup || isBlank || isGoogle || isSSO) {
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
function configureWebAuthnForSession(sess) {
  sess.setDevicePermissionHandler(() => false);
  const selectHidHandler = (event, _details, callback) => {
    event.preventDefault();
    callback(void 0);
  };
  const selectAccountHandler = (event, _details, callback) => {
    event.preventDefault();
    callback(null);
  };
  sess.removeListener("select-hid-device", selectHidHandler);
  sess.on("select-hid-device", selectHidHandler);
  sess.removeListener("select-webauthn-account", selectAccountHandler);
  sess.on("select-webauthn-account", selectAccountHandler);
}
function isProxyFailureError(error) {
  if (!error) return false;
  const proxyErrors = [
    "ERR_PROXY_CONNECTION_FAILED",
    "ERR_TUNNEL_CONNECTION_FAILED",
    "ERR_PROXY_AUTH_REQUESTED",
    "ERR_SOCKS_CONNECTION_FAILED",
    "ERR_PROXY_CERTIFICATE_INVALID",
    "ERR_MANDATORY_PROXY_CONFIGURATION_FAILED"
  ];
  return proxyErrors.some((code) => error.includes(code));
}
function configureSessionProxy(ses, proxyServer, profileId) {
  if (!proxyServer || !proxyServer.trim()) {
    ses.setProxy({}).catch(() => {
    });
    return;
  }
  const sanitizedProxy = proxyServer.trim();
  ses.setProxy({
    proxyRules: sanitizedProxy,
    proxyBypassRules: "<-loopback>"
  }).catch((err) => {
    console.error(`Failed to configure proxy for profile ${profileId}:`, err);
  });
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
    view.webContents.setUserAgent(DEFAULT_DESKTOP_UA);
    bindGuestCursor(view.webContents);
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
      const title = view.webContents.getTitle();
      const info = extractUnreadBadgeFromTitle(title);
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
    return getCommunicatorState();
  });
  electron.ipcMain.handle("communicator.createStack", async (_e, id, name, icon) => {
    createCommunicatorStack(id, name, icon);
    return { success: true };
  });
  electron.ipcMain.handle("communicator.updateStack", async (_e, id, name, icon) => {
    updateCommunicatorStack(id, name, icon);
    return { success: true };
  });
  electron.ipcMain.handle("communicator.deleteStack", async (_e, id) => {
    deleteCommunicatorStack(id);
    return { success: true };
  });
  electron.ipcMain.handle(
    "communicator.createApp",
    async (_e, id, stackId, profileId, name, url, icon) => {
      createCommunicatorApp(id, stackId, profileId, name, url, icon);
      return { success: true };
    }
  );
  electron.ipcMain.handle(
    "communicator.updateApp",
    async (_e, id, updates) => {
      updateCommunicatorApp(id, updates);
      return { success: true };
    }
  );
  electron.ipcMain.handle("communicator.deleteApp", async (_e, id) => {
    const win = getWindow();
    communicatorService.destroyView(win, id);
    deleteCommunicatorApp(id);
    return { success: true };
  });
  electron.ipcMain.handle("communicator.saveProvider", async (_e, provider) => {
    saveCommunicatorProvider(provider);
    return { success: true };
  });
  electron.ipcMain.handle("communicator.deleteProvider", async (_e, id) => {
    deleteCommunicatorProvider(id);
    return { success: true };
  });
  electron.ipcMain.handle("communicator.captureSnapshot", async (_e, appId) => {
    return communicatorService.captureAppSnapshot(appId);
  });
  electron.ipcMain.on("communicator.showDrawer", (_e, appId, rect, partition, url) => {
    const win = getWindow();
    if (win) communicatorService.showDrawerView(win, appId, rect, partition, url);
  });
  electron.ipcMain.on("communicator.hideDrawer", () => {
    const win = getWindow();
    if (win) communicatorService.hideDrawerView(win);
  });
  electron.ipcMain.on("communicator.destroyView", (_e, appId) => {
    const win = getWindow();
    communicatorService.destroyView(win, appId);
  });
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
function getTargetWindow() {
  const win = global.mainWindow || global.overlayWindow;
  return win && !win.isDestroyed() ? win : null;
}
function bindViewEvents(paneId, view, profileId) {
  if (view.webContents.__eventsBound) {
    return;
  }
  view.webContents.__eventsBound = true;
  view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (defaultNoiseFilter.isBenignNoise(message)) {
      return;
    }
    if (defaultNoiseFilter.isRateLimited(paneId)) {
      return;
    }
    const win = getTargetWindow();
    if (win) {
      win.webContents.send("view.console-message", {
        paneId,
        level,
        message: defaultNoiseFilter.redactSecrets(message),
        line,
        sourceId,
        timestamp: Date.now()
      });
    }
  });
  view.webContents.on("focus", () => {
    const win = getTargetWindow();
    if (win) {
      win.webContents.send("view.focus", { paneId });
      win.webContents.send("pane.focused", paneId);
    }
  });
  view.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown") {
      const isMod = Boolean(input.control || input.meta);
      const keyLower = input.key ? input.key.toLowerCase() : "";
      const isArrow = input.key === "ArrowLeft" || input.key === "ArrowRight" || input.key === "ArrowUp" || input.key === "ArrowDown";
      const isReload = isMod && keyLower === "r" || input.key === "F5";
      const isAppShortcut = input.alt && isArrow || isMod && keyLower === "w" || isMod && keyLower === "t" || isMod && isArrow || input.alt && input.code === "Space" || input.key === "F12" || isReload;
      if (isAppShortcut) {
        event.preventDefault();
      }
      if (isReload && global.mainWindow && view.webContents.id !== global.mainWindow.webContents.id) {
        if (input.shift) {
          view.webContents.reloadIgnoringCache();
        } else {
          view.webContents.reload();
        }
        if (!global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send("pane.reloaded-wc", view.webContents.id);
        }
        return;
      }
      const sharedId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
      const payload = {
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
      const win = getTargetWindow();
      if (win) win.webContents.send("forwarded-key", payload);
    }
  });
  const sendNav = (url) => {
    const win = getTargetWindow();
    if (win) {
      win.webContents.send("view.navigated", {
        paneId,
        url,
        title: view.webContents.getTitle() || url,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      });
    }
  };
  view.webContents.on("did-start-loading", () => {
    getTargetWindow()?.webContents.send("view.load-start", { paneId });
  });
  view.webContents.on("did-stop-loading", () => {
    getTargetWindow()?.webContents.send("view.loaded", { paneId });
  });
  view.webContents.on("dom-ready", () => {
    getTargetWindow()?.webContents.send("view.loaded", { paneId });
  });
  view.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    const win = getTargetWindow();
    if (win) {
      win.webContents.send("view.loaded", { paneId });
      win.webContents.send("view.fail-load", { paneId, errorCode, errorDescription, validatedURL });
    }
  });
  view.webContents.on("will-navigate", (event, url) => {
    if (!isGoogleAuthUrl(url)) return;
    if (view.webContents.getUserAgent() === FIREFOX_AUTH_UA) return;
    event.preventDefault();
    purgeGoogleAuthCookies(profileId).then(() => {
      if (!view.webContents.isDestroyed()) {
        view.webContents.setUserAgent(FIREFOX_AUTH_UA);
        return view.webContents.loadURL(url, { userAgent: FIREFOX_AUTH_UA });
      }
    }).catch(() => {
    });
  });
  view.webContents.on("did-navigate", (_e, url) => {
    if (!isGoogleAuthUrl(url) && view.webContents.getUserAgent() === FIREFOX_AUTH_UA) {
      view.webContents.setUserAgent(DEFAULT_DESKTOP_UA);
    }
    sendNav(url);
  });
  view.webContents.on("did-navigate-in-page", (_e, url) => sendNav(url));
  view.webContents.on("page-title-updated", () => sendNav(view.webContents.getURL()));
  view.webContents.on("page-favicon-updated", (_e, favicons) => {
    if (favicons && favicons.length > 0) {
      const pageUrl = view.webContents.getURL();
      let icon = favicons[0];
      try {
        if (icon && !icon.startsWith("data:")) {
          icon = new URL(icon, pageUrl).href;
        }
      } catch {
      }
      getTargetWindow()?.webContents.send("view.favicon-updated", {
        paneId,
        url: pageUrl,
        favicon: icon
      });
    }
  });
  view.webContents.on("audio-state-changed", (_event, audible) => {
    const isAudible = typeof audible === "boolean" ? audible : Boolean(audible?.audible);
    getTargetWindow()?.webContents.send("view.media-status", {
      paneId,
      isPlaying: isAudible
    });
  });
  view.webContents.on("media-started-playing", () => {
    getTargetWindow()?.webContents.send("view.media-status", {
      paneId,
      isPlaying: true
    });
  });
  view.webContents.on("media-paused", () => {
    const isAudible = typeof view.webContents.isCurrentlyAudible === "function" ? view.webContents.isCurrentlyAudible() : false;
    getTargetWindow()?.webContents.send("view.media-status", {
      paneId,
      isPlaying: isAudible
    });
  });
  view.webContents.ipc.on("pane.media-playing", (_e, isPlaying) => {
    getTargetWindow()?.webContents.send("view.media-status", {
      paneId,
      isPlaying: Boolean(isPlaying)
    });
  });
  view.webContents.on("context-menu", (_e, params) => {
    getTargetWindow()?.webContents.send("view.context-menu", {
      paneId,
      x: params.x,
      y: params.y,
      linkURL: params.linkURL,
      srcURL: params.srcURL
    });
  });
  view.webContents.on("render-process-gone", (_e, details) => {
    getTargetWindow()?.webContents.send("view.crashed", {
      paneId,
      reason: details.reason,
      exitCode: details.exitCode
    });
  });
}
function configureViewAndSession(paneId, view, profileId) {
  let partitionString = void 0;
  let isEphemeral = false;
  let proxyServer = null;
  let userAgent = null;
  if (profileId) {
    try {
      const profile = getProfileById(profileId);
      if (profile) {
        isEphemeral = !!profile.is_ephemeral;
        proxyServer = profile.proxy_server;
        userAgent = profile.user_agent;
      }
    } catch (e) {
      console.warn("Failed to fetch profile details", e);
    }
    partitionString = isEphemeral ? profileId : `persist:${profileId}`;
  }
  const ses = partitionString ? electron.session.fromPartition(partitionString) : electron.session.defaultSession;
  if (isEphemeral) ses.clearCache().catch(() => {
  });
  configureSessionProxy(ses, proxyServer, profileId);
  ses.setUserAgent(userAgent && userAgent.trim() ? userAgent.trim() : electron.app.userAgentFallback);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = [
      "notifications",
      "geolocation",
      "media",
      "screen",
      "persistent-storage",
      "clipboard-read",
      "clipboard-sanitized-write",
      "fullscreen",
      "pointerLock"
    ];
    callback(allowed.includes(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
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
  if (!ses.__networkErrorTrackingBound) {
    ses.__networkErrorTrackingBound = true;
    ses.webRequest.onErrorOccurred((details) => {
      const trackedPaneId = viewRegistry.getPaneIdByWebContentsId(details.webContentsId ?? -1);
      const win = getTargetWindow();
      if (trackedPaneId && win) {
        win.webContents.send("view.network-error", {
          paneId: trackedPaneId,
          url: details.url,
          errorDescription: details.error,
          isProxyFailure: isProxyFailureError(details.error),
          errorCode: 0,
          isMainFrame: details.resourceType === "mainFrame",
          timestamp: Date.now()
        });
      }
    });
  }
  bindViewEvents(paneId, view, profileId);
}
function createOrUpdateView(paneId, url, profileId = "main") {
  const existing = viewRegistry.getView(paneId);
  if (existing && !existing.webContents.isDestroyed()) {
    if (url && existing.webContents.getURL() !== url) {
      existing.webContents.loadURL(url);
    }
    return existing;
  }
  let partitionString = void 0;
  let isEphemeral = false;
  if (profileId) {
    try {
      const profile = getProfileById(profileId);
      if (profile) {
        isEphemeral = !!profile.is_ephemeral;
      }
    } catch (e) {
      console.warn("Failed to fetch profile details", e);
    }
    partitionString = isEphemeral ? profileId : `persist:${profileId}`;
  }
  const view = new electron.WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "../preload/pane.js"),
      partition: partitionString,
      sandbox: true,
      contextIsolation: true
    }
  });
  viewRegistry.registerView(paneId, view, profileId);
  if (global.mainWindow && !global.mainWindow.isDestroyed()) {
    global.mainWindow.contentView.addChildView(view);
  }
  view.setBackgroundColor("#FFFFFF");
  if (typeof view.setBorderRadius === "function") {
    view.setBorderRadius(12);
  }
  view.setBounds({ x: -1e4, y: -1e4, width: 0, height: 0 });
  configureViewAndSession(paneId, view, profileId);
  if (url) {
    view.webContents.loadURL(url);
  }
  return view;
}
function destroyView(paneId) {
  const view = viewRegistry.unregisterView(paneId);
  if (!view) return;
  if (global.mainWindow && !global.mainWindow.isDestroyed()) {
    global.mainWindow.contentView.removeChildView(view);
  }
  try {
    if (!view.webContents.isDestroyed()) {
      view.webContents.close();
    }
  } catch (e) {
    console.warn("Failed to cleanly close webContents", e);
  }
  const profileId = viewRegistry.getProfile(paneId);
  if (profileId) {
    try {
      const profile = getProfileById(profileId);
      if (profile && profile.is_ephemeral) {
        const { session } = require("electron");
        const ses = session.fromPartition(profileId);
        ses.clearStorageData();
      }
    } catch (e) {
      console.warn("Failed to clear ephemeral storage", e);
    }
  }
}
function updateViewProfile(paneId, newProfileId) {
  const currentProfileId = viewRegistry.getProfile(paneId);
  if (currentProfileId === newProfileId) return;
  const existing = viewRegistry.getView(paneId);
  const currentUrl = existing && !existing.webContents.isDestroyed() ? existing.webContents.getURL() : "";
  const bounds = existing ? existing.getBounds() : void 0;
  destroyView(paneId);
  const newView = createOrUpdateView(paneId, currentUrl, newProfileId);
  if (bounds) {
    newView.setBounds(bounds);
  }
}
function destroyAllViews() {
  for (const paneId of Array.from(viewRegistry.activeViews.keys())) {
    try {
      destroyView(paneId);
    } catch {
    }
  }
}
function initViewLifecycleIpc() {
  electron.ipcMain.on("view.create", (_event, paneId, url, profileId) => {
    createOrUpdateView(paneId, url, profileId);
  });
  electron.ipcMain.on("view.destroy", (_event, paneId) => {
    destroyView(paneId);
  });
  electron.ipcMain.on("view.updateProfile", (_event, paneId, newProfileId) => {
    updateViewProfile(paneId, newProfileId);
  });
}
const captureViewSafely = async (view) => {
  if (!view || view.webContents.isDestroyed()) return "";
  try {
    const bounds = view.getBounds();
    const img = await view.webContents.capturePage({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    });
    if (!img.isEmpty()) {
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
  electron.ipcMain.on("view.screenshot", async (event, paneId) => {
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
      dataURL === "" && console.warn(`[pane ${paneId}] capture returned empty page`);
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
      const panesToHibernate = [];
      for (const [paneId, view] of activeViews) {
        if (view.webContents.isDestroyed()) continue;
        if (view.webContents.isCurrentlyAudible()) {
          continue;
        }
        panesToHibernate.push(paneId);
      }
      for (const paneId of panesToHibernate) {
        const view = activeViews.get(paneId);
        if (view && !view.webContents.isDestroyed()) {
          const PLACEHOLDER = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%25%22%20height%3D%22100%25%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23F7F7F5%22%2F%3E%3C%2Fsvg%3E";
          captures[paneId] = PLACEHOLDER;
          const descriptor = {
            url: view.webContents.getURL(),
            profileId: viewProfile.get(paneId),
            bounds: view.getBounds(),
            dataURL: PLACEHOLDER,
            title: view.webContents.getTitle()
          };
          viewProfile.delete(paneId);
          hibernatedViews.set(paneId, descriptor);
          if (global.mainWindow) {
            try {
              global.mainWindow.contentView.removeChildView(view);
            } catch {
            }
          }
          view.webContents.close();
          activeViews.delete(paneId);
        }
      }
      return captures;
    }
  );
  electron.ipcMain.handle(
    "view.hibernate",
    async (_event, paneId) => {
      const view = activeViews.get(paneId);
      const PLACEHOLDER = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%25%22%20height%3D%22100%25%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23F7F7F5%22%2F%3E%3C%2Fsvg%3E";
      if (!view) return PLACEHOLDER;
      const descriptor = {
        url: view.webContents.getURL(),
        profileId: viewProfile.get(paneId),
        bounds: view.getBounds(),
        dataURL: PLACEHOLDER,
        title: view.webContents.getTitle()
      };
      viewProfile.delete(paneId);
      hibernatedViews.set(paneId, descriptor);
      if (global.mainWindow) {
        try {
          global.mainWindow.contentView.removeChildView(view);
        } catch {
        }
      }
      view.webContents.close();
      activeViews.delete(paneId);
      return PLACEHOLDER;
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
  initViewLifecycleIpc();
  initCaptureIpc();
  initViewIpc();
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
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send("open-in-new-pane", decision.url);
      }
      return { action: "deny" };
    }
    if (decision.type === "OPEN_SYSTEM_BROWSER") {
      electron.shell.openExternal(decision.url);
      return { action: "deny" };
    }
    return { action: "deny" };
  });
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
  try {
    session.cookies.on("changed", (_event, cookie, cause) => {
      if (cause === "explicit" || cause === "overwrite") {
        if (cookie.name.includes("token") || cookie.name.includes("session") || cookie.name.includes("auth") || cookie.name === "d" || cookie.name === "SID") {
          session.cookies.flushStore().catch(() => {
          });
        }
      }
    });
  } catch {
  }
  session.webRequest.onBeforeSendHeaders(
    { urls: ["https://*/*", "http://*/*"] },
    (details, callback) => {
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
    webContents.on("before-input-event", (event, input) => {
      handleBeforeInputEvent(webContents, event, input);
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
        logger.debug(`Flush failed for ${part}`, err);
      }
    }
    await electron.session.defaultSession.flushStorageData();
  } catch (e) {
    logger.warn("Failed to flush session storage", e);
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
    logger.debug(`Failed to attach cookie monitor for ${partition}`, e);
  }
}
function initSessionPersistenceHooks() {
  try {
    electron.powerMonitor.on("suspend", async () => {
      logger.info("System suspending - flushing session data to disk");
      await flushAllSessions();
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
    logger.warn("PowerMonitor / Cookie monitor hook unavailable", e);
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
  const deepPath = url.replace("apposition://", "");
  if (deepPath.startsWith("workspace/")) {
    const workspaceId = deepPath.replace("workspace/", "");
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send("app.deep-link.workspace", workspaceId);
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
const updateLogger = createLogger("UPDATE");
const REPO_URL = "https://github.com/jvondev/apposition-releases";
let updateManagerInstance = null;
function getUpdateManager() {
  if (!electron.app.isPackaged) return null;
  if (!updateManagerInstance) {
    try {
      updateManagerInstance = new velopack.UpdateManager(new velopack.GithubSource(REPO_URL, void 0, false));
    } catch (err) {
      updateLogger.warn("Failed to instantiate Velopack UpdateManager", err?.message || err);
    }
  }
  return updateManagerInstance;
}
function initAutoUpdater() {
  const um = getUpdateManager();
  electron.ipcMain.handle("updater.check", async () => {
    if (!um) {
      return { success: true, isDev: true, message: "Updates disabled in unpacked dev mode." };
    }
    try {
      const updateInfo = await um.checkForUpdatesAsync();
      if (!updateInfo) {
        return { success: true, hasUpdate: false };
      }
      return {
        success: true,
        hasUpdate: true,
        version: updateInfo.TargetFullRelease?.Version || "latest"
      };
    } catch (err) {
      updateLogger.warn("Manual update check failed", err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });
  if (!electron.app.isPackaged || !um) return;
  setTimeout(() => {
    runBackgroundUpdateCheck(um);
  }, 5e3);
}
async function runBackgroundUpdateCheck(um) {
  try {
    updateLogger.info("Checking for application updates via Velopack...");
    const updateInfo = await um.checkForUpdatesAsync();
    if (!updateInfo) {
      updateLogger.info("Application is up to date.");
      return;
    }
    const targetVersion = updateInfo.TargetFullRelease?.Version || "latest";
    const isDelta = updateInfo.DeltasToTarget && updateInfo.DeltasToTarget.length > 0;
    updateLogger.info(
      `Update found (${targetVersion}, ${isDelta ? "binary delta" : "full package"}). Downloading...`
    );
    await um.downloadUpdateAsync(updateInfo);
    updateLogger.info(`Update ${targetVersion} downloaded and verified.`);
    const result = await electron.dialog.showMessageBox({
      type: "info",
      title: "Update Ready",
      message: `Apposition ${targetVersion} has been downloaded.`,
      detail: "Restart Apposition now to apply the update.",
      buttons: ["Restart and Update", "Later"],
      defaultId: 0,
      cancelId: 1
    });
    if (result.response === 0) {
      updateLogger.info("Applying update and restarting application...");
      um.waitExitThenApplyUpdate(updateInfo, false, true);
      electron.app.quit();
    }
  } catch (err) {
    updateLogger.warn("Background auto-update check skipped", err?.message || err);
  }
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
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          logger.info("Soft reloading main window via dev command");
          global.mainWindow.webContents.reload();
        }
      } else if (data.command === "quit") {
        logger.info("Gracefully quitting via dev command");
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
function initPointerForwarder(getWindow) {
  electron.ipcMain.on(IPC_CHANNELS.OVERLAY.FORWARD_POINTER, (_e, msg) => {
    const win = getWindow();
    if (!win) return;
    const hit = hitTestPaneAt(win, msg.x, msg.y, devicePixelRatioFor(win));
    if (!hit) return;
    const view = composers.get(win.id)?.views.get(hit.paneId);
    if (!view || view.webContents.isDestroyed()) return;
    const dbg = ensureDebugger(view);
    if (!dbg) return;
    const localX = Math.round(msg.x - hit.cssLeft);
    const localY = Math.round(msg.y - hit.cssTop);
    if (msg.type === "wheel") {
      dbg.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: localX,
        y: localY,
        deltaX: msg.deltaX,
        deltaY: msg.deltaY,
        modifiers: toCdpModifiers(msg.modifiers),
        pointerType: "mouse"
      }).catch(() => {
      });
    } else {
      if (msg.type === "mousedown") {
        view.webContents.focus();
        global.appOverlayView?.webContents.send("pane.focused", hit.paneId);
      }
      const isMove = msg.type === "mousemove";
      dbg.sendCommand("Input.dispatchMouseEvent", {
        type: msg.type === "mousedown" ? "mousePressed" : msg.type === "mouseup" ? "mouseReleased" : "mouseMoved",
        x: localX,
        y: localY,
        button: toCdpButton(msg.button, isMove, msg.buttons),
        buttons: msg.buttons,
        clickCount: isMove ? 0 : msg.clickCount || (msg.type === "mousedown" ? 1 : 0),
        modifiers: toCdpModifiers(msg.modifiers),
        pointerType: "mouse"
      }).catch(() => {
      });
    }
  });
}
function ensureDebugger(view) {
  if (view.webContents.debugger.isAttached()) return view.webContents.debugger;
  try {
    view.webContents.debugger.attach("1.3");
  } catch {
    return void 0;
  }
  return view.webContents.debugger;
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
async function captureWebContentsCdp(wc, options = { fullPage: true, copyToClipboard: true }) {
  if (wc.isDestroyed()) return { success: false, error: "WebContents destroyed" };
  const dbg = wc.debugger;
  let attached = false;
  try {
    if (!dbg.isAttached()) {
      dbg.attach("1.3");
      attached = true;
    }
    await dbg.sendCommand("Page.enable");
    let screenshotData;
    if (options.fullPage) {
      screenshotData = await dbg.sendCommand("Page.captureScreenshot", {
        format: options.format || "png",
        quality: options.quality || 95,
        captureBeyondViewport: true,
        fromSurface: true
      });
    } else {
      screenshotData = await dbg.sendCommand("Page.captureScreenshot", {
        format: options.format || "png",
        quality: options.quality || 95,
        fromSurface: true
      });
    }
    const buffer = Buffer.from(screenshotData.data, "base64");
    const image = electron.nativeImage.createFromBuffer(buffer);
    if (options.copyToClipboard) {
      electron.clipboard.writeImage(image);
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
  } finally {
    if (attached && dbg.isAttached()) {
      try {
        dbg.detach();
      } catch {
      }
    }
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
    scale: 3,
    mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  },
  ipad_air: {
    width: 820,
    height: 1180,
    scale: 2,
    mobile: true,
    ua: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  },
  pixel_9: {
    width: 412,
    height: 924,
    scale: 2.625,
    mobile: true,
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
  }
};
async function setPaneDeviceEmulation(wc, device) {
  if (wc.isDestroyed()) return { success: false, error: "WebContents destroyed" };
  const dbg = wc.debugger;
  try {
    if (!dbg.isAttached()) {
      dbg.attach("1.3");
    }
    if (device === "reset") {
      await dbg.sendCommand("Emulation.clearDeviceMetricsOverride");
      await dbg.sendCommand("Network.setUserAgentOverride", { userAgent: "" });
      return { success: true };
    }
    const cfg = DEVICE_CONFIGS[device];
    if (!cfg) return { success: false, error: "Unknown device type" };
    await dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
      width: cfg.width,
      height: cfg.height,
      deviceScaleFactor: cfg.scale,
      mobile: cfg.mobile
    });
    await dbg.sendCommand("Network.setUserAgentOverride", {
      userAgent: cfg.ua
    });
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
            "script", "style", "noscript", "iframe", "svg", "button", "input",
            "header", "footer", "nav", "aside", ".advertisement", ".ad",
            ".cookie-banner", "#cookie-banner", ".popup", ".newsletter-signup"
          ];
          removeSelectors.forEach(sel => {
            doc.querySelectorAll(sel).forEach(el => el.remove());
          });

          const title = document.querySelector("h1")?.innerText || document.title || "";
          const byline = document.querySelector("meta[name='author']")?.getAttribute("content") ||
                         document.querySelector(".byline, [rel='author']")?.innerText || "";
          
          let mainEl = doc.querySelector("article, main, .article-body, #article-body, .post-content, .entry-content");
          if (!mainEl) {
            mainEl = doc.body;
          }

          const text = mainEl.innerText || "";
          const words = text.trim().split(/\\s+/).length;
          const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));

          return {
            title: title.trim(),
            byline: byline.trim(),
            excerpt: text.slice(0, 180).trim() + "...",
            contentHtml: mainEl.innerHTML,
            readingTimeMinutes,
            url: window.location.href,
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
  electron.ipcMain.handle(IPC_CHANNELS.VIEW.SET_DEVICE_EMULATION, async (_e, paneId, dev) => {
    const view = panes2.get(paneId);
    return view ? setPaneDeviceEmulation(view.webContents, dev) : { success: false, error: "Pane not found" };
  });
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
  electron.ipcMain.on("pane.notification-posted", (e, data) => {
    const senderWc = e.sender;
    const title = senderWc?.getTitle() || "App";
    global.appOverlayView?.webContents.send("pane.notification-posted", {
      appId: data.appId || "comm_app",
      appName: data.appName || title.split(" - ")[0] || "Message",
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
class AudioArbiterService {
  activeSpeakers = /* @__PURE__ */ new Set();
  autoDuckedPanes = /* @__PURE__ */ new Set();
  autoDuckingEnabled = true;
  handleMediaStarted(paneId, wc, allPanes) {
    if (wc.isDestroyed()) return;
    this.activeSpeakers.add(paneId);
    if (!this.autoDuckingEnabled) return;
    for (const [otherId, otherView] of allPanes.entries()) {
      if (otherId !== paneId && !otherView.webContents.isDestroyed()) {
        try {
          if (!otherView.webContents.isAudioMuted()) {
            otherView.webContents.setAudioMuted(true);
            this.autoDuckedPanes.add(otherId);
          }
        } catch {
        }
      }
    }
  }
  handleMediaStopped(paneId, allPanes) {
    this.activeSpeakers.delete(paneId);
    if (this.activeSpeakers.size === 0) {
      for (const duckedId of this.autoDuckedPanes) {
        const view = allPanes.get(duckedId);
        if (view && !view.webContents.isDestroyed()) {
          try {
            view.webContents.setAudioMuted(false);
          } catch {
          }
        }
      }
      this.autoDuckedPanes.clear();
    }
  }
  handlePaneDestroyed(paneId) {
    this.activeSpeakers.delete(paneId);
    this.autoDuckedPanes.delete(paneId);
  }
}
const audioArbiter = new AudioArbiterService();
const panes = /* @__PURE__ */ new Map();
function forwardGuestEvents(win, paneId, view, partition) {
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
    const title = wc.getTitle();
    const unread = extractUnreadBadgeFromTitle(title);
    ov()?.send("pane.unread-badge", { paneId, ...unread });
    ov()?.send(IPC_CHANNELS.EVENTS.VIEW_NAVIGATED, {
      paneId,
      url: currentUrl,
      title,
      canGoBack: wc.navigationHistory?.canGoBack?.() ?? false,
      canGoForward: wc.navigationHistory?.canGoForward?.() ?? false
    });
  };
  wc.on("did-navigate", nav);
  wc.on("did-navigate-in-page", nav);
  wc.on("page-title-updated", () => nav());
  wc.on("did-start-loading", () => ov()?.send("pane.load-start", { paneId }));
  wc.on("did-stop-loading", () => ov()?.send("pane.loaded", { paneId }));
  wc.on(
    "render-process-gone",
    (_e, d) => ov()?.send(IPC_CHANNELS.EVENTS.VIEW_CRASHED, { paneId, reason: d?.reason ?? "crashed", exitCode: d?.exitCode ?? 0 })
  );
  wc.on("media-started-playing", () => {
    audioArbiter.handleMediaStarted(paneId, wc, panes);
    ov()?.send(IPC_CHANNELS.EVENTS.VIEW_MEDIA_STATUS, { paneId, isPlaying: true });
  });
  wc.on("media-paused", () => {
    audioArbiter.handleMediaStopped(paneId, panes);
    ov()?.send(IPC_CHANNELS.EVENTS.VIEW_MEDIA_STATUS, { paneId, isPlaying: false });
  });
  wc.on("did-first-visually-non-empty-paint", () => ov()?.send(IPC_CHANNELS.EVENTS.VIEW_LOADED, { paneId }));
  wc.on(
    "context-menu",
    (_e, p) => ov()?.send(IPC_CHANNELS.EVENTS.CONTEXT_MENU_NATIVE, {
      paneId,
      x: p?.x ?? 0,
      y: p?.y ?? 0,
      linkURL: p?.linkURL ?? "",
      srcURL: p?.srcURL ?? "",
      pageURL: p?.pageURL ?? wc.getURL()
    })
  );
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
function createPane(win, req) {
  if (panes.has(req.paneId)) destroyPane(win, req.paneId);
  const view = new electron.WebContentsView({
    webPreferences: {
      preload: resolvePreload("pane.js"),
      partition: req.partition,
      contextIsolation: true,
      sandbox: false,
      webgl: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });
  if (req.userAgent) view.webContents.setUserAgent(req.userAgent);
  view.setBackgroundColor("#ffffff");
  if (typeof view.setBorderRadius === "function") {
    view.setBorderRadius(12);
  }
  view.webContents.session.setPermissionRequestHandler(
    (_, perm, cb) => cb(["clipboard-read", "clipboard-sanitized-write", "media", "display-capture", "fullscreen"].includes(perm))
  );
  configureWebAuthnForSession(view.webContents.session);
  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach("1.3");
      view.webContents.debugger.sendCommand("Page.enable").catch(() => {
      });
      view.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: ANTI_DETECTION_SCRIPT
      }).catch(() => {
      });
    }
  } catch {
  }
  bindGuestCursor(view.webContents);
  forwardGuestEvents(win, req.paneId, view, req.partition);
  panes.set(req.paneId, view);
  global.appOverlayView?.webContents.send(IPC_CHANNELS.VIEW.REGISTER_WEB_CONTENTS, req.paneId, view.webContents.id);
  const dpr = devicePixelRatioFor(win);
  const phys = toPhysicalRect(req.rect, dpr);
  placePane(win, req.paneId, view, { ...phys, cssLeft: req.rect.x, cssTop: req.rect.y });
  if (isValidPhysicalRect(req.rect)) view.setBounds(req.rect);
  if (req.url && req.url.trim().length > 0) view.webContents.loadURL(req.url);
}
function setPaneBounds(win, paneId, rect) {
  const view = panes.get(paneId);
  if (!view || !isValidPhysicalRect(rect)) return;
  if (typeof view.setBorderRadius === "function") {
    view.setBorderRadius(12);
  }
  view.setBounds(rect);
  const dpr = devicePixelRatioFor(win);
  const phys = toPhysicalRect(rect, dpr);
  placePane(win, paneId, view, { ...phys, cssLeft: rect.x, cssTop: rect.y });
}
function destroyPane(win, paneId) {
  const view = panes.get(paneId);
  if (!view) return;
  audioArbiter.handlePaneDestroyed(paneId);
  removePane(win, paneId);
  panes.delete(paneId);
  if (!view.webContents.isDestroyed()) view.webContents.close();
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
}
function findPaneIdBySender(senderId) {
  for (const [id, view] of panes.entries()) {
    if (view.webContents.id === senderId) return id;
  }
  return void 0;
}
function initPaneLifecycle(getWindow) {
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
  electron.ipcMain.on(IPC_CHANNELS.VIEW.NAVIGATE, (_e, id, url) => {
    if (!url?.trim()) return;
    const view = panes.get(id);
    if (!view || view.webContents.isDestroyed()) return;
    const cur = view.webContents.getURL();
    if (cur && (cur === url || cur.replace(/\/+$/, "") === url.replace(/\/+$/, ""))) return;
    view.webContents.loadURL(url);
  });
  electron.ipcMain.on(IPC_CHANNELS.VIEW.FOCUS, (_e, id) => panes.get(id)?.webContents.focus());
  electron.ipcMain.on(IPC_CHANNELS.VIEW.SET_AUDIO_MUTED, (_e, id, muted) => panes.get(id)?.webContents.setAudioMuted(muted));
  electron.ipcMain.on(IPC_CHANNELS.VIEW.RELOAD, (_e, id) => panes.get(id)?.webContents.reload());
  electron.ipcMain.on("view.zoomIn", (_e, id) => {
    const v = panes.get(id);
    if (v) v.webContents.setZoomLevel(v.webContents.getZoomLevel() + 0.5);
  });
  electron.ipcMain.on("view.zoomOut", (_e, id) => {
    const v = panes.get(id);
    if (v) v.webContents.setZoomLevel(v.webContents.getZoomLevel() - 0.5);
  });
  electron.ipcMain.on("view.zoomReset", (_e, id) => panes.get(id)?.webContents.setZoomLevel(0));
  electron.ipcMain.on("view.findInPage", (_e, id, text, opts) => panes.get(id)?.webContents.findInPage(text, opts));
  electron.ipcMain.on("view.stopFindInPage", (_e, id, action) => panes.get(id)?.webContents.stopFindInPage(action));
  electron.ipcMain.on("pane.media-timestamp", (e, p) => {
    const id = findPaneIdBySender(e.sender.id);
    if (id) global.appOverlayView?.webContents.send("app:media-timestamp", { paneId: id, ...p });
  });
  electron.ipcMain.on("pane.scroll-position", (e, p) => {
    const id = findPaneIdBySender(e.sender.id);
    if (id) global.appOverlayView?.webContents.send("app:scroll-position", { paneId: id, ...p });
  });
  electron.ipcMain.on("pane.focus-change", (e, f) => {
    const id = findPaneIdBySender(e.sender.id);
    if (id) global.appOverlayView?.webContents.send("pane.focus-change", { paneId: id, isFocused: f });
  });
  electron.ipcMain.on("pane.clicked", (e) => {
    const id = findPaneIdBySender(e.sender.id);
    if (id) global.appOverlayView?.webContents.send("pane.clicked", id);
  });
  initPaneSuperpowerIpc(panes, getWindow);
}
function unregisterAppShortcuts() {
  electron.globalShortcut.unregisterAll();
}
velopack.VelopackApp.build().run();
applyBrowserSwitches(electron.app);
const isDevMode = utils.is.dev || electron.app.getName().includes("Dev") || process.env.APP_ENV === "dev";
initMainSentry(isDevMode);
if (isDevMode) {
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
    initAutoUpdater();
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
    initAuthIpc();
    sessionIdentityService.init();
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
    initOverlayProjector(() => global.mainWindow || void 0, resolvePreload("index.js"));
    initPaneLifecycle(() => global.mainWindow || void 0);
    let isShown = false;
    const showWindow = () => {
      if (!isShown && !win.isDestroyed()) {
        isShown = true;
        win.maximize();
        win.show();
        syncAppOverlayBounds(win);
      }
    };
    overlay.webContents.once("dom-ready", () => {
      showWindow();
      sessionIdentityService.scanAllProfiles().catch(() => {
      });
    });
    setTimeout(showWindow, 1200);
    win.on("resize", () => {
      syncAppOverlayBounds(win);
      reRoundAllPanes(win);
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
  logger.setFileSink(logFile);
  runtimeState.init(path.join(electron.app.getPath("userData"), ".apposition-runtime.json"));
  if (isDevMode) {
    printStartupBanner(electron.app.getVersion(), logFile);
    initInteractiveTerminal(logFile);
  }
  process.on("uncaughtException", (err) => {
    runtimeState.incrementError();
    logger.fatal("Uncaught Exception in Main Process", err?.stack || err);
    captureMainException(err);
  });
  process.on("unhandledRejection", (reason) => {
    runtimeState.incrementError();
    logger.error("Unhandled Rejection in Main Process", reason);
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
    try {
      await flushAllSessions();
    } catch {
    }
  });
  electron.app.on("will-quit", () => {
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
    closeDb();
    defaultFileSink.close();
    if (process.platform !== "darwin") electron.app.quit();
  });
}
