const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !applePassword || !teamId) {
    console.log("\n  ⚠️ Apple Notarization Skipped: Missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID.");
    console.log("  To produce an Apple-verified build, add these credentials to your environment or GitHub Secrets.\n");
    return;
  }

  console.log(`\n  🔐 Submitting ${appName}.app to Apple Notary Service via notarytool...`);

  try {
    // 1. Try @electron/notarize if available
    let notarizeModule;
    try {
      notarizeModule = require("@electron/notarize");
    } catch {
      // Fallback: check if packager has it
      try {
        notarizeModule = require(path.join(context.packager.info.appDir, "node_modules/@electron/notarize"));
      } catch {}
    }

    if (notarizeModule && typeof notarizeModule.notarize === "function") {
      await notarizeModule.notarize({
        appBundleId: "com.jvondev.apposition.app",
        appPath,
        appleId,
        appleIdPassword: applePassword,
        teamId,
      });
      console.log(`  ✓ Apple Notarization succeeded via @electron/notarize!`);
      return;
    }

    // 2. Direct xcrun notarytool fallback (Standard on all macOS runners)
    console.log("  Using xcrun notarytool...");
    const zipPath = path.join(appOutDir, `${appName}-notarize.zip`);
    execSync(`/usr/bin/ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: "inherit" });

    const submitCmd = `xcrun notarytool submit "${zipPath}" --apple-id "${appleId}" --password "${applePassword}" --team-id "${teamId}" --wait`;
    execSync(submitCmd, { stdio: "inherit" });

    // Staple ticket to .app
    console.log("  Stapling notarization ticket to .app bundle...");
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: "inherit" });

    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    console.log(`  ✓ Apple Notarization complete and stapled!`);
  } catch (err) {
    console.error("  ❌ Apple Notarization failed:", err.message);
    // Don't fail the entire packaging if notarization encounters network timeout, but log clearly
    if (process.env.REQUIRE_NOTARIZATION === "true") {
      throw err;
    }
  }
};
