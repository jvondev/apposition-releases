import { existsSync, mkdirSync, renameSync, readdirSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { chromium } from "playwright";

const REPO_ROOT = process.cwd();
const OUTPUT_DIR = join(REPO_ROOT, "output", "video");
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const SCENARIOS = [
  { id: "appsumo-01-command-center", label: "01: All Tools on One Screen" },
  { id: "appsumo-02-client-isolation", label: "02: Multi-Region & Account Isolation" },
  { id: "appsumo-03-omnibox-switcher", label: "03: 1-Second Keyboard Search (Cmd+K)" },
  { id: "appsumo-04-dedicated-workspaces", label: "04: Multiple Client Accounts" },
  { id: "appsumo-05-license-and-devices", label: "05: License & Multi-Device Seats" },
];

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

async function ensureStageServer() {
  for (const p of [4322, 4328, 4321]) {
    try {
      const res = await fetch(`http://localhost:${p}/studio-stage`);
      if (res.status === 200) return p;
    } catch {}
  }
  console.log("[Video Recorder] Starting ephemeral Astro server on port 4328...");
  spawnedServer = spawn("pnpm", ["--filter", "web", "dev", "--port", "4328"], {
    cwd: REPO_ROOT,
    shell: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch("http://localhost:4328/studio-stage");
      if (res.status === 200) return 4328;
    } catch {}
  }
  throw new Error("Ephemeral Astro dev server failed to start on port 4328.");
}

const HIDE_WIDGETS_CSS = `
  #featurebase-widget, #featurebase-sdk, [data-featurebase-bubble], #fb-widget, iframe[src*="featurebase"] {
    display: none !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
`;

async function main() {
  console.log("\n=== Apposition AppSumo Walkthrough Video Generator ===");
  console.log(`Destination Folder: ${OUTPUT_DIR}`);

  const port = await ensureStageServer();
  const browser = await launchBrowser();

  const tempVideoDir = join(OUTPUT_DIR, "temp_rec");
  if (!existsSync(tempVideoDir)) mkdirSync(tempVideoDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  for (const scenario of SCENARIOS) {
    console.log(`\n[Recording Scene] ${scenario.label}...`);
    try {
      await page.goto(`http://localhost:${port}/studio-stage?scenario=${scenario.id}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForSelector("#studio-stage", { timeout: 30000 });
      await page.addStyleTag({ content: HIDE_WIDGETS_CSS });
      await page.waitForTimeout(700);

      if (scenario.id.includes("01")) {
        await page.mouse.move(300, 300, { steps: 15 });
        await page.waitForTimeout(600);
        await page.mouse.move(700, 450, { steps: 20 });
        await page.waitForTimeout(600);
        await page.mouse.move(1400, 380, { steps: 20 });
        await page.waitForTimeout(1000);
      } else if (scenario.id.includes("02")) {
        await page.mouse.move(450, 150, { steps: 15 });
        await page.waitForTimeout(700);
        await page.mouse.move(1400, 150, { steps: 20 });
        await page.waitForTimeout(1200);
      } else if (scenario.id.includes("03")) {
        await page.evaluate(() => {
          window.dispatchEvent(new CustomEvent("app:open-command-palette"));
        });
        await page.waitForTimeout(400);
        const input = await page.$('input[placeholder*="Search"]');
        if (input) {
          await input.type("Acme Store", { delay: 100 });
        }
        await page.waitForTimeout(1400);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      } else if (scenario.id.includes("04")) {
        const dockItems = await page.$$("[data-workspace-id]");
        for (const item of dockItems.slice(0, 4)) {
          await item.hover();
          await page.waitForTimeout(500);
        }
        await page.waitForTimeout(800);
      } else if (scenario.id.includes("05")) {
        await page.waitForTimeout(1200);
        const copyBtn = await page.$('button:has-text("Copy")');
        if (copyBtn) {
          await copyBtn.hover();
          await page.waitForTimeout(600);
        }
        await page.waitForTimeout(1200);
      }
    } catch (err) {
      console.warn(`[Scene Notice] ${scenario.id}: ${err.message}`);
    }
  }

  await page.waitForTimeout(800);

  await context.close();
  await browser.close();

  if (spawnedServer) {
    try {
      spawnedServer.kill();
    } catch {}
  }

  const recordedFiles = readdirSync(tempVideoDir).filter((f) => f.endsWith(".webm"));
  if (recordedFiles.length > 0) {
    const finalVideoPath = join(OUTPUT_DIR, "appsumo-walkthrough-master-1080p.webm");
    // Sort by latest created
    const sorted = recordedFiles.sort();
    const latest = sorted[sorted.length - 1];
    renameSync(join(tempVideoDir, latest), finalVideoPath);
    console.log(`\n[Success] Finalized AppSumo Walkthrough Video:\n-> ${finalVideoPath}`);
  }
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  process.exit(1);
});
