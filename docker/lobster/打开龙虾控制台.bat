@echo off
chcp 65001 >nul
title 打开龙虾控制台
set PORT=18789
if not "%LOBSTER_GATEWAY_PORT%"=="" set PORT=%LOBSTER_GATEWAY_PORT%
start "" "http://localhost:%PORT%/"
echo 已打开浏览器：http://localhost:%PORT%/
timeout /t 2 /nobreak >nul
