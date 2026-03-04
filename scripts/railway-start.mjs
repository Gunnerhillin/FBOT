/**
 * Railway entry point — starts health check server immediately,
 * then loads and runs the poster.
 */
import { createServer } from "http";

// Start health check IMMEDIATELY so Railway sees the container as alive
const PORT = process.env.PORT || 3000;
console.log(`[RAILWAY] Starting health check on port ${PORT}...`);

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "fb-poster" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[RAILWAY] Health check listening on 0.0.0.0:${PORT}`);
  console.log(`[RAILWAY] Now loading poster...`);

  // Load the poster after the health check is up
  import("./fb-poster.mjs").catch(err => {
    console.error(`[RAILWAY] Failed to load poster: ${err.message}`);
    console.error(err.stack);
  });
});

server.on("error", (err) => {
  console.error(`[RAILWAY] Server error: ${err.message}`);
});
