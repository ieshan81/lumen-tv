@echo off
rem Starts Lumen TV in the system tray. Installs its components the first time.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing Lumen TV's components. This takes a minute...
  call npm install || goto :fail
  node node_modules\electron\install.js || goto :fail
)
start "" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b 0

:fail
echo.
echo Setup failed. Make sure Node.js is installed (https://nodejs.org), then run start.cmd again.
pause
