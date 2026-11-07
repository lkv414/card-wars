@echo off
setlocal
cd /d "%~dp0"
title Card Wars v3 - local dev
if not exist "%SystemRoot%\System32\msvcp140.dll" if exist "%ProgramFiles(x86)%\Microsoft\EdgeCore\Optimized\msvcp140.dll" set "PATH=%ProgramFiles(x86)%\Microsoft\EdgeCore\Optimized;%PATH%"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [error] pnpm not found. Install Node 22+ and pnpm 12, then retry.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [setup] Installing dependencies...
  call pnpm install
  if errorlevel 1 goto :fail
)

echo [build] Building client...
call pnpm --filter @card-wars/client build
if errorlevel 1 goto :fail

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [error] Port 8787 is already in use.
  echo         Close the other wrangler/workerd process and retry.
  echo         Hint: close the terminal running "wrangler dev" or kill its process tree.
  pause
  exit /b 1
)

echo [run] Starting server in a separate visible window "Card Wars Server"...
start "Card Wars Server" cmd /k "cd /d ""%~dp0"" && call pnpm --filter @card-wars/server dev -- --port 8787"

echo       Waiting for http://127.0.0.1:8787 ...
powershell -NoProfile -Command "$u='http://127.0.0.1:8787/health'; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 1; if($r.StatusCode -eq 200){ Start-Process 'http://127.0.0.1:8787/'; break } } catch {}; Start-Sleep -Milliseconds 500 }"

echo.
echo [done] Server is running in the "Card Wars Server" window.
echo        Close that window to stop the server session.
pause
exit /b 0

:fail
echo.
echo [error] Command failed.
pause
exit /b 1
