import { existsSync, rmSync, readdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export function cleanupSandbox(sandboxDir) {
  if (!sandboxDir || !existsSync(sandboxDir)) return;
  try {
    rmSync(sandboxDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (err) {
    console.warn(`[Marketing Studio] Non-fatal cleanup warning for ${sandboxDir}:`, err.message);
  }
}

export function reapOrphanedSandboxes(maxAgeMs = 2 * 60 * 60 * 1000) {
  const baseTmp = tmpdir();
  const now = Date.now();
  try {
    const entries = readdirSync(baseTmp);
    for (const name of entries) {
      if (name.startsWith("apposition-studio-")) {
        const fullPath = join(baseTmp, name);
        try {
          const stats = statSync(fullPath);
          if (stats.isDirectory() && now - stats.mtimeMs > maxAgeMs) {
            rmSync(fullPath, { recursive: true, force: true });
          }
        } catch {}
      }
    }
  } catch {}
}

export function registerProcessCleanup(sandboxDir, keepOnExit = false) {
  if (keepOnExit) return;

  const performClean = () => {
    cleanupSandbox(sandboxDir);
  };

  process.once("SIGINT", () => {
    performClean();
    process.exit(130);
  });

  process.once("SIGTERM", () => {
    performClean();
    process.exit(143);
  });

  process.once("exit", () => {
    performClean();
  });
}
