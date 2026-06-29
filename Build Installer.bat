@echo off
setlocal

cd /d "%~dp0"

set "CI=true"
set "PATH=%~dp0src-tauri\resources\nodejs\bin;%PATH%"
set "COREPACK=%~dp0src-tauri\resources\nodejs\bin\corepack.cmd"

echo Building BloxBot release installer...
echo.
echo This can take a while. The finished files should appear under:
echo %~dp0src-tauri\target\release\bundle
echo.

call "%COREPACK%" pnpm test
if errorlevel 1 goto failed

call "%COREPACK%" pnpm build
if errorlevel 1 goto failed

call "%COREPACK%" pnpm tauri build
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
