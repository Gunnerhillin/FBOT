/**
 * Facebook Marketplace Auto-Reply (Multi-User)
 *
 * Auto-replies to NEW unread Marketplace messages only.
 *
 * Usage:
 *   node scripts/test-autoreply.mjs                     # All active users
 *   node scripts/test-autoreply.mjs --user-id UUID      # Specific user
 *
 * Strategy:
 *   1. Open /marketplace/inbox
 *   2. Find unread indicators (blue dots) on conversation rows
 *   3. Click ONLY unread conversations
 *   4. Type reply in the right-side chat panel
 *   5. Never navigate away from the inbox
 */

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { setTimeout as sleep } from "timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_SESSION_DIR = join(__dirname, "..", ".fb-sessions");
const LEGACY_SESSION_DIR = join(__dirname, "..", ".fb-session");
const ENV_PATH = join(__dirname, "..", ".env.local");

// ── Railway / headless detection ──
const IS_RAILWAY = !!(process.env.RAILWAY_HEADLESS || process.env.RAILWAY_ENVIRONMENT);

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
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/Denver",
      ...opts,
    };
  }
  return {
    headless: false,
    viewport: opts.viewport || null,
    args: opts.maximized ? ["--start-maximized", ...baseArgs] : baseArgs,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/Denver",
    ...opts,
  };
}

