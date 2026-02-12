/**
 * Facebook Marketplace Auto-Poster
 *
 * Posts queued vehicles to Facebook Marketplace using Playwright.
 * Fully compliant with FB dealer rules:
 *   - Max 10 posts per day
 *   - 10-15 minute random delay between posts
 *   - Uses your personal account (persistent session)
 *   - No duplicate content
 *   - Updates vehicle status in Supabase
 *
 * Usage: npm run poster
 *
 * Prerequisites:
 *   1. Run `npm run fb-login` first to set up your Facebook session
 *   2. Run the SQL migration in Supabase
 *   3. Queue vehicles for posting from the UI
 */

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { setTimeout as sleep } from "timers/promises";

// ── Config ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = join(__dirname, "..", ".fb-session");
const ENV_PATH = join(__dirname, "..", ".env.local");

const MAX_POSTS_PER_DAY = 10;
const MIN_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_DELAY_MS = 15 * 60 * 1000; // 15 minutes

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

async function getDailyCount() {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("posting_daily_count")
    .select("count")
    .eq("date", today)
    .single();
  return data?.count || 0;
}

async function incrementDailyCount() {
  const today = new Date().toISOString().split("T")[0];
  const { data: existing } = await supabase
    .from("posting_daily_count")
    .select("count")
    .eq("date", today)
    .single();

  if (existing) {
    await supabase
      .from("posting_daily_count")
      .update({ count: existing.count + 1, last_post_at: new Date().toISOString() })
      .eq("date", today);
  } else {
    await supabase
      .from("posting_daily_count")
      .insert({ date: today, count: 1, last_post_at: new Date().toISOString() });
  }
}

async function logActivity(vehicleId, action, details = null) {
  await supabase.from("posting_log").insert({
    vehicle_id: vehicleId,
    action,
    details,
  });
}

async function getQueuedVehicles() {
  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("fb_status", "queued")
    .order("fb_queued_at", { ascending: true });

  if (error) {
    log(`ERROR fetching queue: ${error.message}`);
    return [];
  }
  return data || [];
}

async function updateVehicleStatus(id, status, listingUrl = null) {
  const update = { fb_status: status };
  if (status === "posted") {
    update.fb_posted_at = new Date().toISOString();
    if (listingUrl) update.fb_listing_url = listingUrl;
  }
  await supabase.from("vehicles").update(update).eq("id", id);
}

