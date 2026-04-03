@echo off
chcp 65001 >nul
title 一键启动
cd /d "%~dp0"

echo ========================================
echo   Open Claw — 一键启动（总控 + 网页控制台）
echo ========================================
echo.

echo [1/5] 释放 3000 端口（关掉占用该端口的旧进程）...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul
echo 已处理。
echo.

echo [2/5] 启动 Redis...
docker start openclaw-redis 2>nul
if errorlevel 1 docker run -d -p 6380:6379 --name openclaw-redis redis:7-alpine 2>nul
if errorlevel 1 (
  echo 提示：Redis 未启动。请先打开 Docker Desktop 再重新双击「一键启动.bat」，或忽略后仅用总控+网页。
) else (
  echo Redis 已启动。
)
echo.

echo [3/5] 正在打开「总控后端」窗口（端口 3000）...
start "总控后端（不要关）" cmd /k "cd /d %~dp0backend && set REDIS_PORT=6380 && set JWT_SECRET=test-secret && set PORT=3000 && npm run start:dev"
echo 已打开，等待后端就绪...
timeout /t 15 /nobreak >nul
echo.

echo [4/5] 正在打开「网页控制台」窗口（端口 3001）...
start "网页控制台（不要关）" cmd /k "cd /d %~dp0web && if not exist node_modules call npm install && npm run dev"
timeout /t 8 /nobreak >nul
echo.

echo [5/5] 打开浏览器...
start "" "http://localhost:3001"
echo.

echo ========================================
echo   启动完成
echo ========================================
echo.
echo 总控后端：http://localhost:3000 （龙虾客户端连此地址）
echo 网页控制台：http://localhost:3001 （已尝试为您打开浏览器）
echo.
echo 请勿关闭「总控后端」与「网页控制台」两个窗口。
echo 若需启动龙虾客户端，请再双击「打开龙虾(客户机模拟).bat」。
echo.
pause
