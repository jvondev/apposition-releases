import fs from "fs";
import path from "path";

const UI_DIRS = ["src/renderer/src", "web/src"];

const HEX_COLOR_REGEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
const INVALID_TAILWIND_COLORS =
  /-(?:blue|indigo|purple|violet|pink|red|emerald|green|yellow|orange|amber)-(?:50|100|200|300|400|500|600|700|800|900)/g;

let violationsCount = 0;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (
        item.name === "node_modules" ||
        item.name === ".git" ||
        item.name === "assets"
      )
        continue;
      scanDir(fullPath);
    } else if (item.isFile()) {
      const ext = path.extname(item.name);
      if ([".ts", ".tsx", ".css", ".astro"].includes(ext)) {
        scanFile(fullPath);
      }
    }
  }
}

function scanFile(file) {
  // Ignore theme stylesheets, this script itself, or non-source files
  if (
    file.includes("theme.css") ||
    file.includes("verify-ui-tokens.js") ||
    file.includes("app.css")
  )
    return;

  const content = fs.readFileSync(file, "utf-8");
  let lineNum = 1;
  const lines = content.split("\n");
  for (const line of lines) {
    // Skip comment lines
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    ) {
      lineNum++;
      continue;
    }

    // Ignore external url references (like google fonts/simple icons urls) or svg paths
    if (
      trimmed.includes("http://") ||
      trimmed.includes("https://") ||
      trimmed.includes("<svg") ||
      trimmed.includes("<path")
    ) {
      lineNum++;
      continue;
    }

    const hexMatches = line.match(HEX_COLOR_REGEX);
    if (hexMatches) {
      hexMatches.forEach((color) => {
        // Exclude specific neutral shades if we allow them, but for strictness let's warn for any
        console.warn(
          `[Style Violation] Hardcoded hex color "${color}" found in ${file}:${lineNum}`,
        );
        violationsCount++;
      });
    }

    const tailwindMatches = line.match(INVALID_TAILWIND_COLORS);
    if (tailwindMatches) {
      tailwindMatches.forEach((cls) => {
        console.warn(
          `[Style Violation] Generic default color class "${cls}" found in ${file}:${lineNum}. Use design tokens instead.`,
        );
        violationsCount++;
      });
    }
    lineNum++;
  }
}

// Start scanning
UI_DIRS.forEach((dir) => scanDir(path.resolve(dir)));

if (violationsCount > 0) {
  console.warn(`\nFound ${violationsCount} style design system violations.`);
} else {
  console.log("Style check passed: 100% design system token consistency.");
}
