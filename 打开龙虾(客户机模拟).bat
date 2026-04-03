@echo off
chcp 65001 >nul
title 龙虾（Open Claw）— 客户机模拟
cd /d "%~dp0"
echo 正在启动「龙虾」客户端（连到总控，等待任务）...
echo 若总控未启动，请先在本机双击「启动总控后端.bat」或「一键启动.bat」。
echo.
if not exist "scripts\vip-build\.env.vip" (
  echo 提示：未找到 scripts\vip-build\.env.vip，请从 scripts\vip-build\.env.vip.example 复制并填写。
  echo 或把「交付给客户\客户包_免exe」里的 .env.vip 复制到 scripts\vip-build\ 下。
  pause
  exit /b 1
)
call scripts\vip-build\启动VIP客户端.bat
