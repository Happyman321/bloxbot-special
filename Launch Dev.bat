@echo off
setlocal

cd /d "%~dp0"

set "CI=true"
set "PATH=%~dp0src-tauri\resources\nodejs\bin;%PATH%"
set "COREPACK=%~dp0src-tauri\resources\nodejs\bin\corepack.cmd"

echo Starting BloxBot in local dev mode...
echo.
echo This keeps a terminal open and launches the app with live local frontend files.
echo Close this window to stop the dev server.
echo.

call "%COREPACK%" pnpm tauri dev

echo.
echo BloxBot dev mode stopped or failed.
pause
