@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo ========================================
echo   打包 vip-lobster.exe
echo ========================================
echo.
echo 说明：pkg 会从 GitHub 下载约 50MB，国内网络可能很慢或卡在 0%%
echo 若卡住超过 5 分钟或窗口闪退，请打开「打包exe_卡住或闪退时看这里.txt」
echo.
echo 正在执行，请勿关闭本窗口...
echo.

set PKG_CACHE_PATH=%cd%\pkg-cache
if not exist "pkg-cache" mkdir pkg-cache

npx --yes pkg scripts/vip-build/vip-lobster-entry.cjs --targets node18-win-x64 --output dist/vip-lobster.exe 2>&1
set PKG_EXIT=%errorlevel%

if exist "dist\vip-lobster.exe" (
  copy /y "dist\vip-lobster.exe" "%~dp0vip-lobster.exe"
  copy /y "scripts\vip-build\.env.vip" "%~dp0.env.vip"
  echo.
  echo [成功] 已生成：本文件夹下的 vip-lobster.exe 与 .env.vip
) else (
  echo.
  echo [未成功] 未生成 exe，退出码 %PKG_EXIT%
  echo 请查看上方报错，或打开「打包exe_卡住或闪退时看这里.txt」用便携版。
)

echo.
pause
