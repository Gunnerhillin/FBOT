/**
 * Facebook Marketplace Auto-Poster (Multi-User)
 *
 * Posts queued vehicles to Facebook Marketplace using Playwright.
 * Supports multiple salespeople, each with their own FB session and daily limit.
 *
 * Features:
 *   - Multi-user support with per-user FB sessions & daily limits
 *   - Posting hours enforcement (7AM - 2PM Mountain Time)
 *   - Failed post auto-retry (up to 2 retries)
 *   - Duplicate prevention (checks posting_log)
 *   - Stale listing refresh (re-lists after 3 days)
 *   - Description rotation to avoid FB duplicate content flags
 *   - Sold vehicle cleanup (removes listings for deleted vehicles)
 *   - Daily summary report with stats
 *
 * Usage:
 *   npm run poster                       # Process all active users
 *   npm run poster -- --user-id UUID     # Process a specific user only
 *
 * Prerequisites:
 *   1. Run `npm run fb-login -- --user-id UUID` for each user's Facebook session
 *   2. Run the SQL migrations in Supabase
 *   3. Queue vehicles for posting from the UI
 */

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { setTimeout as sleep } from "timers/promises";
import { createServer } from "http";

// ── Config ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_SESSION_DIR = join(__dirname, "..", ".fb-sessions");
const LEGACY_SESSION_DIR = join(__dirname, "..", ".fb-session");
const ENV_PATH = join(__dirname, "..", ".env.local");

const DEFAULT_MAX_POSTS_PER_DAY = 27;
const MIN_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_DELAY_MS = 15 * 60 * 1000; // 15 minutes
const POSTING_START_HOUR = 7;  // 7 AM Mountain Time
const POSTING_END_HOUR = 14;   // 2 PM Mountain Time
const MAX_RETRIES = 2;         // Max retry attempts for failed posts
const STALE_DAYS = 3;          // Re-list after this many days

// ── Railway / headless detection ──
const IS_RAILWAY = !!(process.env.RAILWAY_HEADLESS || process.env.RAILWAY_ENVIRONMENT);

/**
 * Get browser launch options. On Railway, runs headless with stealth args.
 * Locally, runs with a visible browser window.
 */
function getBrowserOptions(sessionDir, opts = {}) {
  const baseArgs = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
  ];

  if (IS_RAILWAY) {
    return {
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: baseArgs,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/Denver",
      ...opts,
    };
  }

  return {
    headless: false,
    viewport: opts.viewport || null,
    args: opts.maximized ? ["--start-maximized", ...baseArgs] : baseArgs,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/Denver",
    ...opts,
  };
}

/**
 * Apply stealth patches to a page to avoid bot detection.
 */
async function applyStealthPatches(page) {
  await page.addInitScript(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // Override plugins to look like a real browser
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    // Override languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
    // Fix chrome object
    window.chrome = { runtime: {} };
    // Fix permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });
}

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
  // On Railway, env vars are set directly — no .env.local needed
  if (IS_RAILWAY) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
      process.exit(1);
    }
    return;
  }
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

// Early startup log so Railway shows SOMETHING
console.log("[STARTUP] FB Poster starting...");
console.log(`[STARTUP] IS_RAILWAY=${IS_RAILWAY}`);
console.log(`[STARTUP] SUPABASE_URL set: ${!!process.env.SUPABASE_URL}`);
console.log(`[STARTUP] SUPABASE_SERVICE_ROLE_KEY set: ${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`);

loadEnv();

