import fs from "fs";
import path from "path";

// Extract Reddit IDs from the generated markdown draft and append to history
const draftsPath = path.join(process.cwd(), "memory", "social-drafts.md");
const historyPath = path.join(process.cwd(), "memory", "social-history.json");

if (!fs.existsSync(draftsPath)) {
  console.log("No drafts file found, nothing to do.");
  process.exit(0);
}

const markdown = fs.readFileSync(draftsPath, "utf8");

// Regex to find all reddit comment links
// e.g. https://www.reddit.com/r/SaaS/comments/1vknsbc/is_just_build_the_admin_panel_yourself_a_trap/
const regex = /comments\/([a-z0-9]+)\//g;
let match;
const newIds = new Set<string>();

while ((match = regex.exec(markdown)) !== null) {
  newIds.add(match[1]);
}

if (newIds.size === 0) {
  console.log("No Reddit IDs found in drafts.");
  process.exit(0);
}

let history: string[] = [];
if (fs.existsSync(historyPath)) {
  try {
    history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  } catch (e) {}
}

let added = 0;
for (const id of newIds) {
  if (!history.includes(id)) {
    history.push(id);
    added++;
  }
}

if (added > 0) {
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`Added ${added} new IDs to ledger.`);
} else {
  console.log("No new IDs to add to ledger.");
}
