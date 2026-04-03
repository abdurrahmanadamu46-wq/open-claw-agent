@echo off
chcp 65001 >nul
title 自带技能的龙虾（Docker）
cd /d "%~dp0"
set REPO_ROOT=%~dp0..\..
cd /d "%REPO_ROOT%"

echo ========================================
echo   自带技能的龙虾 — Docker 一键启动
echo   OpenClaw + CLI-Anything + RAG-Anything
echo ========================================
echo.

docker compose -f docker/lobster/docker-compose.yml up -d --build
if errorlevel 1 (
  echo.
  echo 若报错，请确认已安装 Docker Desktop 并已启动。
  pause
  exit /b 1
)

echo.
echo 启动完成。Gateway 端口：18789
echo 健康检查：http://localhost:18789/healthz
echo.
pause
