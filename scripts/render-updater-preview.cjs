const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function renderPreview() {
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Apposition Updater Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background-color: #f4f4f2;
      margin: 0;
      padding: 0;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }
    .doppelrand-elevated {
      box-shadow: 0 16px 36px -8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9);
    }
    .doppelrand-button {
      box-shadow: inset 0 1px 1px rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.08);
    }
    .doppelrand-cluster-btn {
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(0,0,0,0.05);
    }
  </style>
</head>
<body class="relative p-8">

  <!-- Watermark & Context Header -->
  <div class="flex items-center justify-between border-b border-neutral-300/80 pb-4">
    <div class="flex items-center gap-3">
      <div class="w-8 h-8 rounded-xl bg-neutral-900 text-white flex items-center justify-center shadow-xs">
        <svg width="18" height="18" viewBox="0 0 100 100" fill="currentColor">
          <path d="M 26 18 H 50.7 A 1.8 1.8 0 0 1 52.43 20.28 L 35.88 79.95 A 2.8 2.8 0 0 1 33.19 82 H 26 A 8 8 0 0 1 18 74 V 26 A 8 8 0 0 1 26 18 Z" />
          <path d="M 74 82 H 49.3 A 1.8 1.8 0 0 1 47.57 79.72 L 64.12 20.05 A 2.8 2.8 0 0 1 66.81 18 H 74 A 8 8 0 0 1 82 26 V 74 A 8 8 0 0 1 74 82 Z" />
        </svg>
      </div>
      <div>
        <h1 class="text-sm font-semibold text-neutral-900 tracking-tight">Apposition Continuity Updater (ARCU) Visual Verification</h1>
        <p class="text-xs text-neutral-500">Precision Grayscale & Semantic Functional Accents (Doppelrand Double Bezel)</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span class="text-[11px] font-mono font-medium text-neutral-600 bg-white border border-neutral-200/90 px-2.5 py-1 rounded-full shadow-2xs">
        State: v1.3.2 &rarr; v1.3.3 (Verified)
      </span>
    </div>
  </div>

  <!-- Center Stage: Changelog Popover Simulation with Refined Banner -->
  <div class="flex-1 flex items-center justify-center py-6">
    <div class="w-[580px] bg-white border border-neutral-200/90 rounded-[20px] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.18)] flex flex-col overflow-hidden">
      
      <!-- Popover Header -->
      <div class="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 bg-white">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-neutral-900 tracking-tight">Release Notes</h2>
          <span class="text-[11px] font-mono text-neutral-600 bg-neutral-100 border border-neutral-200/90 px-2 py-0.5 rounded-full font-medium">
            v1.3.2
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button class="px-3 py-1 bg-neutral-900 text-white font-semibold text-xs rounded-lg shadow-xs">
            Restart to Apply
          </button>
        </div>
      </div>

      <!-- Release Note Card Preview -->
      <div class="p-5 bg-[#fafaf9] space-y-3">
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono font-medium bg-neutral-200/80 px-2 py-0.5 rounded-md text-neutral-700">v1.3.2</span>
          <span class="text-[11px] text-emerald-700 font-medium bg-emerald-100/80 px-2 py-0.5 rounded-full">Current</span>
          <span class="text-[11px] text-neutral-400">2026-09-15</span>
        </div>
        <h3 class="text-sm font-bold text-neutral-900">Apposition v1.3.2</h3>
        <p class="text-xs text-neutral-600 leading-relaxed">
          Compact Rotary Menus, Adaptive Tool Memory, and cross-split continuity synchronization.
        </p>
      </div>
    </div>
  </div>

  <!-- Bottom Bar: Ambient Chrome SupportCluster (Left) & Doppelrand Capsule (Right) -->
  <div class="relative w-full flex items-end justify-between pt-4">
    
    <!-- SupportCluster Ambient Beacon (Bottom-Left) -->
    <div class="flex items-center gap-3">
      <div class="relative">
        <div class="flex items-center justify-center w-[40px] h-[40px] rounded-2xl bg-white border border-neutral-200/60 doppelrand-cluster-btn text-neutral-700">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path>
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>
          </svg>
        </div>
        <!-- Pulsing Emerald Ambient Beacon -->
        <div class="absolute -top-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white animate-pulse"></div>
      </div>
      <div class="text-xs text-neutral-500 font-medium">
        SupportCluster Ambient Beacon: <span class="text-neutral-800 font-semibold font-mono">v1.3.3 Ready</span>
      </div>
    </div>

    <!-- The New Branded Doppelrand Update Capsule (Bottom-Right) -->
    <div class="flex items-center gap-3.5 bg-white border border-neutral-200/90 px-4 py-3 rounded-2xl doppelrand-elevated max-w-md">
      <!-- Apposition Parallax Monolith Mark (Authentic Dark Monolith on Chalk Paper) -->
      <div class="w-9 h-9 rounded-xl bg-neutral-100 border border-neutral-200/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.04)] flex items-center justify-center shrink-0 text-neutral-900">
        <svg width="18" height="18" viewBox="0 0 100 100" fill="currentColor" class="text-neutral-900">
          <path d="M 26 18 H 50.7 A 1.8 1.8 0 0 1 52.43 20.28 L 35.88 79.95 A 2.8 2.8 0 0 1 33.19 82 H 26 A 8 8 0 0 1 18 74 V 26 A 8 8 0 0 1 26 18 Z" />
          <path d="M 74 82 H 49.3 A 1.8 1.8 0 0 1 47.57 79.72 L 64.12 20.05 A 2.8 2.8 0 0 1 66.81 18 H 74 A 8 8 0 0 1 82 26 V 74 A 8 8 0 0 1 74 82 Z" />
        </svg>
      </div>

      <!-- Text Context -->
      <div class="flex flex-col min-w-0 pr-1">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold text-neutral-900 tracking-tight">Apposition</span>
          <span class="text-[10px] font-mono font-medium text-neutral-600 bg-neutral-100 border border-neutral-200/80 px-1.5 py-0.2 rounded">
            v1.3.3
          </span>
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
        </div>
        <span class="text-[11px] text-neutral-500 underline decoration-neutral-300 underline-offset-2 truncate">
          Update ready &bull; Restart to apply
        </span>
      </div>

      <!-- Action Cluster -->
      <div class="flex items-center gap-1.5 shrink-0">
        <button class="text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white px-3.5 py-1.5 rounded-xl doppelrand-button transition-all cursor-pointer whitespace-nowrap">
          Restart to Apply
        </button>
        <button class="text-neutral-400 hover:text-neutral-700 p-1 rounded-lg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

  </div>

</body>
</html>`;

  await page.setContent(html, { waitUntil: "networkidle" });
  
  const artifactDir = "C:\\Users\\STRIX III\\.gemini\\antigravity-cli\\brain\\3ced3aae-2b1c-46c1-abd2-e06385a4ec94";
  const outputPath = path.join(artifactDir, "updater_preview.png");
  
  await page.screenshot({ path: outputPath, fullPage: true });
  await browser.close();

  console.log("RENDER_OK:" + outputPath);
}

renderPreview().catch((e) => {
  console.error("RENDER_ERROR:", e);
  process.exit(1);
});
