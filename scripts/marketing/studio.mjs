import { existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { rehydrateAuthCascade, saveSessionSnapshot } from "./sessionCascade.mjs";
import { synthesizeIsolatedDatabase } from "./dbSynthesizer.mjs";
import { cleanupSandbox, reapOrphanedSandboxes, registerProcessCleanup } from "./cleaner.mjs";

const REPO_ROOT = process.cwd();
const SCENARIOS_DIR = join(REPO_ROOT, ".marketing", "scenarios");

function printAvailableScenarios() {
  if (!existsSync(SCENARIOS_DIR)) {
    console.log("No scenarios found in .marketing/scenarios/");
    return;
  }
  const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json"));
  console.log("\n=== Available Marketing Scenarios ===");
  for (const f of files) {
    try {
      const raw = readFileSync(join(SCENARIOS_DIR, f), "utf8");
      const data = JSON.parse(raw);
      console.log(`- ${f.replace(".json", "")}: ${data.name || "Untitled"} (${data.description || "No description"})`);
    } catch {
      console.log(`- ${f.replace(".json", "")}`);
    }
  }
  console.log("");
}

const SCENARIO_ALIASES = {
  "1": "appsumo-01-command-center",
  "2": "appsumo-02-client-isolation",
  "3": "appsumo-03-omnibox-switcher",
  "4": "appsumo-04-dedicated-workspaces",
  "5": "appsumo-05-license-and-devices",
  "6": "ecommerce-split",
  "7": "nothing-tech-2x2",
  "8": "product-delivery",
  "9": "teenage-engineering-workspace",
  "appsumo:1": "appsumo-01-command-center",
  "appsumo:2": "appsumo-02-client-isolation",
  "appsumo:3": "appsumo-03-omnibox-switcher",
  "appsumo:4": "appsumo-04-dedicated-workspaces",
  "appsumo:5": "appsumo-05-license-and-devices",
  "appsumo-1": "appsumo-01-command-center",
  "appsumo-2": "appsumo-02-client-isolation",
  "appsumo-3": "appsumo-03-omnibox-switcher",
  "appsumo-4": "appsumo-04-dedicated-workspaces",
  "appsumo-5": "appsumo-05-license-and-devices",
};

function resolveScenarioName(name) {
  if (!name) return "teenage-engineering-workspace";
  return SCENARIO_ALIASES[name] || name;
}

function loadScenario(name) {
  const resolved = resolveScenarioName(name);
  const file = join(SCENARIOS_DIR, `${resolved}.json`);
  if (!existsSync(file)) {
    throw new Error(`Scenario not found: ${name} (looked for ${file})`);
  }
  return { scenario: JSON.parse(readFileSync(file, "utf8")), resolvedName: resolved };
}

async function main() {
  const args = process.argv.slice(2);
  const isList = args.includes("--list") || args.includes("-l");
  const isKeep = args.includes("--keep");
  const snapshotIdx = args.indexOf("--snapshot");

  if (isList) {
    printAvailableScenarios();
    return;
  }

  reapOrphanedSandboxes();

  if (snapshotIdx !== -1 && args[snapshotIdx + 1]) {
    const profileId = args[snapshotIdx + 1];
    const devDir = join(REPO_ROOT, ".marketing", ".sandbox");
    const target = saveSessionSnapshot(devDir, profileId, REPO_ROOT);
    console.log(`[Marketing Studio] Successfully snapshotted session for ${profileId} to ${target}`);
    return;
  }

  const rawScenarioName = args.find((a) => !a.startsWith("-")) || "teenage-engineering-workspace";
  const { scenario, resolvedName: scenarioName } = loadScenario(rawScenarioName);

  const sandboxDir = join(tmpdir(), `apposition-studio-${scenarioName}-${Date.now().toString(36)}`);
  mkdirSync(sandboxDir, { recursive: true });

  registerProcessCleanup(sandboxDir, isKeep);

  console.log(`\n[Marketing Studio] Spawning scenario: ${scenario.name || scenarioName}`);
  console.log(`[Marketing Studio] Isolated Sandbox: ${sandboxDir}`);

  // 1. JIT Auth Rehydration
  const rehydrated = rehydrateAuthCascade({
    sandboxDir,
    profiles: scenario.profiles || [],
    repoRoot: REPO_ROOT
  });
  if (rehydrated.length > 0) {
    const list = rehydrated.map((r) => `${r.id} (${r.source})`).join(", ");
    console.log(`[Marketing Studio] Rehydrated auth for: ${list}`);
  }

  // 2. Synthesize Isolated DB
  const stats = synthesizeIsolatedDatabase(sandboxDir, scenario);
  console.log(`[Marketing Studio] Injected ${stats.workspacesCount} workspaces, ${stats.tabsCount} tabs, ${stats.panesCount} panes`);

  // 3. Launch Native Electron Process
  const isDev = args.includes("--dev") || args.includes("-d");
  const isPreview = !isDev;
  const modeLabel = isPreview ? "Production Preview (Zero Hot Reload)" : "Dev Engine (Live Watcher)";
  console.log(`[Showcase] Launching native Electron (${modeLabel})...\n`);

  const spawnArgs = isPreview ? ["start"] : ["run", "dev"];
  const child = spawn("pnpm", spawnArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      APP_ISOLATED_DIR: sandboxDir,
      SHOWCASE_ACTION: scenario.action || "",
      SHOWCASE_QUERY: scenario.query || "",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LANGUAGE: "en_US:en",
      LC_MESSAGES: "en_US.UTF-8"
    }
  });

  child.on("exit", (code) => {
    if (!isKeep) {
      cleanupSandbox(sandboxDir);
      console.log(`[Showcase] Cleaned up temporary sandbox.`);
    } else {
      console.log(`[Showcase] Kept sandbox at: ${sandboxDir}`);
    }
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error(`[Marketing Studio Fatal Error]:`, err.message);
  process.exit(1);
});
