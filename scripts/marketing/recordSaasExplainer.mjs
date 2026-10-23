import { existsSync, mkdirSync, renameSync, readdirSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { chromium } from "playwright";

const REPO_ROOT = process.cwd();
const OUTPUT_DIR = join(REPO_ROOT, "output", "video");
const FRAMES_DIR = join(OUTPUT_DIR, "frames");
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
if (!existsSync(FRAMES_DIR)) mkdirSync(FRAMES_DIR, { recursive: true });

let spawnedServer = null;

async function launchBrowser() {
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      const opts = {
        headless: true,
        args: [
          "--enable-webgl",
          "--ignore-gpu-blocklist",
          "--autoplay-policy=no-user-gesture-required",
        ],
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
      const res = await fetch(`http://localhost:${p}/saas-explainer`);
      if (res.status === 200) return p;
    } catch {}
  }
  console.log("[Explainer Recorder] Starting ephemeral Astro server on port 4328...");
  const webAstroBin = join(REPO_ROOT, "web", "node_modules", "astro", "bin", "astro.mjs");
  const rootAstroBin = join(REPO_ROOT, "node_modules", "astro", "bin", "astro.mjs");
  const astroBin = existsSync(webAstroBin) ? webAstroBin : rootAstroBin;

  if (existsSync(astroBin)) {
    spawnedServer = spawn(process.execPath, [astroBin, "dev", "--port", "4328"], {
      cwd: join(REPO_ROOT, "web"),
      shell: true,
      stdio: "ignore",
    });
  } else {
    spawnedServer = spawn("pnpm", ["--filter", "web", "dev", "--port", "4328"], {
      cwd: REPO_ROOT,
      shell: true,
      stdio: "ignore",
    });
  }
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch("http://localhost:4328/saas-explainer");
      if (res.status === 200) return 4328;
    } catch {}
  }
  throw new Error("Astro dev server failed to start.");
}

async function main() {
  console.log("\n=== Apposition Cinema SaaS Explainer Video Generator ===");
  console.log(`Destination Folder: ${OUTPUT_DIR}`);

  const port = await ensureServer();
  const browser = await launchBrowser();

  const tempVideoDir = join(OUTPUT_DIR, "temp_explainer_render");
  if (!existsSync(tempVideoDir)) mkdirSync(tempVideoDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  console.log("[Recording] Navigating to SaaS Explainer Cinema Stage...");
  await page.goto(`http://localhost:${port}/saas-explainer`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#saas-explainer-surface[data-ready='true']", { timeout: 30000 });

  console.log("[Recording] Scene 0: Bold Problem Hook & 3D Intro...");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-0-hook.png") });
  await page.waitForTimeout(3000);

  console.log("[Recording] Scene 1: 3D Tilt & Jump-Zoom Split Screen...");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-1-tilt.png") });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-1-zoom.png") });
  await page.waitForTimeout(3800);

  console.log("[Recording] Scene 2: 3D Tilt & Jump-Zoom Client Logins...");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-2-tilt.png") });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-2-zoom.png") });
  await page.waitForTimeout(3800);

  console.log("[Recording] Scene 3: 3D Tilt & Jump-Zoom 1-Second Search...");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-3-tilt.png") });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-3-zoom.png") });
  await page.waitForTimeout(3800);

  console.log("[Recording] Scene 4: 3D Tilt & Jump-Zoom Client Workspaces...");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-4-tilt.png") });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-4-zoom.png") });
  await page.waitForTimeout(3800);

  console.log("[Recording] Scene 5: 3D Tilt & Jump-Zoom AppSumo License...");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-5-tilt.png") });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-5-zoom.png") });
  await page.waitForTimeout(3300);

  console.log("[Recording] Scene 6: Dramatic Outro Crescendo...");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(FRAMES_DIR, "frame-scene-6-outro.png") });
  await page.waitForTimeout(4000);

  console.log("[Recording] Finalizing video streams...");
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
    console.log(`\n[SUCCESS] Finalized 1080p Cinema SaaS Explainer Video:\n-> ${finalVideoPath}`);
    console.log(`[SUCCESS] Verification frames captured in:\n-> ${FRAMES_DIR}`);
  }
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  process.exit(1);
});
