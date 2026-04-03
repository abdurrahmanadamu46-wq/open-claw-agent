@echo off
chcp 65001 >nul
title 龙虾网关 — 批准配对请求（Web 控制台用 devices）
echo.
echo 步骤 1：请在浏览器里先点一次「连接」，再回到本窗口按任意键继续。
pause >nul
echo.
echo 步骤 2：正在查询待批准的设备配对请求（devices list）...
echo.
docker exec lobster-openclaw openclaw devices list 2>&1
echo.
echo 若上面有 Pending 记录，复制 requestId 后执行：
echo   docker exec lobster-openclaw openclaw devices approve ^<requestId^>
echo 或一键批准最新一条：
echo   docker exec lobster-openclaw openclaw devices approve --latest
echo.
pause
