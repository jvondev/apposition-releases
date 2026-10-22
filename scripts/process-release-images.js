const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT_DIR = path.resolve(__dirname, '..');
const DRAFT_PATH = path.join(ROOT_DIR, 'draft-changelog.md');
const RELEASES_ASSETS_DIR = path.join(ROOT_DIR, 'assets/releases');

async function convertImageToWebp(inputPath, outputPath, quality = 85) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(inputPath).webp({ quality, effort: 6 }).toFile(outputPath);
  const srcSize = (fs.statSync(inputPath).size / 1024).toFixed(1);
  const outSize = (fs.statSync(outputPath).size / 1024).toFixed(1);
  const savings = ((1 - outSize / srcSize) * 100).toFixed(0);
  console.log('  ✓ Converted: ' + path.basename(inputPath) + ' (' + srcSize + ' KB) -> ' + path.basename(outputPath) + ' (' + outSize + ' KB, -' + savings + '%)');
}

async function processAttachedImages() {
  if (!fs.existsSync(DRAFT_PATH)) return;

  let draft = fs.readFileSync(DRAFT_PATH, 'utf-8');
  let modified = false;

  // Match Markdown images: ![alt](url)
  const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [...draft.matchAll(mdImgRegex)];

  for (const match of matches) {
    const fullMatch = match[0];
    const altText = match[1];
    const rawSrc = match[2].trim();

    if (!/\.(png|jpe?g)$/i.test(rawSrc)) continue;

    let localPath = rawSrc;
    if (!path.isAbsolute(localPath)) {
      localPath = path.resolve(ROOT_DIR, localPath);
    }

    if (fs.existsSync(localPath)) {
      const parsed = path.parse(localPath);
      const cleanBaseName = parsed.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      const destName = cleanBaseName + '.webp';
      const destPath = path.join(RELEASES_ASSETS_DIR, destName);

      await convertImageToWebp(localPath, destPath);

      const relPath = 'assets/releases/' + destName;
      draft = draft.replace(fullMatch, '![' + altText + '](' + relPath + ')');
      modified = true;
    }
  }

  // Also convert any loose PNG/JPG in assets/releases
  if (fs.existsSync(RELEASES_ASSETS_DIR)) {
    const files = fs.readdirSync(RELEASES_ASSETS_DIR);
    for (const file of files) {
      if (/\.(png|jpe?g)$/i.test(file)) {
        const srcPath = path.join(RELEASES_ASSETS_DIR, file);
        const parsed = path.parse(file);
        const destPath = path.join(RELEASES_ASSETS_DIR, parsed.name + '.webp');
        await convertImageToWebp(srcPath, destPath);
        fs.unlinkSync(srcPath);
      }
    }
  }

  if (modified) {
    fs.writeFileSync(DRAFT_PATH, draft, 'utf-8');
    console.log('  ✓ Updated draft-changelog.md references to WebP.');
  }
}

if (require.main === module) {
  processAttachedImages().then(() => {
    console.log('Image processing complete.');
  }).catch((err) => {
    console.error('Error processing release images:', err);
    process.exit(1);
  });
}

module.exports = { processAttachedImages };
