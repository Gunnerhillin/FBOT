/**
 * Facebook Login Setup Script (Multi-User)
 *
 * Opens a real Chromium browser so a user can manually log into Facebook.
 * Session is saved per-user in .fb-sessions/{user-id}/ directory.
 *
 * Usage:
 *   npm run fb-login -- --user-id UUID    # Set up a specific user's session
 *   npm run fb-login                      # Legacy single-user mode
 *
 * You only need to do this once per user (or again if their session expires).
 */

import { chromium } from "playwright";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_SESSION_DIR = join(__dirname, "..", ".fb-sessions");
const LEGACY_SESSION_DIR = join(__dirname, "..", ".fb-session");

// Parse CLI args
const args = process.argv.slice(2);
let userId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--user-id" && args[i + 1]) {
    userId = args[i + 1];
    i++;
  }
}

// Determine session directory
let SESSION_DIR;
if (userId) {
  SESSION_DIR = join(BASE_SESSION_DIR, userId);
} else {
  SESSION_DIR = LEGACY_SESSION_DIR;
}

// Ensure session directory exists
if (!existsSync(SESSION_DIR)) {
  mkdirSync(SESSION_DIR, { recursive: true });
}

console.log("");
console.log("╔══════════════════════════════════════════════════╗");
console.log("║        Facebook Login Setup                      ║");
console.log("╠══════════════════════════════════════════════════╣");
if (userId) {
  console.log(`║  User ID: ${userId.slice(0, 20)}...          ║`);
} else {
  console.log("║  Legacy single-user mode                        ║");
}
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

  await page.goto("https://www.facebook.com/marketplace/create/vehicle", {
    waitUntil: "domcontentloaded",
  });

  console.log("Browser opened. Please log in to Facebook.");
  console.log("Close the browser window when done.\n");

  await new Promise((resolve) => {
    context.on("close", resolve);
  });

  if (userId) {
    console.log(`Session saved for user ${userId}`);
    console.log(`Run poster: npm run poster -- --user-id ${userId}`);
  } else {
    console.log("Session saved to .fb-session/");
    console.log("You can now run: npm run poster");
  }
  console.log("");
}

main().catch((err) => {
  console.error("Login setup failed:", err.message);
  process.exit(1);
});
