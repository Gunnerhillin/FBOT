@echo off
setlocal
title FB Marketplace Auto-Poster
color 0A
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
echo    FB Marketplace Auto-Poster
echo    27 posts/day per user, 10-15 min gaps
echo    Posting hours: 7 AM - 2 PM Mountain Time
echo  ----------------------------------------------------
echo    Press Ctrl+C to stop at any time
echo  ====================================================
echo.

call npm run poster

echo.
echo Poster finished. Check above for results.
pause
