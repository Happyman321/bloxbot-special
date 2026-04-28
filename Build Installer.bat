@echo off
setlocal

cd /d "%~dp0"

echo Building BloxBot release installer...
echo.
echo This can take a while. The finished files should appear under:
echo %~dp0src-tauri\target\release\bundle
echo.

corepack pnpm test
if errorlevel 1 goto failed

corepack pnpm build
if errorlevel 1 goto failed

corepack pnpm tauri build
if errorlevel 1 goto failed

echo.
echo Build complete.
echo.
echo Installer/build output:
echo %~dp0src-tauri\target\release\bundle
echo.
pause
exit /b 0

:failed
echo.
echo Build failed. Check the error above.
pause
exit /b 1
