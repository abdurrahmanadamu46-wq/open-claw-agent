# Docker Desktop 默认数据目录固定到 F 盘（防升级回滚）

适用系统：Windows + Docker Desktop（WSL2 后端）  
目标：把 Docker 大文件长期固定到 `F:\openclaw-agent\docker-data\wsl`，避免 Docker Desktop 升级后回写到 C 盘。

---

## 1. 推荐方案（可重复执行）

项目已提供一键脚本：

```powershell
npm run docker:data:f:pin
```

脚本位置：

`/scripts/docker/pin-docker-data-to-f.ps1`

它会自动做以下动作：

1. 停止 Docker 相关进程 + `wsl --shutdown`  
2. 把 `C:\Users\<你>\AppData\Local\Docker\wsl` 复制到 `F:\openclaw-agent\docker-data\wsl`  
3. 把原目录改名为 `wsl.bak`  
4. 创建目录联接（junction）：
   - `C:\Users\<你>\AppData\Local\Docker\wsl -> F:\openclaw-agent\docker-data\wsl`
5. 重启 Docker Desktop 并等待 `docker info` 就绪

如果你确认迁移稳定后希望自动删除备份：

```powershell
npm run docker:data:f:pin:cleanup
```

---

## 2. 手工命令（无 npm 时）

```powershell
powershell -ExecutionPolicy Bypass -File scripts/docker/pin-docker-data-to-f.ps1
```

---

## 3. 升级后巡检（每次 Docker Desktop 升级后执行）

### A. 检查联接是否还在

```powershell
cmd /c "dir %LOCALAPPDATA%\Docker"
```

预期输出里存在：

`wsl    <JUNCTION> [F:\openclaw-agent\docker-data\wsl]`

### B. 检查数据文件是否在 F 盘持续增长

```powershell
Get-Item "F:\openclaw-agent\docker-data\wsl\disk\docker_data.vhdx" | Select-Object FullName,Length,LastWriteTime
```

### C. 检查 Docker 可用

```powershell
docker info
docker compose ps
```

---

## 4. 回滚方案（需要恢复到 C 盘时）

1. 停 Docker + WSL：

```powershell
wsl --shutdown
```

2. 删除联接：

```powershell
cmd /c "rmdir %LOCALAPPDATA%\Docker\wsl"
```

3. 把 `wsl.bak` 改回 `wsl`：

```powershell
cmd /c "ren %LOCALAPPDATA%\Docker\wsl.bak wsl"
```

4. 启动 Docker Desktop 并验证：

```powershell
docker info
```

---

## 5. 注意事项

1. 迁移期间不要同时运行 `docker compose up`。  
2. `wsl.bak` 是回滚兜底，确认稳定后再删除。  
3. 目标路径建议固定在项目下：
   - `F:\openclaw-agent\docker-data\wsl`
4. 团队机器统一执行此文档，避免不同人把 Docker 数据写回 C 盘导致排障困难。
