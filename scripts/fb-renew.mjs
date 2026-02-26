/**
 * Facebook Marketplace Listing Renewer (Multi-User)
 *
 * Renews existing posted listings to bump them back to the top of Marketplace.
 * Navigates to your active listings page and clicks "Renew" on each one.
 *
 * Usage:
 *   npm run renew                        # Renew for all active users
 *   npm run renew -- --user-id UUID      # Renew for a specific user
 *
 * Prerequisites:
 *   1. Run `npm run fb-login -- --user-id UUID` first to set up session
 *   2. Have vehicles with fb_status = "posted" in Supabase
 */

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { setTimeout as sleep } from "timers/promises";

// ── Config ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_SESSION_DIR = join(__dirname, "..", ".fb-sessions");
const LEGACY_SESSION_DIR = join(__dirname, "..", ".fb-session");
const ENV_PATH = join(__dirname, "..", ".env.local");

const MIN_DELAY_MS = 3 * 60 * 1000; // 3 minutes between renewals
const MAX_DELAY_MS = 6 * 60 * 1000; // 6 minutes between renewals
const POSTING_START_HOUR = 7;
const POSTING_END_HOUR = 14;

// ── Parse CLI args ──
const args = process.argv.slice(2);
let targetUserId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--user-id" && args[i + 1]) {
    targetUserId = args[i + 1];
    i++;
  }
}

// ── Load env ──
function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    console.error("ERROR: .env.local not found");
    process.exit(1);
  }
  const content = readFileSync(ENV_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Helpers ──
function randomDelay() {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
}

function getSessionDir(userId) {
  if (userId) {
    const dir = join(BASE_SESSION_DIR, userId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
  return LEGACY_SESSION_DIR;
}

function isWithinPostingHours() {
  const now = new Date();
  const mt = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
  const hour = mt.getHours();
  return hour >= POSTING_START_HOUR && hour < POSTING_END_HOUR;
}

async function dismissPopups(page) {
  let dismissed = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    let found = false;
    try {
      const closeSelectors = [
        '[aria-label="Close"]',
        '[aria-label="close"]',
        'div[role="dialog"] [aria-label="Close"]',
        '[aria-label="Dismiss"]',
      ];
      for (const sel of closeSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0 && await btn.isVisible()) {
          await btn.click();
          dismissed++;
          log(`  Dismissed popup #${dismissed}`);
          await sleep(800);
          found = true;
          break;
        }
      }
      if (!found) {
        await page.keyboard.press("Escape");
        await sleep(300);
        break;
      }
    } catch {
      break;
    }
  }
  return dismissed > 0;
}

async function getPostedVehicles(userId) {
  const query = supabase
    .from("vehicles")
    .select("*")
    .eq("fb_status", "posted")
    .order("fb_posted_at", { ascending: true }); // oldest first

  if (userId) query.eq("queued_by", userId);

  const { data, error } = await query;

  if (error) {
    log(`ERROR fetching posted vehicles: ${error.message}`);
    return [];
  }
  return data || [];
}

async function getActiveUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_active")
    .eq("is_active", true);

  if (error) {
    log(`ERROR fetching users: ${error.message}`);
    return [];
  }
  return data || [];
}

async function getUserProfile(userId) {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
}

async function logActivity(vehicleId, action, userId, details = null) {
  const row = { vehicle_id: vehicleId, action, details };
  if (userId) row.user_id = userId;
  await supabase.from("posting_log").insert(row);
}

// ── Renew a single listing ──
async function renewListing(page, vehicle) {
  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ""}`.trim();
  log(`Renewing: ${title}`);

  try {
    await page.goto("https://www.facebook.com/marketplace/you/selling", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(3000 + Math.random() * 1000);
    await dismissPopups(page);

    const searchTerms = [
      `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      `${vehicle.year} ${vehicle.make}`,
    ];

    let listingCard = null;
    for (const term of searchTerms) {
      const card = page.locator(`a:has-text("${term}")`).first();
      if (await card.count() > 0 && await card.isVisible()) {
        listingCard = card;
        log(`  Found listing card matching: "${term}"`);
        break;
      }
    }

    if (!listingCard) {
      for (let scroll = 0; scroll < 5; scroll++) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await sleep(1000);
        for (const term of searchTerms) {
          const card = page.locator(`a:has-text("${term}")`).first();
          if (await card.count() > 0 && await card.isVisible()) {
            listingCard = card;
            log(`  Found listing card after scroll: "${term}"`);
            break;
          }
        }
        if (listingCard) break;
      }
    }

    if (!listingCard) {
      log(`  Could not find listing for ${title} — may already be expired or removed`);
      return { success: false, error: "Listing not found" };
    }

    await listingCard.click();
    await sleep(3000);
    await dismissPopups(page);

    const renewSelectors = [
      'text=/Renew/i',
      '[aria-label*="enew"]',
      'text=/Renew listing/i',
      'text=/Renew Listing/i',
    ];

    let renewed = false;
    for (const sel of renewSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible()) {
        await btn.click();
        log(`  Clicked Renew!`);
        renewed = true;
        await sleep(3000);
        break;
      }
    }

    if (!renewed) {
      const menuSelectors = [
        '[aria-label="More"]',
        '[aria-label="more"]',
        '[aria-label="Manage"]',
        '[aria-label="manage"]',
        'text=/Manage listing/i',
      ];
      for (const sel of menuSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0 && await btn.isVisible()) {
          await btn.click();
          log(`  Opened menu via: ${sel}`);
          await sleep(1500);

          for (const renewSel of renewSelectors) {
            const renewBtn = page.locator(renewSel).first();
            if (await renewBtn.count() > 0 && await renewBtn.isVisible()) {
              await renewBtn.click();
              log(`  Clicked Renew from menu!`);
              renewed = true;
              await sleep(3000);
              break;
            }
          }
          if (renewed) break;
        }
      }
    }

    if (!renewed) {
      log(`  Could not find Renew button for ${title}`);
      await page.screenshot({
        path: join(__dirname, `renew_failed_${vehicle.vin || "unknown"}.png`),
        fullPage: true,
      });
      return { success: false, error: "Renew button not found" };
    }

    await dismissPopups(page);

    log(`  SUCCESS: ${title} renewed!`);
    return { success: true };
  } catch (err) {
    log(`  FAILED: ${err.message}`);
    try {
      await page.screenshot({
        path: join(__dirname, `renew_error_${vehicle.vin || "unknown"}.png`),
        fullPage: true,
      });
    } catch {}
    return { success: false, error: err.message };
  }
}

