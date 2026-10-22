#!/usr/bin/env node

/**
 * rebuild-native.js
 *
 * Diagnoses and fixes Electron native module ABI mismatches.
 *
 * 10x enterprise approach:
 *   - Works on Windows, macOS, Linux
 *   - No hardcoded ABI versions — verifies by actually loading the module
 *   - Cleans stale electron-rebuild cache that causes silent failures
 *   - Falls back gracefully
 *   - Safe to run in CI and as an npm postinstall hook
 *
 * Usage:
 *   node scripts/rebuild-native.js                          # Rebuild better-sqlite3 (default)
 *   node scripts/rebuild-native.js better-sqlite3           # Rebuild specific module
 *   node scripts/rebuild-native.js --check                  # Diagnose only, don't fix
 *   node scripts/rebuild-native.js --check --ci             # CI mode: exit 1 if broken
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MODULE = "better-sqlite3";
const CI = process.argv.includes("--ci");
const CHECK_ONLY = process.argv.includes("--check");
const TARGET_MODULE =
  process.argv.slice(2).find((arg) => !arg.startsWith("-")) || DEFAULT_MODULE;

// electron-rebuild binary location (cross-platform)
const BIN_DIR = path.join(__dirname, "..", "node_modules", ".bin");
const ELECTRON_REBUILD = fs.existsSync(
  path.join(BIN_DIR, "electron-rebuild.cmd"),
)
  ? path.join(BIN_DIR, "electron-rebuild.cmd") // Windows
  : path.join(BIN_DIR, "electron-rebuild"); // Unix/macOS

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(...args) {
  console.log(`[rebuild-native] ${args.join(" ")}`);
}

function logError(...args) {
  console.error(`[rebuild-native] ${args.join(" ")}`);
}

function isElectronABIMismatch(error) {
  if (!error) return false;
  const msg = error.message || String(error);
  return (
    msg.includes("NODE_MODULE_VERSION") ||
    msg.includes("was compiled against a different")
  );
}

function tryLoadModule(moduleName) {
  // Clear require cache so we get a fresh load
  delete require.cache[require.resolve(moduleName)];
  return require(moduleName);
}

function cleanStaleCache(moduleName) {
  const modulePath = require.resolve(moduleName);
  const moduleDir = path.dirname(modulePath);

  // electron-rebuild caches results in .forge-meta. If this is stale,
  // it will silently skip the rebuild even when the binary is wrong.
  const forgeMeta = path.join(moduleDir, "build", "Release", ".forge-meta");
  if (fs.existsSync(forgeMeta)) {
    log(`Removing stale cache: ${forgeMeta}`);
    fs.unlinkSync(forgeMeta);
  }
}

function runCommand(command, args, options = {}) {
  log(`Running: ${command} ${args.join(" ")}`);
  return execSync(command, { ...options, encoding: "utf8", stdio: "pipe" });
}

function commandExists(cmd) {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Platform-specific prereq checks
// ---------------------------------------------------------------------------

function checkBuildTools() {
  const platform = os.platform();
  const missing = [];

  if (platform === "win32") {
    if (!commandExists("cl") && !commandExists("npm")) {
      missing.push(
        "Visual Studio Build Tools (or run: npm i -g windows-build-tools)",
      );
    }
  } else if (platform === "darwin") {
    if (!commandExists("xcodebuild") && !commandExists("clang")) {
      missing.push("Xcode Command Line Tools (run: xcode-select --install)");
    }
  } else if (platform === "linux") {
    if (!commandExists("make") || !commandExists("g++")) {
      missing.push("build-essential (run: sudo apt install build-essential)");
    }
    if (!commandExists("python3")) {
      missing.push("python3 (run: sudo apt install python3)");
    }
  }

  return missing;
}

// ---------------------------------------------------------------------------
// Rebuild strategies
// ---------------------------------------------------------------------------

function rebuildWithElectronRebuild(moduleName) {
  if (!fs.existsSync(ELECTRON_REBUILD)) {
    throw new Error(
      "electron-rebuild not found. Install it with: npm install --save-dev @electron/rebuild",
    );
  }

  cleanStaleCache(moduleName);

  const args = ["-f", "-w", moduleName, "--module-dir", "."];
  try {
    runCommand(ELECTRON_REBUILD, args);
    return true;
  } catch (e) {
    logError("electron-rebuild failed:", e.stderr || e.message);
    return false;
  }
}

function rebuildWithNpm(moduleName) {
  log("Falling back to npm rebuild...");
  try {
    runCommand("npm", ["rebuild", moduleName, "--build-from-source"]);
    return true;
  } catch (e) {
    logError("npm rebuild failed:", e.stderr || e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  log(`Target module: ${TARGET_MODULE}`);
  log(`Platform: ${os.platform()} ${os.arch()}`);

  // -----------------------------------------------------------------------
  // Step 1: Check if module loads
  // -----------------------------------------------------------------------
  log(`Checking if ${TARGET_MODULE} loads correctly...`);
  let moduleError = null;

  try {
    const mod = tryLoadModule(TARGET_MODULE);
    log(`${TARGET_MODULE} loaded successfully.`);
    if (!CHECK_ONLY) {
      log("Nothing to do — native module is healthy.");
      process.exit(0);
    }
    process.exit(0);
  } catch (e) {
    moduleError = e;
    if (!isElectronABIMismatch(e)) {
      logError(`${TARGET_MODULE} failed to load, but NOT due to ABI mismatch:`);
      logError(`  ${e.message}`);
      if (CHECK_ONLY || CI) {
        process.exit(1);
      }
      log("This is a different problem — not attempting rebuild.");
      process.exit(1);
    }
    log(`ABI mismatch detected: ${e.message}`);
  }

  // -----------------------------------------------------------------------
  // Step 2: In CI or check-only mode, report and exit
  // -----------------------------------------------------------------------
  if (CHECK_ONLY) {
    log("CHECK MODE: Module has ABI mismatch. Run without --check to fix.");
    process.exit(CI ? 1 : 0);
  }

  // -----------------------------------------------------------------------
  // Step 3: Check for build tools
  // -----------------------------------------------------------------------
  const missingTools = checkBuildTools();
  if (missingTools.length > 0) {
    logError("Missing build tools required for native compilation:");
    missingTools.forEach((tool) => logError(`  - ${tool}`));
    logError("Install them and re-run this script.");
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Step 4: Try electron-rebuild, then fallback to npm rebuild
  // -----------------------------------------------------------------------
  let rebuildSuccess = false;

  log(`Rebuilding ${TARGET_MODULE} for current Electron version...`);
  rebuildSuccess = rebuildWithElectronRebuild(TARGET_MODULE);

  if (!rebuildSuccess) {
    log("electron-rebuild failed, trying npm rebuild fallback...");
    rebuildSuccess = rebuildWithNpm(TARGET_MODULE);
  }

  if (!rebuildSuccess) {
    logError("All rebuild strategies failed.");
    logError("Manual fix:");
    logError(`  1. npm uninstall ${TARGET_MODULE}`);
    logError(`  2. npm install --save ${TARGET_MODULE}`);
    logError(`  3. npm run rebuild`);
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Step 5: Verify the rebuild actually worked
  // -----------------------------------------------------------------------
  log("Verifying rebuild...");
  try {
    delete require.cache[require.resolve(TARGET_MODULE)];
    tryLoadModule(TARGET_MODULE);
    log(`✓ ${TARGET_MODULE} rebuilt and verified successfully.`);
    process.exit(0);
  } catch (e) {
    logError(`Rebuild ran but module still fails to load:`);
    logError(`  ${e.message}`);
    logError("This usually means:");
    logError("  1. Build tools are missing or broken");
    logError(
      "  2. The module version is incompatible with your Electron version",
    );
    logError(
      `  3. Try: npm uninstall ${TARGET_MODULE} && npm install ${TARGET_MODULE}`,
    );
    process.exit(1);
  }
}

main();
