@echo off
setlocal
title FB Marketplace - All Services
color 0E
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
    echo ERROR: .env.local not found! Run install.bat first.
    pause
    exit /b 1
)

echo.
echo  ====================================================
echo    FB Marketplace Tool - Starting All Services
echo    Newby Buick GMC
echo  ====================================================
echo.
echo    1. Auto-Poster   (posts queued vehicles)
echo    2. Auto-Reply    (replies to new messages)
echo    3. Listing Renew  (bumps old listings)
echo.
echo    Each opens in its own window.
echo    Close any window to stop that service.
echo    Posting hours: 7 AM - 2 PM Mountain Time
echo  ====================================================
echo.

:: Launch poster in its own window
echo Starting Auto-Poster...
start "FB Auto-Poster" cmd /k "cd /d "%~dp0" && color 0A && npm run poster"

:: Wait a moment so they don't all fight for the browser
timeout /t 5 /nobreak >nul

:: Launch auto-reply in its own window
echo Starting Auto-Reply...
start "FB Auto-Reply" cmd /k "cd /d "%~dp0" && color 0B && npm run autoreply"

:: Wait a moment
timeout /t 5 /nobreak >nul

:: Launch renewer in its own window
echo Starting Listing Renewer...
start "FB Listing Renewer" cmd /k "cd /d "%~dp0" && color 0D && npm run renew"

echo.
echo  All 3 services started in separate windows!
echo  You can close this window.
echo.
pause
