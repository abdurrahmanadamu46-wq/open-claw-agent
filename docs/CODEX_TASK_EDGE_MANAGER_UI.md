# CODEX-OCM-02: Edge Manager UI 壳 — 边缘客户端管理界面

> **优先级**: P0 | **算力**: 高 | **来源**: OpenClaw Manager 借鉴分析
> **分析文档**: `docs/OPENCLAW_MANAGER_BORROWING_ANALYSIS.md`

---

## 背景

OpenClaw Manager 用 Tauri 2.0 打包为跨平台桌面 App（双击安装、零依赖），提供服务状态监控、日志查看、安装向导、自动更新等完整的管理体验。

我们当前的 `edge-runtime/` 是纯 Python CLI 执行层，客户无法看到运行状态、无法管理、安装体验差。对于 SaaS 产品来说，边缘客户端的安装和管理体验直接影响客户留存。

## 目标

在 `edge-runtime/` 之上增加一层 **Edge Manager**，让客户能通过本地 Web 界面管理边缘执行器。采用 **PyWebView + Flask** 方案（与现有 Python 生态一致，可直接 PyInstaller 打包）。

## 交付物

### 1. `edge-runtime/edge_manager.py` — Flask 管理后端

```python
"""
Edge Manager — 边缘执行器本地管理后端

提供本地 Web API，供管理界面调用。
"""
from flask import Flask, jsonify, request
import threading, os, sys, json, time, subprocess

app = Flask(__name__, static_folder="manager_ui/dist", static_url_path="")

# ============ 状态管理 ============

class EdgeState:
    """边缘执行器运行状态"""
    def __init__(self):
        self.wss_connected: bool = False
        self.wss_server_url: str = ""
        self.node_id: str = ""
        self.running: bool = False
        self.pid: int = os.getpid()
        self.start_time: float = time.time()
        self.tasks_completed: int = 0
        self.tasks_failed: int = 0
        self.current_task: str | None = None
        self.last_heartbeat: float = 0
        self.version: str = "0.1.0"
        self.logs: list = []  # 最近 500 条日志
    
    def add_log(self, level: str, message: str):
        self.logs.append({"ts": time.time(), "level": level, "msg": message})
        if len(self.logs) > 500:
            self.logs = self.logs[-500:]
    
    def to_dict(self):
        return {
            "wss_connected": self.wss_connected,
            "wss_server_url": self.wss_server_url,
            "node_id": self.node_id,
            "running": self.running,
            "pid": self.pid,
            "uptime_seconds": int(time.time() - self.start_time),
            "tasks_completed": self.tasks_completed,
            "tasks_failed": self.tasks_failed,
            "current_task": self.current_task,
            "last_heartbeat": self.last_heartbeat,
            "version": self.version,
        }

state = EdgeState()

# ============ API 端点 ============

@app.route("/")
def index():
    return app.send_static_file("index.html")

@app.route("/api/status")
def get_status():
    return jsonify(state.to_dict())

@app.route("/api/logs")
def get_logs():
    limit = request.args.get("limit", 100, type=int)
    level = request.args.get("level", None)
    logs = state.logs[-limit:]
    if level:
        logs = [l for l in logs if l["level"] == level]
    return jsonify(logs)

@app.route("/api/config", methods=["GET"])
def get_config():
    """获取当前配置"""
    config_path = os.path.expanduser("~/.openclaw-edge/config.json")
    if os.path.exists(config_path):
        with open(config_path) as f:
            return jsonify(json.load(f))
    return jsonify({"server_url": "", "node_id": "", "auth_token": ""})

@app.route("/api/config", methods=["PUT"])
def save_config():
    """保存配置"""
    config = request.json
    config_dir = os.path.expanduser("~/.openclaw-edge")
    os.makedirs(config_dir, exist_ok=True)
    config_path = os.path.join(config_dir, "config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    return jsonify({"success": True, "message": "配置已保存"})

@app.route("/api/service/start", methods=["POST"])
def start_service():
    """启动执行器"""
    # 启动 edge-runtime 主进程
    state.running = True
    state.add_log("info", "执行器已启动")
    return jsonify({"success": True})

@app.route("/api/service/stop", methods=["POST"])
def stop_service():
    """停止执行器"""
    state.running = False
    state.add_log("info", "执行器已停止")
    return jsonify({"success": True})

@app.route("/api/service/restart", methods=["POST"])
def restart_service():
    """重启执行器"""
    state.running = False
    time.sleep(1)
    state.running = True
    state.add_log("info", "执行器已重启")
    return jsonify({"success": True})

@app.route("/api/test/connection", methods=["POST"])
def test_connection():
    """测试与云端的连接"""
    config = request.json or {}
    server_url = config.get("server_url", state.wss_server_url)
    # TODO: 实际测试 WSS 连接
    return jsonify({"success": True, "message": f"连接 {server_url} 成功", "latency_ms": 42})

@app.route("/api/version")
def get_version():
    return jsonify({"version": state.version, "python": sys.version})
```

