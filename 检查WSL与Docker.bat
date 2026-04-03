@echo off
chcp 65001 >nul
title 前置检查：WSL 2 与 Docker Desktop
echo.
echo ========== 1. WSL ==========
wsl --status 2>nul
if errorlevel 1 (
  echo [未安装] 请以管理员身份运行 PowerShell，执行: wsl --install
) else (
  echo [已安装] 正在列出发行版...
  wsl -l -v 2>nul
)
echo.
echo ========== 2. Docker ==========
docker version 2>nul
if errorlevel 1 (
  echo [未就绪] 请安装 Docker Desktop 并确保已启动。
  echo 下载: https://www.docker.com/products/docker-desktop/
) else (
  echo [已就绪] Docker 可用。
)
echo.
echo ========== 3. WSL Integration ==========
echo 请在 Docker Desktop 中确认：Settings - Resources - WSL Integration 已开启。
echo.
pause
