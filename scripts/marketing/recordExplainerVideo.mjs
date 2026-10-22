import { existsSync, mkdirSync, renameSync, readdirSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { chromium } from "playwright";

const REPO_ROOT = process.cwd();
const OUTPUT_DIR = join(REPO_ROOT, "output", "video");
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

let spawnedServer = null;

async function launchBrowser() {
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      const opts = {
        headless: true,
        args: ["--enable-webgl", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
      };
      if (channel) opts.channel = channel;
      return await chromium.launch(opts);
    } catch {}
  }
  throw new Error("Unable to launch browser. Ensure Chrome, Edge, or Playwright is installed.");
}

async function ensureServer() {
  for (const p of [4328, 4321, 4322]) {
    try {
      const res = await fetch(`http://localhost:${p}/demo-explainer`);
      if (res.status === 200) return p;
    } catch {}
  }
  console.log("[Explainer Recorder] Starting ephemeral Astro server on port 4328...");
  spawnedServer = spawn("pnpm", ["--filter", "web", "dev", "--port", "4328"], {
    cwd: REPO_ROOT,
    shell: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch("http://localhost:4328/demo-explainer");
      if (res.status === 200) return 4328;
    } catch {}
  }
  throw new Error("Astro dev server failed to start.");
}

async function main() {
  console.log("\n=== Apposition SaaS Explainer Story Video Generator ===");
  console.log(`Destination Folder: ${OUTPUT_DIR}`);

  const port = await ensureServer();
  const browser = await launchBrowser();

  const tempVideoDir = join(OUTPUT_DIR, "temp_explainer");
  if (!existsSync(tempVideoDir)) mkdirSync(tempVideoDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  console.log("[Recording] Navigating to SaaS Explainer Demo Stage...");
  await page.goto(`http://localhost:${port}/demo-explainer`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#explainer-stage", { timeout: 30000 });

  // Record across all 3 flagship story chapters (Splitting, Multiple Accounts, Crash Recovery)
  console.log("[Recording] Chapter 1: Side-by-Side Screen Splitting...");
  await page.waitForTimeout(14000);

  console.log("[Recording] Chapter 2: Stay Logged into Multiple Accounts...");
  await page.waitForTimeout(14000);

  console.log("[Recording] Chapter 3: Instant Recovery & Zero Data Loss...");
  await page.waitForTimeout(14000);

  // Final hold
  await page.waitForTimeout(2000);

  await context.close();
  await browser.close();

  if (spawnedServer) {
    try {
      spawnedServer.kill();
    } catch {}
  }

  const recordedFiles = readdirSync(tempVideoDir).filter((f) => f.endsWith(".webm"));
  if (recordedFiles.length > 0) {
    const finalVideoPath = join(OUTPUT_DIR, "appsumo-saas-explainer-1080p.webm");
    const sorted = recordedFiles.sort();
    const latest = sorted[sorted.length - 1];
    renameSync(join(tempVideoDir, latest), finalVideoPath);
    console.log(`\n[Success] Finalized SaaS Explainer Video:\n-> ${finalVideoPath}`);
  }
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  process.exit(1);
});
