const os = require("os");
const path = require("path");
const fs = require("fs");

// The app name matches the name in package.json and how Electron resolves getPath('userData')
const appName = "apposition";
let userDataPath;

// Safely determine the userData path based on the operating system
if (process.platform === "win32") {
  userDataPath = path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    appName,
  );
} else if (process.platform === "darwin") {
  userDataPath = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    appName,
  );
} else {
  userDataPath = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    appName,
  );
}

const dbName = "apposition_state.db";

console.log(`\n🧹 Resetting database for ${appName}...`);
console.log(`Looking in: ${userDataPath}\n`);

let deletedCount = 0;

// SQLite creates three files when in WAL mode: .db, .db-wal, and .db-shm
// We need to delete all of them to truly reset the state.
["", "-wal", "-shm"].forEach((ext) => {
  const filePath = path.join(userDataPath, dbName + ext);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`✅ Deleted: ${dbName}${ext}`);
      deletedCount++;
    } catch (err) {
      console.error(
        `❌ Failed to delete ${dbName}${ext}. Is the app still running?`,
      );
      console.error(`   Error: ${err.message}`);
    }
  }
});

if (deletedCount === 0) {
  console.log(`🤷 No database files found. It's already completely clean!`);
} else {
  console.log(
    `\n✨ Database reset complete! You can now run 'npm run dev' to see the fresh onboarding experience.`,
  );
}
