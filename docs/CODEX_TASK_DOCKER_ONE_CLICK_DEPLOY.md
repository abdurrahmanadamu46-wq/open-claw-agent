# Codex 任务：CODEX-DCIM-03 — 部署体系整合（云端 + 边缘客户端）

> **来源**：借鉴 [openclaw-docker-cn-im](https://github.com/justlovemaki/openclaw-docker-cn-im) 的一键部署体验
> **优先级**：🟡 P1 | **算力**：中 | **预计耗时**：4-5小时
> **前置依赖**：无（可独立推进）

---

## ⚠️ 核心区分：两个完全不同的部署对象

```
┌─────────────────────────────────────────────────────────────┐
│  部署对象 A: 云端 SaaS 平台（你们的服务器）                   │
│  ──────────────────────────────────────────                  │
│  内容: Dragon Senate + 9龙虾 + 5微服务 + Backend + Web      │
│  安装方式: Docker Compose 一键部署                           │
│  使用者: 你们的运维/开发团队                                  │
│  规模: 1 套服务器 → 服务 N 个客户                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  部署对象 B: 边缘客户端（客户的电脑/手机）                    │
│  ──────────────────────────────────────                      │
│  内容: 极轻量 — WSS接收+指纹浏览器+账号登录+转发视频         │
│        +监控评论/私信+信息反馈                               │
│  安装方式: 单文件安装包 (.exe/.dmg/.apk)，不需要 Docker      │
│  使用者: 客户（非技术人员）                                  │
│  规模: 每客户 1~多台设备，全网可能千千万万个                  │
│  大小: < 50MB                                                │
│  要求: 10秒安装，1分钟上手                                   │
└─────────────────────────────────────────────────────────────┘
```

**绝不能搞混！** 客户不需要安装 Docker，不需要知道什么是 Redis/Qdrant。

---

## Part A：云端 SaaS 一键部署（给你们服务器）

### 任务 A1：创建全量 Docker Compose

**文件路径**: `docker-compose.full.yml`

```yaml
# 龙虾元老院 SaaS 平台 — 全量部署（仅用于你们的服务器）
# 用法: docker compose -f docker-compose.full.yml up -d

version: '3.8'

x-common-env: &common-env
  TZ: Asia/Shanghai
  REDIS_URL: redis://redis:6379/0

services:
  # ── 基础设施 ──
  redis:
    image: redis:7-alpine
    container_name: lobster-redis
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  qdrant:
    image: qdrant/qdrant:latest
    container_name: lobster-qdrant
    ports:
      - "${QDRANT_PORT:-6333}:6333"
    volumes:
      - qdrant-data:/qdrant/storage
    restart: unless-stopped

  # ── L1 云端 Brain ──
  dragon-senate:
    build:
      context: ./dragon-senate-saas-v2
      dockerfile: Dockerfile
    container_name: dragon-senate
    environment:
      <<: *common-env
      API_KEY: ${API_KEY}
      BASE_URL: ${BASE_URL}
      MODEL_ID: ${MODEL_ID:-gpt-4o}
      API_PROTOCOL: ${API_PROTOCOL:-openai}
      FEISHU_ENABLED: ${FEISHU_ENABLED:-false}
      DINGTALK_ENABLED: ${DINGTALK_ENABLED:-false}
      WECOM_ENABLED: ${WECOM_ENABLED:-false}
      AGENT_REACH_ENABLED: ${AGENT_REACH_ENABLED:-false}
      POLICY_ROUTER_URL: http://policy-router:8010
      LOBSTER_MEMORY_URL: http://lobster-memory:8000
      TRUST_VERIFY_URL: http://trust-verification:8020
      CTI_ENGINE_URL: http://cti-engine:8030
      XAI_SCORER_URL: http://xai-scorer:8040
    ports:
      - "${DRAGON_SENATE_PORT:-18000}:18000"
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  # ── L1.5 支撑微服务 ──
  policy-router:
    build: { context: ./services/policy-router-service }
    container_name: policy-router
    environment: { <<: *common-env }
    ports: ["${POLICY_ROUTER_PORT:-8010}:8010"]
    depends_on: { redis: { condition: service_healthy } }
    restart: unless-stopped

  lobster-memory:
    build: { context: ./services/lobster-memory }
    container_name: lobster-memory
    environment: { QDRANT_HOST: qdrant, QDRANT_PORT: "6333" }
    ports: ["${LOBSTER_MEMORY_PORT:-8000}:8000"]
    depends_on: [qdrant]
    restart: unless-stopped

  trust-verification:
    build: { context: ./services/trust-verification-service }
    container_name: trust-verification
    ports: ["${TRUST_VERIFY_PORT:-8020}:8020"]
    restart: unless-stopped

  cti-engine:
    build: { context: ./services/cti-engine-service }
    container_name: cti-engine
    ports: ["${CTI_ENGINE_PORT:-8030}:8030"]
    restart: unless-stopped

  xai-scorer:
    build: { context: ./services/xai-scorer-service }
    container_name: xai-scorer
    ports: ["${XAI_SCORER_PORT:-8040}:8040"]
    restart: unless-stopped

  # ── L0 前端 + Backend ──
  backend:
    build: { context: ./backend }
    container_name: lobster-backend
    environment: { <<: *common-env, DRAGON_SENATE_URL: "http://dragon-senate:18000", PORT: "48789" }
    ports: ["${BACKEND_PORT:-48789}:48789"]
    depends_on: [dragon-senate]
    restart: unless-stopped

  web:
    build: { context: ./web }
    container_name: lobster-web
    environment: { NEXT_PUBLIC_API_URL: "http://backend:48789" }
    ports: ["${WEB_PORT:-3301}:3000"]
    depends_on: [backend]
    restart: unless-stopped

volumes:
  redis-data:
  qdrant-data:
```

### 任务 A2：创建开发用精简版

**文件路径**: `docker-compose.dev.yml`

```yaml
# 开发模式 — 仅基础设施
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    container_name: lobster-redis-dev
    ports: ["6379:6379"]
    restart: unless-stopped
  qdrant:
    image: qdrant/qdrant:latest
    container_name: lobster-qdrant-dev
    ports: ["6333:6333"]
    restart: unless-stopped
```

### 任务 A3：创建快速启动脚本

**文件路径**: `deploy/server-start.sh` + `deploy/server-start.bat`

（脚本内容与之前相同，但重命名为 `server-start` 以区分这是给服务器用的）

---

## Part B：边缘客户端打包（给客户安装）

### 设计原则

```
边缘客户端 = 极轻量的"提线木偶"

✅ 客户需要的：
  1. 接收云端指令（WSS 长连接）
  2. 登录社交账号（指纹浏览器隔离环境）
  3. 转发/发布视频（自动化操作）
  4. 监控新评论（实时感知）
  5. 监控新私信（实时感知）
  6. 信息反馈（上报结果+事件）
  7. BBP 人类行为模拟（不被平台检测）

❌ 客户不需要的：
  - Docker
  - Python/Node 环境
  - Redis/Qdrant
  - 9只龙虾/Commander（那些在云端）
  - 任何业务决策逻辑
```

### 任务 B1：定义边缘客户端模块结构

**文件路径**: `edge-runtime/CLIENT_ARCHITECTURE.md`

```markdown
# 🦞 龙虾边缘客户端 — 架构设计

## 模块清单

| 模块 | 文件 | 职责 | 状态 |
|------|------|------|------|
| **WSS Receiver** | `wss_receiver.py` | 接收云端 JSON 剧本指令 | ✅ 已有 |
| **Context Navigator** | `context_navigator.py` | DOM/选择器解析 → 目标坐标 | ✅ 已有 |
| **Marionette Executor** | `marionette_executor.py` | 提线木偶：执行自动化动作 | ✅ 已有 |
| **BBP Kernel** | `bbp_kernel.py` | 生物行为物理引擎（贝塞尔+高斯+菲茨） | ⚠️ 需补 |
| **Memory Consolidator** | `memory_consolidator.py` | Token 预算记忆归纳 | ✅ 已有 |
| **Fingerprint Browser** | `fingerprint_manager.py` | 指纹浏览器管理（创建/切换/隔离） | ❌ 需建 |
| **Account Manager** | `account_manager.py` | 社交账号登录/Cookie管理/会话保持 | ❌ 需建 |
| **Event Watcher** | `event_watcher.py` | 监控新评论/新私信/新粉丝 | ❌ 需建 |
| **Event Reporter** | `event_reporter.py` | 打包事件 → WSS 上报云端 | ❌ 需建 |
| **Video Operator** | `video_operator.py` | 视频转发/发布/互动 | ❌ 需建 |
| **Heartbeat** | `heartbeat.py` | 心跳保活 + 状态上报 | ⚠️ 需补 |
| **Auto Updater** | `auto_updater.py` | 客户端自动更新 | ❌ 需建 |

## 客户端运行流程

```
启动 → 连接 WSS → 上报设备指纹 → 等待指令
  │
  ├── 收到 "login" 指令 → 打开指纹浏览器 → 登录账号
  ├── 收到 "forward_video" 指令 → BBP模拟 → 转发视频
  ├── 收到 "monitor_start" 指令 → 启动评论/私信监控
  │     └── 发现新评论 → 打包事件 → WSS 上报云端
  │     └── 发现新私信 → 打包事件 → WSS 上报云端
  ├── 收到 "reply_comment" 指令 → BBP模拟 → 回复评论
  ├── 收到 "send_dm" 指令 → BBP模拟 → 发送私信
  └── 心跳定时上报状态
```

## 打包方案

| 方案 | 优点 | 缺点 | 推荐场景 |
|------|------|------|---------|
| **PyInstaller** | Python 直接打包为 .exe | 体积较大(~80MB) | MVP 快速验证 |
| **Electron + Python后端** | 有 GUI，跨平台 | 体积大(~150MB) | 需要 GUI 时 |
| **Tauri + Python后端** | 极小(~10MB壳)，但需Rust | 开发复杂 | 追求极致体积 |
| **纯 Python + 系统托盘** | 最轻(~30MB)，无前端依赖 | 无GUI | 后台无感运行 |

**推荐 MVP**: PyInstaller 打包为单 .exe，系统托盘图标，无浏览器 UI。
```

### 任务 B2：创建事件监控器

**文件路径**: `edge-runtime/event_watcher.py`

```python
"""
EventWatcher — 边缘客户端事件监控器

职责：
1. 定时轮询社交平台页面，检测新评论/新私信/新粉丝
2. 将新事件打包为标准格式
3. 通过 WSS 上报云端

支持的事件类型:
- comment_event: 新评论
- dm_event: 新私信
- follower_event: 新粉丝
- metrics_event: 数据变化（播放量/点赞数）
- risk_event: 异常（被限流/被举报）
"""
from __future__ import annotations

import asyncio
import time
import json
from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Awaitable


@dataclass(slots=True)
class EdgeEvent:
    """边缘上报事件的统一格式"""
    event_type: str           # "comment_event" | "dm_event" | "follower_event" | ...
    platform: str             # "douyin" | "xiaohongshu" | "kuaishou" | ...
    account_id: str           # 监控的账号ID
    timestamp: float = 0.0    # 事件发生时间
    data: dict[str, Any] = field(default_factory=dict)  # 事件详情
    
    def __post_init__(self):
        if self.timestamp == 0.0:
            self.timestamp = time.time()
    
    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


class EventWatcher:
    """
    事件监控器 — 在边缘客户端运行
    
    工作模式:
    1. 定时轮询: 每 N 秒检查一次页面变化
    2. 变化检测: 对比上次快照，发现新内容
    3. 事件上报: 通过回调函数(通常是 WSS 发送)上报
    
    使用:
        watcher = EventWatcher(on_event=my_wss_send)
        watcher.add_watch("douyin", "account_123", watch_type="comments", interval=30)
        await watcher.start()
    """

    def __init__(self, on_event: Callable[[EdgeEvent], Awaitable[None]] | None = None) -> None:
        self._watches: list[dict[str, Any]] = []
        self._running: bool = False
        self._on_event = on_event
        self._snapshots: dict[str, Any] = {}  # 上次检查的快照

    def add_watch(
        self,
        platform: str,
        account_id: str,
        *,
        watch_type: str = "comments",  # "comments" | "dms" | "followers" | "metrics"
        interval: int = 30,            # 轮询间隔（秒）
        page_url: str = "",            # 要监控的页面URL（可选）
    ) -> None:
        """添加一个监控项"""
        self._watches.append({
            "platform": platform,
            "account_id": account_id,
            "watch_type": watch_type,
            "interval": interval,
            "page_url": page_url,
            "last_check": 0.0,
        })

    def remove_watch(self, platform: str, account_id: str, watch_type: str = "") -> int:
        """移除监控项，返回移除的数量"""
        before = len(self._watches)
        self._watches = [
            w for w in self._watches
            if not (w["platform"] == platform 
                    and w["account_id"] == account_id
                    and (not watch_type or w["watch_type"] == watch_type))
        ]
        return before - len(self._watches)

    async def start(self) -> None:
        """启动监控循环"""
        self._running = True
        print(f"[event_watcher] 启动监控，{len(self._watches)} 个监控项")
        
        while self._running:
            now = time.time()
            
            for watch in self._watches:
                if now - watch["last_check"] >= watch["interval"]:
                    watch["last_check"] = now
                    try:
                        await self._check_watch(watch)
                    except Exception as exc:
                        print(f"[event_watcher] 检查失败 {watch['platform']}/{watch['watch_type']}: {exc}")
            
            await asyncio.sleep(1)  # 主循环 1 秒检查一次是否有到期的监控项

    def stop(self) -> None:
        """停止监控"""
        self._running = False
        print("[event_watcher] 停止监控")

    async def _check_watch(self, watch: dict[str, Any]) -> None:
        """检查单个监控项（由子类或外部注入具体检查逻辑）"""
        watch_key = f"{watch['platform']}:{watch['account_id']}:{watch['watch_type']}"
        
        # 这里是框架代码 — 具体的页面解析逻辑由 Marionette Executor 执行
        # EventWatcher 只负责调度和事件打包
        # 实际检查会通过 context_navigator + marionette_executor 完成
        
        # 示例：检测到新评论
        # new_items = await self._detect_new_items(watch)
        # for item in new_items:
        #     event = EdgeEvent(
        #         event_type=f"{watch['watch_type']}_event",
        #         platform=watch["platform"],
        #         account_id=watch["account_id"],
        #         data=item,
        #     )
        #     if self._on_event:
        #         await self._on_event(event)

    def describe(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "watches": len(self._watches),
            "details": [
                {"platform": w["platform"], "account": w["account_id"], 
                 "type": w["watch_type"], "interval": w["interval"]}
                for w in self._watches
            ],
        }
```

### 任务 B3：创建事件上报器

**文件路径**: `edge-runtime/event_reporter.py`

```python
"""
EventReporter — 事件上报器

将 EdgeEvent 通过 WSS 上报云端。
支持:
- 实时上报（WSS连接正常时）
- 缓存队列（WSS断线时本地缓存，重连后批量上报）
- 去重（相同事件不重复上报）
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from typing import Any

from event_watcher import EdgeEvent


class EventReporter:
    """
    事件上报器
    
    WSS 正常 → 直接发送
    WSS 断线 → 入缓存队列（最多 1000 条）
    WSS 重连 → 批量上报缓存
    """

    def __init__(self, wss_send: Any = None, max_queue: int = 1000) -> None:
        self._wss_send = wss_send  # WebSocket send 函数
        self._queue: deque[EdgeEvent] = deque(maxlen=max_queue)
        self._reported_ids: set[str] = set()  # 去重
        self._stats = {"sent": 0, "queued": 0, "deduped": 0}

    def set_wss_send(self, wss_send: Any) -> None:
        """设置/更新 WSS 发送函数"""
        self._wss_send = wss_send

    async def report(self, event: EdgeEvent) -> bool:
        """上报一个事件"""
        # 去重
        event_id = f"{event.event_type}:{event.platform}:{event.account_id}:{event.timestamp}"
        if event_id in self._reported_ids:
            self._stats["deduped"] += 1
            return False
        self._reported_ids.add(event_id)
        
        # 清理过老的去重记录（保留最近 5000 条）
        if len(self._reported_ids) > 5000:
            self._reported_ids = set(list(self._reported_ids)[-2500:])
        
        # 尝试 WSS 发送
        if self._wss_send:
            try:
                message = {
                    "type": "edge_event",
                    "payload": event.to_dict(),
                }
                await self._wss_send(json.dumps(message, ensure_ascii=False))
                self._stats["sent"] += 1
                return True
            except Exception:
                pass
        
        # WSS 不可用 → 入队列
        self._queue.append(event)
        self._stats["queued"] += 1
        return False

    async def flush_queue(self) -> int:
        """批量上报缓存中的事件（WSS 重连后调用）"""
        if not self._wss_send or not self._queue:
            return 0
        
        sent = 0
        while self._queue:
            event = self._queue.popleft()
            try:
                message = {
                    "type": "edge_event_batch",
                    "payload": event.to_dict(),
                }
                await self._wss_send(json.dumps(message, ensure_ascii=False))
                sent += 1
            except Exception:
                self._queue.appendleft(event)  # 放回队列
                break
        
        self._stats["sent"] += sent
        return sent

    def describe(self) -> dict[str, Any]:
        return {
            "queue_size": len(self._queue),
            "stats": dict(self._stats),
            "wss_connected": self._wss_send is not None,
        }
```

### 任务 B4：创建客户端入口和打包配置

**文件路径**: `edge-runtime/client_main.py`

```python
"""
🦞 龙虾边缘客户端 — 主入口

这是安装在客户设备上的极轻量客户端。
功能：
1. 连接云端 WSS
2. 接收并执行指令（登录/转发/监控/回复）
3. 监控评论和私信
4. 上报事件和执行结果

用法:
  python client_main.py --server wss://your-server.com/ws/edge --token YOUR_TOKEN
  
打包:
  pyinstaller --onefile --name lobster-edge client_main.py
"""
from __future__ import annotations

import asyncio
import argparse
import signal
import sys
from typing import Any


async def main(server_url: str, token: str) -> None:
    """客户端主循环"""
    from wss_receiver import WSSReceiver
    from event_watcher import EventWatcher
    from event_reporter import EventReporter
    from marionette_executor import MarionetteExecutor
    from context_navigator import ContextNavigator
    
    print("🦞 龙虾边缘客户端启动中...")
    print(f"   服务器: {server_url}")
    
    # 初始化组件
    reporter = EventReporter()
    watcher = EventWatcher(on_event=reporter.report)
    navigator = ContextNavigator()
    executor = MarionetteExecutor()
    
    # 连接 WSS
    receiver = WSSReceiver(
        server_url=server_url,
        token=token,
        on_command=lambda cmd: handle_command(cmd, executor, navigator, watcher),
    )
    
    reporter.set_wss_send(receiver.send)
    
    # 启动所有组件
    tasks = [
        asyncio.create_task(receiver.connect()),
        asyncio.create_task(watcher.start()),
    ]
    
    print("✅ 客户端已启动，等待云端指令...")
    
    # 等待直到中断
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        watcher.stop()
        print("🛑 客户端已停止")


async def handle_command(command: dict[str, Any], executor: Any, navigator: Any, watcher: Any) -> None:
    """处理从云端收到的指令"""
    cmd_type = command.get("type", "")
    
    if cmd_type == "login":
        # 打开指纹浏览器 → 登录账号
        pass
    elif cmd_type == "forward_video":
        # BBP模拟 → 转发视频
        pass
    elif cmd_type == "monitor_start":
        # 启动评论/私信监控
        platform = command.get("platform", "")
        account_id = command.get("account_id", "")
        watcher.add_watch(platform, account_id, watch_type="comments", interval=30)
        watcher.add_watch(platform, account_id, watch_type="dms", interval=30)
    elif cmd_type == "monitor_stop":
        # 停止监控
        platform = command.get("platform", "")
        account_id = command.get("account_id", "")
        watcher.remove_watch(platform, account_id)
    elif cmd_type == "reply_comment":
        # BBP模拟 → 回复评论
        pass
    elif cmd_type == "send_dm":
        # BBP模拟 → 发送私信
        pass
    else:
        print(f"[client] 未知指令类型: {cmd_type}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="🦞 龙虾边缘客户端")
    parser.add_argument("--server", required=True, help="WSS 服务器地址")
    parser.add_argument("--token", required=True, help="设备认证 Token")
    args = parser.parse_args()
    
    asyncio.run(main(args.server, args.token))
```

**文件路径**: `edge-runtime/build.spec` (PyInstaller 打包配置)

```python
# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 打包配置
# 用法: pyinstaller build.spec

a = Analysis(
    ['client_main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'wss_receiver',
        'context_navigator',
        'marionette_executor',
        'memory_consolidator',
        'event_watcher',
        'event_reporter',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter', 'unittest', 'email', 'xml'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='lobster-edge',
    debug=False,
    strip=True,
    upx=True,
    console=False,  # 无控制台窗口（托盘运行）
    icon='lobster.ico',  # 龙虾图标
)
```

---

## 确保不覆盖现有内容

**关键规则**：
1. 根目录下已有 `docker-compose.yml`、`docker-compose.backend.yml` 等文件 — **不要修改或删除**
2. 新建的文件使用 `.full.yml` 和 `.dev.yml` 后缀以区分
3. 现有的 `.bat` 脚本 — **不要修改**
4. `edge-runtime/` 下已有的 `wss_receiver.py`、`context_navigator.py`、`marionette_executor.py`、`memory_consolidator.py` — **不要修改**，只追加新文件
5. 根目录 `.env.example` 如果已存在，**追加**缺失内容而非覆盖

---

## 验证标准

### Part A（云端）
1. ✅ `docker-compose.full.yml` 包含所有服务
2. ✅ `docker-compose.dev.yml` 仅 redis + qdrant
3. ✅ `deploy/server-start.sh` + `.bat` 可用
4. ✅ 不覆盖任何现有文件

### Part B（边缘客户端）
1. ✅ `edge-runtime/CLIENT_ARCHITECTURE.md` 清晰定义客户端模块
2. ✅ `edge-runtime/event_watcher.py` — 事件监控器（评论/私信/粉丝）
3. ✅ `edge-runtime/event_reporter.py` — WSS 事件上报（含断线缓存）
4. ✅ `edge-runtime/client_main.py` — 客户端主入口
5. ✅ `edge-runtime/build.spec` — PyInstaller 打包配置
6. ✅ 所有新增文件不修改已有的 wss_receiver/context_navigator/marionette_executor

---

## 文件清单

```
# Part A: 云端部署
docker-compose.full.yml          # 新建
docker-compose.dev.yml           # 新建
deploy/server-start.sh           # 新建
deploy/server-start.bat          # 新建

# Part B: 边缘客户端
edge-runtime/CLIENT_ARCHITECTURE.md  # 新建 — 客户端架构文档
edge-runtime/event_watcher.py        # 新建 — 事件监控器
edge-runtime/event_reporter.py       # 新建 — 事件上报器
edge-runtime/client_main.py          # 新建 — 客户端主入口
edge-runtime/build.spec              # 新建 — PyInstaller 打包配置

# 不修改
docker-compose.yml                   # 不修改
docker-compose.backend.yml           # 不修改
一键启动.bat                         # 不修改
edge-runtime/wss_receiver.py         # 不修改
edge-runtime/context_navigator.py    # 不修改
edge-runtime/marionette_executor.py  # 不修改
edge-runtime/memory_consolidator.py  # 不修改
```
