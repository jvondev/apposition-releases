const https = require("https");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function getAuthToken() {
  if (process.env.SENTRY_AUTH_TOKEN) return process.env.SENTRY_AUTH_TOKEN;
  if (process.platform === "win32") {
    try {
      const token = execSync(
        'pwsh -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'SENTRY_AUTH_TOKEN\', \'User\')"',
        { encoding: "utf8" }
      ).trim();
      if (token) return token;
    } catch {}
  }
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, "utf8").match(/SENTRY_AUTH_TOKEN=([^\r\n]+)/);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

function request(apiPath, method = "GET", body = null) {
  const token = getAuthToken();
  if (!token) {
    throw new Error("SENTRY_AUTH_TOKEN not found in environment or User registry.");
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "sentry.io",
        path: apiPath,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "Apposition-Sentry-CLI/1.0",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch (e) {
              resolve(data);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getOrgSlug() {
  const orgs = await request("/api/0/organizations/");
  if (!orgs || orgs.length === 0) throw new Error("No Sentry organizations accessible.");
  return orgs[0].slug;
}

async function listIssues(query = "is:unresolved") {
  const org = await getOrgSlug();
  const issues = await request(`/api/0/organizations/${org}/issues/?query=${encodeURIComponent(query)}`);
  console.log(`\n=== Sentry Issues (${org}) [query: "${query}"] ===\n`);
  if (!issues || issues.length === 0) {
    console.log("No issues found.");
    return;
  }
  issues.slice(0, 15).forEach((issue, idx) => {
    console.log(`[${idx + 1}] ${issue.shortId || issue.id} (ID: ${issue.id})`);
    console.log(`    Project:  ${issue.project.slug}`);
    console.log(`    Title:    ${issue.title}`);
    console.log(`    Culprit:  ${issue.culprit || "N/A"}`);
    console.log(`    Events:   ${issue.count} | Users: ${issue.userCount} | Level: ${issue.level}`);
    console.log(`    Last:     ${issue.lastSeen}`);
    console.log(`    Link:     ${issue.permalink}\n`);
  });
}

function printException(entry) {
  if (!entry || !entry.data || !entry.data.values) return;
  console.log("\n--- Exception / Crash ---");
  entry.data.values.forEach((v, i) => {
    console.log(`[#${i + 1}] ${v.type}: ${v.value}`);
    if (v.stacktrace && v.stacktrace.frames) {
      console.log("Stack Frames (last 12):");
      v.stacktrace.frames.slice(-12).forEach((f) => {
        const file = f.filename || f.module || f.package || "unknown";
        console.log(`  at ${f.function || "?"} (${file}:${f.lineNo || f.lineno || "?"})`);
      });
    }
  });
}

async function getEventDetails(issueId) {
  console.log(`\nFetching details for issue: ${issueId}...`);
  const event = await request(`/api/0/issues/${issueId}/events/latest/`);
  console.log(`\n=== Issue Event [${event.id || event.eventID}] ===`);
  console.log(`Title:    ${event.title || event.message}`);
  console.log(`Platform: ${event.platform} | Release: ${event.release ? (event.release.version || event.release) : "N/A"}`);

  const entries = event.entries || [];
  printException(entries.find((e) => e.type === "exception"));

  const threads = entries.find((e) => e.type === "threads");
  if (threads && threads.data && threads.data.values) {
    const crashed = threads.data.values.filter((t) => t.crashed);
    if (crashed.length > 0) {
      console.log(`\n--- Crashed Threads (${crashed.length}) ---`);
      crashed.forEach((t) => {
        console.log(`Thread #${t.id} (${t.name || "unnamed"}):`);
        if (t.stacktrace && t.stacktrace.frames) {
          t.stacktrace.frames.slice(-10).forEach((f) => {
            console.log(`  at ${f.function || "?"} (${f.filename || f.package}:${f.lineNo || "?"})`);
          });
        }
      });
    }
  }

  const breadcrumbs = entries.find((e) => e.type === "breadcrumbs");
  if (breadcrumbs && breadcrumbs.data && breadcrumbs.data.values) {
    console.log("\n--- Last 8 Breadcrumbs ---");
    breadcrumbs.data.values.slice(-8).forEach((b) => {
      console.log(`[${b.category || "general"}] ${b.message || JSON.stringify(b.data || {})}`);
    });
  }
  console.log("");
}

async function resolveIssue(issueId) {
  console.log(`Resolving issue ${issueId}...`);
  await request(`/api/0/issues/${issueId}/`, "PUT", { status: "resolved" });
  console.log(`✅ Successfully marked issue ${issueId} as RESOLVED in Sentry.`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "list";

  try {
    if (command === "list") {
      await listIssues(args[1] || "is:unresolved");
    } else if (command === "resolve") {
      if (!args[1]) throw new Error("Usage: npm run sentry resolve <issue_id>");
      await resolveIssue(args[1]);
    } else if (command === "test") {
      const org = await getOrgSlug();
      const projects = await request(`/api/0/organizations/${org}/projects/`);
      console.log(`✅ Authenticated with org "${org}". Projects: ${projects.map((p) => p.slug).join(", ")}`);
    } else {
      await getEventDetails(command);
    }
  } catch (err) {
    console.error(`❌ Sentry CLI Error: ${err.message}`);
    process.exit(1);
  }
}

main();
