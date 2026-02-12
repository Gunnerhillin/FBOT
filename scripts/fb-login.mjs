/**
 * Facebook Login Setup Script
 *
 * Opens a real Chromium browser so you can manually log into Facebook.
 * Your session is saved to .fb-session/ directory for the poster to reuse.
 *
 * Usage: npm run fb-login
 *
 * You only need to do this once (or again if your session expires).
 */

import { chromium } from "playwright";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = join(__dirname, "..", ".fb-session");

// Ensure session directory exists
if (!existsSync(SESSION_DIR)) {
  mkdirSync(SESSION_DIR, { recursive: true });
}

console.log("");
console.log("╔══════════════════════════════════════════════════╗");
console.log("║        Facebook Login Setup                      ║");
console.log("╠══════════════════════════════════════════════════╣");
console.log("║  A browser window will open.                     ║");
console.log("║  Log into your Facebook account.                 ║");
console.log("║  Once logged in, close the browser window.       ║");
console.log("║  Your session will be saved automatically.       ║");
console.log("╚══════════════════════════════════════════════════╝");
console.log("");

async function main() {
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/Denver",
  });

  const page = context.pages()[0] || (await context.newPage());

  // Navigate to Facebook Marketplace
  await page.goto("https://www.facebook.com/marketplace/create/vehicle", {
    waitUntil: "domcontentloaded",
  });

  console.log("Browser opened. Please log in to Facebook.");
  console.log("Close the browser window when done.\n");

  // Wait for the browser to close
  await new Promise((resolve) => {
    context.on("close", resolve);
  });

  console.log("Session saved to .fb-session/");
  console.log("You can now run: npm run poster");
  console.log("");
}

main().catch((err) => {
  console.error("Login setup failed:", err.message);
  process.exit(1);
});