async function applyStealthPatches(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    window.chrome = { runtime: {} };
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

// Load env
if (!existsSync(ENV_PATH)) {
  console.error("ERROR: .env.local not found");
  process.exit(1);
}
const envContent = readFileSync(ENV_PATH, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) continue;
  const key = trimmed.slice(0, eqIndex).trim();
  const value = trimmed.slice(eqIndex + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

const REPLY_TEMPLATES = [
  `Hey what's up! Yeah that one's still available. If you want to come check it out I'm at Newby Buick GMC on Convention Center Dr in St George. You can text me at 435-633-0213 too, usually faster than messenger. My name's Gunner`,
  `Hey! Yep still got it. Shoot me a text at 435-633-0213 if you wanna come see it, I can have it pulled up front for you. I'm at Newby Buick GMC, 1629 S Convention Center Dr. -Gunner`,
  `What's going on! That one's here on the lot if you wanna come take a look. I'm here Mon-Sat, just text me at 435-633-0213 and I'll make sure it's ready for you. Newby Buick GMC in St George`,
  `Hey thanks for hitting me up! That one's available, come check it out whenever works for you. Easiest way to reach me is text 435-633-0213. I'm Gunner at Newby Buick GMC on Convention Center Dr`,
  `Hey! Yeah come take a look at it, it's a solid one. I'm over at Newby Buick GMC in St George, 1629 S Convention Center Dr. Text me at 435-633-0213 and we can set something up. -Gunner`,
];

async function ensureOnInbox(page) {
  const url = page.url();
  if (!url.includes("/marketplace/inbox")) {
    log("  WARNING: Left inbox! Going back...");
    await page.goto("https://www.facebook.com/marketplace/inbox", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(5000);
    return true;
  }
  return false;
}

async function processAutoReply(userId) {
  const sessionDir = getSessionDir(userId);

  if (!existsSync(sessionDir)) {
    log(`No Facebook session found${userId ? ` for user ${userId}` : ""}. Skipping.`);
    return 0;
  }

  let context;
  try {
    log("Launching browser...");
    context = await chromium.launchPersistentContext(sessionDir, getBrowserOptions(sessionDir, { maximized: true }));

    const page = context.pages()[0] || (await context.newPage());
    if (IS_RAILWAY) await applyStealthPatches(page);

    log("Opening Marketplace inbox...");
    await page.goto("https://www.facebook.com/marketplace/inbox", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(6000);

    log(`Current URL: ${page.url()}`);
    await ensureOnInbox(page);

    await page.screenshot({ path: join(__dirname, "autoreply_inbox.png"), fullPage: false });

    // Scan for conversation rows
    const convRows = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll("a, div[role='row'], div[role='listitem'], div[role='link']").forEach(el => {
        const r = el.getBoundingClientRect();
        const hasImg = el.querySelector("img, svg, [role='img']") !== null;
        const text = (el.innerText || "").trim();
        const lines = text.split("\n").filter(l => l.trim());
        if (hasImg && lines.length >= 2 && r.height > 50 && r.width > 150 && r.y > 100) {
          results.push({
            tag: el.tagName,
            href: (el.getAttribute("href") || "").slice(0, 80),
            role: el.getAttribute("role") || "",
            text: text.replace(/\n/g, " | ").slice(0, 100),
            midX: Math.round(r.x + r.width / 2),
            midY: Math.round(r.y + r.height / 2),
          });
        }
      });
      return results;
    });

    // Filter out nav elements
    const navWords = ["all", "buying", "selling", "pending", "paid", "shipped", "notifications", "following", "marketplace", "create"];
    const filteredRows = convRows.filter(row => {
      const lower = row.text.toLowerCase();
      const isNav = navWords.some(w => lower === w || lower.startsWith(w + " |") && lower.length < 30);
      return !isNav;
    });

    log(`Found ${filteredRows.length} conversation(s)`);

    if (filteredRows.length === 0) {
      log("No conversations found.");
      await context.close();
      return 0;
    }

    let replied = 0;

    for (let i = 0; i < Math.min(filteredRows.length, 15); i++) {
      const row = filteredRows[i];
      const label = row.text.slice(0, 50);

      try {
        log(`\n=== Conversation ${i + 1}/${filteredRows.length}: ${label} ===`);

        await page.mouse.click(row.midX, row.midY);
        await sleep(2500);

        if (await ensureOnInbox(page)) {
          log("  Left inbox, came back. Skipping.");
          await sleep(3000);
          continue;
        }

        // Check if already replied
        const alreadyReplied = await page.evaluate(() => {
          const text = document.body.innerText;
          if (text.includes("633-0213") || text.includes("Newby Buick GMC")) return true;
          const sentIndicators = document.querySelectorAll(
            '[data-testid*="outgoing"], [aria-label*="You sent"], [aria-label*="you sent"]'
          );
          if (sentIndicators.length > 0) return true;
          return false;
        });

        if (alreadyReplied) {
          log(`  Already replied in this thread, skipping`);
          continue;
        }

        const reply = REPLY_TEMPLATES[Math.floor(Math.random() * REPLY_TEMPLATES.length)];
        log(`  Reply: "${reply.slice(0, 60)}..."`);

        // Find message input
        let msgInput = null;
        const inputSelectors = [
          '[role="textbox"][aria-label*="essage" i]',
          '[role="textbox"][aria-label*="type" i]',
          '[contenteditable="true"][aria-label*="essage" i]',
          '[contenteditable="true"][aria-label*="type" i]',
          'textarea[placeholder*="essage" i]',
        ];

        for (const sel of inputSelectors) {
          try {
            const el = page.locator(sel).first();
            if (await el.count() > 0 && await el.isVisible()) {
              const box = await el.boundingBox();
              if (box && box.x > 300) {
                msgInput = el;
                break;
              }
            }
          } catch {}
        }

        // Fallback
        if (!msgInput) {
          const fallbacks = ['[role="textbox"]', '[contenteditable="true"]'];
          for (const sel of fallbacks) {
            const els = page.locator(sel);
            const count = await els.count();
            for (let e = 0; e < count; e++) {
              try {
                const el = els.nth(e);
                if (await el.isVisible()) {
                  const box = await el.boundingBox();
                  if (box && box.x > 300 && box.y > 300) {
                    msgInput = el;
                    break;
                  }
                }
              } catch {}
            }
            if (msgInput) break;
          }
        }

        if (!msgInput) {
          log("  ERROR: No message input found");
          continue;
        }

        // Type and send
        await msgInput.click();
        await sleep(400);

        try {
          await msgInput.fill(reply);
        } catch {
          await page.keyboard.type(reply, { delay: 5 });
        }
        await sleep(600);

        // Send
        let sent = false;
        for (const sel of ['[aria-label="Send"]', '[aria-label="send"]', '[aria-label="Press enter to send"]']) {
          try {
            const btn = page.locator(sel).first();
            if (await btn.count() > 0 && await btn.isVisible()) {
              await btn.click();
              sent = true;
              log(`  Sent via ${sel}`);
              break;
            }
          } catch {}
        }
        if (!sent) {
          await page.keyboard.press("Enter");
          log("  Sent via Enter key");
        }

        await sleep(2000);
        await ensureOnInbox(page);

        replied++;
        log(`  Reply sent!`);

        if (i < filteredRows.length - 1) {
          const wait = 2000 + Math.random() * 3000;
          log(`  Waiting ${Math.round(wait / 1000)}s...`);
          await sleep(wait);
        }
      } catch (err) {
        log(`  Error: ${err.message}`);
        await ensureOnInbox(page).catch(() => {});
      }
    }

    await context.close();
    return replied;
  } catch (err) {
    log(`Error: ${err.message}`);
    try { await context?.close(); } catch {}
    return 0;
  }
}

// ── Main ──
async function main() {
  console.log("");
  console.log("╔═══════════════════════════════════════╗");
  console.log("║   AUTO-REPLY (Multi-User)              ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log("");

  let totalReplied = 0;

  if (targetUserId) {
    totalReplied = await processAutoReply(targetUserId);
  } else {
    // Process all active users
    const { data: activeUsers } = await supabase
      .from("profiles")
      .select("id, full_name, is_active")
      .eq("is_active", true);

    if (!activeUsers || activeUsers.length === 0) {
      log("No active users found.");
      process.exit(0);
    }

    for (const u of activeUsers) {
      log(`\n══════ Auto-reply for: ${u.full_name} ══════`);
      try {
        const replied = await processAutoReply(u.id);
        totalReplied += replied;
      } catch (err) {
        log(`ERROR for ${u.full_name}: ${err.message}`);
      }
    }
  }

  console.log("");
  console.log("════════════════════════════════════════");
  if (totalReplied === 0) {
    log("No new messages replied to.");
  } else {
    log(`Sent ${totalReplied} auto-reply(s)!`);
    await supabase.from("posting_log").insert({
      vehicle_id: null,
      action: "auto_reply",
      user_id: targetUserId || null,
      details: `Sent ${totalReplied} auto-replies`,
    });
  }
  console.log("════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Auto-reply error:", err.message);
  process.exit(1);
});
