const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function findPublicRepoDir() {
  const candidates = [
    path.resolve(__dirname, "../../apposition-releases"),
    path.resolve(__dirname, "../../../apposition-releases"),
    path.resolve(__dirname, "../../../../apposition-releases"),
    "D:/jvondev/apposition-releases",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, ".git"))) {
      return candidate;
    }
  }
  return candidates[0];
}

const PUBLIC_REPO_DIR = findPublicRepoDir();
const PRIVATE_REPO_DIR = path.resolve(__dirname, "..");

function run(cmd, cwd = PRIVATE_REPO_DIR) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

function resolveNextCanaryVersion(baseVersion, customArg) {
  if (customArg) {
    return customArg.replace(/^v/, "");
  }
  const parts = baseVersion.replace(/^v/, "").split(".");
  const major = parseInt(parts[0] || "1", 10);
  const minor = parseInt(parts[1] || "3", 10);
  const patch = parseInt(parts[2] || "0", 10) + 1;
  return `${major}.${minor}.${patch}-canary.${Date.now().toString().slice(-4)}`;
}

async function publishCanary() {
  console.log("🐥 Starting Canary Pre-Release Deployment Pipeline...\n");

  const pkgJsonPath = path.join(PRIVATE_REPO_DIR, "package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const canaryVersion = resolveNextCanaryVersion(pkgJson.version, process.argv[2]);
  const tag = `v${canaryVersion}`;

  console.log(`• Target Canary Version: ${canaryVersion} (Tag: ${tag})`);

  // 1. Compile source code
  console.log("📦 Compiling and minifying source code...");
  run("npm run build");

  // 2. Sync installer scripts to main branch first
  console.log("📂 Syncing installer scripts to public repo main branch...");
  try {
    run("git checkout main", PUBLIC_REPO_DIR);
    const scripts = ["install-mac.sh", "install-canary.sh", "install-canary-linux.sh", "install-win.ps1", "install-linux.sh"];
    for (const s of scripts) {
      const src = path.join(PRIVATE_REPO_DIR, "scripts", s);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(PUBLIC_REPO_DIR, "scripts", s));
        if (s.startsWith("install-canary")) {
          fs.copyFileSync(src, path.join(PUBLIC_REPO_DIR, s));
        }
      }
    }
    run("git add install-canary.sh install-canary-linux.sh scripts/", PUBLIC_REPO_DIR);
    const mainStatus = execSync("git status --porcelain", { cwd: PUBLIC_REPO_DIR }).toString();
    if (mainStatus) {
      run(`git commit -m "chore: sync canary installer scripts [skip ci]"`, PUBLIC_REPO_DIR);
      run("git push origin main", PUBLIC_REPO_DIR);
    }
  } catch (e) {
    console.warn("  Notice: main branch installer sync warning:", e.message);
  }

  // 3. Prepare items for Canary branch in public repo
  console.log("📂 Copying artifacts to public repository...");
  run("git checkout -B canary", PUBLIC_REPO_DIR);

  const itemsToCopy = [
    "out",
    "package.json",
    "electron-builder.yml",
    "build",
    "assets",
    "Casks",
    "scripts",
    "src/renderer/src/config/releases.json",
  ];

  for (const item of itemsToCopy) {
    const src = path.join(PRIVATE_REPO_DIR, item);
    const dest = path.join(PUBLIC_REPO_DIR, item);

    if (item === "package.json") {
      const publicPkg = JSON.parse(fs.readFileSync(src, "utf-8"));
      publicPkg.version = canaryVersion;
      publicPkg.productName = "Apposition Canary";
      for (const dep in publicPkg.dependencies) {
        if (publicPkg.dependencies[dep].startsWith("workspace:")) {
          delete publicPkg.dependencies[dep];
        }
      }
      delete publicPkg.pnpm;
      fs.writeFileSync(dest, JSON.stringify(publicPkg, null, 2));
      console.log(`  ✓ Transformed package.json for Canary (${canaryVersion})`);
      continue;
    }

    if (item === "electron-builder.yml") {
      let yml = fs.readFileSync(src, "utf-8");
      yml = yml.replace(/appId:\s*com\.jvondev\.apposition\.app/, "appId: com.jvondev.apposition.canary");
      yml = yml.replace(/productName:\s*Apposition/, "productName: Apposition Canary");
      fs.writeFileSync(dest, yml);
      console.log("  ✓ Configured electron-builder.yml for Apposition Canary");
      continue;
    }

    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
      if (fs.lstatSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true, force: true });
      } else {
        fs.copyFileSync(src, dest);
      }
      console.log(`  ✓ Cleaned and copied ${item}`);
    }
  }

  // Clean pnpm-lock.yaml in public repo
  const pnpmLockPath = path.join(PUBLIC_REPO_DIR, "pnpm-lock.yaml");
  if (fs.existsSync(pnpmLockPath)) fs.unlinkSync(pnpmLockPath);

  // 4. Commit and push canary branch and tag for CI packaging
  console.log(`\n🚢 Pushing Canary ${tag} to public repository...`);
  try {
    run("git add .", PUBLIC_REPO_DIR);

    const status = execSync("git status --porcelain", { cwd: PUBLIC_REPO_DIR }).toString();
    if (status) {
      run(`git commit -m "chore(canary): ${tag}"`, PUBLIC_REPO_DIR);
    }

    // Force create the canary tag
    run(`git tag -f ${tag}`, PUBLIC_REPO_DIR);

    // Push canary branch and tag
    run("git push origin canary --force", PUBLIC_REPO_DIR);
    run(`git push origin ${tag} --force`, PUBLIC_REPO_DIR);

    // Safely restore public repo to main
    run("git checkout main", PUBLIC_REPO_DIR);

    console.log(`\n🎉 Canary ${tag} pushed successfully!`);
    console.log("GitHub Actions on your public repo will now compile the macOS DMG.\n");
    console.log("═════════════════════════════════════════════════════════════════");
    console.log("📲 RUN THIS ONE-LINER IN YOUR MACOS TERMINAL TO TEST:");
    console.log(`curl -fsSL https://raw.githubusercontent.com/jvondev/apposition-releases/main/install-canary.sh | bash`);
    console.log("═════════════════════════════════════════════════════════════════\n");
  } catch (error) {
    console.error("\n❌ Error during canary git operations:", error.message || error);
    process.exit(1);
  }
}

publishCanary();
