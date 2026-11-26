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

if not exist "apps\client\dist\index.html" (
  echo [build] Initial client dist for wrangler assets...
  call pnpm --filter @card-wars/client build
  if errorlevel 1 goto :fail
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [error] Port 8787 is already in use.
  echo         Close the other wrangler/workerd process and retry.
  pause
  exit /b 1
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [error] Port 5173 is already in use.
  echo         Close the other Vite dev process and retry.
  pause
  exit /b 1
)

echo [run] Starting backend server in "Card Wars Server"...
start "Card Wars Server" cmd /k "cd /d ""%~dp0"" && call pnpm --filter @card-wars/server dev -- --port 8787 --ip 127.0.0.1"

echo [run] Starting Vite HMR client in "Card Wars Client (HMR)"...
start "Card Wars Client (HMR)" cmd /k "cd /d ""%~dp0"" && call pnpm --filter @card-wars/client dev -- --port 5173 --host 127.0.0.1"

echo       Waiting for http://127.0.0.1:8787 and http://127.0.0.1:5173 ...
powershell -NoProfile -Command "$u1='http://127.0.0.1:8787/health'; $u2='http://127.0.0.1:5173/'; for($i=0;$i -lt 80;$i++){ try { $r1=Invoke-WebRequest -UseBasicParsing $u1 -TimeoutSec 1; $r2=Invoke-WebRequest -UseBasicParsing $u2 -TimeoutSec 1; if($r1.StatusCode -eq 200 -and $r2.StatusCode -eq 200){ Start-Process 'http://127.0.0.1:5173/'; break } } catch {}; Start-Sleep -Milliseconds 500 }"

echo.
echo [done] Server (8787) and Vite HMR Client (5173) are running.
echo        Changes in client/server apply automatically without restarting.
echo        Close the two terminal windows to stop the session.
pause
exit /b 0

:fail
echo.
echo [error] Command failed.
pause
exit /b 1
