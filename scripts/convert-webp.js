const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function convertToWebp(inputPath, quality = 85) {
  if (!fs.existsSync(inputPath)) {
    console.error('File not found: ' + inputPath);
    process.exit(1);
  }

  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) {
    const files = fs.readdirSync(inputPath).filter((f) => /\.(png|jpe?g)$/i.test(f));
    console.log('Found ' + files.length + ' images to convert in ' + inputPath);
    for (const f of files) {
      const src = path.join(inputPath, f);
      const out = path.join(inputPath, path.parse(f).name + '.webp');
      await sharp(src).webp({ quality, effort: 6 }).toFile(out);
      const srcSize = (fs.statSync(src).size / 1024).toFixed(1);
      const outSize = (fs.statSync(out).size / 1024).toFixed(1);
      console.log('✓ ' + f + ' (' + srcSize + ' KB) -> ' + path.basename(out) + ' (' + outSize + ' KB)');
    }
    return;
  }

  const parsed = path.parse(inputPath);
  const outputPath = path.join(parsed.dir, parsed.name + '.webp');
  await sharp(inputPath).webp({ quality, effort: 6 }).toFile(outputPath);

  const srcSize = (fs.statSync(inputPath).size / 1024).toFixed(1);
  const outSize = (fs.statSync(outputPath).size / 1024).toFixed(1);
  const savings = (((1 - outSize / srcSize)) * 100).toFixed(0);

  console.log('✓ Converted: ' + parsed.base + ' (' + srcSize + ' KB) -> ' + path.basename(outputPath) + ' (' + outSize + ' KB, -' + savings + '%)');
}

const target = process.argv[2];
if (!target) {
  console.log('Usage: node scripts/convert-webp.js <image.png|image.jpg|folder_path> [quality]');
  process.exit(0);
}

const quality = process.argv[3] ? parseInt(process.argv[3], 10) : 85;
convertToWebp(target, quality).catch((err) => {
  console.error('Conversion error:', err);
  process.exit(1);
});