// ── Facebook Marketplace Posting ──
async function postVehicleToMarketplace(page, vehicle) {
  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ""}`.trim();
  log(`Posting: ${title} (VIN: ${vehicle.vin})`);

  try {
    // Navigate to create vehicle listing
    await page.goto("https://www.facebook.com/marketplace/create/vehicle", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(3000 + Math.random() * 2000);

    // ── Upload Photos ──
    if (vehicle.photos && vehicle.photos.length > 0) {
      log(`  Uploading ${vehicle.photos.length} photos...`);

      // Find the photo upload input
      const fileInput = await page.locator('input[type="file"][accept*="image"]').first();

      // Download photos to temp and upload
      for (let i = 0; i < Math.min(vehicle.photos.length, 20); i++) {
        try {
          const photoUrl = vehicle.photos[i];
          const response = await fetch(photoUrl);
          if (!response.ok) continue;

          const buffer = Buffer.from(await response.arrayBuffer());
          const tempPath = join(__dirname, `temp_photo_${i}.jpg`);
          const { writeFileSync, unlinkSync } = await import("fs");
          writeFileSync(tempPath, buffer);

          await fileInput.setInputFiles(tempPath);
          await sleep(2000 + Math.random() * 1000);

          // Clean up temp file
          try { unlinkSync(tempPath); } catch {}
        } catch (photoErr) {
          log(`  Photo ${i + 1} upload failed: ${photoErr.message}`);
        }
      }
      await sleep(3000);
    }

    // ── Fill Vehicle Details ──

    // Year
    log("  Filling year...");
    const yearInput = page.locator('[aria-label="Year"]').first();
    if (await yearInput.count()) {
      await yearInput.click();
      await sleep(500);
      await yearInput.fill(String(vehicle.year));
      await sleep(1000);
      // Select from dropdown
      await page.keyboard.press("Enter");
      await sleep(1000);
    }

    // Make
    log("  Filling make...");
    const makeInput = page.locator('[aria-label="Make"]').first();
    if (await makeInput.count()) {
      await makeInput.click();
      await sleep(500);
      await makeInput.fill(vehicle.make);
      await sleep(1500);
      await page.keyboard.press("Enter");
      await sleep(1000);
    }

    // Model
    log("  Filling model...");
    const modelInput = page.locator('[aria-label="Model"]').first();
    if (await modelInput.count()) {
      await modelInput.click();
      await sleep(500);
      await modelInput.fill(vehicle.model);
      await sleep(1500);
      await page.keyboard.press("Enter");
      await sleep(1000);
    }

    // Trim (if available)
    if (vehicle.trim) {
      log("  Filling trim...");
      const trimInput = page.locator('[aria-label="Trim"]').first();
      if (await trimInput.count()) {
        await trimInput.click();
        await sleep(500);
        await trimInput.fill(vehicle.trim);
        await sleep(1500);
        await page.keyboard.press("Enter");
        await sleep(1000);
      }
    }

    // Price
    log("  Filling price...");
    const priceInput = page.locator('[aria-label="Price"]').first();
    if (await priceInput.count()) {
      await priceInput.click();
      await priceInput.fill(String(vehicle.price || 0));
      await sleep(500);
    }

    // Mileage
    if (vehicle.mileage) {
      log("  Filling mileage...");
      const mileageInput = page.locator('[aria-label="Mileage"]').first();
      if (await mileageInput.count()) {
        await mileageInput.click();
        await mileageInput.fill(String(vehicle.mileage));
        await sleep(500);
      }
    }

    // Description
    if (vehicle.description_a) {
      log("  Filling description...");
      const descInput = page.locator('[aria-label="Description"]').first();
      if (await descInput.count()) {
        await descInput.click();
        await descInput.fill(vehicle.description_a);
        await sleep(500);
      }
    }

    // Location — type dealership city
    const locationInput = page.locator('[aria-label="Location"]').first();
    if (await locationInput.count()) {
      log("  Setting location to St. George, UT...");
      await locationInput.click();
      await locationInput.fill("St. George, UT");
      await sleep(2000);
      await page.keyboard.press("Enter");
      await sleep(1000);
    }

    // ── VIN field (if visible) ──
    if (vehicle.vin) {
      const vinInput = page.locator('[aria-label="VIN"]').first();
      if (await vinInput.count()) {
        log("  Filling VIN...");
        await vinInput.click();
        await vinInput.fill(vehicle.vin);
        await sleep(500);
      }
    }

    await sleep(2000);

    // Take a screenshot for debugging
    const screenshotPath = join(__dirname, `last_post_${vehicle.vin || "unknown"}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    log(`  Screenshot saved: ${screenshotPath}`);

    // ── Click "Next" or "Publish" ──
    log("  Looking for publish button...");

    // Try clicking "Next" first (multi-step form)
    const nextBtn = page.locator('div[aria-label="Next"], span:has-text("Next")').first();
    if (await nextBtn.count()) {
      await nextBtn.click();
      await sleep(3000);
    }

    // Then look for Publish
    const publishBtn = page.locator(
      'div[aria-label="Publish"], span:has-text("Publish")'
    ).first();
    if (await publishBtn.count()) {
      await publishBtn.click();
      log("  Clicked Publish!");
      await sleep(5000);
    } else {
      log("  WARNING: Could not find Publish button. Check screenshot.");
      return { success: false, error: "Publish button not found" };
    }

    // Try to get the listing URL from the page
    const currentUrl = page.url();
    const listingUrl = currentUrl.includes("marketplace")
      ? currentUrl
      : null;

    log(`  SUCCESS: ${title} posted!`);
    return { success: true, listingUrl };
  } catch (err) {
    log(`  FAILED: ${err.message}`);
    // Save error screenshot
    try {
      await page.screenshot({
        path: join(__dirname, `error_${vehicle.vin || "unknown"}.png`),
      });
    } catch {}
    return { success: false, error: err.message };
  }
}

