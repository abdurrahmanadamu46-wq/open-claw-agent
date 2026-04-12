@echo off
chcp 65001 >nul
echo 请先在本文件夹的 .env.vip 或 env.vip 里确认 C_AND_C_SERVER_URL 的 IP 和端口（例如 192.168.1.100:3000）。
echo.
set /p TARGET=请输入总控地址（例如 192.168.1.7:3000）直接回车则用 192.168.1.7:3000：
if "%TARGET%"=="" set TARGET=192.168.1.7:3000
echo.
echo 正在测试 %TARGET% 是否可达...
powershell -Command "try { $r = Invoke-WebRequest -Uri \"http://%TARGET%\" -TimeoutSec 5 -UseBasicParsing; echo '  [成功] 端口通，状态码' $r.StatusCode } catch { echo '  [失败]' $_.Exception.Message; echo ''; echo '  多数是总控电脑未放行 3000 端口。请在总控电脑上以管理员打开 PowerShell 执行：'; echo '  New-NetFirewallRule -DisplayName ClawCommerce-3000 -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow'; echo '' }"
echo.
echo 若失败，请让总控电脑按「交付给客户\总控电脑必做清单.txt」做完 4 步后再测。
echo.
pause
