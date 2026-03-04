@echo off
setlocal
title FB Login Setup
color 0B
cd /d "%~dp0"

echo.
echo  ====================================================
echo    Facebook Login Setup
echo    Newby Buick GMC
echo  ====================================================
echo.
echo  This will open a browser window.
echo  Log into your Facebook account, then CLOSE the browser.
echo  Your session will be saved automatically.
echo.
echo  ====================================================
echo.

set /p USER_ID=Enter your User ID (from the dashboard):

if "%USER_ID%"=="" (
    echo.
    echo  No User ID entered. Running in legacy mode...
    call npm run fb-login
) else (
    echo.
    echo  Setting up Facebook session for: %USER_ID%
    call node scripts/fb-login.mjs --user-id %USER_ID%
)

echo.
echo  ====================================================
echo    Facebook login saved!
echo    You can now run: run-all.bat
echo  ====================================================
echo.
pause
