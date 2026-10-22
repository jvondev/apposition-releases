import { existsSync, mkdirSync, cpSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export function resolveHostDevDataDir() {
  const platform = process.platform;
  if (platform === "win32") {
    return process.env.APPDATA ? join(process.env.APPDATA, "AppositionDev") : "";
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "AppositionDev");
  }
  return join(homedir(), ".config", "AppositionDev");
}

export function rehydrateAuthCascade({ sandboxDir, profiles = [], repoRoot = process.cwd() }) {
  const hostDevDir = resolveHostDevDataDir();
  const savedSessionsDir = join(repoRoot, ".marketing", "sessions");
  const targetPartitionsDir = join(sandboxDir, "Partitions");
  const rehydratedProfiles = [];

  if (!existsSync(targetPartitionsDir)) {
    mkdirSync(targetPartitionsDir, { recursive: true });
  }

  for (const prof of profiles) {
    const profileId = prof.id || "main";
    const partitionName = profileId;
    const targetFolder = join(targetPartitionsDir, partitionName);
    const sourceSnapshot = join(savedSessionsDir, profileId);
    let sourceDevPartition = hostDevDir ? join(hostDevDir, "Partitions", partitionName) : "";
    if (sourceDevPartition && !existsSync(sourceDevPartition)) {
      const legacyDev = join(hostDevDir, "Partitions", `persist_${profileId}`);
      if (existsSync(legacyDev)) sourceDevPartition = legacyDev;
    }

    if (prof.authSource === "fresh") {
      continue;
    }

    // 1. Saved Snapshot
    if (existsSync(sourceSnapshot)) {
      try {
        cpSync(sourceSnapshot, targetFolder, { recursive: true });
        rehydratedProfiles.push({ id: profileId, source: "snapshot" });
        continue;
      } catch (err) {
        console.warn(`[Marketing Studio] Failed to copy snapshot for ${profileId}:`, err.message);
      }
    }

    // 2. Fallback: Copy-on-write from Host Dev Session
    if (sourceDevPartition && existsSync(sourceDevPartition)) {
      try {
        cpSync(sourceDevPartition, targetFolder, { recursive: true });
        rehydratedProfiles.push({ id: profileId, source: "dev-clone" });
        continue;
      } catch (err) {
        console.warn(`[Marketing Studio] Failed to copy dev session for ${profileId}:`, err.message);
      }
    }

    // 3. Main profile fallback to root Network directory
    if (profileId === "main" && hostDevDir) {
      const devNetworkDir = join(hostDevDir, "Network");
      const targetNetworkDir = join(targetFolder, "Network");
      if (existsSync(devNetworkDir)) {
        try {
          mkdirSync(targetFolder, { recursive: true });
          cpSync(devNetworkDir, targetNetworkDir, { recursive: true });
          rehydratedProfiles.push({ id: profileId, source: "root-dev-clone" });
        } catch {}
      }
    }
  }

  return rehydratedProfiles;
}

export function saveSessionSnapshot(sandboxDir, profileId, repoRoot = process.cwd()) {
  let sourceFolder = join(sandboxDir, "Partitions", profileId);
  if (!existsSync(sourceFolder)) {
    const legacyFolder = join(sandboxDir, "Partitions", `persist_${profileId}`);
    if (existsSync(legacyFolder)) sourceFolder = legacyFolder;
  }
  const targetDir = join(repoRoot, ".marketing", "sessions", profileId);

  if (!existsSync(sourceFolder)) {
    throw new Error(`Partition folder does not exist: ${sourceFolder}`);
  }

  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceFolder, targetDir, { recursive: true });
  return targetDir;
}
