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

  function shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const shuffledFeeds = shuffleArray(feeds);
  
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15'
  ];

  for (const url of shuffledFeeds) {
    if (!url || !url.startsWith('http')) {
      console.log(`❌ BROKEN: Invalid URL format -> ${url}`);
      brokenCount++;
      continue;
    }
    
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    const rssParser = new Parser({
      timeout: 5000,
      headers: {
        'User-Agent': randomUA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

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

    // 🚦 Domain-specific delays to avoid rate limits
    const isReddit = url.includes('reddit.com');
    const delay = isReddit 
      ? Math.floor(Math.random() * (15000 - 8000 + 1) + 8000)
      : Math.floor(Math.random() * (8000 - 4000 + 1) + 4000);
      
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  console.log(`\n📊 Summary: ${liveCount} Live | ${brokenCount} Broken`);
}

testFeeds();
