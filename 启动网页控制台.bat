@echo off
chcp 65001 >nul
title 网页控制台（不要关）
cd /d "%~dp0web"
if not exist "node_modules" (
  echo 首次运行，正在安装依赖，请稍等...
  call npm install
)
echo 正在启动网页，请稍等...
echo.
echo 启动成功后，请看下面会出现一行：Local: http://localhost:XXXX
echo 用浏览器打开那个地址，并在最后加上 /demo.html
echo 例如：http://localhost:3005/demo.html
echo.
npm run dev
pause
