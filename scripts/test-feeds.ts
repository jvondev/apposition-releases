import fs from 'node:fs';
import yaml from 'js-yaml';
import Parser from 'rss-parser';

const rssParser = new Parser({
  timeout: 5000, // 5 second timeout
  headers: {
    'User-Agent': 'AppositionMarketingBot/1.0 (+https://github.com/jvondev/apposition-releases)'
  }
});

interface Config {
  feeds: string[];
}

async function testFeeds() {
  const configPath = 'feeds.yml';
  
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file ${configPath} not found.`);
    process.exit(1);
  }

  let feeds: string[] = [];
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents) as Config;
    feeds = config?.feeds || [];
  } catch (error) {
    console.error(`❌ Error reading ${configPath}:`, error);
    process.exit(1);
  }

  if (feeds.length === 0) {
    console.log("⚠️ No feeds found in feeds.yml.");
    return;
  }

  console.log(`🔍 Testing ${feeds.length} feed(s)...\n`);

  let liveCount = 0;
  let brokenCount = 0;

  for (const url of feeds) {
    if (!url || !url.startsWith('http')) {
      console.log(`❌ BROKEN: Invalid URL format -> ${url}`);
      brokenCount++;
      continue;
    }

    try {
      // We don't need to parse everything, just enough to see if it responds correctly
      const feed = await rssParser.parseURL(url);
      console.log(`✅ LIVE: ${feed.title || url} (${feed.items.length} items)`);
      liveCount++;
    } catch (error) {
      console.log(`❌ BROKEN: ${url}`);
      console.error(`   Reason: ${(error as Error).message}`);
      brokenCount++;
    }

    // 🚦 Add a 2-second delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n📊 Summary: ${liveCount} Live | ${brokenCount} Broken`);
}

testFeeds();
