#!/bin/bash
# ── FB Poster Service Startup ──
# Starts VNC + noVNC for web-based browser access,
# then waits for the user to do their initial Facebook login.

export DISPLAY=:99

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  FB Marketplace Poster Service                       ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "║  Web Desktop: http://localhost:6080/vnc.html         ║"
echo "║                                                      ║"
echo "║  1. Open the URL above in your browser               ║"
echo "║  2. Click 'Connect'                                  ║"
echo "║  3. Open a terminal in the desktop                   ║"
echo "║  4. Run: npm run fb-login                            ║"
echo "║  5. Log into Facebook in the browser that opens      ║"
echo "║  6. Close that browser                               ║"
echo "║  7. Then run: npm run poster                         ║"
echo "║                                                      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Start supervisor (manages Xvfb, VNC, noVNC)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/poster.conf
