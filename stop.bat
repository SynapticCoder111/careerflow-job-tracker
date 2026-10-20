@echo off
setlocal
title CareerFlow - Stop Server
cd /d "%~dp0"

echo.
echo  Stopping CareerFlow server...
echo.

REM Find the process listening on port 3000 and stop it (single-line PowerShell
REM command so cmd.exe does not split the script across separate commands).
powershell -NoProfile -Command "$p=Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if($p){ foreach($id in $p){ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Host ('  [OK] Stopped process ' + $id) } } else { Write-Host '  [i] No server was running on port 3000' }"

echo.
echo  Server stopped.
echo.
ping -n 3 127.0.0.1 >nul 2>&1
endlocal
exit /b 0
