@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist "scripts\vip-build\.env.vip" (
  echo 请先复制 .env.vip.example 为 .env.vip 并填写 TOKEN 与 MACHINE_CODE
  pause
  exit /b 1
)
node scripts\vip-build\vip-lobster-entry.cjs
pause
