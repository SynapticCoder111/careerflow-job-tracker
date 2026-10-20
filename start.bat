@echo off
setlocal
title CareerFlow - Smart Job Application Tracker

cd /d "%~dp0"

echo.
echo  ============================================================
echo   CareerFlow - Smart Job Application Tracker
echo  ============================================================
echo.

REM ---------- 1. Check Node.js ----------
where node >nul 2>&1
if errorlevel 1 goto NO_NODE

for /f "tokens=*" %%v in ('node --version') do set NODE_VERSION=%%v
echo  [OK] Node.js %NODE_VERSION% detected

REM ---------- 2. Check server\.env ----------
if not exist "server\.env" goto NO_ENV
echo  [OK] server\.env found

REM ---------- 3. Install dependencies on first run ----------
if exist "server\node_modules\express" goto DEPS_OK
echo  [..] Installing server dependencies (first run only)...
pushd server
call npm install
if errorlevel 1 goto NPM_FAIL
popd
echo  [OK] Dependencies installed
goto DEPS_DONE

:DEPS_OK
echo  [OK] Server dependencies already installed
:DEPS_DONE

REM ---------- 4. Start the server in a minimized window ----------
REM The batch already cd'd to the project root, so a relative path is safe.
echo.
echo  [..] Starting CareerFlow server...
start "CareerFlow Server" /min cmd /c "cd server && node server.js"

REM ---------- 5. Wait for the health endpoint to respond ----------
echo  [..] Waiting for the server to start (up to 40 seconds)...
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(40); while((Get-Date) -lt $deadline){ try { $r=Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch { }; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 goto SERVER_TIMEOUT

echo.
echo  ============================================================
echo   CareerFlow is running!
echo  ============================================================
echo.
echo    Dashboard  : http://localhost:3000
echo    API Health : http://localhost:3000/api/health
echo.
echo    The server runs in a minimized window.
echo    To stop it, run stop.bat or close that window.
echo.
REM Portable ~4 second delay (does not require stdin, unlike `timeout`)
ping -n 5 127.0.0.1 >nul 2>&1
start "" "http://localhost:3000"
endlocal
exit /b 0

REM ================= Error handlers =================
:NO_NODE
echo.
echo  [X] Node.js is not installed or is not in PATH.
echo.
echo      Install it from https://nodejs.org and run this file again.
echo.
pause
endlocal
exit /b 1

:NO_ENV
echo.
echo  [X] server\.env was not found.
echo.
echo      Create the file server\.env containing:
echo.
echo        MONGODB_URI=your_mongodb_connection_string
echo        PORT=3000
echo.
pause
endlocal
exit /b 1

:NPM_FAIL
popd
echo.
echo  [X] npm install failed. Check your internet connection and retry.
echo.
pause
endlocal
exit /b 1

:SERVER_TIMEOUT
echo.
echo  [X] The server did not respond within 40 seconds.
echo.
echo      Common causes:
echo        - Invalid MONGODB_URI in server\.env
echo        - Port 3000 is already in use (run stop.bat first)
echo.
echo      The server window may still be starting - check it for details.
echo.
pause
endlocal
exit /b 1
