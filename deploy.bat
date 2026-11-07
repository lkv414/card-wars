@echo off
setlocal
cd /d "%~dp0"
title Card Wars v3 - Cloudflare deploy
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

echo [auth] Checking Cloudflare authentication...
call pnpm --filter @card-wars/server exec wrangler whoami >nul 2>nul
if errorlevel 1 (
  echo [auth] Not logged in. Opening Cloudflare login in browser...
  call pnpm --filter @card-wars/server exec wrangler login
  if errorlevel 1 goto :fail
)

echo [build] Building packages and client...
call pnpm -r build
if errorlevel 1 goto :fail

echo [deploy] Deploying Worker, Durable Object, and static assets to Cloudflare...
call pnpm --filter @card-wars/server deploy
if errorlevel 1 goto :fail

echo.
echo [done] Deployment complete!
pause
exit /b 0

:fail
echo.
echo [error] Deployment failed.
pause
exit /b 1
