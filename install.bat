@echo off
title FB Marketplace Tool - Installer
color 0A
echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   FB Marketplace Tool - One-Click Installer      ║
echo  ║   Newby Buick GMC                                ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [1/5] Node.js not found. Installing...
    echo.
    echo Downloading Node.js installer...
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi' -OutFile '%TEMP%\node-installer.msi'"
    echo Running Node.js installer (follow the prompts)...
    msiexec /i "%TEMP%\node-installer.msi"
    del "%TEMP%\node-installer.msi" 2>nul
    echo.
    echo Node.js installed! Please CLOSE this window and run install.bat again.
    echo (Node.js needs a fresh terminal to work)
    pause
    exit /b
) else (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
    echo [1/5] Node.js found: %NODE_VER% ✓
)

:: Check for Git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [2/5] Git not found. Installing...
    echo.
    echo Downloading Git installer...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe' -OutFile '%TEMP%\git-installer.exe'"
    echo Running Git installer (use default settings)...
    "%TEMP%\git-installer.exe"
    del "%TEMP%\git-installer.exe" 2>nul
    echo.
    echo Git installed! Please CLOSE this window and run install.bat again.
    pause
    exit /b
) else (
    for /f "tokens=*" %%i in ('git --version') do set GIT_VER=%%i
    echo [2/5] Git found: %GIT_VER% ✓
)

:: Clone or update repo
if exist "fb-marketplace-tool" (
    echo [3/5] Project folder found, pulling latest...
    cd fb-marketplace-tool
    git pull origin main
) else if exist "package.json" (
    echo [3/5] Already in project folder ✓
) else (
    echo [3/5] Cloning repository...
    git clone https://github.com/Gunnerhillin/FBOT.git fb-marketplace-tool
    cd fb-marketplace-tool
)
echo.

:: Install npm dependencies
echo [4/5] Installing dependencies (this takes a minute)...
call npm install
echo.

:: Install Playwright browsers for the auto-poster
echo [5/5] Installing Playwright browser for auto-poster...
call npx playwright install chromium
echo.

:: Check for .env.local
if not exist ".env.local" (
    echo.
    echo ══════════════════════════════════════════════════
    echo  IMPORTANT: You need to create a .env.local file!
    echo ══════════════════════════════════════════════════
    echo.
    echo  Create a file called .env.local in this folder with:
    echo.
    echo    SUPABASE_URL=https://ayhwhmcooofzdjvkiacn.supabase.co
    echo    SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
    echo    NEXT_PUBLIC_SUPABASE_URL=https://ayhwhmcooofzdjvkiacn.supabase.co
    echo    NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
    echo    OPENAI_API_KEY=your-openai-key
    echo.
) else (
    echo .env.local found ✓
)

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   Installation Complete!                          ║
echo  ╠══════════════════════════════════════════════════╣
echo  ║                                                    ║
echo  ║   To start the website locally:                    ║
echo  ║     Double-click: launch-fb-tool.bat               ║
echo  ║                                                    ║
echo  ║   To run the auto-poster:                          ║
echo  ║     Double-click: run-poster.bat                   ║
echo  ║                                                    ║
echo  ║   First time posting? Run this first:              ║
echo  ║     npm run fb-login                               ║
echo  ║                                                    ║
echo  ╚══════════════════════════════════════════════════╝
echo.
pause
