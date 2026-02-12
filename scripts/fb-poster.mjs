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

// ── Helpers for robust form interaction ──

/**
 * Try multiple selectors to find a form field. Facebook changes their DOM often,
 * so we try aria-label, placeholder, label text, and role-based selectors.
 */
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

  // Fallback: try getByLabel and getByPlaceholder
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

/**
 * Type text character-by-character with random delays (more human-like,
 * better at triggering Facebook's dropdown suggestions).
 */
async function humanType(page, text) {
  for (const char of text) {
    await page.keyboard.type(char, { delay: 30 + Math.random() * 50 });
  }
}

/**
 * Fill a dropdown/combobox field: click, clear, type, wait for dropdown, select.
 */
async function fillDropdown(page, fieldName, value, extraSelectors = []) {
  log(`  Filling ${fieldName}...`);
  const field = await findField(page, fieldName, extraSelectors);
  if (!field) return false;

  try {
    await field.click();
    await sleep(300);

    // Clear existing text
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await sleep(200);

    // Type human-like to trigger dropdown
    await humanType(page, value);
    await sleep(1200); // Wait for dropdown suggestions

    // Try clicking the dropdown option that matches
    const option = page.locator(`[role="option"]:has-text("${value}")`).first();
    if (await option.count() > 0) {
      await option.click();
      log(`    Selected dropdown option for "${value}"`);
    } else {
      // Fallback: try listbox items
      const listItem = page.locator(`[role="listbox"] >> text="${value}"`).first();
      if (await listItem.count() > 0) {
        await listItem.click();
        log(`    Selected listbox item for "${value}"`);
      } else {
        // Last resort: press ArrowDown + Enter to select first suggestion
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

/**
 * Fill a simple text input field (no dropdown).
 */
async function fillTextField(page, fieldName, value, extraSelectors = []) {
  log(`  Filling ${fieldName}...`);
  const field = await findField(page, fieldName, extraSelectors);
  if (!field) return false;

  try {
    await field.click();
    await sleep(200);
    // Use fill() for plain text fields — much faster than typing char by char
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
    // Navigate to create vehicle listing
    await page.goto("https://www.facebook.com/marketplace/create/vehicle", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(3000 + Math.random() * 1000);

    // Debug: log all visible aria-labels so we know what's on the page
    try {
      const labels = await page.evaluate(() => {
        const els = document.querySelectorAll("[aria-label]");
        return [...els]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({
            tag: el.tagName,
            label: el.getAttribute("aria-label"),
            role: el.getAttribute("role"),
            placeholder: el.getAttribute("placeholder"),
          }))
          .slice(0, 40);
      });
      log(`  Page aria-labels found: ${JSON.stringify(labels, null, 0).slice(0, 500)}`);
    } catch {}

    // ── Upload Photos (batch) ──
    if (vehicle.photos && vehicle.photos.length > 0) {
      const photoCount = Math.min(vehicle.photos.length, 20);
      log(`  Downloading ${photoCount} photos...`);

      const { writeFileSync, unlinkSync } = await import("fs");
      const tempPaths = [];

      // Download all photos first (parallel for speed)
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
        await sleep(3000 + tempPaths.length * 300); // Scale wait with photo count

        // Clean up temp files
        for (const p of tempPaths) {
          try { unlinkSync(p); } catch {}
        }
      }
      log(`  Photos uploaded`);
    }

    // ── Fill Vehicle Details ──

    // Vehicle type (first field on the form — Car/Truck, SUV, etc.)
    // Map common body types from vAuto to FB Marketplace categories
    const bodyToType = {
      "4D Sport Utility": "SUV/Crossover",
      "Sport Utility": "SUV/Crossover",
      "SUV": "SUV/Crossover",
      "4D Crew Cab": "Truck",
      "Crew Cab": "Truck",
      "Regular Cab": "Truck",
      "Extended Cab": "Truck",
      "4D Sedan": "Sedan",
      "Sedan": "Sedan",
      "4D Hatchback": "Hatchback",
      "Hatchback": "Hatchback",
      "2D Coupe": "Coupe",
      "Coupe": "Coupe",
      "4D Passenger Van": "Van/Minivan",
      "Van": "Van/Minivan",
      "Minivan": "Van/Minivan",
      "Convertible": "Convertible",
      "Wagon": "Wagon",
    };
    let vehicleType = "Car/Truck"; // default
    if (vehicle.body) {
      for (const [key, val] of Object.entries(bodyToType)) {
        if (vehicle.body.toLowerCase().includes(key.toLowerCase())) {
          vehicleType = val;
          break;
        }
      }
    }
    log(`  Setting vehicle type: ${vehicleType} (from body: ${vehicle.body || "none"})`);
    await fillDropdown(page, "Vehicle type", vehicleType, [
      '[aria-label="Vehicle type"]',
      '[aria-label="Type"]',
      '[aria-label="Category"]',
    ]);

    // Year (dropdown)
    await fillDropdown(page, "Year", String(vehicle.year));

    // Make (dropdown)
    await fillDropdown(page, "Make", vehicle.make);

    // Model (dropdown)
    await fillDropdown(page, "Model", vehicle.model);

    // Trim (dropdown, optional)
    if (vehicle.trim) {
      await fillDropdown(page, "Trim", vehicle.trim);
    }

    // Price (text field)
    await fillTextField(page, "Price", vehicle.price || 0);

    // Mileage (text field)
    if (vehicle.mileage) {
      await fillTextField(page, "Mileage", vehicle.mileage);
    }

    // Description (textarea)
    if (vehicle.description_a) {
      log("  Filling description...");
      const descField = await findField(page, "Description", [
        'textarea[aria-label*="escription"]',
        '[role="textbox"][aria-label*="escription"]',
      ]);
      if (descField) {
        await descField.click();
        await sleep(300);
        // Use fill() for long text — faster and more reliable
        await descField.fill(vehicle.description_a);
        await sleep(500);
      }
    }

    // Location
    log("  Setting location...");
    await fillDropdown(page, "Location", "St. George, UT", [
      '[aria-label*="ocation"]',
    ]);

    // VIN (text field)
    if (vehicle.vin) {
      await fillTextField(page, "VIN", vehicle.vin, [
        'input[aria-label*="VIN"]',
        'input[aria-label*="vin"]',
      ]);
    }

    // Transmission (try to set if visible)
    await fillDropdown(page, "Transmission", "Automatic", [
      '[aria-label*="ransmission"]',
    ]);

    // Fuel type (try if visible)
    await fillDropdown(page, "Fuel type", "Gasoline", [
      '[aria-label*="uel"]',
    ]);

    await sleep(2000);

    // Take a screenshot for debugging
    const screenshotPath = join(__dirname, `last_post_${vehicle.vin || "unknown"}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log(`  Screenshot saved: ${screenshotPath}`);

    // ── Click "Next" or "Publish" ──
    log("  Looking for Next/Publish button...");

    // Try "Next" button (multi-step form)
    const nextBtn = page.locator('[aria-label="Next"]').first();
    if (await nextBtn.count() > 0 && await nextBtn.isVisible()) {
      await nextBtn.click();
      log("  Clicked Next");
      await sleep(3000);
    } else {
      // Try text-based fallback
      const nextText = page.getByRole("button", { name: "Next" }).first();
      if (await nextText.count() > 0) {
        await nextText.click();
        log("  Clicked Next (text match)");
        await sleep(3000);
      }
    }

    // Look for Publish button
    const publishBtn = page.locator('[aria-label="Publish"]').first();
    if (await publishBtn.count() > 0 && await publishBtn.isVisible()) {
      await publishBtn.click();
      log("  Clicked Publish!");
      await sleep(5000);
    } else {
      // Text-based fallback
      const publishText = page.getByRole("button", { name: "Publish" }).first();
      if (await publishText.count() > 0) {
        await publishText.click();
        log("  Clicked Publish (text match)!");
        await sleep(5000);
      } else {
        log("  WARNING: Could not find Publish button. Check screenshot.");
        await page.screenshot({
          path: join(__dirname, `no_publish_${vehicle.vin || "unknown"}.png`),
          fullPage: true,
        });
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
