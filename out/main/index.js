"use strict";
const require$$1 = require("electron");
const utils$2 = require("@electron-toolkit/utils");
const Database = require("better-sqlite3");
const require$$1$1 = require("path");
const require$$1$2 = require("fs");
const require$$1$3 = require("child_process");
require("readline");
const os = require("os");
const crypto = require("crypto");
const require$$4 = require("http");
const require$$0 = require("constants");
const require$$0$1 = require("stream");
const require$$4$1 = require("util");
const require$$5 = require("assert");
const require$$0$2 = require("events");
const require$$1$4 = require("tty");
const require$$2 = require("url");
const require$$14 = require("zlib");
const Sentry = require("@sentry/electron/main");
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
const require$$1__namespace = /* @__PURE__ */ _interopNamespaceDefault(require$$1$1);
const Sentry__namespace = /* @__PURE__ */ _interopNamespaceDefault(Sentry);
const isDevMode$2 = utils$2.is.dev || require$$1.app.getName().includes("Dev") || process.env.APP_ENV === "dev";
const dbFileName = isDevMode$2 ? "apposition_state_dev.db" : "apposition_state.db";
const dbPath = require$$1$1.join(require$$1.app.getPath("userData"), dbFileName);
function initDatabase() {
  try {
    const instance = new Database(dbPath);
    instance.pragma("journal_mode = WAL");
    instance.pragma("synchronous = NORMAL");
    instance.pragma("busy_timeout = 5000");
    return instance;
  } catch (error2) {
    console.error("[SQLite Error] Database failed to open, recovering:", error2);
    if (require$$1$2.existsSync(dbPath)) {
      try {
        require$$1$2.renameSync(dbPath, `${dbPath}.corrupt.${Date.now()}`);
      } catch (backupError) {
        console.error(
          "[SQLite Error] Failed to rename corrupt database:",
          backupError
        );
      }
    }
    try {
      const freshInstance = new Database(dbPath);
      freshInstance.pragma("journal_mode = WAL");
      freshInstance.pragma("synchronous = NORMAL");
      freshInstance.pragma("busy_timeout = 5000");
      return freshInstance;
    } catch (fallbackErr) {
      console.error(
        "[SQLite Fatal] Could not create disk DB, using in-memory fallback:",
        fallbackErr
      );
      const memInstance = new Database(":memory:");
      memInstance.pragma("busy_timeout = 5000");
      return memInstance;
    }
  }
}
const db = initDatabase();
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT
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
  db.exec("ALTER TABLE profiles ADD COLUMN proxy_server TEXT DEFAULT NULL");
  db.exec("ALTER TABLE profiles ADD COLUMN user_agent TEXT DEFAULT NULL");
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
function saveNode(node2) {
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
    node2.id,
    node2.tab_id,
    node2.type,
    node2.profile_id || "main",
    node2.url || null,
    node2.x,
    node2.y,
    node2.width,
    node2.height,
    node2.is_hibernating ? 1 : 0,
    node2.is_ghost ? 1 : 0
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
    "INSERT INTO tabs (id, workspace_id, name, custom_name, order_idx) VALUES (?, ?, ?, ?, ?)"
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
    createWorkspace("ws_drafts", "Drafts");
  }
  return db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC").all();
}
function createWorkspace(id, name, icon) {
  const stmt = db.prepare(
    "INSERT INTO workspaces (id, name, icon, created_at) VALUES (?, ?, ?, ?)"
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
function getInitialAppState() {
  try {
    const workspaces = getWorkspaces();
    const activeWsId = workspaces[0]?.id || "ws_personal";
    const tabs = getTabs(activeWsId);
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
    let out2 = `${timeStr} [${entry.level[0]}][${domain}] ${entry.message}`;
    if (entry.durationMs !== void 0) {
      out2 += ` ${entry.durationMs.toFixed(0)}ms`;
    }
    if (entry.correlationId) {
      out2 += ` #${entry.correlationId}`;
    }
    const cleanSrc = cleanSourcePath(entry.source?.file);
    if (cleanSrc) {
      out2 += ` (${cleanSrc}:${entry.source?.line || 0})`;
    }
    if (entry.details !== void 0) {
      out2 += ` :: ${JSON.stringify(entry.details)}`;
    }
    return out2;
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
      const dir = require$$1$1.dirname(filePath);
      if (!require$$1$2.existsSync(dir)) {
        require$$1$2.mkdirSync(dir, { recursive: true });
      }
      if (require$$1$2.existsSync(filePath)) {
        try {
          const stats = require$$1$2.statSync(filePath);
          if (stats.size > MAX_LOG_SIZE_BYTES) {
            const oldPath = `${filePath}.old`;
            if (require$$1$2.existsSync(oldPath)) {
              require$$1$2.unlinkSync(oldPath);
            }
            require$$1$2.renameSync(filePath, oldPath);
          }
        } catch {
        }
      }
      this.stream = require$$1$2.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
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
      const dir = require$$1$1.dirname(this.filePath);
      if (!require$$1$2.existsSync(dir)) {
        require$$1$2.mkdirSync(dir, { recursive: true });
      }
      require$$1$2.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
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
  tx(name, correlationId, durationMs, error2) {
    if (error2) {
      this.log("ERROR", `[TX FAILED] ${name}`, error2, "IPC", correlationId, durationMs);
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
    require$$1$3.exec(openCmd, () => {
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
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  } catch {}

  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client Executable' }
        ]
      });
    }
  } catch {}

  try {
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
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
    EXPORT_VAULT: "vault.exportSession",
    IMPORT_VAULT: "vault.importSession"
  }
};
function getMachineKeyFilePath() {
  const userDataPath = require$$1.app.getPath("userData");
  return require$$1$1.join(userDataPath, "apposition_machine.key");
}
function getOrCreateMachineKey() {
  const keyPath = getMachineKeyFilePath();
  if (require$$1$2.existsSync(keyPath)) {
    try {
      const hex = require$$1$2.readFileSync(keyPath, "utf8").trim();
      if (hex.length === 64) {
        return Buffer.from(hex, "hex");
      }
    } catch (e) {
      console.error("Failed to read machine key", e);
    }
  }
  const newKey = crypto.randomBytes(32);
  try {
    const userDataPath = require$$1.app.getPath("userData");
    if (!require$$1$2.existsSync(userDataPath)) {
      require$$1$2.mkdirSync(userDataPath, { recursive: true });
    }
    require$$1$2.writeFileSync(keyPath, newKey.toString("hex"), "utf8");
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
  return utils$2.is.dev;
}
function shouldBypassGatekeep() {
  return utils$2.is.dev && process.env.FORCE_GATEKEEP !== "1";
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
const stashedBounds = viewRegistry.stashedBounds;
const hibernatedViews = viewRegistry.hibernatedViews;
function configureSessionForProfile(profileId) {
  try {
    const profile = getProfileById(profileId);
    if (!profile) return;
    const partition = profile.is_ephemeral ? profileId : `persist:${profileId}`;
    const ses = require$$1.session.fromPartition(partition);
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
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.GET_PROFILES, () => {
    configureAllSessions();
    return getProfiles();
  });
  require$$1.ipcMain.handle(
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
  require$$1.ipcMain.handle(
    IPC_CHANNELS.DB.UPDATE_PROFILE,
    (_, id, name, color, is_ephemeral, proxy_server, user_agent) => {
      updateProfile(id, name, color, is_ephemeral, proxy_server, user_agent);
      configureSessionForProfile(id);
      return { id, name, color, is_ephemeral, proxy_server, user_agent };
    }
  );
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.DELETE_PROFILE, async (_, id) => {
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
          require$$1.ipcMain.removeAllListeners(`view.updateProfile.${paneId}`);
          const createHandler = require$$1.ipcMain.listeners("view.create")[0];
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
      const ses = require$$1.session.fromPartition(isEphemeral ? id : `persist:${id}`);
      await ses.clearStorageData();
    } catch (e) {
      console.error("[Profile Engine] Failed to wipe session data:", e);
    }
  });
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.GET_INITIAL_STATE, () => getInitialAppState());
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.GET_WORKSPACES, () => getWorkspaces());
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.CREATE_WORKSPACE, async (_, id, name, icon) => {
    const isPremium = await checkPremiumStatus();
    if (!isPremium) {
      const workspaces = getWorkspaces();
      if (workspaces.length >= 1) {
        throw new Error("Free tier limits exceeded: Max 1 workspace.");
      }
    }
    createWorkspace(id, name, icon);
  });
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.UPDATE_WORKSPACE, (_, id, name, icon) => {
    updateWorkspace(id, name, icon);
  });
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.DELETE_WORKSPACE, (_, id) => {
    deleteWorkspace(id);
  });
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.SET_WORKSPACE_DEFAULT_PROFILE, (_, id, profileId) => {
    setWorkspaceDefaultProfile(id, profileId);
  });
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.SET_TAB_DEFAULT_PROFILE, (_, id, profileId) => {
    setTabDefaultProfile(id, profileId);
  });
  require$$1.ipcMain.handle(
    IPC_CHANNELS.DB.UPDATE_PANE_PROFILES_FOR_WORKSPACE,
    (_, workspaceId, profileId) => {
      updatePaneProfilesForWorkspace(workspaceId, profileId);
    }
  );
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.UPDATE_PANE_PROFILES_FOR_TAB, (_, tabId, profileId) => {
    updatePaneProfilesForTab(tabId, profileId);
  });
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.GET_TABS, (_, workspaceId) => getTabs(workspaceId));
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.CREATE_TAB, async (_, id, workspaceId, name) => {
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
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.UPDATE_TAB, (_, id, name, customName) => {
    updateTab(id, name, customName);
  });
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.DELETE_TAB, (_, id) => {
    deleteTab(id);
  });
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.MOVE_NODE_TO_TAB, (_, nodeId, targetTabId) => {
    moveNodeToTab(nodeId, targetTabId);
  });
  require$$1.ipcMain.handle(IPC_CHANNELS.DB.GET_NODES, (_, tabId) => getNodesForTab(tabId));
  require$$1.ipcMain.on(IPC_CHANNELS.DB.SAVE_NODE, (_, node2) => saveNode(node2));
  require$$1.ipcMain.on(IPC_CHANNELS.DB.DELETE_NODE, (_, id) => deleteNode(id));
  require$$1.ipcMain.on(
    IPC_CHANNELS.DB.SAVE_TAB_LAYOUT,
    (_, tabId, layoutState) => saveTabLayout(tabId, layoutState)
  );
}
function initLicensingIpc() {
  require$$1.ipcMain.handle(
    IPC_CHANNELS.LICENSING.ACTIVATE,
    (_, key) => activateLicenseKey(key)
  );
  require$$1.ipcMain.handle(
    IPC_CHANNELS.LICENSING.VALIDATE,
    (_, key) => validateLicenseKey(key)
  );
  require$$1.ipcMain.handle(IPC_CHANNELS.LICENSING.GET_KEY, () => getSavedLicenseKey());
  require$$1.ipcMain.handle(
    IPC_CHANNELS.LICENSING.GET_STATE,
    () => getSavedLicenseState()
  );
  require$$1.ipcMain.handle(
    IPC_CHANNELS.LICENSING.CHECK_PREMIUM,
    () => checkPremiumStatus()
  );
  require$$1.ipcMain.handle(IPC_CHANNELS.LICENSING.IS_DEV, () => isDevMode$1());
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
  const json2 = JSON.stringify({ ...payload, ts: Date.now() });
  const data = Buffer.from(json2).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}
function verifySignedState(state, secret) {
  if (!state || !state.includes(".")) return null;
  const [data, signature] = state.split(".");
  const expectedSig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  if (signature !== expectedSig) return null;
  try {
    const json2 = Buffer.from(data, "base64url").toString("utf8");
    return JSON.parse(json2);
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
      const server = require$$4.createServer(async (req, res) => {
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
              const targetSession = require$$1.session.fromPartition(partition);
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
        require$$1.shell.openExternal(finalAuthUrl);
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
    return host === "accounts.google.com" || host.endsWith(".accounts.google.com") || host.includes("google.com") && parsed.pathname.startsWith("/gsi/");
  } catch {
    const lower = url.toLowerCase();
    return lower.includes("accounts.google.com") || lower.includes("google.com/gsi/");
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
function openGoogleAuthModal(options) {
  try {
    if (activeAuthWindow && !activeAuthWindow.isDestroyed()) {
      activeAuthWindow.focus();
      return { success: true };
    }
    const { url, profileId = "main", paneId, returnUrl, parentWebContentsId } = options;
    const partition = profileId === "main" ? "persist:main" : `persist:${profileId}`;
    const authWin = new require$$1.BrowserWindow({
      width: 520,
      height: 680,
      center: true,
      title: "Google Sign-In",
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#fafaf9",
        symbolColor: "#121212",
        height: 36
      },
      backgroundColor: "#FFFFFF",
      show: false,
      icon: require$$1$1.join(
        __dirname,
        process.platform === "linux" ? "../../assets/icon.png" : "../../assets/icon.ico"
      ),
      webPreferences: {
        partition,
        preload: void 0,
        sandbox: true,
        contextIsolation: true
      }
    });
    activeAuthWindow = authWin;
    const authWebContentsId = authWin.webContents.id;
    registerOAuthPopup(authWebContentsId);
    try {
      authWin.webContents.setUserAgent(FIREFOX_AUTH_UA);
    } catch {
    }
    authWin.once("ready-to-show", () => {
      if (!authWin.isDestroyed()) authWin.show();
    });
    const notifyAndClose = () => {
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send("app.auth-completed", {
          profileId,
          paneId,
          returnUrl,
          success: true
        });
      }
      if (parentWebContentsId) {
        const parentWc = require$$1.webContents.fromId(parentWebContentsId);
        if (parentWc && !parentWc.isDestroyed()) {
          try {
            if (returnUrl) {
              parentWc.loadURL(returnUrl);
            } else {
              parentWc.reload();
            }
          } catch {
          }
        }
      }
      setTimeout(() => {
        if (!authWin.isDestroyed()) authWin.close();
      }, 500);
    };
    authWin.webContents.on("did-navigate", (_e, navUrl) => {
      const lower = (navUrl || "").toLowerCase();
      const isAuthCompleted = lower.startsWith("apposition://") || lower.includes("localhost:5174/#oauth-success") || returnUrl && lower.startsWith(returnUrl.toLowerCase()) || !lower.includes("accounts.google.") && !lower.includes("google.com/gsi") && !lower.includes("google.com/signin") && !lower.includes("google.com/servicelogin") && !lower.includes("google.com/o/oauth2");
      if (isAuthCompleted && !lower.includes("accounts.google.com/v3/signin")) {
        notifyAndClose();
      }
    });
    authWin.once("closed", () => {
      unregisterOAuthPopup(authWebContentsId);
      if (activeAuthWindow === authWin) {
        activeAuthWindow = null;
      }
    });
    authWin.loadURL(url, { userAgent: FIREFOX_AUTH_UA });
    return { success: true };
  } catch (err) {
    console.error("Failed to open Google Auth modal:", err);
    return { success: false, error: err.message };
  }
}
function initAuthIpc() {
  require$$1.ipcMain.handle(
    IPC_CHANNELS.AUTH.CLEAR_SITE_DATA,
    async (_event, origin, profileId) => {
      try {
        if (!origin) return { success: false, error: "Missing origin" };
        const partition = profileId ? profileId === "main" ? "persist:main" : `persist:${profileId}` : "persist:main";
        const targetSession = require$$1.session.fromPartition(partition);
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
  require$$1.ipcMain.handle(
    IPC_CHANNELS.AUTH.START_RELAY,
    async (_event, targetUrl, profileId, paneId) => {
      if (!targetUrl) return { success: false, error: "Missing URL" };
      return startAuthRelay(targetUrl, profileId || "main", paneId);
    }
  );
  require$$1.ipcMain.handle(
    IPC_CHANNELS.AUTH.OPEN_GOOGLE_AUTH,
    async (_event, options) => {
      return openGoogleAuthModal(options);
    }
  );
  require$$1.ipcMain.handle(
    IPC_CHANNELS.AUTH.EXPORT_VAULT,
    async (_event, profileId, secretKey) => {
      try {
        const partition = profileId ? profileId === "main" ? "persist:main" : `persist:${profileId}` : "persist:main";
        const targetSession = require$$1.session.fromPartition(partition);
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
  require$$1.ipcMain.handle(
    IPC_CHANNELS.AUTH.IMPORT_VAULT,
    async (_event, encryptedPayload, secretKey) => {
      try {
        const decrypted = decryptSessionPayload(encryptedPayload, secretKey);
        if (!decrypted || !decrypted.profileId || !Array.isArray(decrypted.cookies)) {
          return { success: false, error: "Invalid session payload or key" };
        }
        const partition = decrypted.profileId === "main" ? "persist:main" : `persist:${decrypted.profileId}`;
        const targetSession = require$$1.session.fromPartition(partition);
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
  if (isGoogle) {
    return {
      type: "SYSTEM_AUTH_RELAY",
      url
    };
  }
  if (SYSTEM_PROTOCOLS.some((proto) => urlLower.startsWith(proto))) {
    return {
      type: "OPEN_SYSTEM_BROWSER",
      url
    };
  }
  if (disposition === "new-window" || isPopup || isBlank) {
    return {
      type: "ALLOW_OAUTH_POPUP",
      width: 600,
      height: 720,
      autoHideMenuBar: true,
      sandbox: true,
      contextIsolation: true,
      isGoogle: false
    };
  }
  if (isSSO) {
    return {
      type: "NAVIGATE_CURRENT_PANE",
      url
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
function isProxyFailureError(error2) {
  if (!error2) return false;
  const proxyErrors = [
    "ERR_PROXY_CONNECTION_FAILED",
    "ERR_TUNNEL_CONNECTION_FAILED",
    "ERR_PROXY_AUTH_REQUESTED",
    "ERR_SOCKS_CONNECTION_FAILED",
    "ERR_PROXY_CERTIFICATE_INVALID",
    "ERR_MANDATORY_PROXY_CONFIGURATION_FAILED"
  ];
  return proxyErrors.some((code) => error2.includes(code));
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
function getTargetWindow() {
  const win = global.mainWindow || global.overlayWindow;
  return win && !win.isDestroyed() ? win : null;
}
function bindViewEvents(paneId, view) {
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
  view.webContents.on("did-navigate", (_e, url) => sendNav(url));
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
  const ses = partitionString ? require$$1.session.fromPartition(partitionString) : require$$1.session.defaultSession;
  if (isEphemeral) ses.clearCache().catch(() => {
  });
  configureSessionProxy(ses, proxyServer, profileId);
  ses.setUserAgent(userAgent && userAgent.trim() ? userAgent.trim() : require$$1.app.userAgentFallback);
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
  bindViewEvents(paneId, view);
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
  const view = new require$$1.WebContentsView({
    webPreferences: {
      preload: require$$1$1.join(__dirname, "../preload/pane.js"),
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
  require$$1.ipcMain.on("view.create", (_event, paneId, url, profileId) => {
    createOrUpdateView(paneId, url, profileId);
  });
  require$$1.ipcMain.on("view.destroy", (_event, paneId) => {
    destroyView(paneId);
  });
  require$$1.ipcMain.on("view.updateProfile", (_event, paneId, newProfileId) => {
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
  require$$1.ipcMain.on("view.screenshot", async (event, paneId) => {
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
  require$$1.ipcMain.handle(
    "view.capture",
    async (_event, paneId) => {
      const view = activeViews.get(paneId);
      if (!view || view.webContents.isDestroyed()) return Promise.resolve("");
      const dataURL = await captureViewSafely(view);
      dataURL === "" && console.warn(`[pane ${paneId}] capture returned empty page`);
      return dataURL;
    }
  );
  require$$1.ipcMain.handle(
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
  require$$1.ipcMain.handle(
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
  require$$1.ipcMain.handle(
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
const viewLogger = createLogger("VIEW");
function initViewIpc() {
  require$$1.ipcMain.on("view.registerWebContents", (_event, paneId, wcId) => {
    if (paneId && typeof wcId === "number") {
      viewRegistry.webContentsIdToPaneId.set(wcId, paneId);
    }
  });
  require$$1.ipcMain.on("view.reload", (event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload();
    }
  });
  require$$1.ipcMain.on("pane.clicked", (event) => {
    for (const [paneId, view] of activeViews) {
      if (view.webContents === event.sender) {
        if (global.overlayWindow && !global.overlayWindow.isDestroyed()) {
          global.overlayWindow.webContents.send("pane.focused", paneId);
        }
        break;
      }
    }
  });
  require$$1.ipcMain.on("view.openDevTools", (event, paneId) => {
    const view = activeViews.get(paneId);
    if (!view || view.webContents.isDestroyed()) return;
    if (view.webContents.isDevToolsOpened()) {
      return;
    }
    activeViews.forEach((v) => {
      if (!v.webContents.isDestroyed() && v.webContents.isDevToolsOpened()) {
        v.webContents.closeDevTools();
      }
    });
    if (global.mainWindow && !global.mainWindow.isDestroyed() && global.mainWindow.webContents.isDevToolsOpened()) {
      global.mainWindow.webContents.closeDevTools();
    }
    view.webContents.once("devtools-closed", () => {
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send("view.devtools-closed");
      }
    });
    view.webContents.openDevTools({ mode: "undocked" });
  });
  require$$1.ipcMain.on("view.closeDevTools", (event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.closeDevTools();
    }
  });
  require$$1.ipcMain.on("view.hideDevTools", (event) => {
    activeViews.forEach((v) => {
      if (!v.webContents.isDestroyed()) v.webContents.closeDevTools();
    });
  });
  require$$1.ipcMain.on("view.setBounds", (event, paneId, bounds) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed() && bounds) {
      view.setBounds(bounds);
    }
  });
  require$$1.ipcMain.on("view.batchSetBounds", (event, boundsMap) => {
    if (!boundsMap || typeof boundsMap !== "object") return;
    for (const [paneId, bounds] of Object.entries(boundsMap)) {
      const view = activeViews.get(paneId);
      if (view && !view.webContents.isDestroyed() && bounds) {
        view.setBounds(bounds);
      }
    }
  });
  require$$1.ipcMain.on("view.loadURL", (event, paneId, url, options) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      if (options?.clearHistory) {
        view.webContents.clearHistory();
      }
      view.webContents.loadURL(url);
    }
  });
  require$$1.ipcMain.on("view.focus", (event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.focus();
    } else if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.focus();
      global.mainWindow.webContents.focus();
    }
  });
  require$$1.ipcMain.on("view.goBack", (event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed() && view.webContents.navigationHistory.canGoBack()) {
      view.webContents.goBack();
    }
  });
  require$$1.ipcMain.on("view.goForward", (event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed() && view.webContents.navigationHistory.canGoForward()) {
      view.webContents.goForward();
    }
  });
  require$$1.ipcMain.on("view.toggleMute", (_, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setAudioMuted(!view.webContents.isAudioMuted());
    }
  });
  require$$1.ipcMain.on("view.zoomIn", (_, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      const level = view.webContents.getZoomLevel();
      view.webContents.setZoomLevel(level + 0.5);
    }
  });
  require$$1.ipcMain.on("view.zoomOut", (_, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      const level = view.webContents.getZoomLevel();
      view.webContents.setZoomLevel(level - 0.5);
    }
  });
  require$$1.ipcMain.on("view.zoomReset", (_, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setZoomLevel(0);
    }
  });
  require$$1.ipcMain.on("view.sleep", (event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setBackgroundThrottling(true);
      view.webContents.setAudioMuted(true);
      view.webContents.executeJavaScript(`console.log("Pane sleeping")`).catch(() => {
      });
      view.setBounds({ x: -1e4, y: -1e4, width: 0, height: 0 });
    }
  });
  require$$1.ipcMain.on("view.wake", (event, paneId, bounds) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setBackgroundThrottling(false);
      view.webContents.setAudioMuted(false);
      if (bounds) view.setBounds(bounds);
    }
  });
  require$$1.ipcMain.on("view.hideAll", () => {
    stashedBounds.clear();
    for (const [paneId, view] of activeViews) {
      if (view.webContents.isDestroyed()) continue;
      stashedBounds.set(paneId, view.getBounds());
      view.setBounds({ x: -1e4, y: -1e4, width: 0, height: 0 });
    }
  });
  require$$1.ipcMain.on("view.restoreAll", () => {
    for (const [paneId, bounds] of stashedBounds) {
      const view = activeViews.get(paneId);
      if (view && !view.webContents.isDestroyed()) {
        view.setBounds(bounds);
      }
    }
    stashedBounds.clear();
  });
  require$$1.ipcMain.removeAllListeners("auth:trigger-autofill");
  require$$1.ipcMain.on("auth:trigger-autofill", (event, paneId) => {
    const view = activeViews.get(paneId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send("auth:trigger-autofill");
    }
  });
  require$$1.ipcMain.handle(
    "view.getSearchSuggestions",
    async (_event, query) => {
      try {
        const response = await fetch(
          `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`
        );
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const data = await response.json();
        return data && Array.isArray(data[1]) ? data[1] : [];
      } catch (e) {
        viewLogger.debug("Search suggestions fetch failed", e?.message || e);
        return [];
      }
    }
  );
}
function initViewManager() {
  initViewLifecycleIpc();
  initCaptureIpc();
  initViewIpc();
}
const tearWindows = /* @__PURE__ */ new Map();
function initTearWindowIpc() {
  require$$1.ipcMain.on("tear-update", (_event, paneId, x, y) => {
    let win = tearWindows.get(paneId);
    if (!win) {
      win = new require$$1.BrowserWindow({
        width: 400,
        height: 300,
        x: x - 200,
        y: y - 20,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        webPreferences: { preload: require$$1$1.join(__dirname, "../preload/index.js") }
      });
      win.__isTearWindow = true;
      win.setOpacity(0.8);
      if (utils$2.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}#tear-${paneId}`);
      } else {
        win.loadFile(require$$1$1.join(__dirname, "../renderer/index.html"), {
          hash: `tear-${paneId}`
        });
      }
      tearWindows.set(paneId, win);
    } else {
      win.setPosition(Math.round(x - 200), Math.round(y - 20));
      if (!win.isVisible()) win.show();
    }
  });
  require$$1.ipcMain.on("tear-hide", (_event, paneId) => {
    const win = tearWindows.get(paneId);
    if (win && win.isVisible()) win.hide();
  });
  require$$1.ipcMain.on("tear-commit", (_event, paneId) => {
    const win = tearWindows.get(paneId);
    if (win) {
      const bounds = win.getBounds();
      win.destroy();
      tearWindows.delete(paneId);
      const finalWin = new require$$1.BrowserWindow({
        ...bounds,
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#ffffff",
          symbolColor: "#737373",
          height: 40
        },
        webPreferences: {
          preload: require$$1$1.join(__dirname, "../preload/index.js"),
          webviewTag: true,
          safeDialogs: true
        }
      });
      finalWin.__isTearWindow = true;
      if (utils$2.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        finalWin.loadURL(
          `${process.env["ELECTRON_RENDERER_URL"]}#standalone-${paneId}`
        );
      } else {
        finalWin.loadFile(require$$1$1.join(__dirname, "../renderer/index.html"), {
          hash: `standalone-${paneId}`
        });
      }
    }
  });
}
const rendererLogger = createLogger("RENDERER");
const windowLogger = createLogger("WINDOW");
function createWindow() {
  const mainWindow = new require$$1.BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#F7F7F5",
    icon: process.platform === "darwin" ? void 0 : require$$1$1.join(
      __dirname,
      process.platform === "linux" ? "../../assets/icon.png" : "../../assets/icon.ico"
    ),
    webPreferences: {
      preload: require$$1$1.join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true
    }
  });
  mainWindow.__isMainWindow = true;
  global.mainWindow = mainWindow;
  global.overlayWindow = mainWindow;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    mainWindow.webContents.send("open-in-new-pane", url);
    return { action: "deny" };
  });
  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      const source = sourceId ? { file: sourceId, line } : void 0;
      if (level >= 3) {
        rendererLogger.error(message, void 0, void 0, source);
      } else if (level === 2) {
        rendererLogger.warn(message, void 0, void 0, source);
      } else if (level === 1) {
        rendererLogger.info(message, void 0, void 0, source);
      } else {
        rendererLogger.debug(message, void 0, void 0, source);
      }
    }
  );
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      windowLogger.error(
        `MainWindow load failure [Code ${errorCode}]: ${errorDescription}`,
        { validatedURL }
      );
      if (!utils$2.is.dev) {
        setTimeout(() => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.loadFile(require$$1$1.join(__dirname, "../renderer/index.html"));
          }
        }, 500);
      }
    }
  );
  let isShown = false;
  const showWindow = () => {
    if (!isShown && !mainWindow.isDestroyed()) {
      isShown = true;
      mainWindow.maximize();
      mainWindow.show();
    }
  };
  mainWindow.once("ready-to-show", showWindow);
  setTimeout(showWindow, 1500);
  if (utils$2.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(require$$1$1.join(__dirname, "../renderer/index.html"));
  }
}
function initWindowManagerIpc() {
  require$$1.ipcMain.on("window.minimize", () => {
    global.mainWindow?.minimize();
  });
  require$$1.ipcMain.on("window.focus-main", () => {
    global.mainWindow?.focus();
    global.mainWindow?.webContents.focus();
  });
  require$$1.ipcMain.on("app.openInternalDevTools", () => {
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.openDevTools({ mode: "undocked" });
    }
  });
  require$$1.ipcMain.on("app.closeInternalDevTools", () => {
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.closeDevTools();
    }
  });
  require$$1.ipcMain.on("window.maximize", () => {
    const win = global.mainWindow;
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });
  require$$1.ipcMain.on("window.close", () => {
    global.mainWindow?.close();
  });
  initTearWindowIpc();
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
        require$$1.shell.openExternal(details.url);
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
          icon: require$$1$1.join(
            __dirname,
            process.platform === "linux" ? "../../assets/icon.png" : "../../assets/icon.ico"
          ),
          userAgent: isGoogleAuthUrl(details.url) ? FIREFOX_AUTH_UA : void 0,
          webPreferences: {
            preload: void 0,
            sandbox: true,
            contextIsolation: true
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
      require$$1.shell.openExternal(decision.url);
      return { action: "deny" };
    }
    return { action: "deny" };
  });
}
function handleBeforeInputEvent(webContents, event, input) {
  if (input.type !== "keyDown") return;
  const isMod = Boolean(input.control || input.meta);
  const keyLower = input.key ? input.key.toLowerCase() : "";
  const isArrow = input.key === "ArrowLeft" || input.key === "ArrowRight" || input.key === "ArrowUp" || input.key === "ArrowDown";
  const isReload = isMod && keyLower === "r" || input.key === "F5";
  const isAppShortcut = input.alt && isArrow || isMod && keyLower === "w" || isMod && keyLower === "t" || isMod && isArrow || input.alt && input.code === "Space" || input.key === "F12" || isReload;
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
  if (global.mainWindow && !global.mainWindow.isDestroyed()) {
    global.mainWindow.webContents.send("forwarded-key", payload);
  }
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
  if (require$$1.session.defaultSession) {
    configureSessionSecurity(require$$1.session.defaultSession);
  }
  require$$1.app.on("session-created", (session) => {
    configureSessionSecurity(session);
  });
  require$$1.app.on("browser-window-created", (_, popupWin) => {
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
  require$$1.app.on("web-contents-created", (_, webContents) => {
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
  require$$1.app.on("child-process-gone", (_event, details) => {
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
        const ses = require$$1.session.fromPartition(part);
        await ses.flushStorageData();
      } catch (err) {
        logger.debug(`Flush failed for ${part}`, err);
      }
    }
    await require$$1.session.defaultSession.flushStorageData();
  } catch (e) {
    logger.warn("Failed to flush session storage", e);
  }
}
const monitoredPartitions = /* @__PURE__ */ new Set();
function monitorPartitionCookies(partition) {
  if (monitoredPartitions.has(partition)) return;
  monitoredPartitions.add(partition);
  try {
    const ses = require$$1.session.fromPartition(partition);
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
    require$$1.powerMonitor.on("suspend", async () => {
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
  const defaultSession = require$$1.session.defaultSession;
  require$$1.ipcMain.on("net.prefetch", (_, rawUrl) => {
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
      require$$1.app.setAsDefaultProtocolClient("apposition", process.execPath, [
        require$$1__namespace.resolve(process.argv[1])
      ]);
    }
  } else {
    require$$1.app.setAsDefaultProtocolClient("apposition");
  }
  const gotTheLock2 = require$$1.app.requestSingleInstanceLock();
  if (!gotTheLock2) {
    require$$1.app.quit();
  } else {
    require$$1.app.on("second-instance", (_event, commandLine) => {
      if (global.mainWindow) {
        if (global.mainWindow.isMinimized()) global.mainWindow.restore();
        global.mainWindow.focus();
      }
      const url = commandLine.find((arg) => arg.startsWith("apposition://"));
      handleDeepLink(url);
    });
    require$$1.app.on("open-url", (event, url) => {
      event.preventDefault();
      if (global.mainWindow) {
        if (global.mainWindow.isMinimized()) global.mainWindow.restore();
        global.mainWindow.focus();
      }
      handleDeepLink(url);
    });
  }
}
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
var main$1 = {};
var fs = {};
var universalify = {};
var hasRequiredUniversalify;
function requireUniversalify() {
  if (hasRequiredUniversalify) return universalify;
  hasRequiredUniversalify = 1;
  universalify.fromCallback = function(fn) {
    return Object.defineProperty(function(...args) {
      if (typeof args[args.length - 1] === "function") fn.apply(this, args);
      else {
        return new Promise((resolve, reject) => {
          args.push((err, res) => err != null ? reject(err) : resolve(res));
          fn.apply(this, args);
        });
      }
    }, "name", { value: fn.name });
  };
  universalify.fromPromise = function(fn) {
    return Object.defineProperty(function(...args) {
      const cb = args[args.length - 1];
      if (typeof cb !== "function") return fn.apply(this, args);
      else {
        args.pop();
        fn.apply(this, args).then((r) => cb(null, r), cb);
      }
    }, "name", { value: fn.name });
  };
  return universalify;
}
var polyfills;
var hasRequiredPolyfills;
function requirePolyfills() {
  if (hasRequiredPolyfills) return polyfills;
  hasRequiredPolyfills = 1;
  var constants2 = require$$0;
  var origCwd = process.cwd;
  var cwd = null;
  var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
  process.cwd = function() {
    if (!cwd)
      cwd = origCwd.call(process);
    return cwd;
  };
  try {
    process.cwd();
  } catch (er) {
  }
  if (typeof process.chdir === "function") {
    var chdir = process.chdir;
    process.chdir = function(d) {
      cwd = null;
      chdir.call(process, d);
    };
    if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
  }
  polyfills = patch;
  function patch(fs2) {
    if (constants2.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
      patchLchmod(fs2);
    }
    if (!fs2.lutimes) {
      patchLutimes(fs2);
    }
    fs2.chown = chownFix(fs2.chown);
    fs2.fchown = chownFix(fs2.fchown);
    fs2.lchown = chownFix(fs2.lchown);
    fs2.chmod = chmodFix(fs2.chmod);
    fs2.fchmod = chmodFix(fs2.fchmod);
    fs2.lchmod = chmodFix(fs2.lchmod);
    fs2.chownSync = chownFixSync(fs2.chownSync);
    fs2.fchownSync = chownFixSync(fs2.fchownSync);
    fs2.lchownSync = chownFixSync(fs2.lchownSync);
    fs2.chmodSync = chmodFixSync(fs2.chmodSync);
    fs2.fchmodSync = chmodFixSync(fs2.fchmodSync);
    fs2.lchmodSync = chmodFixSync(fs2.lchmodSync);
    fs2.stat = statFix(fs2.stat);
    fs2.fstat = statFix(fs2.fstat);
    fs2.lstat = statFix(fs2.lstat);
    fs2.statSync = statFixSync(fs2.statSync);
    fs2.fstatSync = statFixSync(fs2.fstatSync);
    fs2.lstatSync = statFixSync(fs2.lstatSync);
    if (fs2.chmod && !fs2.lchmod) {
      fs2.lchmod = function(path, mode, cb) {
        if (cb) process.nextTick(cb);
      };
      fs2.lchmodSync = function() {
      };
    }
    if (fs2.chown && !fs2.lchown) {
      fs2.lchown = function(path, uid, gid, cb) {
        if (cb) process.nextTick(cb);
      };
      fs2.lchownSync = function() {
      };
    }
    if (platform === "win32") {
      fs2.rename = typeof fs2.rename !== "function" ? fs2.rename : (function(fs$rename) {
        function rename(from, to, cb) {
          var start = Date.now();
          var backoff = 0;
          fs$rename(from, to, function CB(er) {
            if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
              setTimeout(function() {
                fs2.stat(to, function(stater, st) {
                  if (stater && stater.code === "ENOENT")
                    fs$rename(from, to, CB);
                  else
                    cb(er);
                });
              }, backoff);
              if (backoff < 100)
                backoff += 10;
              return;
            }
            if (cb) cb(er);
          });
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
        return rename;
      })(fs2.rename);
    }
    fs2.read = typeof fs2.read !== "function" ? fs2.read : (function(fs$read) {
      function read(fd, buffer, offset, length, position, callback_) {
        var callback;
        if (callback_ && typeof callback_ === "function") {
          var eagCounter = 0;
          callback = function(er, _, __) {
            if (er && er.code === "EAGAIN" && eagCounter < 10) {
              eagCounter++;
              return fs$read.call(fs2, fd, buffer, offset, length, position, callback);
            }
            callback_.apply(this, arguments);
          };
        }
        return fs$read.call(fs2, fd, buffer, offset, length, position, callback);
      }
      if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
      return read;
    })(fs2.read);
    fs2.readSync = typeof fs2.readSync !== "function" ? fs2.readSync : /* @__PURE__ */ (function(fs$readSync) {
      return function(fd, buffer, offset, length, position) {
        var eagCounter = 0;
        while (true) {
          try {
            return fs$readSync.call(fs2, fd, buffer, offset, length, position);
          } catch (er) {
            if (er.code === "EAGAIN" && eagCounter < 10) {
              eagCounter++;
              continue;
            }
            throw er;
          }
        }
      };
    })(fs2.readSync);
    function patchLchmod(fs22) {
      fs22.lchmod = function(path, mode, callback) {
        fs22.open(
          path,
          constants2.O_WRONLY | constants2.O_SYMLINK,
          mode,
          function(err, fd) {
            if (err) {
              if (callback) callback(err);
              return;
            }
            fs22.fchmod(fd, mode, function(err2) {
              fs22.close(fd, function(err22) {
                if (callback) callback(err2 || err22);
              });
            });
          }
        );
      };
      fs22.lchmodSync = function(path, mode) {
        var fd = fs22.openSync(path, constants2.O_WRONLY | constants2.O_SYMLINK, mode);
        var threw = true;
        var ret;
        try {
          ret = fs22.fchmodSync(fd, mode);
          threw = false;
        } finally {
          if (threw) {
            try {
              fs22.closeSync(fd);
            } catch (er) {
            }
          } else {
            fs22.closeSync(fd);
          }
        }
        return ret;
      };
    }
    function patchLutimes(fs22) {
      if (constants2.hasOwnProperty("O_SYMLINK") && fs22.futimes) {
        fs22.lutimes = function(path, at, mt, cb) {
          fs22.open(path, constants2.O_SYMLINK, function(er, fd) {
            if (er) {
              if (cb) cb(er);
              return;
            }
            fs22.futimes(fd, at, mt, function(er2) {
              fs22.close(fd, function(er22) {
                if (cb) cb(er2 || er22);
              });
            });
          });
        };
        fs22.lutimesSync = function(path, at, mt) {
          var fd = fs22.openSync(path, constants2.O_SYMLINK);
          var ret;
          var threw = true;
          try {
            ret = fs22.futimesSync(fd, at, mt);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs22.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs22.closeSync(fd);
            }
          }
          return ret;
        };
      } else if (fs22.futimes) {
        fs22.lutimes = function(_a, _b, _c, cb) {
          if (cb) process.nextTick(cb);
        };
        fs22.lutimesSync = function() {
        };
      }
    }
    function chmodFix(orig) {
      if (!orig) return orig;
      return function(target, mode, cb) {
        return orig.call(fs2, target, mode, function(er) {
          if (chownErOk(er)) er = null;
          if (cb) cb.apply(this, arguments);
        });
      };
    }
    function chmodFixSync(orig) {
      if (!orig) return orig;
      return function(target, mode) {
        try {
          return orig.call(fs2, target, mode);
        } catch (er) {
          if (!chownErOk(er)) throw er;
        }
      };
    }
    function chownFix(orig) {
      if (!orig) return orig;
      return function(target, uid, gid, cb) {
        return orig.call(fs2, target, uid, gid, function(er) {
          if (chownErOk(er)) er = null;
          if (cb) cb.apply(this, arguments);
        });
      };
    }
    function chownFixSync(orig) {
      if (!orig) return orig;
      return function(target, uid, gid) {
        try {
          return orig.call(fs2, target, uid, gid);
        } catch (er) {
          if (!chownErOk(er)) throw er;
        }
      };
    }
    function statFix(orig) {
      if (!orig) return orig;
      return function(target, options, cb) {
        if (typeof options === "function") {
          cb = options;
          options = null;
        }
        function callback(er, stats) {
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          if (cb) cb.apply(this, arguments);
        }
        return options ? orig.call(fs2, target, options, callback) : orig.call(fs2, target, callback);
      };
    }
    function statFixSync(orig) {
      if (!orig) return orig;
      return function(target, options) {
        var stats = options ? orig.call(fs2, target, options) : orig.call(fs2, target);
        if (stats) {
          if (stats.uid < 0) stats.uid += 4294967296;
          if (stats.gid < 0) stats.gid += 4294967296;
        }
        return stats;
      };
    }
    function chownErOk(er) {
      if (!er)
        return true;
      if (er.code === "ENOSYS")
        return true;
      var nonroot = !process.getuid || process.getuid() !== 0;
      if (nonroot) {
        if (er.code === "EINVAL" || er.code === "EPERM")
          return true;
      }
      return false;
    }
  }
  return polyfills;
}
var legacyStreams;
var hasRequiredLegacyStreams;
function requireLegacyStreams() {
  if (hasRequiredLegacyStreams) return legacyStreams;
  hasRequiredLegacyStreams = 1;
  var Stream = require$$0$1.Stream;
  legacyStreams = legacy;
  function legacy(fs2) {
    return {
      ReadStream,
      WriteStream
    };
    function ReadStream(path, options) {
      if (!(this instanceof ReadStream)) return new ReadStream(path, options);
      Stream.call(this);
      var self2 = this;
      this.path = path;
      this.fd = null;
      this.readable = true;
      this.paused = false;
      this.flags = "r";
      this.mode = 438;
      this.bufferSize = 64 * 1024;
      options = options || {};
      var keys = Object.keys(options);
      for (var index = 0, length = keys.length; index < length; index++) {
        var key = keys[index];
        this[key] = options[key];
      }
      if (this.encoding) this.setEncoding(this.encoding);
      if (this.start !== void 0) {
        if ("number" !== typeof this.start) {
          throw TypeError("start must be a Number");
        }
        if (this.end === void 0) {
          this.end = Infinity;
        } else if ("number" !== typeof this.end) {
          throw TypeError("end must be a Number");
        }
        if (this.start > this.end) {
          throw new Error("start must be <= end");
        }
        this.pos = this.start;
      }
      if (this.fd !== null) {
        process.nextTick(function() {
          self2._read();
        });
        return;
      }
      fs2.open(this.path, this.flags, this.mode, function(err, fd) {
        if (err) {
          self2.emit("error", err);
          self2.readable = false;
          return;
        }
        self2.fd = fd;
        self2.emit("open", fd);
        self2._read();
      });
    }
    function WriteStream(path, options) {
      if (!(this instanceof WriteStream)) return new WriteStream(path, options);
      Stream.call(this);
      this.path = path;
      this.fd = null;
      this.writable = true;
      this.flags = "w";
      this.encoding = "binary";
      this.mode = 438;
      this.bytesWritten = 0;
      options = options || {};
      var keys = Object.keys(options);
      for (var index = 0, length = keys.length; index < length; index++) {
        var key = keys[index];
        this[key] = options[key];
      }
      if (this.start !== void 0) {
        if ("number" !== typeof this.start) {
          throw TypeError("start must be a Number");
        }
        if (this.start < 0) {
          throw new Error("start must be >= zero");
        }
        this.pos = this.start;
      }
      this.busy = false;
      this._queue = [];
      if (this.fd === null) {
        this._open = fs2.open;
        this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
        this.flush();
      }
    }
  }
  return legacyStreams;
}
var clone_1;
var hasRequiredClone;
function requireClone() {
  if (hasRequiredClone) return clone_1;
  hasRequiredClone = 1;
  clone_1 = clone;
  var getPrototypeOf = Object.getPrototypeOf || function(obj) {
    return obj.__proto__;
  };
  function clone(obj) {
    if (obj === null || typeof obj !== "object")
      return obj;
    if (obj instanceof Object)
      var copy2 = { __proto__: getPrototypeOf(obj) };
    else
      var copy2 = /* @__PURE__ */ Object.create(null);
    Object.getOwnPropertyNames(obj).forEach(function(key) {
      Object.defineProperty(copy2, key, Object.getOwnPropertyDescriptor(obj, key));
    });
    return copy2;
  }
  return clone_1;
}
var gracefulFs;
var hasRequiredGracefulFs;
function requireGracefulFs() {
  if (hasRequiredGracefulFs) return gracefulFs;
  hasRequiredGracefulFs = 1;
  var fs2 = require$$1$2;
  var polyfills2 = requirePolyfills();
  var legacy = requireLegacyStreams();
  var clone = requireClone();
  var util2 = require$$4$1;
  var gracefulQueue;
  var previousSymbol;
  if (typeof Symbol === "function" && typeof Symbol.for === "function") {
    gracefulQueue = Symbol.for("graceful-fs.queue");
    previousSymbol = Symbol.for("graceful-fs.previous");
  } else {
    gracefulQueue = "___graceful-fs.queue";
    previousSymbol = "___graceful-fs.previous";
  }
  function noop() {
  }
  function publishQueue(context, queue2) {
    Object.defineProperty(context, gracefulQueue, {
      get: function() {
        return queue2;
      }
    });
  }
  var debug = noop;
  if (util2.debuglog)
    debug = util2.debuglog("gfs4");
  else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
    debug = function() {
      var m = util2.format.apply(util2, arguments);
      m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
      console.error(m);
    };
  if (!fs2[gracefulQueue]) {
    var queue = commonjsGlobal[gracefulQueue] || [];
    publishQueue(fs2, queue);
    fs2.close = (function(fs$close) {
      function close(fd, cb) {
        return fs$close.call(fs2, fd, function(err) {
          if (!err) {
            resetQueue();
          }
          if (typeof cb === "function")
            cb.apply(this, arguments);
        });
      }
      Object.defineProperty(close, previousSymbol, {
        value: fs$close
      });
      return close;
    })(fs2.close);
    fs2.closeSync = (function(fs$closeSync) {
      function closeSync(fd) {
        fs$closeSync.apply(fs2, arguments);
        resetQueue();
      }
      Object.defineProperty(closeSync, previousSymbol, {
        value: fs$closeSync
      });
      return closeSync;
    })(fs2.closeSync);
    if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
      process.on("exit", function() {
        debug(fs2[gracefulQueue]);
        require$$5.equal(fs2[gracefulQueue].length, 0);
      });
    }
  }
  if (!commonjsGlobal[gracefulQueue]) {
    publishQueue(commonjsGlobal, fs2[gracefulQueue]);
  }
  gracefulFs = patch(clone(fs2));
  if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs2.__patched) {
    gracefulFs = patch(fs2);
    fs2.__patched = true;
  }
  function patch(fs22) {
    polyfills2(fs22);
    fs22.gracefulify = patch;
    fs22.createReadStream = createReadStream;
    fs22.createWriteStream = createWriteStream;
    var fs$readFile = fs22.readFile;
    fs22.readFile = readFile;
    function readFile(path, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$readFile(path, options, cb);
      function go$readFile(path2, options2, cb2, startTime) {
        return fs$readFile(path2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$readFile, [path2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$writeFile = fs22.writeFile;
    fs22.writeFile = writeFile;
    function writeFile(path, data, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$writeFile(path, data, options, cb);
      function go$writeFile(path2, data2, options2, cb2, startTime) {
        return fs$writeFile(path2, data2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$writeFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$appendFile = fs22.appendFile;
    if (fs$appendFile)
      fs22.appendFile = appendFile;
    function appendFile(path, data, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$appendFile(path, data, options, cb);
      function go$appendFile(path2, data2, options2, cb2, startTime) {
        return fs$appendFile(path2, data2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$appendFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$copyFile = fs22.copyFile;
    if (fs$copyFile)
      fs22.copyFile = copyFile;
    function copyFile(src2, dest, flags, cb) {
      if (typeof flags === "function") {
        cb = flags;
        flags = 0;
      }
      return go$copyFile(src2, dest, flags, cb);
      function go$copyFile(src22, dest2, flags2, cb2, startTime) {
        return fs$copyFile(src22, dest2, flags2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$copyFile, [src22, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$readdir = fs22.readdir;
    fs22.readdir = readdir;
    var noReaddirOptionVersions = /^v[0-5]\./;
    function readdir(path, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path2, options2, cb2, startTime) {
        return fs$readdir(path2, fs$readdirCallback(
          path2,
          options2,
          cb2,
          startTime
        ));
      } : function go$readdir2(path2, options2, cb2, startTime) {
        return fs$readdir(path2, options2, fs$readdirCallback(
          path2,
          options2,
          cb2,
          startTime
        ));
      };
      return go$readdir(path, options, cb);
      function fs$readdirCallback(path2, options2, cb2, startTime) {
        return function(err, files) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([
              go$readdir,
              [path2, options2, cb2],
              err,
              startTime || Date.now(),
              Date.now()
            ]);
          else {
            if (files && files.sort)
              files.sort();
            if (typeof cb2 === "function")
              cb2.call(this, err, files);
          }
        };
      }
    }
    if (process.version.substr(0, 4) === "v0.8") {
      var legStreams = legacy(fs22);
      ReadStream = legStreams.ReadStream;
      WriteStream = legStreams.WriteStream;
    }
    var fs$ReadStream = fs22.ReadStream;
    if (fs$ReadStream) {
      ReadStream.prototype = Object.create(fs$ReadStream.prototype);
      ReadStream.prototype.open = ReadStream$open;
    }
    var fs$WriteStream = fs22.WriteStream;
    if (fs$WriteStream) {
      WriteStream.prototype = Object.create(fs$WriteStream.prototype);
      WriteStream.prototype.open = WriteStream$open;
    }
    Object.defineProperty(fs22, "ReadStream", {
      get: function() {
        return ReadStream;
      },
      set: function(val) {
        ReadStream = val;
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(fs22, "WriteStream", {
      get: function() {
        return WriteStream;
      },
      set: function(val) {
        WriteStream = val;
      },
      enumerable: true,
      configurable: true
    });
    var FileReadStream = ReadStream;
    Object.defineProperty(fs22, "FileReadStream", {
      get: function() {
        return FileReadStream;
      },
      set: function(val) {
        FileReadStream = val;
      },
      enumerable: true,
      configurable: true
    });
    var FileWriteStream = WriteStream;
    Object.defineProperty(fs22, "FileWriteStream", {
      get: function() {
        return FileWriteStream;
      },
      set: function(val) {
        FileWriteStream = val;
      },
      enumerable: true,
      configurable: true
    });
    function ReadStream(path, options) {
      if (this instanceof ReadStream)
        return fs$ReadStream.apply(this, arguments), this;
      else
        return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
    }
    function ReadStream$open() {
      var that = this;
      open(that.path, that.flags, that.mode, function(err, fd) {
        if (err) {
          if (that.autoClose)
            that.destroy();
          that.emit("error", err);
        } else {
          that.fd = fd;
          that.emit("open", fd);
          that.read();
        }
      });
    }
    function WriteStream(path, options) {
      if (this instanceof WriteStream)
        return fs$WriteStream.apply(this, arguments), this;
      else
        return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
    }
    function WriteStream$open() {
      var that = this;
      open(that.path, that.flags, that.mode, function(err, fd) {
        if (err) {
          that.destroy();
          that.emit("error", err);
        } else {
          that.fd = fd;
          that.emit("open", fd);
        }
      });
    }
    function createReadStream(path, options) {
      return new fs22.ReadStream(path, options);
    }
    function createWriteStream(path, options) {
      return new fs22.WriteStream(path, options);
    }
    var fs$open = fs22.open;
    fs22.open = open;
    function open(path, flags, mode, cb) {
      if (typeof mode === "function")
        cb = mode, mode = null;
      return go$open(path, flags, mode, cb);
      function go$open(path2, flags2, mode2, cb2, startTime) {
        return fs$open(path2, flags2, mode2, function(err, fd) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$open, [path2, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    return fs22;
  }
  function enqueue(elem) {
    debug("ENQUEUE", elem[0].name, elem[1]);
    fs2[gracefulQueue].push(elem);
    retry2();
  }
  var retryTimer;
  function resetQueue() {
    var now = Date.now();
    for (var i = 0; i < fs2[gracefulQueue].length; ++i) {
      if (fs2[gracefulQueue][i].length > 2) {
        fs2[gracefulQueue][i][3] = now;
        fs2[gracefulQueue][i][4] = now;
      }
    }
    retry2();
  }
  function retry2() {
    clearTimeout(retryTimer);
    retryTimer = void 0;
    if (fs2[gracefulQueue].length === 0)
      return;
    var elem = fs2[gracefulQueue].shift();
    var fn = elem[0];
    var args = elem[1];
    var err = elem[2];
    var startTime = elem[3];
    var lastTime = elem[4];
    if (startTime === void 0) {
      debug("RETRY", fn.name, args);
      fn.apply(null, args);
    } else if (Date.now() - startTime >= 6e4) {
      debug("TIMEOUT", fn.name, args);
      var cb = args.pop();
      if (typeof cb === "function")
        cb.call(null, err);
    } else {
      var sinceAttempt = Date.now() - lastTime;
      var sinceStart = Math.max(lastTime - startTime, 1);
      var desiredDelay = Math.min(sinceStart * 1.2, 100);
      if (sinceAttempt >= desiredDelay) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args.concat([startTime]));
      } else {
        fs2[gracefulQueue].push(elem);
      }
    }
    if (retryTimer === void 0) {
      retryTimer = setTimeout(retry2, 0);
    }
  }
  return gracefulFs;
}
var hasRequiredFs;
function requireFs() {
  if (hasRequiredFs) return fs;
  hasRequiredFs = 1;
  (function(exports) {
    const u = requireUniversalify().fromCallback;
    const fs2 = requireGracefulFs();
    const api = [
      "access",
      "appendFile",
      "chmod",
      "chown",
      "close",
      "copyFile",
      "fchmod",
      "fchown",
      "fdatasync",
      "fstat",
      "fsync",
      "ftruncate",
      "futimes",
      "lchmod",
      "lchown",
      "link",
      "lstat",
      "mkdir",
      "mkdtemp",
      "open",
      "opendir",
      "readdir",
      "readFile",
      "readlink",
      "realpath",
      "rename",
      "rm",
      "rmdir",
      "stat",
      "symlink",
      "truncate",
      "unlink",
      "utimes",
      "writeFile"
    ].filter((key) => {
      return typeof fs2[key] === "function";
    });
    Object.assign(exports, fs2);
    api.forEach((method) => {
      exports[method] = u(fs2[method]);
    });
    exports.exists = function(filename, callback) {
      if (typeof callback === "function") {
        return fs2.exists(filename, callback);
      }
      return new Promise((resolve) => {
        return fs2.exists(filename, resolve);
      });
    };
    exports.read = function(fd, buffer, offset, length, position, callback) {
      if (typeof callback === "function") {
        return fs2.read(fd, buffer, offset, length, position, callback);
      }
      return new Promise((resolve, reject) => {
        fs2.read(fd, buffer, offset, length, position, (err, bytesRead, buffer2) => {
          if (err) return reject(err);
          resolve({ bytesRead, buffer: buffer2 });
        });
      });
    };
    exports.write = function(fd, buffer, ...args) {
      if (typeof args[args.length - 1] === "function") {
        return fs2.write(fd, buffer, ...args);
      }
      return new Promise((resolve, reject) => {
        fs2.write(fd, buffer, ...args, (err, bytesWritten, buffer2) => {
          if (err) return reject(err);
          resolve({ bytesWritten, buffer: buffer2 });
        });
      });
    };
    if (typeof fs2.writev === "function") {
      exports.writev = function(fd, buffers, ...args) {
        if (typeof args[args.length - 1] === "function") {
          return fs2.writev(fd, buffers, ...args);
        }
        return new Promise((resolve, reject) => {
          fs2.writev(fd, buffers, ...args, (err, bytesWritten, buffers2) => {
            if (err) return reject(err);
            resolve({ bytesWritten, buffers: buffers2 });
          });
        });
      };
    }
    if (typeof fs2.realpath.native === "function") {
      exports.realpath.native = u(fs2.realpath.native);
    } else {
      process.emitWarning(
        "fs.realpath.native is not a function. Is fs being monkey-patched?",
        "Warning",
        "fs-extra-WARN0003"
      );
    }
  })(fs);
  return fs;
}
var makeDir = {};
var utils$1 = {};
var hasRequiredUtils$1;
function requireUtils$1() {
  if (hasRequiredUtils$1) return utils$1;
  hasRequiredUtils$1 = 1;
  const path = require$$1$1;
  utils$1.checkPath = function checkPath(pth) {
    if (process.platform === "win32") {
      const pathHasInvalidWinCharacters = /[<>:"|?*]/.test(pth.replace(path.parse(pth).root, ""));
      if (pathHasInvalidWinCharacters) {
        const error2 = new Error(`Path contains invalid characters: ${pth}`);
        error2.code = "EINVAL";
        throw error2;
      }
    }
  };
  return utils$1;
}
var hasRequiredMakeDir;
function requireMakeDir() {
  if (hasRequiredMakeDir) return makeDir;
  hasRequiredMakeDir = 1;
  const fs2 = /* @__PURE__ */ requireFs();
  const { checkPath } = /* @__PURE__ */ requireUtils$1();
  const getMode = (options) => {
    const defaults = { mode: 511 };
    if (typeof options === "number") return options;
    return { ...defaults, ...options }.mode;
  };
  makeDir.makeDir = async (dir, options) => {
    checkPath(dir);
    return fs2.mkdir(dir, {
      mode: getMode(options),
      recursive: true
    });
  };
  makeDir.makeDirSync = (dir, options) => {
    checkPath(dir);
    return fs2.mkdirSync(dir, {
      mode: getMode(options),
      recursive: true
    });
  };
  return makeDir;
}
var mkdirs;
var hasRequiredMkdirs;
function requireMkdirs() {
  if (hasRequiredMkdirs) return mkdirs;
  hasRequiredMkdirs = 1;
  const u = requireUniversalify().fromPromise;
  const { makeDir: _makeDir, makeDirSync } = /* @__PURE__ */ requireMakeDir();
  const makeDir2 = u(_makeDir);
  mkdirs = {
    mkdirs: makeDir2,
    mkdirsSync: makeDirSync,
    // alias
    mkdirp: makeDir2,
    mkdirpSync: makeDirSync,
    ensureDir: makeDir2,
    ensureDirSync: makeDirSync
  };
  return mkdirs;
}
var pathExists_1;
var hasRequiredPathExists;
function requirePathExists() {
  if (hasRequiredPathExists) return pathExists_1;
  hasRequiredPathExists = 1;
  const u = requireUniversalify().fromPromise;
  const fs2 = /* @__PURE__ */ requireFs();
  function pathExists(path) {
    return fs2.access(path).then(() => true).catch(() => false);
  }
  pathExists_1 = {
    pathExists: u(pathExists),
    pathExistsSync: fs2.existsSync
  };
  return pathExists_1;
}
var utimes;
var hasRequiredUtimes;
function requireUtimes() {
  if (hasRequiredUtimes) return utimes;
  hasRequiredUtimes = 1;
  const fs2 = requireGracefulFs();
  function utimesMillis(path, atime, mtime, callback) {
    fs2.open(path, "r+", (err, fd) => {
      if (err) return callback(err);
      fs2.futimes(fd, atime, mtime, (futimesErr) => {
        fs2.close(fd, (closeErr) => {
          if (callback) callback(futimesErr || closeErr);
        });
      });
    });
  }
  function utimesMillisSync(path, atime, mtime) {
    const fd = fs2.openSync(path, "r+");
    fs2.futimesSync(fd, atime, mtime);
    return fs2.closeSync(fd);
  }
  utimes = {
    utimesMillis,
    utimesMillisSync
  };
  return utimes;
}
var stat;
var hasRequiredStat;
function requireStat() {
  if (hasRequiredStat) return stat;
  hasRequiredStat = 1;
  const fs2 = /* @__PURE__ */ requireFs();
  const path = require$$1$1;
  const util2 = require$$4$1;
  function getStats(src2, dest, opts) {
    const statFunc = opts.dereference ? (file2) => fs2.stat(file2, { bigint: true }) : (file2) => fs2.lstat(file2, { bigint: true });
    return Promise.all([
      statFunc(src2),
      statFunc(dest).catch((err) => {
        if (err.code === "ENOENT") return null;
        throw err;
      })
    ]).then(([srcStat, destStat]) => ({ srcStat, destStat }));
  }
  function getStatsSync(src2, dest, opts) {
    let destStat;
    const statFunc = opts.dereference ? (file2) => fs2.statSync(file2, { bigint: true }) : (file2) => fs2.lstatSync(file2, { bigint: true });
    const srcStat = statFunc(src2);
    try {
      destStat = statFunc(dest);
    } catch (err) {
      if (err.code === "ENOENT") return { srcStat, destStat: null };
      throw err;
    }
    return { srcStat, destStat };
  }
  function checkPaths(src2, dest, funcName, opts, cb) {
    util2.callbackify(getStats)(src2, dest, opts, (err, stats) => {
      if (err) return cb(err);
      const { srcStat, destStat } = stats;
      if (destStat) {
        if (areIdentical(srcStat, destStat)) {
          const srcBaseName = path.basename(src2);
          const destBaseName = path.basename(dest);
          if (funcName === "move" && srcBaseName !== destBaseName && srcBaseName.toLowerCase() === destBaseName.toLowerCase()) {
            return cb(null, { srcStat, destStat, isChangingCase: true });
          }
          return cb(new Error("Source and destination must not be the same."));
        }
        if (srcStat.isDirectory() && !destStat.isDirectory()) {
          return cb(new Error(`Cannot overwrite non-directory '${dest}' with directory '${src2}'.`));
        }
        if (!srcStat.isDirectory() && destStat.isDirectory()) {
          return cb(new Error(`Cannot overwrite directory '${dest}' with non-directory '${src2}'.`));
        }
      }
      if (srcStat.isDirectory() && isSrcSubdir(src2, dest)) {
        return cb(new Error(errMsg(src2, dest, funcName)));
      }
      return cb(null, { srcStat, destStat });
    });
  }
  function checkPathsSync(src2, dest, funcName, opts) {
    const { srcStat, destStat } = getStatsSync(src2, dest, opts);
    if (destStat) {
      if (areIdentical(srcStat, destStat)) {
        const srcBaseName = path.basename(src2);
        const destBaseName = path.basename(dest);
        if (funcName === "move" && srcBaseName !== destBaseName && srcBaseName.toLowerCase() === destBaseName.toLowerCase()) {
          return { srcStat, destStat, isChangingCase: true };
        }
        throw new Error("Source and destination must not be the same.");
      }
      if (srcStat.isDirectory() && !destStat.isDirectory()) {
        throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src2}'.`);
      }
      if (!srcStat.isDirectory() && destStat.isDirectory()) {
        throw new Error(`Cannot overwrite directory '${dest}' with non-directory '${src2}'.`);
      }
    }
    if (srcStat.isDirectory() && isSrcSubdir(src2, dest)) {
      throw new Error(errMsg(src2, dest, funcName));
    }
    return { srcStat, destStat };
  }
  function checkParentPaths(src2, srcStat, dest, funcName, cb) {
    const srcParent = path.resolve(path.dirname(src2));
    const destParent = path.resolve(path.dirname(dest));
    if (destParent === srcParent || destParent === path.parse(destParent).root) return cb();
    fs2.stat(destParent, { bigint: true }, (err, destStat) => {
      if (err) {
        if (err.code === "ENOENT") return cb();
        return cb(err);
      }
      if (areIdentical(srcStat, destStat)) {
        return cb(new Error(errMsg(src2, dest, funcName)));
      }
      return checkParentPaths(src2, srcStat, destParent, funcName, cb);
    });
  }
  function checkParentPathsSync(src2, srcStat, dest, funcName) {
    const srcParent = path.resolve(path.dirname(src2));
    const destParent = path.resolve(path.dirname(dest));
    if (destParent === srcParent || destParent === path.parse(destParent).root) return;
    let destStat;
    try {
      destStat = fs2.statSync(destParent, { bigint: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    if (areIdentical(srcStat, destStat)) {
      throw new Error(errMsg(src2, dest, funcName));
    }
    return checkParentPathsSync(src2, srcStat, destParent, funcName);
  }
  function areIdentical(srcStat, destStat) {
    return destStat.ino && destStat.dev && destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
  }
  function isSrcSubdir(src2, dest) {
    const srcArr = path.resolve(src2).split(path.sep).filter((i) => i);
    const destArr = path.resolve(dest).split(path.sep).filter((i) => i);
    return srcArr.reduce((acc, cur, i) => acc && destArr[i] === cur, true);
  }
  function errMsg(src2, dest, funcName) {
    return `Cannot ${funcName} '${src2}' to a subdirectory of itself, '${dest}'.`;
  }
  stat = {
    checkPaths,
    checkPathsSync,
    checkParentPaths,
    checkParentPathsSync,
    isSrcSubdir,
    areIdentical
  };
  return stat;
}
var copy_1;
var hasRequiredCopy$1;
function requireCopy$1() {
  if (hasRequiredCopy$1) return copy_1;
  hasRequiredCopy$1 = 1;
  const fs2 = requireGracefulFs();
  const path = require$$1$1;
  const mkdirs2 = requireMkdirs().mkdirs;
  const pathExists = requirePathExists().pathExists;
  const utimesMillis = requireUtimes().utimesMillis;
  const stat2 = /* @__PURE__ */ requireStat();
  function copy2(src2, dest, opts, cb) {
    if (typeof opts === "function" && !cb) {
      cb = opts;
      opts = {};
    } else if (typeof opts === "function") {
      opts = { filter: opts };
    }
    cb = cb || function() {
    };
    opts = opts || {};
    opts.clobber = "clobber" in opts ? !!opts.clobber : true;
    opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
    if (opts.preserveTimestamps && process.arch === "ia32") {
      process.emitWarning(
        "Using the preserveTimestamps option in 32-bit node is not recommended;\n\n	see https://github.com/jprichardson/node-fs-extra/issues/269",
        "Warning",
        "fs-extra-WARN0001"
      );
    }
    stat2.checkPaths(src2, dest, "copy", opts, (err, stats) => {
      if (err) return cb(err);
      const { srcStat, destStat } = stats;
      stat2.checkParentPaths(src2, srcStat, dest, "copy", (err2) => {
        if (err2) return cb(err2);
        if (opts.filter) return handleFilter(checkParentDir, destStat, src2, dest, opts, cb);
        return checkParentDir(destStat, src2, dest, opts, cb);
      });
    });
  }
  function checkParentDir(destStat, src2, dest, opts, cb) {
    const destParent = path.dirname(dest);
    pathExists(destParent, (err, dirExists) => {
      if (err) return cb(err);
      if (dirExists) return getStats(destStat, src2, dest, opts, cb);
      mkdirs2(destParent, (err2) => {
        if (err2) return cb(err2);
        return getStats(destStat, src2, dest, opts, cb);
      });
    });
  }
  function handleFilter(onInclude, destStat, src2, dest, opts, cb) {
    Promise.resolve(opts.filter(src2, dest)).then((include) => {
      if (include) return onInclude(destStat, src2, dest, opts, cb);
      return cb();
    }, (error2) => cb(error2));
  }
  function startCopy(destStat, src2, dest, opts, cb) {
    if (opts.filter) return handleFilter(getStats, destStat, src2, dest, opts, cb);
    return getStats(destStat, src2, dest, opts, cb);
  }
  function getStats(destStat, src2, dest, opts, cb) {
    const stat3 = opts.dereference ? fs2.stat : fs2.lstat;
    stat3(src2, (err, srcStat) => {
      if (err) return cb(err);
      if (srcStat.isDirectory()) return onDir(srcStat, destStat, src2, dest, opts, cb);
      else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) return onFile(srcStat, destStat, src2, dest, opts, cb);
      else if (srcStat.isSymbolicLink()) return onLink(destStat, src2, dest, opts, cb);
      else if (srcStat.isSocket()) return cb(new Error(`Cannot copy a socket file: ${src2}`));
      else if (srcStat.isFIFO()) return cb(new Error(`Cannot copy a FIFO pipe: ${src2}`));
      return cb(new Error(`Unknown file: ${src2}`));
    });
  }
  function onFile(srcStat, destStat, src2, dest, opts, cb) {
    if (!destStat) return copyFile(srcStat, src2, dest, opts, cb);
    return mayCopyFile(srcStat, src2, dest, opts, cb);
  }
  function mayCopyFile(srcStat, src2, dest, opts, cb) {
    if (opts.overwrite) {
      fs2.unlink(dest, (err) => {
        if (err) return cb(err);
        return copyFile(srcStat, src2, dest, opts, cb);
      });
    } else if (opts.errorOnExist) {
      return cb(new Error(`'${dest}' already exists`));
    } else return cb();
  }
  function copyFile(srcStat, src2, dest, opts, cb) {
    fs2.copyFile(src2, dest, (err) => {
      if (err) return cb(err);
      if (opts.preserveTimestamps) return handleTimestampsAndMode(srcStat.mode, src2, dest, cb);
      return setDestMode(dest, srcStat.mode, cb);
    });
  }
  function handleTimestampsAndMode(srcMode, src2, dest, cb) {
    if (fileIsNotWritable(srcMode)) {
      return makeFileWritable(dest, srcMode, (err) => {
        if (err) return cb(err);
        return setDestTimestampsAndMode(srcMode, src2, dest, cb);
      });
    }
    return setDestTimestampsAndMode(srcMode, src2, dest, cb);
  }
  function fileIsNotWritable(srcMode) {
    return (srcMode & 128) === 0;
  }
  function makeFileWritable(dest, srcMode, cb) {
    return setDestMode(dest, srcMode | 128, cb);
  }
  function setDestTimestampsAndMode(srcMode, src2, dest, cb) {
    setDestTimestamps(src2, dest, (err) => {
      if (err) return cb(err);
      return setDestMode(dest, srcMode, cb);
    });
  }
  function setDestMode(dest, srcMode, cb) {
    return fs2.chmod(dest, srcMode, cb);
  }
  function setDestTimestamps(src2, dest, cb) {
    fs2.stat(src2, (err, updatedSrcStat) => {
      if (err) return cb(err);
      return utimesMillis(dest, updatedSrcStat.atime, updatedSrcStat.mtime, cb);
    });
  }
  function onDir(srcStat, destStat, src2, dest, opts, cb) {
    if (!destStat) return mkDirAndCopy(srcStat.mode, src2, dest, opts, cb);
    return copyDir(src2, dest, opts, cb);
  }
  function mkDirAndCopy(srcMode, src2, dest, opts, cb) {
    fs2.mkdir(dest, (err) => {
      if (err) return cb(err);
      copyDir(src2, dest, opts, (err2) => {
        if (err2) return cb(err2);
        return setDestMode(dest, srcMode, cb);
      });
    });
  }
  function copyDir(src2, dest, opts, cb) {
    fs2.readdir(src2, (err, items) => {
      if (err) return cb(err);
      return copyDirItems(items, src2, dest, opts, cb);
    });
  }
  function copyDirItems(items, src2, dest, opts, cb) {
    const item = items.pop();
    if (!item) return cb();
    return copyDirItem(items, item, src2, dest, opts, cb);
  }
  function copyDirItem(items, item, src2, dest, opts, cb) {
    const srcItem = path.join(src2, item);
    const destItem = path.join(dest, item);
    stat2.checkPaths(srcItem, destItem, "copy", opts, (err, stats) => {
      if (err) return cb(err);
      const { destStat } = stats;
      startCopy(destStat, srcItem, destItem, opts, (err2) => {
        if (err2) return cb(err2);
        return copyDirItems(items, src2, dest, opts, cb);
      });
    });
  }
  function onLink(destStat, src2, dest, opts, cb) {
    fs2.readlink(src2, (err, resolvedSrc) => {
      if (err) return cb(err);
      if (opts.dereference) {
        resolvedSrc = path.resolve(process.cwd(), resolvedSrc);
      }
      if (!destStat) {
        return fs2.symlink(resolvedSrc, dest, cb);
      } else {
        fs2.readlink(dest, (err2, resolvedDest) => {
          if (err2) {
            if (err2.code === "EINVAL" || err2.code === "UNKNOWN") return fs2.symlink(resolvedSrc, dest, cb);
            return cb(err2);
          }
          if (opts.dereference) {
            resolvedDest = path.resolve(process.cwd(), resolvedDest);
          }
          if (stat2.isSrcSubdir(resolvedSrc, resolvedDest)) {
            return cb(new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`));
          }
          if (destStat.isDirectory() && stat2.isSrcSubdir(resolvedDest, resolvedSrc)) {
            return cb(new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`));
          }
          return copyLink(resolvedSrc, dest, cb);
        });
      }
    });
  }
  function copyLink(resolvedSrc, dest, cb) {
    fs2.unlink(dest, (err) => {
      if (err) return cb(err);
      return fs2.symlink(resolvedSrc, dest, cb);
    });
  }
  copy_1 = copy2;
  return copy_1;
}
var copySync_1;
var hasRequiredCopySync;
function requireCopySync() {
  if (hasRequiredCopySync) return copySync_1;
  hasRequiredCopySync = 1;
  const fs2 = requireGracefulFs();
  const path = require$$1$1;
  const mkdirsSync = requireMkdirs().mkdirsSync;
  const utimesMillisSync = requireUtimes().utimesMillisSync;
  const stat2 = /* @__PURE__ */ requireStat();
  function copySync(src2, dest, opts) {
    if (typeof opts === "function") {
      opts = { filter: opts };
    }
    opts = opts || {};
    opts.clobber = "clobber" in opts ? !!opts.clobber : true;
    opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
    if (opts.preserveTimestamps && process.arch === "ia32") {
      process.emitWarning(
        "Using the preserveTimestamps option in 32-bit node is not recommended;\n\n	see https://github.com/jprichardson/node-fs-extra/issues/269",
        "Warning",
        "fs-extra-WARN0002"
      );
    }
    const { srcStat, destStat } = stat2.checkPathsSync(src2, dest, "copy", opts);
    stat2.checkParentPathsSync(src2, srcStat, dest, "copy");
    return handleFilterAndCopy(destStat, src2, dest, opts);
  }
  function handleFilterAndCopy(destStat, src2, dest, opts) {
    if (opts.filter && !opts.filter(src2, dest)) return;
    const destParent = path.dirname(dest);
    if (!fs2.existsSync(destParent)) mkdirsSync(destParent);
    return getStats(destStat, src2, dest, opts);
  }
  function startCopy(destStat, src2, dest, opts) {
    if (opts.filter && !opts.filter(src2, dest)) return;
    return getStats(destStat, src2, dest, opts);
  }
  function getStats(destStat, src2, dest, opts) {
    const statSync = opts.dereference ? fs2.statSync : fs2.lstatSync;
    const srcStat = statSync(src2);
    if (srcStat.isDirectory()) return onDir(srcStat, destStat, src2, dest, opts);
    else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) return onFile(srcStat, destStat, src2, dest, opts);
    else if (srcStat.isSymbolicLink()) return onLink(destStat, src2, dest, opts);
    else if (srcStat.isSocket()) throw new Error(`Cannot copy a socket file: ${src2}`);
    else if (srcStat.isFIFO()) throw new Error(`Cannot copy a FIFO pipe: ${src2}`);
    throw new Error(`Unknown file: ${src2}`);
  }
  function onFile(srcStat, destStat, src2, dest, opts) {
    if (!destStat) return copyFile(srcStat, src2, dest, opts);
    return mayCopyFile(srcStat, src2, dest, opts);
  }
  function mayCopyFile(srcStat, src2, dest, opts) {
    if (opts.overwrite) {
      fs2.unlinkSync(dest);
      return copyFile(srcStat, src2, dest, opts);
    } else if (opts.errorOnExist) {
      throw new Error(`'${dest}' already exists`);
    }
  }
  function copyFile(srcStat, src2, dest, opts) {
    fs2.copyFileSync(src2, dest);
    if (opts.preserveTimestamps) handleTimestamps(srcStat.mode, src2, dest);
    return setDestMode(dest, srcStat.mode);
  }
  function handleTimestamps(srcMode, src2, dest) {
    if (fileIsNotWritable(srcMode)) makeFileWritable(dest, srcMode);
    return setDestTimestamps(src2, dest);
  }
  function fileIsNotWritable(srcMode) {
    return (srcMode & 128) === 0;
  }
  function makeFileWritable(dest, srcMode) {
    return setDestMode(dest, srcMode | 128);
  }
  function setDestMode(dest, srcMode) {
    return fs2.chmodSync(dest, srcMode);
  }
  function setDestTimestamps(src2, dest) {
    const updatedSrcStat = fs2.statSync(src2);
    return utimesMillisSync(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
  }
  function onDir(srcStat, destStat, src2, dest, opts) {
    if (!destStat) return mkDirAndCopy(srcStat.mode, src2, dest, opts);
    return copyDir(src2, dest, opts);
  }
  function mkDirAndCopy(srcMode, src2, dest, opts) {
    fs2.mkdirSync(dest);
    copyDir(src2, dest, opts);
    return setDestMode(dest, srcMode);
  }
  function copyDir(src2, dest, opts) {
    fs2.readdirSync(src2).forEach((item) => copyDirItem(item, src2, dest, opts));
  }
  function copyDirItem(item, src2, dest, opts) {
    const srcItem = path.join(src2, item);
    const destItem = path.join(dest, item);
    const { destStat } = stat2.checkPathsSync(srcItem, destItem, "copy", opts);
    return startCopy(destStat, srcItem, destItem, opts);
  }
  function onLink(destStat, src2, dest, opts) {
    let resolvedSrc = fs2.readlinkSync(src2);
    if (opts.dereference) {
      resolvedSrc = path.resolve(process.cwd(), resolvedSrc);
    }
    if (!destStat) {
      return fs2.symlinkSync(resolvedSrc, dest);
    } else {
      let resolvedDest;
      try {
        resolvedDest = fs2.readlinkSync(dest);
      } catch (err) {
        if (err.code === "EINVAL" || err.code === "UNKNOWN") return fs2.symlinkSync(resolvedSrc, dest);
        throw err;
      }
      if (opts.dereference) {
        resolvedDest = path.resolve(process.cwd(), resolvedDest);
      }
      if (stat2.isSrcSubdir(resolvedSrc, resolvedDest)) {
        throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
      }
      if (fs2.statSync(dest).isDirectory() && stat2.isSrcSubdir(resolvedDest, resolvedSrc)) {
        throw new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`);
      }
      return copyLink(resolvedSrc, dest);
    }
  }
  function copyLink(resolvedSrc, dest) {
    fs2.unlinkSync(dest);
    return fs2.symlinkSync(resolvedSrc, dest);
  }
  copySync_1 = copySync;
  return copySync_1;
}
var copy;
var hasRequiredCopy;
function requireCopy() {
  if (hasRequiredCopy) return copy;
  hasRequiredCopy = 1;
  const u = requireUniversalify().fromCallback;
  copy = {
    copy: u(/* @__PURE__ */ requireCopy$1()),
    copySync: /* @__PURE__ */ requireCopySync()
  };
  return copy;
}
var rimraf_1;
var hasRequiredRimraf;
function requireRimraf() {
  if (hasRequiredRimraf) return rimraf_1;
  hasRequiredRimraf = 1;
  const fs2 = requireGracefulFs();
  const path = require$$1$1;
  const assert = require$$5;
  const isWindows = process.platform === "win32";
  function defaults(options) {
    const methods = [
      "unlink",
      "chmod",
      "stat",
      "lstat",
      "rmdir",
      "readdir"
    ];
    methods.forEach((m) => {
      options[m] = options[m] || fs2[m];
      m = m + "Sync";
      options[m] = options[m] || fs2[m];
    });
    options.maxBusyTries = options.maxBusyTries || 3;
  }
  function rimraf(p, options, cb) {
    let busyTries = 0;
    if (typeof options === "function") {
      cb = options;
      options = {};
    }
    assert(p, "rimraf: missing path");
    assert.strictEqual(typeof p, "string", "rimraf: path should be a string");
    assert.strictEqual(typeof cb, "function", "rimraf: callback function required");
    assert(options, "rimraf: invalid options argument provided");
    assert.strictEqual(typeof options, "object", "rimraf: options should be object");
    defaults(options);
    rimraf_(p, options, function CB(er) {
      if (er) {
        if ((er.code === "EBUSY" || er.code === "ENOTEMPTY" || er.code === "EPERM") && busyTries < options.maxBusyTries) {
          busyTries++;
          const time = busyTries * 100;
          return setTimeout(() => rimraf_(p, options, CB), time);
        }
        if (er.code === "ENOENT") er = null;
      }
      cb(er);
    });
  }
  function rimraf_(p, options, cb) {
    assert(p);
    assert(options);
    assert(typeof cb === "function");
    options.lstat(p, (er, st) => {
      if (er && er.code === "ENOENT") {
        return cb(null);
      }
      if (er && er.code === "EPERM" && isWindows) {
        return fixWinEPERM(p, options, er, cb);
      }
      if (st && st.isDirectory()) {
        return rmdir(p, options, er, cb);
      }
      options.unlink(p, (er2) => {
        if (er2) {
          if (er2.code === "ENOENT") {
            return cb(null);
          }
          if (er2.code === "EPERM") {
            return isWindows ? fixWinEPERM(p, options, er2, cb) : rmdir(p, options, er2, cb);
          }
          if (er2.code === "EISDIR") {
            return rmdir(p, options, er2, cb);
          }
        }
        return cb(er2);
      });
    });
  }
  function fixWinEPERM(p, options, er, cb) {
    assert(p);
    assert(options);
    assert(typeof cb === "function");
    options.chmod(p, 438, (er2) => {
      if (er2) {
        cb(er2.code === "ENOENT" ? null : er);
      } else {
        options.stat(p, (er3, stats) => {
          if (er3) {
            cb(er3.code === "ENOENT" ? null : er);
          } else if (stats.isDirectory()) {
            rmdir(p, options, er, cb);
          } else {
            options.unlink(p, cb);
          }
        });
      }
    });
  }
  function fixWinEPERMSync(p, options, er) {
    let stats;
    assert(p);
    assert(options);
    try {
      options.chmodSync(p, 438);
    } catch (er2) {
      if (er2.code === "ENOENT") {
        return;
      } else {
        throw er;
      }
    }
    try {
      stats = options.statSync(p);
    } catch (er3) {
      if (er3.code === "ENOENT") {
        return;
      } else {
        throw er;
      }
    }
    if (stats.isDirectory()) {
      rmdirSync(p, options, er);
    } else {
      options.unlinkSync(p);
    }
  }
  function rmdir(p, options, originalEr, cb) {
    assert(p);
    assert(options);
    assert(typeof cb === "function");
    options.rmdir(p, (er) => {
      if (er && (er.code === "ENOTEMPTY" || er.code === "EEXIST" || er.code === "EPERM")) {
        rmkids(p, options, cb);
      } else if (er && er.code === "ENOTDIR") {
        cb(originalEr);
      } else {
        cb(er);
      }
    });
  }
  function rmkids(p, options, cb) {
    assert(p);
    assert(options);
    assert(typeof cb === "function");
    options.readdir(p, (er, files) => {
      if (er) return cb(er);
      let n = files.length;
      let errState;
      if (n === 0) return options.rmdir(p, cb);
      files.forEach((f) => {
        rimraf(path.join(p, f), options, (er2) => {
          if (errState) {
            return;
          }
          if (er2) return cb(errState = er2);
          if (--n === 0) {
            options.rmdir(p, cb);
          }
        });
      });
    });
  }
  function rimrafSync(p, options) {
    let st;
    options = options || {};
    defaults(options);
    assert(p, "rimraf: missing path");
    assert.strictEqual(typeof p, "string", "rimraf: path should be a string");
    assert(options, "rimraf: missing options");
    assert.strictEqual(typeof options, "object", "rimraf: options should be object");
    try {
      st = options.lstatSync(p);
    } catch (er) {
      if (er.code === "ENOENT") {
        return;
      }
      if (er.code === "EPERM" && isWindows) {
        fixWinEPERMSync(p, options, er);
      }
    }
    try {
      if (st && st.isDirectory()) {
        rmdirSync(p, options, null);
      } else {
        options.unlinkSync(p);
      }
    } catch (er) {
      if (er.code === "ENOENT") {
        return;
      } else if (er.code === "EPERM") {
        return isWindows ? fixWinEPERMSync(p, options, er) : rmdirSync(p, options, er);
      } else if (er.code !== "EISDIR") {
        throw er;
      }
      rmdirSync(p, options, er);
    }
  }
  function rmdirSync(p, options, originalEr) {
    assert(p);
    assert(options);
    try {
      options.rmdirSync(p);
    } catch (er) {
      if (er.code === "ENOTDIR") {
        throw originalEr;
      } else if (er.code === "ENOTEMPTY" || er.code === "EEXIST" || er.code === "EPERM") {
        rmkidsSync(p, options);
      } else if (er.code !== "ENOENT") {
        throw er;
      }
    }
  }
  function rmkidsSync(p, options) {
    assert(p);
    assert(options);
    options.readdirSync(p).forEach((f) => rimrafSync(path.join(p, f), options));
    if (isWindows) {
      const startTime = Date.now();
      do {
        try {
          const ret = options.rmdirSync(p, options);
          return ret;
        } catch {
        }
      } while (Date.now() - startTime < 500);
    } else {
      const ret = options.rmdirSync(p, options);
      return ret;
    }
  }
  rimraf_1 = rimraf;
  rimraf.sync = rimrafSync;
  return rimraf_1;
}
var remove_1;
var hasRequiredRemove;
function requireRemove() {
  if (hasRequiredRemove) return remove_1;
  hasRequiredRemove = 1;
  const fs2 = requireGracefulFs();
  const u = requireUniversalify().fromCallback;
  const rimraf = /* @__PURE__ */ requireRimraf();
  function remove(path, callback) {
    if (fs2.rm) return fs2.rm(path, { recursive: true, force: true }, callback);
    rimraf(path, callback);
  }
  function removeSync(path) {
    if (fs2.rmSync) return fs2.rmSync(path, { recursive: true, force: true });
    rimraf.sync(path);
  }
  remove_1 = {
    remove: u(remove),
    removeSync
  };
  return remove_1;
}
var empty;
var hasRequiredEmpty;
function requireEmpty() {
  if (hasRequiredEmpty) return empty;
  hasRequiredEmpty = 1;
  const u = requireUniversalify().fromPromise;
  const fs2 = /* @__PURE__ */ requireFs();
  const path = require$$1$1;
  const mkdir = /* @__PURE__ */ requireMkdirs();
  const remove = /* @__PURE__ */ requireRemove();
  const emptyDir = u(async function emptyDir2(dir) {
    let items;
    try {
      items = await fs2.readdir(dir);
    } catch {
      return mkdir.mkdirs(dir);
    }
    return Promise.all(items.map((item) => remove.remove(path.join(dir, item))));
  });
  function emptyDirSync(dir) {
    let items;
    try {
      items = fs2.readdirSync(dir);
    } catch {
      return mkdir.mkdirsSync(dir);
    }
    items.forEach((item) => {
      item = path.join(dir, item);
      remove.removeSync(item);
    });
  }
  empty = {
    emptyDirSync,
    emptydirSync: emptyDirSync,
    emptyDir,
    emptydir: emptyDir
  };
  return empty;
}
var file;
var hasRequiredFile;
function requireFile() {
  if (hasRequiredFile) return file;
  hasRequiredFile = 1;
  const u = requireUniversalify().fromCallback;
  const path = require$$1$1;
  const fs2 = requireGracefulFs();
  const mkdir = /* @__PURE__ */ requireMkdirs();
  function createFile(file2, callback) {
    function makeFile() {
      fs2.writeFile(file2, "", (err) => {
        if (err) return callback(err);
        callback();
      });
    }
    fs2.stat(file2, (err, stats) => {
      if (!err && stats.isFile()) return callback();
      const dir = path.dirname(file2);
      fs2.stat(dir, (err2, stats2) => {
        if (err2) {
          if (err2.code === "ENOENT") {
            return mkdir.mkdirs(dir, (err3) => {
              if (err3) return callback(err3);
              makeFile();
            });
          }
          return callback(err2);
        }
        if (stats2.isDirectory()) makeFile();
        else {
          fs2.readdir(dir, (err3) => {
            if (err3) return callback(err3);
          });
        }
      });
    });
  }
  function createFileSync(file2) {
    let stats;
    try {
      stats = fs2.statSync(file2);
    } catch {
    }
    if (stats && stats.isFile()) return;
    const dir = path.dirname(file2);
    try {
      if (!fs2.statSync(dir).isDirectory()) {
        fs2.readdirSync(dir);
      }
    } catch (err) {
      if (err && err.code === "ENOENT") mkdir.mkdirsSync(dir);
      else throw err;
    }
    fs2.writeFileSync(file2, "");
  }
  file = {
    createFile: u(createFile),
    createFileSync
  };
  return file;
}
var link;
var hasRequiredLink;
function requireLink() {
  if (hasRequiredLink) return link;
  hasRequiredLink = 1;
  const u = requireUniversalify().fromCallback;
  const path = require$$1$1;
  const fs2 = requireGracefulFs();
  const mkdir = /* @__PURE__ */ requireMkdirs();
  const pathExists = requirePathExists().pathExists;
  const { areIdentical } = /* @__PURE__ */ requireStat();
  function createLink(srcpath, dstpath, callback) {
    function makeLink(srcpath2, dstpath2) {
      fs2.link(srcpath2, dstpath2, (err) => {
        if (err) return callback(err);
        callback(null);
      });
    }
    fs2.lstat(dstpath, (_, dstStat) => {
      fs2.lstat(srcpath, (err, srcStat) => {
        if (err) {
          err.message = err.message.replace("lstat", "ensureLink");
          return callback(err);
        }
        if (dstStat && areIdentical(srcStat, dstStat)) return callback(null);
        const dir = path.dirname(dstpath);
        pathExists(dir, (err2, dirExists) => {
          if (err2) return callback(err2);
          if (dirExists) return makeLink(srcpath, dstpath);
          mkdir.mkdirs(dir, (err3) => {
            if (err3) return callback(err3);
            makeLink(srcpath, dstpath);
          });
        });
      });
    });
  }
  function createLinkSync(srcpath, dstpath) {
    let dstStat;
    try {
      dstStat = fs2.lstatSync(dstpath);
    } catch {
    }
    try {
      const srcStat = fs2.lstatSync(srcpath);
      if (dstStat && areIdentical(srcStat, dstStat)) return;
    } catch (err) {
      err.message = err.message.replace("lstat", "ensureLink");
      throw err;
    }
    const dir = path.dirname(dstpath);
    const dirExists = fs2.existsSync(dir);
    if (dirExists) return fs2.linkSync(srcpath, dstpath);
    mkdir.mkdirsSync(dir);
    return fs2.linkSync(srcpath, dstpath);
  }
  link = {
    createLink: u(createLink),
    createLinkSync
  };
  return link;
}
var symlinkPaths_1;
var hasRequiredSymlinkPaths;
function requireSymlinkPaths() {
  if (hasRequiredSymlinkPaths) return symlinkPaths_1;
  hasRequiredSymlinkPaths = 1;
  const path = require$$1$1;
  const fs2 = requireGracefulFs();
  const pathExists = requirePathExists().pathExists;
  function symlinkPaths(srcpath, dstpath, callback) {
    if (path.isAbsolute(srcpath)) {
      return fs2.lstat(srcpath, (err) => {
        if (err) {
          err.message = err.message.replace("lstat", "ensureSymlink");
          return callback(err);
        }
        return callback(null, {
          toCwd: srcpath,
          toDst: srcpath
        });
      });
    } else {
      const dstdir = path.dirname(dstpath);
      const relativeToDst = path.join(dstdir, srcpath);
      return pathExists(relativeToDst, (err, exists) => {
        if (err) return callback(err);
        if (exists) {
          return callback(null, {
            toCwd: relativeToDst,
            toDst: srcpath
          });
        } else {
          return fs2.lstat(srcpath, (err2) => {
            if (err2) {
              err2.message = err2.message.replace("lstat", "ensureSymlink");
              return callback(err2);
            }
            return callback(null, {
              toCwd: srcpath,
              toDst: path.relative(dstdir, srcpath)
            });
          });
        }
      });
    }
  }
  function symlinkPathsSync(srcpath, dstpath) {
    let exists;
    if (path.isAbsolute(srcpath)) {
      exists = fs2.existsSync(srcpath);
      if (!exists) throw new Error("absolute srcpath does not exist");
      return {
        toCwd: srcpath,
        toDst: srcpath
      };
    } else {
      const dstdir = path.dirname(dstpath);
      const relativeToDst = path.join(dstdir, srcpath);
      exists = fs2.existsSync(relativeToDst);
      if (exists) {
        return {
          toCwd: relativeToDst,
          toDst: srcpath
        };
      } else {
        exists = fs2.existsSync(srcpath);
        if (!exists) throw new Error("relative srcpath does not exist");
        return {
          toCwd: srcpath,
          toDst: path.relative(dstdir, srcpath)
        };
      }
    }
  }
  symlinkPaths_1 = {
    symlinkPaths,
    symlinkPathsSync
  };
  return symlinkPaths_1;
}
var symlinkType_1;
var hasRequiredSymlinkType;
function requireSymlinkType() {
  if (hasRequiredSymlinkType) return symlinkType_1;
  hasRequiredSymlinkType = 1;
  const fs2 = requireGracefulFs();
  function symlinkType(srcpath, type2, callback) {
    callback = typeof type2 === "function" ? type2 : callback;
    type2 = typeof type2 === "function" ? false : type2;
    if (type2) return callback(null, type2);
    fs2.lstat(srcpath, (err, stats) => {
      if (err) return callback(null, "file");
      type2 = stats && stats.isDirectory() ? "dir" : "file";
      callback(null, type2);
    });
  }
  function symlinkTypeSync(srcpath, type2) {
    let stats;
    if (type2) return type2;
    try {
      stats = fs2.lstatSync(srcpath);
    } catch {
      return "file";
    }
    return stats && stats.isDirectory() ? "dir" : "file";
  }
  symlinkType_1 = {
    symlinkType,
    symlinkTypeSync
  };
  return symlinkType_1;
}
var symlink;
var hasRequiredSymlink;
function requireSymlink() {
  if (hasRequiredSymlink) return symlink;
  hasRequiredSymlink = 1;
  const u = requireUniversalify().fromCallback;
  const path = require$$1$1;
  const fs2 = /* @__PURE__ */ requireFs();
  const _mkdirs = /* @__PURE__ */ requireMkdirs();
  const mkdirs2 = _mkdirs.mkdirs;
  const mkdirsSync = _mkdirs.mkdirsSync;
  const _symlinkPaths = /* @__PURE__ */ requireSymlinkPaths();
  const symlinkPaths = _symlinkPaths.symlinkPaths;
  const symlinkPathsSync = _symlinkPaths.symlinkPathsSync;
  const _symlinkType = /* @__PURE__ */ requireSymlinkType();
  const symlinkType = _symlinkType.symlinkType;
  const symlinkTypeSync = _symlinkType.symlinkTypeSync;
  const pathExists = requirePathExists().pathExists;
  const { areIdentical } = /* @__PURE__ */ requireStat();
  function createSymlink(srcpath, dstpath, type2, callback) {
    callback = typeof type2 === "function" ? type2 : callback;
    type2 = typeof type2 === "function" ? false : type2;
    fs2.lstat(dstpath, (err, stats) => {
      if (!err && stats.isSymbolicLink()) {
        Promise.all([
          fs2.stat(srcpath),
          fs2.stat(dstpath)
        ]).then(([srcStat, dstStat]) => {
          if (areIdentical(srcStat, dstStat)) return callback(null);
          _createSymlink(srcpath, dstpath, type2, callback);
        });
      } else _createSymlink(srcpath, dstpath, type2, callback);
    });
  }
  function _createSymlink(srcpath, dstpath, type2, callback) {
    symlinkPaths(srcpath, dstpath, (err, relative) => {
      if (err) return callback(err);
      srcpath = relative.toDst;
      symlinkType(relative.toCwd, type2, (err2, type3) => {
        if (err2) return callback(err2);
        const dir = path.dirname(dstpath);
        pathExists(dir, (err3, dirExists) => {
          if (err3) return callback(err3);
          if (dirExists) return fs2.symlink(srcpath, dstpath, type3, callback);
          mkdirs2(dir, (err4) => {
            if (err4) return callback(err4);
            fs2.symlink(srcpath, dstpath, type3, callback);
          });
        });
      });
    });
  }
  function createSymlinkSync(srcpath, dstpath, type2) {
    let stats;
    try {
      stats = fs2.lstatSync(dstpath);
    } catch {
    }
    if (stats && stats.isSymbolicLink()) {
      const srcStat = fs2.statSync(srcpath);
      const dstStat = fs2.statSync(dstpath);
      if (areIdentical(srcStat, dstStat)) return;
    }
    const relative = symlinkPathsSync(srcpath, dstpath);
    srcpath = relative.toDst;
    type2 = symlinkTypeSync(relative.toCwd, type2);
    const dir = path.dirname(dstpath);
    const exists = fs2.existsSync(dir);
    if (exists) return fs2.symlinkSync(srcpath, dstpath, type2);
    mkdirsSync(dir);
    return fs2.symlinkSync(srcpath, dstpath, type2);
  }
  symlink = {
    createSymlink: u(createSymlink),
    createSymlinkSync
  };
  return symlink;
}
var ensure;
var hasRequiredEnsure;
function requireEnsure() {
  if (hasRequiredEnsure) return ensure;
  hasRequiredEnsure = 1;
  const { createFile, createFileSync } = /* @__PURE__ */ requireFile();
  const { createLink, createLinkSync } = /* @__PURE__ */ requireLink();
  const { createSymlink, createSymlinkSync } = /* @__PURE__ */ requireSymlink();
  ensure = {
    // file
    createFile,
    createFileSync,
    ensureFile: createFile,
    ensureFileSync: createFileSync,
    // link
    createLink,
    createLinkSync,
    ensureLink: createLink,
    ensureLinkSync: createLinkSync,
    // symlink
    createSymlink,
    createSymlinkSync,
    ensureSymlink: createSymlink,
    ensureSymlinkSync: createSymlinkSync
  };
  return ensure;
}
var utils;
var hasRequiredUtils;
function requireUtils() {
  if (hasRequiredUtils) return utils;
  hasRequiredUtils = 1;
  function stringify(obj, { EOL = "\n", finalEOL = true, replacer = null, spaces } = {}) {
    const EOF = finalEOL ? EOL : "";
    const str2 = JSON.stringify(obj, replacer, spaces);
    if (str2 === void 0) {
      throw new TypeError(`Converting ${typeof obj} value to JSON is not supported`);
    }
    return str2.replace(/\n/g, EOL) + EOF;
  }
  function stripBom(content) {
    if (Buffer.isBuffer(content)) content = content.toString("utf8");
    return content.replace(/^\uFEFF/, "");
  }
  utils = { stringify, stripBom };
  return utils;
}
var jsonfile$1;
var hasRequiredJsonfile$1;
function requireJsonfile$1() {
  if (hasRequiredJsonfile$1) return jsonfile$1;
  hasRequiredJsonfile$1 = 1;
  let _fs;
  try {
    _fs = requireGracefulFs();
  } catch (_) {
    _fs = require$$1$2;
  }
  const universalify2 = requireUniversalify();
  const { stringify, stripBom } = requireUtils();
  async function _readFile(file2, options = {}) {
    if (typeof options === "string") {
      options = { encoding: options };
    }
    const fs2 = options.fs || _fs;
    const shouldThrow = "throws" in options ? options.throws : true;
    let data = await universalify2.fromCallback(fs2.readFile)(file2, options);
    data = stripBom(data);
    let obj;
    try {
      obj = JSON.parse(data, options ? options.reviver : null);
    } catch (err) {
      if (shouldThrow) {
        err.message = `${file2}: ${err.message}`;
        throw err;
      } else {
        return null;
      }
    }
    return obj;
  }
  const readFile = universalify2.fromPromise(_readFile);
  function readFileSync(file2, options = {}) {
    if (typeof options === "string") {
      options = { encoding: options };
    }
    const fs2 = options.fs || _fs;
    const shouldThrow = "throws" in options ? options.throws : true;
    try {
      let content = fs2.readFileSync(file2, options);
      content = stripBom(content);
      return JSON.parse(content, options.reviver);
    } catch (err) {
      if (shouldThrow) {
        err.message = `${file2}: ${err.message}`;
        throw err;
      } else {
        return null;
      }
    }
  }
  async function _writeFile(file2, obj, options = {}) {
    const fs2 = options.fs || _fs;
    const str2 = stringify(obj, options);
    await universalify2.fromCallback(fs2.writeFile)(file2, str2, options);
  }
  const writeFile = universalify2.fromPromise(_writeFile);
  function writeFileSync(file2, obj, options = {}) {
    const fs2 = options.fs || _fs;
    const str2 = stringify(obj, options);
    return fs2.writeFileSync(file2, str2, options);
  }
  jsonfile$1 = {
    readFile,
    readFileSync,
    writeFile,
    writeFileSync
  };
  return jsonfile$1;
}
var jsonfile;
var hasRequiredJsonfile;
function requireJsonfile() {
  if (hasRequiredJsonfile) return jsonfile;
  hasRequiredJsonfile = 1;
  const jsonFile = requireJsonfile$1();
  jsonfile = {
    // jsonfile exports
    readJson: jsonFile.readFile,
    readJsonSync: jsonFile.readFileSync,
    writeJson: jsonFile.writeFile,
    writeJsonSync: jsonFile.writeFileSync
  };
  return jsonfile;
}
var outputFile_1;
var hasRequiredOutputFile;
function requireOutputFile() {
  if (hasRequiredOutputFile) return outputFile_1;
  hasRequiredOutputFile = 1;
  const u = requireUniversalify().fromCallback;
  const fs2 = requireGracefulFs();
  const path = require$$1$1;
  const mkdir = /* @__PURE__ */ requireMkdirs();
  const pathExists = requirePathExists().pathExists;
  function outputFile(file2, data, encoding, callback) {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = "utf8";
    }
    const dir = path.dirname(file2);
    pathExists(dir, (err, itDoes) => {
      if (err) return callback(err);
      if (itDoes) return fs2.writeFile(file2, data, encoding, callback);
      mkdir.mkdirs(dir, (err2) => {
        if (err2) return callback(err2);
        fs2.writeFile(file2, data, encoding, callback);
      });
    });
  }
  function outputFileSync(file2, ...args) {
    const dir = path.dirname(file2);
    if (fs2.existsSync(dir)) {
      return fs2.writeFileSync(file2, ...args);
    }
    mkdir.mkdirsSync(dir);
    fs2.writeFileSync(file2, ...args);
  }
  outputFile_1 = {
    outputFile: u(outputFile),
    outputFileSync
  };
  return outputFile_1;
}
var outputJson_1;
var hasRequiredOutputJson;
function requireOutputJson() {
  if (hasRequiredOutputJson) return outputJson_1;
  hasRequiredOutputJson = 1;
  const { stringify } = requireUtils();
  const { outputFile } = /* @__PURE__ */ requireOutputFile();
  async function outputJson(file2, data, options = {}) {
    const str2 = stringify(data, options);
    await outputFile(file2, str2, options);
  }
  outputJson_1 = outputJson;
  return outputJson_1;
}
var outputJsonSync_1;
var hasRequiredOutputJsonSync;
function requireOutputJsonSync() {
  if (hasRequiredOutputJsonSync) return outputJsonSync_1;
  hasRequiredOutputJsonSync = 1;
  const { stringify } = requireUtils();
  const { outputFileSync } = /* @__PURE__ */ requireOutputFile();
  function outputJsonSync(file2, data, options) {
    const str2 = stringify(data, options);
    outputFileSync(file2, str2, options);
  }
  outputJsonSync_1 = outputJsonSync;
  return outputJsonSync_1;
}
var json$1;
var hasRequiredJson$1;
function requireJson$1() {
  if (hasRequiredJson$1) return json$1;
  hasRequiredJson$1 = 1;
  const u = requireUniversalify().fromPromise;
  const jsonFile = /* @__PURE__ */ requireJsonfile();
  jsonFile.outputJson = u(/* @__PURE__ */ requireOutputJson());
  jsonFile.outputJsonSync = /* @__PURE__ */ requireOutputJsonSync();
  jsonFile.outputJSON = jsonFile.outputJson;
  jsonFile.outputJSONSync = jsonFile.outputJsonSync;
  jsonFile.writeJSON = jsonFile.writeJson;
  jsonFile.writeJSONSync = jsonFile.writeJsonSync;
  jsonFile.readJSON = jsonFile.readJson;
  jsonFile.readJSONSync = jsonFile.readJsonSync;
  json$1 = jsonFile;
  return json$1;
}
var move_1;
var hasRequiredMove$1;
function requireMove$1() {
  if (hasRequiredMove$1) return move_1;
  hasRequiredMove$1 = 1;
  const fs2 = requireGracefulFs();
  const path = require$$1$1;
  const copy2 = requireCopy().copy;
  const remove = requireRemove().remove;
  const mkdirp = requireMkdirs().mkdirp;
  const pathExists = requirePathExists().pathExists;
  const stat2 = /* @__PURE__ */ requireStat();
  function move2(src2, dest, opts, cb) {
    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    }
    opts = opts || {};
    const overwrite = opts.overwrite || opts.clobber || false;
    stat2.checkPaths(src2, dest, "move", opts, (err, stats) => {
      if (err) return cb(err);
      const { srcStat, isChangingCase = false } = stats;
      stat2.checkParentPaths(src2, srcStat, dest, "move", (err2) => {
        if (err2) return cb(err2);
        if (isParentRoot(dest)) return doRename(src2, dest, overwrite, isChangingCase, cb);
        mkdirp(path.dirname(dest), (err3) => {
          if (err3) return cb(err3);
          return doRename(src2, dest, overwrite, isChangingCase, cb);
        });
      });
    });
  }
  function isParentRoot(dest) {
    const parent = path.dirname(dest);
    const parsedPath = path.parse(parent);
    return parsedPath.root === parent;
  }
  function doRename(src2, dest, overwrite, isChangingCase, cb) {
    if (isChangingCase) return rename(src2, dest, overwrite, cb);
    if (overwrite) {
      return remove(dest, (err) => {
        if (err) return cb(err);
        return rename(src2, dest, overwrite, cb);
      });
    }
    pathExists(dest, (err, destExists) => {
      if (err) return cb(err);
      if (destExists) return cb(new Error("dest already exists."));
      return rename(src2, dest, overwrite, cb);
    });
  }
  function rename(src2, dest, overwrite, cb) {
    fs2.rename(src2, dest, (err) => {
      if (!err) return cb();
      if (err.code !== "EXDEV") return cb(err);
      return moveAcrossDevice(src2, dest, overwrite, cb);
    });
  }
  function moveAcrossDevice(src2, dest, overwrite, cb) {
    const opts = {
      overwrite,
      errorOnExist: true
    };
    copy2(src2, dest, opts, (err) => {
      if (err) return cb(err);
      return remove(src2, cb);
    });
  }
  move_1 = move2;
  return move_1;
}
var moveSync_1;
var hasRequiredMoveSync;
function requireMoveSync() {
  if (hasRequiredMoveSync) return moveSync_1;
  hasRequiredMoveSync = 1;
  const fs2 = requireGracefulFs();
  const path = require$$1$1;
  const copySync = requireCopy().copySync;
  const removeSync = requireRemove().removeSync;
  const mkdirpSync = requireMkdirs().mkdirpSync;
  const stat2 = /* @__PURE__ */ requireStat();
  function moveSync(src2, dest, opts) {
    opts = opts || {};
    const overwrite = opts.overwrite || opts.clobber || false;
    const { srcStat, isChangingCase = false } = stat2.checkPathsSync(src2, dest, "move", opts);
    stat2.checkParentPathsSync(src2, srcStat, dest, "move");
    if (!isParentRoot(dest)) mkdirpSync(path.dirname(dest));
    return doRename(src2, dest, overwrite, isChangingCase);
  }
  function isParentRoot(dest) {
    const parent = path.dirname(dest);
    const parsedPath = path.parse(parent);
    return parsedPath.root === parent;
  }
  function doRename(src2, dest, overwrite, isChangingCase) {
    if (isChangingCase) return rename(src2, dest, overwrite);
    if (overwrite) {
      removeSync(dest);
      return rename(src2, dest, overwrite);
    }
    if (fs2.existsSync(dest)) throw new Error("dest already exists.");
    return rename(src2, dest, overwrite);
  }
  function rename(src2, dest, overwrite) {
    try {
      fs2.renameSync(src2, dest);
    } catch (err) {
      if (err.code !== "EXDEV") throw err;
      return moveAcrossDevice(src2, dest, overwrite);
    }
  }
  function moveAcrossDevice(src2, dest, overwrite) {
    const opts = {
      overwrite,
      errorOnExist: true
    };
    copySync(src2, dest, opts);
    return removeSync(src2);
  }
  moveSync_1 = moveSync;
  return moveSync_1;
}
var move;
var hasRequiredMove;
function requireMove() {
  if (hasRequiredMove) return move;
  hasRequiredMove = 1;
  const u = requireUniversalify().fromCallback;
  move = {
    move: u(/* @__PURE__ */ requireMove$1()),
    moveSync: /* @__PURE__ */ requireMoveSync()
  };
  return move;
}
var lib;
var hasRequiredLib;
function requireLib() {
  if (hasRequiredLib) return lib;
  hasRequiredLib = 1;
  lib = {
    // Export promiseified graceful-fs:
    .../* @__PURE__ */ requireFs(),
    // Export extra methods:
    .../* @__PURE__ */ requireCopy(),
    .../* @__PURE__ */ requireEmpty(),
    .../* @__PURE__ */ requireEnsure(),
    .../* @__PURE__ */ requireJson$1(),
    .../* @__PURE__ */ requireMkdirs(),
    .../* @__PURE__ */ requireMove(),
    .../* @__PURE__ */ requireOutputFile(),
    .../* @__PURE__ */ requirePathExists(),
    .../* @__PURE__ */ requireRemove()
  };
  return lib;
}
var BaseUpdater = {};
var AppUpdater = {};
var out = {};
var CancellationToken = {};
var hasRequiredCancellationToken;
function requireCancellationToken() {
  if (hasRequiredCancellationToken) return CancellationToken;
  hasRequiredCancellationToken = 1;
  Object.defineProperty(CancellationToken, "__esModule", { value: true });
  CancellationToken.CancellationError = CancellationToken.CancellationToken = void 0;
  const events_1 = require$$0$2;
  let CancellationToken$1 = class CancellationToken extends events_1.EventEmitter {
    get cancelled() {
      return this._cancelled || this._parent != null && this._parent.cancelled;
    }
    set parent(value) {
      this.removeParentCancelHandler();
      this._parent = value;
      this.parentCancelHandler = () => this.cancel();
      this._parent.onCancel(this.parentCancelHandler);
    }
    // babel cannot compile ... correctly for super calls
    constructor(parent) {
      super();
      this.parentCancelHandler = null;
      this._parent = null;
      this._cancelled = false;
      if (parent != null) {
        this.parent = parent;
      }
    }
    cancel() {
      this._cancelled = true;
      this.emit("cancel");
    }
    onCancel(handler) {
      if (this.cancelled) {
        handler();
      } else {
        this.once("cancel", handler);
      }
    }
    createPromise(callback) {
      if (this.cancelled) {
        return Promise.reject(new CancellationError());
      }
      const finallyHandler = () => {
        if (cancelHandler != null) {
          try {
            this.removeListener("cancel", cancelHandler);
            cancelHandler = null;
          } catch (_ignore) {
          }
        }
      };
      let cancelHandler = null;
      return new Promise((resolve, reject) => {
        let addedCancelHandler = null;
        cancelHandler = () => {
          try {
            if (addedCancelHandler != null) {
              addedCancelHandler();
              addedCancelHandler = null;
            }
          } finally {
            reject(new CancellationError());
          }
        };
        if (this.cancelled) {
          cancelHandler();
          return;
        }
        this.onCancel(cancelHandler);
        callback(resolve, reject, (callback2) => {
          addedCancelHandler = callback2;
        });
      }).then((it) => {
        finallyHandler();
        return it;
      }).catch((e) => {
        finallyHandler();
        throw e;
      });
    }
    removeParentCancelHandler() {
      const parent = this._parent;
      if (parent != null && this.parentCancelHandler != null) {
        parent.removeListener("cancel", this.parentCancelHandler);
        this.parentCancelHandler = null;
      }
    }
    dispose() {
      try {
        this.removeParentCancelHandler();
      } finally {
        this.removeAllListeners();
        this._parent = null;
      }
    }
  };
  CancellationToken.CancellationToken = CancellationToken$1;
  class CancellationError extends Error {
    constructor() {
      super("cancelled");
    }
  }
  CancellationToken.CancellationError = CancellationError;
  return CancellationToken;
}
var error = {};
var hasRequiredError;
function requireError() {
  if (hasRequiredError) return error;
  hasRequiredError = 1;
  Object.defineProperty(error, "__esModule", { value: true });
  error.newError = newError;
  function newError(message, code) {
    const error2 = new Error(message);
    error2.code = code;
    return error2;
  }
  return error;
}
var httpExecutor = {};
var src = { exports: {} };
var browser = { exports: {} };
var ms;
var hasRequiredMs;
function requireMs() {
  if (hasRequiredMs) return ms;
  hasRequiredMs = 1;
  var s = 1e3;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var w = d * 7;
  var y = d * 365.25;
  ms = function(val, options) {
    options = options || {};
    var type2 = typeof val;
    if (type2 === "string" && val.length > 0) {
      return parse(val);
    } else if (type2 === "number" && isFinite(val)) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error(
      "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
    );
  };
  function parse(str2) {
    str2 = String(str2);
    if (str2.length > 100) {
      return;
    }
    var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
      str2
    );
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type2 = (match[2] || "ms").toLowerCase();
    switch (type2) {
      case "years":
      case "year":
      case "yrs":
      case "yr":
      case "y":
        return n * y;
      case "weeks":
      case "week":
      case "w":
        return n * w;
      case "days":
      case "day":
      case "d":
        return n * d;
      case "hours":
      case "hour":
      case "hrs":
      case "hr":
      case "h":
        return n * h;
      case "minutes":
      case "minute":
      case "mins":
      case "min":
      case "m":
        return n * m;
      case "seconds":
      case "second":
      case "secs":
      case "sec":
      case "s":
        return n * s;
      case "milliseconds":
      case "millisecond":
      case "msecs":
      case "msec":
      case "ms":
        return n;
      default:
        return void 0;
    }
  }
  function fmtShort(ms2) {
    var msAbs = Math.abs(ms2);
    if (msAbs >= d) {
      return Math.round(ms2 / d) + "d";
    }
    if (msAbs >= h) {
      return Math.round(ms2 / h) + "h";
    }
    if (msAbs >= m) {
      return Math.round(ms2 / m) + "m";
    }
    if (msAbs >= s) {
      return Math.round(ms2 / s) + "s";
    }
    return ms2 + "ms";
  }
  function fmtLong(ms2) {
    var msAbs = Math.abs(ms2);
    if (msAbs >= d) {
      return plural(ms2, msAbs, d, "day");
    }
    if (msAbs >= h) {
      return plural(ms2, msAbs, h, "hour");
    }
    if (msAbs >= m) {
      return plural(ms2, msAbs, m, "minute");
    }
    if (msAbs >= s) {
      return plural(ms2, msAbs, s, "second");
    }
    return ms2 + " ms";
  }
  function plural(ms2, msAbs, n, name) {
    var isPlural = msAbs >= n * 1.5;
    return Math.round(ms2 / n) + " " + name + (isPlural ? "s" : "");
  }
  return ms;
}
var common$1;
var hasRequiredCommon$1;
function requireCommon$1() {
  if (hasRequiredCommon$1) return common$1;
  hasRequiredCommon$1 = 1;
  function setup(env) {
    createDebug.debug = createDebug;
    createDebug.default = createDebug;
    createDebug.coerce = coerce;
    createDebug.disable = disable;
    createDebug.enable = enable;
    createDebug.enabled = enabled;
    createDebug.humanize = requireMs();
    createDebug.destroy = destroy;
    Object.keys(env).forEach((key) => {
      createDebug[key] = env[key];
    });
    createDebug.names = [];
    createDebug.skips = [];
    createDebug.formatters = {};
    function selectColor(namespace) {
      let hash = 0;
      for (let i = 0; i < namespace.length; i++) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0;
      }
      return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    }
    createDebug.selectColor = selectColor;
    function createDebug(namespace) {
      let prevTime;
      let enableOverride = null;
      let namespacesCache;
      let enabledCache;
      function debug(...args) {
        if (!debug.enabled) {
          return;
        }
        const self2 = debug;
        const curr = Number(/* @__PURE__ */ new Date());
        const ms2 = curr - (prevTime || curr);
        self2.diff = ms2;
        self2.prev = prevTime;
        self2.curr = curr;
        prevTime = curr;
        args[0] = createDebug.coerce(args[0]);
        if (typeof args[0] !== "string") {
          args.unshift("%O");
        }
        let index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
          if (match === "%%") {
            return "%";
          }
          index++;
          const formatter = createDebug.formatters[format];
          if (typeof formatter === "function") {
            const val = args[index];
            match = formatter.call(self2, val);
            args.splice(index, 1);
            index--;
          }
          return match;
        });
        createDebug.formatArgs.call(self2, args);
        const logFn = self2.log || createDebug.log;
        logFn.apply(self2, args);
      }
      debug.namespace = namespace;
      debug.useColors = createDebug.useColors();
      debug.color = createDebug.selectColor(namespace);
      debug.extend = extend;
      debug.destroy = createDebug.destroy;
      Object.defineProperty(debug, "enabled", {
        enumerable: true,
        configurable: false,
        get: () => {
          if (enableOverride !== null) {
            return enableOverride;
          }
          if (namespacesCache !== createDebug.namespaces) {
            namespacesCache = createDebug.namespaces;
            enabledCache = createDebug.enabled(namespace);
          }
          return enabledCache;
        },
        set: (v) => {
          enableOverride = v;
        }
      });
      if (typeof createDebug.init === "function") {
        createDebug.init(debug);
      }
      return debug;
    }
    function extend(namespace, delimiter) {
      const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
      newDebug.log = this.log;
      return newDebug;
    }
    function enable(namespaces) {
      createDebug.save(namespaces);
      createDebug.namespaces = namespaces;
      createDebug.names = [];
      createDebug.skips = [];
      const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
      for (const ns of split) {
        if (ns[0] === "-") {
          createDebug.skips.push(ns.slice(1));
        } else {
          createDebug.names.push(ns);
        }
      }
    }
    function matchesTemplate(search, template) {
      let searchIndex = 0;
      let templateIndex = 0;
      let starIndex = -1;
      let matchIndex = 0;
      while (searchIndex < search.length) {
        if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
          if (template[templateIndex] === "*") {
            starIndex = templateIndex;
            matchIndex = searchIndex;
            templateIndex++;
          } else {
            searchIndex++;
            templateIndex++;
          }
        } else if (starIndex !== -1) {
          templateIndex = starIndex + 1;
          matchIndex++;
          searchIndex = matchIndex;
        } else {
          return false;
        }
      }
      while (templateIndex < template.length && template[templateIndex] === "*") {
        templateIndex++;
      }
      return templateIndex === template.length;
    }
    function disable() {
      const namespaces = [
        ...createDebug.names,
        ...createDebug.skips.map((namespace) => "-" + namespace)
      ].join(",");
      createDebug.enable("");
      return namespaces;
    }
    function enabled(name) {
      for (const skip of createDebug.skips) {
        if (matchesTemplate(name, skip)) {
          return false;
        }
      }
      for (const ns of createDebug.names) {
        if (matchesTemplate(name, ns)) {
          return true;
        }
      }
      return false;
    }
    function coerce(val) {
      if (val instanceof Error) {
        return val.stack || val.message;
      }
      return val;
    }
    function destroy() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }
    createDebug.enable(createDebug.load());
    return createDebug;
  }
  common$1 = setup;
  return common$1;
}
var hasRequiredBrowser;
function requireBrowser() {
  if (hasRequiredBrowser) return browser.exports;
  hasRequiredBrowser = 1;
  (function(module, exports) {
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();
    exports.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    exports.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports.storage.setItem("debug", namespaces);
        } else {
          exports.storage.removeItem("debug");
        }
      } catch (error2) {
      }
    }
    function load() {
      let r;
      try {
        r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
      } catch (error2) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    function localstorage() {
      try {
        return localStorage;
      } catch (error2) {
      }
    }
    module.exports = requireCommon$1()(exports);
    const { formatters } = module.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error2) {
        return "[UnexpectedJSONParseError]: " + error2.message;
      }
    };
  })(browser, browser.exports);
  return browser.exports;
}
var node = { exports: {} };
var hasFlag;
var hasRequiredHasFlag;
function requireHasFlag() {
  if (hasRequiredHasFlag) return hasFlag;
  hasRequiredHasFlag = 1;
  hasFlag = (flag, argv = process.argv) => {
    const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
    const position = argv.indexOf(prefix + flag);
    const terminatorPosition = argv.indexOf("--");
    return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
  };
  return hasFlag;
}
var supportsColor_1;
var hasRequiredSupportsColor;
function requireSupportsColor() {
  if (hasRequiredSupportsColor) return supportsColor_1;
  hasRequiredSupportsColor = 1;
  const os$1 = os;
  const tty = require$$1$4;
  const hasFlag2 = requireHasFlag();
  const { env } = process;
  let forceColor;
  if (hasFlag2("no-color") || hasFlag2("no-colors") || hasFlag2("color=false") || hasFlag2("color=never")) {
    forceColor = 0;
  } else if (hasFlag2("color") || hasFlag2("colors") || hasFlag2("color=true") || hasFlag2("color=always")) {
    forceColor = 1;
  }
  if ("FORCE_COLOR" in env) {
    if (env.FORCE_COLOR === "true") {
      forceColor = 1;
    } else if (env.FORCE_COLOR === "false") {
      forceColor = 0;
    } else {
      forceColor = env.FORCE_COLOR.length === 0 ? 1 : Math.min(parseInt(env.FORCE_COLOR, 10), 3);
    }
  }
  function translateLevel(level) {
    if (level === 0) {
      return false;
    }
    return {
      level,
      hasBasic: true,
      has256: level >= 2,
      has16m: level >= 3
    };
  }
  function supportsColor(haveStream, streamIsTTY) {
    if (forceColor === 0) {
      return 0;
    }
    if (hasFlag2("color=16m") || hasFlag2("color=full") || hasFlag2("color=truecolor")) {
      return 3;
    }
    if (hasFlag2("color=256")) {
      return 2;
    }
    if (haveStream && !streamIsTTY && forceColor === void 0) {
      return 0;
    }
    const min = forceColor || 0;
    if (env.TERM === "dumb") {
      return min;
    }
    if (process.platform === "win32") {
      const osRelease = os$1.release().split(".");
      if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
        return Number(osRelease[2]) >= 14931 ? 3 : 2;
      }
      return 1;
    }
    if ("CI" in env) {
      if (["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI", "GITHUB_ACTIONS", "BUILDKITE"].some((sign) => sign in env) || env.CI_NAME === "codeship") {
        return 1;
      }
      return min;
    }
    if ("TEAMCITY_VERSION" in env) {
      return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
    }
    if (env.COLORTERM === "truecolor") {
      return 3;
    }
    if ("TERM_PROGRAM" in env) {
      const version = parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
      switch (env.TERM_PROGRAM) {
        case "iTerm.app":
          return version >= 3 ? 3 : 2;
        case "Apple_Terminal":
          return 2;
      }
    }
    if (/-256(color)?$/i.test(env.TERM)) {
      return 2;
    }
    if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
      return 1;
    }
    if ("COLORTERM" in env) {
      return 1;
    }
    return min;
  }
  function getSupportLevel(stream) {
    const level = supportsColor(stream, stream && stream.isTTY);
    return translateLevel(level);
  }
  supportsColor_1 = {
    supportsColor: getSupportLevel,
    stdout: translateLevel(supportsColor(true, tty.isatty(1))),
    stderr: translateLevel(supportsColor(true, tty.isatty(2)))
  };
  return supportsColor_1;
}
var hasRequiredNode;
function requireNode() {
  if (hasRequiredNode) return node.exports;
  hasRequiredNode = 1;
  (function(module, exports) {
    const tty = require$$1$4;
    const util2 = require$$4$1;
    exports.init = init;
    exports.log = log;
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.destroy = util2.deprecate(
      () => {
      },
      "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."
    );
    exports.colors = [6, 2, 3, 4, 5, 1];
    try {
      const supportsColor = requireSupportsColor();
      if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
        exports.colors = [
          20,
          21,
          26,
          27,
          32,
          33,
          38,
          39,
          40,
          41,
          42,
          43,
          44,
          45,
          56,
          57,
          62,
          63,
          68,
          69,
          74,
          75,
          76,
          77,
          78,
          79,
          80,
          81,
          92,
          93,
          98,
          99,
          112,
          113,
          128,
          129,
          134,
          135,
          148,
          149,
          160,
          161,
          162,
          163,
          164,
          165,
          166,
          167,
          168,
          169,
          170,
          171,
          172,
          173,
          178,
          179,
          184,
          185,
          196,
          197,
          198,
          199,
          200,
          201,
          202,
          203,
          204,
          205,
          206,
          207,
          208,
          209,
          214,
          215,
          220,
          221
        ];
      }
    } catch (error2) {
    }
    exports.inspectOpts = Object.keys(process.env).filter((key) => {
      return /^debug_/i.test(key);
    }).reduce((obj, key) => {
      const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
        return k.toUpperCase();
      });
      let val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) {
        val = true;
      } else if (/^(no|off|false|disabled)$/i.test(val)) {
        val = false;
      } else if (val === "null") {
        val = null;
      } else {
        val = Number(val);
      }
      obj[prop] = val;
      return obj;
    }, {});
    function useColors() {
      return "colors" in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(process.stderr.fd);
    }
    function formatArgs(args) {
      const { namespace: name, useColors: useColors2 } = this;
      if (useColors2) {
        const c = this.color;
        const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
        const prefix = `  ${colorCode};1m${name} \x1B[0m`;
        args[0] = prefix + args[0].split("\n").join("\n" + prefix);
        args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
      } else {
        args[0] = getDate() + name + " " + args[0];
      }
    }
    function getDate() {
      if (exports.inspectOpts.hideDate) {
        return "";
      }
      return (/* @__PURE__ */ new Date()).toISOString() + " ";
    }
    function log(...args) {
      return process.stderr.write(util2.formatWithOptions(exports.inspectOpts, ...args) + "\n");
    }
    function save(namespaces) {
      if (namespaces) {
        process.env.DEBUG = namespaces;
      } else {
        delete process.env.DEBUG;
      }
    }
    function load() {
      return process.env.DEBUG;
    }
    function init(debug) {
      debug.inspectOpts = {};
      const keys = Object.keys(exports.inspectOpts);
      for (let i = 0; i < keys.length; i++) {
        debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
      }
    }
    module.exports = requireCommon$1()(exports);
    const { formatters } = module.exports;
    formatters.o = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util2.inspect(v, this.inspectOpts).split("\n").map((str2) => str2.trim()).join(" ");
    };
    formatters.O = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util2.inspect(v, this.inspectOpts);
    };
  })(node, node.exports);
  return node.exports;
}
var hasRequiredSrc;
function requireSrc() {
  if (hasRequiredSrc) return src.exports;
  hasRequiredSrc = 1;
  if (typeof process === "undefined" || process.type === "renderer" || process.browser === true || process.__nwjs) {
    src.exports = requireBrowser();
  } else {
    src.exports = requireNode();
  }
  return src.exports;
}
var ProgressCallbackTransform = {};
var hasRequiredProgressCallbackTransform;
function requireProgressCallbackTransform() {
  if (hasRequiredProgressCallbackTransform) return ProgressCallbackTransform;
  hasRequiredProgressCallbackTransform = 1;
  Object.defineProperty(ProgressCallbackTransform, "__esModule", { value: true });
  ProgressCallbackTransform.ProgressCallbackTransform = void 0;
  const stream_1 = require$$0$1;
  let ProgressCallbackTransform$1 = class ProgressCallbackTransform extends stream_1.Transform {
    constructor(total, cancellationToken, onProgress) {
      super();
      this.total = total;
      this.cancellationToken = cancellationToken;
      this.onProgress = onProgress;
      this.start = Date.now();
      this.transferred = 0;
      this.delta = 0;
      this.nextUpdate = this.start + 1e3;
    }
    _transform(chunk, encoding, callback) {
      if (this.cancellationToken.cancelled) {
        callback(new Error("cancelled"), null);
        return;
      }
      this.transferred += chunk.length;
      this.delta += chunk.length;
      const now = Date.now();
      if (now >= this.nextUpdate && this.transferred !== this.total) {
        this.nextUpdate = now + 1e3;
        this.onProgress({
          total: this.total,
          delta: this.delta,
          transferred: this.transferred,
          percent: this.transferred / this.total * 100,
          bytesPerSecond: Math.round(this.transferred / ((now - this.start) / 1e3))
        });
        this.delta = 0;
      }
      callback(null, chunk);
    }
    _flush(callback) {
      if (this.cancellationToken.cancelled) {
        callback(new Error("cancelled"));
        return;
      }
      this.onProgress({
        total: this.total,
        delta: this.delta,
        transferred: this.total,
        percent: 100,
        bytesPerSecond: Math.round(this.transferred / ((Date.now() - this.start) / 1e3))
      });
      this.delta = 0;
      callback(null);
    }
  };
  ProgressCallbackTransform.ProgressCallbackTransform = ProgressCallbackTransform$1;
  return ProgressCallbackTransform;
}
var hasRequiredHttpExecutor;
function requireHttpExecutor() {
  if (hasRequiredHttpExecutor) return httpExecutor;
  hasRequiredHttpExecutor = 1;
  Object.defineProperty(httpExecutor, "__esModule", { value: true });
  httpExecutor.DigestTransform = httpExecutor.HttpExecutor = httpExecutor.HttpError = void 0;
  httpExecutor.addSensitiveRedirectHeader = addSensitiveRedirectHeader;
  httpExecutor.addSensitiveFieldPattern = addSensitiveFieldPattern;
  httpExecutor.createHttpError = createHttpError;
  httpExecutor.parseJson = parseJson;
  httpExecutor.configureRequestOptionsFromUrl = configureRequestOptionsFromUrl;
  httpExecutor.configureRequestUrl = configureRequestUrl;
  httpExecutor.safeGetHeader = safeGetHeader;
  httpExecutor.configureRequestOptions = configureRequestOptions;
  httpExecutor.isSensitiveFieldName = isSensitiveFieldName;
  httpExecutor.hashSensitiveValue = hashSensitiveValue;
  httpExecutor.safeStringifyJson = safeStringifyJson;
  const crypto_1 = crypto;
  const debug_12 = requireSrc();
  const fs_1 = require$$1$2;
  const stream_1 = require$$0$1;
  const url_1 = require$$2;
  const CancellationToken_1 = requireCancellationToken();
  const error_1 = requireError();
  const ProgressCallbackTransform_1 = requireProgressCallbackTransform();
  const debug = (0, debug_12.default)("electron-builder");
  const normalizeName = (name) => name.toLowerCase().replace(/[-_]/g, "");
  const SENSITIVE_REDIRECT_HEADERS = /* @__PURE__ */ new Set(["authorization", "proxyauthorization", "privatetoken", "xapikey", "xauthtoken", "xaccesstoken", "xgitlabtoken", "cookie", "xcsrftoken"]);
  const SENSITIVE_FIELD_PATTERNS = ["token", "password", "secret", "authorization", "credential", "apikey", "passphrase", "auth"];
  const SENSITIVE_FIELD_SUFFIXES = ["key"];
  function addSensitiveRedirectHeader(header) {
    SENSITIVE_REDIRECT_HEADERS.add(normalizeName(header));
  }
  function addSensitiveFieldPattern(pattern) {
    SENSITIVE_FIELD_PATTERNS.push(pattern.toLowerCase().replace(/[-_]/g, ""));
  }
  function createHttpError(response, description = null) {
    return new HttpError(response.statusCode || -1, `${response.statusCode} ${response.statusMessage}` + (description == null ? "" : "\n" + JSON.stringify(description, null, "  ")) + "\nHeaders: " + safeStringifyJson(response.headers), description);
  }
  const HTTP_STATUS_CODES = /* @__PURE__ */ new Map([
    [429, "Too many requests"],
    [400, "Bad request"],
    [403, "Forbidden"],
    [404, "Not found"],
    [405, "Method not allowed"],
    [406, "Not acceptable"],
    [408, "Request timeout"],
    [413, "Request entity too large"],
    [500, "Internal server error"],
    [502, "Bad gateway"],
    [503, "Service unavailable"],
    [504, "Gateway timeout"],
    [505, "HTTP version not supported"]
  ]);
  class HttpError extends Error {
    constructor(statusCode, message = `HTTP error: ${HTTP_STATUS_CODES.get(statusCode) || statusCode}`, description = null) {
      super(message);
      this.statusCode = statusCode;
      this.description = description;
      this.name = "HttpError";
      this.code = `HTTP_ERROR_${statusCode}`;
    }
    isServerError() {
      return this.statusCode >= 500 && this.statusCode <= 599;
    }
  }
  httpExecutor.HttpError = HttpError;
  function parseJson(result) {
    return result.then((it) => it == null || it.length === 0 ? null : JSON.parse(it));
  }
  class HttpExecutor {
    constructor() {
      this.maxRedirects = 10;
    }
    request(options, cancellationToken = new CancellationToken_1.CancellationToken(), data) {
      configureRequestOptions(options);
      const json2 = data == null ? void 0 : JSON.stringify(data);
      const encodedData = json2 ? Buffer.from(json2) : void 0;
      if (encodedData != null) {
        if (debug.enabled) {
          debug(safeStringifyJson(data));
        }
        const { headers, ...opts } = options;
        options = {
          method: "post",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": encodedData.length,
            ...headers
          },
          ...opts
        };
      }
      return this.doApiRequest(options, cancellationToken, (it) => it.end(encodedData));
    }
    doApiRequest(options, cancellationToken, requestProcessor, redirectCount = 0) {
      if (debug.enabled) {
        const { headers: _headers, auth: _auth, ...safeOptions } = options;
        debug(`Request: ${safeStringifyJson(safeOptions)}`);
      }
      return cancellationToken.createPromise((resolve, reject, onCancel) => {
        const request = this.createRequest(options, (response) => {
          try {
            this.handleResponse(response, options, cancellationToken, resolve, reject, redirectCount, requestProcessor);
          } catch (e) {
            reject(e);
          }
        });
        this.addErrorAndTimeoutHandlers(request, reject, options.timeout);
        this.addRedirectHandlers(request, options, reject, redirectCount, (options2) => {
          this.doApiRequest(options2, cancellationToken, requestProcessor, redirectCount).then(resolve).catch(reject);
        });
        requestProcessor(request, reject);
        onCancel(() => request.abort());
      });
    }
    // noinspection JSUnusedLocalSymbols
    // eslint-disable-next-line
    addRedirectHandlers(request, options, reject, redirectCount, handler) {
    }
    addErrorAndTimeoutHandlers(request, reject, timeout = 60 * 1e3) {
      this.addTimeOutHandler(request, reject, timeout);
      request.on("error", reject);
      request.on("aborted", () => {
        reject(new Error("Request has been aborted by the server"));
      });
    }
    handleResponse(response, options, cancellationToken, resolve, reject, redirectCount, requestProcessor) {
      var _a;
      if (debug.enabled) {
        const { headers: _headers, auth: _auth, ...safeOptions } = options;
        debug(`Response: ${response.statusCode} ${response.statusMessage}, request options: ${safeStringifyJson(safeOptions)}`);
      }
      if (response.statusCode === 404) {
        reject(createHttpError(response, `method: ${options.method || "GET"} url: ${options.protocol || "https:"}//${options.hostname}${options.port ? `:${options.port}` : ""}${options.path}

Please double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.
`));
        return;
      } else if (response.statusCode === 204) {
        resolve();
        return;
      }
      const code = (_a = response.statusCode) !== null && _a !== void 0 ? _a : 0;
      const shouldRedirect = code >= 300 && code < 400;
      const redirectUrl = safeGetHeader(response, "location");
      if (shouldRedirect && redirectUrl != null) {
        if (redirectCount > this.maxRedirects) {
          reject(this.createMaxRedirectError());
          return;
        }
        this.doApiRequest(HttpExecutor.prepareRedirectUrlOptions(redirectUrl, options), cancellationToken, requestProcessor, redirectCount).then(resolve).catch(reject);
        return;
      }
      response.setEncoding("utf8");
      let data = "";
      response.on("error", reject);
      response.on("data", (chunk) => data += chunk);
      response.on("end", () => {
        try {
          if (response.statusCode != null && response.statusCode >= 400) {
            const contentType = safeGetHeader(response, "content-type");
            const isJson = contentType != null && (Array.isArray(contentType) ? contentType.find((it) => it.includes("json")) != null : contentType.includes("json"));
            reject(createHttpError(response, `method: ${options.method || "GET"} url: ${options.protocol || "https:"}//${options.hostname}${options.port ? `:${options.port}` : ""}${options.path}

          Data:
          ${isJson ? safeStringifyJson(JSON.parse(data)) : data}
          `));
          } else {
            resolve(data.length === 0 ? null : data);
          }
        } catch (e) {
          reject(e);
        }
      });
    }
    async downloadToBuffer(url, options) {
      return await options.cancellationToken.createPromise((resolve, reject, onCancel) => {
        const responseChunks = [];
        const requestOptions = {
          headers: options.headers || void 0,
          // because PrivateGitHubProvider requires HttpExecutor.prepareRedirectUrlOptions logic, so, we need to redirect manually
          redirect: "manual"
        };
        configureRequestUrl(url, requestOptions);
        configureRequestOptions(requestOptions);
        this.doDownload(requestOptions, {
          destination: null,
          options,
          onCancel,
          callback: (error2) => {
            if (error2 == null) {
              resolve(Buffer.concat(responseChunks));
            } else {
              reject(error2);
            }
          },
          responseHandler: (response, callback) => {
            let receivedLength = 0;
            response.on("data", (chunk) => {
              receivedLength += chunk.length;
              if (receivedLength > 524288e3) {
                callback(new Error("Maximum allowed size is 500 MB"));
                return;
              }
              responseChunks.push(chunk);
            });
            response.on("end", () => {
              callback(null);
            });
          }
        }, 0);
      });
    }
    doDownload(requestOptions, options, redirectCount) {
      const request = this.createRequest(requestOptions, (response) => {
        if (response.statusCode >= 400) {
          options.callback(new Error(`Cannot download "${requestOptions.protocol || "https:"}//${requestOptions.hostname}${requestOptions.path}", status ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        response.on("error", options.callback);
        const redirectUrl = safeGetHeader(response, "location");
        if (redirectUrl != null) {
          if (redirectCount < this.maxRedirects) {
            this.doDownload(HttpExecutor.prepareRedirectUrlOptions(redirectUrl, requestOptions), options, redirectCount++);
          } else {
            options.callback(this.createMaxRedirectError());
          }
          return;
        }
        if (options.responseHandler == null) {
          configurePipes(options, response);
        } else {
          options.responseHandler(response, options.callback);
        }
      });
      this.addErrorAndTimeoutHandlers(request, options.callback, requestOptions.timeout);
      this.addRedirectHandlers(request, requestOptions, options.callback, redirectCount, (requestOptions2) => {
        this.doDownload(requestOptions2, options, redirectCount++);
      });
      request.end();
    }
    createMaxRedirectError() {
      return new Error(`Too many redirects (> ${this.maxRedirects})`);
    }
    addTimeOutHandler(request, callback, timeout) {
      request.on("socket", (socket) => {
        socket.setTimeout(timeout, () => {
          request.abort();
          callback(new Error("Request timed out"));
        });
      });
    }
    static prepareRedirectUrlOptions(redirectUrl, options) {
      const newOptions = configureRequestOptionsFromUrl(redirectUrl, { ...options });
      const headers = newOptions.headers;
      if (headers == null) {
        return newOptions;
      }
      const originalUrl = HttpExecutor.reconstructOriginalUrl(options);
      const parsedRedirectUrl = parseUrl(redirectUrl, options);
      if (HttpExecutor.isCrossOriginRedirect(originalUrl, parsedRedirectUrl)) {
        if (debug.enabled) {
          debug(`Cross-origin redirect (${originalUrl.host} → ${parsedRedirectUrl.host}): stripping sensitive headers`);
        }
        for (const key of Object.keys(headers)) {
          if (SENSITIVE_REDIRECT_HEADERS.has(normalizeName(key))) {
            delete headers[key];
          }
        }
      }
      return newOptions;
    }
    static reconstructOriginalUrl(options) {
      const protocol = options.protocol || "https:";
      if (!options.hostname) {
        throw new Error("Missing hostname in request options");
      }
      const hostname = options.hostname;
      const port = options.port ? `:${options.port}` : "";
      const path = options.path || "/";
      return new url_1.URL(`${protocol}//${hostname}${port}${path}`);
    }
    static isCrossOriginRedirect(originalUrl, redirectUrl) {
      if (originalUrl.hostname.toLowerCase() !== redirectUrl.hostname.toLowerCase()) {
        return true;
      }
      if (originalUrl.protocol === "http:" && // This can be replaced with `!originalUrl.port`, but for the sake of clarity.
      ["80", ""].includes(originalUrl.port) && redirectUrl.protocol === "https:" && // This can be replaced with `!redirectUrl.port`, but for the sake of clarity.
      ["443", ""].includes(redirectUrl.port)) {
        return false;
      }
      if (originalUrl.protocol !== redirectUrl.protocol) {
        return true;
      }
      const originalPort = originalUrl.port;
      const redirectPort = redirectUrl.port;
      return originalPort !== redirectPort;
    }
    static async retryOnServerError(task, maxRetries = 3) {
      for (let attemptNumber = 0; ; attemptNumber++) {
        try {
          return await task();
        } catch (e) {
          if (attemptNumber < maxRetries && (e instanceof HttpError && e.isServerError() || e.code === "EPIPE")) {
            await new Promise((r) => setTimeout(r, 1e3 * (attemptNumber + 1)));
            continue;
          }
          throw e;
        }
      }
    }
  }
  httpExecutor.HttpExecutor = HttpExecutor;
  function parseUrl(url, options) {
    try {
      return new url_1.URL(url);
    } catch {
      const hostname = options.hostname;
      const protocol = options.protocol || "https:";
      const port = options.port ? `:${options.port}` : "";
      const baseUrl = `${protocol}//${hostname}${port}`;
      return new url_1.URL(url, baseUrl);
    }
  }
  function configureRequestOptionsFromUrl(url, options) {
    const result = configureRequestOptions(options);
    const parsedUrl = parseUrl(url, options);
    configureRequestUrl(parsedUrl, result);
    return result;
  }
  function configureRequestUrl(url, options) {
    options.protocol = url.protocol;
    options.hostname = url.hostname;
    if (url.port) {
      options.port = url.port;
    } else if (options.port) {
      delete options.port;
    }
    options.path = url.pathname + url.search;
  }
  class DigestTransform extends stream_1.Transform {
    // noinspection JSUnusedGlobalSymbols
    get actual() {
      return this._actual;
    }
    constructor(expected, algorithm = "sha512", encoding = "base64") {
      super();
      this.expected = expected;
      this.algorithm = algorithm;
      this.encoding = encoding;
      this._actual = null;
      this.isValidateOnEnd = true;
      this.digester = (0, crypto_1.createHash)(algorithm);
    }
    // noinspection JSUnusedGlobalSymbols
    _transform(chunk, encoding, callback) {
      this.digester.update(chunk);
      callback(null, chunk);
    }
    // noinspection JSUnusedGlobalSymbols
    _flush(callback) {
      this._actual = this.digester.digest(this.encoding);
      if (this.isValidateOnEnd) {
        try {
          this.validate();
        } catch (e) {
          callback(e);
          return;
        }
      }
      callback(null);
    }
    validate() {
      if (this._actual == null) {
        throw (0, error_1.newError)("Not finished yet", "ERR_STREAM_NOT_FINISHED");
      }
      if (this._actual !== this.expected) {
        throw (0, error_1.newError)(`${this.algorithm} checksum mismatch, expected ${this.expected}, got ${this._actual}`, "ERR_CHECKSUM_MISMATCH");
      }
      return null;
    }
  }
  httpExecutor.DigestTransform = DigestTransform;
  function checkSha2(sha2Header, sha2, callback) {
    if (sha2Header != null && sha2 != null && sha2Header !== sha2) {
      callback(new Error(`checksum mismatch: expected ${sha2} but got ${sha2Header} (X-Checksum-Sha2 header)`));
      return false;
    }
    return true;
  }
  function safeGetHeader(response, headerKey) {
    const value = response.headers[headerKey];
    if (value == null) {
      return null;
    } else if (Array.isArray(value)) {
      return value.length === 0 ? null : value[value.length - 1];
    } else {
      return value;
    }
  }
  function configurePipes(options, response) {
    if (!checkSha2(safeGetHeader(response, "X-Checksum-Sha2"), options.options.sha2, options.callback)) {
      return;
    }
    const streams = [];
    if (options.options.onProgress != null) {
      const contentLength = safeGetHeader(response, "content-length");
      if (contentLength != null) {
        streams.push(new ProgressCallbackTransform_1.ProgressCallbackTransform(parseInt(contentLength, 10), options.options.cancellationToken, options.options.onProgress));
      }
    }
    const sha512 = options.options.sha512;
    if (sha512 != null) {
      streams.push(new DigestTransform(sha512, "sha512", sha512.length === 128 && !sha512.includes("+") && !sha512.includes("Z") && !sha512.includes("=") ? "hex" : "base64"));
    } else if (options.options.sha2 != null) {
      streams.push(new DigestTransform(options.options.sha2, "sha256", "hex"));
    }
    const fileOut = (0, fs_1.createWriteStream)(options.destination);
    streams.push(fileOut);
    let lastStream = response;
    for (const stream of streams) {
      stream.on("error", (error2) => {
        fileOut.close();
        if (!options.options.cancellationToken.cancelled) {
          options.callback(error2);
        }
      });
      lastStream = lastStream.pipe(stream);
    }
    fileOut.on("finish", () => {
      fileOut.close(options.callback);
    });
  }
  function configureRequestOptions(options, token, method) {
    if (method != null) {
      options.method = method;
    }
    options.headers = { ...options.headers };
    const headers = options.headers;
    if (token != null) {
      headers.authorization = token.startsWith("Basic") || token.startsWith("Bearer") ? token : `token ${token}`;
    }
    if (headers["User-Agent"] == null) {
      headers["User-Agent"] = "electron-builder";
    }
    if (method == null || method === "GET" || headers["Cache-Control"] == null) {
      headers["Cache-Control"] = "no-cache";
    }
    if (options.protocol == null && process.versions.electron != null) {
      options.protocol = "https:";
    }
    return options;
  }
  function isSensitiveFieldName(name) {
    const normalized = normalizeName(name);
    return SENSITIVE_FIELD_PATTERNS.some((p) => normalized.includes(p)) || SENSITIVE_FIELD_SUFFIXES.some((s) => normalized.endsWith(s));
  }
  function hashSensitiveValue(value) {
    return `${(0, crypto_1.createHash)("sha256").update(value).digest("hex")} (sha256 hash)`;
  }
  function safeStringifyJson(data, skippedNames) {
    return JSON.stringify(data, (name, value) => {
      if (isSensitiveFieldName(name) || skippedNames != null && skippedNames.has(name)) {
        return typeof value === "string" ? hashSensitiveValue(value) : "<stripped sensitive data>";
      }
      return value;
    }, 2);
  }
  return httpExecutor;
}
var MemoLazy = {};
var hasRequiredMemoLazy;
function requireMemoLazy() {
  if (hasRequiredMemoLazy) return MemoLazy;
  hasRequiredMemoLazy = 1;
  Object.defineProperty(MemoLazy, "__esModule", { value: true });
  MemoLazy.MemoLazy = void 0;
  let MemoLazy$1 = class MemoLazy {
    constructor(selector, creator) {
      this.selector = selector;
      this.creator = creator;
      this.selected = void 0;
      this._value = void 0;
    }
    get hasValue() {
      return this._value !== void 0;
    }
    get value() {
      const selected = this.selector();
      if (this._value !== void 0 && equals(this.selected, selected)) {
        return this._value;
      }
      this.selected = selected;
      const result = this.creator(selected);
      this.value = result;
      return result;
    }
    set value(value) {
      this._value = value;
    }
  };
  MemoLazy.MemoLazy = MemoLazy$1;
  function equals(firstValue, secondValue) {
    const isFirstObject = typeof firstValue === "object" && firstValue !== null;
    const isSecondObject = typeof secondValue === "object" && secondValue !== null;
    if (isFirstObject && isSecondObject) {
      const keys1 = Object.keys(firstValue);
      const keys2 = Object.keys(secondValue);
      return keys1.length === keys2.length && keys1.every((key) => equals(firstValue[key], secondValue[key]));
    }
    return firstValue === secondValue;
  }
  return MemoLazy;
}
var publishOptions = {};
var hasRequiredPublishOptions;
function requirePublishOptions() {
  if (hasRequiredPublishOptions) return publishOptions;
  hasRequiredPublishOptions = 1;
  Object.defineProperty(publishOptions, "__esModule", { value: true });
  publishOptions.githubUrl = githubUrl;
  publishOptions.githubTagPrefix = githubTagPrefix;
  publishOptions.getS3LikeProviderBaseUrl = getS3LikeProviderBaseUrl;
  function githubUrl(options, defaultHost = "github.com") {
    return `${options.protocol || "https"}://${options.host || defaultHost}`;
  }
  function githubTagPrefix(options) {
    var _a;
    if (options.tagNamePrefix) {
      return options.tagNamePrefix;
    }
    if ((_a = options.vPrefixedTagName) !== null && _a !== void 0 ? _a : true) {
      return "v";
    }
    return "";
  }
  function getS3LikeProviderBaseUrl(configuration) {
    const provider = configuration.provider;
    if (provider === "s3") {
      return s3Url(configuration);
    }
    if (provider === "spaces") {
      return spacesUrl(configuration);
    }
    throw new Error(`Not supported provider: ${provider}`);
  }
  function s3Url(options) {
    let url;
    if (options.accelerate == true) {
      url = `https://${options.bucket}.s3-accelerate.amazonaws.com`;
    } else if (options.endpoint != null) {
      url = `${options.endpoint}/${options.bucket}`;
    } else if (options.bucket.includes(".")) {
      if (options.region == null) {
        throw new Error(`Bucket name "${options.bucket}" includes a dot, but S3 region is missing`);
      }
      if (options.region === "us-east-1") {
        url = `https://s3.amazonaws.com/${options.bucket}`;
      } else {
        url = `https://s3-${options.region}.amazonaws.com/${options.bucket}`;
      }
    } else if (options.region === "cn-north-1") {
      url = `https://${options.bucket}.s3.${options.region}.amazonaws.com.cn`;
    } else {
      url = `https://${options.bucket}.s3.amazonaws.com`;
    }
    return appendPath(url, options.path);
  }
  function appendPath(url, p) {
    if (p != null && p.length > 0) {
      if (!p.startsWith("/")) {
        url += "/";
      }
      url += p;
    }
    return url;
  }
  function spacesUrl(options) {
    if (options.name == null) {
      throw new Error(`name is missing`);
    }
    if (options.region == null) {
      throw new Error(`region is missing`);
    }
    return appendPath(`https://${options.name}.${options.region}.digitaloceanspaces.com`, options.path);
  }
  return publishOptions;
}
var retry = {};
var hasRequiredRetry;
function requireRetry() {
  if (hasRequiredRetry) return retry;
  hasRequiredRetry = 1;
  Object.defineProperty(retry, "__esModule", { value: true });
  retry.retry = retry$1;
  const CancellationToken_1 = requireCancellationToken();
  async function retry$1(task, options) {
    var _a;
    const { retries: retryCount, interval, backoff = 0, attempt = 0, shouldRetry, cancellationToken = new CancellationToken_1.CancellationToken() } = options;
    try {
      return await task();
    } catch (error2) {
      if (await Promise.resolve((_a = shouldRetry === null || shouldRetry === void 0 ? void 0 : shouldRetry(error2)) !== null && _a !== void 0 ? _a : true) && retryCount > 0 && !cancellationToken.cancelled) {
        await new Promise((resolve) => setTimeout(resolve, interval + backoff * attempt));
        return await retry$1(task, { ...options, retries: retryCount - 1, attempt: attempt + 1 });
      } else {
        throw error2;
      }
    }
  }
  return retry;
}
var rfc2253Parser = {};
var hasRequiredRfc2253Parser;
function requireRfc2253Parser() {
  if (hasRequiredRfc2253Parser) return rfc2253Parser;
  hasRequiredRfc2253Parser = 1;
  Object.defineProperty(rfc2253Parser, "__esModule", { value: true });
  rfc2253Parser.parseDn = parseDn;
  function parseDn(seq2) {
    let quoted = false;
    let key = null;
    let token = "";
    let nextNonSpace = 0;
    seq2 = seq2.trim();
    const result = /* @__PURE__ */ new Map();
    for (let i = 0; i <= seq2.length; i++) {
      if (i === seq2.length) {
        if (key !== null) {
          result.set(key, token);
        }
        break;
      }
      const ch = seq2[i];
      if (quoted) {
        if (ch === '"') {
          quoted = false;
          continue;
        }
      } else {
        if (ch === '"') {
          quoted = true;
          continue;
        }
        if (ch === "\\") {
          i++;
          const ord = parseInt(seq2.slice(i, i + 2), 16);
          if (Number.isNaN(ord)) {
            token += seq2[i];
          } else {
            i++;
            token += String.fromCharCode(ord);
          }
          continue;
        }
        if (key === null && ch === "=") {
          key = token;
          token = "";
          continue;
        }
        if (ch === "," || ch === ";" || ch === "+") {
          if (key !== null) {
            result.set(key, token);
          }
          key = null;
          token = "";
          continue;
        }
      }
      if (ch === " " && !quoted) {
        if (token.length === 0) {
          continue;
        }
        if (i > nextNonSpace) {
          let j = i;
          while (seq2[j] === " ") {
            j++;
          }
          nextNonSpace = j;
        }
        if (nextNonSpace >= seq2.length || seq2[nextNonSpace] === "," || seq2[nextNonSpace] === ";" || key === null && seq2[nextNonSpace] === "=" || key !== null && seq2[nextNonSpace] === "+") {
          i = nextNonSpace - 1;
          continue;
        }
      }
      token += ch;
    }
    return result;
  }
  return rfc2253Parser;
}
var uuid = {};
var hasRequiredUuid;
function requireUuid() {
  if (hasRequiredUuid) return uuid;
  hasRequiredUuid = 1;
  Object.defineProperty(uuid, "__esModule", { value: true });
  uuid.nil = uuid.UUID = void 0;
  const crypto_1 = crypto;
  const error_1 = requireError();
  const invalidName = "options.name must be either a string or a Buffer";
  const randomHost = (0, crypto_1.randomBytes)(16);
  randomHost[0] = randomHost[0] | 1;
  const hex2byte = {};
  const byte2hex = [];
  for (let i = 0; i < 256; i++) {
    const hex = (i + 256).toString(16).substr(1);
    hex2byte[hex] = i;
    byte2hex[i] = hex;
  }
  class UUID {
    constructor(uuid2) {
      this.ascii = null;
      this.binary = null;
      const check = UUID.check(uuid2);
      if (!check) {
        throw new Error("not a UUID");
      }
      this.version = check.version;
      if (check.format === "ascii") {
        this.ascii = uuid2;
      } else {
        this.binary = uuid2;
      }
    }
    static v5(name, namespace) {
      return uuidNamed(name, "sha1", 80, namespace);
    }
    toString() {
      if (this.ascii == null) {
        this.ascii = stringify(this.binary);
      }
      return this.ascii;
    }
    inspect() {
      return `UUID v${this.version} ${this.toString()}`;
    }
    static check(uuid2, offset = 0) {
      if (typeof uuid2 === "string") {
        uuid2 = uuid2.toLowerCase();
        if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-([a-f0-9]{12})$/.test(uuid2)) {
          return false;
        }
        if (uuid2 === "00000000-0000-0000-0000-000000000000") {
          return { version: void 0, variant: "nil", format: "ascii" };
        }
        return {
          version: (hex2byte[uuid2[14] + uuid2[15]] & 240) >> 4,
          variant: getVariant((hex2byte[uuid2[19] + uuid2[20]] & 224) >> 5),
          format: "ascii"
        };
      }
      if (Buffer.isBuffer(uuid2)) {
        if (uuid2.length < offset + 16) {
          return false;
        }
        let i = 0;
        for (; i < 16; i++) {
          if (uuid2[offset + i] !== 0) {
            break;
          }
        }
        if (i === 16) {
          return { version: void 0, variant: "nil", format: "binary" };
        }
        return {
          version: (uuid2[offset + 6] & 240) >> 4,
          variant: getVariant((uuid2[offset + 8] & 224) >> 5),
          format: "binary"
        };
      }
      throw (0, error_1.newError)("Unknown type of uuid", "ERR_UNKNOWN_UUID_TYPE");
    }
    // read stringified uuid into a Buffer
    static parse(input) {
      const buffer = Buffer.allocUnsafe(16);
      let j = 0;
      for (let i = 0; i < 16; i++) {
        buffer[i] = hex2byte[input[j++] + input[j++]];
        if (i === 3 || i === 5 || i === 7 || i === 9) {
          j += 1;
        }
      }
      return buffer;
    }
  }
  uuid.UUID = UUID;
  UUID.OID = UUID.parse("6ba7b812-9dad-11d1-80b4-00c04fd430c8");
  function getVariant(bits) {
    switch (bits) {
      case 0:
      case 1:
      case 3:
        return "ncs";
      case 4:
      case 5:
        return "rfc4122";
      case 6:
        return "microsoft";
      default:
        return "future";
    }
  }
  var UuidEncoding;
  (function(UuidEncoding2) {
    UuidEncoding2[UuidEncoding2["ASCII"] = 0] = "ASCII";
    UuidEncoding2[UuidEncoding2["BINARY"] = 1] = "BINARY";
    UuidEncoding2[UuidEncoding2["OBJECT"] = 2] = "OBJECT";
  })(UuidEncoding || (UuidEncoding = {}));
  function uuidNamed(name, hashMethod, version, namespace, encoding = UuidEncoding.ASCII) {
    const hash = (0, crypto_1.createHash)(hashMethod);
    const nameIsNotAString = typeof name !== "string";
    if (nameIsNotAString && !Buffer.isBuffer(name)) {
      throw (0, error_1.newError)(invalidName, "ERR_INVALID_UUID_NAME");
    }
    hash.update(namespace);
    hash.update(name);
    const buffer = hash.digest();
    let result;
    switch (encoding) {
      case UuidEncoding.BINARY:
        buffer[6] = buffer[6] & 15 | version;
        buffer[8] = buffer[8] & 63 | 128;
        result = buffer;
        break;
      case UuidEncoding.OBJECT:
        buffer[6] = buffer[6] & 15 | version;
        buffer[8] = buffer[8] & 63 | 128;
        result = new UUID(buffer);
        break;
      default:
        result = byte2hex[buffer[0]] + byte2hex[buffer[1]] + byte2hex[buffer[2]] + byte2hex[buffer[3]] + "-" + byte2hex[buffer[4]] + byte2hex[buffer[5]] + "-" + byte2hex[buffer[6] & 15 | version] + byte2hex[buffer[7]] + "-" + byte2hex[buffer[8] & 63 | 128] + byte2hex[buffer[9]] + "-" + byte2hex[buffer[10]] + byte2hex[buffer[11]] + byte2hex[buffer[12]] + byte2hex[buffer[13]] + byte2hex[buffer[14]] + byte2hex[buffer[15]];
        break;
    }
    return result;
  }
  function stringify(buffer) {
    return byte2hex[buffer[0]] + byte2hex[buffer[1]] + byte2hex[buffer[2]] + byte2hex[buffer[3]] + "-" + byte2hex[buffer[4]] + byte2hex[buffer[5]] + "-" + byte2hex[buffer[6]] + byte2hex[buffer[7]] + "-" + byte2hex[buffer[8]] + byte2hex[buffer[9]] + "-" + byte2hex[buffer[10]] + byte2hex[buffer[11]] + byte2hex[buffer[12]] + byte2hex[buffer[13]] + byte2hex[buffer[14]] + byte2hex[buffer[15]];
  }
  uuid.nil = new UUID("00000000-0000-0000-0000-000000000000");
  return uuid;
}
var xml = {};
var sax = {};
var hasRequiredSax;
function requireSax() {
  if (hasRequiredSax) return sax;
  hasRequiredSax = 1;
  (function(exports) {
    (function(sax2) {
      sax2.parser = function(strict, opt) {
        return new SAXParser(strict, opt);
      };
      sax2.SAXParser = SAXParser;
      sax2.SAXStream = SAXStream;
      sax2.createStream = createStream;
      sax2.MAX_BUFFER_LENGTH = 64 * 1024;
      var buffers = [
        "comment",
        "sgmlDecl",
        "textNode",
        "tagName",
        "doctype",
        "procInstName",
        "procInstBody",
        "entity",
        "attribName",
        "attribValue",
        "cdata",
        "script"
      ];
      sax2.EVENTS = [
        "text",
        "processinginstruction",
        "sgmldeclaration",
        "doctype",
        "comment",
        "opentagstart",
        "attribute",
        "opentag",
        "closetag",
        "opencdata",
        "cdata",
        "closecdata",
        "error",
        "end",
        "ready",
        "script",
        "opennamespace",
        "closenamespace"
      ];
      function SAXParser(strict, opt) {
        if (!(this instanceof SAXParser)) {
          return new SAXParser(strict, opt);
        }
        var parser = this;
        clearBuffers(parser);
        parser.q = parser.c = "";
        parser.bufferCheckPosition = sax2.MAX_BUFFER_LENGTH;
        parser.encoding = null;
        parser.opt = opt || {};
        parser.opt.lowercase = parser.opt.lowercase || parser.opt.lowercasetags;
        parser.looseCase = parser.opt.lowercase ? "toLowerCase" : "toUpperCase";
        parser.opt.maxEntityCount = parser.opt.maxEntityCount || 512;
        parser.opt.maxEntityDepth = parser.opt.maxEntityDepth || 4;
        parser.entityCount = parser.entityDepth = 0;
        parser.tags = [];
        parser.closed = parser.closedRoot = parser.sawRoot = false;
        parser.tag = parser.error = null;
        parser.strict = !!strict;
        parser.noscript = !!(strict || parser.opt.noscript);
        parser.state = S.BEGIN;
        parser.strictEntities = parser.opt.strictEntities;
        parser.ENTITIES = parser.strictEntities ? Object.create(sax2.XML_ENTITIES) : Object.create(sax2.ENTITIES);
        parser.attribList = [];
        if (parser.opt.xmlns) {
          parser.ns = Object.create(rootNS);
        }
        if (parser.opt.unquotedAttributeValues === void 0) {
          parser.opt.unquotedAttributeValues = !strict;
        }
        parser.trackPosition = parser.opt.position !== false;
        if (parser.trackPosition) {
          parser.position = parser.line = parser.column = 0;
        }
        emit(parser, "onready");
      }
      if (!Object.create) {
        Object.create = function(o) {
          function F() {
          }
          F.prototype = o;
          var newf = new F();
          return newf;
        };
      }
      if (!Object.keys) {
        Object.keys = function(o) {
          var a = [];
          for (var i in o) if (o.hasOwnProperty(i)) a.push(i);
          return a;
        };
      }
      function checkBufferLength(parser) {
        var maxAllowed = Math.max(sax2.MAX_BUFFER_LENGTH, 10);
        var maxActual = 0;
        for (var i = 0, l = buffers.length; i < l; i++) {
          var len = parser[buffers[i]].length;
          if (len > maxAllowed) {
            switch (buffers[i]) {
              case "textNode":
                closeText(parser);
                break;
              case "cdata":
                emitNode(parser, "oncdata", parser.cdata);
                parser.cdata = "";
                break;
              case "script":
                emitNode(parser, "onscript", parser.script);
                parser.script = "";
                break;
              default:
                error2(parser, "Max buffer length exceeded: " + buffers[i]);
            }
          }
          maxActual = Math.max(maxActual, len);
        }
        var m = sax2.MAX_BUFFER_LENGTH - maxActual;
        parser.bufferCheckPosition = m + parser.position;
      }
      function clearBuffers(parser) {
        for (var i = 0, l = buffers.length; i < l; i++) {
          parser[buffers[i]] = "";
        }
      }
      function flushBuffers(parser) {
        closeText(parser);
        if (parser.cdata !== "") {
          emitNode(parser, "oncdata", parser.cdata);
          parser.cdata = "";
        }
        if (parser.script !== "") {
          emitNode(parser, "onscript", parser.script);
          parser.script = "";
        }
      }
      SAXParser.prototype = {
        end: function() {
          end(this);
        },
        write,
        resume: function() {
          this.error = null;
          return this;
        },
        close: function() {
          return this.write(null);
        },
        flush: function() {
          flushBuffers(this);
        }
      };
      var Stream;
      try {
        Stream = require("stream").Stream;
      } catch (ex) {
        Stream = function() {
        };
      }
      if (!Stream) Stream = function() {
      };
      var streamWraps = sax2.EVENTS.filter(function(ev) {
        return ev !== "error" && ev !== "end";
      });
      function createStream(strict, opt) {
        return new SAXStream(strict, opt);
      }
      function determineBufferEncoding(data, isEnd) {
        if (data.length >= 2) {
          if (data[0] === 255 && data[1] === 254) {
            return "utf-16le";
          }
          if (data[0] === 254 && data[1] === 255) {
            return "utf-16be";
          }
        }
        if (data.length >= 3 && data[0] === 239 && data[1] === 187 && data[2] === 191) {
          return "utf8";
        }
        if (data.length >= 4) {
          if (data[0] === 60 && data[1] === 0 && data[2] === 63 && data[3] === 0) {
            return "utf-16le";
          }
          if (data[0] === 0 && data[1] === 60 && data[2] === 0 && data[3] === 63) {
            return "utf-16be";
          }
          return "utf8";
        }
        return isEnd ? "utf8" : null;
      }
      function SAXStream(strict, opt) {
        if (!(this instanceof SAXStream)) {
          return new SAXStream(strict, opt);
        }
        Stream.apply(this);
        this._parser = new SAXParser(strict, opt);
        this.writable = true;
        this.readable = true;
        var me = this;
        this._parser.onend = function() {
          me.emit("end");
        };
        this._parser.onerror = function(er) {
          me.emit("error", er);
          me._parser.error = null;
        };
        this._decoder = null;
        this._decoderBuffer = null;
        streamWraps.forEach(function(ev) {
          Object.defineProperty(me, "on" + ev, {
            get: function() {
              return me._parser["on" + ev];
            },
            set: function(h) {
              if (!h) {
                me.removeAllListeners(ev);
                me._parser["on" + ev] = h;
                return h;
              }
              me.on(ev, h);
            },
            enumerable: true,
            configurable: false
          });
        });
      }
      SAXStream.prototype = Object.create(Stream.prototype, {
        constructor: {
          value: SAXStream
        }
      });
      SAXStream.prototype._decodeBuffer = function(data, isEnd) {
        if (this._decoderBuffer) {
          data = Buffer.concat([this._decoderBuffer, data]);
          this._decoderBuffer = null;
        }
        if (!this._decoder) {
          var encoding = determineBufferEncoding(data, isEnd);
          if (!encoding) {
            this._decoderBuffer = data;
            return "";
          }
          this._parser.encoding = encoding;
          this._decoder = new TextDecoder(encoding);
        }
        return this._decoder.decode(data, { stream: !isEnd });
      };
      SAXStream.prototype.write = function(data) {
        if (typeof Buffer === "function" && typeof Buffer.isBuffer === "function" && Buffer.isBuffer(data)) {
          data = this._decodeBuffer(data, false);
        } else if (this._decoderBuffer) {
          var remaining = this._decodeBuffer(Buffer.alloc(0), true);
          if (remaining) {
            this._parser.write(remaining);
            this.emit("data", remaining);
          }
        }
        this._parser.write(data.toString());
        this.emit("data", data);
        return true;
      };
      SAXStream.prototype.end = function(chunk) {
        if (chunk && chunk.length) {
          this.write(chunk);
        }
        if (this._decoderBuffer) {
          var finalChunk = this._decodeBuffer(Buffer.alloc(0), true);
          if (finalChunk) {
            this._parser.write(finalChunk);
            this.emit("data", finalChunk);
          }
        } else if (this._decoder) {
          var remaining = this._decoder.decode();
          if (remaining) {
            this._parser.write(remaining);
            this.emit("data", remaining);
          }
        }
        this._parser.end();
        return true;
      };
      SAXStream.prototype.on = function(ev, handler) {
        var me = this;
        if (!me._parser["on" + ev] && streamWraps.indexOf(ev) !== -1) {
          me._parser["on" + ev] = function() {
            var args = arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments);
            args.splice(0, 0, ev);
            me.emit.apply(me, args);
          };
        }
        return Stream.prototype.on.call(me, ev, handler);
      };
      var CDATA = "[CDATA[";
      var DOCTYPE = "DOCTYPE";
      var XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
      var XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
      var rootNS = { xml: XML_NAMESPACE, xmlns: XMLNS_NAMESPACE };
      var nameStart = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
      var nameBody = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;
      var entityStart = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
      var entityBody = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;
      function isWhitespace(c) {
        return c === " " || c === "\n" || c === "\r" || c === "	";
      }
      function isQuote(c) {
        return c === '"' || c === "'";
      }
      function isAttribEnd(c) {
        return c === ">" || isWhitespace(c);
      }
      function isMatch(regex, c) {
        return regex.test(c);
      }
      function notMatch(regex, c) {
        return !isMatch(regex, c);
      }
      var S = 0;
      sax2.STATE = {
        BEGIN: S++,
        // leading byte order mark or whitespace
        BEGIN_WHITESPACE: S++,
        // leading whitespace
        TEXT: S++,
        // general stuff
        TEXT_ENTITY: S++,
        // &amp and such.
        OPEN_WAKA: S++,
        // <
        SGML_DECL: S++,
        // <!BLARG
        SGML_DECL_QUOTED: S++,
        // <!BLARG foo "bar
        DOCTYPE: S++,
        // <!DOCTYPE
        DOCTYPE_QUOTED: S++,
        // <!DOCTYPE "//blah
        DOCTYPE_DTD: S++,
        // <!DOCTYPE "//blah" [ ...
        DOCTYPE_DTD_QUOTED: S++,
        // <!DOCTYPE "//blah" [ "foo
        COMMENT_STARTING: S++,
        // <!-
        COMMENT: S++,
        // <!--
        COMMENT_ENDING: S++,
        // <!-- blah -
        COMMENT_ENDED: S++,
        // <!-- blah --
        CDATA: S++,
        // <![CDATA[ something
        CDATA_ENDING: S++,
        // ]
        CDATA_ENDING_2: S++,
        // ]]
        PROC_INST: S++,
        // <?hi
        PROC_INST_BODY: S++,
        // <?hi there
        PROC_INST_ENDING: S++,
        // <?hi "there" ?
        OPEN_TAG: S++,
        // <strong
        OPEN_TAG_SLASH: S++,
        // <strong /
        ATTRIB: S++,
        // <a
        ATTRIB_NAME: S++,
        // <a foo
        ATTRIB_NAME_SAW_WHITE: S++,
        // <a foo _
        ATTRIB_VALUE: S++,
        // <a foo=
        ATTRIB_VALUE_QUOTED: S++,
        // <a foo="bar
        ATTRIB_VALUE_CLOSED: S++,
        // <a foo="bar"
        ATTRIB_VALUE_UNQUOTED: S++,
        // <a foo=bar
        ATTRIB_VALUE_ENTITY_Q: S++,
        // <foo bar="&quot;"
        ATTRIB_VALUE_ENTITY_U: S++,
        // <foo bar=&quot
        CLOSE_TAG: S++,
        // </a
        CLOSE_TAG_SAW_WHITE: S++,
        // </a   >
        SCRIPT: S++,
        // <script> ...
        SCRIPT_ENDING: S++
        // <script> ... <
      };
      sax2.XML_ENTITIES = {
        amp: "&",
        gt: ">",
        lt: "<",
        quot: '"',
        apos: "'"
      };
      sax2.ENTITIES = {
        amp: "&",
        gt: ">",
        lt: "<",
        quot: '"',
        apos: "'",
        AElig: 198,
        Aacute: 193,
        Acirc: 194,
        Agrave: 192,
        Aring: 197,
        Atilde: 195,
        Auml: 196,
        Ccedil: 199,
        ETH: 208,
        Eacute: 201,
        Ecirc: 202,
        Egrave: 200,
        Euml: 203,
        Iacute: 205,
        Icirc: 206,
        Igrave: 204,
        Iuml: 207,
        Ntilde: 209,
        Oacute: 211,
        Ocirc: 212,
        Ograve: 210,
        Oslash: 216,
        Otilde: 213,
        Ouml: 214,
        THORN: 222,
        Uacute: 218,
        Ucirc: 219,
        Ugrave: 217,
        Uuml: 220,
        Yacute: 221,
        aacute: 225,
        acirc: 226,
        aelig: 230,
        agrave: 224,
        aring: 229,
        atilde: 227,
        auml: 228,
        ccedil: 231,
        eacute: 233,
        ecirc: 234,
        egrave: 232,
        eth: 240,
        euml: 235,
        iacute: 237,
        icirc: 238,
        igrave: 236,
        iuml: 239,
        ntilde: 241,
        oacute: 243,
        ocirc: 244,
        ograve: 242,
        oslash: 248,
        otilde: 245,
        ouml: 246,
        szlig: 223,
        thorn: 254,
        uacute: 250,
        ucirc: 251,
        ugrave: 249,
        uuml: 252,
        yacute: 253,
        yuml: 255,
        copy: 169,
        reg: 174,
        nbsp: 160,
        iexcl: 161,
        cent: 162,
        pound: 163,
        curren: 164,
        yen: 165,
        brvbar: 166,
        sect: 167,
        uml: 168,
        ordf: 170,
        laquo: 171,
        not: 172,
        shy: 173,
        macr: 175,
        deg: 176,
        plusmn: 177,
        sup1: 185,
        sup2: 178,
        sup3: 179,
        acute: 180,
        micro: 181,
        para: 182,
        middot: 183,
        cedil: 184,
        ordm: 186,
        raquo: 187,
        frac14: 188,
        frac12: 189,
        frac34: 190,
        iquest: 191,
        times: 215,
        divide: 247,
        OElig: 338,
        oelig: 339,
        Scaron: 352,
        scaron: 353,
        Yuml: 376,
        fnof: 402,
        circ: 710,
        tilde: 732,
        Alpha: 913,
        Beta: 914,
        Gamma: 915,
        Delta: 916,
        Epsilon: 917,
        Zeta: 918,
        Eta: 919,
        Theta: 920,
        Iota: 921,
        Kappa: 922,
        Lambda: 923,
        Mu: 924,
        Nu: 925,
        Xi: 926,
        Omicron: 927,
        Pi: 928,
        Rho: 929,
        Sigma: 931,
        Tau: 932,
        Upsilon: 933,
        Phi: 934,
        Chi: 935,
        Psi: 936,
        Omega: 937,
        alpha: 945,
        beta: 946,
        gamma: 947,
        delta: 948,
        epsilon: 949,
        zeta: 950,
        eta: 951,
        theta: 952,
        iota: 953,
        kappa: 954,
        lambda: 955,
        mu: 956,
        nu: 957,
        xi: 958,
        omicron: 959,
        pi: 960,
        rho: 961,
        sigmaf: 962,
        sigma: 963,
        tau: 964,
        upsilon: 965,
        phi: 966,
        chi: 967,
        psi: 968,
        omega: 969,
        thetasym: 977,
        upsih: 978,
        piv: 982,
        ensp: 8194,
        emsp: 8195,
        thinsp: 8201,
        zwnj: 8204,
        zwj: 8205,
        lrm: 8206,
        rlm: 8207,
        ndash: 8211,
        mdash: 8212,
        lsquo: 8216,
        rsquo: 8217,
        sbquo: 8218,
        ldquo: 8220,
        rdquo: 8221,
        bdquo: 8222,
        dagger: 8224,
        Dagger: 8225,
        bull: 8226,
        hellip: 8230,
        permil: 8240,
        prime: 8242,
        Prime: 8243,
        lsaquo: 8249,
        rsaquo: 8250,
        oline: 8254,
        frasl: 8260,
        euro: 8364,
        image: 8465,
        weierp: 8472,
        real: 8476,
        trade: 8482,
        alefsym: 8501,
        larr: 8592,
        uarr: 8593,
        rarr: 8594,
        darr: 8595,
        harr: 8596,
        crarr: 8629,
        lArr: 8656,
        uArr: 8657,
        rArr: 8658,
        dArr: 8659,
        hArr: 8660,
        forall: 8704,
        part: 8706,
        exist: 8707,
        empty: 8709,
        nabla: 8711,
        isin: 8712,
        notin: 8713,
        ni: 8715,
        prod: 8719,
        sum: 8721,
        minus: 8722,
        lowast: 8727,
        radic: 8730,
        prop: 8733,
        infin: 8734,
        ang: 8736,
        and: 8743,
        or: 8744,
        cap: 8745,
        cup: 8746,
        int: 8747,
        there4: 8756,
        sim: 8764,
        cong: 8773,
        asymp: 8776,
        ne: 8800,
        equiv: 8801,
        le: 8804,
        ge: 8805,
        sub: 8834,
        sup: 8835,
        nsub: 8836,
        sube: 8838,
        supe: 8839,
        oplus: 8853,
        otimes: 8855,
        perp: 8869,
        sdot: 8901,
        lceil: 8968,
        rceil: 8969,
        lfloor: 8970,
        rfloor: 8971,
        lang: 9001,
        rang: 9002,
        loz: 9674,
        spades: 9824,
        clubs: 9827,
        hearts: 9829,
        diams: 9830
      };
      Object.keys(sax2.ENTITIES).forEach(function(key) {
        var e = sax2.ENTITIES[key];
        var s2 = typeof e === "number" ? String.fromCharCode(e) : e;
        sax2.ENTITIES[key] = s2;
      });
      for (var s in sax2.STATE) {
        sax2.STATE[sax2.STATE[s]] = s;
      }
      S = sax2.STATE;
      function emit(parser, event, data) {
        parser[event] && parser[event](data);
      }
      function getDeclaredEncoding(body) {
        var match = body && body.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i);
        return match ? match[2] : null;
      }
      function normalizeEncodingName(encoding) {
        if (!encoding) {
          return null;
        }
        return encoding.toLowerCase().replace(/[^a-z0-9]/g, "");
      }
      function encodingsMatch(detectedEncoding, declaredEncoding) {
        const detected = normalizeEncodingName(detectedEncoding);
        const declared = normalizeEncodingName(declaredEncoding);
        if (!detected || !declared) {
          return true;
        }
        if (declared === "utf16") {
          return detected === "utf16le" || detected === "utf16be";
        }
        return detected === declared;
      }
      function validateXmlDeclarationEncoding(parser, data) {
        if (!parser.strict || !parser.encoding || !data || data.name !== "xml") {
          return;
        }
        var declaredEncoding = getDeclaredEncoding(data.body);
        if (declaredEncoding && !encodingsMatch(parser.encoding, declaredEncoding)) {
          strictFail(
            parser,
            "XML declaration encoding " + declaredEncoding + " does not match detected stream encoding " + parser.encoding.toUpperCase()
          );
        }
      }
      function emitNode(parser, nodeType, data) {
        if (parser.textNode) closeText(parser);
        emit(parser, nodeType, data);
      }
      function closeText(parser) {
        parser.textNode = textopts(parser.opt, parser.textNode);
        if (parser.textNode) emit(parser, "ontext", parser.textNode);
        parser.textNode = "";
      }
      function textopts(opt, text) {
        if (opt.trim) text = text.trim();
        if (opt.normalize) text = text.replace(/\s+/g, " ");
        return text;
      }
      function error2(parser, er) {
        closeText(parser);
        if (parser.trackPosition) {
          er += "\nLine: " + parser.line + "\nColumn: " + parser.column + "\nChar: " + parser.c;
        }
        er = new Error(er);
        parser.error = er;
        emit(parser, "onerror", er);
        return parser;
      }
      function end(parser) {
        if (parser.sawRoot && !parser.closedRoot)
          strictFail(parser, "Unclosed root tag");
        if (parser.state !== S.BEGIN && parser.state !== S.BEGIN_WHITESPACE && parser.state !== S.TEXT) {
          error2(parser, "Unexpected end");
        }
        closeText(parser);
        parser.c = "";
        parser.closed = true;
        emit(parser, "onend");
        SAXParser.call(parser, parser.strict, parser.opt);
        return parser;
      }
      function strictFail(parser, message) {
        if (typeof parser !== "object" || !(parser instanceof SAXParser)) {
          throw new Error("bad call to strictFail");
        }
        if (parser.strict) {
          error2(parser, message);
        }
      }
      function newTag(parser) {
        if (!parser.strict) parser.tagName = parser.tagName[parser.looseCase]();
        var parent = parser.tags[parser.tags.length - 1] || parser;
        var tag = parser.tag = { name: parser.tagName, attributes: {} };
        if (parser.opt.xmlns) {
          tag.ns = parent.ns;
        }
        parser.attribList.length = 0;
        emitNode(parser, "onopentagstart", tag);
      }
      function qname(name, attribute) {
        var i = name.indexOf(":");
        var qualName = i < 0 ? ["", name] : name.split(":");
        var prefix = qualName[0];
        var local = qualName[1];
        if (attribute && name === "xmlns") {
          prefix = "xmlns";
          local = "";
        }
        return { prefix, local };
      }
      function attrib(parser) {
        if (!parser.strict) {
          parser.attribName = parser.attribName[parser.looseCase]();
        }
        if (parser.attribList.indexOf(parser.attribName) !== -1 || parser.tag.attributes.hasOwnProperty(parser.attribName)) {
          parser.attribName = parser.attribValue = "";
          return;
        }
        if (parser.opt.xmlns) {
          var qn = qname(parser.attribName, true);
          var prefix = qn.prefix;
          var local = qn.local;
          if (prefix === "xmlns") {
            if (local === "xml" && parser.attribValue !== XML_NAMESPACE) {
              strictFail(
                parser,
                "xml: prefix must be bound to " + XML_NAMESPACE + "\nActual: " + parser.attribValue
              );
            } else if (local === "xmlns" && parser.attribValue !== XMLNS_NAMESPACE) {
              strictFail(
                parser,
                "xmlns: prefix must be bound to " + XMLNS_NAMESPACE + "\nActual: " + parser.attribValue
              );
            } else {
              var tag = parser.tag;
              var parent = parser.tags[parser.tags.length - 1] || parser;
              if (tag.ns === parent.ns) {
                tag.ns = Object.create(parent.ns);
              }
              tag.ns[local] = parser.attribValue;
            }
          }
          parser.attribList.push([parser.attribName, parser.attribValue]);
        } else {
          parser.tag.attributes[parser.attribName] = parser.attribValue;
          emitNode(parser, "onattribute", {
            name: parser.attribName,
            value: parser.attribValue
          });
        }
        parser.attribName = parser.attribValue = "";
      }
      function openTag(parser, selfClosing) {
        if (parser.opt.xmlns) {
          var tag = parser.tag;
          var qn = qname(parser.tagName);
          tag.prefix = qn.prefix;
          tag.local = qn.local;
          tag.uri = tag.ns[qn.prefix] || "";
          if (tag.prefix && !tag.uri) {
            strictFail(
              parser,
              "Unbound namespace prefix: " + JSON.stringify(parser.tagName)
            );
            tag.uri = qn.prefix;
          }
          var parent = parser.tags[parser.tags.length - 1] || parser;
          if (tag.ns && parent.ns !== tag.ns) {
            Object.keys(tag.ns).forEach(function(p) {
              emitNode(parser, "onopennamespace", {
                prefix: p,
                uri: tag.ns[p]
              });
            });
          }
          for (var i = 0, l = parser.attribList.length; i < l; i++) {
            var nv = parser.attribList[i];
            var name = nv[0];
            var value = nv[1];
            var qualName = qname(name, true);
            var prefix = qualName.prefix;
            var local = qualName.local;
            var uri = prefix === "" ? "" : tag.ns[prefix] || "";
            var a = {
              name,
              value,
              prefix,
              local,
              uri
            };
            if (prefix && prefix !== "xmlns" && !uri) {
              strictFail(
                parser,
                "Unbound namespace prefix: " + JSON.stringify(prefix)
              );
              a.uri = prefix;
            }
            parser.tag.attributes[name] = a;
            emitNode(parser, "onattribute", a);
          }
          parser.attribList.length = 0;
        }
        parser.tag.isSelfClosing = !!selfClosing;
        parser.sawRoot = true;
        parser.tags.push(parser.tag);
        emitNode(parser, "onopentag", parser.tag);
        if (!selfClosing) {
          if (!parser.noscript && parser.tagName.toLowerCase() === "script") {
            parser.state = S.SCRIPT;
          } else {
            parser.state = S.TEXT;
          }
          parser.tag = null;
          parser.tagName = "";
        }
        parser.attribName = parser.attribValue = "";
        parser.attribList.length = 0;
      }
      function closeTag(parser) {
        if (!parser.tagName) {
          strictFail(parser, "Weird empty close tag.");
          parser.textNode += "</>";
          parser.state = S.TEXT;
          return;
        }
        if (parser.script) {
          if (parser.tagName !== "script") {
            parser.script += "</" + parser.tagName + ">";
            parser.tagName = "";
            parser.state = S.SCRIPT;
            return;
          }
          emitNode(parser, "onscript", parser.script);
          parser.script = "";
        }
        var t = parser.tags.length;
        var tagName = parser.tagName;
        if (!parser.strict) {
          tagName = tagName[parser.looseCase]();
        }
        var closeTo = tagName;
        while (t--) {
          var close = parser.tags[t];
          if (close.name !== closeTo) {
            strictFail(parser, "Unexpected close tag");
          } else {
            break;
          }
        }
        if (t < 0) {
          strictFail(parser, "Unmatched closing tag: " + parser.tagName);
          parser.textNode += "</" + parser.tagName + ">";
          parser.state = S.TEXT;
          return;
        }
        parser.tagName = tagName;
        var s2 = parser.tags.length;
        while (s2-- > t) {
          var tag = parser.tag = parser.tags.pop();
          parser.tagName = parser.tag.name;
          emitNode(parser, "onclosetag", parser.tagName);
          var x = {};
          for (var i in tag.ns) {
            x[i] = tag.ns[i];
          }
          var parent = parser.tags[parser.tags.length - 1] || parser;
          if (parser.opt.xmlns && tag.ns !== parent.ns) {
            Object.keys(tag.ns).forEach(function(p) {
              var n = tag.ns[p];
              emitNode(parser, "onclosenamespace", { prefix: p, uri: n });
            });
          }
        }
        if (t === 0) parser.closedRoot = true;
        parser.tagName = parser.attribValue = parser.attribName = "";
        parser.attribList.length = 0;
        parser.state = S.TEXT;
      }
      function parseEntity(parser) {
        var entity = parser.entity;
        var entityLC = entity.toLowerCase();
        var num;
        var numStr = "";
        if (parser.ENTITIES[entity]) {
          return parser.ENTITIES[entity];
        }
        if (parser.ENTITIES[entityLC]) {
          return parser.ENTITIES[entityLC];
        }
        entity = entityLC;
        if (entity.charAt(0) === "#") {
          if (entity.charAt(1) === "x") {
            entity = entity.slice(2);
            num = parseInt(entity, 16);
            numStr = num.toString(16);
          } else {
            entity = entity.slice(1);
            num = parseInt(entity, 10);
            numStr = num.toString(10);
          }
        }
        entity = entity.replace(/^0+/, "");
        if (isNaN(num) || numStr.toLowerCase() !== entity || num < 0 || num > 1114111) {
          strictFail(parser, "Invalid character entity");
          return "&" + parser.entity + ";";
        }
        return String.fromCodePoint(num);
      }
      function beginWhiteSpace(parser, c) {
        if (c === "<") {
          parser.state = S.OPEN_WAKA;
          parser.startTagPosition = parser.position;
        } else if (!isWhitespace(c)) {
          strictFail(parser, "Non-whitespace before first tag.");
          parser.textNode = c;
          parser.state = S.TEXT;
        }
      }
      function charAt(chunk, i) {
        var result = "";
        if (i < chunk.length) {
          result = chunk.charAt(i);
        }
        return result;
      }
      function write(chunk) {
        var parser = this;
        if (this.error) {
          throw this.error;
        }
        if (parser.closed) {
          return error2(
            parser,
            "Cannot write after close. Assign an onready handler."
          );
        }
        if (chunk === null) {
          return end(parser);
        }
        if (typeof chunk === "object") {
          chunk = chunk.toString();
        }
        var i = 0;
        var c = "";
        while (true) {
          c = charAt(chunk, i++);
          parser.c = c;
          if (!c) {
            break;
          }
          if (parser.trackPosition) {
            parser.position++;
            if (c === "\n") {
              parser.line++;
              parser.column = 0;
            } else {
              parser.column++;
            }
          }
          switch (parser.state) {
            case S.BEGIN:
              parser.state = S.BEGIN_WHITESPACE;
              if (c === "\uFEFF") {
                continue;
              }
              beginWhiteSpace(parser, c);
              continue;
            case S.BEGIN_WHITESPACE:
              beginWhiteSpace(parser, c);
              continue;
            case S.TEXT:
              if (parser.sawRoot && !parser.closedRoot) {
                var starti = i - 1;
                while (c && c !== "<" && c !== "&") {
                  c = charAt(chunk, i++);
                  if (c && parser.trackPosition) {
                    parser.position++;
                    if (c === "\n") {
                      parser.line++;
                      parser.column = 0;
                    } else {
                      parser.column++;
                    }
                  }
                }
                parser.textNode += chunk.substring(starti, i - 1);
              }
              if (c === "<" && !(parser.sawRoot && parser.closedRoot && !parser.strict)) {
                parser.state = S.OPEN_WAKA;
                parser.startTagPosition = parser.position;
              } else {
                if (!isWhitespace(c) && (!parser.sawRoot || parser.closedRoot)) {
                  strictFail(parser, "Text data outside of root node.");
                }
                if (c === "&") {
                  parser.state = S.TEXT_ENTITY;
                } else {
                  parser.textNode += c;
                }
              }
              continue;
            case S.SCRIPT:
              if (c === "<") {
                parser.state = S.SCRIPT_ENDING;
              } else {
                parser.script += c;
              }
              continue;
            case S.SCRIPT_ENDING:
              if (c === "/") {
                parser.state = S.CLOSE_TAG;
              } else {
                parser.script += "<" + c;
                parser.state = S.SCRIPT;
              }
              continue;
            case S.OPEN_WAKA:
              if (c === "!") {
                parser.state = S.SGML_DECL;
                parser.sgmlDecl = "";
              } else if (isWhitespace(c)) ;
              else if (isMatch(nameStart, c)) {
                parser.state = S.OPEN_TAG;
                parser.tagName = c;
              } else if (c === "/") {
                parser.state = S.CLOSE_TAG;
                parser.tagName = "";
              } else if (c === "?") {
                parser.state = S.PROC_INST;
                parser.procInstName = parser.procInstBody = "";
              } else {
                strictFail(parser, "Unencoded <");
                if (parser.startTagPosition + 1 < parser.position) {
                  var pad = parser.position - parser.startTagPosition;
                  c = new Array(pad).join(" ") + c;
                }
                parser.textNode += "<" + c;
                parser.state = S.TEXT;
              }
              continue;
            case S.SGML_DECL:
              if (parser.sgmlDecl + c === "--") {
                parser.state = S.COMMENT;
                parser.comment = "";
                parser.sgmlDecl = "";
                continue;
              }
              if (parser.doctype && parser.doctype !== true && parser.sgmlDecl) {
                parser.state = S.DOCTYPE_DTD;
                parser.doctype += "<!" + parser.sgmlDecl + c;
                parser.sgmlDecl = "";
              } else if ((parser.sgmlDecl + c).toUpperCase() === CDATA) {
                emitNode(parser, "onopencdata");
                parser.state = S.CDATA;
                parser.sgmlDecl = "";
                parser.cdata = "";
              } else if ((parser.sgmlDecl + c).toUpperCase() === DOCTYPE) {
                parser.state = S.DOCTYPE;
                if (parser.doctype || parser.sawRoot) {
                  strictFail(
                    parser,
                    "Inappropriately located doctype declaration"
                  );
                }
                parser.doctype = "";
                parser.sgmlDecl = "";
              } else if (c === ">") {
                emitNode(parser, "onsgmldeclaration", parser.sgmlDecl);
                parser.sgmlDecl = "";
                parser.state = S.TEXT;
              } else if (isQuote(c)) {
                parser.state = S.SGML_DECL_QUOTED;
                parser.sgmlDecl += c;
              } else {
                parser.sgmlDecl += c;
              }
              continue;
            case S.SGML_DECL_QUOTED:
              if (c === parser.q) {
                parser.state = S.SGML_DECL;
                parser.q = "";
              }
              parser.sgmlDecl += c;
              continue;
            case S.DOCTYPE:
              if (c === ">") {
                parser.state = S.TEXT;
                emitNode(parser, "ondoctype", parser.doctype);
                parser.doctype = true;
              } else {
                parser.doctype += c;
                if (c === "[") {
                  parser.state = S.DOCTYPE_DTD;
                } else if (isQuote(c)) {
                  parser.state = S.DOCTYPE_QUOTED;
                  parser.q = c;
                }
              }
              continue;
            case S.DOCTYPE_QUOTED:
              parser.doctype += c;
              if (c === parser.q) {
                parser.q = "";
                parser.state = S.DOCTYPE;
              }
              continue;
            case S.DOCTYPE_DTD:
              if (c === "]") {
                parser.doctype += c;
                parser.state = S.DOCTYPE;
              } else if (c === "<") {
                parser.state = S.OPEN_WAKA;
                parser.startTagPosition = parser.position;
              } else if (isQuote(c)) {
                parser.doctype += c;
                parser.state = S.DOCTYPE_DTD_QUOTED;
                parser.q = c;
              } else {
                parser.doctype += c;
              }
              continue;
            case S.DOCTYPE_DTD_QUOTED:
              parser.doctype += c;
              if (c === parser.q) {
                parser.state = S.DOCTYPE_DTD;
                parser.q = "";
              }
              continue;
            case S.COMMENT:
              if (c === "-") {
                parser.state = S.COMMENT_ENDING;
              } else {
                parser.comment += c;
              }
              continue;
            case S.COMMENT_ENDING:
              if (c === "-") {
                parser.state = S.COMMENT_ENDED;
                parser.comment = textopts(parser.opt, parser.comment);
                if (parser.comment) {
                  emitNode(parser, "oncomment", parser.comment);
                }
                parser.comment = "";
              } else {
                parser.comment += "-" + c;
                parser.state = S.COMMENT;
              }
              continue;
            case S.COMMENT_ENDED:
              if (c !== ">") {
                strictFail(parser, "Malformed comment");
                parser.comment += "--" + c;
                parser.state = S.COMMENT;
              } else if (parser.doctype && parser.doctype !== true) {
                parser.state = S.DOCTYPE_DTD;
              } else {
                parser.state = S.TEXT;
              }
              continue;
            case S.CDATA:
              var starti = i - 1;
              while (c && c !== "]") {
                c = charAt(chunk, i++);
                if (c && parser.trackPosition) {
                  parser.position++;
                  if (c === "\n") {
                    parser.line++;
                    parser.column = 0;
                  } else {
                    parser.column++;
                  }
                }
              }
              parser.cdata += chunk.substring(starti, i - 1);
              if (c === "]") {
                parser.state = S.CDATA_ENDING;
              }
              continue;
            case S.CDATA_ENDING:
              if (c === "]") {
                parser.state = S.CDATA_ENDING_2;
              } else {
                parser.cdata += "]" + c;
                parser.state = S.CDATA;
              }
              continue;
            case S.CDATA_ENDING_2:
              if (c === ">") {
                if (parser.cdata) {
                  emitNode(parser, "oncdata", parser.cdata);
                }
                emitNode(parser, "onclosecdata");
                parser.cdata = "";
                parser.state = S.TEXT;
              } else if (c === "]") {
                parser.cdata += "]";
              } else {
                parser.cdata += "]]" + c;
                parser.state = S.CDATA;
              }
              continue;
            case S.PROC_INST:
              if (c === "?") {
                parser.state = S.PROC_INST_ENDING;
              } else if (isWhitespace(c)) {
                parser.state = S.PROC_INST_BODY;
              } else {
                parser.procInstName += c;
              }
              continue;
            case S.PROC_INST_BODY:
              if (!parser.procInstBody && isWhitespace(c)) {
                continue;
              } else if (c === "?") {
                parser.state = S.PROC_INST_ENDING;
              } else {
                parser.procInstBody += c;
              }
              continue;
            case S.PROC_INST_ENDING:
              if (c === ">") {
                const procInstEndData = {
                  name: parser.procInstName,
                  body: parser.procInstBody
                };
                validateXmlDeclarationEncoding(parser, procInstEndData);
                emitNode(parser, "onprocessinginstruction", procInstEndData);
                parser.procInstName = parser.procInstBody = "";
                parser.state = S.TEXT;
              } else {
                parser.procInstBody += "?" + c;
                parser.state = S.PROC_INST_BODY;
              }
              continue;
            case S.OPEN_TAG:
              if (isMatch(nameBody, c)) {
                parser.tagName += c;
              } else {
                newTag(parser);
                if (c === ">") {
                  openTag(parser);
                } else if (c === "/") {
                  parser.state = S.OPEN_TAG_SLASH;
                } else {
                  if (!isWhitespace(c)) {
                    strictFail(parser, "Invalid character in tag name");
                  }
                  parser.state = S.ATTRIB;
                }
              }
              continue;
            case S.OPEN_TAG_SLASH:
              if (c === ">") {
                openTag(parser, true);
                closeTag(parser);
              } else {
                strictFail(
                  parser,
                  "Forward-slash in opening tag not followed by >"
                );
                parser.state = S.ATTRIB;
              }
              continue;
            case S.ATTRIB:
              if (isWhitespace(c)) {
                continue;
              } else if (c === ">") {
                openTag(parser);
              } else if (c === "/") {
                parser.state = S.OPEN_TAG_SLASH;
              } else if (isMatch(nameStart, c)) {
                parser.attribName = c;
                parser.attribValue = "";
                parser.state = S.ATTRIB_NAME;
              } else {
                strictFail(parser, "Invalid attribute name");
              }
              continue;
            case S.ATTRIB_NAME:
              if (c === "=") {
                parser.state = S.ATTRIB_VALUE;
              } else if (c === ">") {
                strictFail(parser, "Attribute without value");
                parser.attribValue = parser.attribName;
                attrib(parser);
                openTag(parser);
              } else if (isWhitespace(c)) {
                parser.state = S.ATTRIB_NAME_SAW_WHITE;
              } else if (isMatch(nameBody, c)) {
                parser.attribName += c;
              } else {
                strictFail(parser, "Invalid attribute name");
              }
              continue;
            case S.ATTRIB_NAME_SAW_WHITE:
              if (c === "=") {
                parser.state = S.ATTRIB_VALUE;
              } else if (isWhitespace(c)) {
                continue;
              } else {
                strictFail(parser, "Attribute without value");
                parser.tag.attributes[parser.attribName] = "";
                parser.attribValue = "";
                emitNode(parser, "onattribute", {
                  name: parser.attribName,
                  value: ""
                });
                parser.attribName = "";
                if (c === ">") {
                  openTag(parser);
                } else if (isMatch(nameStart, c)) {
                  parser.attribName = c;
                  parser.state = S.ATTRIB_NAME;
                } else {
                  strictFail(parser, "Invalid attribute name");
                  parser.state = S.ATTRIB;
                }
              }
              continue;
            case S.ATTRIB_VALUE:
              if (isWhitespace(c)) {
                continue;
              } else if (isQuote(c)) {
                parser.q = c;
                parser.state = S.ATTRIB_VALUE_QUOTED;
              } else {
                if (!parser.opt.unquotedAttributeValues) {
                  error2(parser, "Unquoted attribute value");
                }
                parser.state = S.ATTRIB_VALUE_UNQUOTED;
                parser.attribValue = c;
              }
              continue;
            case S.ATTRIB_VALUE_QUOTED:
              if (c !== parser.q) {
                if (c === "&") {
                  parser.state = S.ATTRIB_VALUE_ENTITY_Q;
                } else {
                  parser.attribValue += c;
                }
                continue;
              }
              attrib(parser);
              parser.q = "";
              parser.state = S.ATTRIB_VALUE_CLOSED;
              continue;
            case S.ATTRIB_VALUE_CLOSED:
              if (isWhitespace(c)) {
                parser.state = S.ATTRIB;
              } else if (c === ">") {
                openTag(parser);
              } else if (c === "/") {
                parser.state = S.OPEN_TAG_SLASH;
              } else if (isMatch(nameStart, c)) {
                strictFail(parser, "No whitespace between attributes");
                parser.attribName = c;
                parser.attribValue = "";
                parser.state = S.ATTRIB_NAME;
              } else {
                strictFail(parser, "Invalid attribute name");
              }
              continue;
            case S.ATTRIB_VALUE_UNQUOTED:
              if (!isAttribEnd(c)) {
                if (c === "&") {
                  parser.state = S.ATTRIB_VALUE_ENTITY_U;
                } else {
                  parser.attribValue += c;
                }
                continue;
              }
              attrib(parser);
              if (c === ">") {
                openTag(parser);
              } else {
                parser.state = S.ATTRIB;
              }
              continue;
            case S.CLOSE_TAG:
              if (!parser.tagName) {
                if (isWhitespace(c)) {
                  continue;
                } else if (notMatch(nameStart, c)) {
                  if (parser.script) {
                    parser.script += "</" + c;
                    parser.state = S.SCRIPT;
                  } else {
                    strictFail(parser, "Invalid tagname in closing tag.");
                  }
                } else {
                  parser.tagName = c;
                }
              } else if (c === ">") {
                closeTag(parser);
              } else if (isMatch(nameBody, c)) {
                parser.tagName += c;
              } else if (parser.script) {
                parser.script += "</" + parser.tagName + c;
                parser.tagName = "";
                parser.state = S.SCRIPT;
              } else {
                if (!isWhitespace(c)) {
                  strictFail(parser, "Invalid tagname in closing tag");
                }
                parser.state = S.CLOSE_TAG_SAW_WHITE;
              }
              continue;
            case S.CLOSE_TAG_SAW_WHITE:
              if (isWhitespace(c)) {
                continue;
              }
              if (c === ">") {
                closeTag(parser);
              } else {
                strictFail(parser, "Invalid characters in closing tag");
              }
              continue;
            case S.TEXT_ENTITY:
            case S.ATTRIB_VALUE_ENTITY_Q:
            case S.ATTRIB_VALUE_ENTITY_U:
              var returnState;
              var buffer;
              switch (parser.state) {
                case S.TEXT_ENTITY:
                  returnState = S.TEXT;
                  buffer = "textNode";
                  break;
                case S.ATTRIB_VALUE_ENTITY_Q:
                  returnState = S.ATTRIB_VALUE_QUOTED;
                  buffer = "attribValue";
                  break;
                case S.ATTRIB_VALUE_ENTITY_U:
                  returnState = S.ATTRIB_VALUE_UNQUOTED;
                  buffer = "attribValue";
                  break;
              }
              if (c === ";") {
                var parsedEntity = parseEntity(parser);
                if (parser.opt.unparsedEntities && !Object.values(sax2.XML_ENTITIES).includes(parsedEntity)) {
                  if ((parser.entityCount += 1) > parser.opt.maxEntityCount) {
                    error2(
                      parser,
                      "Parsed entity count exceeds max entity count"
                    );
                  }
                  if ((parser.entityDepth += 1) > parser.opt.maxEntityDepth) {
                    error2(
                      parser,
                      "Parsed entity depth exceeds max entity depth"
                    );
                  }
                  parser.entity = "";
                  parser.state = returnState;
                  parser.write(parsedEntity);
                  parser.entityDepth -= 1;
                } else {
                  parser[buffer] += parsedEntity;
                  parser.entity = "";
                  parser.state = returnState;
                }
              } else if (isMatch(parser.entity.length ? entityBody : entityStart, c)) {
                parser.entity += c;
              } else {
                strictFail(parser, "Invalid character in entity name");
                parser[buffer] += "&" + parser.entity + c;
                parser.entity = "";
                parser.state = returnState;
              }
              continue;
            default: {
              throw new Error(parser, "Unknown state: " + parser.state);
            }
          }
        }
        if (parser.position >= parser.bufferCheckPosition) {
          checkBufferLength(parser);
        }
        return parser;
      }
      /*! http://mths.be/fromcodepoint v0.1.0 by @mathias */
      if (!String.fromCodePoint) {
        (function() {
          var stringFromCharCode = String.fromCharCode;
          var floor = Math.floor;
          var fromCodePoint = function() {
            var MAX_SIZE = 16384;
            var codeUnits = [];
            var highSurrogate;
            var lowSurrogate;
            var index = -1;
            var length = arguments.length;
            if (!length) {
              return "";
            }
            var result = "";
            while (++index < length) {
              var codePoint = Number(arguments[index]);
              if (!isFinite(codePoint) || // `NaN`, `+Infinity`, or `-Infinity`
              codePoint < 0 || // not a valid Unicode code point
              codePoint > 1114111 || // not a valid Unicode code point
              floor(codePoint) !== codePoint) {
                throw RangeError("Invalid code point: " + codePoint);
              }
              if (codePoint <= 65535) {
                codeUnits.push(codePoint);
              } else {
                codePoint -= 65536;
                highSurrogate = (codePoint >> 10) + 55296;
                lowSurrogate = codePoint % 1024 + 56320;
                codeUnits.push(highSurrogate, lowSurrogate);
              }
              if (index + 1 === length || codeUnits.length > MAX_SIZE) {
                result += stringFromCharCode.apply(null, codeUnits);
                codeUnits.length = 0;
              }
            }
            return result;
          };
          if (Object.defineProperty) {
            Object.defineProperty(String, "fromCodePoint", {
              value: fromCodePoint,
              configurable: true,
              writable: true
            });
          } else {
            String.fromCodePoint = fromCodePoint;
          }
        })();
      }
    })(exports);
  })(sax);
  return sax;
}
var hasRequiredXml;
function requireXml() {
  if (hasRequiredXml) return xml;
  hasRequiredXml = 1;
  Object.defineProperty(xml, "__esModule", { value: true });
  xml.XElement = void 0;
  xml.parseXml = parseXml;
  const sax2 = requireSax();
  const error_1 = requireError();
  class XElement {
    constructor(name) {
      this.name = name;
      this.value = "";
      this.attributes = null;
      this.isCData = false;
      this.elements = null;
      if (!name) {
        throw (0, error_1.newError)("Element name cannot be empty", "ERR_XML_ELEMENT_NAME_EMPTY");
      }
      if (!isValidName(name)) {
        throw (0, error_1.newError)(`Invalid element name: ${name}`, "ERR_XML_ELEMENT_INVALID_NAME");
      }
    }
    attribute(name) {
      const result = this.attributes === null ? null : this.attributes[name];
      if (result == null) {
        throw (0, error_1.newError)(`No attribute "${name}"`, "ERR_XML_MISSED_ATTRIBUTE");
      }
      return result;
    }
    removeAttribute(name) {
      if (this.attributes !== null) {
        delete this.attributes[name];
      }
    }
    element(name, ignoreCase = false, errorIfMissed = null) {
      const result = this.elementOrNull(name, ignoreCase);
      if (result === null) {
        throw (0, error_1.newError)(errorIfMissed || `No element "${name}"`, "ERR_XML_MISSED_ELEMENT");
      }
      return result;
    }
    elementOrNull(name, ignoreCase = false) {
      if (this.elements === null) {
        return null;
      }
      for (const element of this.elements) {
        if (isNameEquals(element, name, ignoreCase)) {
          return element;
        }
      }
      return null;
    }
    getElements(name, ignoreCase = false) {
      if (this.elements === null) {
        return [];
      }
      return this.elements.filter((it) => isNameEquals(it, name, ignoreCase));
    }
    elementValueOrEmpty(name, ignoreCase = false) {
      const element = this.elementOrNull(name, ignoreCase);
      return element === null ? "" : element.value;
    }
  }
  xml.XElement = XElement;
  const NAME_REG_EXP = new RegExp(/^[A-Za-z_][:A-Za-z0-9_-]*$/i);
  function isValidName(name) {
    return NAME_REG_EXP.test(name);
  }
  function isNameEquals(element, name, ignoreCase) {
    const elementName = element.name;
    return elementName === name || ignoreCase === true && elementName.length === name.length && elementName.toLowerCase() === name.toLowerCase();
  }
  function parseXml(data) {
    let rootElement = null;
    const parser = sax2.parser(true, {});
    const elements = [];
    parser.onopentag = (saxElement) => {
      const element = new XElement(saxElement.name);
      element.attributes = saxElement.attributes;
      if (rootElement === null) {
        rootElement = element;
      } else {
        const parent = elements[elements.length - 1];
        if (parent.elements == null) {
          parent.elements = [];
        }
        parent.elements.push(element);
      }
      elements.push(element);
    };
    parser.onclosetag = () => {
      elements.pop();
    };
    parser.ontext = (text) => {
      if (elements.length > 0) {
        elements[elements.length - 1].value = text;
      }
    };
    parser.oncdata = (cdata) => {
      const element = elements[elements.length - 1];
      element.value = cdata;
      element.isCData = true;
    };
    parser.onerror = (err) => {
      throw err;
    };
    parser.write(data);
    return rootElement;
  }
  return xml;
}
var objects = {};
var hasRequiredObjects;
function requireObjects() {
  if (hasRequiredObjects) return objects;
  hasRequiredObjects = 1;
  Object.defineProperty(objects, "__esModule", { value: true });
  objects.mapToObject = mapToObject;
  objects.isValidKey = isValidKey;
  objects.asArray = asArray;
  objects.deepAssign = deepAssign;
  objects.objectToArgs = objectToArgs;
  function mapToObject(map2) {
    const obj = {};
    for (const [key, value] of map2) {
      if (!isValidKey(key)) {
        continue;
      }
      if (value instanceof Map) {
        obj[key] = mapToObject(value);
      } else {
        obj[key] = value;
      }
    }
    return obj;
  }
  function isValidKey(key) {
    const protectedProperties = ["__proto__", "prototype", "constructor"];
    if (protectedProperties.includes(key)) {
      return false;
    }
    return ["string", "number", "symbol", "boolean"].includes(typeof key) || key === null;
  }
  function asArray(v) {
    if (v == null) {
      return [];
    } else if (Array.isArray(v)) {
      return v;
    } else {
      return [v];
    }
  }
  function isObject(x) {
    if (Array.isArray(x)) {
      return false;
    }
    const type2 = typeof x;
    return type2 === "object" || type2 === "function";
  }
  function assignKey(target, from, key) {
    const value = from[key];
    if (value === void 0) {
      return;
    }
    const prevValue = target[key];
    if (prevValue == null || value == null || !isObject(prevValue) || !isObject(value)) {
      if (Array.isArray(prevValue) && Array.isArray(value)) {
        target[key] = Array.from(new Set(prevValue.concat(value)));
      } else {
        target[key] = value;
      }
    } else {
      target[key] = assign(prevValue, value);
    }
  }
  function assign(to, from) {
    if (to !== from) {
      for (const key of Object.getOwnPropertyNames(from)) {
        if (isValidKey(key)) {
          assignKey(to, from, key);
        }
      }
    }
    return to;
  }
  function deepAssign(target, ...objects2) {
    for (const o of objects2) {
      if (o != null) {
        assign(target, o);
      }
    }
    return target;
  }
  const SAFE_FLAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
  const UNSAFE_VALUE_RE = /[\0\r\n]/;
  function objectToArgs(obj) {
    const args = Object.entries(obj).reduce((args2, [name, value]) => {
      if (!isValidKey(name) || value == null) {
        return args2;
      }
      if (!SAFE_FLAG_NAME_RE.test(name)) {
        throw new Error(`objectToArgs: unsafe flag name rejected: ${JSON.stringify(name)}`);
      }
      if (UNSAFE_VALUE_RE.test(value)) {
        throw new Error(`objectToArgs: value for --${name} contains a null byte or newline`);
      }
      return args2.concat([`--${name}`, value]);
    }, []);
    return Object.freeze(args);
  }
  return objects;
}
var hasRequiredOut;
function requireOut() {
  if (hasRequiredOut) return out;
  hasRequiredOut = 1;
  (function(exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CURRENT_APP_PACKAGE_FILE_NAME = exports.CURRENT_APP_INSTALLER_FILE_NAME = exports.objectToArgs = exports.deepAssign = exports.asArray = exports.mapToObject = exports.isValidKey = exports.XElement = exports.parseXml = exports.UUID = exports.parseDn = exports.retry = exports.githubTagPrefix = exports.githubUrl = exports.getS3LikeProviderBaseUrl = exports.ProgressCallbackTransform = exports.MemoLazy = exports.safeStringifyJson = exports.safeGetHeader = exports.parseJson = exports.isSensitiveFieldName = exports.HttpExecutor = exports.hashSensitiveValue = exports.HttpError = exports.DigestTransform = exports.createHttpError = exports.configureRequestUrl = exports.configureRequestOptionsFromUrl = exports.configureRequestOptions = exports.newError = exports.CancellationToken = exports.CancellationError = void 0;
    var CancellationToken_1 = requireCancellationToken();
    Object.defineProperty(exports, "CancellationError", { enumerable: true, get: function() {
      return CancellationToken_1.CancellationError;
    } });
    Object.defineProperty(exports, "CancellationToken", { enumerable: true, get: function() {
      return CancellationToken_1.CancellationToken;
    } });
    var error_1 = requireError();
    Object.defineProperty(exports, "newError", { enumerable: true, get: function() {
      return error_1.newError;
    } });
    var httpExecutor_1 = requireHttpExecutor();
    Object.defineProperty(exports, "configureRequestOptions", { enumerable: true, get: function() {
      return httpExecutor_1.configureRequestOptions;
    } });
    Object.defineProperty(exports, "configureRequestOptionsFromUrl", { enumerable: true, get: function() {
      return httpExecutor_1.configureRequestOptionsFromUrl;
    } });
    Object.defineProperty(exports, "configureRequestUrl", { enumerable: true, get: function() {
      return httpExecutor_1.configureRequestUrl;
    } });
    Object.defineProperty(exports, "createHttpError", { enumerable: true, get: function() {
      return httpExecutor_1.createHttpError;
    } });
    Object.defineProperty(exports, "DigestTransform", { enumerable: true, get: function() {
      return httpExecutor_1.DigestTransform;
    } });
    Object.defineProperty(exports, "HttpError", { enumerable: true, get: function() {
      return httpExecutor_1.HttpError;
    } });
    Object.defineProperty(exports, "hashSensitiveValue", { enumerable: true, get: function() {
      return httpExecutor_1.hashSensitiveValue;
    } });
    Object.defineProperty(exports, "HttpExecutor", { enumerable: true, get: function() {
      return httpExecutor_1.HttpExecutor;
    } });
    Object.defineProperty(exports, "isSensitiveFieldName", { enumerable: true, get: function() {
      return httpExecutor_1.isSensitiveFieldName;
    } });
    Object.defineProperty(exports, "parseJson", { enumerable: true, get: function() {
      return httpExecutor_1.parseJson;
    } });
    Object.defineProperty(exports, "safeGetHeader", { enumerable: true, get: function() {
      return httpExecutor_1.safeGetHeader;
    } });
    Object.defineProperty(exports, "safeStringifyJson", { enumerable: true, get: function() {
      return httpExecutor_1.safeStringifyJson;
    } });
    var MemoLazy_1 = requireMemoLazy();
    Object.defineProperty(exports, "MemoLazy", { enumerable: true, get: function() {
      return MemoLazy_1.MemoLazy;
    } });
    var ProgressCallbackTransform_1 = requireProgressCallbackTransform();
    Object.defineProperty(exports, "ProgressCallbackTransform", { enumerable: true, get: function() {
      return ProgressCallbackTransform_1.ProgressCallbackTransform;
    } });
    var publishOptions_1 = requirePublishOptions();
    Object.defineProperty(exports, "getS3LikeProviderBaseUrl", { enumerable: true, get: function() {
      return publishOptions_1.getS3LikeProviderBaseUrl;
    } });
    Object.defineProperty(exports, "githubUrl", { enumerable: true, get: function() {
      return publishOptions_1.githubUrl;
    } });
    Object.defineProperty(exports, "githubTagPrefix", { enumerable: true, get: function() {
      return publishOptions_1.githubTagPrefix;
    } });
    var retry_1 = requireRetry();
    Object.defineProperty(exports, "retry", { enumerable: true, get: function() {
      return retry_1.retry;
    } });
    var rfc2253Parser_1 = requireRfc2253Parser();
    Object.defineProperty(exports, "parseDn", { enumerable: true, get: function() {
      return rfc2253Parser_1.parseDn;
    } });
    var uuid_1 = requireUuid();
    Object.defineProperty(exports, "UUID", { enumerable: true, get: function() {
      return uuid_1.UUID;
    } });
    var xml_1 = requireXml();
    Object.defineProperty(exports, "parseXml", { enumerable: true, get: function() {
      return xml_1.parseXml;
    } });
    Object.defineProperty(exports, "XElement", { enumerable: true, get: function() {
      return xml_1.XElement;
    } });
    var objects_1 = requireObjects();
    Object.defineProperty(exports, "isValidKey", { enumerable: true, get: function() {
      return objects_1.isValidKey;
    } });
    Object.defineProperty(exports, "mapToObject", { enumerable: true, get: function() {
      return objects_1.mapToObject;
    } });
    Object.defineProperty(exports, "asArray", { enumerable: true, get: function() {
      return objects_1.asArray;
    } });
    Object.defineProperty(exports, "deepAssign", { enumerable: true, get: function() {
      return objects_1.deepAssign;
    } });
    Object.defineProperty(exports, "objectToArgs", { enumerable: true, get: function() {
      return objects_1.objectToArgs;
    } });
    exports.CURRENT_APP_INSTALLER_FILE_NAME = "installer.exe";
    exports.CURRENT_APP_PACKAGE_FILE_NAME = "package.7z";
  })(out);
  return out;
}
var jsYaml = {};
var loader = {};
var common = {};
var hasRequiredCommon;
function requireCommon() {
  if (hasRequiredCommon) return common;
  hasRequiredCommon = 1;
  function isNothing(subject) {
    return typeof subject === "undefined" || subject === null;
  }
  function isObject(subject) {
    return typeof subject === "object" && subject !== null;
  }
  function toArray(sequence) {
    if (Array.isArray(sequence)) return sequence;
    else if (isNothing(sequence)) return [];
    return [sequence];
  }
  function extend(target, source) {
    if (source) {
      const sourceKeys = Object.keys(source);
      for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
        const key = sourceKeys[index];
        target[key] = source[key];
      }
    }
    return target;
  }
  function repeat(string, count) {
    let result = "";
    for (let cycle = 0; cycle < count; cycle += 1) {
      result += string;
    }
    return result;
  }
  function isNegativeZero(number) {
    return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
  }
  common.isNothing = isNothing;
  common.isObject = isObject;
  common.toArray = toArray;
  common.repeat = repeat;
  common.isNegativeZero = isNegativeZero;
  common.extend = extend;
  return common;
}
var exception;
var hasRequiredException;
function requireException() {
  if (hasRequiredException) return exception;
  hasRequiredException = 1;
  function formatError(exception2, compact) {
    let where = "";
    const message = exception2.reason || "(unknown reason)";
    if (!exception2.mark) return message;
    if (exception2.mark.name) {
      where += 'in "' + exception2.mark.name + '" ';
    }
    where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
    if (!compact && exception2.mark.snippet) {
      where += "\n\n" + exception2.mark.snippet;
    }
    return message + " " + where;
  }
  function YAMLException(reason, mark) {
    Error.call(this);
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError(this, false);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error().stack || "";
    }
  }
  YAMLException.prototype = Object.create(Error.prototype);
  YAMLException.prototype.constructor = YAMLException;
  YAMLException.prototype.toString = function toString(compact) {
    return this.name + ": " + formatError(this, compact);
  };
  exception = YAMLException;
  return exception;
}
var snippet;
var hasRequiredSnippet;
function requireSnippet() {
  if (hasRequiredSnippet) return snippet;
  hasRequiredSnippet = 1;
  const common2 = requireCommon();
  function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
    let head = "";
    let tail = "";
    const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
    if (position - lineStart > maxHalfLength) {
      head = " ... ";
      lineStart = position - maxHalfLength + head.length;
    }
    if (lineEnd - position > maxHalfLength) {
      tail = " ...";
      lineEnd = position + maxHalfLength - tail.length;
    }
    return {
      str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
      pos: position - lineStart + head.length
      // relative position
    };
  }
  function padStart(string, max) {
    return common2.repeat(" ", max - string.length) + string;
  }
  function makeSnippet(mark, options) {
    options = Object.create(options || null);
    if (!mark.buffer) return null;
    if (!options.maxLength) options.maxLength = 79;
    if (typeof options.indent !== "number") options.indent = 1;
    if (typeof options.linesBefore !== "number") options.linesBefore = 3;
    if (typeof options.linesAfter !== "number") options.linesAfter = 2;
    const re2 = /\r?\n|\r|\0/g;
    const lineStarts = [0];
    const lineEnds = [];
    let match;
    let foundLineNo = -1;
    while (match = re2.exec(mark.buffer)) {
      lineEnds.push(match.index);
      lineStarts.push(match.index + match[0].length);
      if (mark.position <= match.index && foundLineNo < 0) {
        foundLineNo = lineStarts.length - 2;
      }
    }
    if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
    let result = "";
    const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
    const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
    for (let i = 1; i <= options.linesBefore; i++) {
      if (foundLineNo - i < 0) break;
      const line2 = getLine(
        mark.buffer,
        lineStarts[foundLineNo - i],
        lineEnds[foundLineNo - i],
        mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
        maxLineLength
      );
      result = common2.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
    }
    const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
    result += common2.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
    result += common2.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
    for (let i = 1; i <= options.linesAfter; i++) {
      if (foundLineNo + i >= lineEnds.length) break;
      const line2 = getLine(
        mark.buffer,
        lineStarts[foundLineNo + i],
        lineEnds[foundLineNo + i],
        mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
        maxLineLength
      );
      result += common2.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
    }
    return result.replace(/\n$/, "");
  }
  snippet = makeSnippet;
  return snippet;
}
var type;
var hasRequiredType;
function requireType() {
  if (hasRequiredType) return type;
  hasRequiredType = 1;
  const YAMLException = requireException();
  const TYPE_CONSTRUCTOR_OPTIONS = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ];
  const YAML_NODE_KINDS = [
    "scalar",
    "sequence",
    "mapping"
  ];
  function compileStyleAliases(map2) {
    const result = {};
    if (map2 !== null) {
      Object.keys(map2).forEach(function(style) {
        map2[style].forEach(function(alias) {
          result[String(alias)] = style;
        });
      });
    }
    return result;
  }
  function Type(tag, options) {
    options = options || {};
    Object.keys(options).forEach(function(name) {
      if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
        throw new YAMLException('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
      }
    });
    this.options = options;
    this.tag = tag;
    this.kind = options["kind"] || null;
    this.resolve = options["resolve"] || function() {
      return true;
    };
    this.construct = options["construct"] || function(data) {
      return data;
    };
    this.instanceOf = options["instanceOf"] || null;
    this.predicate = options["predicate"] || null;
    this.represent = options["represent"] || null;
    this.representName = options["representName"] || null;
    this.defaultStyle = options["defaultStyle"] || null;
    this.multi = options["multi"] || false;
    this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
    if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
      throw new YAMLException('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
    }
  }
  type = Type;
  return type;
}
var schema;
var hasRequiredSchema;
function requireSchema() {
  if (hasRequiredSchema) return schema;
  hasRequiredSchema = 1;
  const YAMLException = requireException();
  const Type = requireType();
  function compileList(schema2, name) {
    const result = [];
    schema2[name].forEach(function(currentType) {
      let newIndex = result.length;
      result.forEach(function(previousType, previousIndex) {
        if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
          newIndex = previousIndex;
        }
      });
      result[newIndex] = currentType;
    });
    return result;
  }
  function compileMap() {
    const result = {
      scalar: {},
      sequence: {},
      mapping: {},
      fallback: {},
      multi: {
        scalar: [],
        sequence: [],
        mapping: [],
        fallback: []
      }
    };
    function collectType(type2) {
      if (type2.multi) {
        result.multi[type2.kind].push(type2);
        result.multi["fallback"].push(type2);
      } else {
        result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
      }
    }
    for (let index = 0, length = arguments.length; index < length; index += 1) {
      arguments[index].forEach(collectType);
    }
    return result;
  }
  function Schema(definition) {
    return this.extend(definition);
  }
  Schema.prototype.extend = function extend(definition) {
    let implicit = [];
    let explicit = [];
    if (definition instanceof Type) {
      explicit.push(definition);
    } else if (Array.isArray(definition)) {
      explicit = explicit.concat(definition);
    } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
      if (definition.implicit) implicit = implicit.concat(definition.implicit);
      if (definition.explicit) explicit = explicit.concat(definition.explicit);
    } else {
      throw new YAMLException("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
    }
    implicit.forEach(function(type2) {
      if (!(type2 instanceof Type)) {
        throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
      if (type2.loadKind && type2.loadKind !== "scalar") {
        throw new YAMLException("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      }
      if (type2.multi) {
        throw new YAMLException("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
      }
    });
    explicit.forEach(function(type2) {
      if (!(type2 instanceof Type)) {
        throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
    });
    const result = Object.create(Schema.prototype);
    result.implicit = (this.implicit || []).concat(implicit);
    result.explicit = (this.explicit || []).concat(explicit);
    result.compiledImplicit = compileList(result, "implicit");
    result.compiledExplicit = compileList(result, "explicit");
    result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
    return result;
  };
  schema = Schema;
  return schema;
}
var str;
var hasRequiredStr;
function requireStr() {
  if (hasRequiredStr) return str;
  hasRequiredStr = 1;
  const Type = requireType();
  str = new Type("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: function(data) {
      return data !== null ? data : "";
    }
  });
  return str;
}
var seq;
var hasRequiredSeq;
function requireSeq() {
  if (hasRequiredSeq) return seq;
  hasRequiredSeq = 1;
  const Type = requireType();
  seq = new Type("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: function(data) {
      return data !== null ? data : [];
    }
  });
  return seq;
}
var map;
var hasRequiredMap;
function requireMap() {
  if (hasRequiredMap) return map;
  hasRequiredMap = 1;
  const Type = requireType();
  map = new Type("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: function(data) {
      return data !== null ? data : {};
    }
  });
  return map;
}
var failsafe;
var hasRequiredFailsafe;
function requireFailsafe() {
  if (hasRequiredFailsafe) return failsafe;
  hasRequiredFailsafe = 1;
  const Schema = requireSchema();
  failsafe = new Schema({
    explicit: [
      requireStr(),
      requireSeq(),
      requireMap()
    ]
  });
  return failsafe;
}
var _null;
var hasRequired_null;
function require_null() {
  if (hasRequired_null) return _null;
  hasRequired_null = 1;
  const Type = requireType();
  function resolveYamlNull(data) {
    if (data === null) return true;
    const max = data.length;
    return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
  }
  function constructYamlNull() {
    return null;
  }
  function isNull(object) {
    return object === null;
  }
  _null = new Type("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: resolveYamlNull,
    construct: constructYamlNull,
    predicate: isNull,
    represent: {
      canonical: function() {
        return "~";
      },
      lowercase: function() {
        return "null";
      },
      uppercase: function() {
        return "NULL";
      },
      camelcase: function() {
        return "Null";
      },
      empty: function() {
        return "";
      }
    },
    defaultStyle: "lowercase"
  });
  return _null;
}
var bool;
var hasRequiredBool;
function requireBool() {
  if (hasRequiredBool) return bool;
  hasRequiredBool = 1;
  const Type = requireType();
  function resolveYamlBoolean(data) {
    if (data === null) return false;
    const max = data.length;
    return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
  }
  function constructYamlBoolean(data) {
    return data === "true" || data === "True" || data === "TRUE";
  }
  function isBoolean(object) {
    return Object.prototype.toString.call(object) === "[object Boolean]";
  }
  bool = new Type("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: resolveYamlBoolean,
    construct: constructYamlBoolean,
    predicate: isBoolean,
    represent: {
      lowercase: function(object) {
        return object ? "true" : "false";
      },
      uppercase: function(object) {
        return object ? "TRUE" : "FALSE";
      },
      camelcase: function(object) {
        return object ? "True" : "False";
      }
    },
    defaultStyle: "lowercase"
  });
  return bool;
}
var int;
var hasRequiredInt;
function requireInt() {
  if (hasRequiredInt) return int;
  hasRequiredInt = 1;
  const common2 = requireCommon();
  const Type = requireType();
  function isHexCode(c) {
    return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
  }
  function isOctCode(c) {
    return c >= 48 && c <= 55;
  }
  function isDecCode(c) {
    return c >= 48 && c <= 57;
  }
  function resolveYamlInteger(data) {
    if (data === null) return false;
    const max = data.length;
    let index = 0;
    let hasDigits = false;
    if (!max) return false;
    let ch = data[index];
    if (ch === "-" || ch === "+") {
      ch = data[++index];
    }
    if (ch === "0") {
      if (index + 1 === max) return true;
      ch = data[++index];
      if (ch === "b") {
        index++;
        for (; index < max; index++) {
          ch = data[index];
          if (ch !== "0" && ch !== "1") return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "x") {
        index++;
        for (; index < max; index++) {
          if (!isHexCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "o") {
        index++;
        for (; index < max; index++) {
          if (!isOctCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
    }
    for (; index < max; index++) {
      if (!isDecCode(data.charCodeAt(index))) {
        return false;
      }
      hasDigits = true;
    }
    if (!hasDigits) return false;
    return isFinite(parseYamlInteger(data));
  }
  function parseYamlInteger(data) {
    let value = data;
    let sign = 1;
    let ch = value[0];
    if (ch === "-" || ch === "+") {
      if (ch === "-") sign = -1;
      value = value.slice(1);
      ch = value[0];
    }
    if (value === "0") return 0;
    if (ch === "0") {
      if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
      if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
      if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
    }
    return sign * parseInt(value, 10);
  }
  function constructYamlInteger(data) {
    return parseYamlInteger(data);
  }
  function isInteger(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common2.isNegativeZero(object));
  }
  int = new Type("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: resolveYamlInteger,
    construct: constructYamlInteger,
    predicate: isInteger,
    represent: {
      binary: function(obj) {
        return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
      },
      octal: function(obj) {
        return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
      },
      decimal: function(obj) {
        return obj.toString(10);
      },
      hexadecimal: function(obj) {
        return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
      }
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  });
  return int;
}
var float;
var hasRequiredFloat;
function requireFloat() {
  if (hasRequiredFloat) return float;
  hasRequiredFloat = 1;
  const common2 = requireCommon();
  const Type = requireType();
  const YAML_FLOAT_PATTERN = new RegExp(
    // 2.5e4, 2.5 and integers
    "^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  );
  const YAML_FLOAT_SPECIAL_PATTERN = new RegExp(
    "^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  );
  function resolveYamlFloat(data) {
    if (data === null) return false;
    if (!YAML_FLOAT_PATTERN.test(data)) {
      return false;
    }
    if (isFinite(parseFloat(data, 10))) {
      return true;
    }
    return YAML_FLOAT_SPECIAL_PATTERN.test(data);
  }
  function constructYamlFloat(data) {
    let value = data.toLowerCase();
    const sign = value[0] === "-" ? -1 : 1;
    if ("+-".indexOf(value[0]) >= 0) {
      value = value.slice(1);
    }
    if (value === ".inf") {
      return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else if (value === ".nan") {
      return NaN;
    }
    return sign * parseFloat(value, 10);
  }
  const SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
  function representYamlFloat(object, style) {
    if (isNaN(object)) {
      switch (style) {
        case "lowercase":
          return ".nan";
        case "uppercase":
          return ".NAN";
        case "camelcase":
          return ".NaN";
      }
    } else if (Number.POSITIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return ".inf";
        case "uppercase":
          return ".INF";
        case "camelcase":
          return ".Inf";
      }
    } else if (Number.NEGATIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return "-.inf";
        case "uppercase":
          return "-.INF";
        case "camelcase":
          return "-.Inf";
      }
    } else if (common2.isNegativeZero(object)) {
      return "-0.0";
    }
    const res = object.toString(10);
    return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
  }
  function isFloat(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common2.isNegativeZero(object));
  }
  float = new Type("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: resolveYamlFloat,
    construct: constructYamlFloat,
    predicate: isFloat,
    represent: representYamlFloat,
    defaultStyle: "lowercase"
  });
  return float;
}
var json;
var hasRequiredJson;
function requireJson() {
  if (hasRequiredJson) return json;
  hasRequiredJson = 1;
  json = requireFailsafe().extend({
    implicit: [
      require_null(),
      requireBool(),
      requireInt(),
      requireFloat()
    ]
  });
  return json;
}
var core;
var hasRequiredCore;
function requireCore() {
  if (hasRequiredCore) return core;
  hasRequiredCore = 1;
  core = requireJson();
  return core;
}
var timestamp;
var hasRequiredTimestamp;
function requireTimestamp() {
  if (hasRequiredTimestamp) return timestamp;
  hasRequiredTimestamp = 1;
  const Type = requireType();
  const YAML_DATE_REGEXP = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
  );
  const YAML_TIMESTAMP_REGEXP = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
  );
  function resolveYamlTimestamp(data) {
    if (data === null) return false;
    if (YAML_DATE_REGEXP.exec(data) !== null) return true;
    if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
    return false;
  }
  function constructYamlTimestamp(data) {
    let fraction = 0;
    let delta = null;
    let match = YAML_DATE_REGEXP.exec(data);
    if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
    if (match === null) throw new Error("Date resolve error");
    const year = +match[1];
    const month = +match[2] - 1;
    const day = +match[3];
    if (!match[4]) {
      return new Date(Date.UTC(year, month, day));
    }
    const hour = +match[4];
    const minute = +match[5];
    const second = +match[6];
    if (match[7]) {
      fraction = match[7].slice(0, 3);
      while (fraction.length < 3) {
        fraction += "0";
      }
      fraction = +fraction;
    }
    if (match[9]) {
      const tzHour = +match[10];
      const tzMinute = +(match[11] || 0);
      delta = (tzHour * 60 + tzMinute) * 6e4;
      if (match[9] === "-") delta = -delta;
    }
    const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
    if (delta) date.setTime(date.getTime() - delta);
    return date;
  }
  function representYamlTimestamp(object) {
    return object.toISOString();
  }
  timestamp = new Type("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: resolveYamlTimestamp,
    construct: constructYamlTimestamp,
    instanceOf: Date,
    represent: representYamlTimestamp
  });
  return timestamp;
}
var merge;
var hasRequiredMerge;
function requireMerge() {
  if (hasRequiredMerge) return merge;
  hasRequiredMerge = 1;
  const Type = requireType();
  function resolveYamlMerge(data) {
    return data === "<<" || data === null;
  }
  merge = new Type("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: resolveYamlMerge
  });
  return merge;
}
var binary;
var hasRequiredBinary;
function requireBinary() {
  if (hasRequiredBinary) return binary;
  hasRequiredBinary = 1;
  const Type = requireType();
  const BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
  function resolveYamlBinary(data) {
    if (data === null) return false;
    let bitlen = 0;
    const max = data.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      const code = map2.indexOf(data.charAt(idx));
      if (code > 64) continue;
      if (code < 0) return false;
      bitlen += 6;
    }
    return bitlen % 8 === 0;
  }
  function constructYamlBinary(data) {
    const input = data.replace(/[\r\n=]/g, "");
    const max = input.length;
    const map2 = BASE64_MAP;
    let bits = 0;
    const result = [];
    for (let idx = 0; idx < max; idx++) {
      if (idx % 4 === 0 && idx) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      }
      bits = bits << 6 | map2.indexOf(input.charAt(idx));
    }
    const tailbits = max % 4 * 6;
    if (tailbits === 0) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    } else if (tailbits === 18) {
      result.push(bits >> 10 & 255);
      result.push(bits >> 2 & 255);
    } else if (tailbits === 12) {
      result.push(bits >> 4 & 255);
    }
    return new Uint8Array(result);
  }
  function representYamlBinary(object) {
    let result = "";
    let bits = 0;
    const max = object.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      if (idx % 3 === 0 && idx) {
        result += map2[bits >> 18 & 63];
        result += map2[bits >> 12 & 63];
        result += map2[bits >> 6 & 63];
        result += map2[bits & 63];
      }
      bits = (bits << 8) + object[idx];
    }
    const tail = max % 3;
    if (tail === 0) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    } else if (tail === 2) {
      result += map2[bits >> 10 & 63];
      result += map2[bits >> 4 & 63];
      result += map2[bits << 2 & 63];
      result += map2[64];
    } else if (tail === 1) {
      result += map2[bits >> 2 & 63];
      result += map2[bits << 4 & 63];
      result += map2[64];
      result += map2[64];
    }
    return result;
  }
  function isBinary(obj) {
    return Object.prototype.toString.call(obj) === "[object Uint8Array]";
  }
  binary = new Type("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: resolveYamlBinary,
    construct: constructYamlBinary,
    predicate: isBinary,
    represent: representYamlBinary
  });
  return binary;
}
var omap;
var hasRequiredOmap;
function requireOmap() {
  if (hasRequiredOmap) return omap;
  hasRequiredOmap = 1;
  const Type = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const _toString = Object.prototype.toString;
  function resolveYamlOmap(data) {
    if (data === null) return true;
    const objectKeys = [];
    const object = data;
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      let pairHasKey = false;
      if (_toString.call(pair) !== "[object Object]") return false;
      let pairKey;
      for (pairKey in pair) {
        if (_hasOwnProperty.call(pair, pairKey)) {
          if (!pairHasKey) pairHasKey = true;
          else return false;
        }
      }
      if (!pairHasKey) return false;
      if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
      else return false;
    }
    return true;
  }
  function constructYamlOmap(data) {
    return data !== null ? data : [];
  }
  omap = new Type("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: resolveYamlOmap,
    construct: constructYamlOmap
  });
  return omap;
}
var pairs;
var hasRequiredPairs;
function requirePairs() {
  if (hasRequiredPairs) return pairs;
  hasRequiredPairs = 1;
  const Type = requireType();
  const _toString = Object.prototype.toString;
  function resolveYamlPairs(data) {
    if (data === null) return true;
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      if (_toString.call(pair) !== "[object Object]") return false;
      const keys = Object.keys(pair);
      if (keys.length !== 1) return false;
      result[index] = [keys[0], pair[keys[0]]];
    }
    return true;
  }
  function constructYamlPairs(data) {
    if (data === null) return [];
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      const keys = Object.keys(pair);
      result[index] = [keys[0], pair[keys[0]]];
    }
    return result;
  }
  pairs = new Type("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: resolveYamlPairs,
    construct: constructYamlPairs
  });
  return pairs;
}
var set;
var hasRequiredSet;
function requireSet() {
  if (hasRequiredSet) return set;
  hasRequiredSet = 1;
  const Type = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  function resolveYamlSet(data) {
    if (data === null) return true;
    const object = data;
    for (const key in object) {
      if (_hasOwnProperty.call(object, key)) {
        if (object[key] !== null) return false;
      }
    }
    return true;
  }
  function constructYamlSet(data) {
    return data !== null ? data : {};
  }
  set = new Type("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: resolveYamlSet,
    construct: constructYamlSet
  });
  return set;
}
var _default;
var hasRequired_default;
function require_default() {
  if (hasRequired_default) return _default;
  hasRequired_default = 1;
  _default = requireCore().extend({
    implicit: [
      requireTimestamp(),
      requireMerge()
    ],
    explicit: [
      requireBinary(),
      requireOmap(),
      requirePairs(),
      requireSet()
    ]
  });
  return _default;
}
var hasRequiredLoader;
function requireLoader() {
  if (hasRequiredLoader) return loader;
  hasRequiredLoader = 1;
  const common2 = requireCommon();
  const YAMLException = requireException();
  const makeSnippet = requireSnippet();
  const DEFAULT_SCHEMA = require_default();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CONTEXT_FLOW_IN = 1;
  const CONTEXT_FLOW_OUT = 2;
  const CONTEXT_BLOCK_IN = 3;
  const CONTEXT_BLOCK_OUT = 4;
  const CHOMPING_CLIP = 1;
  const CHOMPING_STRIP = 2;
  const CHOMPING_KEEP = 3;
  const PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  const PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
  const PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
  const PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
  const PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
  function _class(obj) {
    return Object.prototype.toString.call(obj);
  }
  function isEol(c) {
    return c === 10 || c === 13;
  }
  function isWhiteSpace(c) {
    return c === 9 || c === 32;
  }
  function isWsOrEol(c) {
    return c === 9 || c === 32 || c === 10 || c === 13;
  }
  function isFlowIndicator(c) {
    return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
  }
  function fromHexCode(c) {
    if (c >= 48 && c <= 57) {
      return c - 48;
    }
    const lc = c | 32;
    if (lc >= 97 && lc <= 102) {
      return lc - 97 + 10;
    }
    return -1;
  }
  function escapedHexLen(c) {
    if (c === 120) {
      return 2;
    }
    if (c === 117) {
      return 4;
    }
    if (c === 85) {
      return 8;
    }
    return 0;
  }
  function fromDecimalCode(c) {
    if (c >= 48 && c <= 57) {
      return c - 48;
    }
    return -1;
  }
  function simpleEscapeSequence(c) {
    switch (c) {
      case 48:
        return "\0";
      case 97:
        return "\x07";
      case 98:
        return "\b";
      case 116:
        return "	";
      case 9:
        return "	";
      case 110:
        return "\n";
      case 118:
        return "\v";
      case 102:
        return "\f";
      case 114:
        return "\r";
      case 101:
        return "\x1B";
      case 32:
        return " ";
      case 34:
        return '"';
      case 47:
        return "/";
      case 92:
        return "\\";
      case 78:
        return "";
      case 95:
        return " ";
      case 76:
        return "\u2028";
      case 80:
        return "\u2029";
      default:
        return "";
    }
  }
  function charFromCodepoint(c) {
    if (c <= 65535) {
      return String.fromCharCode(c);
    }
    return String.fromCharCode(
      (c - 65536 >> 10) + 55296,
      (c - 65536 & 1023) + 56320
    );
  }
  function setProperty(object, key, value) {
    if (key === "__proto__") {
      Object.defineProperty(object, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
    } else {
      object[key] = value;
    }
  }
  const simpleEscapeCheck = new Array(256);
  const simpleEscapeMap = new Array(256);
  for (let i = 0; i < 256; i++) {
    simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
    simpleEscapeMap[i] = simpleEscapeSequence(i);
  }
  function State(input, options) {
    this.input = input;
    this.filename = options["filename"] || null;
    this.schema = options["schema"] || DEFAULT_SCHEMA;
    this.onWarning = options["onWarning"] || null;
    this.legacy = options["legacy"] || false;
    this.json = options["json"] || false;
    this.listener = options["listener"] || null;
    this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
    this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
    this.implicitTypes = this.schema.compiledImplicit;
    this.typeMap = this.schema.compiledTypeMap;
    this.length = input.length;
    this.position = 0;
    this.line = 0;
    this.lineStart = 0;
    this.lineIndent = 0;
    this.depth = 0;
    this.totalMergeKeys = 0;
    this.firstTabInLine = -1;
    this.documents = [];
    this.anchorMapTransactions = [];
  }
  function generateError(state, message) {
    const mark = {
      name: state.filename,
      buffer: state.input.slice(0, -1),
      // omit trailing \0
      position: state.position,
      line: state.line,
      column: state.position - state.lineStart
    };
    mark.snippet = makeSnippet(mark);
    return new YAMLException(message, mark);
  }
  function throwError(state, message) {
    throw generateError(state, message);
  }
  function throwWarning(state, message) {
    if (state.onWarning) {
      state.onWarning.call(null, generateError(state, message));
    }
  }
  function storeAnchor(state, name, value) {
    const transactions = state.anchorMapTransactions;
    if (transactions.length !== 0) {
      const transaction = transactions[transactions.length - 1];
      if (!_hasOwnProperty.call(transaction, name)) {
        transaction[name] = {
          existed: _hasOwnProperty.call(state.anchorMap, name),
          value: state.anchorMap[name]
        };
      }
    }
    state.anchorMap[name] = value;
  }
  function beginAnchorTransaction(state) {
    state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
  }
  function commitAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const transactions = state.anchorMapTransactions;
    if (transactions.length === 0) return;
    const parent = transactions[transactions.length - 1];
    const names = Object.keys(transaction);
    for (let index = 0, length = names.length; index < length; index += 1) {
      const name = names[index];
      if (!_hasOwnProperty.call(parent, name)) {
        parent[name] = transaction[name];
      }
    }
  }
  function rollbackAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const names = Object.keys(transaction);
    for (let index = names.length - 1; index >= 0; index -= 1) {
      const entry = transaction[names[index]];
      if (entry.existed) {
        state.anchorMap[names[index]] = entry.value;
      } else {
        delete state.anchorMap[names[index]];
      }
    }
  }
  function snapshotState(state) {
    return {
      position: state.position,
      line: state.line,
      lineStart: state.lineStart,
      lineIndent: state.lineIndent,
      firstTabInLine: state.firstTabInLine,
      tag: state.tag,
      anchor: state.anchor,
      kind: state.kind,
      result: state.result
    };
  }
  function restoreState(state, snapshot) {
    state.position = snapshot.position;
    state.line = snapshot.line;
    state.lineStart = snapshot.lineStart;
    state.lineIndent = snapshot.lineIndent;
    state.firstTabInLine = snapshot.firstTabInLine;
    state.tag = snapshot.tag;
    state.anchor = snapshot.anchor;
    state.kind = snapshot.kind;
    state.result = snapshot.result;
  }
  const directiveHandlers = {
    YAML: function handleYamlDirective(state, name, args) {
      if (state.version !== null) {
        throwError(state, "duplication of %YAML directive");
      }
      if (args.length !== 1) {
        throwError(state, "YAML directive accepts exactly one argument");
      }
      const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
      if (match === null) {
        throwError(state, "ill-formed argument of the YAML directive");
      }
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major !== 1) {
        throwError(state, "unacceptable YAML version of the document");
      }
      state.version = args[0];
      state.checkLineBreaks = minor < 2;
      if (minor !== 1 && minor !== 2) {
        throwWarning(state, "unsupported YAML version of the document");
      }
    },
    TAG: function handleTagDirective(state, name, args) {
      let prefix;
      if (args.length !== 2) {
        throwError(state, "TAG directive accepts exactly two arguments");
      }
      const handle = args[0];
      prefix = args[1];
      if (!PATTERN_TAG_HANDLE.test(handle)) {
        throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
      }
      if (_hasOwnProperty.call(state.tagMap, handle)) {
        throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
      }
      if (!PATTERN_TAG_URI.test(prefix)) {
        throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
      }
      try {
        prefix = decodeURIComponent(prefix);
      } catch (err) {
        throwError(state, "tag prefix is malformed: " + prefix);
      }
      state.tagMap[handle] = prefix;
    }
  };
  function captureSegment(state, start, end, checkJson) {
    if (start < end) {
      const _result = state.input.slice(start, end);
      if (checkJson) {
        for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
          const _character = _result.charCodeAt(_position);
          if (!(_character === 9 || _character >= 32 && _character <= 1114111)) {
            throwError(state, "expected valid JSON character");
          }
        }
      } else if (PATTERN_NON_PRINTABLE.test(_result)) {
        throwError(state, "the stream contains non-printable characters");
      }
      state.result += _result;
    }
  }
  function mergeMappings(state, destination, source, overridableKeys) {
    if (!common2.isObject(source)) {
      throwError(state, "cannot merge mappings; the provided source object is unacceptable");
    }
    const sourceKeys = Object.keys(source);
    for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
      const key = sourceKeys[index];
      if (state.maxTotalMergeKeys !== -1 && ++state.totalMergeKeys > state.maxTotalMergeKeys) {
        throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
      }
      if (!_hasOwnProperty.call(destination, key)) {
        setProperty(destination, key, source[key]);
        overridableKeys[key] = true;
      }
    }
  }
  function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
    if (Array.isArray(keyNode)) {
      keyNode = Array.prototype.slice.call(keyNode);
      for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
        if (Array.isArray(keyNode[index])) {
          throwError(state, "nested arrays are not supported inside keys");
        }
        if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
          keyNode[index] = "[object Object]";
        }
      }
    }
    if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
      keyNode = "[object Object]";
    }
    keyNode = String(keyNode);
    if (_result === null) {
      _result = {};
    }
    if (keyTag === "tag:yaml.org,2002:merge") {
      if (Array.isArray(valueNode)) {
        for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
          mergeMappings(state, _result, valueNode[index], overridableKeys);
        }
      } else {
        mergeMappings(state, _result, valueNode, overridableKeys);
      }
    } else {
      if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
        state.line = startLine || state.line;
        state.lineStart = startLineStart || state.lineStart;
        state.position = startPos || state.position;
        throwError(state, "duplicated mapping key");
      }
      setProperty(_result, keyNode, valueNode);
      delete overridableKeys[keyNode];
    }
    return _result;
  }
  function readLineBreak(state) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 10) {
      state.position++;
    } else if (ch === 13) {
      state.position++;
      if (state.input.charCodeAt(state.position) === 10) {
        state.position++;
      }
    } else {
      throwError(state, "a line break is expected");
    }
    state.line += 1;
    state.lineStart = state.position;
    state.firstTabInLine = -1;
  }
  function skipSeparationSpace(state, allowComments, checkIndent) {
    let lineBreaks = 0;
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      while (isWhiteSpace(ch)) {
        if (ch === 9 && state.firstTabInLine === -1) {
          state.firstTabInLine = state.position;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      if (allowComments && ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 10 && ch !== 13 && ch !== 0);
      }
      if (isEol(ch)) {
        readLineBreak(state);
        ch = state.input.charCodeAt(state.position);
        lineBreaks++;
        state.lineIndent = 0;
        while (ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
      } else {
        break;
      }
    }
    if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
      throwWarning(state, "deficient indentation");
    }
    return lineBreaks;
  }
  function testDocumentSeparator(state) {
    let _position = state.position;
    let ch = state.input.charCodeAt(_position);
    if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
      _position += 3;
      ch = state.input.charCodeAt(_position);
      if (ch === 0 || isWsOrEol(ch)) {
        return true;
      }
    }
    return false;
  }
  function writeFoldedLines(state, count) {
    if (count === 1) {
      state.result += " ";
    } else if (count > 1) {
      state.result += common2.repeat("\n", count - 1);
    }
  }
  function readPlainScalar(state, nodeIndent, withinFlowCollection) {
    let captureStart;
    let captureEnd;
    let hasPendingContent;
    let _line;
    let _lineStart;
    let _lineIndent;
    const _kind = state.kind;
    const _result = state.result;
    let ch = state.input.charCodeAt(state.position);
    if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
      return false;
    }
    if (ch === 63 || ch === 45) {
      const following = state.input.charCodeAt(state.position + 1);
      if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
        return false;
      }
    }
    state.kind = "scalar";
    state.result = "";
    captureStart = captureEnd = state.position;
    hasPendingContent = false;
    while (ch !== 0) {
      if (ch === 58) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
          break;
        }
      } else if (ch === 35) {
        const preceding = state.input.charCodeAt(state.position - 1);
        if (isWsOrEol(preceding)) {
          break;
        }
      } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) {
        break;
      } else if (isEol(ch)) {
        _line = state.line;
        _lineStart = state.lineStart;
        _lineIndent = state.lineIndent;
        skipSeparationSpace(state, false, -1);
        if (state.lineIndent >= nodeIndent) {
          hasPendingContent = true;
          ch = state.input.charCodeAt(state.position);
          continue;
        } else {
          state.position = captureEnd;
          state.line = _line;
          state.lineStart = _lineStart;
          state.lineIndent = _lineIndent;
          break;
        }
      }
      if (hasPendingContent) {
        captureSegment(state, captureStart, captureEnd, false);
        writeFoldedLines(state, state.line - _line);
        captureStart = captureEnd = state.position;
        hasPendingContent = false;
      }
      if (!isWhiteSpace(ch)) {
        captureEnd = state.position + 1;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, captureEnd, false);
    if (state.result) {
      return true;
    }
    state.kind = _kind;
    state.result = _result;
    return false;
  }
  function readSingleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 39) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 39) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (ch === 39) {
          captureStart = state.position;
          state.position++;
          captureEnd = state.position;
        } else {
          return true;
        }
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a single quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a single quoted scalar");
  }
  function readDoubleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 34) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 34) {
        captureSegment(state, captureStart, state.position, true);
        state.position++;
        return true;
      } else if (ch === 92) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (isEol(ch)) {
          skipSeparationSpace(state, false, nodeIndent);
        } else if (ch < 256 && simpleEscapeCheck[ch]) {
          state.result += simpleEscapeMap[ch];
          state.position++;
        } else if ((tmp = escapedHexLen(ch)) > 0) {
          let hexLength = tmp;
          let hexResult = 0;
          for (; hexLength > 0; hexLength--) {
            ch = state.input.charCodeAt(++state.position);
            if ((tmp = fromHexCode(ch)) >= 0) {
              hexResult = (hexResult << 4) + tmp;
            } else {
              throwError(state, "expected hexadecimal character");
            }
          }
          state.result += charFromCodepoint(hexResult);
          state.position++;
        } else {
          throwError(state, "unknown escape sequence");
        }
        captureStart = captureEnd = state.position;
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a double quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a double quoted scalar");
  }
  function readFlowCollection(state, nodeIndent) {
    let readNext = true;
    let _line;
    let _lineStart;
    let _pos;
    const _tag = state.tag;
    let _result;
    const _anchor = state.anchor;
    let terminator;
    let isPair;
    let isExplicitPair;
    let isMapping;
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyNode;
    let keyTag;
    let valueNode;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 91) {
      terminator = 93;
      isMapping = false;
      _result = [];
    } else if (ch === 123) {
      terminator = 125;
      isMapping = true;
      _result = {};
    } else {
      return false;
    }
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    ch = state.input.charCodeAt(++state.position);
    while (ch !== 0) {
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === terminator) {
        state.position++;
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = isMapping ? "mapping" : "sequence";
        state.result = _result;
        return true;
      } else if (!readNext) {
        throwError(state, "missed comma between flow collection entries");
      } else if (ch === 44) {
        throwError(state, "expected the node content, but found ','");
      }
      keyTag = keyNode = valueNode = null;
      isPair = isExplicitPair = false;
      if (ch === 63) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following)) {
          isPair = isExplicitPair = true;
          state.position++;
          skipSeparationSpace(state, true, nodeIndent);
        }
      }
      _line = state.line;
      _lineStart = state.lineStart;
      _pos = state.position;
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      keyTag = state.tag;
      keyNode = state.result;
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if ((isExplicitPair || state.line === _line) && ch === 58) {
        isPair = true;
        ch = state.input.charCodeAt(++state.position);
        skipSeparationSpace(state, true, nodeIndent);
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        valueNode = state.result;
      }
      if (isMapping) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
      } else if (isPair) {
        _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
      } else {
        _result.push(keyNode);
      }
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === 44) {
        readNext = true;
        ch = state.input.charCodeAt(++state.position);
      } else {
        readNext = false;
      }
    }
    throwError(state, "unexpected end of the stream within a flow collection");
  }
  function readBlockScalar(state, nodeIndent) {
    let folding;
    let chomping = CHOMPING_CLIP;
    let didReadContent = false;
    let detectedIndent = false;
    let textIndent = nodeIndent;
    let emptyLines = 0;
    let atMoreIndented = false;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 124) {
      folding = false;
    } else if (ch === 62) {
      folding = true;
    } else {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    while (ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
      if (ch === 43 || ch === 45) {
        if (CHOMPING_CLIP === chomping) {
          chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
        } else {
          throwError(state, "repeat of a chomping mode identifier");
        }
      } else if ((tmp = fromDecimalCode(ch)) >= 0) {
        if (tmp === 0) {
          throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
        } else if (!detectedIndent) {
          textIndent = nodeIndent + tmp - 1;
          detectedIndent = true;
        } else {
          throwError(state, "repeat of an indentation width identifier");
        }
      } else {
        break;
      }
    }
    if (isWhiteSpace(ch)) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (isWhiteSpace(ch));
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (!isEol(ch) && ch !== 0);
      }
    }
    while (ch !== 0) {
      readLineBreak(state);
      state.lineIndent = 0;
      ch = state.input.charCodeAt(state.position);
      while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
      if (!detectedIndent && state.lineIndent > textIndent) {
        textIndent = state.lineIndent;
      }
      if (isEol(ch)) {
        emptyLines++;
        continue;
      }
      if (!detectedIndent && textIndent === 0) {
        throwError(state, "missing indentation for block scalar");
      }
      if (state.lineIndent < textIndent) {
        if (chomping === CHOMPING_KEEP) {
          state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        } else if (chomping === CHOMPING_CLIP) {
          if (didReadContent) {
            state.result += "\n";
          }
        }
        break;
      }
      if (folding) {
        if (isWhiteSpace(ch)) {
          atMoreIndented = true;
          state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        } else if (atMoreIndented) {
          atMoreIndented = false;
          state.result += common2.repeat("\n", emptyLines + 1);
        } else if (emptyLines === 0) {
          if (didReadContent) {
            state.result += " ";
          }
        } else {
          state.result += common2.repeat("\n", emptyLines);
        }
      } else {
        state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      }
      didReadContent = true;
      detectedIndent = true;
      emptyLines = 0;
      const captureStart = state.position;
      while (!isEol(ch) && ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, state.position, false);
    }
    return true;
  }
  function readBlockSequence(state, nodeIndent) {
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = [];
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (ch !== 45) {
        break;
      }
      const following = state.input.charCodeAt(state.position + 1);
      if (!isWsOrEol(following)) {
        break;
      }
      detected = true;
      state.position++;
      if (skipSeparationSpace(state, true, -1)) {
        if (state.lineIndent <= nodeIndent) {
          _result.push(null);
          ch = state.input.charCodeAt(state.position);
          continue;
        }
      }
      const _line = state.line;
      composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
      _result.push(state.result);
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a sequence entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "sequence";
      state.result = _result;
      return true;
    }
    return false;
  }
  function readBlockMapping(state, nodeIndent, flowIndent) {
    let allowCompact;
    let _keyLine;
    let _keyLineStart;
    let _keyPos;
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = {};
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyTag = null;
    let keyNode = null;
    let valueNode = null;
    let atExplicitKey = false;
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (!atExplicitKey && state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      const following = state.input.charCodeAt(state.position + 1);
      const _line = state.line;
      if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
        if (ch === 63) {
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = true;
          allowCompact = true;
        } else if (atExplicitKey) {
          atExplicitKey = false;
          allowCompact = true;
        } else {
          throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
        }
        state.position += 1;
        ch = following;
      } else {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
        if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
          break;
        }
        if (state.line === _line) {
          ch = state.input.charCodeAt(state.position);
          while (isWhiteSpace(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 58) {
            ch = state.input.charCodeAt(++state.position);
            if (!isWsOrEol(ch)) {
              throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
            }
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = false;
            allowCompact = false;
            keyTag = state.tag;
            keyNode = state.result;
          } else if (detected) {
            throwError(state, "can not read an implicit mapping pair; a colon is missed");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        } else if (detected) {
          throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      }
      if (state.line === _line || state.lineIndent > nodeIndent) {
        if (atExplicitKey) {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
        }
        if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
          if (atExplicitKey) {
            keyNode = state.result;
          } else {
            valueNode = state.result;
          }
        }
        if (!atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
      }
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a mapping entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (atExplicitKey) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "mapping";
      state.result = _result;
    }
    return detected;
  }
  function readTagProperty(state) {
    let isVerbatim = false;
    let isNamed = false;
    let tagHandle;
    let tagName;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 33) return false;
    if (state.tag !== null) {
      throwError(state, "duplication of a tag property");
    }
    ch = state.input.charCodeAt(++state.position);
    if (ch === 60) {
      isVerbatim = true;
      ch = state.input.charCodeAt(++state.position);
    } else if (ch === 33) {
      isNamed = true;
      tagHandle = "!!";
      ch = state.input.charCodeAt(++state.position);
    } else {
      tagHandle = "!";
    }
    let _position = state.position;
    if (isVerbatim) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 0 && ch !== 62);
      if (state.position < state.length) {
        tagName = state.input.slice(_position, state.position);
        ch = state.input.charCodeAt(++state.position);
      } else {
        throwError(state, "unexpected end of the stream within a verbatim tag");
      }
    } else {
      while (ch !== 0 && !isWsOrEol(ch)) {
        if (ch === 33) {
          if (!isNamed) {
            tagHandle = state.input.slice(_position - 1, state.position + 1);
            if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
              throwError(state, "named tag handle cannot contain such characters");
            }
            isNamed = true;
            _position = state.position + 1;
          } else {
            throwError(state, "tag suffix cannot contain exclamation marks");
          }
        }
        ch = state.input.charCodeAt(++state.position);
      }
      tagName = state.input.slice(_position, state.position);
      if (PATTERN_FLOW_INDICATORS.test(tagName)) {
        throwError(state, "tag suffix cannot contain flow indicator characters");
      }
    }
    if (tagName && !PATTERN_TAG_URI.test(tagName)) {
      throwError(state, "tag name cannot contain such characters: " + tagName);
    }
    try {
      tagName = decodeURIComponent(tagName);
    } catch (err) {
      throwError(state, "tag name is malformed: " + tagName);
    }
    if (isVerbatim) {
      state.tag = tagName;
    } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
      state.tag = state.tagMap[tagHandle] + tagName;
    } else if (tagHandle === "!") {
      state.tag = "!" + tagName;
    } else if (tagHandle === "!!") {
      state.tag = "tag:yaml.org,2002:" + tagName;
    } else {
      throwError(state, 'undeclared tag handle "' + tagHandle + '"');
    }
    return true;
  }
  function readAnchorProperty(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 38) return false;
    if (state.anchor !== null) {
      throwError(state, "duplication of an anchor property");
    }
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an anchor node must contain at least one character");
    }
    state.anchor = state.input.slice(_position, state.position);
    return true;
  }
  function readAlias(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 42) return false;
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an alias node must contain at least one character");
    }
    const alias = state.input.slice(_position, state.position);
    if (!_hasOwnProperty.call(state.anchorMap, alias)) {
      throwError(state, 'unidentified alias "' + alias + '"');
    }
    state.result = state.anchorMap[alias];
    skipSeparationSpace(state, true, -1);
    return true;
  }
  function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
    const fallbackState = snapshotState(state);
    beginAnchorTransaction(state);
    restoreState(state, propertyStart);
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
      commitAnchorTransaction(state);
      return true;
    }
    rollbackAnchorTransaction(state);
    restoreState(state, fallbackState);
    return false;
  }
  function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
    let allowBlockScalars;
    let allowBlockCollections;
    let indentStatus = 1;
    let atNewLine = false;
    let hasContent = false;
    let propertyStart = null;
    let type2;
    let flowIndent;
    let blockIndent;
    if (state.depth >= state.maxDepth) {
      throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
    }
    state.depth += 1;
    if (state.listener !== null) {
      state.listener("open", state);
    }
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
    if (allowToSeek) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      }
    }
    if (indentStatus === 1) {
      while (true) {
        const ch = state.input.charCodeAt(state.position);
        const propertyState = snapshotState(state);
        if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) {
          break;
        }
        if (!readTagProperty(state) && !readAnchorProperty(state)) {
          break;
        }
        if (propertyStart === null) {
          propertyStart = propertyState;
        }
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          allowBlockCollections = allowBlockStyles;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        } else {
          allowBlockCollections = false;
        }
      }
    }
    if (allowBlockCollections) {
      allowBlockCollections = atNewLine || allowCompact;
    }
    if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
      if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
        flowIndent = parentIndent;
      } else {
        flowIndent = parentIndent + 1;
      }
      blockIndent = state.position - state.lineStart;
      if (indentStatus === 1) {
        if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
          hasContent = true;
        } else {
          const ch = state.input.charCodeAt(state.position);
          if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(
            state,
            propertyStart,
            propertyStart.position - propertyStart.lineStart,
            flowIndent
          )) {
            hasContent = true;
          } else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
            hasContent = true;
          } else if (readAlias(state)) {
            hasContent = true;
            if (state.tag !== null || state.anchor !== null) {
              throwError(state, "alias node should not have any properties");
            }
          } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
            hasContent = true;
            if (state.tag === null) {
              state.tag = "?";
            }
          }
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
        }
      } else if (indentStatus === 0) {
        hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
      }
    }
    if (state.tag === null) {
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, state.result);
      }
    } else if (state.tag === "?") {
      if (state.result !== null && state.kind !== "scalar") {
        throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
      }
      for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
        type2 = state.implicitTypes[typeIndex];
        if (type2.resolve(state.result)) {
          state.result = type2.construct(state.result);
          state.tag = type2.tag;
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
          break;
        }
      }
    } else if (state.tag !== "!") {
      if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
        type2 = state.typeMap[state.kind || "fallback"][state.tag];
      } else {
        type2 = null;
        const typeList = state.typeMap.multi[state.kind || "fallback"];
        for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
          if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
            type2 = typeList[typeIndex];
            break;
          }
        }
      }
      if (!type2) {
        throwError(state, "unknown tag !<" + state.tag + ">");
      }
      if (state.result !== null && type2.kind !== state.kind) {
        throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
      }
      if (!type2.resolve(state.result, state.tag)) {
        throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
      } else {
        state.result = type2.construct(state.result, state.tag);
        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result);
        }
      }
    }
    if (state.listener !== null) {
      state.listener("close", state);
    }
    state.depth -= 1;
    return state.tag !== null || state.anchor !== null || hasContent;
  }
  function readDocument(state) {
    const documentStart = state.position;
    let hasDirectives = false;
    let ch;
    state.version = null;
    state.checkLineBreaks = state.legacy;
    state.tagMap = /* @__PURE__ */ Object.create(null);
    state.anchorMap = /* @__PURE__ */ Object.create(null);
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if (state.lineIndent > 0 || ch !== 37) {
        break;
      }
      hasDirectives = true;
      ch = state.input.charCodeAt(++state.position);
      let _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      const directiveName = state.input.slice(_position, state.position);
      const directiveArgs = [];
      if (directiveName.length < 1) {
        throwError(state, "directive name must not be less than one character in length");
      }
      while (ch !== 0) {
        while (isWhiteSpace(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 0 && !isEol(ch));
          break;
        }
        if (isEol(ch)) break;
        _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        directiveArgs.push(state.input.slice(_position, state.position));
      }
      if (ch !== 0) readLineBreak(state);
      if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
        directiveHandlers[directiveName](state, directiveName, directiveArgs);
      } else {
        throwWarning(state, 'unknown document directive "' + directiveName + '"');
      }
    }
    skipSeparationSpace(state, true, -1);
    if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    } else if (hasDirectives) {
      throwError(state, "directives end mark is expected");
    }
    composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
    skipSeparationSpace(state, true, -1);
    if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
      throwWarning(state, "non-ASCII line breaks are interpreted as content");
    }
    state.documents.push(state.result);
    if (state.position === state.lineStart && testDocumentSeparator(state)) {
      if (state.input.charCodeAt(state.position) === 46) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      }
      return;
    }
    if (state.position < state.length - 1) {
      throwError(state, "end of the stream or a document separator is expected");
    }
  }
  function loadDocuments(input, options) {
    input = String(input);
    options = options || {};
    if (input.length !== 0) {
      if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
        input += "\n";
      }
      if (input.charCodeAt(0) === 65279) {
        input = input.slice(1);
      }
    }
    const state = new State(input, options);
    const nullpos = input.indexOf("\0");
    if (nullpos !== -1) {
      state.position = nullpos;
      throwError(state, "null byte is not allowed in input");
    }
    state.input += "\0";
    while (state.input.charCodeAt(state.position) === 32) {
      state.lineIndent += 1;
      state.position += 1;
    }
    while (state.position < state.length - 1) {
      readDocument(state);
    }
    return state.documents;
  }
  function loadAll(input, iterator, options) {
    if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
      options = iterator;
      iterator = null;
    }
    const documents = loadDocuments(input, options);
    if (typeof iterator !== "function") {
      return documents;
    }
    for (let index = 0, length = documents.length; index < length; index += 1) {
      iterator(documents[index]);
    }
  }
  function load(input, options) {
    const documents = loadDocuments(input, options);
    if (documents.length === 0) {
      return void 0;
    } else if (documents.length === 1) {
      return documents[0];
    }
    throw new YAMLException("expected a single document in the stream, but found more");
  }
  loader.loadAll = loadAll;
  loader.load = load;
  return loader;
}
var dumper = {};
var hasRequiredDumper;
function requireDumper() {
  if (hasRequiredDumper) return dumper;
  hasRequiredDumper = 1;
  const common2 = requireCommon();
  const YAMLException = requireException();
  const DEFAULT_SCHEMA = require_default();
  const _toString = Object.prototype.toString;
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CHAR_BOM = 65279;
  const CHAR_TAB = 9;
  const CHAR_LINE_FEED = 10;
  const CHAR_CARRIAGE_RETURN = 13;
  const CHAR_SPACE = 32;
  const CHAR_EXCLAMATION = 33;
  const CHAR_DOUBLE_QUOTE = 34;
  const CHAR_SHARP = 35;
  const CHAR_PERCENT = 37;
  const CHAR_AMPERSAND = 38;
  const CHAR_SINGLE_QUOTE = 39;
  const CHAR_ASTERISK = 42;
  const CHAR_COMMA = 44;
  const CHAR_MINUS = 45;
  const CHAR_COLON = 58;
  const CHAR_EQUALS = 61;
  const CHAR_GREATER_THAN = 62;
  const CHAR_QUESTION = 63;
  const CHAR_COMMERCIAL_AT = 64;
  const CHAR_LEFT_SQUARE_BRACKET = 91;
  const CHAR_RIGHT_SQUARE_BRACKET = 93;
  const CHAR_GRAVE_ACCENT = 96;
  const CHAR_LEFT_CURLY_BRACKET = 123;
  const CHAR_VERTICAL_LINE = 124;
  const CHAR_RIGHT_CURLY_BRACKET = 125;
  const ESCAPE_SEQUENCES = {};
  ESCAPE_SEQUENCES[0] = "\\0";
  ESCAPE_SEQUENCES[7] = "\\a";
  ESCAPE_SEQUENCES[8] = "\\b";
  ESCAPE_SEQUENCES[9] = "\\t";
  ESCAPE_SEQUENCES[10] = "\\n";
  ESCAPE_SEQUENCES[11] = "\\v";
  ESCAPE_SEQUENCES[12] = "\\f";
  ESCAPE_SEQUENCES[13] = "\\r";
  ESCAPE_SEQUENCES[27] = "\\e";
  ESCAPE_SEQUENCES[34] = '\\"';
  ESCAPE_SEQUENCES[92] = "\\\\";
  ESCAPE_SEQUENCES[133] = "\\N";
  ESCAPE_SEQUENCES[160] = "\\_";
  ESCAPE_SEQUENCES[8232] = "\\L";
  ESCAPE_SEQUENCES[8233] = "\\P";
  const DEPRECATED_BOOLEANS_SYNTAX = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ];
  const DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  function compileStyleMap(schema2, map2) {
    if (map2 === null) return {};
    const result = {};
    const keys = Object.keys(map2);
    for (let index = 0, length = keys.length; index < length; index += 1) {
      let tag = keys[index];
      let style = String(map2[tag]);
      if (tag.slice(0, 2) === "!!") {
        tag = "tag:yaml.org,2002:" + tag.slice(2);
      }
      const type2 = schema2.compiledTypeMap["fallback"][tag];
      if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
        style = type2.styleAliases[style];
      }
      result[tag] = style;
    }
    return result;
  }
  function encodeHex(character) {
    let handle;
    let length;
    const string = character.toString(16).toUpperCase();
    if (character <= 255) {
      handle = "x";
      length = 2;
    } else if (character <= 65535) {
      handle = "u";
      length = 4;
    } else if (character <= 4294967295) {
      handle = "U";
      length = 8;
    } else {
      throw new YAMLException("code point within a string may not be greater than 0xFFFFFFFF");
    }
    return "\\" + handle + common2.repeat("0", length - string.length) + string;
  }
  const QUOTING_TYPE_SINGLE = 1;
  const QUOTING_TYPE_DOUBLE = 2;
  function State(options) {
    this.schema = options["schema"] || DEFAULT_SCHEMA;
    this.indent = Math.max(1, options["indent"] || 2);
    this.noArrayIndent = options["noArrayIndent"] || false;
    this.skipInvalid = options["skipInvalid"] || false;
    this.flowLevel = common2.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
    this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
    this.sortKeys = options["sortKeys"] || false;
    this.lineWidth = options["lineWidth"] || 80;
    this.noRefs = options["noRefs"] || false;
    this.noCompatMode = options["noCompatMode"] || false;
    this.condenseFlow = options["condenseFlow"] || false;
    this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
    this.forceQuotes = options["forceQuotes"] || false;
    this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
    this.implicitTypes = this.schema.compiledImplicit;
    this.explicitTypes = this.schema.compiledExplicit;
    this.tag = null;
    this.result = "";
    this.duplicates = [];
    this.usedDuplicates = null;
  }
  function indentString(string, spaces) {
    const ind = common2.repeat(" ", spaces);
    let position = 0;
    let result = "";
    const length = string.length;
    while (position < length) {
      let line;
      const next = string.indexOf("\n", position);
      if (next === -1) {
        line = string.slice(position);
        position = length;
      } else {
        line = string.slice(position, next + 1);
        position = next + 1;
      }
      if (line.length && line !== "\n") result += ind;
      result += line;
    }
    return result;
  }
  function generateNextLine(state, level) {
    return "\n" + common2.repeat(" ", state.indent * level);
  }
  function testImplicitResolving(state, str2) {
    for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
      const type2 = state.implicitTypes[index];
      if (type2.resolve(str2)) {
        return true;
      }
    }
    return false;
  }
  function isWhitespace(c) {
    return c === CHAR_SPACE || c === CHAR_TAB;
  }
  function isPrintable(c) {
    return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
  }
  function isNsCharOrWhitespace(c) {
    return isPrintable(c) && c !== CHAR_BOM && // - b-char
    c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
  }
  function isPlainSafe(c, prev, inblock) {
    const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
    const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
    return (
      // ns-plain-safe
      (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && // - c-flow-indicator
      c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && // ns-plain-char
      c !== CHAR_SHARP && // false on '#'
      !(prev === CHAR_COLON && !cIsNsChar) || // false on ': '
      isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || // change to true on '[^ ]#'
      prev === CHAR_COLON && cIsNsChar
    );
  }
  function isPlainSafeFirst(c) {
    return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && // - s-white
    // - (c-indicator ::=
    // “-” | “?” | “:” | “,” | “[” | “]” | “{” | “}”
    c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && // | “#” | “&” | “*” | “!” | “|” | “=” | “>” | “'” | “"”
    c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && // | “%” | “@” | “`”)
    c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
  }
  function isPlainSafeLast(c) {
    return !isWhitespace(c) && c !== CHAR_COLON;
  }
  function codePointAt(string, pos) {
    const first = string.charCodeAt(pos);
    let second;
    if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
      second = string.charCodeAt(pos + 1);
      if (second >= 56320 && second <= 57343) {
        return (first - 55296) * 1024 + second - 56320 + 65536;
      }
    }
    return first;
  }
  function needIndentIndicator(string) {
    const leadingSpaceRe = /^\n* /;
    return leadingSpaceRe.test(string);
  }
  const STYLE_PLAIN = 1;
  const STYLE_SINGLE = 2;
  const STYLE_LITERAL = 3;
  const STYLE_FOLDED = 4;
  const STYLE_DOUBLE = 5;
  function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
    let i;
    let char = 0;
    let prevChar = null;
    let hasLineBreak = false;
    let hasFoldableLine = false;
    const shouldTrackWidth = lineWidth !== -1;
    let previousLineBreak = -1;
    let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
    if (singleLineOnly || forceQuotes) {
      for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
    } else {
      for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (char === CHAR_LINE_FEED) {
          hasLineBreak = true;
          if (shouldTrackWidth) {
            hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
            i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
            previousLineBreak = i;
          }
        } else if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
      hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
    }
    if (!hasLineBreak && !hasFoldableLine) {
      if (plain && !forceQuotes && !testAmbiguousType(string)) {
        return STYLE_PLAIN;
      }
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    if (indentPerLevel > 9 && needIndentIndicator(string)) {
      return STYLE_DOUBLE;
    }
    if (!forceQuotes) {
      return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  function writeScalar(state, string, level, iskey, inblock) {
    state.dump = (function() {
      if (string.length === 0) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
      }
      if (!state.noCompatMode) {
        if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
        }
      }
      const indent = state.indent * Math.max(1, level);
      const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
      const singleLineOnly = iskey || // No block styles in flow mode.
      state.flowLevel > -1 && level >= state.flowLevel;
      function testAmbiguity(string2) {
        return testImplicitResolving(state, string2);
      }
      switch (chooseScalarStyle(
        string,
        singleLineOnly,
        state.indent,
        lineWidth,
        testAmbiguity,
        state.quotingType,
        state.forceQuotes && !iskey,
        inblock
      )) {
        case STYLE_PLAIN:
          return string;
        case STYLE_SINGLE:
          return "'" + string.replace(/'/g, "''") + "'";
        case STYLE_LITERAL:
          return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
        case STYLE_FOLDED:
          return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
        case STYLE_DOUBLE:
          return '"' + escapeString(string) + '"';
        default:
          throw new YAMLException("impossible error: invalid scalar style");
      }
    })();
  }
  function blockHeader(string, indentPerLevel) {
    const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
    const clip = string[string.length - 1] === "\n";
    const keep = clip && (string[string.length - 2] === "\n" || string === "\n");
    const chomp = keep ? "+" : clip ? "" : "-";
    return indentIndicator + chomp + "\n";
  }
  function dropEndingNewline(string) {
    return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
  }
  function foldString(string, width) {
    const lineRe = /(\n+)([^\n]*)/g;
    let result = (function() {
      let nextLF = string.indexOf("\n");
      nextLF = nextLF !== -1 ? nextLF : string.length;
      lineRe.lastIndex = nextLF;
      return foldLine(string.slice(0, nextLF), width);
    })();
    let prevMoreIndented = string[0] === "\n" || string[0] === " ";
    let moreIndented;
    let match;
    while (match = lineRe.exec(string)) {
      const prefix = match[1];
      const line = match[2];
      moreIndented = line[0] === " ";
      result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
      prevMoreIndented = moreIndented;
    }
    return result;
  }
  function foldLine(line, width) {
    if (line === "" || line[0] === " ") return line;
    const breakRe = / [^ ]/g;
    let match;
    let start = 0;
    let end;
    let curr = 0;
    let next = 0;
    let result = "";
    while (match = breakRe.exec(line)) {
      next = match.index;
      if (next - start > width) {
        end = curr > start ? curr : next;
        result += "\n" + line.slice(start, end);
        start = end + 1;
      }
      curr = next;
    }
    result += "\n";
    if (line.length - start > width && curr > start) {
      result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
    } else {
      result += line.slice(start);
    }
    return result.slice(1);
  }
  function escapeString(string) {
    let result = "";
    let char = 0;
    for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      const escapeSeq = ESCAPE_SEQUENCES[char];
      if (!escapeSeq && isPrintable(char)) {
        result += string[i];
        if (char >= 65536) result += string[i + 1];
      } else {
        result += escapeSeq || encodeHex(char);
      }
    }
    return result;
  }
  function writeFlowSequence(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length; index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
        if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = "[" + _result + "]";
  }
  function writeBlockSequence(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length; index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
        if (!compact || _result !== "") {
          _result += generateNextLine(state, level);
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          _result += "-";
        } else {
          _result += "- ";
        }
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = _result || "[]";
  }
  function writeFlowMapping(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (_result !== "") pairBuffer += ", ";
      if (state.condenseFlow) pairBuffer += '"';
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level, objectKey, false, false)) {
        continue;
      }
      if (state.dump.length > 1024) pairBuffer += "? ";
      pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
      if (!writeNode(state, level, objectValue, false, false)) {
        continue;
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = "{" + _result + "}";
  }
  function writeBlockMapping(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    if (state.sortKeys === true) {
      objectKeyList.sort();
    } else if (typeof state.sortKeys === "function") {
      objectKeyList.sort(state.sortKeys);
    } else if (state.sortKeys) {
      throw new YAMLException("sortKeys must be a boolean or a function");
    }
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (!compact || _result !== "") {
        pairBuffer += generateNextLine(state, level);
      }
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level + 1, objectKey, true, true, true)) {
        continue;
      }
      const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
      if (explicitPair) {
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += "?";
        } else {
          pairBuffer += "? ";
        }
      }
      pairBuffer += state.dump;
      if (explicitPair) {
        pairBuffer += generateNextLine(state, level);
      }
      if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
        continue;
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += ":";
      } else {
        pairBuffer += ": ";
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = _result || "{}";
  }
  function detectType(state, object, explicit) {
    const typeList = explicit ? state.explicitTypes : state.implicitTypes;
    for (let index = 0, length = typeList.length; index < length; index += 1) {
      const type2 = typeList[index];
      if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
        if (explicit) {
          if (type2.multi && type2.representName) {
            state.tag = type2.representName(object);
          } else {
            state.tag = type2.tag;
          }
        } else {
          state.tag = "?";
        }
        if (type2.represent) {
          const style = state.styleMap[type2.tag] || type2.defaultStyle;
          let _result;
          if (_toString.call(type2.represent) === "[object Function]") {
            _result = type2.represent(object, style);
          } else if (_hasOwnProperty.call(type2.represent, style)) {
            _result = type2.represent[style](object, style);
          } else {
            throw new YAMLException("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
          }
          state.dump = _result;
        }
        return true;
      }
    }
    return false;
  }
  function writeNode(state, level, object, block, compact, iskey, isblockseq) {
    state.tag = null;
    state.dump = object;
    if (!detectType(state, object, false)) {
      detectType(state, object, true);
    }
    const type2 = _toString.call(state.dump);
    const inblock = block;
    if (block) {
      block = state.flowLevel < 0 || state.flowLevel > level;
    }
    const objectOrArray = type2 === "[object Object]" || type2 === "[object Array]";
    let duplicateIndex;
    let duplicate;
    if (objectOrArray) {
      duplicateIndex = state.duplicates.indexOf(object);
      duplicate = duplicateIndex !== -1;
    }
    if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
      compact = false;
    }
    if (duplicate && state.usedDuplicates[duplicateIndex]) {
      state.dump = "*ref_" + duplicateIndex;
    } else {
      if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
        state.usedDuplicates[duplicateIndex] = true;
      }
      if (type2 === "[object Object]") {
        if (block && Object.keys(state.dump).length !== 0) {
          writeBlockMapping(state, level, state.dump, compact);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowMapping(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object Array]") {
        if (block && state.dump.length !== 0) {
          if (state.noArrayIndent && !isblockseq && level > 0) {
            writeBlockSequence(state, level - 1, state.dump, compact);
          } else {
            writeBlockSequence(state, level, state.dump, compact);
          }
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowSequence(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object String]") {
        if (state.tag !== "?") {
          writeScalar(state, state.dump, level, iskey, inblock);
        }
      } else if (type2 === "[object Undefined]") {
        return false;
      } else {
        if (state.skipInvalid) return false;
        throw new YAMLException("unacceptable kind of an object to dump " + type2);
      }
      if (state.tag !== null && state.tag !== "?") {
        let tagStr = encodeURI(
          state.tag[0] === "!" ? state.tag.slice(1) : state.tag
        ).replace(/!/g, "%21");
        if (state.tag[0] === "!") {
          tagStr = "!" + tagStr;
        } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
          tagStr = "!!" + tagStr.slice(18);
        } else {
          tagStr = "!<" + tagStr + ">";
        }
        state.dump = tagStr + " " + state.dump;
      }
    }
    return true;
  }
  function getDuplicateReferences(object, state) {
    const objects2 = [];
    const duplicatesIndexes = [];
    inspectNode(object, objects2, duplicatesIndexes);
    const length = duplicatesIndexes.length;
    for (let index = 0; index < length; index += 1) {
      state.duplicates.push(objects2[duplicatesIndexes[index]]);
    }
    state.usedDuplicates = new Array(length);
  }
  function inspectNode(object, objects2, duplicatesIndexes) {
    if (object !== null && typeof object === "object") {
      const index = objects2.indexOf(object);
      if (index !== -1) {
        if (duplicatesIndexes.indexOf(index) === -1) {
          duplicatesIndexes.push(index);
        }
      } else {
        objects2.push(object);
        if (Array.isArray(object)) {
          for (let i = 0, length = object.length; i < length; i += 1) {
            inspectNode(object[i], objects2, duplicatesIndexes);
          }
        } else {
          const objectKeyList = Object.keys(object);
          for (let i = 0, length = objectKeyList.length; i < length; i += 1) {
            inspectNode(object[objectKeyList[i]], objects2, duplicatesIndexes);
          }
        }
      }
    }
  }
  function dump(input, options) {
    options = options || {};
    const state = new State(options);
    if (!state.noRefs) getDuplicateReferences(input, state);
    let value = input;
    if (state.replacer) {
      value = state.replacer.call({ "": value }, "", value);
    }
    if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
    return "";
  }
  dumper.dump = dump;
  return dumper;
}
var hasRequiredJsYaml;
function requireJsYaml() {
  if (hasRequiredJsYaml) return jsYaml;
  hasRequiredJsYaml = 1;
  const loader2 = requireLoader();
  const dumper2 = requireDumper();
  function renamed(from, to) {
    return function() {
      throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
    };
  }
  jsYaml.Type = requireType();
  jsYaml.Schema = requireSchema();
  jsYaml.FAILSAFE_SCHEMA = requireFailsafe();
  jsYaml.JSON_SCHEMA = requireJson();
  jsYaml.CORE_SCHEMA = requireCore();
  jsYaml.DEFAULT_SCHEMA = require_default();
  jsYaml.load = loader2.load;
  jsYaml.loadAll = loader2.loadAll;
  jsYaml.dump = dumper2.dump;
  jsYaml.YAMLException = requireException();
  jsYaml.types = {
    binary: requireBinary(),
    float: requireFloat(),
    map: requireMap(),
    null: require_null(),
    pairs: requirePairs(),
    set: requireSet(),
    timestamp: requireTimestamp(),
    bool: requireBool(),
    int: requireInt(),
    merge: requireMerge(),
    omap: requireOmap(),
    seq: requireSeq(),
    str: requireStr()
  };
  jsYaml.safeLoad = renamed("safeLoad", "load");
  jsYaml.safeLoadAll = renamed("safeLoadAll", "loadAll");
  jsYaml.safeDump = renamed("safeDump", "dump");
  return jsYaml;
}
var main = {};
var hasRequiredMain$1;
function requireMain$1() {
  if (hasRequiredMain$1) return main;
  hasRequiredMain$1 = 1;
  Object.defineProperty(main, "__esModule", { value: true });
  main.Lazy = void 0;
  class Lazy {
    constructor(creator) {
      this._value = null;
      this.creator = creator;
    }
    get hasValue() {
      return this.creator == null;
    }
    get value() {
      if (this.creator == null) {
        return this._value;
      }
      const result = this.creator();
      this.value = result;
      return result;
    }
    set value(value) {
      this._value = value;
      this.creator = null;
    }
  }
  main.Lazy = Lazy;
  return main;
}
var re = { exports: {} };
var constants;
var hasRequiredConstants;
function requireConstants() {
  if (hasRequiredConstants) return constants;
  hasRequiredConstants = 1;
  const SEMVER_SPEC_VERSION = "2.0.0";
  const MAX_LENGTH = 256;
  const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
  9007199254740991;
  const MAX_SAFE_COMPONENT_LENGTH = 16;
  const MAX_SAFE_BUILD_LENGTH = MAX_LENGTH - 6;
  const RELEASE_TYPES = [
    "major",
    "premajor",
    "minor",
    "preminor",
    "patch",
    "prepatch",
    "prerelease"
  ];
  constants = {
    MAX_LENGTH,
    MAX_SAFE_COMPONENT_LENGTH,
    MAX_SAFE_BUILD_LENGTH,
    MAX_SAFE_INTEGER,
    RELEASE_TYPES,
    SEMVER_SPEC_VERSION,
    FLAG_INCLUDE_PRERELEASE: 1,
    FLAG_LOOSE: 2
  };
  return constants;
}
var debug_1;
var hasRequiredDebug;
function requireDebug() {
  if (hasRequiredDebug) return debug_1;
  hasRequiredDebug = 1;
  const debug = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
  };
  debug_1 = debug;
  return debug_1;
}
var hasRequiredRe;
function requireRe() {
  if (hasRequiredRe) return re.exports;
  hasRequiredRe = 1;
  (function(module, exports) {
    const {
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_LENGTH
    } = requireConstants();
    const debug = requireDebug();
    exports = module.exports = {};
    const re2 = exports.re = [];
    const safeRe = exports.safeRe = [];
    const src2 = exports.src = [];
    const safeSrc = exports.safeSrc = [];
    const t = exports.t = {};
    let R = 0;
    const LETTERDASHNUMBER = "[a-zA-Z0-9-]";
    const safeRegexReplacements = [
      ["\\s", 1],
      ["\\d", MAX_LENGTH],
      [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
    ];
    const makeSafeRegex = (value) => {
      for (const [token, max] of safeRegexReplacements) {
        value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
      }
      return value;
    };
    const createToken = (name, value, isGlobal) => {
      const safe = makeSafeRegex(value);
      const index = R++;
      debug(name, index, value);
      t[name] = index;
      src2[index] = value;
      safeSrc[index] = safe;
      re2[index] = new RegExp(value, isGlobal ? "g" : void 0);
      safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
    };
    createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
    createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
    createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
    createToken("MAINVERSION", `(${src2[t.NUMERICIDENTIFIER]})\\.(${src2[t.NUMERICIDENTIFIER]})\\.(${src2[t.NUMERICIDENTIFIER]})`);
    createToken("MAINVERSIONLOOSE", `(${src2[t.NUMERICIDENTIFIERLOOSE]})\\.(${src2[t.NUMERICIDENTIFIERLOOSE]})\\.(${src2[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASEIDENTIFIER", `(?:${src2[t.NONNUMERICIDENTIFIER]}|${src2[t.NUMERICIDENTIFIER]})`);
    createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src2[t.NONNUMERICIDENTIFIER]}|${src2[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASE", `(?:-(${src2[t.PRERELEASEIDENTIFIER]}(?:\\.${src2[t.PRERELEASEIDENTIFIER]})*))`);
    createToken("PRERELEASELOOSE", `(?:-?(${src2[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src2[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
    createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
    createToken("BUILD", `(?:\\+(${src2[t.BUILDIDENTIFIER]}(?:\\.${src2[t.BUILDIDENTIFIER]})*))`);
    createToken("FULLPLAIN", `v?${src2[t.MAINVERSION]}${src2[t.PRERELEASE]}?${src2[t.BUILD]}?`);
    createToken("FULL", `^${src2[t.FULLPLAIN]}$`);
    createToken("LOOSEPLAIN", `[v=\\s]*${src2[t.MAINVERSIONLOOSE]}${src2[t.PRERELEASELOOSE]}?${src2[t.BUILD]}?`);
    createToken("LOOSE", `^${src2[t.LOOSEPLAIN]}$`);
    createToken("GTLT", "((?:<|>)?=?)");
    createToken("XRANGEIDENTIFIERLOOSE", `${src2[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
    createToken("XRANGEIDENTIFIER", `${src2[t.NUMERICIDENTIFIER]}|x|X|\\*`);
    createToken("XRANGEPLAIN", `[v=\\s]*(${src2[t.XRANGEIDENTIFIER]})(?:\\.(${src2[t.XRANGEIDENTIFIER]})(?:\\.(${src2[t.XRANGEIDENTIFIER]})(?:${src2[t.PRERELEASE]})?${src2[t.BUILD]}?)?)?`);
    createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src2[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src2[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src2[t.XRANGEIDENTIFIERLOOSE]})(?:${src2[t.PRERELEASELOOSE]})?${src2[t.BUILD]}?)?)?`);
    createToken("XRANGE", `^${src2[t.GTLT]}\\s*${src2[t.XRANGEPLAIN]}$`);
    createToken("XRANGELOOSE", `^${src2[t.GTLT]}\\s*${src2[t.XRANGEPLAINLOOSE]}$`);
    createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
    createToken("COERCE", `${src2[t.COERCEPLAIN]}(?:$|[^\\d])`);
    createToken("COERCEFULL", src2[t.COERCEPLAIN] + `(?:${src2[t.PRERELEASE]})?(?:${src2[t.BUILD]})?(?:$|[^\\d])`);
    createToken("COERCERTL", src2[t.COERCE], true);
    createToken("COERCERTLFULL", src2[t.COERCEFULL], true);
    createToken("LONETILDE", "(?:~>?)");
    createToken("TILDETRIM", `(\\s*)${src2[t.LONETILDE]}\\s+`, true);
    exports.tildeTrimReplace = "$1~";
    createToken("TILDE", `^${src2[t.LONETILDE]}${src2[t.XRANGEPLAIN]}$`);
    createToken("TILDELOOSE", `^${src2[t.LONETILDE]}${src2[t.XRANGEPLAINLOOSE]}$`);
    createToken("LONECARET", "(?:\\^)");
    createToken("CARETTRIM", `(\\s*)${src2[t.LONECARET]}\\s+`, true);
    exports.caretTrimReplace = "$1^";
    createToken("CARET", `^${src2[t.LONECARET]}${src2[t.XRANGEPLAIN]}$`);
    createToken("CARETLOOSE", `^${src2[t.LONECARET]}${src2[t.XRANGEPLAINLOOSE]}$`);
    createToken("COMPARATORLOOSE", `^${src2[t.GTLT]}\\s*(${src2[t.LOOSEPLAIN]})$|^$`);
    createToken("COMPARATOR", `^${src2[t.GTLT]}\\s*(${src2[t.FULLPLAIN]})$|^$`);
    createToken("COMPARATORTRIM", `(\\s*)${src2[t.GTLT]}\\s*(${src2[t.LOOSEPLAIN]}|${src2[t.XRANGEPLAIN]})`, true);
    exports.comparatorTrimReplace = "$1$2$3";
    createToken("HYPHENRANGE", `^\\s*(${src2[t.XRANGEPLAIN]})\\s+-\\s+(${src2[t.XRANGEPLAIN]})\\s*$`);
    createToken("HYPHENRANGELOOSE", `^\\s*(${src2[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src2[t.XRANGEPLAINLOOSE]})\\s*$`);
    createToken("STAR", "(<|>)?=?\\s*\\*");
    createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
    createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  })(re, re.exports);
  return re.exports;
}
var parseOptions_1;
var hasRequiredParseOptions;
function requireParseOptions() {
  if (hasRequiredParseOptions) return parseOptions_1;
  hasRequiredParseOptions = 1;
  const looseOption = Object.freeze({ loose: true });
  const emptyOpts = Object.freeze({});
  const parseOptions = (options) => {
    if (!options) {
      return emptyOpts;
    }
    if (typeof options !== "object") {
      return looseOption;
    }
    return options;
  };
  parseOptions_1 = parseOptions;
  return parseOptions_1;
}
var identifiers;
var hasRequiredIdentifiers;
function requireIdentifiers() {
  if (hasRequiredIdentifiers) return identifiers;
  hasRequiredIdentifiers = 1;
  const numeric = /^[0-9]+$/;
  const compareIdentifiers = (a, b) => {
    if (typeof a === "number" && typeof b === "number") {
      return a === b ? 0 : a < b ? -1 : 1;
    }
    const anum = numeric.test(a);
    const bnum = numeric.test(b);
    if (anum && bnum) {
      a = +a;
      b = +b;
    }
    return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
  };
  const rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
  identifiers = {
    compareIdentifiers,
    rcompareIdentifiers
  };
  return identifiers;
}
var semver$1;
var hasRequiredSemver$1;
function requireSemver$1() {
  if (hasRequiredSemver$1) return semver$1;
  hasRequiredSemver$1 = 1;
  const debug = requireDebug();
  const { MAX_LENGTH, MAX_SAFE_INTEGER } = requireConstants();
  const { safeRe: re2, t } = requireRe();
  const parseOptions = requireParseOptions();
  const { compareIdentifiers } = requireIdentifiers();
  class SemVer {
    constructor(version, options) {
      options = parseOptions(options);
      if (version instanceof SemVer) {
        if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) {
          return version;
        } else {
          version = version.version;
        }
      } else if (typeof version !== "string") {
        throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
      }
      if (version.length > MAX_LENGTH) {
        throw new TypeError(
          `version is longer than ${MAX_LENGTH} characters`
        );
      }
      debug("SemVer", version, options);
      this.options = options;
      this.loose = !!options.loose;
      this.includePrerelease = !!options.includePrerelease;
      const m = version.trim().match(options.loose ? re2[t.LOOSE] : re2[t.FULL]);
      if (!m) {
        throw new TypeError(`Invalid Version: ${version}`);
      }
      this.raw = version;
      this.major = +m[1];
      this.minor = +m[2];
      this.patch = +m[3];
      if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
        throw new TypeError("Invalid major version");
      }
      if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
        throw new TypeError("Invalid minor version");
      }
      if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
        throw new TypeError("Invalid patch version");
      }
      if (!m[4]) {
        this.prerelease = [];
      } else {
        this.prerelease = m[4].split(".").map((id) => {
          if (/^[0-9]+$/.test(id)) {
            const num = +id;
            if (num >= 0 && num < MAX_SAFE_INTEGER) {
              return num;
            }
          }
          return id;
        });
      }
      this.build = m[5] ? m[5].split(".") : [];
      this.format();
    }
    format() {
      this.version = `${this.major}.${this.minor}.${this.patch}`;
      if (this.prerelease.length) {
        this.version += `-${this.prerelease.join(".")}`;
      }
      return this.version;
    }
    toString() {
      return this.version;
    }
    compare(other) {
      debug("SemVer.compare", this.version, this.options, other);
      if (!(other instanceof SemVer)) {
        if (typeof other === "string" && other === this.version) {
          return 0;
        }
        other = new SemVer(other, this.options);
      }
      if (other.version === this.version) {
        return 0;
      }
      return this.compareMain(other) || this.comparePre(other);
    }
    compareMain(other) {
      if (!(other instanceof SemVer)) {
        other = new SemVer(other, this.options);
      }
      if (this.major < other.major) {
        return -1;
      }
      if (this.major > other.major) {
        return 1;
      }
      if (this.minor < other.minor) {
        return -1;
      }
      if (this.minor > other.minor) {
        return 1;
      }
      if (this.patch < other.patch) {
        return -1;
      }
      if (this.patch > other.patch) {
        return 1;
      }
      return 0;
    }
    comparePre(other) {
      if (!(other instanceof SemVer)) {
        other = new SemVer(other, this.options);
      }
      if (this.prerelease.length && !other.prerelease.length) {
        return -1;
      } else if (!this.prerelease.length && other.prerelease.length) {
        return 1;
      } else if (!this.prerelease.length && !other.prerelease.length) {
        return 0;
      }
      let i = 0;
      do {
        const a = this.prerelease[i];
        const b = other.prerelease[i];
        debug("prerelease compare", i, a, b);
        if (a === void 0 && b === void 0) {
          return 0;
        } else if (b === void 0) {
          return 1;
        } else if (a === void 0) {
          return -1;
        } else if (a === b) {
          continue;
        } else {
          return compareIdentifiers(a, b);
        }
      } while (++i);
    }
    compareBuild(other) {
      if (!(other instanceof SemVer)) {
        other = new SemVer(other, this.options);
      }
      let i = 0;
      do {
        const a = this.build[i];
        const b = other.build[i];
        debug("build compare", i, a, b);
        if (a === void 0 && b === void 0) {
          return 0;
        } else if (b === void 0) {
          return 1;
        } else if (a === void 0) {
          return -1;
        } else if (a === b) {
          continue;
        } else {
          return compareIdentifiers(a, b);
        }
      } while (++i);
    }
    // preminor will bump the version up to the next minor release, and immediately
    // down to pre-release. premajor and prepatch work the same way.
    inc(release, identifier, identifierBase) {
      if (release.startsWith("pre")) {
        if (!identifier && identifierBase === false) {
          throw new Error("invalid increment argument: identifier is empty");
        }
        if (identifier) {
          const match = `-${identifier}`.match(this.options.loose ? re2[t.PRERELEASELOOSE] : re2[t.PRERELEASE]);
          if (!match || match[1] !== identifier) {
            throw new Error(`invalid identifier: ${identifier}`);
          }
        }
      }
      switch (release) {
        case "premajor":
          this.prerelease.length = 0;
          this.patch = 0;
          this.minor = 0;
          this.major++;
          this.inc("pre", identifier, identifierBase);
          break;
        case "preminor":
          this.prerelease.length = 0;
          this.patch = 0;
          this.minor++;
          this.inc("pre", identifier, identifierBase);
          break;
        case "prepatch":
          this.prerelease.length = 0;
          this.inc("patch", identifier, identifierBase);
          this.inc("pre", identifier, identifierBase);
          break;
        // If the input is a non-prerelease version, this acts the same as
        // prepatch.
        case "prerelease":
          if (this.prerelease.length === 0) {
            this.inc("patch", identifier, identifierBase);
          }
          this.inc("pre", identifier, identifierBase);
          break;
        case "release":
          if (this.prerelease.length === 0) {
            throw new Error(`version ${this.raw} is not a prerelease`);
          }
          this.prerelease.length = 0;
          break;
        case "major":
          if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
            this.major++;
          }
          this.minor = 0;
          this.patch = 0;
          this.prerelease = [];
          break;
        case "minor":
          if (this.patch !== 0 || this.prerelease.length === 0) {
            this.minor++;
          }
          this.patch = 0;
          this.prerelease = [];
          break;
        case "patch":
          if (this.prerelease.length === 0) {
            this.patch++;
          }
          this.prerelease = [];
          break;
        // This probably shouldn't be used publicly.
        // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
        case "pre": {
          const base = Number(identifierBase) ? 1 : 0;
          if (this.prerelease.length === 0) {
            this.prerelease = [base];
          } else {
            let i = this.prerelease.length;
            while (--i >= 0) {
              if (typeof this.prerelease[i] === "number") {
                this.prerelease[i]++;
                i = -2;
              }
            }
            if (i === -1) {
              if (identifier === this.prerelease.join(".") && identifierBase === false) {
                throw new Error("invalid increment argument: identifier already exists");
              }
              this.prerelease.push(base);
            }
          }
          if (identifier) {
            let prerelease = [identifier, base];
            if (identifierBase === false) {
              prerelease = [identifier];
            }
            if (compareIdentifiers(this.prerelease[0], identifier) === 0) {
              if (isNaN(this.prerelease[1])) {
                this.prerelease = prerelease;
              }
            } else {
              this.prerelease = prerelease;
            }
          }
          break;
        }
        default:
          throw new Error(`invalid increment argument: ${release}`);
      }
      this.raw = this.format();
      if (this.build.length) {
        this.raw += `+${this.build.join(".")}`;
      }
      return this;
    }
  }
  semver$1 = SemVer;
  return semver$1;
}
var parse_1;
var hasRequiredParse;
function requireParse() {
  if (hasRequiredParse) return parse_1;
  hasRequiredParse = 1;
  const SemVer = requireSemver$1();
  const parse = (version, options, throwErrors = false) => {
    if (version instanceof SemVer) {
      return version;
    }
    try {
      return new SemVer(version, options);
    } catch (er) {
      if (!throwErrors) {
        return null;
      }
      throw er;
    }
  };
  parse_1 = parse;
  return parse_1;
}
var valid_1;
var hasRequiredValid$1;
function requireValid$1() {
  if (hasRequiredValid$1) return valid_1;
  hasRequiredValid$1 = 1;
  const parse = requireParse();
  const valid2 = (version, options) => {
    const v = parse(version, options);
    return v ? v.version : null;
  };
  valid_1 = valid2;
  return valid_1;
}
var clean_1;
var hasRequiredClean;
function requireClean() {
  if (hasRequiredClean) return clean_1;
  hasRequiredClean = 1;
  const parse = requireParse();
  const clean = (version, options) => {
    const s = parse(version.trim().replace(/^[=v]+/, ""), options);
    return s ? s.version : null;
  };
  clean_1 = clean;
  return clean_1;
}
var inc_1;
var hasRequiredInc;
function requireInc() {
  if (hasRequiredInc) return inc_1;
  hasRequiredInc = 1;
  const SemVer = requireSemver$1();
  const inc = (version, release, options, identifier, identifierBase) => {
    if (typeof options === "string") {
      identifierBase = identifier;
      identifier = options;
      options = void 0;
    }
    try {
      return new SemVer(
        version instanceof SemVer ? version.version : version,
        options
      ).inc(release, identifier, identifierBase).version;
    } catch (er) {
      return null;
    }
  };
  inc_1 = inc;
  return inc_1;
}
var diff_1;
var hasRequiredDiff;
function requireDiff() {
  if (hasRequiredDiff) return diff_1;
  hasRequiredDiff = 1;
  const parse = requireParse();
  const diff = (version1, version2) => {
    const v1 = parse(version1, null, true);
    const v2 = parse(version2, null, true);
    const comparison = v1.compare(v2);
    if (comparison === 0) {
      return null;
    }
    const v1Higher = comparison > 0;
    const highVersion = v1Higher ? v1 : v2;
    const lowVersion = v1Higher ? v2 : v1;
    const highHasPre = !!highVersion.prerelease.length;
    const lowHasPre = !!lowVersion.prerelease.length;
    if (lowHasPre && !highHasPre) {
      if (!lowVersion.patch && !lowVersion.minor) {
        return "major";
      }
      if (lowVersion.compareMain(highVersion) === 0) {
        if (lowVersion.minor && !lowVersion.patch) {
          return "minor";
        }
        return "patch";
      }
    }
    const prefix = highHasPre ? "pre" : "";
    if (v1.major !== v2.major) {
      return prefix + "major";
    }
    if (v1.minor !== v2.minor) {
      return prefix + "minor";
    }
    if (v1.patch !== v2.patch) {
      return prefix + "patch";
    }
    return "prerelease";
  };
  diff_1 = diff;
  return diff_1;
}
var major_1;
var hasRequiredMajor;
function requireMajor() {
  if (hasRequiredMajor) return major_1;
  hasRequiredMajor = 1;
  const SemVer = requireSemver$1();
  const major = (a, loose) => new SemVer(a, loose).major;
  major_1 = major;
  return major_1;
}
var minor_1;
var hasRequiredMinor;
function requireMinor() {
  if (hasRequiredMinor) return minor_1;
  hasRequiredMinor = 1;
  const SemVer = requireSemver$1();
  const minor = (a, loose) => new SemVer(a, loose).minor;
  minor_1 = minor;
  return minor_1;
}
var patch_1;
var hasRequiredPatch;
function requirePatch() {
  if (hasRequiredPatch) return patch_1;
  hasRequiredPatch = 1;
  const SemVer = requireSemver$1();
  const patch = (a, loose) => new SemVer(a, loose).patch;
  patch_1 = patch;
  return patch_1;
}
var prerelease_1;
var hasRequiredPrerelease;
function requirePrerelease() {
  if (hasRequiredPrerelease) return prerelease_1;
  hasRequiredPrerelease = 1;
  const parse = requireParse();
  const prerelease = (version, options) => {
    const parsed = parse(version, options);
    return parsed && parsed.prerelease.length ? parsed.prerelease : null;
  };
  prerelease_1 = prerelease;
  return prerelease_1;
}
var compare_1;
var hasRequiredCompare;
function requireCompare() {
  if (hasRequiredCompare) return compare_1;
  hasRequiredCompare = 1;
  const SemVer = requireSemver$1();
  const compare = (a, b, loose) => new SemVer(a, loose).compare(new SemVer(b, loose));
  compare_1 = compare;
  return compare_1;
}
var rcompare_1;
var hasRequiredRcompare;
function requireRcompare() {
  if (hasRequiredRcompare) return rcompare_1;
  hasRequiredRcompare = 1;
  const compare = requireCompare();
  const rcompare = (a, b, loose) => compare(b, a, loose);
  rcompare_1 = rcompare;
  return rcompare_1;
}
var compareLoose_1;
var hasRequiredCompareLoose;
function requireCompareLoose() {
  if (hasRequiredCompareLoose) return compareLoose_1;
  hasRequiredCompareLoose = 1;
  const compare = requireCompare();
  const compareLoose = (a, b) => compare(a, b, true);
  compareLoose_1 = compareLoose;
  return compareLoose_1;
}
var compareBuild_1;
var hasRequiredCompareBuild;
function requireCompareBuild() {
  if (hasRequiredCompareBuild) return compareBuild_1;
  hasRequiredCompareBuild = 1;
  const SemVer = requireSemver$1();
  const compareBuild = (a, b, loose) => {
    const versionA = new SemVer(a, loose);
    const versionB = new SemVer(b, loose);
    return versionA.compare(versionB) || versionA.compareBuild(versionB);
  };
  compareBuild_1 = compareBuild;
  return compareBuild_1;
}
var sort_1;
var hasRequiredSort;
function requireSort() {
  if (hasRequiredSort) return sort_1;
  hasRequiredSort = 1;
  const compareBuild = requireCompareBuild();
  const sort = (list, loose) => list.sort((a, b) => compareBuild(a, b, loose));
  sort_1 = sort;
  return sort_1;
}
var rsort_1;
var hasRequiredRsort;
function requireRsort() {
  if (hasRequiredRsort) return rsort_1;
  hasRequiredRsort = 1;
  const compareBuild = requireCompareBuild();
  const rsort = (list, loose) => list.sort((a, b) => compareBuild(b, a, loose));
  rsort_1 = rsort;
  return rsort_1;
}
var gt_1;
var hasRequiredGt;
function requireGt() {
  if (hasRequiredGt) return gt_1;
  hasRequiredGt = 1;
  const compare = requireCompare();
  const gt = (a, b, loose) => compare(a, b, loose) > 0;
  gt_1 = gt;
  return gt_1;
}
var lt_1;
var hasRequiredLt;
function requireLt() {
  if (hasRequiredLt) return lt_1;
  hasRequiredLt = 1;
  const compare = requireCompare();
  const lt = (a, b, loose) => compare(a, b, loose) < 0;
  lt_1 = lt;
  return lt_1;
}
var eq_1;
var hasRequiredEq;
function requireEq() {
  if (hasRequiredEq) return eq_1;
  hasRequiredEq = 1;
  const compare = requireCompare();
  const eq = (a, b, loose) => compare(a, b, loose) === 0;
  eq_1 = eq;
  return eq_1;
}
var neq_1;
var hasRequiredNeq;
function requireNeq() {
  if (hasRequiredNeq) return neq_1;
  hasRequiredNeq = 1;
  const compare = requireCompare();
  const neq = (a, b, loose) => compare(a, b, loose) !== 0;
  neq_1 = neq;
  return neq_1;
}
var gte_1;
var hasRequiredGte;
function requireGte() {
  if (hasRequiredGte) return gte_1;
  hasRequiredGte = 1;
  const compare = requireCompare();
  const gte = (a, b, loose) => compare(a, b, loose) >= 0;
  gte_1 = gte;
  return gte_1;
}
var lte_1;
var hasRequiredLte;
function requireLte() {
  if (hasRequiredLte) return lte_1;
  hasRequiredLte = 1;
  const compare = requireCompare();
  const lte = (a, b, loose) => compare(a, b, loose) <= 0;
  lte_1 = lte;
  return lte_1;
}
var cmp_1;
var hasRequiredCmp;
function requireCmp() {
  if (hasRequiredCmp) return cmp_1;
  hasRequiredCmp = 1;
  const eq = requireEq();
  const neq = requireNeq();
  const gt = requireGt();
  const gte = requireGte();
  const lt = requireLt();
  const lte = requireLte();
  const cmp = (a, op, b, loose) => {
    switch (op) {
      case "===":
        if (typeof a === "object") {
          a = a.version;
        }
        if (typeof b === "object") {
          b = b.version;
        }
        return a === b;
      case "!==":
        if (typeof a === "object") {
          a = a.version;
        }
        if (typeof b === "object") {
          b = b.version;
        }
        return a !== b;
      case "":
      case "=":
      case "==":
        return eq(a, b, loose);
      case "!=":
        return neq(a, b, loose);
      case ">":
        return gt(a, b, loose);
      case ">=":
        return gte(a, b, loose);
      case "<":
        return lt(a, b, loose);
      case "<=":
        return lte(a, b, loose);
      default:
        throw new TypeError(`Invalid operator: ${op}`);
    }
  };
  cmp_1 = cmp;
  return cmp_1;
}
var coerce_1;
var hasRequiredCoerce;
function requireCoerce() {
  if (hasRequiredCoerce) return coerce_1;
  hasRequiredCoerce = 1;
  const SemVer = requireSemver$1();
  const parse = requireParse();
  const { safeRe: re2, t } = requireRe();
  const coerce = (version, options) => {
    if (version instanceof SemVer) {
      return version;
    }
    if (typeof version === "number") {
      version = String(version);
    }
    if (typeof version !== "string") {
      return null;
    }
    options = options || {};
    let match = null;
    if (!options.rtl) {
      match = version.match(options.includePrerelease ? re2[t.COERCEFULL] : re2[t.COERCE]);
    } else {
      const coerceRtlRegex = options.includePrerelease ? re2[t.COERCERTLFULL] : re2[t.COERCERTL];
      let next;
      while ((next = coerceRtlRegex.exec(version)) && (!match || match.index + match[0].length !== version.length)) {
        if (!match || next.index + next[0].length !== match.index + match[0].length) {
          match = next;
        }
        coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
      }
      coerceRtlRegex.lastIndex = -1;
    }
    if (match === null) {
      return null;
    }
    const major = match[2];
    const minor = match[3] || "0";
    const patch = match[4] || "0";
    const prerelease = options.includePrerelease && match[5] ? `-${match[5]}` : "";
    const build = options.includePrerelease && match[6] ? `+${match[6]}` : "";
    return parse(`${major}.${minor}.${patch}${prerelease}${build}`, options);
  };
  coerce_1 = coerce;
  return coerce_1;
}
var lrucache;
var hasRequiredLrucache;
function requireLrucache() {
  if (hasRequiredLrucache) return lrucache;
  hasRequiredLrucache = 1;
  class LRUCache {
    constructor() {
      this.max = 1e3;
      this.map = /* @__PURE__ */ new Map();
    }
    get(key) {
      const value = this.map.get(key);
      if (value === void 0) {
        return void 0;
      } else {
        this.map.delete(key);
        this.map.set(key, value);
        return value;
      }
    }
    delete(key) {
      return this.map.delete(key);
    }
    set(key, value) {
      const deleted = this.delete(key);
      if (!deleted && value !== void 0) {
        if (this.map.size >= this.max) {
          const firstKey = this.map.keys().next().value;
          this.delete(firstKey);
        }
        this.map.set(key, value);
      }
      return this;
    }
  }
  lrucache = LRUCache;
  return lrucache;
}
var range;
var hasRequiredRange;
function requireRange() {
  if (hasRequiredRange) return range;
  hasRequiredRange = 1;
  const SPACE_CHARACTERS = /\s+/g;
  class Range {
    constructor(range2, options) {
      options = parseOptions(options);
      if (range2 instanceof Range) {
        if (range2.loose === !!options.loose && range2.includePrerelease === !!options.includePrerelease) {
          return range2;
        } else {
          return new Range(range2.raw, options);
        }
      }
      if (range2 instanceof Comparator) {
        this.raw = range2.value;
        this.set = [[range2]];
        this.formatted = void 0;
        return this;
      }
      this.options = options;
      this.loose = !!options.loose;
      this.includePrerelease = !!options.includePrerelease;
      this.raw = range2.trim().replace(SPACE_CHARACTERS, " ");
      this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
      if (!this.set.length) {
        throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
      }
      if (this.set.length > 1) {
        const first = this.set[0];
        this.set = this.set.filter((c) => !isNullSet(c[0]));
        if (this.set.length === 0) {
          this.set = [first];
        } else if (this.set.length > 1) {
          for (const c of this.set) {
            if (c.length === 1 && isAny(c[0])) {
              this.set = [c];
              break;
            }
          }
        }
      }
      this.formatted = void 0;
    }
    get range() {
      if (this.formatted === void 0) {
        this.formatted = "";
        for (let i = 0; i < this.set.length; i++) {
          if (i > 0) {
            this.formatted += "||";
          }
          const comps = this.set[i];
          for (let k = 0; k < comps.length; k++) {
            if (k > 0) {
              this.formatted += " ";
            }
            this.formatted += comps[k].toString().trim();
          }
        }
      }
      return this.formatted;
    }
    format() {
      return this.range;
    }
    toString() {
      return this.range;
    }
    parseRange(range2) {
      const memoOpts = (this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE);
      const memoKey = memoOpts + ":" + range2;
      const cached = cache.get(memoKey);
      if (cached) {
        return cached;
      }
      const loose = this.options.loose;
      const hr = loose ? re2[t.HYPHENRANGELOOSE] : re2[t.HYPHENRANGE];
      range2 = range2.replace(hr, hyphenReplace(this.options.includePrerelease));
      debug("hyphen replace", range2);
      range2 = range2.replace(re2[t.COMPARATORTRIM], comparatorTrimReplace);
      debug("comparator trim", range2);
      range2 = range2.replace(re2[t.TILDETRIM], tildeTrimReplace);
      debug("tilde trim", range2);
      range2 = range2.replace(re2[t.CARETTRIM], caretTrimReplace);
      debug("caret trim", range2);
      let rangeList = range2.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
      if (loose) {
        rangeList = rangeList.filter((comp) => {
          debug("loose invalid filter", comp, this.options);
          return !!comp.match(re2[t.COMPARATORLOOSE]);
        });
      }
      debug("range list", rangeList);
      const rangeMap = /* @__PURE__ */ new Map();
      const comparators = rangeList.map((comp) => new Comparator(comp, this.options));
      for (const comp of comparators) {
        if (isNullSet(comp)) {
          return [comp];
        }
        rangeMap.set(comp.value, comp);
      }
      if (rangeMap.size > 1 && rangeMap.has("")) {
        rangeMap.delete("");
      }
      const result = [...rangeMap.values()];
      cache.set(memoKey, result);
      return result;
    }
    intersects(range2, options) {
      if (!(range2 instanceof Range)) {
        throw new TypeError("a Range is required");
      }
      return this.set.some((thisComparators) => {
        return isSatisfiable(thisComparators, options) && range2.set.some((rangeComparators) => {
          return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
            return rangeComparators.every((rangeComparator) => {
              return thisComparator.intersects(rangeComparator, options);
            });
          });
        });
      });
    }
    // if ANY of the sets match ALL of its comparators, then pass
    test(version) {
      if (!version) {
        return false;
      }
      if (typeof version === "string") {
        try {
          version = new SemVer(version, this.options);
        } catch (er) {
          return false;
        }
      }
      for (let i = 0; i < this.set.length; i++) {
        if (testSet(this.set[i], version, this.options)) {
          return true;
        }
      }
      return false;
    }
  }
  range = Range;
  const LRU = requireLrucache();
  const cache = new LRU();
  const parseOptions = requireParseOptions();
  const Comparator = requireComparator();
  const debug = requireDebug();
  const SemVer = requireSemver$1();
  const {
    safeRe: re2,
    t,
    comparatorTrimReplace,
    tildeTrimReplace,
    caretTrimReplace
  } = requireRe();
  const { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = requireConstants();
  const isNullSet = (c) => c.value === "<0.0.0-0";
  const isAny = (c) => c.value === "";
  const isSatisfiable = (comparators, options) => {
    let result = true;
    const remainingComparators = comparators.slice();
    let testComparator = remainingComparators.pop();
    while (result && remainingComparators.length) {
      result = remainingComparators.every((otherComparator) => {
        return testComparator.intersects(otherComparator, options);
      });
      testComparator = remainingComparators.pop();
    }
    return result;
  };
  const parseComparator = (comp, options) => {
    comp = comp.replace(re2[t.BUILD], "");
    debug("comp", comp, options);
    comp = replaceCarets(comp, options);
    debug("caret", comp);
    comp = replaceTildes(comp, options);
    debug("tildes", comp);
    comp = replaceXRanges(comp, options);
    debug("xrange", comp);
    comp = replaceStars(comp, options);
    debug("stars", comp);
    return comp;
  };
  const isX = (id) => !id || id.toLowerCase() === "x" || id === "*";
  const replaceTildes = (comp, options) => {
    return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
  };
  const replaceTilde = (comp, options) => {
    const r = options.loose ? re2[t.TILDELOOSE] : re2[t.TILDE];
    return comp.replace(r, (_, M, m, p, pr) => {
      debug("tilde", comp, _, M, m, p, pr);
      let ret;
      if (isX(M)) {
        ret = "";
      } else if (isX(m)) {
        ret = `>=${M}.0.0 <${+M + 1}.0.0-0`;
      } else if (isX(p)) {
        ret = `>=${M}.${m}.0 <${M}.${+m + 1}.0-0`;
      } else if (pr) {
        debug("replaceTilde pr", pr);
        ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
      } else {
        ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
      }
      debug("tilde return", ret);
      return ret;
    });
  };
  const replaceCarets = (comp, options) => {
    return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
  };
  const replaceCaret = (comp, options) => {
    debug("caret", comp, options);
    const r = options.loose ? re2[t.CARETLOOSE] : re2[t.CARET];
    const z = options.includePrerelease ? "-0" : "";
    return comp.replace(r, (_, M, m, p, pr) => {
      debug("caret", comp, _, M, m, p, pr);
      let ret;
      if (isX(M)) {
        ret = "";
      } else if (isX(m)) {
        ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
      } else if (isX(p)) {
        if (M === "0") {
          ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
        } else {
          ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
        }
      } else if (pr) {
        debug("replaceCaret pr", pr);
        if (M === "0") {
          if (m === "0") {
            ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
          } else {
            ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
          }
        } else {
          ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
        }
      } else {
        debug("no pr");
        if (M === "0") {
          if (m === "0") {
            ret = `>=${M}.${m}.${p}${z} <${M}.${m}.${+p + 1}-0`;
          } else {
            ret = `>=${M}.${m}.${p}${z} <${M}.${+m + 1}.0-0`;
          }
        } else {
          ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
        }
      }
      debug("caret return", ret);
      return ret;
    });
  };
  const replaceXRanges = (comp, options) => {
    debug("replaceXRanges", comp, options);
    return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
  };
  const replaceXRange = (comp, options) => {
    comp = comp.trim();
    const r = options.loose ? re2[t.XRANGELOOSE] : re2[t.XRANGE];
    return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
      debug("xRange", comp, ret, gtlt, M, m, p, pr);
      const xM = isX(M);
      const xm = xM || isX(m);
      const xp = xm || isX(p);
      const anyX = xp;
      if (gtlt === "=" && anyX) {
        gtlt = "";
      }
      pr = options.includePrerelease ? "-0" : "";
      if (xM) {
        if (gtlt === ">" || gtlt === "<") {
          ret = "<0.0.0-0";
        } else {
          ret = "*";
        }
      } else if (gtlt && anyX) {
        if (xm) {
          m = 0;
        }
        p = 0;
        if (gtlt === ">") {
          gtlt = ">=";
          if (xm) {
            M = +M + 1;
            m = 0;
            p = 0;
          } else {
            m = +m + 1;
            p = 0;
          }
        } else if (gtlt === "<=") {
          gtlt = "<";
          if (xm) {
            M = +M + 1;
          } else {
            m = +m + 1;
          }
        }
        if (gtlt === "<") {
          pr = "-0";
        }
        ret = `${gtlt + M}.${m}.${p}${pr}`;
      } else if (xm) {
        ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
      } else if (xp) {
        ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
      }
      debug("xRange return", ret);
      return ret;
    });
  };
  const replaceStars = (comp, options) => {
    debug("replaceStars", comp, options);
    return comp.trim().replace(re2[t.STAR], "");
  };
  const replaceGTE0 = (comp, options) => {
    debug("replaceGTE0", comp, options);
    return comp.trim().replace(re2[options.includePrerelease ? t.GTE0PRE : t.GTE0], "");
  };
  const hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
    if (isX(fM)) {
      from = "";
    } else if (isX(fm)) {
      from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
    } else if (isX(fp)) {
      from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
    } else if (fpr) {
      from = `>=${from}`;
    } else {
      from = `>=${from}${incPr ? "-0" : ""}`;
    }
    if (isX(tM)) {
      to = "";
    } else if (isX(tm)) {
      to = `<${+tM + 1}.0.0-0`;
    } else if (isX(tp)) {
      to = `<${tM}.${+tm + 1}.0-0`;
    } else if (tpr) {
      to = `<=${tM}.${tm}.${tp}-${tpr}`;
    } else if (incPr) {
      to = `<${tM}.${tm}.${+tp + 1}-0`;
    } else {
      to = `<=${to}`;
    }
    return `${from} ${to}`.trim();
  };
  const testSet = (set2, version, options) => {
    for (let i = 0; i < set2.length; i++) {
      if (!set2[i].test(version)) {
        return false;
      }
    }
    if (version.prerelease.length && !options.includePrerelease) {
      for (let i = 0; i < set2.length; i++) {
        debug(set2[i].semver);
        if (set2[i].semver === Comparator.ANY) {
          continue;
        }
        if (set2[i].semver.prerelease.length > 0) {
          const allowed = set2[i].semver;
          if (allowed.major === version.major && allowed.minor === version.minor && allowed.patch === version.patch) {
            return true;
          }
        }
      }
      return false;
    }
    return true;
  };
  return range;
}
var comparator;
var hasRequiredComparator;
function requireComparator() {
  if (hasRequiredComparator) return comparator;
  hasRequiredComparator = 1;
  const ANY = Symbol("SemVer ANY");
  class Comparator {
    static get ANY() {
      return ANY;
    }
    constructor(comp, options) {
      options = parseOptions(options);
      if (comp instanceof Comparator) {
        if (comp.loose === !!options.loose) {
          return comp;
        } else {
          comp = comp.value;
        }
      }
      comp = comp.trim().split(/\s+/).join(" ");
      debug("comparator", comp, options);
      this.options = options;
      this.loose = !!options.loose;
      this.parse(comp);
      if (this.semver === ANY) {
        this.value = "";
      } else {
        this.value = this.operator + this.semver.version;
      }
      debug("comp", this);
    }
    parse(comp) {
      const r = this.options.loose ? re2[t.COMPARATORLOOSE] : re2[t.COMPARATOR];
      const m = comp.match(r);
      if (!m) {
        throw new TypeError(`Invalid comparator: ${comp}`);
      }
      this.operator = m[1] !== void 0 ? m[1] : "";
      if (this.operator === "=") {
        this.operator = "";
      }
      if (!m[2]) {
        this.semver = ANY;
      } else {
        this.semver = new SemVer(m[2], this.options.loose);
      }
    }
    toString() {
      return this.value;
    }
    test(version) {
      debug("Comparator.test", version, this.options.loose);
      if (this.semver === ANY || version === ANY) {
        return true;
      }
      if (typeof version === "string") {
        try {
          version = new SemVer(version, this.options);
        } catch (er) {
          return false;
        }
      }
      return cmp(version, this.operator, this.semver, this.options);
    }
    intersects(comp, options) {
      if (!(comp instanceof Comparator)) {
        throw new TypeError("a Comparator is required");
      }
      if (this.operator === "") {
        if (this.value === "") {
          return true;
        }
        return new Range(comp.value, options).test(this.value);
      } else if (comp.operator === "") {
        if (comp.value === "") {
          return true;
        }
        return new Range(this.value, options).test(comp.semver);
      }
      options = parseOptions(options);
      if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) {
        return false;
      }
      if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) {
        return false;
      }
      if (this.operator.startsWith(">") && comp.operator.startsWith(">")) {
        return true;
      }
      if (this.operator.startsWith("<") && comp.operator.startsWith("<")) {
        return true;
      }
      if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) {
        return true;
      }
      if (cmp(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) {
        return true;
      }
      if (cmp(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) {
        return true;
      }
      return false;
    }
  }
  comparator = Comparator;
  const parseOptions = requireParseOptions();
  const { safeRe: re2, t } = requireRe();
  const cmp = requireCmp();
  const debug = requireDebug();
  const SemVer = requireSemver$1();
  const Range = requireRange();
  return comparator;
}
var satisfies_1;
var hasRequiredSatisfies;
function requireSatisfies() {
  if (hasRequiredSatisfies) return satisfies_1;
  hasRequiredSatisfies = 1;
  const Range = requireRange();
  const satisfies = (version, range2, options) => {
    try {
      range2 = new Range(range2, options);
    } catch (er) {
      return false;
    }
    return range2.test(version);
  };
  satisfies_1 = satisfies;
  return satisfies_1;
}
var toComparators_1;
var hasRequiredToComparators;
function requireToComparators() {
  if (hasRequiredToComparators) return toComparators_1;
  hasRequiredToComparators = 1;
  const Range = requireRange();
  const toComparators = (range2, options) => new Range(range2, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
  toComparators_1 = toComparators;
  return toComparators_1;
}
var maxSatisfying_1;
var hasRequiredMaxSatisfying;
function requireMaxSatisfying() {
  if (hasRequiredMaxSatisfying) return maxSatisfying_1;
  hasRequiredMaxSatisfying = 1;
  const SemVer = requireSemver$1();
  const Range = requireRange();
  const maxSatisfying = (versions, range2, options) => {
    let max = null;
    let maxSV = null;
    let rangeObj = null;
    try {
      rangeObj = new Range(range2, options);
    } catch (er) {
      return null;
    }
    versions.forEach((v) => {
      if (rangeObj.test(v)) {
        if (!max || maxSV.compare(v) === -1) {
          max = v;
          maxSV = new SemVer(max, options);
        }
      }
    });
    return max;
  };
  maxSatisfying_1 = maxSatisfying;
  return maxSatisfying_1;
}
var minSatisfying_1;
var hasRequiredMinSatisfying;
function requireMinSatisfying() {
  if (hasRequiredMinSatisfying) return minSatisfying_1;
  hasRequiredMinSatisfying = 1;
  const SemVer = requireSemver$1();
  const Range = requireRange();
  const minSatisfying = (versions, range2, options) => {
    let min = null;
    let minSV = null;
    let rangeObj = null;
    try {
      rangeObj = new Range(range2, options);
    } catch (er) {
      return null;
    }
    versions.forEach((v) => {
      if (rangeObj.test(v)) {
        if (!min || minSV.compare(v) === 1) {
          min = v;
          minSV = new SemVer(min, options);
        }
      }
    });
    return min;
  };
  minSatisfying_1 = minSatisfying;
  return minSatisfying_1;
}
var minVersion_1;
var hasRequiredMinVersion;
function requireMinVersion() {
  if (hasRequiredMinVersion) return minVersion_1;
  hasRequiredMinVersion = 1;
  const SemVer = requireSemver$1();
  const Range = requireRange();
  const gt = requireGt();
  const minVersion = (range2, loose) => {
    range2 = new Range(range2, loose);
    let minver = new SemVer("0.0.0");
    if (range2.test(minver)) {
      return minver;
    }
    minver = new SemVer("0.0.0-0");
    if (range2.test(minver)) {
      return minver;
    }
    minver = null;
    for (let i = 0; i < range2.set.length; ++i) {
      const comparators = range2.set[i];
      let setMin = null;
      comparators.forEach((comparator2) => {
        const compver = new SemVer(comparator2.semver.version);
        switch (comparator2.operator) {
          case ">":
            if (compver.prerelease.length === 0) {
              compver.patch++;
            } else {
              compver.prerelease.push(0);
            }
            compver.raw = compver.format();
          /* fallthrough */
          case "":
          case ">=":
            if (!setMin || gt(compver, setMin)) {
              setMin = compver;
            }
            break;
          case "<":
          case "<=":
            break;
          /* istanbul ignore next */
          default:
            throw new Error(`Unexpected operation: ${comparator2.operator}`);
        }
      });
      if (setMin && (!minver || gt(minver, setMin))) {
        minver = setMin;
      }
    }
    if (minver && range2.test(minver)) {
      return minver;
    }
    return null;
  };
  minVersion_1 = minVersion;
  return minVersion_1;
}
var valid;
var hasRequiredValid;
function requireValid() {
  if (hasRequiredValid) return valid;
  hasRequiredValid = 1;
  const Range = requireRange();
  const validRange = (range2, options) => {
    try {
      return new Range(range2, options).range || "*";
    } catch (er) {
      return null;
    }
  };
  valid = validRange;
  return valid;
}
var outside_1;
var hasRequiredOutside;
function requireOutside() {
  if (hasRequiredOutside) return outside_1;
  hasRequiredOutside = 1;
  const SemVer = requireSemver$1();
  const Comparator = requireComparator();
  const { ANY } = Comparator;
  const Range = requireRange();
  const satisfies = requireSatisfies();
  const gt = requireGt();
  const lt = requireLt();
  const lte = requireLte();
  const gte = requireGte();
  const outside = (version, range2, hilo, options) => {
    version = new SemVer(version, options);
    range2 = new Range(range2, options);
    let gtfn, ltefn, ltfn, comp, ecomp;
    switch (hilo) {
      case ">":
        gtfn = gt;
        ltefn = lte;
        ltfn = lt;
        comp = ">";
        ecomp = ">=";
        break;
      case "<":
        gtfn = lt;
        ltefn = gte;
        ltfn = gt;
        comp = "<";
        ecomp = "<=";
        break;
      default:
        throw new TypeError('Must provide a hilo val of "<" or ">"');
    }
    if (satisfies(version, range2, options)) {
      return false;
    }
    for (let i = 0; i < range2.set.length; ++i) {
      const comparators = range2.set[i];
      let high = null;
      let low = null;
      comparators.forEach((comparator2) => {
        if (comparator2.semver === ANY) {
          comparator2 = new Comparator(">=0.0.0");
        }
        high = high || comparator2;
        low = low || comparator2;
        if (gtfn(comparator2.semver, high.semver, options)) {
          high = comparator2;
        } else if (ltfn(comparator2.semver, low.semver, options)) {
          low = comparator2;
        }
      });
      if (high.operator === comp || high.operator === ecomp) {
        return false;
      }
      if ((!low.operator || low.operator === comp) && ltefn(version, low.semver)) {
        return false;
      } else if (low.operator === ecomp && ltfn(version, low.semver)) {
        return false;
      }
    }
    return true;
  };
  outside_1 = outside;
  return outside_1;
}
var gtr_1;
var hasRequiredGtr;
function requireGtr() {
  if (hasRequiredGtr) return gtr_1;
  hasRequiredGtr = 1;
  const outside = requireOutside();
  const gtr = (version, range2, options) => outside(version, range2, ">", options);
  gtr_1 = gtr;
  return gtr_1;
}
var ltr_1;
var hasRequiredLtr;
function requireLtr() {
  if (hasRequiredLtr) return ltr_1;
  hasRequiredLtr = 1;
  const outside = requireOutside();
  const ltr = (version, range2, options) => outside(version, range2, "<", options);
  ltr_1 = ltr;
  return ltr_1;
}
var intersects_1;
var hasRequiredIntersects;
function requireIntersects() {
  if (hasRequiredIntersects) return intersects_1;
  hasRequiredIntersects = 1;
  const Range = requireRange();
  const intersects = (r1, r2, options) => {
    r1 = new Range(r1, options);
    r2 = new Range(r2, options);
    return r1.intersects(r2, options);
  };
  intersects_1 = intersects;
  return intersects_1;
}
var simplify;
var hasRequiredSimplify;
function requireSimplify() {
  if (hasRequiredSimplify) return simplify;
  hasRequiredSimplify = 1;
  const satisfies = requireSatisfies();
  const compare = requireCompare();
  simplify = (versions, range2, options) => {
    const set2 = [];
    let first = null;
    let prev = null;
    const v = versions.sort((a, b) => compare(a, b, options));
    for (const version of v) {
      const included = satisfies(version, range2, options);
      if (included) {
        prev = version;
        if (!first) {
          first = version;
        }
      } else {
        if (prev) {
          set2.push([first, prev]);
        }
        prev = null;
        first = null;
      }
    }
    if (first) {
      set2.push([first, null]);
    }
    const ranges = [];
    for (const [min, max] of set2) {
      if (min === max) {
        ranges.push(min);
      } else if (!max && min === v[0]) {
        ranges.push("*");
      } else if (!max) {
        ranges.push(`>=${min}`);
      } else if (min === v[0]) {
        ranges.push(`<=${max}`);
      } else {
        ranges.push(`${min} - ${max}`);
      }
    }
    const simplified = ranges.join(" || ");
    const original = typeof range2.raw === "string" ? range2.raw : String(range2);
    return simplified.length < original.length ? simplified : range2;
  };
  return simplify;
}
var subset_1;
var hasRequiredSubset;
function requireSubset() {
  if (hasRequiredSubset) return subset_1;
  hasRequiredSubset = 1;
  const Range = requireRange();
  const Comparator = requireComparator();
  const { ANY } = Comparator;
  const satisfies = requireSatisfies();
  const compare = requireCompare();
  const subset = (sub, dom, options = {}) => {
    if (sub === dom) {
      return true;
    }
    sub = new Range(sub, options);
    dom = new Range(dom, options);
    let sawNonNull = false;
    OUTER: for (const simpleSub of sub.set) {
      for (const simpleDom of dom.set) {
        const isSub = simpleSubset(simpleSub, simpleDom, options);
        sawNonNull = sawNonNull || isSub !== null;
        if (isSub) {
          continue OUTER;
        }
      }
      if (sawNonNull) {
        return false;
      }
    }
    return true;
  };
  const minimumVersionWithPreRelease = [new Comparator(">=0.0.0-0")];
  const minimumVersion = [new Comparator(">=0.0.0")];
  const simpleSubset = (sub, dom, options) => {
    if (sub === dom) {
      return true;
    }
    if (sub.length === 1 && sub[0].semver === ANY) {
      if (dom.length === 1 && dom[0].semver === ANY) {
        return true;
      } else if (options.includePrerelease) {
        sub = minimumVersionWithPreRelease;
      } else {
        sub = minimumVersion;
      }
    }
    if (dom.length === 1 && dom[0].semver === ANY) {
      if (options.includePrerelease) {
        return true;
      } else {
        dom = minimumVersion;
      }
    }
    const eqSet = /* @__PURE__ */ new Set();
    let gt, lt;
    for (const c of sub) {
      if (c.operator === ">" || c.operator === ">=") {
        gt = higherGT(gt, c, options);
      } else if (c.operator === "<" || c.operator === "<=") {
        lt = lowerLT(lt, c, options);
      } else {
        eqSet.add(c.semver);
      }
    }
    if (eqSet.size > 1) {
      return null;
    }
    let gtltComp;
    if (gt && lt) {
      gtltComp = compare(gt.semver, lt.semver, options);
      if (gtltComp > 0) {
        return null;
      } else if (gtltComp === 0 && (gt.operator !== ">=" || lt.operator !== "<=")) {
        return null;
      }
    }
    for (const eq of eqSet) {
      if (gt && !satisfies(eq, String(gt), options)) {
        return null;
      }
      if (lt && !satisfies(eq, String(lt), options)) {
        return null;
      }
      for (const c of dom) {
        if (!satisfies(eq, String(c), options)) {
          return false;
        }
      }
      return true;
    }
    let higher, lower;
    let hasDomLT, hasDomGT;
    let needDomLTPre = lt && !options.includePrerelease && lt.semver.prerelease.length ? lt.semver : false;
    let needDomGTPre = gt && !options.includePrerelease && gt.semver.prerelease.length ? gt.semver : false;
    if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt.operator === "<" && needDomLTPre.prerelease[0] === 0) {
      needDomLTPre = false;
    }
    for (const c of dom) {
      hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
      hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
      if (gt) {
        if (needDomGTPre) {
          if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) {
            needDomGTPre = false;
          }
        }
        if (c.operator === ">" || c.operator === ">=") {
          higher = higherGT(gt, c, options);
          if (higher === c && higher !== gt) {
            return false;
          }
        } else if (gt.operator === ">=" && !satisfies(gt.semver, String(c), options)) {
          return false;
        }
      }
      if (lt) {
        if (needDomLTPre) {
          if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) {
            needDomLTPre = false;
          }
        }
        if (c.operator === "<" || c.operator === "<=") {
          lower = lowerLT(lt, c, options);
          if (lower === c && lower !== lt) {
            return false;
          }
        } else if (lt.operator === "<=" && !satisfies(lt.semver, String(c), options)) {
          return false;
        }
      }
      if (!c.operator && (lt || gt) && gtltComp !== 0) {
        return false;
      }
    }
    if (gt && hasDomLT && !lt && gtltComp !== 0) {
      return false;
    }
    if (lt && hasDomGT && !gt && gtltComp !== 0) {
      return false;
    }
    if (needDomGTPre || needDomLTPre) {
      return false;
    }
    return true;
  };
  const higherGT = (a, b, options) => {
    if (!a) {
      return b;
    }
    const comp = compare(a.semver, b.semver, options);
    return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
  };
  const lowerLT = (a, b, options) => {
    if (!a) {
      return b;
    }
    const comp = compare(a.semver, b.semver, options);
    return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
  };
  subset_1 = subset;
  return subset_1;
}
var semver;
var hasRequiredSemver;
function requireSemver() {
  if (hasRequiredSemver) return semver;
  hasRequiredSemver = 1;
  const internalRe = requireRe();
  const constants2 = requireConstants();
  const SemVer = requireSemver$1();
  const identifiers2 = requireIdentifiers();
  const parse = requireParse();
  const valid2 = requireValid$1();
  const clean = requireClean();
  const inc = requireInc();
  const diff = requireDiff();
  const major = requireMajor();
  const minor = requireMinor();
  const patch = requirePatch();
  const prerelease = requirePrerelease();
  const compare = requireCompare();
  const rcompare = requireRcompare();
  const compareLoose = requireCompareLoose();
  const compareBuild = requireCompareBuild();
  const sort = requireSort();
  const rsort = requireRsort();
  const gt = requireGt();
  const lt = requireLt();
  const eq = requireEq();
  const neq = requireNeq();
  const gte = requireGte();
  const lte = requireLte();
  const cmp = requireCmp();
  const coerce = requireCoerce();
  const Comparator = requireComparator();
  const Range = requireRange();
  const satisfies = requireSatisfies();
  const toComparators = requireToComparators();
  const maxSatisfying = requireMaxSatisfying();
  const minSatisfying = requireMinSatisfying();
  const minVersion = requireMinVersion();
  const validRange = requireValid();
  const outside = requireOutside();
  const gtr = requireGtr();
  const ltr = requireLtr();
  const intersects = requireIntersects();
  const simplifyRange = requireSimplify();
  const subset = requireSubset();
  semver = {
    parse,
    valid: valid2,
    clean,
    inc,
    diff,
    major,
    minor,
    patch,
    prerelease,
    compare,
    rcompare,
    compareLoose,
    compareBuild,
    sort,
    rsort,
    gt,
    lt,
    eq,
    neq,
    gte,
    lte,
    cmp,
    coerce,
    Comparator,
    Range,
    satisfies,
    toComparators,
    maxSatisfying,
    minSatisfying,
    minVersion,
    validRange,
    outside,
    gtr,
    ltr,
    intersects,
    simplifyRange,
    subset,
    SemVer,
    re: internalRe.re,
    src: internalRe.src,
    tokens: internalRe.t,
    SEMVER_SPEC_VERSION: constants2.SEMVER_SPEC_VERSION,
    RELEASE_TYPES: constants2.RELEASE_TYPES,
    compareIdentifiers: identifiers2.compareIdentifiers,
    rcompareIdentifiers: identifiers2.rcompareIdentifiers
  };
  return semver;
}
var DownloadedUpdateHelper = {};
var lodash_isequal = { exports: {} };
lodash_isequal.exports;
var hasRequiredLodash_isequal;
function requireLodash_isequal() {
  if (hasRequiredLodash_isequal) return lodash_isequal.exports;
  hasRequiredLodash_isequal = 1;
  (function(module, exports) {
    var LARGE_ARRAY_SIZE = 200;
    var HASH_UNDEFINED = "__lodash_hash_undefined__";
    var COMPARE_PARTIAL_FLAG = 1, COMPARE_UNORDERED_FLAG = 2;
    var MAX_SAFE_INTEGER = 9007199254740991;
    var argsTag = "[object Arguments]", arrayTag = "[object Array]", asyncTag = "[object AsyncFunction]", boolTag = "[object Boolean]", dateTag = "[object Date]", errorTag = "[object Error]", funcTag = "[object Function]", genTag = "[object GeneratorFunction]", mapTag = "[object Map]", numberTag = "[object Number]", nullTag = "[object Null]", objectTag = "[object Object]", promiseTag = "[object Promise]", proxyTag = "[object Proxy]", regexpTag = "[object RegExp]", setTag = "[object Set]", stringTag = "[object String]", symbolTag = "[object Symbol]", undefinedTag = "[object Undefined]", weakMapTag = "[object WeakMap]";
    var arrayBufferTag = "[object ArrayBuffer]", dataViewTag = "[object DataView]", float32Tag = "[object Float32Array]", float64Tag = "[object Float64Array]", int8Tag = "[object Int8Array]", int16Tag = "[object Int16Array]", int32Tag = "[object Int32Array]", uint8Tag = "[object Uint8Array]", uint8ClampedTag = "[object Uint8ClampedArray]", uint16Tag = "[object Uint16Array]", uint32Tag = "[object Uint32Array]";
    var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
    var reIsHostCtor = /^\[object .+?Constructor\]$/;
    var reIsUint = /^(?:0|[1-9]\d*)$/;
    var typedArrayTags = {};
    typedArrayTags[float32Tag] = typedArrayTags[float64Tag] = typedArrayTags[int8Tag] = typedArrayTags[int16Tag] = typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] = typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] = typedArrayTags[uint32Tag] = true;
    typedArrayTags[argsTag] = typedArrayTags[arrayTag] = typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] = typedArrayTags[dataViewTag] = typedArrayTags[dateTag] = typedArrayTags[errorTag] = typedArrayTags[funcTag] = typedArrayTags[mapTag] = typedArrayTags[numberTag] = typedArrayTags[objectTag] = typedArrayTags[regexpTag] = typedArrayTags[setTag] = typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;
    var freeGlobal = typeof commonjsGlobal == "object" && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;
    var freeSelf = typeof self == "object" && self && self.Object === Object && self;
    var root = freeGlobal || freeSelf || Function("return this")();
    var freeExports = exports && !exports.nodeType && exports;
    var freeModule = freeExports && true && module && !module.nodeType && module;
    var moduleExports = freeModule && freeModule.exports === freeExports;
    var freeProcess = moduleExports && freeGlobal.process;
    var nodeUtil = (function() {
      try {
        return freeProcess && freeProcess.binding && freeProcess.binding("util");
      } catch (e) {
      }
    })();
    var nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;
    function arrayFilter(array, predicate) {
      var index = -1, length = array == null ? 0 : array.length, resIndex = 0, result = [];
      while (++index < length) {
        var value = array[index];
        if (predicate(value, index, array)) {
          result[resIndex++] = value;
        }
      }
      return result;
    }
    function arrayPush(array, values) {
      var index = -1, length = values.length, offset = array.length;
      while (++index < length) {
        array[offset + index] = values[index];
      }
      return array;
    }
    function arraySome(array, predicate) {
      var index = -1, length = array == null ? 0 : array.length;
      while (++index < length) {
        if (predicate(array[index], index, array)) {
          return true;
        }
      }
      return false;
    }
    function baseTimes(n, iteratee) {
      var index = -1, result = Array(n);
      while (++index < n) {
        result[index] = iteratee(index);
      }
      return result;
    }
    function baseUnary(func) {
      return function(value) {
        return func(value);
      };
    }
    function cacheHas(cache, key) {
      return cache.has(key);
    }
    function getValue(object, key) {
      return object == null ? void 0 : object[key];
    }
    function mapToArray(map2) {
      var index = -1, result = Array(map2.size);
      map2.forEach(function(value, key) {
        result[++index] = [key, value];
      });
      return result;
    }
    function overArg(func, transform) {
      return function(arg) {
        return func(transform(arg));
      };
    }
    function setToArray(set2) {
      var index = -1, result = Array(set2.size);
      set2.forEach(function(value) {
        result[++index] = value;
      });
      return result;
    }
    var arrayProto = Array.prototype, funcProto = Function.prototype, objectProto = Object.prototype;
    var coreJsData = root["__core-js_shared__"];
    var funcToString = funcProto.toString;
    var hasOwnProperty = objectProto.hasOwnProperty;
    var maskSrcKey = (function() {
      var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
      return uid ? "Symbol(src)_1." + uid : "";
    })();
    var nativeObjectToString = objectProto.toString;
    var reIsNative = RegExp(
      "^" + funcToString.call(hasOwnProperty).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"
    );
    var Buffer2 = moduleExports ? root.Buffer : void 0, Symbol2 = root.Symbol, Uint8Array2 = root.Uint8Array, propertyIsEnumerable = objectProto.propertyIsEnumerable, splice = arrayProto.splice, symToStringTag = Symbol2 ? Symbol2.toStringTag : void 0;
    var nativeGetSymbols = Object.getOwnPropertySymbols, nativeIsBuffer = Buffer2 ? Buffer2.isBuffer : void 0, nativeKeys = overArg(Object.keys, Object);
    var DataView = getNative(root, "DataView"), Map2 = getNative(root, "Map"), Promise2 = getNative(root, "Promise"), Set2 = getNative(root, "Set"), WeakMap = getNative(root, "WeakMap"), nativeCreate = getNative(Object, "create");
    var dataViewCtorString = toSource(DataView), mapCtorString = toSource(Map2), promiseCtorString = toSource(Promise2), setCtorString = toSource(Set2), weakMapCtorString = toSource(WeakMap);
    var symbolProto = Symbol2 ? Symbol2.prototype : void 0, symbolValueOf = symbolProto ? symbolProto.valueOf : void 0;
    function Hash(entries) {
      var index = -1, length = entries == null ? 0 : entries.length;
      this.clear();
      while (++index < length) {
        var entry = entries[index];
        this.set(entry[0], entry[1]);
      }
    }
    function hashClear() {
      this.__data__ = nativeCreate ? nativeCreate(null) : {};
      this.size = 0;
    }
    function hashDelete(key) {
      var result = this.has(key) && delete this.__data__[key];
      this.size -= result ? 1 : 0;
      return result;
    }
    function hashGet(key) {
      var data = this.__data__;
      if (nativeCreate) {
        var result = data[key];
        return result === HASH_UNDEFINED ? void 0 : result;
      }
      return hasOwnProperty.call(data, key) ? data[key] : void 0;
    }
    function hashHas(key) {
      var data = this.__data__;
      return nativeCreate ? data[key] !== void 0 : hasOwnProperty.call(data, key);
    }
    function hashSet(key, value) {
      var data = this.__data__;
      this.size += this.has(key) ? 0 : 1;
      data[key] = nativeCreate && value === void 0 ? HASH_UNDEFINED : value;
      return this;
    }
    Hash.prototype.clear = hashClear;
    Hash.prototype["delete"] = hashDelete;
    Hash.prototype.get = hashGet;
    Hash.prototype.has = hashHas;
    Hash.prototype.set = hashSet;
    function ListCache(entries) {
      var index = -1, length = entries == null ? 0 : entries.length;
      this.clear();
      while (++index < length) {
        var entry = entries[index];
        this.set(entry[0], entry[1]);
      }
    }
    function listCacheClear() {
      this.__data__ = [];
      this.size = 0;
    }
    function listCacheDelete(key) {
      var data = this.__data__, index = assocIndexOf(data, key);
      if (index < 0) {
        return false;
      }
      var lastIndex = data.length - 1;
      if (index == lastIndex) {
        data.pop();
      } else {
        splice.call(data, index, 1);
      }
      --this.size;
      return true;
    }
    function listCacheGet(key) {
      var data = this.__data__, index = assocIndexOf(data, key);
      return index < 0 ? void 0 : data[index][1];
    }
    function listCacheHas(key) {
      return assocIndexOf(this.__data__, key) > -1;
    }
    function listCacheSet(key, value) {
      var data = this.__data__, index = assocIndexOf(data, key);
      if (index < 0) {
        ++this.size;
        data.push([key, value]);
      } else {
        data[index][1] = value;
      }
      return this;
    }
    ListCache.prototype.clear = listCacheClear;
    ListCache.prototype["delete"] = listCacheDelete;
    ListCache.prototype.get = listCacheGet;
    ListCache.prototype.has = listCacheHas;
    ListCache.prototype.set = listCacheSet;
    function MapCache(entries) {
      var index = -1, length = entries == null ? 0 : entries.length;
      this.clear();
      while (++index < length) {
        var entry = entries[index];
        this.set(entry[0], entry[1]);
      }
    }
    function mapCacheClear() {
      this.size = 0;
      this.__data__ = {
        "hash": new Hash(),
        "map": new (Map2 || ListCache)(),
        "string": new Hash()
      };
    }
    function mapCacheDelete(key) {
      var result = getMapData(this, key)["delete"](key);
      this.size -= result ? 1 : 0;
      return result;
    }
    function mapCacheGet(key) {
      return getMapData(this, key).get(key);
    }
    function mapCacheHas(key) {
      return getMapData(this, key).has(key);
    }
    function mapCacheSet(key, value) {
      var data = getMapData(this, key), size = data.size;
      data.set(key, value);
      this.size += data.size == size ? 0 : 1;
      return this;
    }
    MapCache.prototype.clear = mapCacheClear;
    MapCache.prototype["delete"] = mapCacheDelete;
    MapCache.prototype.get = mapCacheGet;
    MapCache.prototype.has = mapCacheHas;
    MapCache.prototype.set = mapCacheSet;
    function SetCache(values) {
      var index = -1, length = values == null ? 0 : values.length;
      this.__data__ = new MapCache();
      while (++index < length) {
        this.add(values[index]);
      }
    }
    function setCacheAdd(value) {
      this.__data__.set(value, HASH_UNDEFINED);
      return this;
    }
    function setCacheHas(value) {
      return this.__data__.has(value);
    }
    SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
    SetCache.prototype.has = setCacheHas;
    function Stack(entries) {
      var data = this.__data__ = new ListCache(entries);
      this.size = data.size;
    }
    function stackClear() {
      this.__data__ = new ListCache();
      this.size = 0;
    }
    function stackDelete(key) {
      var data = this.__data__, result = data["delete"](key);
      this.size = data.size;
      return result;
    }
    function stackGet(key) {
      return this.__data__.get(key);
    }
    function stackHas(key) {
      return this.__data__.has(key);
    }
    function stackSet(key, value) {
      var data = this.__data__;
      if (data instanceof ListCache) {
        var pairs2 = data.__data__;
        if (!Map2 || pairs2.length < LARGE_ARRAY_SIZE - 1) {
          pairs2.push([key, value]);
          this.size = ++data.size;
          return this;
        }
        data = this.__data__ = new MapCache(pairs2);
      }
      data.set(key, value);
      this.size = data.size;
      return this;
    }
    Stack.prototype.clear = stackClear;
    Stack.prototype["delete"] = stackDelete;
    Stack.prototype.get = stackGet;
    Stack.prototype.has = stackHas;
    Stack.prototype.set = stackSet;
    function arrayLikeKeys(value, inherited) {
      var isArr = isArray(value), isArg = !isArr && isArguments(value), isBuff = !isArr && !isArg && isBuffer(value), isType = !isArr && !isArg && !isBuff && isTypedArray(value), skipIndexes = isArr || isArg || isBuff || isType, result = skipIndexes ? baseTimes(value.length, String) : [], length = result.length;
      for (var key in value) {
        if (hasOwnProperty.call(value, key) && !(skipIndexes && // Safari 9 has enumerable `arguments.length` in strict mode.
        (key == "length" || // Node.js 0.10 has enumerable non-index properties on buffers.
        isBuff && (key == "offset" || key == "parent") || // PhantomJS 2 has enumerable non-index properties on typed arrays.
        isType && (key == "buffer" || key == "byteLength" || key == "byteOffset") || // Skip index properties.
        isIndex(key, length)))) {
          result.push(key);
        }
      }
      return result;
    }
    function assocIndexOf(array, key) {
      var length = array.length;
      while (length--) {
        if (eq(array[length][0], key)) {
          return length;
        }
      }
      return -1;
    }
    function baseGetAllKeys(object, keysFunc, symbolsFunc) {
      var result = keysFunc(object);
      return isArray(object) ? result : arrayPush(result, symbolsFunc(object));
    }
    function baseGetTag(value) {
      if (value == null) {
        return value === void 0 ? undefinedTag : nullTag;
      }
      return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
    }
    function baseIsArguments(value) {
      return isObjectLike(value) && baseGetTag(value) == argsTag;
    }
    function baseIsEqual(value, other, bitmask, customizer, stack) {
      if (value === other) {
        return true;
      }
      if (value == null || other == null || !isObjectLike(value) && !isObjectLike(other)) {
        return value !== value && other !== other;
      }
      return baseIsEqualDeep(value, other, bitmask, customizer, baseIsEqual, stack);
    }
    function baseIsEqualDeep(object, other, bitmask, customizer, equalFunc, stack) {
      var objIsArr = isArray(object), othIsArr = isArray(other), objTag = objIsArr ? arrayTag : getTag(object), othTag = othIsArr ? arrayTag : getTag(other);
      objTag = objTag == argsTag ? objectTag : objTag;
      othTag = othTag == argsTag ? objectTag : othTag;
      var objIsObj = objTag == objectTag, othIsObj = othTag == objectTag, isSameTag = objTag == othTag;
      if (isSameTag && isBuffer(object)) {
        if (!isBuffer(other)) {
          return false;
        }
        objIsArr = true;
        objIsObj = false;
      }
      if (isSameTag && !objIsObj) {
        stack || (stack = new Stack());
        return objIsArr || isTypedArray(object) ? equalArrays(object, other, bitmask, customizer, equalFunc, stack) : equalByTag(object, other, objTag, bitmask, customizer, equalFunc, stack);
      }
      if (!(bitmask & COMPARE_PARTIAL_FLAG)) {
        var objIsWrapped = objIsObj && hasOwnProperty.call(object, "__wrapped__"), othIsWrapped = othIsObj && hasOwnProperty.call(other, "__wrapped__");
        if (objIsWrapped || othIsWrapped) {
          var objUnwrapped = objIsWrapped ? object.value() : object, othUnwrapped = othIsWrapped ? other.value() : other;
          stack || (stack = new Stack());
          return equalFunc(objUnwrapped, othUnwrapped, bitmask, customizer, stack);
        }
      }
      if (!isSameTag) {
        return false;
      }
      stack || (stack = new Stack());
      return equalObjects(object, other, bitmask, customizer, equalFunc, stack);
    }
    function baseIsNative(value) {
      if (!isObject(value) || isMasked(value)) {
        return false;
      }
      var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
      return pattern.test(toSource(value));
    }
    function baseIsTypedArray(value) {
      return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
    }
    function baseKeys(object) {
      if (!isPrototype(object)) {
        return nativeKeys(object);
      }
      var result = [];
      for (var key in Object(object)) {
        if (hasOwnProperty.call(object, key) && key != "constructor") {
          result.push(key);
        }
      }
      return result;
    }
    function equalArrays(array, other, bitmask, customizer, equalFunc, stack) {
      var isPartial = bitmask & COMPARE_PARTIAL_FLAG, arrLength = array.length, othLength = other.length;
      if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
        return false;
      }
      var stacked = stack.get(array);
      if (stacked && stack.get(other)) {
        return stacked == other;
      }
      var index = -1, result = true, seen = bitmask & COMPARE_UNORDERED_FLAG ? new SetCache() : void 0;
      stack.set(array, other);
      stack.set(other, array);
      while (++index < arrLength) {
        var arrValue = array[index], othValue = other[index];
        if (customizer) {
          var compared = isPartial ? customizer(othValue, arrValue, index, other, array, stack) : customizer(arrValue, othValue, index, array, other, stack);
        }
        if (compared !== void 0) {
          if (compared) {
            continue;
          }
          result = false;
          break;
        }
        if (seen) {
          if (!arraySome(other, function(othValue2, othIndex) {
            if (!cacheHas(seen, othIndex) && (arrValue === othValue2 || equalFunc(arrValue, othValue2, bitmask, customizer, stack))) {
              return seen.push(othIndex);
            }
          })) {
            result = false;
            break;
          }
        } else if (!(arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
          result = false;
          break;
        }
      }
      stack["delete"](array);
      stack["delete"](other);
      return result;
    }
    function equalByTag(object, other, tag, bitmask, customizer, equalFunc, stack) {
      switch (tag) {
        case dataViewTag:
          if (object.byteLength != other.byteLength || object.byteOffset != other.byteOffset) {
            return false;
          }
          object = object.buffer;
          other = other.buffer;
        case arrayBufferTag:
          if (object.byteLength != other.byteLength || !equalFunc(new Uint8Array2(object), new Uint8Array2(other))) {
            return false;
          }
          return true;
        case boolTag:
        case dateTag:
        case numberTag:
          return eq(+object, +other);
        case errorTag:
          return object.name == other.name && object.message == other.message;
        case regexpTag:
        case stringTag:
          return object == other + "";
        case mapTag:
          var convert = mapToArray;
        case setTag:
          var isPartial = bitmask & COMPARE_PARTIAL_FLAG;
          convert || (convert = setToArray);
          if (object.size != other.size && !isPartial) {
            return false;
          }
          var stacked = stack.get(object);
          if (stacked) {
            return stacked == other;
          }
          bitmask |= COMPARE_UNORDERED_FLAG;
          stack.set(object, other);
          var result = equalArrays(convert(object), convert(other), bitmask, customizer, equalFunc, stack);
          stack["delete"](object);
          return result;
        case symbolTag:
          if (symbolValueOf) {
            return symbolValueOf.call(object) == symbolValueOf.call(other);
          }
      }
      return false;
    }
    function equalObjects(object, other, bitmask, customizer, equalFunc, stack) {
      var isPartial = bitmask & COMPARE_PARTIAL_FLAG, objProps = getAllKeys(object), objLength = objProps.length, othProps = getAllKeys(other), othLength = othProps.length;
      if (objLength != othLength && !isPartial) {
        return false;
      }
      var index = objLength;
      while (index--) {
        var key = objProps[index];
        if (!(isPartial ? key in other : hasOwnProperty.call(other, key))) {
          return false;
        }
      }
      var stacked = stack.get(object);
      if (stacked && stack.get(other)) {
        return stacked == other;
      }
      var result = true;
      stack.set(object, other);
      stack.set(other, object);
      var skipCtor = isPartial;
      while (++index < objLength) {
        key = objProps[index];
        var objValue = object[key], othValue = other[key];
        if (customizer) {
          var compared = isPartial ? customizer(othValue, objValue, key, other, object, stack) : customizer(objValue, othValue, key, object, other, stack);
        }
        if (!(compared === void 0 ? objValue === othValue || equalFunc(objValue, othValue, bitmask, customizer, stack) : compared)) {
          result = false;
          break;
        }
        skipCtor || (skipCtor = key == "constructor");
      }
      if (result && !skipCtor) {
        var objCtor = object.constructor, othCtor = other.constructor;
        if (objCtor != othCtor && ("constructor" in object && "constructor" in other) && !(typeof objCtor == "function" && objCtor instanceof objCtor && typeof othCtor == "function" && othCtor instanceof othCtor)) {
          result = false;
        }
      }
      stack["delete"](object);
      stack["delete"](other);
      return result;
    }
    function getAllKeys(object) {
      return baseGetAllKeys(object, keys, getSymbols);
    }
    function getMapData(map2, key) {
      var data = map2.__data__;
      return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
    }
    function getNative(object, key) {
      var value = getValue(object, key);
      return baseIsNative(value) ? value : void 0;
    }
    function getRawTag(value) {
      var isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
      try {
        value[symToStringTag] = void 0;
        var unmasked = true;
      } catch (e) {
      }
      var result = nativeObjectToString.call(value);
      if (unmasked) {
        if (isOwn) {
          value[symToStringTag] = tag;
        } else {
          delete value[symToStringTag];
        }
      }
      return result;
    }
    var getSymbols = !nativeGetSymbols ? stubArray : function(object) {
      if (object == null) {
        return [];
      }
      object = Object(object);
      return arrayFilter(nativeGetSymbols(object), function(symbol) {
        return propertyIsEnumerable.call(object, symbol);
      });
    };
    var getTag = baseGetTag;
    if (DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag || Map2 && getTag(new Map2()) != mapTag || Promise2 && getTag(Promise2.resolve()) != promiseTag || Set2 && getTag(new Set2()) != setTag || WeakMap && getTag(new WeakMap()) != weakMapTag) {
      getTag = function(value) {
        var result = baseGetTag(value), Ctor = result == objectTag ? value.constructor : void 0, ctorString = Ctor ? toSource(Ctor) : "";
        if (ctorString) {
          switch (ctorString) {
            case dataViewCtorString:
              return dataViewTag;
            case mapCtorString:
              return mapTag;
            case promiseCtorString:
              return promiseTag;
            case setCtorString:
              return setTag;
            case weakMapCtorString:
              return weakMapTag;
          }
        }
        return result;
      };
    }
    function isIndex(value, length) {
      length = length == null ? MAX_SAFE_INTEGER : length;
      return !!length && (typeof value == "number" || reIsUint.test(value)) && (value > -1 && value % 1 == 0 && value < length);
    }
    function isKeyable(value) {
      var type2 = typeof value;
      return type2 == "string" || type2 == "number" || type2 == "symbol" || type2 == "boolean" ? value !== "__proto__" : value === null;
    }
    function isMasked(func) {
      return !!maskSrcKey && maskSrcKey in func;
    }
    function isPrototype(value) {
      var Ctor = value && value.constructor, proto = typeof Ctor == "function" && Ctor.prototype || objectProto;
      return value === proto;
    }
    function objectToString(value) {
      return nativeObjectToString.call(value);
    }
    function toSource(func) {
      if (func != null) {
        try {
          return funcToString.call(func);
        } catch (e) {
        }
        try {
          return func + "";
        } catch (e) {
        }
      }
      return "";
    }
    function eq(value, other) {
      return value === other || value !== value && other !== other;
    }
    var isArguments = baseIsArguments(/* @__PURE__ */ (function() {
      return arguments;
    })()) ? baseIsArguments : function(value) {
      return isObjectLike(value) && hasOwnProperty.call(value, "callee") && !propertyIsEnumerable.call(value, "callee");
    };
    var isArray = Array.isArray;
    function isArrayLike(value) {
      return value != null && isLength(value.length) && !isFunction(value);
    }
    var isBuffer = nativeIsBuffer || stubFalse;
    function isEqual(value, other) {
      return baseIsEqual(value, other);
    }
    function isFunction(value) {
      if (!isObject(value)) {
        return false;
      }
      var tag = baseGetTag(value);
      return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
    }
    function isLength(value) {
      return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
    }
    function isObject(value) {
      var type2 = typeof value;
      return value != null && (type2 == "object" || type2 == "function");
    }
    function isObjectLike(value) {
      return value != null && typeof value == "object";
    }
    var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;
    function keys(object) {
      return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
    }
    function stubArray() {
      return [];
    }
    function stubFalse() {
      return false;
    }
    module.exports = isEqual;
  })(lodash_isequal, lodash_isequal.exports);
  return lodash_isequal.exports;
}
var hasRequiredDownloadedUpdateHelper;
function requireDownloadedUpdateHelper() {
  if (hasRequiredDownloadedUpdateHelper) return DownloadedUpdateHelper;
  hasRequiredDownloadedUpdateHelper = 1;
  Object.defineProperty(DownloadedUpdateHelper, "__esModule", { value: true });
  DownloadedUpdateHelper.DownloadedUpdateHelper = void 0;
  DownloadedUpdateHelper.createTempUpdateFile = createTempUpdateFile;
  const crypto_1 = crypto;
  const fs_1 = require$$1$2;
  const isEqual = requireLodash_isequal();
  const fs_extra_1 = /* @__PURE__ */ requireLib();
  const path = require$$1$1;
  let DownloadedUpdateHelper$1 = class DownloadedUpdateHelper {
    constructor(cacheDir) {
      this.cacheDir = cacheDir;
      this._file = null;
      this._packageFile = null;
      this.versionInfo = null;
      this.fileInfo = null;
      this._downloadedFileInfo = null;
    }
    get downloadedFileInfo() {
      return this._downloadedFileInfo;
    }
    get file() {
      return this._file;
    }
    get packageFile() {
      return this._packageFile;
    }
    get cacheDirForPendingUpdate() {
      return path.join(this.cacheDir, "pending");
    }
    async validateDownloadedPath(updateFile, updateInfo, fileInfo, logger2) {
      if (this.versionInfo != null && this.file === updateFile && this.fileInfo != null) {
        if (isEqual(this.versionInfo, updateInfo) && isEqual(this.fileInfo.info, fileInfo.info) && await (0, fs_extra_1.pathExists)(updateFile)) {
          return updateFile;
        } else {
          return null;
        }
      }
      const cachedUpdateFile = await this.getValidCachedUpdateFile(fileInfo, logger2);
      if (cachedUpdateFile === null) {
        return null;
      }
      logger2.info(`Update has already been downloaded to ${updateFile}).`);
      this._file = cachedUpdateFile;
      return cachedUpdateFile;
    }
    async setDownloadedFile(downloadedFile, packageFile, versionInfo, fileInfo, updateFileName, isSaveCache) {
      this._file = downloadedFile;
      this._packageFile = packageFile;
      this.versionInfo = versionInfo;
      this.fileInfo = fileInfo;
      this._downloadedFileInfo = {
        fileName: updateFileName,
        sha512: fileInfo.info.sha512,
        isAdminRightsRequired: fileInfo.info.isAdminRightsRequired === true
      };
      if (isSaveCache) {
        await (0, fs_extra_1.outputJson)(this.getUpdateInfoFile(), this._downloadedFileInfo);
      }
    }
    async clear() {
      this._file = null;
      this._packageFile = null;
      this.versionInfo = null;
      this.fileInfo = null;
      await this.cleanCacheDirForPendingUpdate();
    }
    async cleanCacheDirForPendingUpdate() {
      try {
        await (0, fs_extra_1.emptyDir)(this.cacheDirForPendingUpdate);
      } catch (_ignore) {
      }
    }
    /**
     * Returns "update-info.json" which is created in the update cache directory's "pending" subfolder after the first update is downloaded.  If the update file does not exist then the cache is cleared and recreated.  If the update file exists then its properties are validated.
     * @param fileInfo
     * @param logger
     */
    async getValidCachedUpdateFile(fileInfo, logger2) {
      const updateInfoFilePath = this.getUpdateInfoFile();
      const doesUpdateInfoFileExist = await (0, fs_extra_1.pathExists)(updateInfoFilePath);
      if (!doesUpdateInfoFileExist) {
        return null;
      }
      let cachedInfo;
      try {
        cachedInfo = await (0, fs_extra_1.readJson)(updateInfoFilePath);
      } catch (error2) {
        let message = `No cached update info available`;
        if (error2.code !== "ENOENT") {
          await this.cleanCacheDirForPendingUpdate();
          message += ` (error on read: ${error2.message})`;
        }
        logger2.info(message);
        return null;
      }
      const isCachedInfoFileNameValid = (cachedInfo === null || cachedInfo === void 0 ? void 0 : cachedInfo.fileName) !== null;
      if (!isCachedInfoFileNameValid) {
        logger2.warn(`Cached update info is corrupted: no fileName, directory for cached update will be cleaned`);
        await this.cleanCacheDirForPendingUpdate();
        return null;
      }
      if (fileInfo.info.sha512 !== cachedInfo.sha512) {
        logger2.info(`Cached update sha512 checksum doesn't match the latest available update. New update must be downloaded. Cached: ${cachedInfo.sha512}, expected: ${fileInfo.info.sha512}. Directory for cached update will be cleaned`);
        await this.cleanCacheDirForPendingUpdate();
        return null;
      }
      const updateFile = path.join(this.cacheDirForPendingUpdate, cachedInfo.fileName);
      if (!await (0, fs_extra_1.pathExists)(updateFile)) {
        logger2.info("Cached update file doesn't exist");
        return null;
      }
      const sha512 = await hashFile(updateFile);
      if (fileInfo.info.sha512 !== sha512) {
        logger2.warn(`Sha512 checksum doesn't match the latest available update. New update must be downloaded. Cached: ${sha512}, expected: ${fileInfo.info.sha512}`);
        await this.cleanCacheDirForPendingUpdate();
        return null;
      }
      this._downloadedFileInfo = cachedInfo;
      return updateFile;
    }
    getUpdateInfoFile() {
      return path.join(this.cacheDirForPendingUpdate, "update-info.json");
    }
  };
  DownloadedUpdateHelper.DownloadedUpdateHelper = DownloadedUpdateHelper$1;
  function hashFile(file2, algorithm = "sha512", encoding = "base64", options) {
    return new Promise((resolve, reject) => {
      const hash = (0, crypto_1.createHash)(algorithm);
      hash.on("error", reject).setEncoding(encoding);
      (0, fs_1.createReadStream)(file2, {
        ...options,
        highWaterMark: 1024 * 1024
        /* better to use more memory but hash faster */
      }).on("error", reject).on("end", () => {
        hash.end();
        resolve(hash.read());
      }).pipe(hash, { end: false });
    });
  }
  async function createTempUpdateFile(name, cacheDir, log) {
    let nameCounter = 0;
    let result = path.join(cacheDir, name);
    for (let i = 0; i < 3; i++) {
      try {
        await (0, fs_extra_1.unlink)(result);
        return result;
      } catch (e) {
        if (e.code === "ENOENT") {
          return result;
        }
        log.warn(`Error on remove temp update file: ${e}`);
        result = path.join(cacheDir, `${nameCounter++}-${name}`);
      }
    }
    return result;
  }
  return DownloadedUpdateHelper;
}
var ElectronAppAdapter = {};
var AppAdapter = {};
var hasRequiredAppAdapter;
function requireAppAdapter() {
  if (hasRequiredAppAdapter) return AppAdapter;
  hasRequiredAppAdapter = 1;
  Object.defineProperty(AppAdapter, "__esModule", { value: true });
  AppAdapter.getAppCacheDir = getAppCacheDir;
  const path = require$$1$1;
  const os_1 = os;
  function getAppCacheDir() {
    const homedir = (0, os_1.homedir)();
    let result;
    if (process.platform === "win32") {
      result = process.env["LOCALAPPDATA"] || path.join(homedir, "AppData", "Local");
    } else if (process.platform === "darwin") {
      result = path.join(homedir, "Library", "Caches");
    } else {
      result = process.env["XDG_CACHE_HOME"] || path.join(homedir, ".cache");
    }
    return result;
  }
  return AppAdapter;
}
var hasRequiredElectronAppAdapter;
function requireElectronAppAdapter() {
  if (hasRequiredElectronAppAdapter) return ElectronAppAdapter;
  hasRequiredElectronAppAdapter = 1;
  Object.defineProperty(ElectronAppAdapter, "__esModule", { value: true });
  ElectronAppAdapter.ElectronAppAdapter = void 0;
  const path = require$$1$1;
  const AppAdapter_1 = requireAppAdapter();
  let ElectronAppAdapter$1 = class ElectronAppAdapter {
    constructor(app = require$$1.app) {
      this.app = app;
    }
    whenReady() {
      return this.app.whenReady();
    }
    get version() {
      return this.app.getVersion();
    }
    get name() {
      return this.app.getName();
    }
    get isPackaged() {
      return this.app.isPackaged === true;
    }
    get appUpdateConfigPath() {
      return this.isPackaged ? path.join(process.resourcesPath, "app-update.yml") : path.join(this.app.getAppPath(), "dev-app-update.yml");
    }
    get userDataPath() {
      return this.app.getPath("userData");
    }
    get baseCachePath() {
      return (0, AppAdapter_1.getAppCacheDir)();
    }
    quit() {
      this.app.quit();
    }
    relaunch() {
      this.app.relaunch();
    }
    onQuit(handler) {
      this.app.once("quit", (_, exitCode) => handler(exitCode));
    }
  };
  ElectronAppAdapter.ElectronAppAdapter = ElectronAppAdapter$1;
  return ElectronAppAdapter;
}
var electronHttpExecutor = {};
var hasRequiredElectronHttpExecutor;
function requireElectronHttpExecutor() {
  if (hasRequiredElectronHttpExecutor) return electronHttpExecutor;
  hasRequiredElectronHttpExecutor = 1;
  (function(exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ElectronHttpExecutor = exports.NET_SESSION_NAME = void 0;
    exports.getNetSession = getNetSession;
    const builder_util_runtime_1 = requireOut();
    exports.NET_SESSION_NAME = "electron-updater";
    function getNetSession() {
      return require$$1.session.fromPartition(exports.NET_SESSION_NAME, {
        cache: false
      });
    }
    class ElectronHttpExecutor extends builder_util_runtime_1.HttpExecutor {
      constructor(proxyLoginCallback) {
        super();
        this.proxyLoginCallback = proxyLoginCallback;
        this.cachedSession = null;
      }
      async download(url, destination, options) {
        return await options.cancellationToken.createPromise((resolve, reject, onCancel) => {
          const requestOptions = {
            headers: options.headers || void 0,
            redirect: "manual"
          };
          (0, builder_util_runtime_1.configureRequestUrl)(url, requestOptions);
          (0, builder_util_runtime_1.configureRequestOptions)(requestOptions);
          this.doDownload(requestOptions, {
            destination,
            options,
            onCancel,
            callback: (error2) => {
              if (error2 == null) {
                resolve(destination);
              } else {
                reject(error2);
              }
            },
            responseHandler: null
          }, 0);
        });
      }
      createRequest(options, callback) {
        if (options.headers && options.headers.Host) {
          options.host = options.headers.Host;
          delete options.headers.Host;
        }
        if (this.cachedSession == null) {
          this.cachedSession = getNetSession();
        }
        const request = require$$1.net.request({
          ...options,
          session: this.cachedSession
        });
        request.on("response", callback);
        if (this.proxyLoginCallback != null) {
          request.on("login", this.proxyLoginCallback);
        }
        return request;
      }
      addRedirectHandlers(request, options, reject, redirectCount, handler) {
        request.on("redirect", (statusCode, method, redirectUrl) => {
          request.abort();
          if (redirectCount > this.maxRedirects) {
            reject(this.createMaxRedirectError());
          } else {
            handler(builder_util_runtime_1.HttpExecutor.prepareRedirectUrlOptions(redirectUrl, options));
          }
        });
      }
    }
    exports.ElectronHttpExecutor = ElectronHttpExecutor;
  })(electronHttpExecutor);
  return electronHttpExecutor;
}
var GenericProvider = {};
var util = {};
var hasRequiredUtil;
function requireUtil() {
  if (hasRequiredUtil) return util;
  hasRequiredUtil = 1;
  Object.defineProperty(util, "__esModule", { value: true });
  util.newBaseUrl = newBaseUrl;
  util.newUrlFromBase = newUrlFromBase;
  util.getChannelFilename = getChannelFilename;
  const url_1 = require$$2;
  function newBaseUrl(url) {
    const result = new url_1.URL(url);
    if (!result.pathname.endsWith("/")) {
      result.pathname += "/";
    }
    return result;
  }
  function newUrlFromBase(pathname, baseUrl, addRandomQueryToAvoidCaching = false) {
    const result = new url_1.URL(pathname, baseUrl);
    const search = baseUrl.search;
    if (search != null && search.length !== 0) {
      result.search = search;
    } else if (addRandomQueryToAvoidCaching) {
      result.search = `noCache=${Date.now().toString(32)}`;
    }
    return result;
  }
  function getChannelFilename(channel) {
    return `${channel}.yml`;
  }
  return util;
}
var Provider = {};
var lodash_escaperegexp;
var hasRequiredLodash_escaperegexp;
function requireLodash_escaperegexp() {
  if (hasRequiredLodash_escaperegexp) return lodash_escaperegexp;
  hasRequiredLodash_escaperegexp = 1;
  var symbolTag = "[object Symbol]";
  var reRegExpChar = /[\\^$.*+?()[\]{}|]/g, reHasRegExpChar = RegExp(reRegExpChar.source);
  var freeGlobal = typeof commonjsGlobal == "object" && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;
  var freeSelf = typeof self == "object" && self && self.Object === Object && self;
  var root = freeGlobal || freeSelf || Function("return this")();
  var objectProto = Object.prototype;
  var objectToString = objectProto.toString;
  var Symbol2 = root.Symbol;
  var symbolProto = Symbol2 ? Symbol2.prototype : void 0, symbolToString = symbolProto ? symbolProto.toString : void 0;
  function baseToString(value) {
    if (typeof value == "string") {
      return value;
    }
    if (isSymbol(value)) {
      return symbolToString ? symbolToString.call(value) : "";
    }
    var result = value + "";
    return result == "0" && 1 / value == -Infinity ? "-0" : result;
  }
  function isObjectLike(value) {
    return !!value && typeof value == "object";
  }
  function isSymbol(value) {
    return typeof value == "symbol" || isObjectLike(value) && objectToString.call(value) == symbolTag;
  }
  function toString(value) {
    return value == null ? "" : baseToString(value);
  }
  function escapeRegExp(string) {
    string = toString(string);
    return string && reHasRegExpChar.test(string) ? string.replace(reRegExpChar, "\\$&") : string;
  }
  lodash_escaperegexp = escapeRegExp;
  return lodash_escaperegexp;
}
var hasRequiredProvider;
function requireProvider() {
  if (hasRequiredProvider) return Provider;
  hasRequiredProvider = 1;
  Object.defineProperty(Provider, "__esModule", { value: true });
  Provider.Provider = void 0;
  Provider.findFile = findFile;
  Provider.parseUpdateInfo = parseUpdateInfo;
  Provider.getFileList = getFileList;
  Provider.resolveFiles = resolveFiles;
  const builder_util_runtime_1 = requireOut();
  const js_yaml_1 = requireJsYaml();
  const url_1 = require$$2;
  const util_1 = requireUtil();
  const escapeRegExp = requireLodash_escaperegexp();
  let Provider$1 = class Provider {
    constructor(runtimeOptions) {
      this.runtimeOptions = runtimeOptions;
      this.requestHeaders = null;
      this.executor = runtimeOptions.executor;
    }
    // By default, the blockmap file is in the same directory as the main file
    // But some providers may have a different blockmap file, so we need to override this method
    getBlockMapFiles(baseUrl, oldVersion, newVersion, oldBlockMapFileBaseUrl = null) {
      const newBlockMapUrl = (0, util_1.newUrlFromBase)(`${baseUrl.pathname}.blockmap`, baseUrl);
      const oldBlockMapUrl = (0, util_1.newUrlFromBase)(`${baseUrl.pathname.replace(new RegExp(escapeRegExp(newVersion), "g"), oldVersion)}.blockmap`, oldBlockMapFileBaseUrl ? new url_1.URL(oldBlockMapFileBaseUrl) : baseUrl);
      return [oldBlockMapUrl, newBlockMapUrl];
    }
    get isUseMultipleRangeRequest() {
      return this.runtimeOptions.isUseMultipleRangeRequest !== false;
    }
    getChannelFilePrefix() {
      if (this.runtimeOptions.platform === "linux") {
        const arch = process.env["TEST_UPDATER_ARCH"] || process.arch;
        const archSuffix = arch === "x64" ? "" : `-${arch}`;
        return "-linux" + archSuffix;
      } else {
        return this.runtimeOptions.platform === "darwin" ? "-mac" : "";
      }
    }
    // due to historical reasons for windows we use channel name without platform specifier
    getDefaultChannelName() {
      return this.getCustomChannelName("latest");
    }
    getCustomChannelName(channel) {
      return `${channel}${this.getChannelFilePrefix()}`;
    }
    get fileExtraDownloadHeaders() {
      return null;
    }
    setRequestHeaders(value) {
      this.requestHeaders = value;
    }
    /**
     * Method to perform API request only to resolve update info, but not to download update.
     */
    httpRequest(url, headers, cancellationToken) {
      return this.executor.request(this.createRequestOptions(url, headers), cancellationToken);
    }
    createRequestOptions(url, headers) {
      const result = {};
      if (this.requestHeaders == null) {
        if (headers != null) {
          result.headers = headers;
        }
      } else {
        result.headers = headers == null ? this.requestHeaders : { ...this.requestHeaders, ...headers };
      }
      (0, builder_util_runtime_1.configureRequestUrl)(url, result);
      return result;
    }
  };
  Provider.Provider = Provider$1;
  function findFile(files, extension, not) {
    var _a;
    if (files.length === 0) {
      throw (0, builder_util_runtime_1.newError)("No files provided", "ERR_UPDATER_NO_FILES_PROVIDED");
    }
    const filteredFiles = files.filter((it) => it.url.pathname.toLowerCase().endsWith(`.${extension.toLowerCase()}`));
    const result = (_a = filteredFiles.find((it) => [it.url.pathname, it.info.url].some((n) => n.includes(process.arch)))) !== null && _a !== void 0 ? _a : filteredFiles.shift();
    if (result) {
      return result;
    } else if (not == null) {
      return files[0];
    } else {
      return files.find((fileInfo) => !not.some((ext) => fileInfo.url.pathname.toLowerCase().endsWith(`.${ext.toLowerCase()}`)));
    }
  }
  function parseUpdateInfo(rawData, channelFile, channelFileUrl) {
    if (rawData == null) {
      throw (0, builder_util_runtime_1.newError)(`Cannot parse update info from ${channelFile} in the latest release artifacts (${channelFileUrl}): rawData: null`, "ERR_UPDATER_INVALID_UPDATE_INFO");
    }
    let result;
    try {
      result = (0, js_yaml_1.load)(rawData);
    } catch (e) {
      throw (0, builder_util_runtime_1.newError)(`Cannot parse update info from ${channelFile} in the latest release artifacts (${channelFileUrl}): ${e.stack || e.message}, rawData: ${rawData}`, "ERR_UPDATER_INVALID_UPDATE_INFO");
    }
    return result;
  }
  function getFileList(updateInfo) {
    const files = updateInfo.files;
    if (files != null && files.length > 0) {
      return files;
    }
    if (updateInfo.path != null) {
      return [
        {
          url: updateInfo.path,
          sha2: updateInfo.sha2,
          sha512: updateInfo.sha512
        }
      ];
    } else {
      throw (0, builder_util_runtime_1.newError)(`No files provided: ${(0, builder_util_runtime_1.safeStringifyJson)(updateInfo)}`, "ERR_UPDATER_NO_FILES_PROVIDED");
    }
  }
  function resolveFiles(updateInfo, baseUrl, pathTransformer = (p) => p) {
    const files = getFileList(updateInfo);
    const result = files.map((fileInfo) => {
      if (fileInfo.sha2 == null && fileInfo.sha512 == null) {
        throw (0, builder_util_runtime_1.newError)(`Update info doesn't contain nor sha256 neither sha512 checksum: ${(0, builder_util_runtime_1.safeStringifyJson)(fileInfo)}`, "ERR_UPDATER_NO_CHECKSUM");
      }
      return {
        url: (0, util_1.newUrlFromBase)(pathTransformer(fileInfo.url), baseUrl),
        info: fileInfo
      };
    });
    const packages = updateInfo.packages;
    const packageInfo = packages == null ? null : packages[process.arch] || packages.ia32;
    if (packageInfo != null) {
      result[0].packageInfo = {
        ...packageInfo,
        path: (0, util_1.newUrlFromBase)(pathTransformer(packageInfo.path), baseUrl).href
      };
    }
    return result;
  }
  return Provider;
}
var hasRequiredGenericProvider;
function requireGenericProvider() {
  if (hasRequiredGenericProvider) return GenericProvider;
  hasRequiredGenericProvider = 1;
  Object.defineProperty(GenericProvider, "__esModule", { value: true });
  GenericProvider.GenericProvider = void 0;
  const builder_util_runtime_1 = requireOut();
  const util_1 = requireUtil();
  const Provider_1 = requireProvider();
  let GenericProvider$1 = class GenericProvider extends Provider_1.Provider {
    constructor(configuration, updater, runtimeOptions) {
      super(runtimeOptions);
      this.configuration = configuration;
      this.updater = updater;
      this.baseUrl = (0, util_1.newBaseUrl)(this.configuration.url);
    }
    get channel() {
      const result = this.updater.channel || this.configuration.channel;
      return result == null ? this.getDefaultChannelName() : this.getCustomChannelName(result);
    }
    async getLatestVersion() {
      const channelFile = (0, util_1.getChannelFilename)(this.channel);
      const channelUrl = (0, util_1.newUrlFromBase)(channelFile, this.baseUrl, this.updater.isAddNoCacheQuery);
      for (let attemptNumber = 0; ; attemptNumber++) {
        try {
          return (0, Provider_1.parseUpdateInfo)(await this.httpRequest(channelUrl), channelFile, channelUrl);
        } catch (e) {
          if (e instanceof builder_util_runtime_1.HttpError && e.statusCode === 404) {
            throw (0, builder_util_runtime_1.newError)(`Cannot find channel "${channelFile}" update info: ${e.stack || e.message}`, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
          } else if (e.code === "ECONNREFUSED") {
            if (attemptNumber < 3) {
              await new Promise((resolve, reject) => {
                try {
                  setTimeout(resolve, 1e3 * attemptNumber);
                } catch (e2) {
                  reject(e2);
                }
              });
              continue;
            }
          }
          throw e;
        }
      }
    }
    resolveFiles(updateInfo) {
      return (0, Provider_1.resolveFiles)(updateInfo, this.baseUrl);
    }
  };
  GenericProvider.GenericProvider = GenericProvider$1;
  return GenericProvider;
}
var providerFactory = {};
var BitbucketProvider = {};
var hasRequiredBitbucketProvider;
function requireBitbucketProvider() {
  if (hasRequiredBitbucketProvider) return BitbucketProvider;
  hasRequiredBitbucketProvider = 1;
  Object.defineProperty(BitbucketProvider, "__esModule", { value: true });
  BitbucketProvider.BitbucketProvider = void 0;
  const builder_util_runtime_1 = requireOut();
  const util_1 = requireUtil();
  const Provider_1 = requireProvider();
  let BitbucketProvider$1 = class BitbucketProvider extends Provider_1.Provider {
    constructor(configuration, updater, runtimeOptions) {
      super({
        ...runtimeOptions,
        isUseMultipleRangeRequest: false
      });
      this.configuration = configuration;
      this.updater = updater;
      const { owner, slug } = configuration;
      this.baseUrl = (0, util_1.newBaseUrl)(`https://api.bitbucket.org/2.0/repositories/${owner}/${slug}/downloads`);
    }
    get channel() {
      return this.updater.channel || this.configuration.channel || "latest";
    }
    async getLatestVersion() {
      const cancellationToken = new builder_util_runtime_1.CancellationToken();
      const channelFile = (0, util_1.getChannelFilename)(this.getCustomChannelName(this.channel));
      const channelUrl = (0, util_1.newUrlFromBase)(channelFile, this.baseUrl, this.updater.isAddNoCacheQuery);
      try {
        const updateInfo = await this.httpRequest(channelUrl, void 0, cancellationToken);
        return (0, Provider_1.parseUpdateInfo)(updateInfo, channelFile, channelUrl);
      } catch (e) {
        throw (0, builder_util_runtime_1.newError)(`Unable to find latest version on ${this.toString()}, please ensure release exists: ${e.stack || e.message}`, "ERR_UPDATER_LATEST_VERSION_NOT_FOUND");
      }
    }
    resolveFiles(updateInfo) {
      return (0, Provider_1.resolveFiles)(updateInfo, this.baseUrl);
    }
    toString() {
      const { owner, slug } = this.configuration;
      return `Bitbucket (owner: ${owner}, slug: ${slug}, channel: ${this.channel})`;
    }
  };
  BitbucketProvider.BitbucketProvider = BitbucketProvider$1;
  return BitbucketProvider;
}
var GitHubProvider = {};
var hasRequiredGitHubProvider;
function requireGitHubProvider() {
  if (hasRequiredGitHubProvider) return GitHubProvider;
  hasRequiredGitHubProvider = 1;
  Object.defineProperty(GitHubProvider, "__esModule", { value: true });
  GitHubProvider.GitHubProvider = GitHubProvider.BaseGitHubProvider = void 0;
  GitHubProvider.computeReleaseNotes = computeReleaseNotes;
  const builder_util_runtime_1 = requireOut();
  const semver2 = requireSemver();
  const url_1 = require$$2;
  const util_1 = requireUtil();
  const Provider_1 = requireProvider();
  const hrefRegExp = /\/tag\/(v?[^/]+)$/;
  class BaseGitHubProvider extends Provider_1.Provider {
    constructor(options, defaultHost, runtimeOptions) {
      super({
        ...runtimeOptions,
        /* because GitHib uses S3 */
        isUseMultipleRangeRequest: false
      });
      this.options = options;
      this.baseUrl = (0, util_1.newBaseUrl)((0, builder_util_runtime_1.githubUrl)(options, defaultHost));
      const apiHost = defaultHost === "github.com" ? "api.github.com" : defaultHost;
      this.baseApiUrl = (0, util_1.newBaseUrl)((0, builder_util_runtime_1.githubUrl)(options, apiHost));
    }
    computeGithubBasePath(result) {
      const host = this.options.host;
      return host && !["github.com", "api.github.com"].includes(host) ? `/api/v3${result}` : result;
    }
  }
  GitHubProvider.BaseGitHubProvider = BaseGitHubProvider;
  let GitHubProvider$1 = class GitHubProvider extends BaseGitHubProvider {
    constructor(options, updater, runtimeOptions) {
      super(options, "github.com", runtimeOptions);
      this.options = options;
      this.updater = updater;
    }
    get channel() {
      const result = this.updater.channel || this.options.channel;
      return result == null ? this.getDefaultChannelName() : this.getCustomChannelName(result);
    }
    async getLatestVersion() {
      var _a, _b, _c, _d, _e;
      const cancellationToken = new builder_util_runtime_1.CancellationToken();
      const feedXml = await this.httpRequest((0, util_1.newUrlFromBase)(`${this.basePath}.atom`, this.baseUrl), {
        accept: "application/xml, application/atom+xml, text/xml, */*"
      }, cancellationToken);
      const feed = (0, builder_util_runtime_1.parseXml)(feedXml);
      let latestRelease = feed.element("entry", false, `No published versions on GitHub`);
      let tag = null;
      try {
        if (this.updater.allowPrerelease) {
          const currentChannel = ((_a = this.updater) === null || _a === void 0 ? void 0 : _a.channel) || ((_b = semver2.prerelease(this.updater.currentVersion)) === null || _b === void 0 ? void 0 : _b[0]) || null;
          if (currentChannel === null) {
            tag = hrefRegExp.exec(latestRelease.element("link").attribute("href"))[1];
          } else {
            for (const element of feed.getElements("entry")) {
              const hrefElement = hrefRegExp.exec(element.element("link").attribute("href"));
              if (hrefElement === null) {
                continue;
              }
              const hrefTag = hrefElement[1];
              if (!semver2.valid(hrefTag)) {
                continue;
              }
              const hrefChannel = ((_c = semver2.prerelease(hrefTag)) === null || _c === void 0 ? void 0 : _c[0]) || null;
              const shouldFetchVersion = !currentChannel || ["alpha", "beta"].includes(currentChannel);
              const isCustomChannel = hrefChannel !== null && !["alpha", "beta"].includes(String(hrefChannel));
              const channelMismatch = currentChannel === "beta" && hrefChannel === "alpha";
              if (shouldFetchVersion && !isCustomChannel && !channelMismatch) {
                tag = hrefTag;
                latestRelease = element;
                break;
              }
              const isNextPreRelease = hrefChannel && hrefChannel === currentChannel;
              if (isNextPreRelease) {
                tag = hrefTag;
                latestRelease = element;
                break;
              }
            }
          }
        } else {
          tag = await this.getLatestTagName(cancellationToken);
          for (const element of feed.getElements("entry")) {
            const hrefMatch = hrefRegExp.exec(element.element("link").attribute("href"));
            if (hrefMatch == null) {
              continue;
            }
            if (hrefMatch[1] === tag) {
              latestRelease = element;
              break;
            }
          }
        }
      } catch (e) {
        throw (0, builder_util_runtime_1.newError)(`Cannot parse releases feed: ${e.stack || e.message},
XML:
${feedXml}`, "ERR_UPDATER_INVALID_RELEASE_FEED");
      }
      if (tag == null) {
        throw (0, builder_util_runtime_1.newError)(`No published versions on GitHub`, "ERR_UPDATER_NO_PUBLISHED_VERSIONS");
      }
      let rawData;
      let channelFile = "";
      let channelFileUrl = "";
      const fetchData = async (channelName) => {
        channelFile = (0, util_1.getChannelFilename)(channelName);
        channelFileUrl = (0, util_1.newUrlFromBase)(this.getBaseDownloadPath(String(tag), channelFile), this.baseUrl);
        const requestOptions = this.createRequestOptions(channelFileUrl);
        try {
          return await this.executor.request(requestOptions, cancellationToken);
        } catch (e) {
          if (e instanceof builder_util_runtime_1.HttpError && e.statusCode === 404) {
            throw (0, builder_util_runtime_1.newError)(`Cannot find ${channelFile} in the latest release artifacts (${channelFileUrl}): ${e.stack || e.message}`, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
          }
          throw e;
        }
      };
      try {
        let channel = this.channel;
        if (this.updater.allowPrerelease && ((_d = semver2.prerelease(tag)) === null || _d === void 0 ? void 0 : _d[0])) {
          channel = this.getCustomChannelName(String((_e = semver2.prerelease(tag)) === null || _e === void 0 ? void 0 : _e[0]));
        }
        rawData = await fetchData(channel);
      } catch (e) {
        if (this.updater.allowPrerelease) {
          rawData = await fetchData(this.getDefaultChannelName());
        } else {
          throw e;
        }
      }
      const result = (0, Provider_1.parseUpdateInfo)(rawData, channelFile, channelFileUrl);
      if (result.releaseName == null) {
        result.releaseName = latestRelease.elementValueOrEmpty("title");
      }
      if (result.releaseNotes == null) {
        result.releaseNotes = computeReleaseNotes(this.updater.currentVersion, this.updater.fullChangelog, feed, latestRelease);
      }
      return {
        tag,
        ...result
      };
    }
    async getLatestTagName(cancellationToken) {
      const options = this.options;
      const url = options.host == null || options.host === "github.com" ? (0, util_1.newUrlFromBase)(`${this.basePath}/latest`, this.baseUrl) : new url_1.URL(`${this.computeGithubBasePath(`/repos/${options.owner}/${options.repo}/releases`)}/latest`, this.baseApiUrl);
      try {
        const rawData = await this.httpRequest(url, { Accept: "application/json" }, cancellationToken);
        if (rawData == null) {
          return null;
        }
        const releaseInfo = JSON.parse(rawData);
        return releaseInfo.tag_name;
      } catch (e) {
        throw (0, builder_util_runtime_1.newError)(`Unable to find latest version on GitHub (${url}), please ensure a production release exists: ${e.stack || e.message}`, "ERR_UPDATER_LATEST_VERSION_NOT_FOUND");
      }
    }
    get basePath() {
      return `/${this.options.owner}/${this.options.repo}/releases`;
    }
    resolveFiles(updateInfo) {
      return (0, Provider_1.resolveFiles)(updateInfo, this.baseUrl, (p) => this.getBaseDownloadPath(updateInfo.tag, p.replace(/ /g, "-")));
    }
    getBaseDownloadPath(tag, fileName) {
      return `${this.basePath}/download/${tag}/${fileName}`;
    }
  };
  GitHubProvider.GitHubProvider = GitHubProvider$1;
  function getNoteValue(parent) {
    const result = parent.elementValueOrEmpty("content");
    return result === "No content." ? "" : result;
  }
  function computeReleaseNotes(currentVersion, isFullChangelog, feed, latestRelease) {
    if (!isFullChangelog) {
      return getNoteValue(latestRelease);
    }
    const releaseVersionRegExp = /\/tag\/v?([^/]+)$/;
    let latestVersion = void 0;
    try {
      latestVersion = releaseVersionRegExp.exec(latestRelease.element("link").attribute("href"))[1];
      latestVersion = semver2.valid(latestVersion) ? latestVersion : void 0;
    } catch {
    }
    if (latestVersion == null) {
      return null;
    }
    const releaseNotes = [];
    for (const release of feed.getElements("entry")) {
      let versionRelease;
      try {
        const match = releaseVersionRegExp.exec(release.element("link").attribute("href"));
        if (!match) {
          continue;
        }
        versionRelease = match[1];
      } catch {
        continue;
      }
      if (!semver2.valid(versionRelease)) {
        continue;
      }
      const isGreaterThanCurrent = semver2.gt(versionRelease, currentVersion.raw);
      const isLessOrEqualThanLatest = semver2.lte(versionRelease, latestVersion);
      if (isGreaterThanCurrent && isLessOrEqualThanLatest) {
        releaseNotes.push({
          version: versionRelease,
          note: getNoteValue(release)
        });
      }
    }
    return releaseNotes.sort((a, b) => semver2.rcompare(a.version, b.version));
  }
  return GitHubProvider;
}
var GitLabProvider = {};
var hasRequiredGitLabProvider;
function requireGitLabProvider() {
  if (hasRequiredGitLabProvider) return GitLabProvider;
  hasRequiredGitLabProvider = 1;
  Object.defineProperty(GitLabProvider, "__esModule", { value: true });
  GitLabProvider.GitLabProvider = void 0;
  const builder_util_runtime_1 = requireOut();
  const url_1 = require$$2;
  const escapeRegExp = requireLodash_escaperegexp();
  const util_1 = requireUtil();
  const Provider_1 = requireProvider();
  let GitLabProvider$1 = class GitLabProvider extends Provider_1.Provider {
    /**
     * Normalizes filenames by replacing spaces and underscores with dashes.
     *
     * This is a workaround to handle filename formatting differences between tools:
     * - electron-builder formats filenames like "test file.txt" as "test-file.txt"
     * - GitLab may provide asset URLs using underscores, such as "test_file.txt"
     *
     * Because of this mismatch, we can't reliably extract the correct filename from
     * the asset path without normalization. This function ensures consistent matching
     * across different filename formats by converting all spaces and underscores to dashes.
     *
     * @param filename The filename to normalize
     * @returns The normalized filename with spaces and underscores replaced by dashes
     */
    normalizeFilename(filename) {
      return filename.replace(/ |_/g, "-");
    }
    constructor(options, updater, runtimeOptions) {
      super({
        ...runtimeOptions,
        // GitLab might not support multiple range requests efficiently
        isUseMultipleRangeRequest: false
      });
      this.options = options;
      this.updater = updater;
      this.cachedLatestVersion = null;
      const defaultHost = "gitlab.com";
      const host = options.host || defaultHost;
      this.baseApiUrl = (0, util_1.newBaseUrl)(`https://${host}/api/v4`);
    }
    createRequestOptions(url, headers) {
      const result = super.createRequestOptions(url, headers);
      result.redirect = "manual";
      return result;
    }
    get channel() {
      const result = this.updater.channel || this.options.channel;
      return result == null ? this.getDefaultChannelName() : this.getCustomChannelName(result);
    }
    async getLatestVersion() {
      const cancellationToken = new builder_util_runtime_1.CancellationToken();
      const latestReleaseUrl = (0, util_1.newUrlFromBase)(`projects/${this.options.projectId}/releases/permalink/latest`, this.baseApiUrl);
      const header = { Accept: "application/json", ...this.setAuthHeaderForToken(this.options.token || null) };
      let releaseResponse;
      try {
        releaseResponse = await this.httpRequest(latestReleaseUrl, header, cancellationToken);
      } catch (e) {
        throw (0, builder_util_runtime_1.newError)(`Unable to find latest release on GitLab (${latestReleaseUrl}): ${e.stack || e.message}`, "ERR_UPDATER_LATEST_VERSION_NOT_FOUND");
      }
      if (!releaseResponse) {
        throw (0, builder_util_runtime_1.newError)("No published releases on GitLab", "ERR_UPDATER_NO_PUBLISHED_VERSIONS");
      }
      let latestRelease;
      try {
        latestRelease = JSON.parse(releaseResponse);
      } catch (e) {
        throw (0, builder_util_runtime_1.newError)(`Unable to parse latest release response from GitLab (${latestReleaseUrl}): response was not valid JSON: ${e.stack || e.message}`, "ERR_UPDATER_LATEST_VERSION_NOT_FOUND");
      }
      if (latestRelease.upcoming_release) {
        throw (0, builder_util_runtime_1.newError)("Latest GitLab release is scheduled but not yet published", "ERR_UPDATER_LATEST_VERSION_NOT_FOUND");
      }
      const tag = latestRelease.tag_name;
      let rawData = null;
      let channelFile = "";
      let channelFileUrl = null;
      const fetchChannelData = async (channelName) => {
        channelFile = (0, util_1.getChannelFilename)(channelName);
        const channelAsset = latestRelease.assets.links.find((asset) => asset.name === channelFile);
        if (!channelAsset) {
          throw (0, builder_util_runtime_1.newError)(`Cannot find ${channelFile} in the latest release assets`, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
        }
        channelFileUrl = new url_1.URL(channelAsset.direct_asset_url);
        const authHeaders = this.setAuthHeaderForToken(this.options.token || null);
        const headers = Object.keys(authHeaders).length ? authHeaders : void 0;
        try {
          const result2 = await this.httpRequest(channelFileUrl, headers, cancellationToken);
          if (!result2) {
            throw (0, builder_util_runtime_1.newError)(`Empty response from ${channelFileUrl}`, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
          }
          return result2;
        } catch (e) {
          if (e instanceof builder_util_runtime_1.HttpError && e.statusCode === 404) {
            throw (0, builder_util_runtime_1.newError)(`Cannot find ${channelFile} in the latest release artifacts (${channelFileUrl}): ${e.stack || e.message}`, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
          }
          throw e;
        }
      };
      try {
        rawData = await fetchChannelData(this.channel);
      } catch (e) {
        if (this.channel !== this.getDefaultChannelName()) {
          rawData = await fetchChannelData(this.getDefaultChannelName());
        } else {
          throw e;
        }
      }
      if (!rawData) {
        throw (0, builder_util_runtime_1.newError)(`Unable to parse channel data from ${channelFile}`, "ERR_UPDATER_INVALID_UPDATE_INFO");
      }
      const result = (0, Provider_1.parseUpdateInfo)(rawData, channelFile, channelFileUrl);
      if (result.releaseName == null) {
        result.releaseName = latestRelease.name;
      }
      if (result.releaseNotes == null) {
        result.releaseNotes = latestRelease.description || null;
      }
      const gitlabUpdateInfo = {
        tag,
        assets: this.convertAssetsToMap(latestRelease.assets),
        ...result
      };
      this.cachedLatestVersion = gitlabUpdateInfo;
      return gitlabUpdateInfo;
    }
    /**
     * Utility function to convert GitlabReleaseAsset to Map<string, string>
     * Maps asset names to their download URLs
     */
    convertAssetsToMap(assets) {
      const assetsMap = /* @__PURE__ */ new Map();
      for (const asset of assets.links) {
        assetsMap.set(this.normalizeFilename(asset.name), asset.direct_asset_url);
      }
      return assetsMap;
    }
    /**
     * Find blockmap file URL in assets map for a specific filename
     */
    findBlockMapInAssets(assets, filename) {
      const possibleBlockMapNames = [`${filename}.blockmap`, `${this.normalizeFilename(filename)}.blockmap`];
      for (const blockMapName of possibleBlockMapNames) {
        const assetUrl = assets.get(blockMapName);
        if (assetUrl) {
          return new url_1.URL(assetUrl);
        }
      }
      return null;
    }
    async fetchReleaseInfoByVersion(version) {
      const cancellationToken = new builder_util_runtime_1.CancellationToken();
      const possibleReleaseIds = [`v${version}`, version];
      for (const releaseId of possibleReleaseIds) {
        const releaseUrl = (0, util_1.newUrlFromBase)(`projects/${this.options.projectId}/releases/${encodeURIComponent(releaseId)}`, this.baseApiUrl);
        try {
          const header = { Accept: "application/json", ...this.setAuthHeaderForToken(this.options.token || null) };
          const releaseResponse = await this.httpRequest(releaseUrl, header, cancellationToken);
          if (releaseResponse) {
            const release = JSON.parse(releaseResponse);
            return release;
          }
        } catch (e) {
          if (e instanceof builder_util_runtime_1.HttpError && e.statusCode === 404) {
            continue;
          }
          throw (0, builder_util_runtime_1.newError)(`Unable to find release ${releaseId} on GitLab (${releaseUrl}): ${e.stack || e.message}`, "ERR_UPDATER_RELEASE_NOT_FOUND");
        }
      }
      throw (0, builder_util_runtime_1.newError)(`Unable to find release with version ${version} (tried: ${possibleReleaseIds.join(", ")}) on GitLab`, "ERR_UPDATER_RELEASE_NOT_FOUND");
    }
    setAuthHeaderForToken(token) {
      const headers = {};
      if (token != null) {
        if (token.startsWith("Bearer")) {
          headers.authorization = token;
        } else {
          headers["PRIVATE-TOKEN"] = token;
        }
      }
      return headers;
    }
    /**
     * Get version info for blockmap files, using cache when possible
     */
    async getVersionInfoForBlockMap(version) {
      if (this.cachedLatestVersion && this.cachedLatestVersion.version === version) {
        return this.cachedLatestVersion.assets;
      }
      const versionInfo = await this.fetchReleaseInfoByVersion(version);
      if (versionInfo && versionInfo.assets) {
        return this.convertAssetsToMap(versionInfo.assets);
      }
      return null;
    }
    /**
     * Find blockmap URLs from version assets
     */
    async findBlockMapUrlsFromAssets(oldVersion, newVersion, baseFilename) {
      let newBlockMapUrl = null;
      let oldBlockMapUrl = null;
      const newVersionAssets = await this.getVersionInfoForBlockMap(newVersion);
      if (newVersionAssets) {
        newBlockMapUrl = this.findBlockMapInAssets(newVersionAssets, baseFilename);
      }
      const oldVersionAssets = await this.getVersionInfoForBlockMap(oldVersion);
      if (oldVersionAssets) {
        const oldFilename = baseFilename.replace(new RegExp(escapeRegExp(newVersion), "g"), oldVersion);
        oldBlockMapUrl = this.findBlockMapInAssets(oldVersionAssets, oldFilename);
      }
      return [oldBlockMapUrl, newBlockMapUrl];
    }
    async getBlockMapFiles(baseUrl, oldVersion, newVersion, oldBlockMapFileBaseUrl = null) {
      if (this.options.uploadTarget === "project_upload") {
        const baseFilename = baseUrl.pathname.split("/").pop() || "";
        const [oldBlockMapUrl, newBlockMapUrl] = await this.findBlockMapUrlsFromAssets(oldVersion, newVersion, baseFilename);
        if (!newBlockMapUrl) {
          throw (0, builder_util_runtime_1.newError)(`Cannot find blockmap file for ${newVersion} in GitLab assets`, "ERR_UPDATER_BLOCKMAP_FILE_NOT_FOUND");
        }
        if (!oldBlockMapUrl) {
          throw (0, builder_util_runtime_1.newError)(`Cannot find blockmap file for ${oldVersion} in GitLab assets`, "ERR_UPDATER_BLOCKMAP_FILE_NOT_FOUND");
        }
        return [oldBlockMapUrl, newBlockMapUrl];
      } else {
        return super.getBlockMapFiles(baseUrl, oldVersion, newVersion, oldBlockMapFileBaseUrl);
      }
    }
    resolveFiles(updateInfo) {
      return (0, Provider_1.getFileList)(updateInfo).map((fileInfo) => {
        const possibleNames = [
          fileInfo.url,
          // Original filename
          this.normalizeFilename(fileInfo.url)
          // Normalized filename (spaces/underscores → dashes)
        ];
        const matchingAssetName = possibleNames.find((name) => updateInfo.assets.has(name));
        const assetUrl = matchingAssetName ? updateInfo.assets.get(matchingAssetName) : void 0;
        if (!assetUrl) {
          throw (0, builder_util_runtime_1.newError)(`Cannot find asset "${fileInfo.url}" in GitLab release assets. Available assets: ${Array.from(updateInfo.assets.keys()).join(", ")}`, "ERR_UPDATER_ASSET_NOT_FOUND");
        }
        return {
          url: new url_1.URL(assetUrl),
          info: fileInfo
        };
      });
    }
    toString() {
      return `GitLab (projectId: ${this.options.projectId}, channel: ${this.channel})`;
    }
  };
  GitLabProvider.GitLabProvider = GitLabProvider$1;
  return GitLabProvider;
}
var KeygenProvider = {};
var hasRequiredKeygenProvider;
function requireKeygenProvider() {
  if (hasRequiredKeygenProvider) return KeygenProvider;
  hasRequiredKeygenProvider = 1;
  Object.defineProperty(KeygenProvider, "__esModule", { value: true });
  KeygenProvider.KeygenProvider = void 0;
  const builder_util_runtime_1 = requireOut();
  const util_1 = requireUtil();
  const Provider_1 = requireProvider();
  let KeygenProvider$1 = class KeygenProvider extends Provider_1.Provider {
    constructor(configuration, updater, runtimeOptions) {
      super({
        ...runtimeOptions,
        isUseMultipleRangeRequest: false
      });
      this.configuration = configuration;
      this.updater = updater;
      this.defaultHostname = "api.keygen.sh";
      const host = this.configuration.host || this.defaultHostname;
      this.baseUrl = (0, util_1.newBaseUrl)(`https://${host}/v1/accounts/${this.configuration.account}/artifacts?product=${this.configuration.product}`);
    }
    get channel() {
      return this.updater.channel || this.configuration.channel || "stable";
    }
    async getLatestVersion() {
      const cancellationToken = new builder_util_runtime_1.CancellationToken();
      const channelFile = (0, util_1.getChannelFilename)(this.getCustomChannelName(this.channel));
      const channelUrl = (0, util_1.newUrlFromBase)(channelFile, this.baseUrl, this.updater.isAddNoCacheQuery);
      try {
        const updateInfo = await this.httpRequest(channelUrl, {
          Accept: "application/vnd.api+json",
          "Keygen-Version": "1.1"
        }, cancellationToken);
        return (0, Provider_1.parseUpdateInfo)(updateInfo, channelFile, channelUrl);
      } catch (e) {
        throw (0, builder_util_runtime_1.newError)(`Unable to find latest version on ${this.toString()}, please ensure release exists: ${e.stack || e.message}`, "ERR_UPDATER_LATEST_VERSION_NOT_FOUND");
      }
    }
    resolveFiles(updateInfo) {
      return (0, Provider_1.resolveFiles)(updateInfo, this.baseUrl);
    }
    toString() {
      const { account, product, platform } = this.configuration;
      return `Keygen (account: ${account}, product: ${product}, platform: ${platform}, channel: ${this.channel})`;
    }
  };
  KeygenProvider.KeygenProvider = KeygenProvider$1;
  return KeygenProvider;
}
var PrivateGitHubProvider = {};
var hasRequiredPrivateGitHubProvider;
function requirePrivateGitHubProvider() {
  if (hasRequiredPrivateGitHubProvider) return PrivateGitHubProvider;
  hasRequiredPrivateGitHubProvider = 1;
  Object.defineProperty(PrivateGitHubProvider, "__esModule", { value: true });
  PrivateGitHubProvider.PrivateGitHubProvider = void 0;
  const builder_util_runtime_1 = requireOut();
  const js_yaml_1 = requireJsYaml();
  const path = require$$1$1;
  const url_1 = require$$2;
  const util_1 = requireUtil();
  const GitHubProvider_1 = requireGitHubProvider();
  const Provider_1 = requireProvider();
  let PrivateGitHubProvider$1 = class PrivateGitHubProvider extends GitHubProvider_1.BaseGitHubProvider {
    constructor(options, updater, token, runtimeOptions) {
      super(options, "api.github.com", runtimeOptions);
      this.updater = updater;
      this.token = token;
    }
    createRequestOptions(url, headers) {
      const result = super.createRequestOptions(url, headers);
      result.redirect = "manual";
      return result;
    }
    async getLatestVersion() {
      const cancellationToken = new builder_util_runtime_1.CancellationToken();
      const channelFile = (0, util_1.getChannelFilename)(this.getDefaultChannelName());
      const releaseInfo = await this.getLatestVersionInfo(cancellationToken);
      const asset = releaseInfo.assets.find((it) => it.name === channelFile);
      if (asset == null) {
        throw (0, builder_util_runtime_1.newError)(`Cannot find ${channelFile} in the release ${releaseInfo.html_url || releaseInfo.name}`, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
      }
      const url = new url_1.URL(asset.url);
      let result;
      try {
        result = (0, js_yaml_1.load)(await this.httpRequest(url, this.configureHeaders("application/octet-stream"), cancellationToken));
      } catch (e) {
        if (e instanceof builder_util_runtime_1.HttpError && e.statusCode === 404) {
          throw (0, builder_util_runtime_1.newError)(`Cannot find ${channelFile} in the latest release artifacts (${url}): ${e.stack || e.message}`, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
        }
        throw e;
      }
      result.assets = releaseInfo.assets;
      return result;
    }
    get fileExtraDownloadHeaders() {
      return this.configureHeaders("application/octet-stream");
    }
    configureHeaders(accept) {
      return {
        accept,
        authorization: `token ${this.token}`
      };
    }
    async getLatestVersionInfo(cancellationToken) {
      const allowPrerelease = this.updater.allowPrerelease;
      let basePath = this.basePath;
      if (!allowPrerelease) {
        basePath = `${basePath}/latest`;
      }
      const url = (0, util_1.newUrlFromBase)(basePath, this.baseUrl);
      try {
        const version = JSON.parse(await this.httpRequest(url, this.configureHeaders("application/vnd.github.v3+json"), cancellationToken));
        if (allowPrerelease) {
          const candidates = version.filter((it) => !it.draft);
          return candidates.find((it) => it.prerelease) || candidates[0];
        } else {
          return version;
        }
      } catch (e) {
        throw (0, builder_util_runtime_1.newError)(`Unable to find latest version on GitHub (${url}), please ensure a production release exists: ${e.stack || e.message}`, "ERR_UPDATER_LATEST_VERSION_NOT_FOUND");
      }
    }
    get basePath() {
      return this.computeGithubBasePath(`/repos/${this.options.owner}/${this.options.repo}/releases`);
    }
    resolveFiles(updateInfo) {
      return (0, Provider_1.getFileList)(updateInfo).map((it) => {
        const name = path.posix.basename(it.url).replace(/ /g, "-");
        const asset = updateInfo.assets.find((it2) => it2 != null && it2.name === name);
        if (asset == null) {
          throw (0, builder_util_runtime_1.newError)(`Cannot find asset "${name}" in: ${JSON.stringify(updateInfo.assets, null, 2)}`, "ERR_UPDATER_ASSET_NOT_FOUND");
        }
        return {
          url: new url_1.URL(asset.url),
          info: it
        };
      });
    }
  };
  PrivateGitHubProvider.PrivateGitHubProvider = PrivateGitHubProvider$1;
  return PrivateGitHubProvider;
}
var hasRequiredProviderFactory;
function requireProviderFactory() {
  if (hasRequiredProviderFactory) return providerFactory;
  hasRequiredProviderFactory = 1;
  Object.defineProperty(providerFactory, "__esModule", { value: true });
  providerFactory.isUrlProbablySupportMultiRangeRequests = isUrlProbablySupportMultiRangeRequests;
  providerFactory.createClient = createClient;
  const builder_util_runtime_1 = requireOut();
  const BitbucketProvider_1 = requireBitbucketProvider();
  const GenericProvider_1 = requireGenericProvider();
  const GitHubProvider_1 = requireGitHubProvider();
  const GitLabProvider_1 = requireGitLabProvider();
  const KeygenProvider_1 = requireKeygenProvider();
  const PrivateGitHubProvider_1 = requirePrivateGitHubProvider();
  function isUrlProbablySupportMultiRangeRequests(url) {
    return !url.includes("s3.amazonaws.com");
  }
  function createClient(data, updater, runtimeOptions) {
    if (typeof data === "string") {
      throw (0, builder_util_runtime_1.newError)("Please pass PublishConfiguration object", "ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION");
    }
    const provider = data.provider;
    switch (provider) {
      case "github": {
        const githubOptions = data;
        const token = (githubOptions.private ? process.env["GH_TOKEN"] || process.env["GITHUB_TOKEN"] : null) || githubOptions.token;
        if (token == null) {
          return new GitHubProvider_1.GitHubProvider(githubOptions, updater, runtimeOptions);
        } else {
          return new PrivateGitHubProvider_1.PrivateGitHubProvider(githubOptions, updater, token, runtimeOptions);
        }
      }
      case "bitbucket":
        return new BitbucketProvider_1.BitbucketProvider(data, updater, runtimeOptions);
      case "gitlab":
        return new GitLabProvider_1.GitLabProvider(data, updater, runtimeOptions);
      case "keygen":
        return new KeygenProvider_1.KeygenProvider(data, updater, runtimeOptions);
      case "s3":
      case "spaces":
        return new GenericProvider_1.GenericProvider({
          provider: "generic",
          url: (0, builder_util_runtime_1.getS3LikeProviderBaseUrl)(data),
          channel: data.channel || null
        }, updater, {
          ...runtimeOptions,
          // https://github.com/minio/minio/issues/5285#issuecomment-350428955
          isUseMultipleRangeRequest: false
        });
      case "generic": {
        const options = data;
        return new GenericProvider_1.GenericProvider(options, updater, {
          ...runtimeOptions,
          isUseMultipleRangeRequest: options.useMultipleRangeRequest !== false && isUrlProbablySupportMultiRangeRequests(options.url)
        });
      }
      case "custom": {
        const options = data;
        const constructor = options.updateProvider;
        if (!constructor) {
          throw (0, builder_util_runtime_1.newError)("Custom provider not specified", "ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION");
        }
        return new constructor(options, updater, runtimeOptions);
      }
      default:
        throw (0, builder_util_runtime_1.newError)(`Unsupported provider: ${provider}`, "ERR_UPDATER_UNSUPPORTED_PROVIDER");
    }
  }
  return providerFactory;
}
var GenericDifferentialDownloader = {};
var DifferentialDownloader = {};
var DataSplitter = {};
var downloadPlanBuilder = {};
var hasRequiredDownloadPlanBuilder;
function requireDownloadPlanBuilder() {
  if (hasRequiredDownloadPlanBuilder) return downloadPlanBuilder;
  hasRequiredDownloadPlanBuilder = 1;
  Object.defineProperty(downloadPlanBuilder, "__esModule", { value: true });
  downloadPlanBuilder.OperationKind = void 0;
  downloadPlanBuilder.computeOperations = computeOperations;
  var OperationKind;
  (function(OperationKind2) {
    OperationKind2[OperationKind2["COPY"] = 0] = "COPY";
    OperationKind2[OperationKind2["DOWNLOAD"] = 1] = "DOWNLOAD";
  })(OperationKind || (downloadPlanBuilder.OperationKind = OperationKind = {}));
  function computeOperations(oldBlockMap, newBlockMap, logger2) {
    const nameToOldBlocks = buildBlockFileMap(oldBlockMap.files);
    const nameToNewBlocks = buildBlockFileMap(newBlockMap.files);
    let lastOperation = null;
    const blockMapFile = newBlockMap.files[0];
    const operations = [];
    const name = blockMapFile.name;
    const oldEntry = nameToOldBlocks.get(name);
    if (oldEntry == null) {
      throw new Error(`no file ${name} in old blockmap`);
    }
    const newFile = nameToNewBlocks.get(name);
    let changedBlockCount = 0;
    const { checksumToOffset: checksumToOldOffset, checksumToOldSize } = buildChecksumMap(nameToOldBlocks.get(name), oldEntry.offset, logger2);
    let newOffset = blockMapFile.offset;
    for (let i = 0; i < newFile.checksums.length; newOffset += newFile.sizes[i], i++) {
      const blockSize = newFile.sizes[i];
      const checksum = newFile.checksums[i];
      let oldOffset = checksumToOldOffset.get(checksum);
      if (oldOffset != null && checksumToOldSize.get(checksum) !== blockSize) {
        logger2.warn(`Checksum ("${checksum}") matches, but size differs (old: ${checksumToOldSize.get(checksum)}, new: ${blockSize})`);
        oldOffset = void 0;
      }
      if (oldOffset === void 0) {
        changedBlockCount++;
        if (lastOperation != null && lastOperation.kind === OperationKind.DOWNLOAD && lastOperation.end === newOffset) {
          lastOperation.end += blockSize;
        } else {
          lastOperation = {
            kind: OperationKind.DOWNLOAD,
            start: newOffset,
            end: newOffset + blockSize
            // oldBlocks: null,
          };
          validateAndAdd(lastOperation, operations, checksum, i);
        }
      } else {
        if (lastOperation != null && lastOperation.kind === OperationKind.COPY && lastOperation.end === oldOffset) {
          lastOperation.end += blockSize;
        } else {
          lastOperation = {
            kind: OperationKind.COPY,
            start: oldOffset,
            end: oldOffset + blockSize
            // oldBlocks: [checksum]
          };
          validateAndAdd(lastOperation, operations, checksum, i);
        }
      }
    }
    if (changedBlockCount > 0) {
      logger2.info(`File${blockMapFile.name === "file" ? "" : " " + blockMapFile.name} has ${changedBlockCount} changed blocks`);
    }
    return operations;
  }
  const isValidateOperationRange = process.env["DIFFERENTIAL_DOWNLOAD_PLAN_BUILDER_VALIDATE_RANGES"] === "true";
  function validateAndAdd(operation, operations, checksum, index) {
    if (isValidateOperationRange && operations.length !== 0) {
      const lastOperation = operations[operations.length - 1];
      if (lastOperation.kind === operation.kind && operation.start < lastOperation.end && operation.start > lastOperation.start) {
        const min = [lastOperation.start, lastOperation.end, operation.start, operation.end].reduce((p, v) => p < v ? p : v);
        throw new Error(`operation (block index: ${index}, checksum: ${checksum}, kind: ${OperationKind[operation.kind]}) overlaps previous operation (checksum: ${checksum}):
abs: ${lastOperation.start} until ${lastOperation.end} and ${operation.start} until ${operation.end}
rel: ${lastOperation.start - min} until ${lastOperation.end - min} and ${operation.start - min} until ${operation.end - min}`);
      }
    }
    operations.push(operation);
  }
  function buildChecksumMap(file2, fileOffset, logger2) {
    const checksumToOffset = /* @__PURE__ */ new Map();
    const checksumToSize = /* @__PURE__ */ new Map();
    let offset = fileOffset;
    for (let i = 0; i < file2.checksums.length; i++) {
      const checksum = file2.checksums[i];
      const size = file2.sizes[i];
      const existing = checksumToSize.get(checksum);
      if (existing === void 0) {
        checksumToOffset.set(checksum, offset);
        checksumToSize.set(checksum, size);
      } else if (logger2.debug != null) {
        const sizeExplanation = existing === size ? "(same size)" : `(size: ${existing}, this size: ${size})`;
        logger2.debug(`${checksum} duplicated in blockmap ${sizeExplanation}, it doesn't lead to broken differential downloader, just corresponding block will be skipped)`);
      }
      offset += size;
    }
    return { checksumToOffset, checksumToOldSize: checksumToSize };
  }
  function buildBlockFileMap(list) {
    const result = /* @__PURE__ */ new Map();
    for (const item of list) {
      result.set(item.name, item);
    }
    return result;
  }
  return downloadPlanBuilder;
}
var hasRequiredDataSplitter;
function requireDataSplitter() {
  if (hasRequiredDataSplitter) return DataSplitter;
  hasRequiredDataSplitter = 1;
  Object.defineProperty(DataSplitter, "__esModule", { value: true });
  DataSplitter.DataSplitter = void 0;
  DataSplitter.copyData = copyData;
  const builder_util_runtime_1 = requireOut();
  const fs_1 = require$$1$2;
  const stream_1 = require$$0$1;
  const downloadPlanBuilder_1 = requireDownloadPlanBuilder();
  const DOUBLE_CRLF = Buffer.from("\r\n\r\n");
  var ReadState;
  (function(ReadState2) {
    ReadState2[ReadState2["INIT"] = 0] = "INIT";
    ReadState2[ReadState2["HEADER"] = 1] = "HEADER";
    ReadState2[ReadState2["BODY"] = 2] = "BODY";
  })(ReadState || (ReadState = {}));
  function copyData(task, out2, oldFileFd, reject, resolve) {
    const readStream = (0, fs_1.createReadStream)("", {
      fd: oldFileFd,
      autoClose: false,
      start: task.start,
      // end is inclusive
      end: task.end - 1
    });
    readStream.on("error", reject);
    readStream.once("end", resolve);
    readStream.pipe(out2, {
      end: false
    });
  }
  let DataSplitter$1 = class DataSplitter extends stream_1.Writable {
    constructor(out2, options, partIndexToTaskIndex, boundary, partIndexToLength, finishHandler, grandTotalBytes, onProgress) {
      super();
      this.out = out2;
      this.options = options;
      this.partIndexToTaskIndex = partIndexToTaskIndex;
      this.partIndexToLength = partIndexToLength;
      this.finishHandler = finishHandler;
      this.grandTotalBytes = grandTotalBytes;
      this.onProgress = onProgress;
      this.start = Date.now();
      this.nextUpdate = this.start + 1e3;
      this.transferred = 0;
      this.delta = 0;
      this.partIndex = -1;
      this.headerListBuffer = null;
      this.readState = ReadState.INIT;
      this.ignoreByteCount = 0;
      this.remainingPartDataCount = 0;
      this.actualPartLength = 0;
      this.boundaryLength = boundary.length + 4;
      this.ignoreByteCount = this.boundaryLength - 2;
    }
    get isFinished() {
      return this.partIndex === this.partIndexToLength.length;
    }
    // noinspection JSUnusedGlobalSymbols
    _write(data, encoding, callback) {
      if (this.isFinished) {
        console.error(`Trailing ignored data: ${data.length} bytes`);
        return;
      }
      this.handleData(data).then(() => {
        if (this.onProgress) {
          const now = Date.now();
          if ((now >= this.nextUpdate || this.transferred === this.grandTotalBytes) && this.grandTotalBytes && (now - this.start) / 1e3) {
            this.nextUpdate = now + 1e3;
            this.onProgress({
              total: this.grandTotalBytes,
              delta: this.delta,
              transferred: this.transferred,
              percent: this.transferred / this.grandTotalBytes * 100,
              bytesPerSecond: Math.round(this.transferred / ((now - this.start) / 1e3))
            });
            this.delta = 0;
          }
        }
        callback();
      }).catch(callback);
    }
    async handleData(chunk) {
      let start = 0;
      if (this.ignoreByteCount !== 0 && this.remainingPartDataCount !== 0) {
        throw (0, builder_util_runtime_1.newError)("Internal error", "ERR_DATA_SPLITTER_BYTE_COUNT_MISMATCH");
      }
      if (this.ignoreByteCount > 0) {
        const toIgnore = Math.min(this.ignoreByteCount, chunk.length);
        this.ignoreByteCount -= toIgnore;
        start = toIgnore;
      } else if (this.remainingPartDataCount > 0) {
        const toRead = Math.min(this.remainingPartDataCount, chunk.length);
        this.remainingPartDataCount -= toRead;
        await this.processPartData(chunk, 0, toRead);
        start = toRead;
      }
      if (start === chunk.length) {
        return;
      }
      if (this.readState === ReadState.HEADER) {
        const headerListEnd = this.searchHeaderListEnd(chunk, start);
        if (headerListEnd === -1) {
          return;
        }
        start = headerListEnd;
        this.readState = ReadState.BODY;
        this.headerListBuffer = null;
      }
      while (true) {
        if (this.readState === ReadState.BODY) {
          this.readState = ReadState.INIT;
        } else {
          this.partIndex++;
          let taskIndex = this.partIndexToTaskIndex.get(this.partIndex);
          if (taskIndex == null) {
            if (this.isFinished) {
              taskIndex = this.options.end;
            } else {
              throw (0, builder_util_runtime_1.newError)("taskIndex is null", "ERR_DATA_SPLITTER_TASK_INDEX_IS_NULL");
            }
          }
          const prevTaskIndex = this.partIndex === 0 ? this.options.start : this.partIndexToTaskIndex.get(this.partIndex - 1) + 1;
          if (prevTaskIndex < taskIndex) {
            await this.copyExistingData(prevTaskIndex, taskIndex);
          } else if (prevTaskIndex > taskIndex) {
            throw (0, builder_util_runtime_1.newError)("prevTaskIndex must be < taskIndex", "ERR_DATA_SPLITTER_TASK_INDEX_ASSERT_FAILED");
          }
          if (this.isFinished) {
            this.onPartEnd();
            this.finishHandler();
            return;
          }
          start = this.searchHeaderListEnd(chunk, start);
          if (start === -1) {
            this.readState = ReadState.HEADER;
            return;
          }
        }
        const partLength = this.partIndexToLength[this.partIndex];
        const end = start + partLength;
        const effectiveEnd = Math.min(end, chunk.length);
        await this.processPartStarted(chunk, start, effectiveEnd);
        this.remainingPartDataCount = partLength - (effectiveEnd - start);
        if (this.remainingPartDataCount > 0) {
          return;
        }
        start = end + this.boundaryLength;
        if (start >= chunk.length) {
          this.ignoreByteCount = this.boundaryLength - (chunk.length - end);
          return;
        }
      }
    }
    copyExistingData(index, end) {
      return new Promise((resolve, reject) => {
        const w = () => {
          if (index === end) {
            resolve();
            return;
          }
          const task = this.options.tasks[index];
          if (task.kind !== downloadPlanBuilder_1.OperationKind.COPY) {
            reject(new Error("Task kind must be COPY"));
            return;
          }
          copyData(task, this.out, this.options.oldFileFd, reject, () => {
            index++;
            w();
          });
        };
        w();
      });
    }
    searchHeaderListEnd(chunk, readOffset) {
      const headerListEnd = chunk.indexOf(DOUBLE_CRLF, readOffset);
      if (headerListEnd !== -1) {
        return headerListEnd + DOUBLE_CRLF.length;
      }
      const partialChunk = readOffset === 0 ? chunk : chunk.slice(readOffset);
      if (this.headerListBuffer == null) {
        this.headerListBuffer = partialChunk;
      } else {
        this.headerListBuffer = Buffer.concat([this.headerListBuffer, partialChunk]);
      }
      return -1;
    }
    onPartEnd() {
      const expectedLength = this.partIndexToLength[this.partIndex - 1];
      if (this.actualPartLength !== expectedLength) {
        throw (0, builder_util_runtime_1.newError)(`Expected length: ${expectedLength} differs from actual: ${this.actualPartLength}`, "ERR_DATA_SPLITTER_LENGTH_MISMATCH");
      }
      this.actualPartLength = 0;
    }
    processPartStarted(data, start, end) {
      if (this.partIndex !== 0) {
        this.onPartEnd();
      }
      return this.processPartData(data, start, end);
    }
    processPartData(data, start, end) {
      this.actualPartLength += end - start;
      this.transferred += end - start;
      this.delta += end - start;
      const out2 = this.out;
      if (out2.write(start === 0 && data.length === end ? data : data.slice(start, end))) {
        return Promise.resolve();
      } else {
        return new Promise((resolve, reject) => {
          out2.on("error", reject);
          out2.once("drain", () => {
            out2.removeListener("error", reject);
            resolve();
          });
        });
      }
    }
  };
  DataSplitter.DataSplitter = DataSplitter$1;
  return DataSplitter;
}
var multipleRangeDownloader = {};
var hasRequiredMultipleRangeDownloader;
function requireMultipleRangeDownloader() {
  if (hasRequiredMultipleRangeDownloader) return multipleRangeDownloader;
  hasRequiredMultipleRangeDownloader = 1;
  Object.defineProperty(multipleRangeDownloader, "__esModule", { value: true });
  multipleRangeDownloader.executeTasksUsingMultipleRangeRequests = executeTasksUsingMultipleRangeRequests;
  multipleRangeDownloader.checkIsRangesSupported = checkIsRangesSupported;
  const builder_util_runtime_1 = requireOut();
  const DataSplitter_1 = requireDataSplitter();
  const downloadPlanBuilder_1 = requireDownloadPlanBuilder();
  function executeTasksUsingMultipleRangeRequests(differentialDownloader, tasks, out2, oldFileFd, reject) {
    const w = (taskOffset) => {
      if (taskOffset >= tasks.length) {
        if (differentialDownloader.fileMetadataBuffer != null) {
          out2.write(differentialDownloader.fileMetadataBuffer);
        }
        out2.end();
        return;
      }
      const nextOffset = taskOffset + 1e3;
      doExecuteTasks(differentialDownloader, {
        tasks,
        start: taskOffset,
        end: Math.min(tasks.length, nextOffset),
        oldFileFd
      }, out2, () => w(nextOffset), reject);
    };
    return w;
  }
  function doExecuteTasks(differentialDownloader, options, out2, resolve, reject) {
    let ranges = "bytes=";
    let partCount = 0;
    let grandTotalBytes = 0;
    const partIndexToTaskIndex = /* @__PURE__ */ new Map();
    const partIndexToLength = [];
    for (let i = options.start; i < options.end; i++) {
      const task = options.tasks[i];
      if (task.kind === downloadPlanBuilder_1.OperationKind.DOWNLOAD) {
        ranges += `${task.start}-${task.end - 1}, `;
        partIndexToTaskIndex.set(partCount, i);
        partCount++;
        partIndexToLength.push(task.end - task.start);
        grandTotalBytes += task.end - task.start;
      }
    }
    if (partCount <= 1) {
      const w = (index) => {
        if (index >= options.end) {
          resolve();
          return;
        }
        const task = options.tasks[index++];
        if (task.kind === downloadPlanBuilder_1.OperationKind.COPY) {
          (0, DataSplitter_1.copyData)(task, out2, options.oldFileFd, reject, () => w(index));
        } else {
          const requestOptions2 = differentialDownloader.createRequestOptions();
          requestOptions2.headers.Range = `bytes=${task.start}-${task.end - 1}`;
          const request2 = differentialDownloader.httpExecutor.createRequest(requestOptions2, (response) => {
            response.on("error", reject);
            if (!checkIsRangesSupported(response, reject)) {
              return;
            }
            response.pipe(out2, {
              end: false
            });
            response.once("end", () => w(index));
          });
          differentialDownloader.httpExecutor.addErrorAndTimeoutHandlers(request2, reject);
          request2.end();
        }
      };
      w(options.start);
      return;
    }
    const requestOptions = differentialDownloader.createRequestOptions();
    requestOptions.headers.Range = ranges.substring(0, ranges.length - 2);
    const request = differentialDownloader.httpExecutor.createRequest(requestOptions, (response) => {
      if (!checkIsRangesSupported(response, reject)) {
        return;
      }
      const contentType = (0, builder_util_runtime_1.safeGetHeader)(response, "content-type");
      const m = /^multipart\/.+?\s*;\s*boundary=(?:"([^"]+)"|([^\s";]+))\s*$/i.exec(contentType);
      if (m == null) {
        reject(new Error(`Content-Type "multipart/byteranges" is expected, but got "${contentType}"`));
        return;
      }
      const dicer = new DataSplitter_1.DataSplitter(out2, options, partIndexToTaskIndex, m[1] || m[2], partIndexToLength, resolve, grandTotalBytes, differentialDownloader.options.onProgress);
      dicer.on("error", reject);
      response.pipe(dicer);
      response.on("end", () => {
        setTimeout(() => {
          request.abort();
          reject(new Error("Response ends without calling any handlers"));
        }, 1e4);
      });
    });
    differentialDownloader.httpExecutor.addErrorAndTimeoutHandlers(request, reject);
    request.end();
  }
  function checkIsRangesSupported(response, reject) {
    if (response.statusCode >= 400) {
      reject((0, builder_util_runtime_1.createHttpError)(response));
      return false;
    }
    if (response.statusCode !== 206) {
      const acceptRanges = (0, builder_util_runtime_1.safeGetHeader)(response, "accept-ranges");
      if (acceptRanges == null || acceptRanges === "none") {
        reject(new Error(`Server doesn't support Accept-Ranges (response code ${response.statusCode})`));
        return false;
      }
    }
    return true;
  }
  return multipleRangeDownloader;
}
var ProgressDifferentialDownloadCallbackTransform = {};
var hasRequiredProgressDifferentialDownloadCallbackTransform;
function requireProgressDifferentialDownloadCallbackTransform() {
  if (hasRequiredProgressDifferentialDownloadCallbackTransform) return ProgressDifferentialDownloadCallbackTransform;
  hasRequiredProgressDifferentialDownloadCallbackTransform = 1;
  Object.defineProperty(ProgressDifferentialDownloadCallbackTransform, "__esModule", { value: true });
  ProgressDifferentialDownloadCallbackTransform.ProgressDifferentialDownloadCallbackTransform = void 0;
  const stream_1 = require$$0$1;
  var OperationKind;
  (function(OperationKind2) {
    OperationKind2[OperationKind2["COPY"] = 0] = "COPY";
    OperationKind2[OperationKind2["DOWNLOAD"] = 1] = "DOWNLOAD";
  })(OperationKind || (OperationKind = {}));
  let ProgressDifferentialDownloadCallbackTransform$1 = class ProgressDifferentialDownloadCallbackTransform extends stream_1.Transform {
    constructor(progressDifferentialDownloadInfo, cancellationToken, onProgress) {
      super();
      this.progressDifferentialDownloadInfo = progressDifferentialDownloadInfo;
      this.cancellationToken = cancellationToken;
      this.onProgress = onProgress;
      this.start = Date.now();
      this.transferred = 0;
      this.delta = 0;
      this.expectedBytes = 0;
      this.index = 0;
      this.operationType = OperationKind.COPY;
      this.nextUpdate = this.start + 1e3;
    }
    _transform(chunk, encoding, callback) {
      if (this.cancellationToken.cancelled) {
        callback(new Error("cancelled"), null);
        return;
      }
      if (this.operationType == OperationKind.COPY) {
        callback(null, chunk);
        return;
      }
      this.transferred += chunk.length;
      this.delta += chunk.length;
      const now = Date.now();
      if (now >= this.nextUpdate && this.transferred !== this.expectedBytes && this.transferred !== this.progressDifferentialDownloadInfo.grandTotal) {
        this.nextUpdate = now + 1e3;
        this.onProgress({
          total: this.progressDifferentialDownloadInfo.grandTotal,
          delta: this.delta,
          transferred: this.transferred,
          percent: this.transferred / this.progressDifferentialDownloadInfo.grandTotal * 100,
          bytesPerSecond: Math.round(this.transferred / ((now - this.start) / 1e3))
        });
        this.delta = 0;
      }
      callback(null, chunk);
    }
    beginFileCopy() {
      this.operationType = OperationKind.COPY;
    }
    beginRangeDownload() {
      this.operationType = OperationKind.DOWNLOAD;
      this.expectedBytes += this.progressDifferentialDownloadInfo.expectedByteCounts[this.index++];
    }
    endRangeDownload() {
      if (this.transferred !== this.progressDifferentialDownloadInfo.grandTotal) {
        this.onProgress({
          total: this.progressDifferentialDownloadInfo.grandTotal,
          delta: this.delta,
          transferred: this.transferred,
          percent: this.transferred / this.progressDifferentialDownloadInfo.grandTotal * 100,
          bytesPerSecond: Math.round(this.transferred / ((Date.now() - this.start) / 1e3))
        });
      }
    }
    // Called when we are 100% done with the connection/download
    _flush(callback) {
      if (this.cancellationToken.cancelled) {
        callback(new Error("cancelled"));
        return;
      }
      this.onProgress({
        total: this.progressDifferentialDownloadInfo.grandTotal,
        delta: this.delta,
        transferred: this.transferred,
        percent: 100,
        bytesPerSecond: Math.round(this.transferred / ((Date.now() - this.start) / 1e3))
      });
      this.delta = 0;
      this.transferred = 0;
      callback(null);
    }
  };
  ProgressDifferentialDownloadCallbackTransform.ProgressDifferentialDownloadCallbackTransform = ProgressDifferentialDownloadCallbackTransform$1;
  return ProgressDifferentialDownloadCallbackTransform;
}
var hasRequiredDifferentialDownloader;
function requireDifferentialDownloader() {
  if (hasRequiredDifferentialDownloader) return DifferentialDownloader;
  hasRequiredDifferentialDownloader = 1;
  Object.defineProperty(DifferentialDownloader, "__esModule", { value: true });
  DifferentialDownloader.DifferentialDownloader = void 0;
  const builder_util_runtime_1 = requireOut();
  const fs_extra_1 = /* @__PURE__ */ requireLib();
  const fs_1 = require$$1$2;
  const DataSplitter_1 = requireDataSplitter();
  const url_1 = require$$2;
  const downloadPlanBuilder_1 = requireDownloadPlanBuilder();
  const multipleRangeDownloader_1 = requireMultipleRangeDownloader();
  const ProgressDifferentialDownloadCallbackTransform_1 = requireProgressDifferentialDownloadCallbackTransform();
  let DifferentialDownloader$1 = class DifferentialDownloader {
    // noinspection TypeScriptAbstractClassConstructorCanBeMadeProtected
    constructor(blockAwareFileInfo, httpExecutor2, options) {
      this.blockAwareFileInfo = blockAwareFileInfo;
      this.httpExecutor = httpExecutor2;
      this.options = options;
      this.fileMetadataBuffer = null;
      this.logger = options.logger;
    }
    createRequestOptions() {
      const result = {
        headers: {
          ...this.options.requestHeaders,
          accept: "*/*"
        }
      };
      (0, builder_util_runtime_1.configureRequestUrl)(this.options.newUrl, result);
      (0, builder_util_runtime_1.configureRequestOptions)(result);
      return result;
    }
    doDownload(oldBlockMap, newBlockMap) {
      if (oldBlockMap.version !== newBlockMap.version) {
        throw new Error(`version is different (${oldBlockMap.version} - ${newBlockMap.version}), full download is required`);
      }
      const logger2 = this.logger;
      const operations = (0, downloadPlanBuilder_1.computeOperations)(oldBlockMap, newBlockMap, logger2);
      if (logger2.debug != null) {
        logger2.debug(JSON.stringify(operations, null, 2));
      }
      let downloadSize = 0;
      let copySize = 0;
      for (const operation of operations) {
        const length = operation.end - operation.start;
        if (operation.kind === downloadPlanBuilder_1.OperationKind.DOWNLOAD) {
          downloadSize += length;
        } else {
          copySize += length;
        }
      }
      const newSize = this.blockAwareFileInfo.size;
      if (downloadSize + copySize + (this.fileMetadataBuffer == null ? 0 : this.fileMetadataBuffer.length) !== newSize) {
        throw new Error(`Internal error, size mismatch: downloadSize: ${downloadSize}, copySize: ${copySize}, newSize: ${newSize}`);
      }
      logger2.info(`Full: ${formatBytes(newSize)}, To download: ${formatBytes(downloadSize)} (${Math.round(downloadSize / (newSize / 100))}%)`);
      return this.downloadFile(operations);
    }
    downloadFile(tasks) {
      const fdList = [];
      const closeFiles = () => {
        return Promise.all(fdList.map((openedFile) => {
          return (0, fs_extra_1.close)(openedFile.descriptor).catch((e) => {
            this.logger.error(`cannot close file "${openedFile.path}": ${e}`);
          });
        }));
      };
      return this.doDownloadFile(tasks, fdList).then(closeFiles).catch((e) => {
        return closeFiles().catch((closeFilesError) => {
          try {
            this.logger.error(`cannot close files: ${closeFilesError}`);
          } catch (errorOnLog) {
            try {
              console.error(errorOnLog);
            } catch (_ignored) {
            }
          }
          throw e;
        }).then(() => {
          throw e;
        });
      });
    }
    async doDownloadFile(tasks, fdList) {
      const oldFileFd = await (0, fs_extra_1.open)(this.options.oldFile, "r");
      fdList.push({ descriptor: oldFileFd, path: this.options.oldFile });
      const newFileFd = await (0, fs_extra_1.open)(this.options.newFile, "w");
      fdList.push({ descriptor: newFileFd, path: this.options.newFile });
      const fileOut = (0, fs_1.createWriteStream)(this.options.newFile, { fd: newFileFd });
      await new Promise((resolve, reject) => {
        const streams = [];
        let downloadInfoTransform = void 0;
        if (!this.options.isUseMultipleRangeRequest && this.options.onProgress) {
          const expectedByteCounts = [];
          let grandTotalBytes = 0;
          for (const task of tasks) {
            if (task.kind === downloadPlanBuilder_1.OperationKind.DOWNLOAD) {
              expectedByteCounts.push(task.end - task.start);
              grandTotalBytes += task.end - task.start;
            }
          }
          const progressDifferentialDownloadInfo = {
            expectedByteCounts,
            grandTotal: grandTotalBytes
          };
          downloadInfoTransform = new ProgressDifferentialDownloadCallbackTransform_1.ProgressDifferentialDownloadCallbackTransform(progressDifferentialDownloadInfo, this.options.cancellationToken, this.options.onProgress);
          streams.push(downloadInfoTransform);
        }
        const digestTransform = new builder_util_runtime_1.DigestTransform(this.blockAwareFileInfo.sha512);
        digestTransform.isValidateOnEnd = false;
        streams.push(digestTransform);
        fileOut.on("finish", () => {
          fileOut.close(() => {
            fdList.splice(1, 1);
            try {
              digestTransform.validate();
            } catch (e) {
              reject(e);
              return;
            }
            resolve(void 0);
          });
        });
        streams.push(fileOut);
        let lastStream = null;
        for (const stream of streams) {
          stream.on("error", reject);
          if (lastStream == null) {
            lastStream = stream;
          } else {
            lastStream = lastStream.pipe(stream);
          }
        }
        const firstStream = streams[0];
        let w;
        if (this.options.isUseMultipleRangeRequest) {
          w = (0, multipleRangeDownloader_1.executeTasksUsingMultipleRangeRequests)(this, tasks, firstStream, oldFileFd, reject);
          w(0);
          return;
        }
        let downloadOperationCount = 0;
        let actualUrl = null;
        this.logger.info(`Differential download: ${this.options.newUrl}`);
        const requestOptions = this.createRequestOptions();
        requestOptions.redirect = "manual";
        w = (index) => {
          var _a, _b;
          if (index >= tasks.length) {
            if (this.fileMetadataBuffer != null) {
              firstStream.write(this.fileMetadataBuffer);
            }
            firstStream.end();
            return;
          }
          const operation = tasks[index++];
          if (operation.kind === downloadPlanBuilder_1.OperationKind.COPY) {
            if (downloadInfoTransform) {
              downloadInfoTransform.beginFileCopy();
            }
            (0, DataSplitter_1.copyData)(operation, firstStream, oldFileFd, reject, () => w(index));
            return;
          }
          const range2 = `bytes=${operation.start}-${operation.end - 1}`;
          requestOptions.headers.range = range2;
          (_b = (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug) === null || _b === void 0 ? void 0 : _b.call(_a, `download range: ${range2}`);
          if (downloadInfoTransform) {
            downloadInfoTransform.beginRangeDownload();
          }
          const request = this.httpExecutor.createRequest(requestOptions, (response) => {
            response.on("error", reject);
            response.on("aborted", () => {
              reject(new Error("response has been aborted by the server"));
            });
            if (response.statusCode >= 400) {
              reject((0, builder_util_runtime_1.createHttpError)(response));
            }
            response.pipe(firstStream, {
              end: false
            });
            response.once("end", () => {
              if (downloadInfoTransform) {
                downloadInfoTransform.endRangeDownload();
              }
              if (++downloadOperationCount === 100) {
                downloadOperationCount = 0;
                setTimeout(() => w(index), 1e3);
              } else {
                w(index);
              }
            });
          });
          request.on("redirect", (statusCode, method, redirectUrl) => {
            this.logger.info(`Redirect to ${removeQuery(redirectUrl)}`);
            actualUrl = redirectUrl;
            (0, builder_util_runtime_1.configureRequestUrl)(new url_1.URL(actualUrl), requestOptions);
            request.followRedirect();
          });
          this.httpExecutor.addErrorAndTimeoutHandlers(request, reject);
          request.end();
        };
        w(0);
      });
    }
    async readRemoteBytes(start, endInclusive) {
      const buffer = Buffer.allocUnsafe(endInclusive + 1 - start);
      const requestOptions = this.createRequestOptions();
      requestOptions.headers.range = `bytes=${start}-${endInclusive}`;
      let position = 0;
      await this.request(requestOptions, (chunk) => {
        chunk.copy(buffer, position);
        position += chunk.length;
      });
      if (position !== buffer.length) {
        throw new Error(`Received data length ${position} is not equal to expected ${buffer.length}`);
      }
      return buffer;
    }
    request(requestOptions, dataHandler) {
      return new Promise((resolve, reject) => {
        const request = this.httpExecutor.createRequest(requestOptions, (response) => {
          if (!(0, multipleRangeDownloader_1.checkIsRangesSupported)(response, reject)) {
            return;
          }
          response.on("error", reject);
          response.on("aborted", () => {
            reject(new Error("response has been aborted by the server"));
          });
          response.on("data", dataHandler);
          response.on("end", () => resolve());
        });
        this.httpExecutor.addErrorAndTimeoutHandlers(request, reject);
        request.end();
      });
    }
  };
  DifferentialDownloader.DifferentialDownloader = DifferentialDownloader$1;
  function formatBytes(value, symbol = " KB") {
    return new Intl.NumberFormat("en").format((value / 1024).toFixed(2)) + symbol;
  }
  function removeQuery(url) {
    const index = url.indexOf("?");
    return index < 0 ? url : url.substring(0, index);
  }
  return DifferentialDownloader;
}
var hasRequiredGenericDifferentialDownloader;
function requireGenericDifferentialDownloader() {
  if (hasRequiredGenericDifferentialDownloader) return GenericDifferentialDownloader;
  hasRequiredGenericDifferentialDownloader = 1;
  Object.defineProperty(GenericDifferentialDownloader, "__esModule", { value: true });
  GenericDifferentialDownloader.GenericDifferentialDownloader = void 0;
  const DifferentialDownloader_1 = requireDifferentialDownloader();
  let GenericDifferentialDownloader$1 = class GenericDifferentialDownloader extends DifferentialDownloader_1.DifferentialDownloader {
    download(oldBlockMap, newBlockMap) {
      return this.doDownload(oldBlockMap, newBlockMap);
    }
  };
  GenericDifferentialDownloader.GenericDifferentialDownloader = GenericDifferentialDownloader$1;
  return GenericDifferentialDownloader;
}
var types = {};
var hasRequiredTypes;
function requireTypes() {
  if (hasRequiredTypes) return types;
  hasRequiredTypes = 1;
  (function(exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.UpdaterSignal = exports.UPDATE_DOWNLOADED = exports.DOWNLOAD_PROGRESS = exports.CancellationToken = void 0;
    exports.addHandler = addHandler;
    const builder_util_runtime_1 = requireOut();
    Object.defineProperty(exports, "CancellationToken", { enumerable: true, get: function() {
      return builder_util_runtime_1.CancellationToken;
    } });
    exports.DOWNLOAD_PROGRESS = "download-progress";
    exports.UPDATE_DOWNLOADED = "update-downloaded";
    class UpdaterSignal {
      constructor(emitter) {
        this.emitter = emitter;
      }
      /**
       * Emitted when an authenticating proxy is [asking for user credentials](https://github.com/electron/electron/blob/master/docs/api/client-request.md#event-login).
       */
      login(handler) {
        addHandler(this.emitter, "login", handler);
      }
      progress(handler) {
        addHandler(this.emitter, exports.DOWNLOAD_PROGRESS, handler);
      }
      updateDownloaded(handler) {
        addHandler(this.emitter, exports.UPDATE_DOWNLOADED, handler);
      }
      updateCancelled(handler) {
        addHandler(this.emitter, "update-cancelled", handler);
      }
    }
    exports.UpdaterSignal = UpdaterSignal;
    function addHandler(emitter, event, handler) {
      {
        emitter.on(event, handler);
      }
    }
  })(types);
  return types;
}
var hasRequiredAppUpdater;
function requireAppUpdater() {
  if (hasRequiredAppUpdater) return AppUpdater;
  hasRequiredAppUpdater = 1;
  Object.defineProperty(AppUpdater, "__esModule", { value: true });
  AppUpdater.NoOpLogger = AppUpdater.AppUpdater = void 0;
  const builder_util_runtime_1 = requireOut();
  const crypto_1 = crypto;
  const os_1 = os;
  const events_1 = require$$0$2;
  const fs_extra_1 = /* @__PURE__ */ requireLib();
  const js_yaml_1 = requireJsYaml();
  const lazy_val_1 = requireMain$1();
  const path = require$$1$1;
  const semver_1 = requireSemver();
  const DownloadedUpdateHelper_1 = requireDownloadedUpdateHelper();
  const ElectronAppAdapter_1 = requireElectronAppAdapter();
  const electronHttpExecutor_1 = requireElectronHttpExecutor();
  const GenericProvider_1 = requireGenericProvider();
  const providerFactory_1 = requireProviderFactory();
  const zlib_1 = require$$14;
  const GenericDifferentialDownloader_1 = requireGenericDifferentialDownloader();
  const types_1 = requireTypes();
  let AppUpdater$1 = class AppUpdater2 extends events_1.EventEmitter {
    /**
     * Get the update channel. Doesn't return `channel` from the update configuration, only if was previously set.
     */
    get channel() {
      return this._channel;
    }
    /**
     * Set the update channel. Overrides `channel` in the update configuration.
     *
     * `allowDowngrade` will be automatically set to `true`. If this behavior is not suitable for you, simple set `allowDowngrade` explicitly after.
     */
    set channel(value) {
      if (this._channel != null) {
        if (typeof value !== "string") {
          throw (0, builder_util_runtime_1.newError)(`Channel must be a string, but got: ${value}`, "ERR_UPDATER_INVALID_CHANNEL");
        } else if (value.length === 0) {
          throw (0, builder_util_runtime_1.newError)(`Channel must be not an empty string`, "ERR_UPDATER_INVALID_CHANNEL");
        }
      }
      this._channel = value;
      this.allowDowngrade = true;
    }
    /**
     *  Shortcut for explicitly adding auth tokens to request headers
     */
    addAuthHeader(token) {
      this.requestHeaders = Object.assign({}, this.requestHeaders, {
        authorization: token
      });
    }
    // noinspection JSMethodCanBeStatic,JSUnusedGlobalSymbols
    get netSession() {
      return (0, electronHttpExecutor_1.getNetSession)();
    }
    /**
     * The logger. You can pass [electron-log](https://github.com/megahertz/electron-log), [winston](https://github.com/winstonjs/winston) or another logger with the following interface: `{ info(), warn(), error() }`.
     * Set it to `null` if you would like to disable a logging feature.
     */
    get logger() {
      return this._logger;
    }
    set logger(value) {
      this._logger = value == null ? new NoOpLogger() : value;
    }
    // noinspection JSUnusedGlobalSymbols
    /**
     * test only
     * @private
     */
    set updateConfigPath(value) {
      this.clientPromise = null;
      this._appUpdateConfigPath = value;
      this.configOnDisk = new lazy_val_1.Lazy(() => this.loadUpdateConfig());
    }
    /**
     * Allows developer to override default logic for determining if an update is supported.
     * The default logic compares the `UpdateInfo` minimum system version against the `os.release()` with `semver` package
     */
    get isUpdateSupported() {
      return this._isUpdateSupported;
    }
    set isUpdateSupported(value) {
      if (value) {
        this._isUpdateSupported = value;
      }
    }
    /**
     * Allows developer to override default logic for determining if the user is below the rollout threshold.
     * The default logic compares the staging percentage with numerical representation of user ID.
     * An override can define custom logic, or bypass it if needed.
     */
    get isUserWithinRollout() {
      return this._isUserWithinRollout;
    }
    set isUserWithinRollout(value) {
      if (value) {
        this._isUserWithinRollout = value;
      }
    }
    constructor(options, app) {
      super();
      this.autoDownload = true;
      this.autoInstallOnAppQuit = true;
      this.autoRunAppAfterInstall = true;
      this.allowPrerelease = false;
      this.fullChangelog = false;
      this.allowDowngrade = false;
      this.disableWebInstaller = false;
      this.disableDifferentialDownload = false;
      this.forceDevUpdateConfig = false;
      this.previousBlockmapBaseUrlOverride = null;
      this._channel = null;
      this.downloadedUpdateHelper = null;
      this.requestHeaders = null;
      this._logger = console;
      this.signals = new types_1.UpdaterSignal(this);
      this._appUpdateConfigPath = null;
      this._isUpdateSupported = (updateInfo) => this.checkIfUpdateSupported(updateInfo);
      this._isUserWithinRollout = (updateInfo) => this.isStagingMatch(updateInfo);
      this.clientPromise = null;
      this.stagingUserIdPromise = new lazy_val_1.Lazy(() => this.getOrCreateStagingUserId());
      this.configOnDisk = new lazy_val_1.Lazy(() => this.loadUpdateConfig());
      this.checkForUpdatesPromise = null;
      this.downloadPromise = null;
      this.updateInfoAndProvider = null;
      this._testOnlyOptions = null;
      this.on("error", (error2) => {
        this._logger.error(`Error: ${error2.stack || error2.message}`);
      });
      if (app == null) {
        this.app = new ElectronAppAdapter_1.ElectronAppAdapter();
        this.httpExecutor = new electronHttpExecutor_1.ElectronHttpExecutor((authInfo, callback) => this.emit("login", authInfo, callback));
      } else {
        this.app = app;
        this.httpExecutor = null;
      }
      const currentVersionString = this.app.version;
      const currentVersion = (0, semver_1.parse)(currentVersionString);
      if (currentVersion == null) {
        throw (0, builder_util_runtime_1.newError)(`App version is not a valid semver version: "${currentVersionString}"`, "ERR_UPDATER_INVALID_VERSION");
      }
      this.currentVersion = currentVersion;
      this.allowPrerelease = hasPrereleaseComponents(currentVersion);
      if (options != null) {
        this.setFeedURL(options);
        if (typeof options !== "string" && options.requestHeaders) {
          this.requestHeaders = options.requestHeaders;
        }
      }
    }
    //noinspection JSMethodCanBeStatic,JSUnusedGlobalSymbols
    getFeedURL() {
      return "Deprecated. Do not use it.";
    }
    /**
     * Configure update provider. If value is `string`, [GenericServerOptions](https://www.electron.build/publish#genericserveroptions) will be set with value as `url`.
     * @param options If you want to override configuration in the `app-update.yml`.
     */
    setFeedURL(options) {
      const runtimeOptions = this.createProviderRuntimeOptions();
      let provider;
      if (typeof options === "string") {
        provider = new GenericProvider_1.GenericProvider({ provider: "generic", url: options }, this, {
          ...runtimeOptions,
          isUseMultipleRangeRequest: (0, providerFactory_1.isUrlProbablySupportMultiRangeRequests)(options)
        });
      } else {
        provider = (0, providerFactory_1.createClient)(options, this, runtimeOptions);
      }
      this.clientPromise = Promise.resolve(provider);
    }
    /**
     * Asks the server whether there is an update.
     * @returns null if the updater is disabled, otherwise info about the latest version
     */
    checkForUpdates() {
      if (!this.isUpdaterActive()) {
        return Promise.resolve(null);
      }
      let checkForUpdatesPromise = this.checkForUpdatesPromise;
      if (checkForUpdatesPromise != null) {
        this._logger.info("Checking for update (already in progress)");
        return checkForUpdatesPromise;
      }
      const nullizePromise = () => this.checkForUpdatesPromise = null;
      this._logger.info("Checking for update");
      checkForUpdatesPromise = this.doCheckForUpdates().then((it) => {
        nullizePromise();
        return it;
      }).catch((e) => {
        nullizePromise();
        this.emit("error", e, `Cannot check for updates: ${(e.stack || e).toString()}`);
        throw e;
      });
      this.checkForUpdatesPromise = checkForUpdatesPromise;
      return checkForUpdatesPromise;
    }
    isUpdaterActive() {
      const isEnabled = this.app.isPackaged || this.forceDevUpdateConfig;
      if (!isEnabled) {
        this._logger.info("Skip checkForUpdates because application is not packed and dev update config is not forced");
        return false;
      }
      return true;
    }
    // noinspection JSUnusedGlobalSymbols
    checkForUpdatesAndNotify(downloadNotification) {
      return this.checkForUpdates().then((it) => {
        if (!(it === null || it === void 0 ? void 0 : it.downloadPromise)) {
          if (this._logger.debug != null) {
            this._logger.debug("checkForUpdatesAndNotify called, downloadPromise is null");
          }
          return it;
        }
        void it.downloadPromise.then(() => {
          const notificationContent = AppUpdater2.formatDownloadNotification(it.updateInfo.version, this.app.name, downloadNotification);
          new require$$1.Notification(notificationContent).show();
        });
        return it;
      });
    }
    static formatDownloadNotification(version, appName, downloadNotification) {
      if (downloadNotification == null) {
        downloadNotification = {
          title: "A new update is ready to install",
          body: `{appName} version {version} has been downloaded and will be automatically installed on exit`
        };
      }
      downloadNotification = {
        title: downloadNotification.title.replace("{appName}", appName).replace("{version}", version),
        body: downloadNotification.body.replace("{appName}", appName).replace("{version}", version)
      };
      return downloadNotification;
    }
    async isStagingMatch(updateInfo) {
      const rawStagingPercentage = updateInfo.stagingPercentage;
      let stagingPercentage = rawStagingPercentage;
      if (stagingPercentage == null) {
        return true;
      }
      stagingPercentage = parseInt(stagingPercentage, 10);
      if (isNaN(stagingPercentage)) {
        this._logger.warn(`Staging percentage is NaN: ${rawStagingPercentage}`);
        return true;
      }
      stagingPercentage = stagingPercentage / 100;
      const stagingUserId = await this.stagingUserIdPromise.value;
      const val = builder_util_runtime_1.UUID.parse(stagingUserId).readUInt32BE(12);
      const percentage = val / 4294967295;
      this._logger.info(`Staging percentage: ${stagingPercentage}, percentage: ${percentage}, user id: ${stagingUserId}`);
      return percentage < stagingPercentage;
    }
    computeFinalHeaders(headers) {
      if (this.requestHeaders != null) {
        Object.assign(headers, this.requestHeaders);
      }
      return headers;
    }
    async isUpdateAvailable(updateInfo) {
      const latestVersion = (0, semver_1.parse)(updateInfo.version);
      if (latestVersion == null) {
        throw (0, builder_util_runtime_1.newError)(`This file could not be downloaded, or the latest version (from update server) does not have a valid semver version: "${updateInfo.version}"`, "ERR_UPDATER_INVALID_VERSION");
      }
      const currentVersion = this.currentVersion;
      if ((0, semver_1.eq)(latestVersion, currentVersion)) {
        return false;
      }
      if (!await Promise.resolve(this.isUpdateSupported(updateInfo))) {
        return false;
      }
      const isUserWithinRollout = await Promise.resolve(this.isUserWithinRollout(updateInfo));
      if (!isUserWithinRollout) {
        return false;
      }
      const isLatestVersionNewer = (0, semver_1.gt)(latestVersion, currentVersion);
      const isLatestVersionOlder = (0, semver_1.lt)(latestVersion, currentVersion);
      if (isLatestVersionNewer) {
        return true;
      }
      return this.allowDowngrade && isLatestVersionOlder;
    }
    checkIfUpdateSupported(updateInfo) {
      const minimumSystemVersion = updateInfo === null || updateInfo === void 0 ? void 0 : updateInfo.minimumSystemVersion;
      const currentOSVersion = (0, os_1.release)();
      if (minimumSystemVersion) {
        try {
          if ((0, semver_1.lt)(currentOSVersion, minimumSystemVersion)) {
            this._logger.info(`Current OS version ${currentOSVersion} is less than the minimum OS version required ${minimumSystemVersion} for version ${currentOSVersion}`);
            return false;
          }
        } catch (e) {
          this._logger.warn(`Failed to compare current OS version(${currentOSVersion}) with minimum OS version(${minimumSystemVersion}): ${(e.message || e).toString()}`);
        }
      }
      return true;
    }
    async getUpdateInfoAndProvider() {
      await this.app.whenReady();
      if (this.clientPromise == null) {
        this.clientPromise = this.configOnDisk.value.then((it) => (0, providerFactory_1.createClient)(it, this, this.createProviderRuntimeOptions()));
      }
      const client = await this.clientPromise;
      const stagingUserId = await this.stagingUserIdPromise.value;
      client.setRequestHeaders(this.computeFinalHeaders({ "x-user-staging-id": stagingUserId }));
      return {
        info: await client.getLatestVersion(),
        provider: client
      };
    }
    createProviderRuntimeOptions() {
      return {
        isUseMultipleRangeRequest: true,
        platform: this._testOnlyOptions == null ? process.platform : this._testOnlyOptions.platform,
        executor: this.httpExecutor
      };
    }
    async doCheckForUpdates() {
      this.emit("checking-for-update");
      const result = await this.getUpdateInfoAndProvider();
      const updateInfo = result.info;
      if (!await this.isUpdateAvailable(updateInfo)) {
        this._logger.info(`Update for version ${this.currentVersion.format()} is not available (latest version: ${updateInfo.version}, downgrade is ${this.allowDowngrade ? "allowed" : "disallowed"}).`);
        this.emit("update-not-available", updateInfo);
        return {
          isUpdateAvailable: false,
          versionInfo: updateInfo,
          updateInfo
        };
      }
      this.updateInfoAndProvider = result;
      this.onUpdateAvailable(updateInfo);
      const cancellationToken = new builder_util_runtime_1.CancellationToken();
      return {
        isUpdateAvailable: true,
        versionInfo: updateInfo,
        updateInfo,
        cancellationToken,
        downloadPromise: this.autoDownload ? this.downloadUpdate(cancellationToken) : null
      };
    }
    onUpdateAvailable(updateInfo) {
      this._logger.info(`Found version ${updateInfo.version} (url: ${(0, builder_util_runtime_1.asArray)(updateInfo.files).map((it) => it.url).join(", ")})`);
      this.emit("update-available", updateInfo);
    }
    /**
     * Start downloading update manually. You can use this method if `autoDownload` option is set to `false`.
     * @returns {Promise<Array<string>>} Paths to downloaded files.
     */
    downloadUpdate(cancellationToken = new builder_util_runtime_1.CancellationToken()) {
      const updateInfoAndProvider = this.updateInfoAndProvider;
      if (updateInfoAndProvider == null) {
        const error2 = new Error("Please check update first");
        this.dispatchError(error2);
        return Promise.reject(error2);
      }
      if (this.downloadPromise != null) {
        this._logger.info("Downloading update (already in progress)");
        return this.downloadPromise;
      }
      this._logger.info(`Downloading update from ${(0, builder_util_runtime_1.asArray)(updateInfoAndProvider.info.files).map((it) => it.url).join(", ")}`);
      const errorHandler = (e) => {
        if (!(e instanceof builder_util_runtime_1.CancellationError)) {
          try {
            this.dispatchError(e);
          } catch (nestedError) {
            this._logger.warn(`Cannot dispatch error event: ${nestedError.stack || nestedError}`);
          }
        }
        return e;
      };
      this.downloadPromise = this.doDownloadUpdate({
        updateInfoAndProvider,
        requestHeaders: this.computeRequestHeaders(updateInfoAndProvider.provider),
        cancellationToken,
        disableWebInstaller: this.disableWebInstaller,
        disableDifferentialDownload: this.disableDifferentialDownload
      }).catch((e) => {
        throw errorHandler(e);
      }).finally(() => {
        this.downloadPromise = null;
      });
      return this.downloadPromise;
    }
    dispatchError(e) {
      this.emit("error", e, (e.stack || e).toString());
    }
    dispatchUpdateDownloaded(event) {
      this.emit(types_1.UPDATE_DOWNLOADED, event);
    }
    async loadUpdateConfig() {
      if (this._appUpdateConfigPath == null) {
        this._appUpdateConfigPath = this.app.appUpdateConfigPath;
      }
      return (0, js_yaml_1.load)(await (0, fs_extra_1.readFile)(this._appUpdateConfigPath, "utf-8"));
    }
    computeRequestHeaders(provider) {
      const fileExtraDownloadHeaders = provider.fileExtraDownloadHeaders;
      if (fileExtraDownloadHeaders != null) {
        const requestHeaders = this.requestHeaders;
        return requestHeaders == null ? fileExtraDownloadHeaders : {
          ...fileExtraDownloadHeaders,
          ...requestHeaders
        };
      }
      return this.computeFinalHeaders({ accept: "*/*" });
    }
    async getOrCreateStagingUserId() {
      const file2 = path.join(this.app.userDataPath, ".updaterId");
      try {
        const id2 = await (0, fs_extra_1.readFile)(file2, "utf-8");
        if (builder_util_runtime_1.UUID.check(id2)) {
          return id2;
        } else {
          this._logger.warn(`Staging user id file exists, but content was invalid: ${id2}`);
        }
      } catch (e) {
        if (e.code !== "ENOENT") {
          this._logger.warn(`Couldn't read staging user ID, creating a blank one: ${e}`);
        }
      }
      const id = builder_util_runtime_1.UUID.v5((0, crypto_1.randomBytes)(4096), builder_util_runtime_1.UUID.OID);
      this._logger.info(`Generated new staging user ID: ${id}`);
      try {
        await (0, fs_extra_1.outputFile)(file2, id);
      } catch (e) {
        this._logger.warn(`Couldn't write out staging user ID: ${e}`);
      }
      return id;
    }
    /** @internal */
    get isAddNoCacheQuery() {
      const headers = this.requestHeaders;
      if (headers == null) {
        return true;
      }
      for (const headerName of Object.keys(headers)) {
        const s = headerName.toLowerCase();
        if (s === "authorization" || s === "private-token") {
          return false;
        }
      }
      return true;
    }
    async getOrCreateDownloadHelper() {
      let result = this.downloadedUpdateHelper;
      if (result == null) {
        const dirName = (await this.configOnDisk.value).updaterCacheDirName;
        const logger2 = this._logger;
        if (dirName == null) {
          logger2.error("updaterCacheDirName is not specified in app-update.yml Was app build using at least electron-builder 20.34.0?");
        }
        const cacheDir = path.join(this.app.baseCachePath, dirName || this.app.name);
        if (logger2.debug != null) {
          logger2.debug(`updater cache dir: ${cacheDir}`);
        }
        result = new DownloadedUpdateHelper_1.DownloadedUpdateHelper(cacheDir);
        this.downloadedUpdateHelper = result;
      }
      return result;
    }
    async executeDownload(taskOptions) {
      const fileInfo = taskOptions.fileInfo;
      const downloadOptions = {
        headers: taskOptions.downloadUpdateOptions.requestHeaders,
        cancellationToken: taskOptions.downloadUpdateOptions.cancellationToken,
        sha2: fileInfo.info.sha2,
        sha512: fileInfo.info.sha512
      };
      if (this.listenerCount(types_1.DOWNLOAD_PROGRESS) > 0) {
        downloadOptions.onProgress = (it) => this.emit(types_1.DOWNLOAD_PROGRESS, it);
      }
      const updateInfo = taskOptions.downloadUpdateOptions.updateInfoAndProvider.info;
      const version = updateInfo.version;
      const packageInfo = fileInfo.packageInfo;
      function getCacheUpdateFileName() {
        const urlPath = decodeURIComponent(taskOptions.fileInfo.url.pathname);
        if (urlPath.toLowerCase().endsWith(`.${taskOptions.fileExtension.toLowerCase()}`)) {
          return path.basename(urlPath);
        } else {
          return path.basename(taskOptions.fileInfo.info.url);
        }
      }
      const downloadedUpdateHelper = await this.getOrCreateDownloadHelper();
      const cacheDir = downloadedUpdateHelper.cacheDirForPendingUpdate;
      await (0, fs_extra_1.mkdir)(cacheDir, { recursive: true });
      const updateFileName = getCacheUpdateFileName();
      let updateFile = path.join(cacheDir, updateFileName);
      const packageFile = packageInfo == null ? null : path.join(cacheDir, `package-${version}${path.extname(packageInfo.path) || ".7z"}`);
      const done = async (isSaveCache) => {
        await downloadedUpdateHelper.setDownloadedFile(updateFile, packageFile, updateInfo, fileInfo, updateFileName, isSaveCache);
        await taskOptions.done({
          ...updateInfo,
          downloadedFile: updateFile
        });
        const currentBlockMapFile = path.join(cacheDir, "current.blockmap");
        if (await (0, fs_extra_1.pathExists)(currentBlockMapFile)) {
          await (0, fs_extra_1.copyFile)(currentBlockMapFile, path.join(downloadedUpdateHelper.cacheDir, "current.blockmap"));
        }
        return packageFile == null ? [updateFile] : [updateFile, packageFile];
      };
      const log = this._logger;
      const cachedUpdateFile = await downloadedUpdateHelper.validateDownloadedPath(updateFile, updateInfo, fileInfo, log);
      if (cachedUpdateFile != null) {
        updateFile = cachedUpdateFile;
        return await done(false);
      }
      const removeFileIfAny = async () => {
        await downloadedUpdateHelper.clear().catch(() => {
        });
        return await (0, fs_extra_1.unlink)(updateFile).catch(() => {
        });
      };
      const tempUpdateFile = await (0, DownloadedUpdateHelper_1.createTempUpdateFile)(`temp-${updateFileName}`, cacheDir, log);
      try {
        await taskOptions.task(tempUpdateFile, downloadOptions, packageFile, removeFileIfAny);
        await (0, builder_util_runtime_1.retry)(() => (0, fs_extra_1.rename)(tempUpdateFile, updateFile), {
          retries: 60,
          interval: 500,
          shouldRetry: (error2) => {
            if (error2 instanceof Error && /^EBUSY:/.test(error2.message)) {
              return true;
            }
            log.warn(`Cannot rename temp file to final file: ${error2.message || error2.stack}`);
            return false;
          }
        });
      } catch (e) {
        await removeFileIfAny();
        if (e instanceof builder_util_runtime_1.CancellationError) {
          log.info("cancelled");
          this.emit("update-cancelled", updateInfo);
        }
        throw e;
      }
      log.info(`New version ${version} has been downloaded to ${updateFile}`);
      return await done(true);
    }
    async differentialDownloadInstaller(fileInfo, downloadUpdateOptions, installerPath, provider, oldInstallerFileName) {
      try {
        if (this._testOnlyOptions != null && !this._testOnlyOptions.isUseDifferentialDownload) {
          return true;
        }
        const provider2 = downloadUpdateOptions.updateInfoAndProvider.provider;
        const blockmapFileUrls = await provider2.getBlockMapFiles(fileInfo.url, this.app.version, downloadUpdateOptions.updateInfoAndProvider.info.version, this.previousBlockmapBaseUrlOverride);
        this._logger.info(`Download block maps (old: "${blockmapFileUrls[0]}", new: ${blockmapFileUrls[1]})`);
        const downloadBlockMap = async (url) => {
          const data = await this.httpExecutor.downloadToBuffer(url, {
            headers: downloadUpdateOptions.requestHeaders,
            cancellationToken: downloadUpdateOptions.cancellationToken
          });
          if (data == null || data.length === 0) {
            throw new Error(`Blockmap "${url.href}" is empty`);
          }
          try {
            return JSON.parse((0, zlib_1.gunzipSync)(data).toString());
          } catch (e) {
            throw new Error(`Cannot parse blockmap "${url.href}", error: ${e}`);
          }
        };
        const downloadOptions = {
          newUrl: fileInfo.url,
          oldFile: path.join(this.downloadedUpdateHelper.cacheDir, oldInstallerFileName),
          logger: this._logger,
          newFile: installerPath,
          isUseMultipleRangeRequest: provider2.isUseMultipleRangeRequest,
          requestHeaders: downloadUpdateOptions.requestHeaders,
          cancellationToken: downloadUpdateOptions.cancellationToken
        };
        if (this.listenerCount(types_1.DOWNLOAD_PROGRESS) > 0) {
          downloadOptions.onProgress = (it) => this.emit(types_1.DOWNLOAD_PROGRESS, it);
        }
        const saveBlockMapToCacheDir = async (blockMapData, cacheDir) => {
          const blockMapFile = path.join(cacheDir, "current.blockmap");
          await (0, fs_extra_1.outputFile)(blockMapFile, (0, zlib_1.gzipSync)(JSON.stringify(blockMapData)));
        };
        const getBlockMapFromCacheDir = async (cacheDir) => {
          const blockMapFile = path.join(cacheDir, "current.blockmap");
          try {
            if (await (0, fs_extra_1.pathExists)(blockMapFile)) {
              return JSON.parse((0, zlib_1.gunzipSync)(await (0, fs_extra_1.readFile)(blockMapFile)).toString());
            }
          } catch (e) {
            this._logger.warn(`Cannot parse blockmap "${blockMapFile}", error: ${e}`);
          }
          return null;
        };
        const newBlockMapData = await downloadBlockMap(blockmapFileUrls[1]);
        await saveBlockMapToCacheDir(newBlockMapData, this.downloadedUpdateHelper.cacheDirForPendingUpdate);
        let oldBlockMapData = await getBlockMapFromCacheDir(this.downloadedUpdateHelper.cacheDir);
        if (oldBlockMapData == null) {
          oldBlockMapData = await downloadBlockMap(blockmapFileUrls[0]);
        }
        await new GenericDifferentialDownloader_1.GenericDifferentialDownloader(fileInfo.info, this.httpExecutor, downloadOptions).download(oldBlockMapData, newBlockMapData);
        return false;
      } catch (e) {
        this._logger.error(`Cannot download differentially, fallback to full download: ${e.stack || e}`);
        if (this._testOnlyOptions != null) {
          throw e;
        }
        return true;
      }
    }
  };
  AppUpdater.AppUpdater = AppUpdater$1;
  function hasPrereleaseComponents(version) {
    const versionPrereleaseComponent = (0, semver_1.prerelease)(version);
    return versionPrereleaseComponent != null && versionPrereleaseComponent.length > 0;
  }
  class NoOpLogger {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    info(message) {
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    warn(message) {
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    error(message) {
    }
  }
  AppUpdater.NoOpLogger = NoOpLogger;
  return AppUpdater;
}
var hasRequiredBaseUpdater;
function requireBaseUpdater() {
  if (hasRequiredBaseUpdater) return BaseUpdater;
  hasRequiredBaseUpdater = 1;
  Object.defineProperty(BaseUpdater, "__esModule", { value: true });
  BaseUpdater.BaseUpdater = void 0;
  const child_process_1 = require$$1$3;
  const path = require$$1$1;
  const AppUpdater_1 = requireAppUpdater();
  let BaseUpdater$1 = class BaseUpdater extends AppUpdater_1.AppUpdater {
    constructor(options, app) {
      super(options, app);
      this.quitAndInstallCalled = false;
      this.quitHandlerAdded = false;
    }
    quitAndInstall(isSilent = false, isForceRunAfter = false) {
      this._logger.info(`Install on explicit quitAndInstall`);
      const isInstalled = this.install(isSilent, isSilent ? isForceRunAfter : this.autoRunAppAfterInstall);
      if (isInstalled) {
        setImmediate(() => {
          require$$1.autoUpdater.emit("before-quit-for-update");
          this.app.quit();
        });
      } else {
        this.quitAndInstallCalled = false;
      }
    }
    executeDownload(taskOptions) {
      return super.executeDownload({
        ...taskOptions,
        done: (event) => {
          this.dispatchUpdateDownloaded(event);
          this.addQuitHandler();
          return Promise.resolve();
        }
      });
    }
    get installerPath() {
      return this.downloadedUpdateHelper == null ? null : this.downloadedUpdateHelper.file;
    }
    // must be sync (because quit even handler is not async)
    install(isSilent = false, isForceRunAfter = false) {
      if (this.quitAndInstallCalled) {
        this._logger.warn("install call ignored: quitAndInstallCalled is set to true");
        return false;
      }
      const downloadedUpdateHelper = this.downloadedUpdateHelper;
      const installerPath = this.installerPath;
      const downloadedFileInfo = downloadedUpdateHelper == null ? null : downloadedUpdateHelper.downloadedFileInfo;
      if (installerPath == null || downloadedFileInfo == null) {
        this.dispatchError(new Error("No update filepath provided, can't quit and install"));
        return false;
      }
      this.quitAndInstallCalled = true;
      try {
        this._logger.info(`Install: isSilent: ${isSilent}, isForceRunAfter: ${isForceRunAfter}`);
        return this.doInstall({
          isSilent,
          isForceRunAfter,
          isAdminRightsRequired: downloadedFileInfo.isAdminRightsRequired
        });
      } catch (e) {
        this.dispatchError(e);
        return false;
      }
    }
    addQuitHandler() {
      if (this.quitHandlerAdded || !this.autoInstallOnAppQuit) {
        return;
      }
      this.quitHandlerAdded = true;
      this.app.onQuit((exitCode) => {
        if (this.quitAndInstallCalled) {
          this._logger.info("Update installer has already been triggered. Quitting application.");
          return;
        }
        if (!this.autoInstallOnAppQuit) {
          this._logger.info("Update will not be installed on quit because autoInstallOnAppQuit is set to false.");
          return;
        }
        if (exitCode !== 0) {
          this._logger.info(`Update will be not installed on quit because application is quitting with exit code ${exitCode}`);
          return;
        }
        this._logger.info("Auto install update on quit");
        this.install(true, false);
      });
    }
    /**
     * Strips relative-path entries from a PATH string.
     * Prevents PATH-poisoning where a writable directory earlier in PATH shadows
     * a trusted package manager binary.
     */
    sanitizeEnvPath(envPath) {
      return envPath.split(path.delimiter).filter((dir) => path.isAbsolute(dir)).join(path.delimiter);
    }
    spawnSyncLog(cmd, args = [], env = {}) {
      var _a;
      this._logger.info(`Executing: ${cmd} with args: ${args}`);
      const mergedEnv = { ...process.env, ...env };
      const response = (0, child_process_1.spawnSync)(cmd, args, {
        env: { ...mergedEnv, PATH: this.sanitizeEnvPath((_a = mergedEnv.PATH) !== null && _a !== void 0 ? _a : "") },
        encoding: "utf-8",
        shell: true
      });
      const { error: error2, status, stdout, stderr } = response;
      if (error2 != null) {
        this._logger.error(stderr);
        throw error2;
      } else if (status != null && status !== 0) {
        this._logger.error(stderr);
        throw new Error(`Command ${cmd} exited with code ${status}`);
      }
      return stdout.trim();
    }
    /**
     * This handles both node 8 and node 10 way of emitting error when spawning a process
     *   - node 8: Throws the error
     *   - node 10: Emit the error(Need to listen with on)
     */
    // https://github.com/electron-userland/electron-builder/issues/1129
    // Node 8 sends errors: https://nodejs.org/dist/latest-v8.x/docs/api/errors.html#errors_common_system_errors
    async spawnLog(cmd, args = [], env = void 0, stdio = "ignore") {
      this._logger.info(`Executing: ${cmd} with args: ${args}`);
      return new Promise((resolve, reject) => {
        try {
          const params = { stdio, env, detached: true };
          const p = (0, child_process_1.spawn)(cmd, args, params);
          p.on("error", (error2) => {
            reject(error2);
          });
          p.unref();
          if (p.pid !== void 0) {
            resolve(true);
          }
        } catch (error2) {
          reject(error2);
        }
      });
    }
  };
  BaseUpdater.BaseUpdater = BaseUpdater$1;
  return BaseUpdater;
}
var AppImageUpdater = {};
var FileWithEmbeddedBlockMapDifferentialDownloader = {};
var hasRequiredFileWithEmbeddedBlockMapDifferentialDownloader;
function requireFileWithEmbeddedBlockMapDifferentialDownloader() {
  if (hasRequiredFileWithEmbeddedBlockMapDifferentialDownloader) return FileWithEmbeddedBlockMapDifferentialDownloader;
  hasRequiredFileWithEmbeddedBlockMapDifferentialDownloader = 1;
  Object.defineProperty(FileWithEmbeddedBlockMapDifferentialDownloader, "__esModule", { value: true });
  FileWithEmbeddedBlockMapDifferentialDownloader.FileWithEmbeddedBlockMapDifferentialDownloader = void 0;
  const fs_extra_1 = /* @__PURE__ */ requireLib();
  const DifferentialDownloader_1 = requireDifferentialDownloader();
  const zlib_1 = require$$14;
  let FileWithEmbeddedBlockMapDifferentialDownloader$1 = class FileWithEmbeddedBlockMapDifferentialDownloader extends DifferentialDownloader_1.DifferentialDownloader {
    async download() {
      const packageInfo = this.blockAwareFileInfo;
      const fileSize = packageInfo.size;
      const offset = fileSize - (packageInfo.blockMapSize + 4);
      this.fileMetadataBuffer = await this.readRemoteBytes(offset, fileSize - 1);
      const newBlockMap = readBlockMap(this.fileMetadataBuffer.slice(0, this.fileMetadataBuffer.length - 4));
      await this.doDownload(await readEmbeddedBlockMapData(this.options.oldFile), newBlockMap);
    }
  };
  FileWithEmbeddedBlockMapDifferentialDownloader.FileWithEmbeddedBlockMapDifferentialDownloader = FileWithEmbeddedBlockMapDifferentialDownloader$1;
  function readBlockMap(data) {
    return JSON.parse((0, zlib_1.inflateRawSync)(data).toString());
  }
  async function readEmbeddedBlockMapData(file2) {
    const fd = await (0, fs_extra_1.open)(file2, "r");
    try {
      const fileSize = (await (0, fs_extra_1.fstat)(fd)).size;
      const sizeBuffer = Buffer.allocUnsafe(4);
      await (0, fs_extra_1.read)(fd, sizeBuffer, 0, sizeBuffer.length, fileSize - sizeBuffer.length);
      const dataBuffer = Buffer.allocUnsafe(sizeBuffer.readUInt32BE(0));
      await (0, fs_extra_1.read)(fd, dataBuffer, 0, dataBuffer.length, fileSize - sizeBuffer.length - dataBuffer.length);
      await (0, fs_extra_1.close)(fd);
      return readBlockMap(dataBuffer);
    } catch (e) {
      await (0, fs_extra_1.close)(fd);
      throw e;
    }
  }
  return FileWithEmbeddedBlockMapDifferentialDownloader;
}
var hasRequiredAppImageUpdater;
function requireAppImageUpdater() {
  if (hasRequiredAppImageUpdater) return AppImageUpdater;
  hasRequiredAppImageUpdater = 1;
  Object.defineProperty(AppImageUpdater, "__esModule", { value: true });
  AppImageUpdater.AppImageUpdater = void 0;
  const builder_util_runtime_1 = requireOut();
  const child_process_1 = require$$1$3;
  const fs_extra_1 = /* @__PURE__ */ requireLib();
  const fs_1 = require$$1$2;
  const path = require$$1$1;
  const BaseUpdater_1 = requireBaseUpdater();
  const FileWithEmbeddedBlockMapDifferentialDownloader_1 = requireFileWithEmbeddedBlockMapDifferentialDownloader();
  const Provider_1 = requireProvider();
  const types_1 = requireTypes();
  let AppImageUpdater$1 = class AppImageUpdater extends BaseUpdater_1.BaseUpdater {
    constructor(options, app) {
      super(options, app);
    }
    isUpdaterActive() {
      if (process.env["APPIMAGE"] == null && !this.forceDevUpdateConfig) {
        if (process.env["SNAP"] == null) {
          this._logger.warn("APPIMAGE env is not defined, current application is not an AppImage");
        } else {
          this._logger.info("SNAP env is defined, updater is disabled");
        }
        return false;
      }
      return super.isUpdaterActive();
    }
    /*** @private */
    doDownloadUpdate(downloadUpdateOptions) {
      const provider = downloadUpdateOptions.updateInfoAndProvider.provider;
      const fileInfo = (0, Provider_1.findFile)(provider.resolveFiles(downloadUpdateOptions.updateInfoAndProvider.info), "AppImage", ["rpm", "deb", "pacman"]);
      return this.executeDownload({
        fileExtension: "AppImage",
        fileInfo,
        downloadUpdateOptions,
        task: async (updateFile, downloadOptions) => {
          const oldFile = process.env["APPIMAGE"];
          if (oldFile == null) {
            throw (0, builder_util_runtime_1.newError)("APPIMAGE env is not defined", "ERR_UPDATER_OLD_FILE_NOT_FOUND");
          }
          if (downloadUpdateOptions.disableDifferentialDownload || await this.downloadDifferential(fileInfo, oldFile, updateFile, provider, downloadUpdateOptions)) {
            await this.httpExecutor.download(fileInfo.url, updateFile, downloadOptions);
          }
          await (0, fs_extra_1.chmod)(updateFile, 493);
        }
      });
    }
    async downloadDifferential(fileInfo, oldFile, updateFile, provider, downloadUpdateOptions) {
      try {
        const downloadOptions = {
          newUrl: fileInfo.url,
          oldFile,
          logger: this._logger,
          newFile: updateFile,
          isUseMultipleRangeRequest: provider.isUseMultipleRangeRequest,
          requestHeaders: downloadUpdateOptions.requestHeaders,
          cancellationToken: downloadUpdateOptions.cancellationToken
        };
        if (this.listenerCount(types_1.DOWNLOAD_PROGRESS) > 0) {
          downloadOptions.onProgress = (it) => this.emit(types_1.DOWNLOAD_PROGRESS, it);
        }
        await new FileWithEmbeddedBlockMapDifferentialDownloader_1.FileWithEmbeddedBlockMapDifferentialDownloader(fileInfo.info, this.httpExecutor, downloadOptions).download();
        return false;
      } catch (e) {
        this._logger.error(`Cannot download differentially, fallback to full download: ${e.stack || e}`);
        return process.platform === "linux";
      }
    }
    doInstall(options) {
      const appImageFile = process.env["APPIMAGE"];
      if (appImageFile == null) {
        throw (0, builder_util_runtime_1.newError)("APPIMAGE env is not defined", "ERR_UPDATER_OLD_FILE_NOT_FOUND");
      }
      if (!path.isAbsolute(appImageFile) || appImageFile.includes("\0")) {
        throw (0, builder_util_runtime_1.newError)(`APPIMAGE env is not a valid absolute path: "${appImageFile}"`, "ERR_UPDATER_OLD_FILE_NOT_FOUND");
      }
      (0, fs_1.unlinkSync)(appImageFile);
      let destination;
      const existingBaseName = path.basename(appImageFile);
      const installerPath = this.installerPath;
      if (installerPath == null) {
        this.dispatchError(new Error("No update filepath provided, can't quit and install"));
        return false;
      }
      if (path.basename(installerPath) === existingBaseName || !/\d+\.\d+\.\d+/.test(existingBaseName)) {
        destination = appImageFile;
      } else {
        destination = path.join(path.dirname(appImageFile), path.basename(installerPath));
      }
      (0, child_process_1.execFileSync)("mv", ["-f", installerPath, destination]);
      if (destination !== appImageFile) {
        this.emit("appimage-filename-updated", destination);
      }
      const env = {
        ...process.env,
        APPIMAGE_SILENT_INSTALL: "true"
      };
      if (options.isForceRunAfter) {
        this.spawnLog(destination, [], env);
      } else {
        env.APPIMAGE_EXIT_AFTER_INSTALL = "true";
        (0, child_process_1.execFileSync)(destination, [], { env });
      }
      return true;
    }
  };
  AppImageUpdater.AppImageUpdater = AppImageUpdater$1;
  return AppImageUpdater;
}
var DebUpdater = {};
var LinuxUpdater = {};
var hasRequiredLinuxUpdater;
function requireLinuxUpdater() {
  if (hasRequiredLinuxUpdater) return LinuxUpdater;
  hasRequiredLinuxUpdater = 1;
  Object.defineProperty(LinuxUpdater, "__esModule", { value: true });
  LinuxUpdater.LinuxUpdater = void 0;
  const BaseUpdater_1 = requireBaseUpdater();
  const SAFE_PM_REGEX = /^[a-zA-Z0-9_-]+$/;
  let LinuxUpdater$1 = class LinuxUpdater extends BaseUpdater_1.BaseUpdater {
    constructor(options, app) {
      super(options, app);
    }
    /**
     * Returns true if the current process is running as root.
     */
    isRunningAsRoot() {
      var _a;
      return ((_a = process.getuid) === null || _a === void 0 ? void 0 : _a.call(process)) === 0;
    }
    /**
     * Sanitizes the installer path for use with shell:true spawn calls.
     * Backslash-escapes metacharacters that have special meaning in POSIX shell.
     * Note: paths containing single-quotes (') are not supported.
     */
    get installerPath() {
      const raw = super.installerPath;
      if (raw == null) {
        return null;
      }
      return raw.replace(/\\/g, "\\\\").replace(/([`$!" ;|&()<>])/g, "\\$1").replace(/[\n\r]/g, "");
    }
    runCommandWithSudoIfNeeded(commandWithArgs) {
      if (this.isRunningAsRoot()) {
        this._logger.info("Running as root, no need to use sudo");
        return this.spawnSyncLog(commandWithArgs[0], commandWithArgs.slice(1));
      }
      const { name } = this.app;
      const safeName = name.replace(/["`$\\!\n\r;|&<>(){}*?[\]#~]/g, "");
      const installComment = `"${safeName} would like to update"`;
      const sudo = this.sudoWithArgs(installComment);
      this._logger.info(`Running as non-root user, using sudo to install: ${sudo}`);
      let wrapper = `"`;
      if (/pkexec/i.test(sudo[0]) || sudo[0] === "sudo") {
        wrapper = "";
      }
      return this.spawnSyncLog(sudo[0], [...sudo.length > 1 ? sudo.slice(1) : [], `${wrapper}/bin/bash`, "-c", `'${commandWithArgs.join(" ")}'${wrapper}`]);
    }
    sudoWithArgs(installComment) {
      const sudo = this.determineSudoCommand();
      const command = [sudo];
      if (/kdesudo/i.test(sudo)) {
        command.push("--comment", installComment);
        command.push("-c");
      } else if (/gksudo/i.test(sudo)) {
        command.push("--message", installComment);
      } else if (/pkexec/i.test(sudo)) {
        command.push("--disable-internal-agent");
      }
      return command;
    }
    hasCommand(cmd) {
      try {
        this.spawnSyncLog(`command`, ["-v", cmd]);
        return true;
      } catch {
        return false;
      }
    }
    determineSudoCommand() {
      const sudos = ["gksudo", "kdesudo", "pkexec", "beesu"];
      for (const sudo of sudos) {
        if (this.hasCommand(sudo)) {
          return sudo;
        }
      }
      return "sudo";
    }
    /**
     * Detects the package manager to use based on the available commands.
     * Allows overriding the default behavior by setting the ELECTRON_BUILDER_LINUX_PACKAGE_MANAGER environment variable.
     * If the environment variable is set, it will be used directly. (This is useful for testing each package manager logic path.)
     * Otherwise, it checks for the presence of the specified package manager commands in the order provided.
     * @param pms - An array of package manager commands to check for, in priority order.
     * @returns The detected package manager command or "unknown" if none are found.
     */
    detectPackageManager(pms) {
      var _a;
      let availablePMs = pms;
      const pmOverride = (_a = process.env.ELECTRON_BUILDER_LINUX_PACKAGE_MANAGER) === null || _a === void 0 ? void 0 : _a.trim();
      if (pmOverride) {
        if (!SAFE_PM_REGEX.test(pmOverride)) {
          this._logger.warn(`ELECTRON_BUILDER_LINUX_PACKAGE_MANAGER "${pmOverride}" contains unsafe characters. Ignoring override.`);
        } else {
          availablePMs = [pmOverride];
        }
      }
      for (const pm of availablePMs) {
        if (this.hasCommand(pm)) {
          return pm;
        }
      }
      const searchList = pmOverride ? `ELECTRON_BUILDER_LINUX_PACKAGE_MANAGER override "${pmOverride}", ` : "";
      const defaultPM = pms[0];
      this._logger.warn(`No package manager found in the list: ${searchList}${pms.join(", ")}. Utilizing default: ${defaultPM}`);
      return defaultPM;
    }
  };
  LinuxUpdater.LinuxUpdater = LinuxUpdater$1;
  return LinuxUpdater;
}
var hasRequiredDebUpdater;
function requireDebUpdater() {
  if (hasRequiredDebUpdater) return DebUpdater;
  hasRequiredDebUpdater = 1;
  Object.defineProperty(DebUpdater, "__esModule", { value: true });
  DebUpdater.DebUpdater = void 0;
  const Provider_1 = requireProvider();
  const types_1 = requireTypes();
  const LinuxUpdater_1 = requireLinuxUpdater();
  let DebUpdater$1 = class DebUpdater2 extends LinuxUpdater_1.LinuxUpdater {
    constructor(options, app) {
      super(options, app);
    }
    /*** @private */
    doDownloadUpdate(downloadUpdateOptions) {
      const provider = downloadUpdateOptions.updateInfoAndProvider.provider;
      const fileInfo = (0, Provider_1.findFile)(provider.resolveFiles(downloadUpdateOptions.updateInfoAndProvider.info), "deb", ["AppImage", "rpm", "pacman"]);
      return this.executeDownload({
        fileExtension: "deb",
        fileInfo,
        downloadUpdateOptions,
        task: async (updateFile, downloadOptions) => {
          if (this.listenerCount(types_1.DOWNLOAD_PROGRESS) > 0) {
            downloadOptions.onProgress = (it) => this.emit(types_1.DOWNLOAD_PROGRESS, it);
          }
          await this.httpExecutor.download(fileInfo.url, updateFile, downloadOptions);
        }
      });
    }
    doInstall(options) {
      const installerPath = this.installerPath;
      if (installerPath == null) {
        this.dispatchError(new Error("No update filepath provided, can't quit and install"));
        return false;
      }
      if (!this.hasCommand("dpkg") && !this.hasCommand("apt")) {
        this.dispatchError(new Error("Neither dpkg nor apt command found. Cannot install .deb package."));
        return false;
      }
      const priorityList = ["dpkg", "apt"];
      const packageManager = this.detectPackageManager(priorityList);
      try {
        DebUpdater2.installWithCommandRunner(packageManager, installerPath, this.runCommandWithSudoIfNeeded.bind(this), this._logger);
      } catch (error2) {
        this.dispatchError(error2);
        return false;
      }
      if (options.isForceRunAfter) {
        this.app.relaunch();
      }
      return true;
    }
    static installWithCommandRunner(packageManager, installerPath, commandRunner, logger2) {
      var _a;
      if (packageManager === "dpkg") {
        try {
          commandRunner(["dpkg", "-i", installerPath]);
        } catch (error2) {
          logger2.warn((_a = error2.message) !== null && _a !== void 0 ? _a : error2);
          logger2.warn("dpkg installation failed, trying to fix broken dependencies with apt-get");
          commandRunner(["apt-get", "install", "-f", "-y"]);
        }
      } else if (packageManager === "apt") {
        logger2.warn("Using apt to install a local .deb. This may fail for unsigned packages unless properly configured.");
        commandRunner([
          "apt",
          "install",
          "-y",
          "--allow-unauthenticated",
          // needed for unsigned .debs
          "--allow-downgrades",
          // allow lower version installs
          "--allow-change-held-packages",
          installerPath
        ]);
      } else {
        throw new Error(`Package manager ${packageManager} not supported`);
      }
    }
  };
  DebUpdater.DebUpdater = DebUpdater$1;
  return DebUpdater;
}
var PacmanUpdater = {};
var hasRequiredPacmanUpdater;
function requirePacmanUpdater() {
  if (hasRequiredPacmanUpdater) return PacmanUpdater;
  hasRequiredPacmanUpdater = 1;
  Object.defineProperty(PacmanUpdater, "__esModule", { value: true });
  PacmanUpdater.PacmanUpdater = void 0;
  const types_1 = requireTypes();
  const Provider_1 = requireProvider();
  const LinuxUpdater_1 = requireLinuxUpdater();
  let PacmanUpdater$1 = class PacmanUpdater2 extends LinuxUpdater_1.LinuxUpdater {
    constructor(options, app) {
      super(options, app);
    }
    /*** @private */
    doDownloadUpdate(downloadUpdateOptions) {
      const provider = downloadUpdateOptions.updateInfoAndProvider.provider;
      const fileInfo = (0, Provider_1.findFile)(provider.resolveFiles(downloadUpdateOptions.updateInfoAndProvider.info), "pacman", ["AppImage", "deb", "rpm"]);
      return this.executeDownload({
        fileExtension: "pacman",
        fileInfo,
        downloadUpdateOptions,
        task: async (updateFile, downloadOptions) => {
          if (this.listenerCount(types_1.DOWNLOAD_PROGRESS) > 0) {
            downloadOptions.onProgress = (it) => this.emit(types_1.DOWNLOAD_PROGRESS, it);
          }
          await this.httpExecutor.download(fileInfo.url, updateFile, downloadOptions);
        }
      });
    }
    doInstall(options) {
      const installerPath = this.installerPath;
      if (installerPath == null) {
        this.dispatchError(new Error("No update filepath provided, can't quit and install"));
        return false;
      }
      try {
        PacmanUpdater2.installWithCommandRunner(installerPath, this.runCommandWithSudoIfNeeded.bind(this), this._logger);
      } catch (error2) {
        this.dispatchError(error2);
        return false;
      }
      if (options.isForceRunAfter) {
        this.app.relaunch();
      }
      return true;
    }
    static installWithCommandRunner(installerPath, commandRunner, logger2) {
      var _a;
      try {
        commandRunner(["pacman", "-U", "--noconfirm", installerPath]);
      } catch (error2) {
        logger2.warn((_a = error2.message) !== null && _a !== void 0 ? _a : error2);
        logger2.warn("pacman installation failed, attempting to update package database and retry");
        try {
          commandRunner(["pacman", "-Sy", "--noconfirm"]);
          commandRunner(["pacman", "-U", "--noconfirm", installerPath]);
        } catch (retryError) {
          logger2.error("Retry after pacman -Sy failed");
          throw retryError;
        }
      }
    }
  };
  PacmanUpdater.PacmanUpdater = PacmanUpdater$1;
  return PacmanUpdater;
}
var RpmUpdater = {};
var hasRequiredRpmUpdater;
function requireRpmUpdater() {
  if (hasRequiredRpmUpdater) return RpmUpdater;
  hasRequiredRpmUpdater = 1;
  Object.defineProperty(RpmUpdater, "__esModule", { value: true });
  RpmUpdater.RpmUpdater = void 0;
  const types_1 = requireTypes();
  const Provider_1 = requireProvider();
  const LinuxUpdater_1 = requireLinuxUpdater();
  let RpmUpdater$1 = class RpmUpdater2 extends LinuxUpdater_1.LinuxUpdater {
    constructor(options, app) {
      super(options, app);
    }
    /*** @private */
    doDownloadUpdate(downloadUpdateOptions) {
      const provider = downloadUpdateOptions.updateInfoAndProvider.provider;
      const fileInfo = (0, Provider_1.findFile)(provider.resolveFiles(downloadUpdateOptions.updateInfoAndProvider.info), "rpm", ["AppImage", "deb", "pacman"]);
      return this.executeDownload({
        fileExtension: "rpm",
        fileInfo,
        downloadUpdateOptions,
        task: async (updateFile, downloadOptions) => {
          if (this.listenerCount(types_1.DOWNLOAD_PROGRESS) > 0) {
            downloadOptions.onProgress = (it) => this.emit(types_1.DOWNLOAD_PROGRESS, it);
          }
          await this.httpExecutor.download(fileInfo.url, updateFile, downloadOptions);
        }
      });
    }
    doInstall(options) {
      const installerPath = this.installerPath;
      if (installerPath == null) {
        this.dispatchError(new Error("No update filepath provided, can't quit and install"));
        return false;
      }
      const priorityList = ["zypper", "dnf", "yum", "rpm"];
      const packageManager = this.detectPackageManager(priorityList);
      try {
        RpmUpdater2.installWithCommandRunner(packageManager, installerPath, this.runCommandWithSudoIfNeeded.bind(this), this._logger);
      } catch (error2) {
        this.dispatchError(error2);
        return false;
      }
      if (options.isForceRunAfter) {
        this.app.relaunch();
      }
      return true;
    }
    static installWithCommandRunner(packageManager, installerPath, commandRunner, logger2) {
      if (packageManager === "zypper") {
        return commandRunner(["zypper", "--non-interactive", "--no-refresh", "install", "--allow-unsigned-rpm", "-f", installerPath]);
      }
      if (packageManager === "dnf") {
        return commandRunner(["dnf", "install", "--nogpgcheck", "-y", installerPath]);
      }
      if (packageManager === "yum") {
        return commandRunner(["yum", "install", "--nogpgcheck", "-y", installerPath]);
      }
      if (packageManager === "rpm") {
        logger2.warn("Installing with rpm only (no dependency resolution).");
        return commandRunner(["rpm", "-Uvh", "--replacepkgs", "--replacefiles", "--nodeps", installerPath]);
      }
      throw new Error(`Package manager ${packageManager} not supported`);
    }
  };
  RpmUpdater.RpmUpdater = RpmUpdater$1;
  return RpmUpdater;
}
var MacUpdater = {};
var hasRequiredMacUpdater;
function requireMacUpdater() {
  if (hasRequiredMacUpdater) return MacUpdater;
  hasRequiredMacUpdater = 1;
  Object.defineProperty(MacUpdater, "__esModule", { value: true });
  MacUpdater.MacUpdater = void 0;
  const builder_util_runtime_1 = requireOut();
  const fs_extra_1 = /* @__PURE__ */ requireLib();
  const fs_1 = require$$1$2;
  const path = require$$1$1;
  const http_1 = require$$4;
  const AppUpdater_1 = requireAppUpdater();
  const Provider_1 = requireProvider();
  const child_process_1 = require$$1$3;
  const crypto_1 = crypto;
  let MacUpdater$1 = class MacUpdater2 extends AppUpdater_1.AppUpdater {
    constructor(options, app) {
      super(options, app);
      this.nativeUpdater = require$$1.autoUpdater;
      this.squirrelDownloadedUpdate = false;
      this.nativeUpdater.on("error", (it) => {
        this._logger.warn(it);
        this.emit("error", it);
      });
      this.nativeUpdater.on("update-downloaded", () => {
        this.squirrelDownloadedUpdate = true;
        this.debug("nativeUpdater.update-downloaded");
      });
    }
    /** Filters update files to the appropriate architecture.
     * On arm64 Macs (including Rosetta), arm64 files are preferred when available.
     * On x64 Macs, arm64 files are excluded. */
    static filterFilesForArch(files, isArm64Mac) {
      const isArm64File = (file2) => {
        var _a;
        return file2.url.pathname.includes("arm64") || ((_a = file2.info.url) === null || _a === void 0 ? void 0 : _a.includes("arm64"));
      };
      if (isArm64Mac && files.some(isArm64File)) {
        return files.filter((file2) => isArm64Mac === isArm64File(file2));
      }
      return files.filter((file2) => !isArm64File(file2));
    }
    debug(message) {
      if (this._logger.debug != null) {
        this._logger.debug(message);
      }
    }
    closeServerIfExists() {
      if (this.server) {
        this.debug("Closing proxy server");
        this.server.close((err) => {
          if (err) {
            this.debug("proxy server wasn't already open, probably attempted closing again as a safety check before quit");
          }
        });
      }
    }
    async doDownloadUpdate(downloadUpdateOptions) {
      let files = downloadUpdateOptions.updateInfoAndProvider.provider.resolveFiles(downloadUpdateOptions.updateInfoAndProvider.info);
      const log = this._logger;
      const sysctlRosettaInfoKey = "sysctl.proc_translated";
      let isRosetta = false;
      try {
        this.debug("Checking for macOS Rosetta environment");
        const result = (0, child_process_1.execFileSync)("sysctl", [sysctlRosettaInfoKey], { encoding: "utf8" });
        isRosetta = result.includes(`${sysctlRosettaInfoKey}: 1`);
        log.info(`Checked for macOS Rosetta environment (isRosetta=${isRosetta})`);
      } catch (e) {
        log.warn(`sysctl shell command to check for macOS Rosetta environment failed: ${e}`);
      }
      let isArm64Mac = false;
      try {
        this.debug("Checking for arm64 in uname");
        const result = (0, child_process_1.execFileSync)("uname", ["-a"], { encoding: "utf8" });
        const isArm = result.includes("ARM");
        log.info(`Checked 'uname -a': arm64=${isArm}`);
        isArm64Mac = isArm64Mac || isArm;
      } catch (e) {
        log.warn(`uname shell command to check for arm64 failed: ${e}`);
      }
      isArm64Mac = isArm64Mac || process.arch === "arm64" || isRosetta;
      files = MacUpdater2.filterFilesForArch(files, isArm64Mac);
      const zipFileInfo = (0, Provider_1.findFile)(files, "zip", ["pkg", "dmg"]);
      if (zipFileInfo == null) {
        throw (0, builder_util_runtime_1.newError)(`ZIP file not provided: ${(0, builder_util_runtime_1.safeStringifyJson)(files)}`, "ERR_UPDATER_ZIP_FILE_NOT_FOUND");
      }
      const provider = downloadUpdateOptions.updateInfoAndProvider.provider;
      const CURRENT_MAC_APP_ZIP_FILE_NAME = "update.zip";
      return this.executeDownload({
        fileExtension: "zip",
        fileInfo: zipFileInfo,
        downloadUpdateOptions,
        task: async (destinationFile, downloadOptions) => {
          const cachedUpdateFilePath = path.join(this.downloadedUpdateHelper.cacheDir, CURRENT_MAC_APP_ZIP_FILE_NAME);
          const canDifferentialDownload = () => {
            if (!(0, fs_extra_1.pathExistsSync)(cachedUpdateFilePath)) {
              log.info("Unable to locate previous update.zip for differential download (is this first install?), falling back to full download");
              return false;
            }
            return !downloadUpdateOptions.disableDifferentialDownload;
          };
          let differentialDownloadFailed = true;
          if (canDifferentialDownload()) {
            differentialDownloadFailed = await this.differentialDownloadInstaller(zipFileInfo, downloadUpdateOptions, destinationFile, provider, CURRENT_MAC_APP_ZIP_FILE_NAME);
          }
          if (differentialDownloadFailed) {
            await this.httpExecutor.download(zipFileInfo.url, destinationFile, downloadOptions);
          }
        },
        done: async (event) => {
          if (!downloadUpdateOptions.disableDifferentialDownload) {
            try {
              const cachedUpdateFilePath = path.join(this.downloadedUpdateHelper.cacheDir, CURRENT_MAC_APP_ZIP_FILE_NAME);
              await (0, fs_extra_1.copyFile)(event.downloadedFile, cachedUpdateFilePath);
            } catch (error2) {
              this._logger.warn(`Unable to copy file for caching for future differential downloads: ${error2.message}`);
            }
          }
          return this.updateDownloaded(zipFileInfo, event);
        }
      });
    }
    async updateDownloaded(zipFileInfo, event) {
      var _a;
      const downloadedFile = event.downloadedFile;
      const updateFileSize = (_a = zipFileInfo.info.size) !== null && _a !== void 0 ? _a : (await (0, fs_extra_1.stat)(downloadedFile)).size;
      const log = this._logger;
      const logContext = `fileToProxy=${zipFileInfo.url.href}`;
      this.closeServerIfExists();
      this.debug(`Creating proxy server for native Squirrel.Mac (${logContext})`);
      this.server = (0, http_1.createServer)();
      this.debug(`Proxy server for native Squirrel.Mac is created (${logContext})`);
      this.server.on("close", () => {
        log.info(`Proxy server for native Squirrel.Mac is closed (${logContext})`);
      });
      const getServerUrl = (s) => {
        const address = s.address();
        if (typeof address === "string") {
          return address;
        }
        return `http://127.0.0.1:${address === null || address === void 0 ? void 0 : address.port}`;
      };
      return await new Promise((resolve, reject) => {
        const pass = (0, crypto_1.randomBytes)(64).toString("base64").replace(/\//g, "_").replace(/\+/g, "-");
        const authInfo = Buffer.from(`autoupdater:${pass}`, "ascii");
        const fileUrl = `/${(0, crypto_1.randomBytes)(64).toString("hex")}.zip`;
        this.server.on("request", (request, response) => {
          const requestUrl = request.url;
          log.info(`${requestUrl} requested`);
          if (requestUrl === "/") {
            if (!request.headers.authorization || request.headers.authorization.indexOf("Basic ") === -1) {
              response.statusCode = 401;
              response.statusMessage = "Invalid Authentication Credentials";
              response.end();
              log.warn("No authenthication info");
              return;
            }
            const base64Credentials = request.headers.authorization.split(" ")[1];
            const credentials = Buffer.from(base64Credentials, "base64").toString("ascii");
            const [username, password] = credentials.split(":");
            if (username !== "autoupdater" || password !== pass) {
              response.statusCode = 401;
              response.statusMessage = "Invalid Authentication Credentials";
              response.end();
              log.warn("Invalid authenthication credentials");
              return;
            }
            const data = Buffer.from(`{ "url": "${getServerUrl(this.server)}${fileUrl}" }`);
            response.writeHead(200, { "Content-Type": "application/json", "Content-Length": data.length });
            response.end(data);
            return;
          }
          if (!requestUrl.startsWith(fileUrl)) {
            log.warn(`${requestUrl} requested, but not supported`);
            response.writeHead(404);
            response.end();
            return;
          }
          log.info(`${fileUrl} requested by Squirrel.Mac, pipe ${downloadedFile}`);
          let errorOccurred = false;
          response.on("finish", () => {
            if (!errorOccurred) {
              this.nativeUpdater.removeListener("error", reject);
              resolve([]);
            }
          });
          const readStream = (0, fs_1.createReadStream)(downloadedFile);
          readStream.on("error", (error2) => {
            try {
              response.end();
            } catch (e) {
              log.warn(`cannot end response: ${e}`);
            }
            errorOccurred = true;
            this.nativeUpdater.removeListener("error", reject);
            reject(new Error(`Cannot pipe "${downloadedFile}": ${error2}`));
          });
          response.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Length": updateFileSize
          });
          readStream.pipe(response);
        });
        this.debug(`Proxy server for native Squirrel.Mac is starting to listen (${logContext})`);
        this.server.listen(0, "127.0.0.1", () => {
          this.debug(`Proxy server for native Squirrel.Mac is listening (address=${getServerUrl(this.server)}, ${logContext})`);
          this.nativeUpdater.setFeedURL({
            url: getServerUrl(this.server),
            headers: {
              "Cache-Control": "no-cache",
              Authorization: `Basic ${authInfo.toString("base64")}`
            }
          });
          this.dispatchUpdateDownloaded(event);
          if (this.autoInstallOnAppQuit) {
            this.nativeUpdater.once("error", reject);
            this.nativeUpdater.checkForUpdates();
          } else {
            resolve([]);
          }
        });
      });
    }
    handleUpdateDownloaded() {
      if (this.autoRunAppAfterInstall) {
        this.nativeUpdater.quitAndInstall();
      } else {
        this.app.quit();
      }
      this.closeServerIfExists();
    }
    quitAndInstall() {
      if (this.squirrelDownloadedUpdate) {
        this.handleUpdateDownloaded();
      } else {
        this.nativeUpdater.on("update-downloaded", () => this.handleUpdateDownloaded());
        if (!this.autoInstallOnAppQuit) {
          this.nativeUpdater.checkForUpdates();
        }
      }
    }
  };
  MacUpdater.MacUpdater = MacUpdater$1;
  return MacUpdater;
}
var NsisUpdater = {};
var windowsExecutableCodeSignatureVerifier = {};
var hasRequiredWindowsExecutableCodeSignatureVerifier;
function requireWindowsExecutableCodeSignatureVerifier() {
  if (hasRequiredWindowsExecutableCodeSignatureVerifier) return windowsExecutableCodeSignatureVerifier;
  hasRequiredWindowsExecutableCodeSignatureVerifier = 1;
  Object.defineProperty(windowsExecutableCodeSignatureVerifier, "__esModule", { value: true });
  windowsExecutableCodeSignatureVerifier.verifySignature = verifySignature;
  const builder_util_runtime_1 = requireOut();
  const child_process_1 = require$$1$3;
  const os$1 = os;
  const path = require$$1$1;
  function preparePowerShellExec(command, timeout) {
    const executable = `set "PSModulePath=" & chcp 65001 >NUL & powershell.exe`;
    const args = ["-NoProfile", "-NonInteractive", "-InputFormat", "None", "-Command", command];
    const options = {
      shell: true,
      timeout
    };
    return [executable, args, options];
  }
  function verifySignature(publisherNames, unescapedTempUpdateFile, logger2) {
    return new Promise((resolve, reject) => {
      const tempUpdateFile = unescapedTempUpdateFile.replace(/'/g, "''");
      logger2.info(`Verifying signature ${tempUpdateFile}`);
      (0, child_process_1.execFile)(...preparePowerShellExec(`"Get-AuthenticodeSignature -LiteralPath '${tempUpdateFile}' | ConvertTo-Json -Compress"`, 20 * 1e3), (error2, stdout, stderr) => {
        var _a;
        try {
          if (error2 != null || stderr) {
            handleError(logger2, error2, stderr, reject);
            resolve(null);
            return;
          }
          const data = parseOut(stdout);
          if (data.Status === 0) {
            try {
              const normlaizedUpdateFilePath = path.normalize(data.Path);
              const normalizedTempUpdateFile = path.normalize(unescapedTempUpdateFile);
              logger2.info(`LiteralPath: ${normlaizedUpdateFilePath}. Update Path: ${normalizedTempUpdateFile}`);
              if (normlaizedUpdateFilePath !== normalizedTempUpdateFile) {
                handleError(logger2, new Error(`LiteralPath of ${normlaizedUpdateFilePath} is different than ${normalizedTempUpdateFile}`), stderr, reject);
                resolve(null);
                return;
              }
            } catch (error3) {
              logger2.warn(`Unable to verify LiteralPath of update asset due to missing data.Path. Skipping this step of validation. Message: ${(_a = error3.message) !== null && _a !== void 0 ? _a : error3.stack}`);
            }
            const subject = (0, builder_util_runtime_1.parseDn)(data.SignerCertificate.Subject);
            let match = false;
            for (const name of publisherNames) {
              const dn = (0, builder_util_runtime_1.parseDn)(name);
              if (dn.size) {
                const allKeys = Array.from(dn.keys());
                match = allKeys.every((key) => {
                  return dn.get(key) === subject.get(key);
                });
              } else if (name === subject.get("CN")) {
                logger2.warn(`Signature validated using only CN ${name}. Please add your full Distinguished Name (DN) to publisherNames configuration`);
                match = true;
              }
              if (match) {
                resolve(null);
                return;
              }
            }
          }
          const result = `publisherNames: ${publisherNames.join(" | ")}, raw info: ` + JSON.stringify(data, (name, value) => name === "RawData" ? void 0 : value, 2);
          logger2.warn(`Sign verification failed, installer signed with incorrect certificate: ${result}`);
          resolve(result);
        } catch (e) {
          handleError(logger2, e, null, reject);
          resolve(null);
          return;
        }
      });
    });
  }
  function parseOut(out2) {
    const data = JSON.parse(out2);
    delete data.PrivateKey;
    delete data.IsOSBinary;
    delete data.SignatureType;
    const signerCertificate = data.SignerCertificate;
    if (signerCertificate != null) {
      delete signerCertificate.Archived;
      delete signerCertificate.Extensions;
      delete signerCertificate.Handle;
      delete signerCertificate.HasPrivateKey;
      delete signerCertificate.SubjectName;
    }
    return data;
  }
  function handleError(logger2, error2, stderr, reject) {
    if (isOldWin6()) {
      logger2.warn(`Cannot execute Get-AuthenticodeSignature: ${error2 || stderr}. Ignoring signature validation due to unsupported powershell version. Please upgrade to powershell 3 or higher.`);
      return;
    }
    try {
      (0, child_process_1.execFileSync)(...preparePowerShellExec("ConvertTo-Json test", 10 * 1e3));
    } catch (testError) {
      logger2.warn(`Cannot execute ConvertTo-Json: ${testError.message}. Ignoring signature validation due to unsupported powershell version. Please upgrade to powershell 3 or higher.`);
      return;
    }
    if (error2 != null) {
      reject(error2);
    }
    if (stderr) {
      reject(new Error(`Cannot execute Get-AuthenticodeSignature, stderr: ${stderr}. Failing signature validation due to unknown stderr.`));
    }
  }
  function isOldWin6() {
    const winVersion = os$1.release();
    return winVersion.startsWith("6.") && !winVersion.startsWith("6.3");
  }
  return windowsExecutableCodeSignatureVerifier;
}
var hasRequiredNsisUpdater;
function requireNsisUpdater() {
  if (hasRequiredNsisUpdater) return NsisUpdater;
  hasRequiredNsisUpdater = 1;
  Object.defineProperty(NsisUpdater, "__esModule", { value: true });
  NsisUpdater.NsisUpdater = void 0;
  const builder_util_runtime_1 = requireOut();
  const path = require$$1$1;
  const BaseUpdater_1 = requireBaseUpdater();
  const FileWithEmbeddedBlockMapDifferentialDownloader_1 = requireFileWithEmbeddedBlockMapDifferentialDownloader();
  const types_1 = requireTypes();
  const Provider_1 = requireProvider();
  const fs_extra_1 = /* @__PURE__ */ requireLib();
  const windowsExecutableCodeSignatureVerifier_1 = requireWindowsExecutableCodeSignatureVerifier();
  const url_1 = require$$2;
  let NsisUpdater$1 = class NsisUpdater extends BaseUpdater_1.BaseUpdater {
    constructor(options, app) {
      super(options, app);
      this._verifyUpdateCodeSignature = (publisherNames, unescapedTempUpdateFile) => (0, windowsExecutableCodeSignatureVerifier_1.verifySignature)(publisherNames, unescapedTempUpdateFile, this._logger);
    }
    /**
     * The verifyUpdateCodeSignature. You can pass [win-verify-signature](https://github.com/beyondkmp/win-verify-trust) or another custom verify function: ` (publisherName: string[], path: string) => Promise<string | null>`.
     * The default verify function uses [windowsExecutableCodeSignatureVerifier](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/windowsExecutableCodeSignatureVerifier.ts)
     */
    get verifyUpdateCodeSignature() {
      return this._verifyUpdateCodeSignature;
    }
    set verifyUpdateCodeSignature(value) {
      if (value) {
        this._verifyUpdateCodeSignature = value;
      }
    }
    /*** @private */
    doDownloadUpdate(downloadUpdateOptions) {
      const provider = downloadUpdateOptions.updateInfoAndProvider.provider;
      const fileInfo = (0, Provider_1.findFile)(provider.resolveFiles(downloadUpdateOptions.updateInfoAndProvider.info), "exe");
      return this.executeDownload({
        fileExtension: "exe",
        downloadUpdateOptions,
        fileInfo,
        task: async (destinationFile, downloadOptions, packageFile, removeTempDirIfAny) => {
          const packageInfo = fileInfo.packageInfo;
          const isWebInstaller = packageInfo != null && packageFile != null;
          if (isWebInstaller && downloadUpdateOptions.disableWebInstaller) {
            throw (0, builder_util_runtime_1.newError)(`Unable to download new version ${downloadUpdateOptions.updateInfoAndProvider.info.version}. Web Installers are disabled`, "ERR_UPDATER_WEB_INSTALLER_DISABLED");
          }
          if (!isWebInstaller && !downloadUpdateOptions.disableWebInstaller) {
            this._logger.warn("disableWebInstaller is set to false, you should set it to true if you do not plan on using a web installer. This will default to true in a future version.");
          }
          if (isWebInstaller || downloadUpdateOptions.disableDifferentialDownload || await this.differentialDownloadInstaller(fileInfo, downloadUpdateOptions, destinationFile, provider, builder_util_runtime_1.CURRENT_APP_INSTALLER_FILE_NAME)) {
            await this.httpExecutor.download(fileInfo.url, destinationFile, downloadOptions);
          }
          const signatureVerificationStatus = await this.verifySignature(destinationFile);
          if (signatureVerificationStatus != null) {
            await removeTempDirIfAny();
            throw (0, builder_util_runtime_1.newError)(`New version ${downloadUpdateOptions.updateInfoAndProvider.info.version} is not signed by the application owner: ${signatureVerificationStatus}`, "ERR_UPDATER_INVALID_SIGNATURE");
          }
          if (isWebInstaller) {
            if (await this.differentialDownloadWebPackage(downloadUpdateOptions, packageInfo, packageFile, provider)) {
              try {
                await this.httpExecutor.download(new url_1.URL(packageInfo.path), packageFile, {
                  headers: downloadUpdateOptions.requestHeaders,
                  cancellationToken: downloadUpdateOptions.cancellationToken,
                  sha512: packageInfo.sha512
                });
              } catch (e) {
                try {
                  await (0, fs_extra_1.unlink)(packageFile);
                } catch (_ignored) {
                }
                throw e;
              }
            }
          }
        }
      });
    }
    // $certificateInfo = (Get-AuthenticodeSignature 'xxx\yyy.exe'
    // | where {$_.Status.Equals([System.Management.Automation.SignatureStatus]::Valid) -and $_.SignerCertificate.Subject.Contains("CN=siemens.com")})
    // | Out-String ; if ($certificateInfo) { exit 0 } else { exit 1 }
    async verifySignature(tempUpdateFile) {
      let publisherName;
      try {
        publisherName = (await this.configOnDisk.value).publisherName;
        if (publisherName == null) {
          return null;
        }
      } catch (e) {
        if (e.code === "ENOENT") {
          return null;
        }
        throw e;
      }
      return await this._verifyUpdateCodeSignature(Array.isArray(publisherName) ? publisherName : [publisherName], tempUpdateFile);
    }
    doInstall(options) {
      const installerPath = this.installerPath;
      if (installerPath == null) {
        this.dispatchError(new Error("No update filepath provided, can't quit and install"));
        return false;
      }
      const args = ["--updated"];
      if (options.isSilent) {
        args.push("/S");
      }
      if (options.isForceRunAfter) {
        args.push("--force-run");
      }
      if (this.installDirectory) {
        args.push(`/D=${this.installDirectory}`);
      }
      const packagePath = this.downloadedUpdateHelper == null ? null : this.downloadedUpdateHelper.packageFile;
      if (packagePath != null) {
        args.push(`--package-file=${packagePath}`);
      }
      const callUsingElevation = () => {
        this.spawnLog(path.join(process.resourcesPath, "elevate.exe"), [installerPath].concat(args)).catch((e) => this.dispatchError(e));
      };
      if (options.isAdminRightsRequired) {
        this._logger.info("isAdminRightsRequired is set to true, run installer using elevate.exe");
        callUsingElevation();
        return true;
      }
      this.spawnLog(installerPath, args).catch((e) => {
        const errorCode = e.code;
        this._logger.info(`Cannot run installer: error code: ${errorCode}, error message: "${e.message}", will be executed again using elevate if EACCES, and will try to use electron.shell.openItem if ENOENT`);
        if (errorCode === "UNKNOWN" || errorCode === "EACCES") {
          callUsingElevation();
        } else if (errorCode === "ENOENT") {
          require$$1.shell.openPath(installerPath).catch((err) => this.dispatchError(err));
        } else {
          this.dispatchError(e);
        }
      });
      return true;
    }
    async differentialDownloadWebPackage(downloadUpdateOptions, packageInfo, packagePath, provider) {
      if (packageInfo.blockMapSize == null) {
        return true;
      }
      try {
        const downloadOptions = {
          newUrl: new url_1.URL(packageInfo.path),
          oldFile: path.join(this.downloadedUpdateHelper.cacheDir, builder_util_runtime_1.CURRENT_APP_PACKAGE_FILE_NAME),
          logger: this._logger,
          newFile: packagePath,
          requestHeaders: this.requestHeaders,
          isUseMultipleRangeRequest: provider.isUseMultipleRangeRequest,
          cancellationToken: downloadUpdateOptions.cancellationToken
        };
        if (this.listenerCount(types_1.DOWNLOAD_PROGRESS) > 0) {
          downloadOptions.onProgress = (it) => this.emit(types_1.DOWNLOAD_PROGRESS, it);
        }
        await new FileWithEmbeddedBlockMapDifferentialDownloader_1.FileWithEmbeddedBlockMapDifferentialDownloader(packageInfo, this.httpExecutor, downloadOptions).download();
      } catch (e) {
        this._logger.error(`Cannot download differentially, fallback to full download: ${e.stack || e}`);
        return process.platform === "win32";
      }
      return false;
    }
  };
  NsisUpdater.NsisUpdater = NsisUpdater$1;
  return NsisUpdater;
}
var hasRequiredMain;
function requireMain() {
  if (hasRequiredMain) return main$1;
  hasRequiredMain = 1;
  (function(exports) {
    var __createBinding = main$1 && main$1.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = main$1 && main$1.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NsisUpdater = exports.MacUpdater = exports.RpmUpdater = exports.PacmanUpdater = exports.DebUpdater = exports.AppImageUpdater = exports.Provider = exports.NoOpLogger = exports.AppUpdater = exports.BaseUpdater = void 0;
    const fs_extra_1 = /* @__PURE__ */ requireLib();
    const path = require$$1$1;
    var BaseUpdater_1 = requireBaseUpdater();
    Object.defineProperty(exports, "BaseUpdater", { enumerable: true, get: function() {
      return BaseUpdater_1.BaseUpdater;
    } });
    var AppUpdater_1 = requireAppUpdater();
    Object.defineProperty(exports, "AppUpdater", { enumerable: true, get: function() {
      return AppUpdater_1.AppUpdater;
    } });
    Object.defineProperty(exports, "NoOpLogger", { enumerable: true, get: function() {
      return AppUpdater_1.NoOpLogger;
    } });
    var Provider_1 = requireProvider();
    Object.defineProperty(exports, "Provider", { enumerable: true, get: function() {
      return Provider_1.Provider;
    } });
    var AppImageUpdater_1 = requireAppImageUpdater();
    Object.defineProperty(exports, "AppImageUpdater", { enumerable: true, get: function() {
      return AppImageUpdater_1.AppImageUpdater;
    } });
    var DebUpdater_1 = requireDebUpdater();
    Object.defineProperty(exports, "DebUpdater", { enumerable: true, get: function() {
      return DebUpdater_1.DebUpdater;
    } });
    var PacmanUpdater_1 = requirePacmanUpdater();
    Object.defineProperty(exports, "PacmanUpdater", { enumerable: true, get: function() {
      return PacmanUpdater_1.PacmanUpdater;
    } });
    var RpmUpdater_1 = requireRpmUpdater();
    Object.defineProperty(exports, "RpmUpdater", { enumerable: true, get: function() {
      return RpmUpdater_1.RpmUpdater;
    } });
    var MacUpdater_1 = requireMacUpdater();
    Object.defineProperty(exports, "MacUpdater", { enumerable: true, get: function() {
      return MacUpdater_1.MacUpdater;
    } });
    var NsisUpdater_1 = requireNsisUpdater();
    Object.defineProperty(exports, "NsisUpdater", { enumerable: true, get: function() {
      return NsisUpdater_1.NsisUpdater;
    } });
    __exportStar(requireTypes(), exports);
    let _autoUpdater;
    function doLoadAutoUpdater() {
      if (process.platform === "win32") {
        _autoUpdater = new (requireNsisUpdater()).NsisUpdater();
      } else if (process.platform === "darwin") {
        _autoUpdater = new (requireMacUpdater()).MacUpdater();
      } else {
        _autoUpdater = new (requireAppImageUpdater()).AppImageUpdater();
        try {
          const identity = path.join(process.resourcesPath, "package-type");
          if (!(0, fs_extra_1.existsSync)(identity)) {
            return _autoUpdater;
          }
          const fileType = (0, fs_extra_1.readFileSync)(identity).toString().trim();
          switch (fileType) {
            case "deb":
              _autoUpdater = new (requireDebUpdater()).DebUpdater();
              break;
            case "rpm":
              _autoUpdater = new (requireRpmUpdater()).RpmUpdater();
              break;
            case "pacman":
              _autoUpdater = new (requirePacmanUpdater()).PacmanUpdater();
              break;
            default:
              break;
          }
        } catch (error2) {
          console.warn("Unable to detect 'package-type' for autoUpdater (rpm/deb/pacman support). If you'd like to expand support, please consider contributing to electron-builder", error2.message);
        }
      }
      return _autoUpdater;
    }
    Object.defineProperty(exports, "autoUpdater", {
      enumerable: true,
      get: () => {
        return _autoUpdater || doLoadAutoUpdater();
      }
    });
  })(main$1);
  return main$1;
}
var mainExports = requireMain();
const updateLogger = createLogger("UPDATE");
function initAutoUpdater() {
  mainExports.autoUpdater.logger = null;
  require$$1.ipcMain.handle("updater.check", async () => {
    try {
      await mainExports.autoUpdater.checkForUpdates();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  mainExports.autoUpdater.on("error", (err) => {
    updateLogger.warn("AutoUpdater error", err?.message || err);
  });
  if (require$$1.app.isPackaged) {
    try {
      mainExports.autoUpdater.checkForUpdatesAndNotify().catch(() => {
      });
    } catch {
    }
  }
  mainExports.autoUpdater.on("update-downloaded", () => {
    const { dialog: dialog2 } = require("electron");
    dialog2.showMessageBox({
      type: "info",
      title: "Update Ready",
      message: "A new version of Apposition is ready to be installed.",
      buttons: ["Restart and Install", "Later"]
    }).then((result) => {
      if (result.response === 0) {
        mainExports.autoUpdater.quitAndInstall();
      }
    });
  });
}
function initDiagnosticsIpc(logFilePath, isDevMode2) {
  require$$1.ipcMain.handle("diagnostics.getHealth", () => {
    return {
      uptimeSec: Math.floor(process.uptime()),
      ...runtimeState.getState()
    };
  });
  require$$1.ipcMain.handle("diagnostics.getErrors", () => {
    return flightRecorder.getErrors();
  });
  require$$1.ipcMain.handle("diagnostics.getFlightRecorder", () => {
    return flightRecorder.snapshot();
  });
  require$$1.ipcMain.handle("diagnostics.toggleGuestNoise", () => {
    const next = !runtimeState.getState().guestLogsMuted;
    runtimeState.setGuestLogsMuted(next);
    return next;
  });
  require$$1.ipcMain.handle("diagnostics.openLogFile", () => {
    require$$1.shell.openPath(logFilePath);
  });
}
function initDevCommandBridge(isDevMode2) {
  if (!isDevMode2) return;
  const cmdPath = require$$1$1.join(require$$1.app.getPath("userData"), ".apposition-command.json");
  const checkCommand = () => {
    if (!require$$1$2.existsSync(cmdPath)) return;
    try {
      const data = JSON.parse(require$$1$2.readFileSync(cmdPath, "utf8"));
      require$$1$2.unlinkSync(cmdPath);
      if (data.command === "reload") {
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          logger.info("Soft reloading main window via dev command");
          global.mainWindow.webContents.reload();
        }
      } else if (data.command === "quit") {
        logger.info("Gracefully quitting via dev command");
        require$$1.app.quit();
      }
    } catch {
    }
  };
  try {
    const dir = require$$1.app.getPath("userData");
    require$$1$2.watch(dir, (_event, filename) => {
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
      release: `apposition@${require$$1.app.getVersion()}`,
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
applyBrowserSwitches(require$$1.app);
const isDevMode = utils$2.is.dev || require$$1.app.getName().includes("Dev") || process.env.APP_ENV === "dev";
initMainSentry(isDevMode);
if (isDevMode) {
  require$$1.app.setName("Apposition Dev");
  try {
    require$$1.app.setPath("userData", require$$1$1.join(require$$1.app.getPath("appData"), "AppositionDev"));
  } catch {
  }
} else {
  require$$1.app.setName("Apposition");
}
const gotTheLock = require$$1.app.requestSingleInstanceLock();
if (!gotTheLock) {
  require$$1.app.quit();
} else {
  const logFile = require$$1$1.join(require$$1.app.getPath("userData"), "apposition.log");
  logger.setFileSink(logFile);
  runtimeState.init(require$$1$1.join(require$$1.app.getPath("userData"), ".apposition-runtime.json"));
  if (isDevMode) {
    printStartupBanner(require$$1.app.getVersion(), logFile);
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
  require$$1.app.on("second-instance", () => {
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      if (global.mainWindow.isMinimized()) global.mainWindow.restore();
      global.mainWindow.focus();
    }
  });
  initDeepLinking();
  require$$1.app.whenReady().then(() => {
    initAutoUpdater();
    require$$1.Menu.setApplicationMenu(null);
    if (isDevMode) {
      utils$2.electronApp.setAppUserModelId("com.jvondev.apposition.dev");
    } else {
      utils$2.electronApp.setAppUserModelId("com.jvondev.apposition.app");
    }
    require$$1.app.on("browser-window-focus", () => {
      require$$1.globalShortcut.register("Alt+Space", () => {
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send("forwarded-key", {
            key: " ",
            code: "Space",
            control: false,
            meta: false,
            shift: false,
            alt: true,
            isInputFocused: false
          });
        }
      });
    });
    require$$1.app.on("browser-window-blur", () => {
      require$$1.globalShortcut.unregister("Alt+Space");
    });
    require$$1.nativeTheme.themeSource = "light";
    gcDeletedSessions();
    initNetworkOptimizer();
    initSessionSecurity();
    initSessionPersistenceHooks();
    initWindowManagerIpc();
    initViewManager();
    initDbIpc();
    initLicensingIpc();
    initAuthIpc();
    initDiagnosticsIpc(logFile);
    initDevCommandBridge(isDevMode);
    const guestLogger = createLogger("GUEST");
    require$$1.ipcMain.handle("pane.ping", () => "pong");
    require$$1.ipcMain.on("pane.log", (_event, level, ...args) => {
      const msg = args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
      if (level === "ERROR") {
        guestLogger.error(msg);
      } else if (level === "WARN") {
        guestLogger.warn(msg);
      } else {
        guestLogger.debug(msg);
      }
    });
    require$$1.ipcMain.handle(
      "metrics.memory",
      () => {
        return Promise.resolve(process.getProcessMemoryInfo());
      }
    );
    require$$1.ipcMain.on("window.openExternal", (_, url) => {
      require$$1.shell.openExternal(url);
    });
    createWindow();
    require$$1.app.on("activate", function() {
      if (require$$1.BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  require$$1.app.on("before-quit", async (e) => {
    try {
      await flushAllSessions();
    } catch {
    }
  });
  require$$1.app.on("will-quit", () => {
    try {
      destroyAllViews();
    } catch {
    }
    closeDb();
    defaultFileSink.close();
  });
  require$$1.app.on("window-all-closed", async () => {
    try {
      await flushAllSessions();
      destroyAllViews();
    } catch {
    }
    closeDb();
    defaultFileSink.close();
    require$$1.app.exit(0);
  });
}
