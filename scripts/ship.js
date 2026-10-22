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

// Helper to run commands
function run(cmd, cwd = PRIVATE_REPO_DIR) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

async function shipIt() {
  console.log("🚀 Starting Two-Stage Deployment Pipeline...\n");

  // -1. Scan and convert attached release images to WebP
  console.log("🖼️  Scanning and converting attached release images to WebP...");
  run("node scripts/process-release-images.js");

  // 0. Compile changelog feeds into bundles
  console.log("📝 Compiling changelog feeds and release metadata...");
  run("node scripts/compile-changelog.js");

  // 1. Build the minified code (Stage 1)
  console.log("📦 Compiling and minifying source code...");
  run("pnpm run build");

  // 2. Prepare the public repo
  console.log("📂 Copying artifacts to public repository...");

  // We need to copy: out/, package.json, electron-builder.yml, build/, assets/, Casks/, scripts/, and releases.json
  const itemsToCopy = [
    "out",
    "package.json",
    "electron-builder.yml",
    "build",
    "assets",
    "Casks",
    "scripts/install-mac.sh",
    "scripts/install-canary.sh",
    "scripts/install-canary-linux.sh",
    "scripts/install-win.ps1",
    "scripts/install-linux.sh",
    "src/renderer/src/config/releases.json",
  ];

  // Also need to get the version to tag it properly
  const pkgJson = require(path.join(PRIVATE_REPO_DIR, "package.json"));
  const version = `v${pkgJson.version}`;

  for (const item of itemsToCopy) {
    const src = path.join(PRIVATE_REPO_DIR, item);
    const dest = path.join(PUBLIC_REPO_DIR, item);

    if (item === "package.json") {
      const pkgJson = JSON.parse(fs.readFileSync(src, "utf-8"));
      // Strip workspace dependencies that will break npm install in the public repo
      for (const dep in pkgJson.dependencies) {
        if (pkgJson.dependencies[dep].startsWith("workspace:")) {
          delete pkgJson.dependencies[dep];
        }
      }
      // Strip pnpm config to force electron-builder to use npm on GitHub Actions
      delete pkgJson.pnpm;
      fs.writeFileSync(dest, JSON.stringify(pkgJson, null, 2));
      console.log(`  ✓ Transformed and copied ${item}`);
      continue;
    }

    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      if (fs.lstatSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true, force: true });
      } else {
        fs.copyFileSync(src, dest);
      }
      console.log(`  ✓ Cleaned and copied ${item}`);
    }
  }

  // Ensure root releases.json exists in public repository for raw CDN consumption
  const releasesSrc = path.join(PRIVATE_REPO_DIR, "src/renderer/src/config/releases.json");
  if (fs.existsSync(releasesSrc)) {
    fs.copyFileSync(releasesSrc, path.join(PUBLIC_REPO_DIR, "releases.json"));
    console.log("  ✓ Copied releases.json to public repository root");
  }

  // Ensure pnpm-lock.yaml doesn't exist in the public repo
  const pnpmLockPath = path.join(PUBLIC_REPO_DIR, "pnpm-lock.yaml");
  if (fs.existsSync(pnpmLockPath)) {
    fs.unlinkSync(pnpmLockPath);
    console.log("  ✓ Deleted pnpm-lock.yaml from public repository");
  }

  // 3. Commit and push the public repo
  console.log(`\n🚢 Pushing ${version} to public repository...`);
  try {
    run("git add .", PUBLIC_REPO_DIR);

    // Check if there are changes to commit
    const status = execSync("git status --porcelain", {
      cwd: PUBLIC_REPO_DIR,
    }).toString();
    if (status) {
      run(`git commit -m "Release ${version}"`, PUBLIC_REPO_DIR);
    } else {
      console.log("  No new changes to commit. Proceeding to tag...");
    }

    // Force create the tag (in case it already exists locally and we're replacing it)
    run(`git tag -f ${version}`, PUBLIC_REPO_DIR);

    // Push code and tags
    run("git push origin main", PUBLIC_REPO_DIR);
    run(`git push origin ${version} --force`, PUBLIC_REPO_DIR);

    console.log(`\n✅ Successfully shipped ${version}!`);
    console.log(
      "GitHub Actions on your public repo will now package the .exe and .dmg.",
    );
  } catch (error) {
    console.error(
      "\n❌ Error during git operations. Make sure the public repo has a remote named 'origin' and you are on the 'main' branch.",
    );
    process.exit(1);
  }
}

shipIt();