// ── Process renewals for a single user ──
async function processUserRenewals(userProfile) {
  const userId = userProfile.id;
  const userName = userProfile.full_name;
  const sessionDir = getSessionDir(userId);

  log(`══════ Renewing for: ${userName} ══════`);

  if (!existsSync(sessionDir)) {
    log(`  No Facebook session found for ${userName}. Skipping.`);
    return 0;
  }

  const posted = await getPostedVehicles(userId);
  log(`  Posted listings found: ${posted.length}`);

  if (posted.length === 0) {
    log(`  No posted listings to renew for ${userName}.`);
    return 0;
  }

  let renewed = 0;
  for (let i = 0; i < posted.length; i++) {
    const vehicle = posted[i];
    const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

    log(`═══ Listing ${i + 1}/${posted.length}: ${title} ═══`);

    if (!isWithinPostingHours()) {
      log("Outside posting hours — stopping. Remaining listings will renew tomorrow.");
      break;
    }

    // Launch browser for each listing (avoids session issues)
    log("  Launching browser...");
    const context = await chromium.launchPersistentContext(sessionDir, {
      headless: false,
      viewport: null,
      args: ["--start-maximized"],
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/Denver",
    });

    const page = context.pages()[0] || (await context.newPage());

    const result = await renewListing(page, vehicle);

    log("  Closing browser...");
    await context.close();

    if (result.success) {
      await logActivity(vehicle.id, "renewed", userId);
      renewed++;
    } else {
      await logActivity(vehicle.id, "renew_failed", userId, result.error);
    }

    // Delay before next renewal
    if (i < posted.length - 1) {
      const delayMs = randomDelay();
      const delayMin = Math.round(delayMs / 60000);
      log(`Waiting ${delayMin} minutes before next renewal...`);
      console.log("");
      await sleep(delayMs);
    }
  }

  return renewed;
}

// ── Main ──
async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║    FB Marketplace Listing Renewer (Multi-User)    ║");
  console.log("║    Posting hours: 7AM - 2PM Mountain Time         ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║    Press Ctrl+C to stop at any time               ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");

  // Check posting hours
  if (!isWithinPostingHours()) {
    const now = new Date();
    const mt = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
    log(`Outside posting hours (7AM-2PM MT). Currently ${mt.toLocaleTimeString()}. Exiting.`);
    process.exit(0);
  }

  let totalRenewed = 0;

  if (targetUserId) {
    const profile = await getUserProfile(targetUserId);
    if (!profile) {
      log(`ERROR: User ${targetUserId} not found.`);
      process.exit(1);
    }
    totalRenewed = await processUserRenewals(profile);
  } else {
    const activeUsers = await getActiveUsers();
    log(`Found ${activeUsers.length} active users`);

    for (const u of activeUsers) {
      try {
        const renewed = await processUserRenewals(u);
        totalRenewed += renewed;
      } catch (err) {
        log(`ERROR renewing for ${u.full_name}: ${err.message}`);
      }
    }
  }

  console.log("");
  log("════════════════════════════════════════");
  log(`Renewal complete: ${totalRenewed} listing(s) renewed`);
  log("════════════════════════════════════════");

  // Log bulk renewal activity
  if (totalRenewed > 0) {
    await logActivity(null, "bulk_renewal", targetUserId, `Renewed ${totalRenewed} listing(s)`);
  }
}

process.on("SIGINT", () => {
  log("\nStopping renewer (Ctrl+C)...");
  process.exit(0);
});

main().catch((err) => {
  console.error("Renewer error:", err);
  process.exit(1);
});