console.log("[STARTUP] Env loaded, creating Supabase client...");

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
  // Multi-user: each user gets their own session directory
  if (userId) {
    const dir = join(BASE_SESSION_DIR, userId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
  // Fallback to legacy single-user session
  return LEGACY_SESSION_DIR;
}

/**
 * Check if current time is within posting hours (Mountain Time).
 */
function isWithinPostingHours() {
  const now = new Date();
  const mt = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
  const hour = mt.getHours();
  return hour >= POSTING_START_HOUR && hour < POSTING_END_HOUR;
}

/**
 * Wait until posting hours begin. Checks every 5 minutes.
 */
async function waitForPostingHours() {
  while (!isWithinPostingHours()) {
    const now = new Date();
    const mt = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
    const hour = mt.getHours();
    if (hour >= POSTING_END_HOUR) {
      log("Past posting hours for today (after 2 PM MT). Exiting.");
      process.exit(0);
    }
    log(`Outside posting hours (${POSTING_START_HOUR}AM-${POSTING_END_HOUR > 12 ? POSTING_END_HOUR - 12 + "PM" : POSTING_END_HOUR + "AM"} MT). Currently ${mt.toLocaleTimeString()}. Waiting...`);
    await sleep(5 * 60 * 1000);
  }
}

async function getDailyCount(userId) {
  const today = new Date().toISOString().split("T")[0];
  const query = supabase
    .from("posting_daily_count")
    .select("count")
    .eq("date", today);

  if (userId) query.eq("user_id", userId);

  const { data } = await query.single();
  return data?.count || 0;
}

async function incrementDailyCount(userId) {
  const today = new Date().toISOString().split("T")[0];

  const query = supabase
    .from("posting_daily_count")
    .select("count")
    .eq("date", today);

  if (userId) query.eq("user_id", userId);

  const { data: existing } = await query.single();

  if (existing) {
    const updateQuery = supabase
      .from("posting_daily_count")
      .update({ count: existing.count + 1, last_post_at: new Date().toISOString() })
      .eq("date", today);
    if (userId) updateQuery.eq("user_id", userId);
    await updateQuery;
  } else {
    const row = { date: today, count: 1, last_post_at: new Date().toISOString() };
    if (userId) row.user_id = userId;
    await supabase.from("posting_daily_count").insert(row);
  }
}

async function logActivity(vehicleId, action, userId, details = null) {
  const row = { vehicle_id: vehicleId, action, details };
  if (userId) row.user_id = userId;
  await supabase.from("posting_log").insert(row);
}

async function getQueuedVehicles(userId) {
  const query = supabase
    .from("vehicles")
    .select("*")
    .eq("fb_status", "queued")
    .order("fb_queued_at", { ascending: true });

  if (userId) query.eq("queued_by", userId);

  const { data, error } = await query;
  if (error) {
    log(`ERROR fetching queue: ${error.message}`);
    return [];
  }
  return data || [];
}

async function getActiveUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, daily_post_limit, is_active")
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

async function updateVehicleStatus(id, status, listingUrl = null) {
  const update = { fb_status: status };
  if (status === "posted") {
    update.fb_posted_at = new Date().toISOString();
    if (listingUrl) update.fb_listing_url = listingUrl;
  }
  await supabase.from("vehicles").update(update).eq("id", id);
}

// ── Dismiss popups helper ──
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

// ── Feature: Description rotation ──
// Shuffles description sentences to avoid FB duplicate content flags
function rotateDescription(description) {
  if (!description) return description;

  const sentences = description.split(/(?<=[.!?])\s+/).filter(s => s.trim());
  if (sentences.length <= 2) return description;

  // Keep first sentence (hook) and last sentence (CTA)
  const hook = sentences[0];
  const cta = sentences[sentences.length - 1];
  const middle = sentences.slice(1, -1);

  // Shuffle middle sentences
  for (let i = middle.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [middle[i], middle[j]] = [middle[j], middle[i]];
  }

  // Randomly pick a lead-in variation
  const leadIns = [
    "",
    "Check out this one — ",
    "Don't miss this — ",
    "Just arrived — ",
    "Now available — ",
    "On the lot now — ",
  ];
  const leadIn = leadIns[Math.floor(Math.random() * leadIns.length)];

  return leadIn + [hook, ...middle, cta].join(" ");
}

// ── Feature: Failed post auto-retry ──
async function retryFailedPosts(userId) {
  log("════ Checking for failed posts to retry ════");

  const query = supabase
    .from("vehicles")
    .select("id, vin, year, make, model")
    .eq("fb_status", "failed");

  if (userId) query.eq("queued_by", userId);

  const { data: failed, error } = await query;

  if (error || !failed || failed.length === 0) {
    log("  No failed posts to retry.");
    return 0;
  }

  let retried = 0;
  for (const vehicle of failed) {
    const failQuery = supabase
      .from("posting_log")
      .select("id")
      .eq("vehicle_id", vehicle.id)
      .eq("action", "failed");

    if (userId) failQuery.eq("user_id", userId);

    const { data: failLogs } = await failQuery;
    const failCount = failLogs?.length || 0;

    if (failCount < MAX_RETRIES) {
      await supabase
        .from("vehicles")
        .update({ fb_status: "queued", fb_queued_at: new Date().toISOString() })
        .eq("id", vehicle.id);
      await logActivity(vehicle.id, "retry", userId, `Retry ${failCount + 1}/${MAX_RETRIES}`);
      retried++;
      log(`  Re-queued: ${vehicle.year} ${vehicle.make} ${vehicle.model} (attempt ${failCount + 1}/${MAX_RETRIES})`);
    } else {
      log(`  Skipping: ${vehicle.year} ${vehicle.make} ${vehicle.model} — max retries (${MAX_RETRIES}) reached`);
    }
  }

  if (retried > 0) {
    log(`  Re-queued ${retried} failed vehicle(s) for retry`);
  }
  return retried;
}

// ── Feature: Duplicate prevention ──
async function isDuplicateListing(vehicle, userId) {
  if (vehicle.fb_status === "posted" && vehicle.fb_listing_url) {
    log(`  DUPLICATE: ${vehicle.year} ${vehicle.make} ${vehicle.model} already has active listing`);
    return true;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const query = supabase
    .from("posting_log")
    .select("id")
    .eq("vehicle_id", vehicle.id)
    .eq("action", "posted")
    .gte("created_at", oneDayAgo);

  if (userId) query.eq("user_id", userId);

  const { data: recentPosts } = await query;

  if (recentPosts && recentPosts.length > 0) {
    log(`  DUPLICATE: ${vehicle.year} ${vehicle.make} ${vehicle.model} was posted in the last 24h`);
    return true;
  }

  return false;
}

// ── Feature: Delete FB listing ──
async function deleteFBListing(page, vehicle) {
  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  log(`  Deleting FB listing for: ${title}`);

  try {
    const searchTerms = [
      `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      `${vehicle.year} ${vehicle.make}`,
    ];

    let listingCard = null;
    for (const term of searchTerms) {
      const card = page.locator(`a:has-text("${term}")`).first();
      if (await card.count() > 0 && await card.isVisible()) {
        listingCard = card;
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
            break;
          }
        }
        if (listingCard) break;
      }
    }

    if (!listingCard) {
      log(`    Listing not found on selling page — may already be removed`);
      return false;
    }

    await listingCard.click();
    await sleep(3000);
    await dismissPopups(page);

    const menuSelectors = [
      '[aria-label="More"]',
      '[aria-label="more"]',
      '[aria-label="Manage"]',
      'text=/Manage listing/i',
      'text=/More options/i',
    ];

    for (const sel of menuSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible()) {
        await btn.click();
        await sleep(1500);
        break;
      }
    }

    const deleteSelectors = [
      'text=/Delete listing/i',
      'text=/Delete/i',
      '[aria-label*="elete"]',
    ];

    for (const sel of deleteSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible()) {
        await btn.click();
        log(`    Clicked Delete for ${title}`);
        await sleep(2000);

        const confirmBtn = page.locator('text=/Delete/i').last();
        if (await confirmBtn.count() > 0 && await confirmBtn.isVisible()) {
          await confirmBtn.click();
          await sleep(2000);
        }

        await dismissPopups(page);
        return true;
      }
    }

    log(`    Could not find Delete button for ${title}`);
    return false;
  } catch (err) {
    log(`    Error deleting listing: ${err.message}`);
    return false;
  }
}

// ── Feature: Stale listing re-list ──
async function relistStaleListings(userId) {
  log("════ Refreshing old listings to stay on top ════");

  const staleDate = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const query = supabase
    .from("vehicles")
    .select("id, vin, year, make, model, fb_posted_at, fb_listing_url")
    .eq("fb_status", "posted")
    .lt("fb_posted_at", staleDate);

  if (userId) query.eq("queued_by", userId);

  const { data: staleVehicles, error } = await query;

  if (error || !staleVehicles || staleVehicles.length === 0) {
    log(`  All listings are fresh (under ${STALE_DAYS} days old).`);
    return 0;
  }

  log(`  Found ${staleVehicles.length} listing(s) older than ${STALE_DAYS} days — refreshing`);

  const sessionDir = getSessionDir(userId);
  if (!existsSync(sessionDir)) {
    log(`  No Facebook session found. Skipping re-list.`);
    return 0;
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(sessionDir, getBrowserOptions(sessionDir, { maximized: true }));

    const page = context.pages()[0] || (await context.newPage());
    if (IS_RAILWAY) await applyStealthPatches(page);

    await page.goto("https://www.facebook.com/marketplace/you/selling", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(4000);
    await dismissPopups(page);

    // Scroll to load listings
    for (let s = 0; s < 8; s++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await sleep(1000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    let relisted = 0;
    for (const vehicle of staleVehicles) {
      const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
      log(`  Re-listing: ${title} (posted ${vehicle.fb_posted_at})`);

      try {
        const card = page.locator(`a:has-text("${vehicle.year} ${vehicle.make}")`).first();
        if (await card.count() > 0 && await card.isVisible()) {
          await card.click();
          await sleep(3000);
          await dismissPopups(page);

          const moreBtn = page.locator('[aria-label="More"], [aria-label="more"], text=/More options/i').first();
          if (await moreBtn.count() > 0 && await moreBtn.isVisible()) {
            await moreBtn.click();
            await sleep(1500);
          }

          const deleteBtn = page.locator('text=/Delete listing/i, text=/Delete$/i').first();
          if (await deleteBtn.count() > 0 && await deleteBtn.isVisible()) {
            await deleteBtn.click();
            await sleep(2000);

            const confirmBtn = page.locator('div[role="dialog"] >> text=/Delete/i').first();
            if (await confirmBtn.count() > 0 && await confirmBtn.isVisible()) {
              await confirmBtn.click();
              await sleep(2000);
            }
            await dismissPopups(page);
            log(`    Deleted old listing for ${title}`);
          }

          await page.goto("https://www.facebook.com/marketplace/you/selling", {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await sleep(3000);
        }
      } catch (err) {
        log(`    Error deleting stale listing: ${err.message}`);
        await page.goto("https://www.facebook.com/marketplace/you/selling", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await sleep(3000);
      }

      // Re-queue for fresh posting
      await supabase.from("vehicles").update({
        fb_status: "queued",
        fb_queued_at: new Date().toISOString(),
        fb_listing_url: null,
        fb_posted_at: null,
      }).eq("id", vehicle.id);

      await logActivity(vehicle.id, "relisted", userId, `Stale after ${STALE_DAYS} days, re-queued`);
      relisted++;
    }

    await context.close();

    if (relisted > 0) {
      log(`  Re-queued ${relisted} stale listing(s) for fresh posting`);
    }
    return relisted;
  } catch (err) {
    log(`  Re-list error: ${err.message}`);
    try { await context?.close(); } catch {}
    return 0;
  }
}

// ── Feature: Sold vehicle cleanup ──
async function cleanupSoldListings(userId) {
  log("════ Checking for sold vehicles to clean up ════");

  // Get all VINs currently in the database
  const { data: currentVehicles } = await supabase
    .from("vehicles")
    .select("vin");
  const activeVins = new Set((currentVehicles || []).map(v => v.vin?.toUpperCase()).filter(Boolean));

  // Check posting_log for vehicles that were posted but may now be sold
  const logQuery = supabase
    .from("posting_log")
    .select("vehicle_id, details")
    .eq("action", "posted");

  if (userId) logQuery.eq("user_id", userId);

  const { data: postedLogs } = await logQuery;

  if (!postedLogs || postedLogs.length === 0) {
    log("  No posting history found.");
    return;
  }

  const sessionDir = getSessionDir(userId);
  if (!existsSync(sessionDir)) {
    log(`  No Facebook session found. Skipping cleanup.`);
    return;
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(sessionDir, getBrowserOptions(sessionDir, { maximized: true }));

    const page = context.pages()[0] || (await context.newPage());
    if (IS_RAILWAY) await applyStealthPatches(page);

    // Go to selling page
    await page.goto("https://www.facebook.com/marketplace/you/selling", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(4000);
    await dismissPopups(page);

    // Scroll to load all listings
    for (let s = 0; s < 10; s++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await sleep(800);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    // Find all listing links on the selling page
    const listingLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll("a").forEach(a => {
        const href = a.getAttribute("href") || "";
        const text = (a.innerText || "").trim();
        if (href.includes("/marketplace/item/") && text.length > 5) {
          links.push({ href, text: text.slice(0, 80) });
        }
      });
      return links;
    });

    log(`  Found ${listingLinks.length} active FB listings`);

    // For each active listing, check if vehicle is still in DB
    let cleaned = 0;
    for (const listing of listingLinks) {
      // Extract year/make/model from listing text
      const yearMatch = listing.text.match(/(\d{4})/);
      if (!yearMatch) continue;

      // Check if any active vehicle matches this listing
      const matchesActive = (currentVehicles || []).some(v => {
        const vTitle = `${v.year} ${v.make} ${v.model}`.toLowerCase();
        return listing.text.toLowerCase().includes(vTitle.slice(0, 20));
      });

      if (!matchesActive) {
        log(`  Sold/removed: "${listing.text}" — deleting from FB`);
        try {
          const card = page.locator(`a[href*="${listing.href.split("?")[0]}"]`).first();
          if (await card.count() > 0) {
            await card.click();
            await sleep(3000);
            await dismissPopups(page);

            const moreBtn = page.locator('[aria-label="More"], [aria-label="more"]').first();
            if (await moreBtn.count() > 0 && await moreBtn.isVisible()) {
              await moreBtn.click();
              await sleep(1500);
            }

            const deleteBtn = page.locator('text=/Delete listing/i, text=/Delete$/i').first();
            if (await deleteBtn.count() > 0 && await deleteBtn.isVisible()) {
              await deleteBtn.click();
              await sleep(2000);
              const confirmBtn = page.locator('div[role="dialog"] >> text=/Delete/i').first();
              if (await confirmBtn.count() > 0 && await confirmBtn.isVisible()) {
                await confirmBtn.click();
                await sleep(2000);
              }
              cleaned++;
              log(`    Deleted listing for sold vehicle`);
            }

            await page.goto("https://www.facebook.com/marketplace/you/selling", {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
            await sleep(3000);
          }
        } catch (err) {
          log(`    Error cleaning up: ${err.message}`);
          await page.goto("https://www.facebook.com/marketplace/you/selling", {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await sleep(3000);
        }
      }
    }

    await context.close();

    if (cleaned > 0) {
      await logActivity(null, "sold_cleanup", userId, `Cleaned ${cleaned} sold vehicle listing(s)`);
      log(`  Cleaned up ${cleaned} sold vehicle listing(s)`);
    } else {
      log("  No sold vehicles to clean up.");
    }
  } catch (err) {
    log(`  Cleanup error: ${err.message}`);
    try { await context?.close(); } catch {}
  }
}

// ── Feature: Daily summary report ──
async function generateDailySummary(userId) {
  log("════ Generating daily summary ════");

  const today = new Date().toISOString().split("T")[0];

  const logQuery = supabase
    .from("posting_log")
    .select("action, details")
    .gte("created_at", `${today}T00:00:00`)
    .lte("created_at", `${today}T23:59:59`);

  if (userId) logQuery.eq("user_id", userId);

  const { data: todayLogs } = await logQuery;
  const logs = todayLogs || [];

  const posted = logs.filter(l => l.action === "posted").length;
  const failed = logs.filter(l => l.action === "failed").length;
  const retried = logs.filter(l => l.action === "retry").length;
  const renewed = logs.filter(l => l.action === "bulk_renewal")
    .reduce((sum, l) => sum + (parseInt(l.details?.match(/\d+/)?.[0]) || 0), 0);
  const replied = logs.filter(l => l.action === "auto_reply")
    .reduce((sum, l) => sum + (parseInt(l.details?.match(/\d+/)?.[0]) || 0), 0);
  const soldCleanup = logs.filter(l => l.action === "sold_cleanup")
    .reduce((sum, l) => sum + (parseInt(l.details?.match(/\d+/)?.[0]) || 0), 0);
  const relisted = logs.filter(l => l.action === "relisted").length;

  const { data: queueData } = await supabase
    .from("vehicles")
    .select("fb_status");
  const vehicles = queueData || [];
  const queued = vehicles.filter(v => v.fb_status === "queued").length;
  const activeListings = vehicles.filter(v => v.fb_status === "posted").length;
  const failedCount = vehicles.filter(v => v.fb_status === "failed").length;

  const summary = [
    "",
    "══════════════════════════════════════════════════",
    `  DAILY SUMMARY - ${today}`,
    "══════════════════════════════════════════════════",
    `  Posted:          ${posted}`,
    `  Failed:          ${failed}`,
    `  Retried:         ${retried}`,
    `  Renewed:         ${renewed}`,
    `  Auto-replies:    ${replied}`,
    `  Sold cleanup:    ${soldCleanup}`,
    `  Re-listed stale: ${relisted}`,
    "──────────────────────────────────────────────────",
    `  INVENTORY STATUS:`,
    `  Active listings: ${activeListings}`,
    `  In queue:        ${queued}`,
    `  Failed:          ${failedCount}`,
    "══════════════════════════════════════════════════",
    "",
  ];

  for (const line of summary) {
    console.log(line);
  }

  await supabase.from("posting_log").insert({
    vehicle_id: null,
    action: "daily_summary",
    user_id: userId || null,
    details: JSON.stringify({ posted, failed, retried, renewed, replied, soldCleanup, relisted, activeListings, queued }),
  });

  const summaryPath = join(__dirname, `summary_${today}.txt`);
  writeFileSync(summaryPath, summary.join("\n"));
  log(`  Summary saved to: ${summaryPath}`);
}

// ── Helpers for robust form interaction ──

async function findField(page, fieldName, extraSelectors = []) {
  const selectors = [
    `[aria-label="${fieldName}"]`,
    `[aria-label="${fieldName}" i]`,
    `input[placeholder="${fieldName}"]`,
    `input[placeholder="${fieldName}" i]`,
    `textarea[placeholder="${fieldName}"]`,
    `[data-testid*="${fieldName.toLowerCase()}"]`,
    ...extraSelectors,
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        log(`    Found "${fieldName}" via: ${sel}`);
        return el;
      }
    } catch {}
  }

  try {
    const byLabel = page.getByLabel(fieldName, { exact: false }).first();
    if (await byLabel.count() > 0 && await byLabel.isVisible()) {
      log(`    Found "${fieldName}" via getByLabel`);
      return byLabel;
    }
  } catch {}

  try {
    const byPlaceholder = page.getByPlaceholder(fieldName, { exact: false }).first();
    if (await byPlaceholder.count() > 0 && await byPlaceholder.isVisible()) {
      log(`    Found "${fieldName}" via getByPlaceholder`);
      return byPlaceholder;
    }
  } catch {}

  log(`    WARNING: Could not find field "${fieldName}"`);
  return null;
}

async function humanType(page, text) {
  for (const char of text) {
    await page.keyboard.type(char, { delay: 30 + Math.random() * 50 });
  }
}

async function fillDropdown(page, fieldName, value, extraSelectors = []) {
  log(`  Filling ${fieldName}...`);
  const field = await findField(page, fieldName, extraSelectors);
  if (!field) return false;

  try {
    await field.click();
    await sleep(300);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await sleep(200);
    await humanType(page, value);
    await sleep(1200);

    const option = page.locator(`[role="option"]:has-text("${value}")`).first();
    if (await option.count() > 0) {
      await option.click();
      log(`    Selected dropdown option for "${value}"`);
    } else {
      const listItem = page.locator(`[role="listbox"] >> text="${value}"`).first();
      if (await listItem.count() > 0) {
        await listItem.click();
        log(`    Selected listbox item for "${value}"`);
      } else {
        await page.keyboard.press("ArrowDown");
        await sleep(200);
        await page.keyboard.press("Enter");
        log(`    Used keyboard to select first suggestion for "${value}"`);
      }
    }
    await sleep(500);
    return true;
  } catch (err) {
    log(`    Error filling ${fieldName}: ${err.message}`);
    return false;
  }
}

async function fillTextField(page, fieldName, value, extraSelectors = []) {
  log(`  Filling ${fieldName}...`);
  const field = await findField(page, fieldName, extraSelectors);
  if (!field) return false;

  try {
    await field.click();
    await sleep(200);
    await field.fill(String(value));
    await sleep(300);
    return true;
  } catch (err) {
    log(`    Error filling ${fieldName}: ${err.message}`);
    return false;
  }
}

// ── Facebook Marketplace Posting ──
async function postVehicleToMarketplace(page, vehicle) {
  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ""}`.trim();
  log(`Posting: ${title} (VIN: ${vehicle.vin})`);

  try {
    await page.goto("https://www.facebook.com/marketplace/create/vehicle", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(3000 + Math.random() * 1000);

    // Upload Photos
    if (vehicle.photos && vehicle.photos.length > 0) {
      const photoCount = Math.min(vehicle.photos.length, 20);
      log(`  Downloading ${photoCount} photos...`);

      const tempPaths = [];

      const downloads = vehicle.photos.slice(0, 20).map(async (url, i) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return null;
          const buffer = Buffer.from(await response.arrayBuffer());
          const tempPath = join(__dirname, `temp_photo_${i}.jpg`);
          writeFileSync(tempPath, buffer);
          return tempPath;
        } catch {
          return null;
        }
      });
      const results = await Promise.all(downloads);
      for (const p of results) {
        if (p) tempPaths.push(p);
      }

      if (tempPaths.length > 0) {
        log(`  Uploading ${tempPaths.length} photos in batch...`);
        const fileInput = page.locator('input[type="file"][accept*="image"]').first();
        await fileInput.setInputFiles(tempPaths);
        await sleep(3000 + tempPaths.length * 300);

        for (const p of tempPaths) {
          try { unlinkSync(p); } catch {}
        }
      }
      log(`  Photos uploaded`);
    }

    // Fill Vehicle Details
    const bodyToType = {
      "4D Sport Utility": "SUV/Crossover", "Sport Utility": "SUV/Crossover", "SUV": "SUV/Crossover",
      "4D Crew Cab": "Truck", "Crew Cab": "Truck", "Regular Cab": "Truck", "Extended Cab": "Truck",
      "4D Sedan": "Sedan", "Sedan": "Sedan",
      "4D Hatchback": "Hatchback", "Hatchback": "Hatchback",
      "2D Coupe": "Coupe", "Coupe": "Coupe",
      "4D Passenger Van": "Van/Minivan", "Van": "Van/Minivan", "Minivan": "Van/Minivan",
      "Convertible": "Convertible", "Wagon": "Wagon",
    };
    let vehicleType = "Car/Truck";
    if (vehicle.body) {
      for (const [key, val] of Object.entries(bodyToType)) {
        if (vehicle.body.toLowerCase().includes(key.toLowerCase())) {
          vehicleType = val;
          break;
        }
      }
    }
    await fillDropdown(page, "Vehicle type", vehicleType, ['[aria-label="Vehicle type"]', '[aria-label="Type"]', '[aria-label="Category"]']);
    await fillDropdown(page, "Year", String(vehicle.year));
    await fillDropdown(page, "Make", vehicle.make);
    await fillDropdown(page, "Model", vehicle.model);
    if (vehicle.trim) await fillDropdown(page, "Trim", vehicle.trim);
    await fillTextField(page, "Price", vehicle.price || 0);
    if (vehicle.mileage) await fillTextField(page, "Mileage", vehicle.mileage);

    // Use rotated description to avoid duplicate content flags
    const description = rotateDescription(vehicle.description_a);
    if (description) {
      log("  Filling description (rotated)...");
      const descField = await findField(page, "Description", [
        'textarea[aria-label*="escription"]',
        '[role="textbox"][aria-label*="escription"]',
      ]);
      if (descField) {
        await descField.click();
        await sleep(300);
        await descField.fill(description);
        await sleep(500);
      }
    }

    await fillDropdown(page, "Location", "St. George, UT", ['[aria-label*="ocation"]']);
    if (vehicle.vin) await fillTextField(page, "VIN", vehicle.vin, ['input[aria-label*="VIN"]', 'input[aria-label*="vin"]']);
    await fillDropdown(page, "Transmission", "Automatic", ['[aria-label*="ransmission"]']);
    await fillDropdown(page, "Fuel type", "Gasoline", ['[aria-label*="uel"]']);
    await fillDropdown(page, "Vehicle condition", "Used - Good", ['[aria-label*="ondition"]', '[aria-label="Condition"]']);

    await sleep(2000);

    const screenshotPath = join(__dirname, `last_post_${vehicle.vin || "unknown"}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Click Next / Publish
    log("  Looking for Next/Publish button...");
    const nextBtn = page.locator('[aria-label="Next"]').first();
    if (await nextBtn.count() > 0 && await nextBtn.isVisible()) {
      await nextBtn.click();
      log("  Clicked Next");
      await sleep(3000);
    } else {
      const nextText = page.getByRole("button", { name: "Next" }).first();
      if (await nextText.count() > 0) {
        await nextText.click();
        log("  Clicked Next (text match)");
        await sleep(3000);
      }
    }

    const publishBtn = page.locator('[aria-label="Publish"]').first();
    if (await publishBtn.count() > 0 && await publishBtn.isVisible()) {
      await publishBtn.click();
      log("  Clicked Publish!");
      await sleep(5000);
    } else {
      const publishText = page.getByRole("button", { name: "Publish" }).first();
      if (await publishText.count() > 0) {
        await publishText.click();
        log("  Clicked Publish (text match)!");
        await sleep(5000);
      } else {
        log("  WARNING: Could not find Publish button. Check screenshot.");
        return { success: false, error: "Publish button not found" };
      }
    }

    const currentUrl = page.url();
    const listingUrl = currentUrl.includes("marketplace") ? currentUrl : null;
    log(`  SUCCESS: ${title} posted!`);
    return { success: true, listingUrl };
  } catch (err) {
    log(`  FAILED: ${err.message}`);
    try {
      await page.screenshot({
        path: join(__dirname, `error_${vehicle.vin || "unknown"}.png`),
        fullPage: true,
      });
    } catch {}
    return { success: false, error: err.message };
  }
}

// ── Process a single user's queue ──
async function processUser(userProfile) {
  const userId = userProfile.id;
  const userName = userProfile.full_name;
  const maxPosts = userProfile.daily_post_limit || DEFAULT_MAX_POSTS_PER_DAY;
  const sessionDir = getSessionDir(userId);

  console.log("");
  log(`══════ Processing: ${userName} ══════`);

  // Check session exists
  if (!existsSync(sessionDir)) {
    log(`  No Facebook session found for ${userName}.`);
    log(`  Run: npm run fb-login -- --user-id ${userId}`);
    return { posted: 0, failed: 0, skipped: true };
  }

  // Run pre-posting tasks for this user
  await retryFailedPosts(userId);

  // Check daily count
  const todayCount = await getDailyCount(userId);
  log(`  Daily posts: ${todayCount}/${maxPosts}`);

  if (todayCount >= maxPosts) {
    log(`  Daily limit reached for ${userName}. Skipping.`);
    return { posted: 0, failed: 0, skipped: true };
  }

  // Get queued vehicles for this user
  const queue = await getQueuedVehicles(userId);
  log(`  Vehicles in queue: ${queue.length}`);

  if (queue.length === 0) {
    log(`  No vehicles queued for ${userName}.`);
    return { posted: 0, failed: 0, skipped: false };
  }

  const remaining = maxPosts - todayCount;
  const toPost = queue.slice(0, remaining);
  log(`  Will post ${toPost.length} vehicles (${remaining} slots remaining)`);

  // Launch browser with user's session
  log(`  Launching browser for ${userName}${IS_RAILWAY ? " (headless)" : ""}...`);
  const context = await chromium.launchPersistentContext(sessionDir, getBrowserOptions(sessionDir, { viewport: { width: 1280, height: 900 } }));

  const page = context.pages()[0] || (await context.newPage());
  if (IS_RAILWAY) await applyStealthPatches(page);

  // Verify Facebook login
  log(`  Checking Facebook login for ${userName}...`);
  await page.goto("https://www.facebook.com/marketplace", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(3000);

  const loginCheck = page.url();
  if (loginCheck.includes("login") || loginCheck.includes("checkpoint")) {
    log(`  ERROR: ${userName} not logged into Facebook.`);
    log(`  Run: npm run fb-login -- --user-id ${userId}`);
    await context.close();
    return { posted: 0, failed: 0, skipped: true };
  }

  log(`  Facebook login confirmed for ${userName}!`);

  let posted = 0;
  let failed = 0;

  for (let i = 0; i < toPost.length; i++) {
    const vehicle = toPost[i];
    const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

    // Check posting hours
    if (!isWithinPostingHours()) {
      log(`  Outside posting hours — stopping. Remaining vehicles will post tomorrow.`);
      break;
    }

    log(`  ─── Vehicle ${i + 1}/${toPost.length}: ${title} ───`);

    // Duplicate prevention
    if (await isDuplicateListing(vehicle, userId)) {
      await updateVehicleStatus(vehicle.id, "posted");
      log(`  Skipping duplicate — marked as posted`);
      continue;
    }

    await updateVehicleStatus(vehicle.id, "posting");
    const result = await postVehicleToMarketplace(page, vehicle);

    if (result.success) {
      await updateVehicleStatus(vehicle.id, "posted", result.listingUrl);
      await incrementDailyCount(userId);
      await logActivity(vehicle.id, "posted", userId, result.listingUrl);
      posted++;
    } else {
      await updateVehicleStatus(vehicle.id, "failed");
      await logActivity(vehicle.id, "failed", userId, result.error);
      failed++;
    }

    // Delay before next post
    if (i < toPost.length - 1) {
      const delayMs = randomDelay();
      const delayMin = Math.round(delayMs / 60000);
      log(`  Waiting ${delayMin} minutes before next post...`);
      await sleep(delayMs);
    }
  }

  await context.close();
  log(`  ${userName}: ${posted} posted, ${failed} failed`);
  return { posted, failed, skipped: false };
}

// ── Single run cycle ──
async function runCycle() {
  let usersToProcess = [];

  if (targetUserId) {
    const profile = await getUserProfile(targetUserId);
    if (!profile) {
      log(`ERROR: User ${targetUserId} not found.`);
      return;
    }
    usersToProcess = [profile];
    log(`Single-user mode: ${profile.full_name}`);
  } else {
    const activeUsers = await getActiveUsers();
    log(`Found ${activeUsers.length} active users`);

    for (const u of activeUsers) {
      const queue = await getQueuedVehicles(u.id);
      if (queue.length > 0) {
        usersToProcess.push(u);
        log(`  ${u.full_name}: ${queue.length} vehicles queued`);
      } else {
        log(`  ${u.full_name}: no vehicles queued, skipping`);
      }
    }
  }

  if (usersToProcess.length === 0) {
    log("No users with queued vehicles found.");
    const firstUser = targetUserId || null;
    await relistStaleListings(firstUser);
    await cleanupSoldListings(firstUser);
    await generateDailySummary(firstUser);
    return;
  }

  console.log("");

  // Process each user sequentially
  const results = {};
  for (const userProfile of usersToProcess) {
    try {
      await relistStaleListings(userProfile.id);
      results[userProfile.full_name] = await processUser(userProfile);
    } catch (err) {
      log(`ERROR processing ${userProfile.full_name}: ${err.message}`);
      results[userProfile.full_name] = { posted: 0, failed: 0, skipped: true };
    }
  }

  // Post-processing: cleanup sold vehicles
  for (const userProfile of usersToProcess) {
    try {
      await cleanupSoldListings(userProfile.id);
    } catch (err) {
      log(`ERROR cleaning up for ${userProfile.full_name}: ${err.message}`);
    }
  }

  // Summary
  console.log("");
  log("════════════════════════════════════════");
  log("SESSION SUMMARY");
  log("════════════════════════════════════════");
  let totalPosted = 0;
  let totalFailed = 0;
  for (const [name, result] of Object.entries(results)) {
    if (result.skipped) {
      log(`  ${name}: skipped`);
    } else {
      log(`  ${name}: ${result.posted} posted, ${result.failed} failed`);
      totalPosted += result.posted;
      totalFailed += result.failed;
    }
  }
  log(`  TOTAL: ${totalPosted} posted, ${totalFailed} failed`);
  log("════════════════════════════════════════");

  for (const userProfile of usersToProcess) {
    await generateDailySummary(userProfile.id);
  }
}

// ── Health check server for Railway ──
// Railway needs a listening port to consider the container healthy
if (IS_RAILWAY) {
  const PORT = process.env.PORT || 3000;
  createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "fb-poster" }));
  }).listen(PORT, () => {
    console.log(`[STARTUP] Health check server on port ${PORT}`);
  });
}

// ── Main ──
async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║    FB Marketplace Auto-Poster (Multi-User)       ║");
  console.log("║    Posting hours: 7AM - 2PM Mountain Time        ║");
  console.log("║    Max 27 posts/day per user (10-15min delays)   ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║    Press Ctrl+C to stop at any time              ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");

  if (IS_RAILWAY) {
    // On Railway: run as a long-lived service, checking every 30 minutes
    log("Running in Railway mode (continuous loop)");
    while (true) {
      if (isWithinPostingHours()) {
        log("Within posting hours — starting cycle...");
        try {
          await runCycle();
        } catch (err) {
          log(`Cycle error: ${err.message}`);
        }
        log("Cycle complete. Sleeping 30 minutes before next check...");
        await sleep(30 * 60 * 1000);
      } else {
        const now = new Date();
        const mt = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
        log(`Outside posting hours (7AM-2PM MT). Currently ${mt.toLocaleTimeString()}. Sleeping 15 minutes...`);
        await sleep(15 * 60 * 1000);
      }
    }
  } else {
    // Local mode: run once and exit
    await waitForPostingHours();
    await runCycle();
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  log("\nStopping poster (Ctrl+C)...");
  process.exit(0);
});

main().catch((err) => {
  console.error("Poster error:", err);
  process.exit(1);
});
