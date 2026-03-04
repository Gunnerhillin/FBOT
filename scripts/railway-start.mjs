/**
 * Railway entry point — orchestrates ALL services:
 *   1. Health check server (immediate)
 *   2. Auto-poster (continuous loop, built-in)
 *   3. Auto-reply (runs every 20 minutes)
 *   4. Listing renewer (runs once daily at 6:30 AM MT)
 *
 * Each service runs in its own child process so a crash
 * in one doesn't take down the others.
 */
import { createServer } from "http";
import { fork } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ── Service state tracking ──
const services = {
  poster:    { running: false, lastRun: null, errors: 0 },
  autoreply: { running: false, lastRun: null, errors: 0 },
  renewer:   { running: false, lastRun: null, errors: 0 },
};

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { timeZone: "America/Denver" });
  console.log(`[RAILWAY ${ts}] ${msg}`);
}

// ── Run a script as a child process ──
function runService(name, scriptFile) {
  return new Promise((resolve) => {
    if (services[name].running) {
      log(`${name} is already running, skipping`);
      resolve(false);
      return;
    }

    const scriptPath = join(__dirname, scriptFile);
    log(`Starting ${name}...`);
    services[name].running = true;

    const child = fork(scriptPath, [], {
      env: { ...process.env, RAILWAY_ORCHESTRATOR: "true" },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    child.stdout?.on("data", (data) => process.stdout.write(`[${name}] ${data}`));
    child.stderr?.on("data", (data) => process.stderr.write(`[${name}:err] ${data}`));

    child.on("exit", (code) => {
      services[name].running = false;
      services[name].lastRun = new Date().toISOString();
      if (code !== 0 && code !== null) {
        services[name].errors++;
        log(`${name} exited with code ${code} (errors: ${services[name].errors})`);
      } else {
        log(`${name} completed successfully`);
      }
      resolve(true);
    });

    child.on("error", (err) => {
      services[name].running = false;
      services[name].errors++;
      log(`${name} error: ${err.message}`);
      resolve(false);
    });
  });
}

// ── Helper: get current Mountain Time hour ──
function getMTHour() {
  const now = new Date();
  const mt = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
  return mt.getHours();
}

function getMTMinute() {
  const now = new Date();
  const mt = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
  return mt.getMinutes();
}

// ── Health check server ──
log(`Starting health check on port ${PORT}...`);

const server = createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "fb-marketplace-suite",
      services,
      uptime: process.uptime(),
    }));
  } else if (req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(services, null, 2));
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log(`Health check listening on 0.0.0.0:${PORT}`);
  log(`Endpoints: / (health), /status (service details)`);
  log("");

  // Start all services
  startOrchestrator();
});

server.on("error", (err) => {
  log(`Server error: ${err.message}`);
});

// ── Orchestrator ──
async function startOrchestrator() {
  log("╔══════════════════════════════════════════════════╗");
  log("║   FB Marketplace Suite — Railway Orchestrator     ║");
  log("║   Services: Poster + Auto-Reply + Renewer         ║");
  log("╚══════════════════════════════════════════════════╝");
  log("");

  // 1. Start the poster (it has its own internal continuous loop)
  log("Launching poster (continuous loop)...");
  runService("poster", "fb-poster.mjs");

  // 2. Auto-reply loop: runs every 20 minutes during all hours
  setInterval(async () => {
    log("── Auto-reply check ──");
    await runService("autoreply", "test-autoreply.mjs");
  }, 20 * 60 * 1000); // 20 minutes

  // Run autoreply once on startup after a short delay (let poster get going first)
  setTimeout(async () => {
    log("── Initial auto-reply run ──");
    await runService("autoreply", "test-autoreply.mjs");
  }, 2 * 60 * 1000); // 2 minutes after startup

  // 3. Renewer loop: check every 30 minutes, but only run during posting hours
  setInterval(async () => {
    const hour = getMTHour();
    if (hour >= 6 && hour < 14) {
      log("── Renewer check ──");
      await runService("renewer", "fb-renew.mjs");
    }
  }, 30 * 60 * 1000); // 30 minutes

  // Run renewer once on startup if within hours
  setTimeout(async () => {
    const hour = getMTHour();
    if (hour >= 6 && hour < 14) {
      log("── Initial renewer run ──");
      await runService("renewer", "fb-renew.mjs");
    }
  }, 5 * 60 * 1000); // 5 minutes after startup

  log("Orchestrator running. Poster started, auto-reply every 20min, renewer every 30min (6AM-2PM MT).");
}

// ── Graceful shutdown ──
process.on("SIGINT", () => {
  log("Shutting down orchestrator...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("SIGTERM received, shutting down...");
  process.exit(0);
});