### 2. `edge-runtime/manager_ui/` — 前端管理界面

创建一个极简的单页 HTML + JS 管理界面（不依赖 Node.js 构建），包含：

- **状态面板** (Dashboard)：WSS 连接状态、运行时间、已完成/失败任务数、当前任务
- **配置页面** (Config)：云端服务器 URL、节点 ID、认证 Token
- **日志查看** (Logs)：实时日志流、按级别筛选（info/warn/error）
- **连接测试** (Test)：一键测试云端连接、显示延迟

技术栈：纯 HTML + CSS + Vanilla JS（或 Alpine.js），无需 npm 构建。

### 3. `edge-runtime/client_main.py` — 统一客户端入口

```python
"""
OpenClaw Edge Client — 统一入口

启动 Edge Manager Web UI + edge-runtime 执行器。
"""
import threading, webbrowser, sys

def main():
    port = 18080
    
    # 启动 Flask 管理后端
    from edge_manager import app, state
    
    def run_flask():
        app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
    
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    
    # 打开浏览器
    webbrowser.open(f"http://127.0.0.1:{port}")
    
    print(f"🦞 OpenClaw Edge Manager 已启动: http://127.0.0.1:{port}")
    print("按 Ctrl+C 退出")
    
    try:
        flask_thread.join()
    except KeyboardInterrupt:
        print("\n🦞 再见！")
        sys.exit(0)

if __name__ == "__main__":
    main()
```

### 4. PyInstaller 打包配置

```
# edge-runtime/openclaw-edge.spec
# PyInstaller 打包脚本
# 目标: 生成 < 50MB 的单文件 .exe
```

### 5. 安装向导（首次启动）

首次启动检测 `~/.openclaw-edge/config.json` 是否存在，若不存在则展示安装向导页面引导用户配置：
1. 输入云端服务器 URL
2. 输入认证 Token（从 Web 控制台获取）
3. 测试连接
4. 完成配置

## 与已有代码的集成

- `edge_manager.py` 的 `state` 对象需要与 `wss_receiver.py` 对接，实时获取 WSS 连接状态
- `edge_manager.py` 的 `state.current_task` 需要与 `marionette_executor.py` 对接
- `edge_manager.py` 的日志需要与 `memory_consolidator.py` 共享

## 约束

- **不改动** `wss_receiver.py` / `context_navigator.py` / `marionette_executor.py` 的核心逻辑
- 管理界面是**补充层**，纯执行模式（无 UI）仍然可用
- 前端不使用 Node.js 构建，保持零依赖
- PyInstaller 打包后 < 50MB
- 只监听 `127.0.0.1`（安全）

## 验收标准

1. `python client_main.py` 启动后自动打开浏览器管理界面
2. 管理界面展示实时状态（WSS 连接、任务计数、运行时间）
3. 可通过界面修改配置并保存
4. 日志页面实时展示最近 100 条日志
5. 连接测试功能正常工作
6. 首次启动展示安装向导
7. `pyinstaller openclaw-edge.spec` 可打包为单文件 .exe
