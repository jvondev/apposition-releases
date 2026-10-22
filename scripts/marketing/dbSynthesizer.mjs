import Database from "better-sqlite3";
import crypto from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import { buildLayoutTree } from "./layoutBuilder.mjs";
import { DEFAULT_WINDOW_CONFIG } from "./types.mjs";

const SCHEMA_SQL = `
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
    icon TEXT DEFAULT NULL,
    default_profile_id TEXT DEFAULT NULL,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS tabs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    name TEXT NOT NULL,
    custom_name TEXT DEFAULT NULL,
    order_idx INTEGER,
    layout_state TEXT,
    default_profile_id TEXT DEFAULT NULL,
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
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS licensing (
    key TEXT PRIMARY KEY,
    value TEXT
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
  CREATE TABLE IF NOT EXISTS discovered_apps (
    domain TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    icon_url TEXT,
    theme_color TEXT,
    discovered_at INTEGER NOT NULL
  );
`;

function getMachineKey(sandboxDir) {
  const keyPath = join(sandboxDir, "apposition_machine.key");
  if (existsSync(keyPath)) {
    try {
      const hex = readFileSync(keyPath, "utf8").trim();
      if (hex.length === 64) return Buffer.from(hex, "hex");
    } catch {}
  }
  const key = crypto.randomBytes(32);
  try { writeFileSync(keyPath, key.toString("hex"), "utf8"); } catch {}
  return key;
}

function fallbackEncrypt(text, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `$ENC:v1:fb:${iv.toString("hex")}:${encrypted}:${authTag}`;
}

export function synthesizeIsolatedDatabase(sandboxDir, scenario) {
  if (!existsSync(sandboxDir)) mkdirSync(sandboxDir, { recursive: true });
  const dbPath = join(sandboxDir, "apposition_state_dev.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA_SQL);

  // 1. Synthesize Profiles
  const profileList = scenario.profiles?.length > 0
    ? [...scenario.profiles]
    : [{ id: "main", name: "Main", color: "#3b82f6" }];
  if (!profileList.some((p) => p.id === "main")) {
    profileList.unshift({ id: "main", name: "Main", color: "#3b82f6" });
  }

  const insertProfile = db.prepare(`
    INSERT OR REPLACE INTO profiles (id, name, color, is_ephemeral, identities_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const p of profileList) {
    const identitiesJson = p.identities ? JSON.stringify(p.identities) : null;
    insertProfile.run(p.id, p.name, p.color || "#525252", 0, identitiesJson);
  }

  // 2. Synthesize Workspaces, Tabs & Panes
  let tabsCount = 0;
  let panesCount = 0;
  const workspaces = scenario.workspaces || [];

  const insertWorkspace = db.prepare(`
    INSERT OR REPLACE INTO workspaces (id, name, icon, default_profile_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertTab = db.prepare(`
    INSERT OR REPLACE INTO tabs (id, workspace_id, name, custom_name, order_idx, layout_state, default_profile_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNode = db.prepare(`
    INSERT OR REPLACE INTO nodes (id, tab_id, type, profile_id, url, x, y, width, height, is_hibernating, is_ghost)
    VALUES (?, ?, 'web', ?, ?, 0, 0, 800, 600, 0, 0)
  `);

  for (const ws of workspaces) {
    insertWorkspace.run(ws.id, ws.name, ws.icon || null, ws.defaultProfileId || null, Date.now());
    let orderIdx = 0;
    for (const tab of ws.tabs || []) {
      orderIdx += 1;
      tabsCount += 1;
      const defProf = tab.defaultProfileId || ws.defaultProfileId || "main";
      const layoutTree = buildLayoutTree(tab.layout, defProf);
      insertTab.run(tab.id, ws.id, tab.name, tab.customName || null, orderIdx, JSON.stringify(layoutTree), defProf);

      for (const n of Object.values(layoutTree.nodes)) {
        if (n?.type === "pane") {
          panesCount += 1;
          insertNode.run(n.id, tab.id, n.profileId || defProf, n.url || "about:blank");
        }
      }
    }
  }

  // 3. Synthesize Window State & App Meta
  const win = { ...DEFAULT_WINDOW_CONFIG, ...(scenario.window || {}) };
  db.prepare(`
    INSERT OR REPLACE INTO window_state (id, x, y, width, height, is_maximized, is_fullscreen, updated_at)
    VALUES ('main', 50, 50, ?, ?, ?, 0, ?)
  `).run(win.width, win.height, win.maximized ? 1 : 0, Date.now());
  db.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('ui_mode', 'inset')`).run();

  // 4. Synthesize Licensing (AES-256 fallback encryption)
  if (scenario.licensing) {
    const key = getMachineKey(sandboxDir);
    const insLic = db.prepare(`INSERT OR REPLACE INTO licensing (key, value) VALUES (?, ?)`);
    if (scenario.licensing.key) {
      insLic.run("license_key", fallbackEncrypt(scenario.licensing.key, key));
    }
    if (scenario.licensing.state) {
      const state = { ...scenario.licensing.state, lastChecked: Date.now(), activated: true };
      insLic.run("license_state", fallbackEncrypt(JSON.stringify(state), key));
    }
    if (scenario.licensing.hardwareLease) {
      insLic.run("hardware_lease", fallbackEncrypt(JSON.stringify(scenario.licensing.hardwareLease), key));
    }
    insLic.run("last_validated", Date.now().toString());
  }

  // 5. Synthesize Presets & Discovered Apps
  if (Array.isArray(scenario.presets)) {
    const insPreset = db.prepare(`
      INSERT OR REPLACE INTO user_presets (id, name, workspace_id, layout_state, preview_apps, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const pr of scenario.presets) {
      insPreset.run(
        pr.id, pr.name, pr.workspaceId || null,
        typeof pr.layoutState === "string" ? pr.layoutState : JSON.stringify(pr.layoutState || {}),
        JSON.stringify(pr.previewApps || []), Date.now(), Date.now()
      );
    }
  }
  if (Array.isArray(scenario.discoveredApps)) {
    const insApp = db.prepare(`
      INSERT OR REPLACE INTO discovered_apps (domain, name, url, icon_url, theme_color, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const a of scenario.discoveredApps) {
      insApp.run(a.domain, a.name, a.url, a.iconUrl || null, a.themeColor || null, Date.now());
    }
  }

  db.close();
  try {
    copyFileSync(dbPath, join(sandboxDir, "apposition_state_showcase.db"));
  } catch {}
  return { profilesCount: profileList.length, workspacesCount: workspaces.length, tabsCount, panesCount, dbPath };
}