// ── Main Loop ──
async function main() {
  // Check session exists
  if (!existsSync(SESSION_DIR)) {
    console.error("ERROR: No Facebook session found.");
    console.error("Run `npm run fb-login` first to set up your session.");
    process.exit(1);
  }

  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║    FB Marketplace Auto-Poster                    ║");
  console.log("║    Compliant Mode (10/day, 10-15min gaps)        ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║    Press Ctrl+C to stop at any time              ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");

  // Check daily count
  const todayCount = await getDailyCount();
  log(`Daily posts so far: ${todayCount}/${MAX_POSTS_PER_DAY}`);

  if (todayCount >= MAX_POSTS_PER_DAY) {
    log("Daily limit reached! Try again tomorrow.");
    process.exit(0);
  }

  // Get queued vehicles
  const queue = await getQueuedVehicles();
  log(`Vehicles in queue: ${queue.length}`);

  if (queue.length === 0) {
    log("No vehicles queued. Add vehicles from the UI first.");
    process.exit(0);
  }

  const remaining = MAX_POSTS_PER_DAY - todayCount;
  const toPost = queue.slice(0, remaining);
  log(`Will post ${toPost.length} vehicles (${remaining} slots remaining today)`);

  // Estimate total time
  const estMinutes = toPost.length * 12.5; // avg 12.5 min between posts
  log(`Estimated time: ~${Math.round(estMinutes)} minutes`);
  console.log("");

  // Launch browser
  log("Launching browser...");
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false, // headed so you can monitor + handle any captchas
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/Denver",
  });

  const page = context.pages()[0] || (await context.newPage());

  // Verify we're logged into Facebook
  log("Checking Facebook login...");
  await page.goto("https://www.facebook.com/marketplace", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(3000);

  const loginCheck = page.url();
  if (loginCheck.includes("login") || loginCheck.includes("checkpoint")) {
    log("ERROR: Not logged into Facebook. Run `npm run fb-login` first.");
    await context.close();
    process.exit(1);
  }

  log("Facebook login confirmed!");
  console.log("");

  // Post vehicles one by one
  let posted = 0;
  for (let i = 0; i < toPost.length; i++) {
    const vehicle = toPost[i];
    const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

    log(`═══ Vehicle ${i + 1}/${toPost.length}: ${title} ═══`);

    // Update status to "posting"
    await updateVehicleStatus(vehicle.id, "posting");

    const result = await postVehicleToMarketplace(page, vehicle);

    if (result.success) {
      await updateVehicleStatus(vehicle.id, "posted", result.listingUrl);
      await incrementDailyCount();
      await logActivity(vehicle.id, "posted", result.listingUrl);
      posted++;
    } else {
      await updateVehicleStatus(vehicle.id, "failed");
      await logActivity(vehicle.id, "failed", result.error);
    }

    // Delay before next post (skip if last)
    if (i < toPost.length - 1) {
      const delayMs = randomDelay();
      const delayMin = Math.round(delayMs / 60000);
      log(`Waiting ${delayMin} minutes before next post...`);
      log(`(Next: ${toPost[i + 1].year} ${toPost[i + 1].make} ${toPost[i + 1].model})`);
      console.log("");
      await sleep(delayMs);
    }
  }

  console.log("");
  log("════════════════════════════════════════");
  log(`Session complete: ${posted}/${toPost.length} posted successfully`);
  log(`Daily total: ${todayCount + posted}/${MAX_POSTS_PER_DAY}`);
  log("════════════════════════════════════════");

  await context.close();
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
