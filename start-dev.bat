@echo off
Title CardGame - Dev Servers

echo.
echo ===============================================
echo   CardGame - Dev Servers Launcher
echo ===============================================
echo.

:: Change to script directory
cd /d "%~dp0"

:: Check if npm is installed
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm not found. Please install Node.js first.
    pause
    exit /b 1
)

:: Check for package.json
if not exist package.json (
    echo [ERROR] package.json not found in %CD%
    pause
    exit /b 1
)

echo [1/2] Starting Vite dev server (frontend)...
start "CardGame-Vite" cmd.exe /k "npm run dev"

echo [2/2] Starting Workers dev server (backend)...
start "CardGame-Workers" cmd.exe /k "npm run workers:dev"

echo.
echo ===============================================
echo   Servers are starting...
echo   - Vite frontend: http://localhost:5173
echo   - Workers backend: see terminal window
echo ===============================================
echo.
pause
