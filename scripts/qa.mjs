import { execSync, spawn } from "node:child_process";

const args = process.argv.slice(2).map((a) => a.toLowerCase());
let target = args[0] || null;

if (!target) {
  try {
    const statusOutput = execSync("git status --porcelain", { encoding: "utf8" });
    const diffOutput = execSync("git diff --name-only HEAD~1", { encoding: "utf8" }).catch?.(() => "") || "";
    const allChanges = `${statusOutput}\n${diffOutput}`;

    const touchesWeb = allChanges.includes("web/");
    const touchesSrc = allChanges.includes("src/") || allChanges.includes("packages/");

    if (touchesWeb && !touchesSrc) {
      target = "web";
    } else {
      target = "app";
    }
  } catch {
    target = "app";
  }
}

if (target === "web") {
  console.log("⚡ [JIT QA] Detected Web target. Running static build & preview (zero hot-swap lag)...");
  const build = spawn("pnpm", ["--filter", "web", "build"], {
    stdio: "inherit",
    shell: true,
  });

  build.on("close", (code) => {
    if (code !== 0) {
      process.exit(code || 1);
    }
    console.log("🚀 [JIT QA] Starting static Astro preview on http://localhost:4321 ...");
    spawn("pnpm", ["--filter", "web", "preview"], {
      stdio: "inherit",
      shell: true,
    });
  });
} else {
  console.log("🖥️ [JIT QA] Detected Desktop App target. Running build & Electron preview (zero hot-swap lag)...");
  const build = spawn("pnpm", ["run", "build"], {
    stdio: "inherit",
    shell: true,
  });

  build.on("close", (code) => {
    if (code !== 0) {
      process.exit(code || 1);
    }
    console.log("🚀 [JIT QA] Launching Electron preview without file watchers...");
    spawn("npx", ["electron-vite", "preview"], {
      stdio: "inherit",
      shell: true,
    });
  });
}
