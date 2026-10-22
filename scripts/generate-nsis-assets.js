const { Jimp } = require("jimp");
const path = require("path");
const fs = require("fs");

async function generateNsisAssets() {
  const assetsDir = path.resolve(__dirname, "../assets");
  const iconPath = path.join(assetsDir, "icon.png");

  console.log("Generating premium NSIS installer assets...");

  const icon = await Jimp.read(iconPath);

  // 1. installerHeader.bmp: 150 x 57 px
  // Clean minimal white/light banner with right-aligned Apposition icon
  const header = new Jimp({ width: 150, height: 57, color: 0xffffffff });
  const iconHeader = icon.clone().resize({ w: 40, h: 40 });
  header.composite(iconHeader, 150 - 40 - 10, Math.floor((57 - 40) / 2));
  const headerBuffer = await header.getBuffer("image/bmp");
  fs.writeFileSync(path.join(assetsDir, "installerHeader.bmp"), headerBuffer);
  console.log("  ✓ Created assets/installerHeader.bmp (150x57)");

  // 2. installerSidebar.bmp: 164 x 314 px
  // Sleek deep charcoal background (#18181b / 0x18181bff) with centered Apposition emblem
  const sidebar = new Jimp({ width: 164, height: 314, color: 0x18181bff });
  const iconSidebar = icon.clone().resize({ w: 72, h: 72 });
  sidebar.composite(iconSidebar, Math.floor((164 - 72) / 2), 60);
  const sidebarBuffer = await sidebar.getBuffer("image/bmp");
  fs.writeFileSync(path.join(assetsDir, "installerSidebar.bmp"), sidebarBuffer);
  console.log("  ✓ Created assets/installerSidebar.bmp (164x314)");

  // 3. uninstallerSidebar.bmp: 164 x 314 px
  fs.writeFileSync(path.join(assetsDir, "uninstallerSidebar.bmp"), sidebarBuffer);
  console.log("  ✓ Created assets/uninstallerSidebar.bmp (164x314)");

  console.log("✅ All NSIS graphical assets generated successfully!");
}

generateNsisAssets().catch(console.error);
