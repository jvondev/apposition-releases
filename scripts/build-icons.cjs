const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const pngToIco = require("png-to-ico").default;

async function buildIcons() {
  const rootDir = path.join(__dirname, "..");
  const svgPath = path.join(rootDir, "assets", "logo.svg");
  const assetsDir = path.join(rootDir, "assets");
  const buildDir = path.join(rootDir, "build");

  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

  const svgContent = fs.readFileSync(svgPath, "utf8");

  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            width: 512px;
            height: 512px;
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .icon-box {
            width: 440px;
            height: 440px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          svg {
            width: 100%;
            height: 100%;
          }
        </style>
      </head>
      <body>
        <div class="icon-box">
          ${svgContent}
        </div>
      </body>
    </html>
  `;

  await page.setContent(html);
  const pngPath = path.join(assetsDir, "icon.png");
  await page.screenshot({ path: pngPath, omitBackground: true });
  await browser.close();
  console.log("✅ Generated assets/icon.png from assets/logo.svg");

  const icoBuf = await pngToIco(pngPath);
  fs.writeFileSync(path.join(assetsDir, "icon.ico"), icoBuf);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), icoBuf);
  console.log("✅ Generated assets/icon.ico and build/icon.ico");

  // Web public assets if directory exists
  const webPublicDir = path.join(rootDir, "web", "public");
  if (fs.existsSync(webPublicDir)) {
    fs.writeFileSync(path.join(webPublicDir, "favicon.ico"), icoBuf);
    fs.copyFileSync(pngPath, path.join(webPublicDir, "apple-touch-icon.png"));
    console.log("✅ Generated web/public/favicon.ico and web/public/apple-touch-icon.png");
  }

  // Clean up stale mock/temporary files (safe list only)
  const junkFiles = [
    path.join(rootDir, "assets", "icon.jpg"),
    path.join(rootDir, "assets", "sidebar.jpg"),
    path.join(rootDir, "assets", "installerHeaderIcon.ico"),
    path.join(rootDir, "build", "installerHeaderIcon.ico"),
    path.join(rootDir, "generate-assets.js"),
    path.join(rootDir, "fix-logo.js"),
    path.join(rootDir, "scripts", "generate-icons.js"),
  ];

  for (const file of junkFiles) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`🗑️ Removed: ${path.basename(file)}`);
    }
  }
}

buildIcons().catch((err) => {
  console.error("Error building icons:", err);
  process.exit(1);
});
