# 前置准备：WSL 2 + Docker Desktop（含 WSL Integration）

本机已检测到 **WSL 2** 和 **Docker Desktop** 已安装，且 Docker 正在使用 WSL 2 后端。若你需要在其他电脑上从头安装，按下面步骤做即可。

---

## 一、安装 WSL 2

### 1. 用管理员 PowerShell 一键安装（推荐）

1. **以管理员身份**打开 PowerShell（右键“开始” → “Windows Terminal(管理员)”或“PowerShell(管理员)”）。
2. 执行：

```powershell
wsl --install
```

3. 按提示**重启电脑**。
4. 重启后首次会安装默认发行版（通常是 Ubuntu），按提示设用户名和密码。

### 2. 若已装过 WSL 但版本是 1，改为 WSL 2

```powershell
wsl --list --verbose
wsl --set-version <发行版名> 2
```

例如默认发行版是 Ubuntu 时：`wsl --set-version Ubuntu 2`。

### 3. 确认 WSL 2

```powershell
wsl --status
wsl -l -v
```

输出里 **VERSION** 为 **2** 即可。

---

## 二、安装 Docker Desktop

### 1. 下载与安装

1. 打开：<https://www.docker.com/products/docker-desktop/>
2. 下载 **Docker Desktop for Windows** 并安装。
3. 安装过程中若提示启用 WSL 2，选择 **Use WSL 2 based engine**。

### 2. 启用 WSL Integration（重要）

1. 打开 **Docker Desktop**。
2. 右上角 **齿轮图标** → **Settings** → **Resources** → **WSL Integration**。
3. 打开 **“Enable integration with my default WSL distro”**。
4. 若你有多个 WSL 发行版，可对需要的发行版（如 Ubuntu）单独开启 **Turn on**。
5. 点 **Apply & Restart**。

这样在 WSL 里可以直接用 `docker` 命令。

### 3. 确认 Docker 正常

在 **PowerShell** 或 **WSL** 里执行：

```powershell
docker version
docker run hello-world
```

能正常输出版本并跑通 hello-world 即表示安装成功。

---

## 三、本机当前状态（你可直接用的结论）

- **WSL 2**：已安装（当前默认发行版为 `docker-desktop`，VERSION 2）。
- **Docker Desktop**：已安装，引擎为 Linux（即使用 WSL 2 后端）。
- **WSL Integration**：Docker Desktop 安装时通常会为 `docker-desktop` 启用；若你之后安装了 Ubuntu 等发行版，在 Docker Desktop → Settings → WSL Integration 里为该发行版打开开关即可。

**无需再装一遍**，可直接进行后续步骤（例如运行龙虾 Docker、总控等）。若你希望有一个完整的 Linux 环境（如 Ubuntu）用于开发，可再执行：

```powershell
wsl --install -d Ubuntu
```

然后在 Docker Desktop 的 WSL Integration 里为 **Ubuntu** 开启集成。
