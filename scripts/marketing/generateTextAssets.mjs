import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { chromium } from "playwright";

const REPO_ROOT = process.cwd();
const OUTPUT_DIR = join(REPO_ROOT, "output", "video", "text-assets");
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const SCENES = [
  { id: "scene-intro", file: "text-00-problem-hook.png" },
  { id: "scene-split", file: "text-01-screen-splitting.png" },
  { id: "scene-isolation", file: "text-02-client-logins.png" },
  { id: "scene-omnibox", file: "text-03-omnibox-search.png" },
  { id: "scene-workspaces", file: "text-04-client-workspaces.png" },
  { id: "scene-license", file: "text-05-lifetime-devices.png" },
  { id: "scene-outro", file: "text-06-appsumo-outro.png" },
];

let spawnedServer = null;

async function launchBrowser() {
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      const opts = { headless: true, args: ["--enable-webgl", "--ignore-gpu-blocklist"] };
      if (channel) opts.channel = channel;
      return await chromium.launch(opts);
    } catch {}
  }
  throw new Error("Unable to launch browser.");
}

async function ensureServer() {
  for (const p of [4328, 4321, 4322]) {
    try {
      const res = await fetch(`http://localhost:${p}/studio-text-generator`);
      if (res.status === 200) return p;
    } catch {}
  }

  console.log("[Text Generator] Starting ephemeral Astro dev server...");
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
      const res = await fetch("http://localhost:4328/studio-text-generator");
      if (res.status === 200) return 4328;
    } catch {}
  }
  throw new Error("Astro dev server failed to start.");
}

async function main() {
  console.log("\n=== Apposition Cinema Text Asset Generator ===");
  console.log(`Destination Directory: ${OUTPUT_DIR}\n`);

  const port = await ensureServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  for (const s of SCENES) {
    const targetUrl = `http://localhost:${port}/studio-text-generator?scene=${s.id}`;
    console.log(`[Generating Text Asset] ${s.id} -> ${s.file}`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#text-generator-surface[data-ready='true']", { timeout: 15000 });
    await page.waitForTimeout(400);

    const outPath = join(OUTPUT_DIR, s.file);
    await page.screenshot({ path: outPath });
    console.log(` -> Saved: ${outPath}`);
  }

  await browser.close();
  if (spawnedServer) {
    try { spawnedServer.kill(); } catch {}
  }
  console.log("\n[SUCCESS] All Cinema Text Assets generated with silk caustic background!");
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  process.exit(1);
});
