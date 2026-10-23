import https from "https";
import fs from "fs";
import path from "path";

// Precheck script to safely determine if the Orca AI should wake up.
// It checks Reddit's public, anonymous JSON API. If it finds keywords,
// it exits with 0 (success, wake up AI). If not, exits 1 (skip run).
// This guarantees zero risk of bans because it's anonymous and runs once a day.

const keywords = [
  // ICP Lead Gen
  "(tabs AND (memory OR ram OR crashing))",
  "(clients AND (multiple OR accounts OR managing))",
  "rambox alternative",
  "ferdium",
  "wavebox",
  // Karma Farming
  "how do you manage clients",
];
const subreddit =
  "macapps+freelance+productivity+agency+marketing+SaaS+Entrepreneur+webdev";

const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(
  keywords.join(" OR "),
)}&restrict_sr=on&sort=new&t=day`;

const options = {
  headers: {
    "User-Agent": "AppositionMarketingBot/1.0",
  },
};

https
  .get(url, options, (res) => {
    let data = "";

    res.on("data", (chunk) => {
      data += chunk;
    });

    res.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (
          parsed.data &&
          parsed.data.children &&
          parsed.data.children.length > 0
        ) {
          // Load history ledger
          const historyPath = path.join(
            process.cwd(),
            "memory",
            "social-history.json",
          );
          let history = [];
          if (fs.existsSync(historyPath)) {
            try {
              history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
            } catch (e) {
              console.warn(
                "Could not read social-history.json. Starting fresh.",
              );
            }
          }

          // Filter out already processed posts
          const newLeads = parsed.data.children.filter(
            (post: any) => !history.includes(post.data.id),
          );

          if (newLeads.length > 0) {
            console.log(`Found ${newLeads.length} new leads. Waking up AI...`);

            // Format and save to aggregated.json
            const scratchDir = path.join(
              process.cwd(),
              "memory",
              "social-scratch",
            );
            if (!fs.existsSync(scratchDir)) {
              fs.mkdirSync(scratchDir, { recursive: true });
            }

            const results = newLeads.map((post: any) => ({
              source: "reddit_api",
              id: post.data.id,
              title: post.data.title,
              text: post.data.selftext,
              url: `https://www.reddit.com${post.data.permalink}`,
            }));

            fs.writeFileSync(
              path.join(scratchDir, "aggregated.json"),
              JSON.stringify(results, null, 2),
            );

            process.exit(0); // Success, trigger AI
          } else {
            console.log("No new leads found today. Skipping AI run.");
            process.exit(1); // Fail, skip AI run
          }
        } else {
          console.log("No leads found today. Skipping AI run.");
          process.exit(1); // Fail, skip AI run
        }
      } catch (e) {
        console.error("Error parsing response:", e);
        process.exit(1);
      }
    });
  })
  .on("error", (err) => {
    console.error("Network error:", err.message);
    process.exit(1);
  });
