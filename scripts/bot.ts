import fs from 'node:fs';
import yaml from 'js-yaml';
import Parser from 'rss-parser';
import { GoogleGenAI } from '@google/genai';
import { subHours, isAfter } from 'date-fns';

interface Config {
  feeds: string[];
}

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function getFeeds(configPath: string): Promise<string[]> {
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents) as Config;
    return config?.feeds || [];
  } catch (error) {
    console.error(`Error reading config:`, error);
    return [];
  }
}

export async function fetchAndFilterEntries(feeds: string[]) {
  const validEntries = [];
  const cutoff = subHours(new Date(), 24.5);

  const shuffledFeeds = shuffleArray(feeds);
  
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15'
  ];

  for (const feedUrl of shuffledFeeds) {
    if (!feedUrl || !feedUrl.startsWith('http')) continue;
    
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    const rssParser = new Parser({
      headers: {
        'User-Agent': randomUA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    console.log(`Fetching ${feedUrl} ...`);
    try {
      const feed = await rssParser.parseURL(feedUrl);
      for (const item of feed.items) {
        if (item.pubDate) {
          const pubDate = new Date(item.pubDate);
          if (isAfter(pubDate, cutoff)) {
            validEntries.push({
              id: item.guid || item.link || '',
              title: item.title || '',
              link: item.link || '',
              summary: (item.contentSnippet || item.content || '').substring(0, 1000), // Limit summary
              published: item.pubDate,
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching feed ${feedUrl}:`, (error as Error).message);
    }
    
    // 🚦 Domain-specific delays to avoid rate limits
    const isReddit = feedUrl.includes('reddit.com');
    // Reddit gets 8-15 seconds. Others get 4-8 seconds.
    const delay = isReddit 
      ? Math.floor(Math.random() * (15000 - 8000 + 1) + 8000)
      : Math.floor(Math.random() * (8000 - 4000 + 1) + 4000);
      
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return validEntries;
}

export function batchEntries<T>(entries: T[], batchSize = 5): T[][] {
  const batches = [];
  for (let i = 0; i < entries.length; i += batchSize) {
    batches.push(entries.slice(i, i + batchSize));
  }
  return batches;
}

export async function evaluateBatch(batch: any[], apiKey: string) {
  const ai = new GoogleGenAI({ apiKey });

  let prompt = `Evaluate the following ${batch.length} Google Alert RSS posts.\n`;
  prompt += `Determine if each post is a genuine opportunity to promote the "Apposition" app.\n`;
  prompt += `Return the response strictly as a JSON Array of objects with the following schema:\n`;
  prompt += `[\n  {\n    "id": "<id>",\n    "worth_replying": true/false,\n    "reason": "<explanation>",\n    "draft_reply": "<suggested reply>"\n  }\n]\n\nPosts:\n`;

  for (const entry of batch) {
    prompt += `\n---\nID: ${entry.id}\nTitle: ${entry.title}\nSummary: ${entry.summary}\nLink: ${entry.link}\nPublished: ${entry.published}`;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemma-4-31b-it', // Using Gemma 4 as requested
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });
    const text = response.text || "[]";
    return JSON.parse(text);
  } catch (error) {
    console.error(`Error evaluating batch:`, error);
    return [];
  }
}

export async function sendTelegramMessage(entry: any, evaluation: any, botToken: string, chatId: string) {
  const escapeHtml = (unsafe: any) => {
    return String(unsafe || '')
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  const truncate = (str: string, len: number) => str.length > len ? str.substring(0, len) + '...' : str;

  const title = escapeHtml(truncate(entry.title || 'No Title', 200));
  const reason = escapeHtml(truncate(evaluation.reason || '', 1000));
  const draft = escapeHtml(truncate(evaluation.draft_reply || '', 2000));

  let text = `<b>${title}</b>\n\n`;
  text += `📰 <b>Source:</b> Google Alerts\n`;
  text += `🧠 <b>AI Reason:</b> ${reason}\n`;
  text += `📝 <b>AI Draft:</b> ${draft}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🔗 Go to Post", url: entry.link }]
    ]
  };

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: keyboard
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Telegram API responded with ${response.status}: ${errText}`);
    }
    console.log(`Sent Telegram message for ${entry.id}`);
  } catch (error) {
    console.error(`Error sending to Telegram for ${entry.id}:`, error);
  }
}

export async function main() {
  const apiKey = process.env.GOOGLE_API_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!apiKey || !botToken || !chatId) {
    console.error("Missing required environment variables.");
    process.exit(1);
  }

  const configPath = 'feeds.yml';
  if (!fs.existsSync(configPath)) {
    console.error(`Config file ${configPath} not found.`);
    process.exit(1);
  }

  const feeds = await getFeeds(configPath);
  if (feeds.length === 0) {
    console.log("No feeds found.");
    return;
  }

  const entries = await fetchAndFilterEntries(feeds);
  console.log(`Found ${entries.length} valid entries in the last 24.5 hours.`);

  const entryDict = new Map(entries.map(e => [e.id, e]));

  const batches = batchEntries(entries, 5);
  for (const batch of batches) {
    const evaluations = await evaluateBatch(batch, apiKey);
    for (const evalResult of evaluations) {
      if (evalResult.worth_replying) {
        const entry = entryDict.get(evalResult.id);
        if (entry) {
          await sendTelegramMessage(entry, evalResult, botToken, chatId);
        }
      }
    }

    // 🚦 AI Rate Limiting: Wait 3 seconds before sending the next batch to Gemma 4.
    // This ensures we stay well under the 30 Requests Per Minute (RPM) and 16K Tokens Per Minute (TPM) limits.
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

// Execute main if this file is run directly via tsx
if (require.main === module) {
  main();
}
