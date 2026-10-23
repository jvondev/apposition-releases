import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { chromium } from "playwright";
import { encodeFramesToGif, captureAnimationFrames } from "./gifEngine.mjs";
import { getScenarioGifSteps } from "./gifSteps.mjs";

const REPO_ROOT = process.cwd();
const ASSETS_DIR = join(REPO_ROOT, ".marketing", "assets");
if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR, { recursive: true });

const SCENARIOS = [
  { id: "appsumo-01-command-center", label: "01: Sales Pipeline Command Center" },
  { id: "appsumo-02-client-isolation", label: "02: Multi-Region IP & Network Isolation" },
  { id: "appsumo-03-omnibox-switcher", label: "03: Omnibox 1-Second Switcher" },
  { id: "appsumo-04-dedicated-workspaces", label: "04: Multiple Client Accounts" },
  { id: "appsumo-05-license-and-devices", label: "05: License & Multi-Device Seats" },
];

let spawnedServer = null;

async function launchBrowser() {
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      const opts = { headless: true };
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
  console.log("[Auto-Capture] Starting ephemeral Astro server on port 4328...");
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

async function captureScenarioStatic(browser, port, scenarioId) {
  const page = await browser.newPage({
    viewport: { width: 1536, height: 864 },
    deviceScaleFactor: 1.25,
  });
  page.on("pageerror", (err) => console.error(`[Browser PageError]:`, err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`[Browser Console Error]:`, msg.text());
  });
  await page.goto(`http://localhost:${port}/studio-stage?scenario=${scenarioId}`);
  await page.waitForSelector("#studio-stage", { timeout: 120000 });
  await page.waitForSelector("#studio-stage[data-ready='true']", { timeout: 30000 });
  await page.addStyleTag({ content: HIDE_WIDGETS_CSS });

  // Wait for all images to complete loading (with 5s safety cap)
  await page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll("img"));
    await Promise.race([
      Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener("load", resolve);
            img.addEventListener("error", resolve);
          });
        })
      ),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  });
  await page.waitForTimeout(400);

  const pngPath = join(ASSETS_DIR, `${scenarioId}.png`);
  await page.screenshot({ path: pngPath, type: "png" });
  console.log(`[PNG Saved] ${scenarioId}.png`);
  const webPath = join(REPO_ROOT, "web", "public", "marketing-assets", `${scenarioId}.png`);
  if (existsSync(join(REPO_ROOT, "web", "public", "marketing-assets"))) {
    copyFileSync(pngPath, webPath);
    console.log(`[Synced to web/public] ${scenarioId}.png`);
  }
  await page.close();
}

async function captureScenarioGif(browser, port, scenarioId) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (err) => console.error(`[Browser PageError]:`, err.message));
  await page.goto(`http://localhost:${port}/studio-stage?scenario=${scenarioId}&gif=true`);
  await page.waitForSelector("#studio-stage", { timeout: 120000 });
  await page.waitForSelector("#studio-stage[data-ready='true']", { timeout: 30000 });
  await page.addStyleTag({ content: HIDE_WIDGETS_CSS });

  let frames = [];
  try {
    await page.waitForFunction(() => !!window.__STUDIO_MOTION__?.isReady(), { timeout: 8000 });
    const stepCount = await page.evaluate(() => window.__STUDIO_MOTION__.getStepCount());
    console.log(`[Studio Replay] Running ${stepCount} in-DOM motion steps for ${scenarioId}...`);

    for (let i = 0; i < stepCount; i++) {
      const delayMs = await page.evaluate(async (idx) => {
        return await window.__STUDIO_MOTION__.setStep(idx);
      }, i);
      await page.waitForTimeout(Math.min(delayMs, 600));
      const pngBuffer = await page.screenshot({ type: "png" });
      const delayCentisecs = Math.max(5, Math.round(delayMs / 10));
      frames.push({ pngBuffer, delayCentisecs });
    }
  } catch (err) {
    console.warn(`[Studio Replay Fallback]:`, err.message);
    const steps = getScenarioGifSteps(scenarioId, page);
    frames = await captureAnimationFrames(page, steps);
  }

  const gifBuffer = await encodeFramesToGif(frames, 256);
  const gifPath = join(ASSETS_DIR, `${scenarioId}.gif`);
  writeFileSync(gifPath, gifBuffer);
  console.log(`[GIF Saved] ${scenarioId}.gif (${Math.round(gifBuffer.length / 1024)} KB)`);
  await page.close();
}

async function main() {
  const args = process.argv.slice(2);
  const isAll = args.includes("--all");
  const isGifs = args.includes("--gifs") || args.includes("--gif");
  const argTarget = args.find((a) => !a.startsWith("-"));
  const matched = argTarget ? SCENARIOS.find((s) => s.id === argTarget || s.id.includes(argTarget)) : null;
  const targetId = matched ? matched.id : (argTarget || "appsumo-01-command-center");

  const port = await ensureStageServer();
  console.log(`\n=== Apposition Marketing Capture Studio ===`);
  console.log(`Studio Stage: http://localhost:${port}/studio-stage`);
  console.log(`Output: ${ASSETS_DIR}\n`);

  const browser = await launchBrowser();
  const toRun = isAll ? SCENARIOS : [SCENARIOS.find((s) => s.id === targetId) || { id: targetId, label: targetId }];

  try {
    for (const s of toRun) {
      console.log(`Processing: ${s.label || s.id}...`);
      await captureScenarioStatic(browser, port, s.id);
      if (isGifs) await captureScenarioGif(browser, port, s.id);
    }
  } finally {
    await browser.close();
    if (spawnedServer) {
      spawnedServer.kill();
      console.log("[Auto-Capture] Cleaned up ephemeral dev server.");
    }
  }

  console.log(`\nAssets generated in .marketing/assets/\n`);
}

main().catch((err) => {
  if (spawnedServer) spawnedServer.kill();
  console.error("Auto-Capture Fatal Error:", err);
  process.exit(1);
});
