const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Placing the references folder OUTSIDE the main repo to avoid git pollution
const REFS_DIR = path.resolve(__dirname, "../../apposition-references");

// The definitive list of references
const repos = [
  {
    url: "https://github.com/stablyai/orca.git",
    folder: "orca",
    area: "Terminal & Dev Management",
  },
  {
    url: "https://github.com/ferdium/ferdium-app.git",
    folder: "ferdium",
    area: "Session & Webview Isolation",
  },
  {
    url: "https://github.com/zen-browser/desktop.git",
    folder: "zen-browser",
    area: "Browser UI, Tabs & Workspaces",
  },
  {
    url: "https://github.com/react-grid-layout/react-grid-layout.git",
    folder: "react-grid-layout",
    area: "Tiling Grid Engine",
  },
  {
    url: "https://github.com/pacocoursey/cmdk.git",
    folder: "cmdk",
    area: "Global Scratchpad / Command Palette",
  },
  {
    url: "https://github.com/browserbase/stagehand.git",
    folder: "stagehand",
    area: "AI DOM Automation",
  },
  {
    url: "https://github.com/darkreader/darkreader.git",
    folder: "darkreader",
    area: "Safe DOM & CSS Injection",
  },
  {
    url: "https://github.com/hoppscotch/hoppscotch.git",
    folder: "hoppscotch",
    area: "Complex State & Workspace Sync",
  },
  {
    url: "https://github.com/minbrowser/min.git",
    folder: "minbrowser",
    area: "Electron RAM & Tab Suspension",
  },
  {
    url: "https://github.com/bitwarden/clients.git",
    folder: "bitwarden",
    area: "Secure Credentials & Autofill",
  },
  {
    url: "https://github.com/caplin/FlexLayout.git",
    folder: "flexlayout",
    area: "True IDE Docking & Tiling",
  },
];

console.log(`🚀 Starting Apposition AI Reference Manager...`);
console.log(`📁 Target Directory: ${REFS_DIR}\n`);

if (!fs.existsSync(REFS_DIR)) {
  fs.mkdirSync(REFS_DIR, { recursive: true });
}

for (const repo of repos) {
  const targetPath = path.join(REFS_DIR, repo.folder);
  console.log(`📦 Processing [${repo.area}]: ${repo.folder}`);

  try {
    if (!fs.existsSync(targetPath)) {
      console.log(
        `   └─ Cloning shallow copy (fetching only the latest code)...`,
      );
      execSync(`git clone --depth 1 ${repo.url} "${targetPath}"`, {
        stdio: "inherit",
      });
    } else {
      console.log(`   └─ Updating existing shallow copy...`);
      // Fetches the latest commit and hard resets, discarding any local changes or extra history
      execSync(
        `git fetch --depth 1 origin HEAD && git reset --hard origin/HEAD && git clean -fdx`,
        {
          cwd: targetPath,
          stdio: "inherit",
        },
      );
    }
  } catch (error) {
    console.error(`❌ Failed to process ${repo.folder}:`, error.message);
  }
}

console.log(`\n✅ All AI references are ready!`);
console.log(`👉 Point your AI agent to: ${REFS_DIR}`);
