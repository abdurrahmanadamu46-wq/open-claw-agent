@echo off
chcp 65001 >nul
title 打开龙虾仪表盘（带 Token）
:: 从容器读取 token 并打开带 token 的 URL（可能无需单独配对）
for /f "tokens=2 delims==" %%a in ('docker exec lobster-openclaw node -e "const c=require('/home/node/.openclaw/openclaw.json'); console.log(c.gateway.auth.token)" 2^>nul') do set TOKEN=%%a
if "%TOKEN%"=="" for /f "usebackq tokens=*" %%a in (`docker exec lobster-openclaw cat /home/node/.openclaw/openclaw.json 2^>nul ^| findstr /i "\"token\""`) do set TOKEN=%%a
:: 简单提取 token（取引号内内容）
for /f "tokens=3 delims=\": " %%a in ('docker exec lobster-openclaw cat /home/node/.openclaw/openclaw.json 2^>nul') do set TOKEN=%%a
docker exec lobster-openclaw openclaw dashboard --no-open 2>nul | findstr "http"
echo.
echo 若上面有 URL，请复制到浏览器打开；或直接打开：
echo http://localhost:18789/
echo 网关令牌已保存在容器内，若仍提示「需要配对」请按使用说明操作。
start "" "http://localhost:18789/"
pause
