@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules" (
  echo 首次运行，正在安装依赖，请稍等...
  call npm install
)
node vip-lobster-entry.cjs
pause
