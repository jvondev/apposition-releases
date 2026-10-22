import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const appData =
  process.env.APPDATA ||
  (process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support")
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config")));

const showcaseDir = join(appData, "AppositionShowcase");
const dbName = "apposition_state_showcase.db";

console.log(`[Showcase Reset] Checking directory: ${showcaseDir}`);

let deleted = 0;
for (const ext of ["", "-wal", "-shm"]) {
  const file = join(showcaseDir, dbName + ext);
  if (existsSync(file)) {
    try {
      unlinkSync(file);
      console.log(`  Removed: ${file}`);
      deleted++;
    } catch (e) {
      console.warn(`  Warning: Could not remove ${file} (${e.message})`);
    }
  }
}

if (deleted > 0) {
  console.log(`[Showcase Reset] Successfully cleaned ${deleted} showcase database file(s). Next launch will be a pristine fresh-install.`);
} else {
  console.log(`[Showcase Reset] Database is already clean.`);
}
