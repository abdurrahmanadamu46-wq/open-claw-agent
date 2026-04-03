@echo off
chcp 65001 >nul
title 启动 Redis
cd /d "%~dp0"

echo 请确保 Docker Desktop 已打开并就绪（托盘图标不再转圈）。
echo.
echo 正在启动 Redis（端口 6380）...
docker start openclaw-redis 2>nul
if errorlevel 1 (
  docker run -d -p 6380:6379 --name openclaw-redis redis:7-alpine
)
if errorlevel 1 (
  echo.
  echo 若报错 "cannot find the file specified" 或 "pipe/dockerDesktopLinuxEngine"：
  echo 1. 关闭本窗口，重新打开一个 PowerShell 或 cmd 再运行本脚本；
  echo 2. 或重启 Docker Desktop 后等 1 分钟再试。
) else (
  echo Redis 已启动，可运行「启动总控后端.bat」。
)
echo.
pause
