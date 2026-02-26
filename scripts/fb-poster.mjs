/**
 * Facebook Marketplace Auto-Poster (Multi-User)
 *
 * Posts queued vehicles to Facebook Marketplace using Playwright.
 * Supports multiple salespeople, each with their own FB session and daily limit.
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
import { existsSync, readFileSync, mkdirSync } from "fs";
import { setTimeout as sleep } from "timers/promises";

// ── Config ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_SESSION_DIR = join(__dirname, "..", ".fb-sessions");
const LEGACY_SESSION_DIR = join(__dirname, "..", ".fb-session");
const ENV_PATH = join(__dirname, "..", ".env.local");

const DEFAULT_MAX_POSTS_PER_DAY = 10;
const MIN_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_DELAY_MS = 15 * 60 * 1000; // 15 minutes

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
  // Multi-user: each user gets their own session directory
  if (userId) {
    const dir = join(BASE_SESSION_DIR, userId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
  // Fallback to legacy single-user session
  return LEGACY_SESSION_DIR;
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
  const filter = { date: today, user_id: userId };

  const { data: existing } = await supabase
    .from("posting_daily_count")
    .select("count")
    .eq("date", today)
    .eq("user_id", userId)
    .single();

  if (existing) {
    await supabase
      .from("posting_daily_count")
      .update({ count: existing.count + 1, last_post_at: new Date().toISOString() })
      .eq("date", today)
      .eq("user_id", userId);
  } else {
    await supabase
      .from("posting_daily_count")
      .insert({ date: today, user_id: userId, count: 1, last_post_at: new Date().toISOString() });
  }
}

async function logActivity(vehicleId, action, userId, details = null) {
  await supabase.from("posting_log").insert({
    vehicle_id: vehicleId,
    action,
    user_id: userId,
    details,
  });
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

      const { writeFileSync, unlinkSync } = await import("fs");
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

    if (vehicle.description_a) {
      log("  Filling description...");
      const descField = await findField(page, "Description", [
        'textarea[aria-label*="escription"]',
        '[role="textbox"][aria-label*="escription"]',
      ]);
      if (descField) {
        await descField.click();
        await sleep(300);
        await descField.fill(vehicle.description_a);
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
  log(`  Launching browser for ${userName}...`);
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/Denver",
  });

  const page = context.pages()[0] || (await context.newPage());

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

    log(`  ─── Vehicle ${i + 1}/${toPost.length}: ${title} ───`);

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

// ── Main Loop ──
async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║    FB Marketplace Auto-Poster (Multi-User)       ║");
  console.log("║    Compliant Mode (per-user limits, 10-15min)    ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║    Press Ctrl+C to stop at any time              ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");

  let usersToProcess = [];

  if (targetUserId) {
    // Single user mode
    const profile = await getUserProfile(targetUserId);
    if (!profile) {
      log(`ERROR: User ${targetUserId} not found.`);
      process.exit(1);
    }
    usersToProcess = [profile];
    log(`Single-user mode: ${profile.full_name}`);
  } else {
    // Multi-user mode: process all active users who have queued vehicles
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
    process.exit(0);
  }

  console.log("");

  // Process each user sequentially (each gets their own browser session)
  const results = {};
  for (const userProfile of usersToProcess) {
    try {
      results[userProfile.full_name] = await processUser(userProfile);
    } catch (err) {
      log(`ERROR processing ${userProfile.full_name}: ${err.message}`);
      results[userProfile.full_name] = { posted: 0, failed: 0, skipped: true };
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
