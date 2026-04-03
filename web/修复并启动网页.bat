@echo off
chcp 65001 >nul
title 修复并启动网页控制台
cd /d "%~dp0"

echo 正在结束占用端口的 Node 进程...
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul

echo 正在清理 .next 缓存...
if exist .next rmdir /s /q .next
echo 已清理。

echo.
echo 正在启动开发服务器（端口 3001）...
echo 启动成功后请在浏览器打开: http://localhost:3001
echo 若仍打不开，请查看本窗口是否有报错。
echo.
npm run dev
pause
