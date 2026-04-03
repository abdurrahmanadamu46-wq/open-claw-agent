@echo off
chcp 65001 >nul
title 总控后端（不要关）
cd /d "%~dp0"
echo 若未启动 Redis，请先双击「启动Redis.bat」
echo.
echo 正在释放 3000 端口（关掉占用该端口的旧进程）...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul
echo.
cd backend
set REDIS_PORT=6380
set JWT_SECRET=test-secret
set PORT=3000
echo 正在启动总控后端（端口 3000），请稍等...
echo 看到 "C&C backend listening on http://localhost:3000" 就表示成功。
echo.
npm run start:dev
pause
