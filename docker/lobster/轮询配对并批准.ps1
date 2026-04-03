# 轮询设备配对请求并批准（Web 控制台用 devices，不是 nodes）
$seconds = 60
$interval = 2
Write-Host "请在 10 秒内到浏览器打开 http://localhost:18789/ 并点击「需要配对」或「连接」" -ForegroundColor Yellow
Write-Host ""
Start-Sleep -Seconds 10
for ($i = 0; $i -lt ($seconds / $interval); $i++) {
    $out = docker exec lobster-openclaw openclaw devices list 2>&1 | Out-String
    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] devices list: $($out.Trim())"
    if ($out -match "Pending") {
        Write-Host ""
        Write-Host "发现待批准设备请求，尝试一键批准最新一条 (devices approve --latest)..." -ForegroundColor Green
        docker exec lobster-openclaw openclaw devices approve --latest 2>&1
        Write-Host "请回到浏览器刷新或再点「连接」。" -ForegroundColor Green
        break
    }
    Start-Sleep -Seconds $interval
}
Write-Host "轮询结束。"
