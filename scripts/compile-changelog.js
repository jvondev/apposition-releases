const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DRAFT_PATH = path.join(ROOT_DIR, "draft-changelog.md");
const PKG_PATH = path.join(ROOT_DIR, "package.json");
const HISTORICAL_PATH = path.join(__dirname, "historical-releases.json");

const RENDERER_CONFIG_DIR = path.join(ROOT_DIR, "src/renderer/src/config");
const WEB_DATA_DIR = path.join(ROOT_DIR, "web/src/data");

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
  return null;
}

function parseDraftMarkdown(markdown, version, title) {
  const cleanVersion = version.replace(/^v/, "");
  const tag = `v${cleanVersion}`;
  const publishedAt = new Date().toISOString().split("T")[0];

  const imgMatch = markdown.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  const heroImage = imgMatch ? imgMatch[1] : undefined;

  let parsedTitle = title;
  const h1Match = markdown.match(/^#\s+(.+)$/m);
  if (!parsedTitle && h1Match && !/^draft\s*changelog$/i.test(h1Match[1].trim())) {
    parsedTitle = h1Match[1].trim();
  }
  if (parsedTitle) {
    // Strip redundant leading version tags (e.g. "v1.3.3:", "Apposition v1.3.3:", "1.3.3 -")
    parsedTitle = parsedTitle.replace(/^(?:Apposition\s+)?v?\d+\.\d+(?:\.\d+)?[:\s\-–—]+\s*/i, "").trim();
  }

  const categories = [];
  const lines = markdown.split(/\r?\n/);
  let currentCategory = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const headerMatch = line.match(/^#{2,4}\s+(.+)$/);
    if (headerMatch) {
      currentCategory = { category: headerMatch[1].trim(), items: [] };
      categories.push(currentCategory);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      let itemTitle = "";
      let itemDesc = text;

      const boldMatch = text.match(/^\*\*([^*]+)\*\*[:\s\-–—]+(.+)$/);
      if (boldMatch) {
        itemTitle = boldMatch[1].trim();
        itemDesc = boldMatch[2].trim();
      } else {
        const colonMatch = text.match(/^([^:]{3,60}):\s+(.+)$/);
        if (colonMatch) {
          itemTitle = colonMatch[1].trim();
          itemDesc = colonMatch[2].trim();
        } else {
          const firstPeriod = text.indexOf(". ");
          if (firstPeriod > 0 && firstPeriod < 60) {
            itemTitle = text.substring(0, firstPeriod).trim();
          } else {
            itemTitle = text.split(/\s+/).slice(0, 5).join(" ");
          }
        }
      }

      if (!currentCategory) {
        currentCategory = { category: "Improvements", items: [] };
        categories.push(currentCategory);
      }
      currentCategory.items.push({ title: itemTitle, description: itemDesc });
    }
  }

  const highlights = [];
  const feat = categories.find((c) => /feature/i.test(c.category));
  if (feat) highlights.push(...feat.items.slice(0, 2).map((i) => ({ title: i.title, description: i.description })));
  if (highlights.length < 3) {
    const imp = categories.find((c) => /improve/i.test(c.category));
    if (imp) highlights.push(...imp.items.slice(0, 3 - highlights.length).map((i) => ({ title: i.title, description: i.description })));
  }

  const cleanTitle = (parsedTitle || title || "").replace(/^(?:Apposition\s+)?v?\d+\.\d+(?:\.\d+)?[:\s\-–—]+\s*/i, "").trim();

  return {
    version: cleanVersion,
    tag,
    title: cleanTitle || `Apposition ${tag}`,
    publishedAt,
    ...(heroImage ? { heroImage } : {}),
    categories,
    highlights,
  };
}

function compile() {
  console.log("Compiling changelog feeds...");

  const historicalData = JSON.parse(fs.readFileSync(HISTORICAL_PATH, "utf-8"));
  let allReleases = [...historicalData];

  // If draft-changelog.md exists and has content, parse it as the new version
  if (fs.existsSync(DRAFT_PATH)) {
    const draftContent = fs.readFileSync(DRAFT_PATH, "utf-8").trim();
    if (draftContent) {
      const pkgJson = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
      const currentVersion = pkgJson.version;
      const draftRelease = parseDraftMarkdown(draftContent, currentVersion);

      const existingIdx = allReleases.findIndex((r) => r.version === currentVersion);
      if (existingIdx >= 0) {
        allReleases[existingIdx] = draftRelease;
      } else {
        allReleases.unshift(draftRelease);
      }
    }
  }

  fs.mkdirSync(RENDERER_CONFIG_DIR, { recursive: true });
  fs.mkdirSync(WEB_DATA_DIR, { recursive: true });

  const releasesJson = JSON.stringify(allReleases, null, 2);
  const currentReleaseJson = JSON.stringify(allReleases[0], null, 2);

  fs.writeFileSync(path.join(RENDERER_CONFIG_DIR, "releases.json"), releasesJson);
  fs.writeFileSync(path.join(RENDERER_CONFIG_DIR, "currentRelease.json"), currentReleaseJson);
  console.log("  Saved to src/renderer/src/config/releases.json");

  fs.writeFileSync(path.join(WEB_DATA_DIR, "releases.json"), releasesJson);
  console.log("  Saved to web/src/data/releases.json");

  const publicDir = findPublicRepoDir();
  if (publicDir && fs.existsSync(publicDir)) {
    fs.writeFileSync(path.join(publicDir, "releases.json"), releasesJson);
    console.log("  Saved to public repo releases.json");
  }

  fs.writeFileSync(HISTORICAL_PATH, releasesJson);
  console.log("  Saved to scripts/historical-releases.json");

  console.log(`Changelog compilation complete (${allReleases.length} releases).`);
}

compile();
