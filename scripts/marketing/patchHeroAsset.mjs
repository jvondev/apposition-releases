import sharp from "sharp";
import { join } from "path";

const root = process.cwd();
const heroAssetPath = join(root, "web", "public", "marketing-assets", "apposition-competitor-intel-showcase.png");
const marketingHeroAssetPath = join(root, ".marketing", "assets", "apposition-competitor-intel-showcase.png");

// Exact region in 1920x1080:
// Left pane has the GitHub README text between top: 225 and top: 485, left: 85 to 635 (width: 550, height: 260).
const svgOverlay = Buffer.from(`
<svg width="550" height="260" xmlns="http://www.w3.org/2000/svg">
  <rect width="550" height="260" fill="#ffffff" />
  <rect x="155" y="15" width="240" height="24" rx="12" fill="#f6f8fa" stroke="#d0d7de" />
  <text x="275" y="31" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="11" font-weight="600" fill="#0969da" letter-spacing="0.02em">MARKET INTELLIGENCE</text>
  <text x="275" y="75" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="#1f2328" letter-spacing="-0.01em">Competitor Teardown &amp; Specs</text>
  <text x="275" y="112" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12.5" fill="#57606a">Side-by-side analysis of Nothing Technology hardware,</text>
  <text x="275" y="134" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12.5" fill="#57606a">pricing tiering, community discussions, and launch video.</text>
  <line x1="85" y1="168" x2="465" y2="168" stroke="#eaeef2" stroke-width="1" />
  <text x="275" y="198" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="11" font-weight="500" fill="#8c959f">Research workspace with 4 live synced views</text>
</svg>
`);

async function run() {
  const image = sharp(heroAssetPath);
  const patched = await image
    .composite([{ input: svgOverlay, top: 225, left: 85 }])
    .png()
    .toBuffer();

  const fs = await import("fs");
  fs.writeFileSync(heroAssetPath, patched);
  if (fs.existsSync(marketingHeroAssetPath)) {
    fs.writeFileSync(marketingHeroAssetPath, patched);
  }
  console.log("Patched hero asset successfully!");
}

run().catch(console.error);
