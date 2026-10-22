import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { chromium } from "playwright";
import sharp from "sharp";

const REPO_ROOT = process.cwd();
const OUTPUT_DIR = join(REPO_ROOT, ".marketing", "showcase-cards");
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const SLIDES = [
  { id: "appsumo-00-hero-showcase", label: "00: Main Photo - Live Split-Screen Browsing (Competitor Intel)" },
  { id: "appsumo-01-command-center", label: "01: All Tools on One Screen (Command Center)" },
  { id: "appsumo-02-client-isolation", label: "02: Multi-Region Browsing (Country-Specific IP Views)" },
  { id: "appsumo-03-omnibox-switcher", label: "03: 1-Second Keyboard Search (Cmd+K)" },
  { id: "appsumo-04-dedicated-workspaces", label: "04: Multiple Client Accounts & Workspaces" },
  { id: "appsumo-05-license-and-devices", label: "05: Multi-Device Ownership (Desktop + Laptop)" },
];

let spawnedServer = null;

async function launchBrowser() {
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      const opts = {
        headless: true,
        args: ["--enable-webgl", "--ignore-gpu-blocklist"],
      };
      if (channel) opts.channel = channel;
      return await chromium.launch(opts);
    } catch {}
  }
  throw new Error("Unable to launch browser. Ensure Chrome, Edge, or Playwright is installed.");
}

async function ensureShowcaseServer() {
  for (const p of [4322, 4328, 4321]) {
    try {
      const res = await fetch(`http://localhost:${p}/studio-showcase`);
      if (res.status === 200) return p;
    } catch {}
  }

  console.log("[Showcase Capture] Starting ephemeral Astro server on port 4328...");
  spawnedServer = spawn("pnpm", ["--filter", "web", "dev", "--port", "4328"], {
    cwd: REPO_ROOT,
    shell: true,
    stdio: "ignore",
  });

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch("http://localhost:4328/studio-showcase");
      if (res.status === 200) return 4328;
    } catch {}
  }
  throw new Error("Ephemeral Astro dev server failed to start on port 4328.");
}

async function captureSlide(browser, port, slideId) {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });

  page.on("pageerror", (err) => console.error(`[Page Error]:`, err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`[Browser Console Error]:`, msg.text());
  });

  const targetUrl = `http://localhost:${port}/studio-showcase?scenario=${slideId}&export=true`;
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("#showcase-surface", { timeout: 60000 });
  await page.waitForSelector("#showcase-surface[data-ready='true']", { timeout: 30000 });
  await page.waitForSelector("#showcase-card", { timeout: 30000 });

  // Wait for all images in card to load
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

  // Brief pause for SVG gradient/mesh filters and font rasterization
  await page.waitForTimeout(500);

  const cardElement = await page.$("#showcase-card");
  const pngPath = join(OUTPUT_DIR, `${slideId}.png`);
  const webpPath = join(OUTPUT_DIR, `${slideId}.webp`);

  if (cardElement) {
    await cardElement.screenshot({ path: pngPath, type: "png" });
  } else {
    await page.screenshot({ path: pngPath, type: "png" });
  }

  // Convert to high-fidelity WebP
  await sharp(pngPath).webp({ quality: 90, effort: 4 }).toFile(webpPath);
  console.log(`[Card Rendered] ${slideId}.png + .webp`);

  await page.close();
}

async function main() {
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => !a.startsWith("-"));
  const toRun = targetArg
    ? SLIDES.filter((s) => s.id === targetArg || s.id.includes(targetArg))
    : SLIDES;

  console.log(`\n=== Apposition AppSumo Showcase Card Generator ===`);
  console.log(`Destination Folder: ${OUTPUT_DIR}\n`);

  const port = await ensureShowcaseServer();
  const browser = await launchBrowser();

  try {
    for (const slide of toRun) {
      console.log(`Generating card: ${slide.label}...`);
      await captureSlide(browser, port, slide.id);
    }
  } finally {
    await browser.close();
    if (spawnedServer) {
      spawnedServer.kill();
      console.log("[Showcase Capture] Cleaned up dev server.");
    }
  }

  console.log(`\nAll AppSumo showcase cards successfully created in:`);
  console.log(`-> ${OUTPUT_DIR}\n`);
}

main().catch((err) => {
  if (spawnedServer) spawnedServer.kill();
  console.error("Showcase Capture Fatal Error:", err);
  process.exit(1);
});
