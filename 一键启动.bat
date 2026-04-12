@echo off
chcp 65001 >nul
title 一键启动
cd /d "%~dp0"

echo ========================================
echo   重新开始测试 - 一键启动
echo ========================================
echo.

echo [1/4] 启动 Redis...
docker start openclaw-redis 2>nul
if errorlevel 1 docker run -d -p 6380:6379 --name openclaw-redis redis:7-alpine 2>nul
if errorlevel 1 (
  echo 提示：若报错请先打开 Docker Desktop，或忽略此步后手动双击「启动Redis.bat」。
) else (
  echo Redis 已启动。
)
echo.

echo [2/4] 正在打开「总控后端」窗口...
start "总控后端（不要关）" cmd /k "cd /d %~dp0backend && set REDIS_PORT=6380 && set JWT_SECRET=test-secret && set PORT=3000 && npm run start:dev"
echo 已打开，请等待约 15 秒...
echo.

echo [3/4] 等待后端就绪...
timeout /t 15 /nobreak >nul
echo.

echo [4/4] 正在打开「网页控制台」窗口...
start "网页控制台（不要关）" cmd /k "cd /d %~dp0web && if not exist node_modules call npm install && npm run dev"
echo.

echo ========================================
echo   启动完成
echo ========================================
echo.
echo 请查看「网页控制台」窗口，找到一行：Local: http://localhost:XXXX
echo 在浏览器地址栏输入：该地址 + /demo.html
echo 例如：http://localhost:3005/demo.html
echo.
pause
