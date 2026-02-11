@echo off
cd /d %~dp0

echo Starting FB Marketplace Tool...
start http://localhost:3000

npm run dev

pause

