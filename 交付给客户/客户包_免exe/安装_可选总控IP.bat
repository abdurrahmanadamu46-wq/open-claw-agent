@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "IP=%~1"
if "%IP%"=="" set "IP=192.168.1.7"
echo 总控 IP: %IP%
echo.

REM 写入 .env.vip（只改 C_AND_C_SERVER_URL，其余保留）
powershell -NoProfile -Command "$ip='%IP%'; $f='.env.vip'; $url='C_AND_C_SERVER_URL=http://'+$ip+':3000/agent-cc'; if (Test-Path $f) { (Get-Content $f -Encoding UTF8) -replace '^C_AND_C_SERVER_URL=.*', $url | Set-Content $f -Encoding UTF8 } else { $url | Set-Content $f -Encoding UTF8; 'CLIENT_DEVICE_TOKEN=请填写' | Add-Content $f -Encoding UTF8; 'MACHINE_CODE=VIP-CLIENT-001' | Add-Content $f -Encoding UTF8 }"
echo 已写入 .env.vip 总控地址: http://%IP%:3000/agent-cc

REM 创建桌面快捷方式
set "BAT=%~dp0启动龙虾客户端.bat"
set "DESKTOP=%USERPROFILE%\Desktop\启动龙虾客户端.lnk"
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut('%DESKTOP%'); $s.TargetPath='%BAT%'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo 已在桌面创建快捷方式「启动龙虾客户端」.
echo.
echo 完成。请双击「启动龙虾客户端.bat」或桌面快捷方式运行。
pause
