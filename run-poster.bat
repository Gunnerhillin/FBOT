@echo off
title FB Marketplace Auto-Poster
color 0E

:: Find project directory (same folder as this bat file)
cd /d "%~dp0"

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Run install.bat first!
    pause
    exit /b 1
)

:: Check .env.local
if not exist ".env.local" (
    echo ERROR: .env.local not found!
    echo Run install.bat or create .env.local manually.
    pause
    exit /b 1
)

:: Check Facebook session
if not exist ".fb-session" (
    echo.
    echo  No Facebook session found!
    echo  Running first-time Facebook login setup...
    echo  (Log into Facebook in the browser that opens, then close it)
    echo.
    call npm run fb-login
    echo.
)

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   FB Marketplace Auto-Poster                      ║
echo  ║   Compliant Mode: 10/day, 10-15 min gaps          ║
echo  ╠══════════════════════════════════════════════════╣
echo  ║   Press Ctrl+C to stop at any time                 ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: Run the poster
call npm run poster

echo.
echo Poster finished. Check above for results.
pause
