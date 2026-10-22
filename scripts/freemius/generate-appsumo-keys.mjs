#!/usr/bin/env node
/**
 * Freemius AppSumo Batch License Generator & Cleanup Utility
 *
 * Usage:
 *   node scripts/freemius/generate-appsumo-keys.mjs --generate --tier 1 --count 300
 *   node scripts/freemius/generate-appsumo-keys.mjs --generate --all --count 300
 *   node scripts/freemius/generate-appsumo-keys.mjs --status
 *   node scripts/freemius/generate-appsumo-keys.mjs --cleanup --tier 1 [--confirm]
 *   node scripts/freemius/generate-appsumo-keys.mjs --dry-run ...
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFreemiusClient } from "./freemiusClient.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");

// Load environment variables
const envPath = path.join(ROOT_DIR, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const [k, ...rest] = trimmed.split("=");
      process.env[k.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}

const TIERS = {
  1: { planId: 70966, pricingId: 96960, name: "Tier 1 ($49 • 1 Seat)" },
  2: { planId: 70967, pricingId: 96962, name: "Tier 2 ($99 • 2 Seats)" },
  3: { planId: 70968, pricingId: 96964, name: "Tier 3 ($149 • 5 Seats + Proxy)" },
};

const client = createFreemiusClient({
  productId: process.env.FREEMIUS_PRODUCT_ID || "38794",
  publicKey: process.env.FREEMIUS_PUBLIC_KEY || "pk_e6a0fc7ddb7371893cf0faafe3cc4",
  secretKey: process.env.FREEMIUS_SECRET_KEY || "",
  devId: process.env.FREEMIUS_DEV_ID || process.env.FREEMIUS_DEVELOPER_ID || "19788",
  bearerToken: process.env.FREEMIUS_BEARER_TOKEN || "",
  baseUrl: process.env.FREEMIUS_API_URL || "https://api.freemius.com",
});

export async function generateTierKeys(tierNum, count, dryRun = false, batch = "") {
  const cfg = TIERS[tierNum];
  if (!cfg) throw new Error(`Invalid tier: ${tierNum}`);
  const batchSuffix = batch ? `-batch${batch}` : "";
  console.log(`\n[Generate] Starting ${cfg.name} (target: ${count} keys, batch: ${batch || "1"})...`);

  const outDir = path.join(ROOT_DIR, "output", "appsumo");
  fs.mkdirSync(outDir, { recursive: true });
  const csvFile = path.join(outDir, `appsumo-tier${tierNum}${batchSuffix}.csv`);

  let existing = [];
  if (fs.existsSync(csvFile)) {
    const lines = fs.readFileSync(csvFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    existing = lines.filter((l) => l !== "code");
  }

  const remaining = count - existing.length;
  if (remaining <= 0) {
    console.log(`  File already contains ${existing.length} keys (meets/exceeds ${count}).`);
    return existing;
  }

  if (dryRun) {
    console.log(`[DRY-RUN] Would create ${remaining} more unassigned keys for Plan ${cfg.planId}.`);
    return existing;
  }

  // AppSumo specification requires a pure single column of codes with NO header row
  if (!fs.existsSync(csvFile)) fs.writeFileSync(csvFile, "", "utf8");

  const pricingId = cfg.pricingId || (await client.getLifetimePricingId(cfg.planId));
  const uri = pricingId
    ? `/v1/products/${client.productId}/plans/${cfg.planId}/pricing/${pricingId}/licenses.json`
    : `/v1/products/${client.productId}/plans/${cfg.planId}/licenses.json`;

  console.log(`  Generating ${remaining} keys (appending to ${csvFile})...`);
  for (let i = 1; i <= remaining; i++) {
    const res = await client.request("POST", uri, { is_block_features: false });
    const key = res?.secret_key || res?.license?.secret_key || res?.key;
    if (!key) throw new Error(`Missing key in API response: ${JSON.stringify(res)}`);
    fs.appendFileSync(csvFile, `${key}\n`, "utf8");
    existing.push(key);
    process.stdout.write(`\r  Progress: ${existing.length}/${count} keys`);
    if (i < remaining) await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`\n  Done. File updated: ${csvFile}`);
  return existing;
}

export async function cleanupUnusedKeys(tierNum = null, confirm = false) {
  console.log(`\n[Cleanup] Scanning licenses for unassigned/unactivated keys...`);
  const list = await client.fetchAllLicenses();
  const targetPlan = tierNum ? TIERS[tierNum]?.planId : null;
  const candidates = list.filter((lic) => {
    const matchPlan = !targetPlan || Number(lic.plan_id) === targetPlan;
    const isUnused = !lic.is_cancelled && !lic.user_id && (!lic.activated || lic.activated === 0) && !lic.installations_count;
    return matchPlan && isUnused;
  });

  console.log(`  Found ${candidates.length} unassigned & unactivated keys across all pages.`);
  if (!confirm) {
    console.log(`  SAFETY: Run with --confirm to safely delete these ${candidates.length} keys.`);
    return;
  }
  for (let i = 0; i < candidates.length; i++) {
    await client.request("DELETE", `/v1/products/${client.productId}/licenses/${candidates[i].id}.json`);
    process.stdout.write(`\r  Purging: ${i + 1}/${candidates.length}`);
  }
  console.log(`\n  Purge complete. Zero active users were touched.`);
}

export async function showStatus() {
  console.log(`\n[Status] Fetching complete license registry for Product ${client.productId}...`);
  const list = await client.fetchAllLicenses();
  for (const [t, cfg] of Object.entries(TIERS)) {
    const tierLics = list.filter((l) => Number(l.plan_id) === cfg.planId && !l.is_cancelled);
    const active = tierLics.filter((l) => l.user_id || (l.activated && l.activated > 0) || l.installations_count).length;
    const unassigned = tierLics.length - active;
    console.log(`  ${cfg.name}: ${tierLics.length} total (${active} active users, ${unassigned} unassigned)`);
  }
}

export async function verifyCsvKeys() {
  console.log(`\n[Verify] Cross-referencing CSV keys against Freemius...`);
  const list = await client.fetchAllLicenses();
  const licMap = new Map(list.map((l) => [l.secret_key, l]));
  const outDir = path.join(ROOT_DIR, "output", "appsumo");
  if (!fs.existsSync(outDir)) {
    console.log("  No output/appsumo directory found.");
    return;
  }
  const files = fs.readdirSync(outDir).filter((f) => f.startsWith("appsumo-tier") && f.endsWith(".csv"));
  for (const file of files) {
    const csvFile = path.join(outDir, file);
    const keys = fs.readFileSync(csvFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    let valid = 0, cancelled = 0, missing = 0, active = 0;
    for (const k of keys) {
      const match = licMap.get(k);
      if (!match) missing++;
      else if (match.is_cancelled) cancelled++;
      else if (match.user_id || (match.activated && match.activated > 0)) active++;
      else valid++;
    }
    console.log(`  ${file}: ${keys.length} keys (${valid} valid unassigned, ${active} active, ${cancelled} cancelled, ${missing} missing)`);
  }
}

// CLI Orchestration
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const isStatus = args.includes("--status");
const isVerify = args.includes("--verify");
const isCleanup = args.includes("--cleanup");
const isGenerate = args.includes("--generate");
const isAll = args.includes("--all");
const confirm = args.includes("--confirm");

const tierArgIdx = args.indexOf("--tier");
const tierNum = tierArgIdx !== -1 ? Number(args[tierArgIdx + 1]) : null;
const countArgIdx = args.indexOf("--count");
const count = countArgIdx !== -1 ? Number(args[countArgIdx + 1]) : 300;
const batchArgIdx = args.indexOf("--batch");
const batch = batchArgIdx !== -1 ? args[batchArgIdx + 1] : "";

async function main() {
  try {
    if (isStatus) await showStatus();
    else if (isVerify) await verifyCsvKeys();
    else if (isCleanup) await cleanupUnusedKeys(tierNum, confirm);
    else if (isGenerate) {
      if (isAll) {
        for (const t of [1, 2, 3]) await generateTierKeys(t, count, dryRun, batch);
      } else if (tierNum) {
        await generateTierKeys(tierNum, count, dryRun, batch);
      } else {
        console.log("Specify --tier <1|2|3> or --all");
      }
    } else {
      console.log("Usage: node generate-appsumo-keys.mjs [--generate|--status|--verify|--cleanup] [--tier 1|2|3] [--count N] [--batch N]");
    }
  } catch (err) {
    console.error(`\n[Error]`, err.message);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
