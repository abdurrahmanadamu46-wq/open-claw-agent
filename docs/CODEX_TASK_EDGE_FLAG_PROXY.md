# CODEX TASK: 边缘 Flag 代理 — 边缘节点本地缓存 + 离线自愈

**优先级：P1**  
**来源借鉴：Unleash Edge（Rust 边缘代理）本地缓存 + SSE 同步设计**  
**参考分析：`docs/UNLEASH_BORROWING_ANALYSIS.md` 第二节 2.4**

---

## 背景

Unleash Edge 是 Rust 实现的轻量边缘代理，边缘节点本地缓存全量 toggle 配置，断网时自愈。

我们的 edge-runtime 运行在客户本地机器，网络天然不稳定。当前龙虾行为控制依赖云端实时响应，网络抖动直接影响龙虾执行。借鉴 Unleash Edge 设计，让边缘节点的 Feature Flag 评估完全本地化。

---

## 任务目标

新建 `edge-runtime/feature_flag_proxy.py`：
- 边缘节点启动时从云端拉取 Flag 配置
- 本地内存缓存 + JSON 文件备份
- WebSocket 与云端同步（实时推送）
- 断网时使用本地备份（离线自愈）
- 按边缘节点 tag 过滤适用的 flag

---

## 一、新建 `edge-runtime/feature_flag_proxy.py`

```python
# feature_flag_proxy.py
# 边缘节点 Feature Flag 代理 — 本地缓存 + 离线自愈

import asyncio
import json
import os
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Any
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# ============================================================
# 数据模型（与云端 feature_flags.py 对齐）
# ============================================================

@dataclass
class EdgeFlagStrategy:
    type: str          # "all" | "gradualRollout" | "edgeNodeTag" | ...
    parameters: dict = field(default_factory=dict)

@dataclass
class EdgeFeatureFlag:
    name: str
    enabled: bool
    strategies: List[EdgeFlagStrategy] = field(default_factory=list)
    variants: list = field(default_factory=list)
    edge_node_tags: List[str] = field(default_factory=list)  # 适用的节点 tag（空=所有节点）
    updated_at: str = ""

@dataclass
class EdgeFlagContext:
    """边缘侧 Flag 评估上下文"""
    tenant_id: str = ""
    lobster_id: str = ""
    edge_node_id: str = ""
    edge_node_tags: List[str] = field(default_factory=list)

# ============================================================
# 边缘 Flag 代理核心
# ============================================================

class FeatureFlagProxy:
    """
    边缘节点 Feature Flag 代理
    
    工作流程：
      1. 启动 → 从云端 API 拉取全量 flag 配置
      2. 缓存到内存 + 写入 JSON 备份文件
      3. 保持 WebSocket 连接 → 云端 flag 变更时实时推送
      4. 收到推送 → 更新内存缓存 + 更新备份文件
      5. 断网时 → 使用内存缓存（或重启时从备份恢复）
      6. 重连后 → 增量同步（只拉取变更的 flag）
    """
    
    def __init__(
        self,
        cloud_api_url: str,       # 云端 Flag API 地址
        edge_node_id: str,        # 本节点 ID
        edge_node_tags: List[str], # 本节点 tag（如 ["prod", "region-south"]）
        api_token: str,           # 认证 token
        backup_dir: str = "config",
    ):
        self.cloud_api_url = cloud_api_url
        self.edge_node_id = edge_node_id
        self.edge_node_tags = edge_node_tags
        self.api_token = api_token
        self.backup_file = Path(backup_dir) / "feature_flags_edge_backup.json"
        
        self._flags: Dict[str, EdgeFeatureFlag] = {}
        self._lock = asyncio.Lock()
        self._connected = False
        self._last_sync: Optional[datetime] = None
        self._sync_interval = 30  # 轮询间隔（秒），作为 WebSocket 断线备用
    
    # ----------------------------------------
    # 初始化
    # ----------------------------------------
    
    async def start(self):
        """启动代理（在 edge-runtime 启动时调用）"""
        # 1. 先从备份文件恢复（保证 cold start 时有数据）
        await self._load_backup()
        
        # 2. 从云端拉取最新配置
        await self._pull_from_cloud()
        
        # 3. 启动 WebSocket 监听（后台任务）
        asyncio.create_task(self._ws_listener())
        
        # 4. 启动定时轮询（WebSocket 断线时的备用同步）
        asyncio.create_task(self._polling_loop())
        
        logger.info(f"FeatureFlagProxy started: {len(self._flags)} flags loaded")
    
    # ----------------------------------------
    # 核心评估（本地执行，< 1ms）
    # ----------------------------------------
    
    def is_enabled(self, flag_name: str, ctx: EdgeFlagContext) -> bool:
        """
        检查 flag 是否对当前上下文生效
        本地内存查找，< 1ms，无网络请求
        """
        flag = self._flags.get(flag_name)
        if not flag or not flag.enabled:
            return False
        
        # 检查节点 tag 过滤（该 flag 是否适用于本节点）
        if flag.edge_node_tags:
            if not set(flag.edge_node_tags) & set(self.edge_node_tags):
                return False  # 本节点 tag 不在适用列表
        
        # 评估策略
        for strategy in flag.strategies:
            if self._evaluate_strategy(strategy, ctx):
                return True
        return False
    
    def _evaluate_strategy(self, strategy: EdgeFlagStrategy, ctx: EdgeFlagContext) -> bool:
        if strategy.type == "all":
            return True
        elif strategy.type == "gradualRollout":
            rollout = int(strategy.parameters.get("rollout", 100))
            stickiness = strategy.parameters.get("stickiness", "tenant_id")
            value = ctx.tenant_id if stickiness == "tenant_id" else ctx.edge_node_id
            hash_int = int(hashlib.md5(value.encode()).hexdigest()[:8], 16)
            return (hash_int % 100) < rollout
        elif strategy.type == "tenantWhitelist":
            return ctx.tenant_id in strategy.parameters.get("tenant_ids", [])
        elif strategy.type == "edgeNodeTag":
            required = set(strategy.parameters.get("tags", []))
            return bool(required & set(self.edge_node_tags))
        return False
    
    # ----------------------------------------
    # 云端同步
    # ----------------------------------------
    
    async def _pull_from_cloud(self):
        """从云端 API 拉取全量 flag 配置"""
        try:
            import aiohttp
            url = f"{self.cloud_api_url}/api/v1/feature-flags/edge"
            params = {"node_id": self.edge_node_id, "tags": ",".join(self.edge_node_tags)}
            headers = {"Authorization": f"Bearer {self.api_token}"}
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, headers=headers, timeout=10) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        await self._update_flags(data["flags"])
                        self._last_sync = datetime.now()
                        await self._save_backup()
                        logger.info(f"Pulled {len(data['flags'])} flags from cloud")
                    else:
                        logger.warning(f"Flag sync failed: HTTP {resp.status}")
        except Exception as e:
            logger.warning(f"Flag sync error: {e} — using cached data")
    
    async def _ws_listener(self):
        """WebSocket 监听云端 flag 变更推送"""
        import aiohttp
        ws_url = self.cloud_api_url.replace("http", "ws") + "/api/v1/feature-flags/ws"
        
        while True:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.ws_connect(
                        ws_url,
                        headers={"Authorization": f"Bearer {self.api_token}"},
                        params={"node_id": self.edge_node_id}
                    ) as ws:
                        self._connected = True
                        logger.info("Flag WS connected")
                        
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                event = json.loads(msg.data)
                                await self._handle_ws_event(event)
                            elif msg.type == aiohttp.WSMsgType.ERROR:
                                break
                        
            except Exception as e:
                self._connected = False
                logger.warning(f"Flag WS disconnected: {e} — retrying in 10s")
                await asyncio.sleep(10)
    
    async def _handle_ws_event(self, event: dict):
        """处理云端推送的 flag 变更事件"""
        event_type = event.get("type")
        flag_data = event.get("flag")
        
        if event_type in ("FLAG_UPDATED", "FLAG_CREATED"):
            flag = EdgeFeatureFlag(**flag_data)
            async with self._lock:
                self._flags[flag.name] = flag
            await self._save_backup()
            logger.info(f"Flag updated: {flag.name} → enabled={flag.enabled}")
        
        elif event_type == "FLAG_DELETED":
            flag_name = event.get("name")
            async with self._lock:
                self._flags.pop(flag_name, None)
            await self._save_backup()
            logger.info(f"Flag deleted: {flag_name}")
    
    async def _polling_loop(self):
        """定时轮询（WebSocket 断线时的备用）"""
        while True:
            await asyncio.sleep(self._sync_interval)
            if not self._connected:
                await self._pull_from_cloud()
    
    # ----------------------------------------
    # 备份文件（离线自愈）
    # ----------------------------------------
    
    async def _save_backup(self):
        """保存到 JSON 备份文件"""
        try:
            self.backup_file.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "saved_at": datetime.now().isoformat(),
                "edge_node_id": self.edge_node_id,
                "flags": {name: {
                    "name": f.name,
                    "enabled": f.enabled,
                    "strategies": [{"type": s.type, "parameters": s.parameters} for s in f.strategies],
                } for name, f in self._flags.items()}
            }
            with open(self.backup_file, 'w', encoding='utf-8') as fp:
                json.dump(data, fp, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Flag backup save failed: {e}")
    
    async def _load_backup(self):
        """从备份文件恢复（cold start 保护）"""
        if not self.backup_file.exists():
            logger.info("No flag backup file found, starting fresh")
            return
        try:
            with open(self.backup_file, 'r', encoding='utf-8') as fp:
                data = json.load(fp)
            flags = {}
            for name, fd in data.get("flags", {}).items():
                strategies = [EdgeFlagStrategy(**s) for s in fd.get("strategies", [])]
                flags[name] = EdgeFeatureFlag(
                    name=fd["name"],
                    enabled=fd["enabled"],
                    strategies=strategies
                )
            async with self._lock:
                self._flags = flags
            logger.info(f"Restored {len(flags)} flags from backup (saved_at={data.get('saved_at')})")
        except Exception as e:
            logger.error(f"Flag backup load failed: {e}")
    
    async def _update_flags(self, flags_data: list):
        """批量更新内存缓存"""
        new_flags = {}
        for fd in flags_data:
            strategies = [EdgeFlagStrategy(**s) for s in fd.get("strategies", [])]
            flag = EdgeFeatureFlag(
                name=fd["name"],
                enabled=fd["enabled"],
                strategies=strategies,
                edge_node_tags=fd.get("edge_node_tags", [])
            )
            new_flags[flag.name] = flag
        async with self._lock:
            self._flags = new_flags
    
    # ----------------------------------------
    # 状态查询
    # ----------------------------------------
    
    def get_status(self) -> dict:
        return {
            "connected": self._connected,
            "last_sync": self._last_sync.isoformat() if self._last_sync else None,
            "flag_count": len(self._flags),
            "edge_node_id": self.edge_node_id,
            "edge_node_tags": self.edge_node_tags,
        }

# ============================================================
# 全局实例（边缘节点启动时初始化）
# ============================================================

_proxy: Optional[FeatureFlagProxy] = None

def init_flag_proxy(cloud_api_url: str, node_id: str, node_tags: List[str], token: str):
    global _proxy
    _proxy = FeatureFlagProxy(cloud_api_url, node_id, node_tags, token)
    return _proxy

def edge_ff_is_enabled(flag_name: str, ctx: EdgeFlagContext) -> bool:
    """边缘侧 flag 检查入口"""
    if _proxy is None:
        return True  # 未初始化时默认开启（fail open）
    return _proxy.is_enabled(flag_name, ctx)
```

---

## 二、集成到 edge-runtime 主流程

```python
# edge-runtime/wss_receiver.py 或 __init__.py 修改：

from feature_flag_proxy import init_flag_proxy, edge_ff_is_enabled, EdgeFlagContext

# 边缘节点启动时初始化
async def on_edge_startup(node_config: dict):
    proxy = init_flag_proxy(
        cloud_api_url=node_config["cloud_api_url"],
        node_id=node_config["node_id"],
        node_tags=node_config.get("tags", []),
        token=node_config["api_token"]
    )
    await proxy.start()

# 在 marionette_executor.py 任务执行前检查：
async def execute_task(task: dict):
    ctx = EdgeFlagContext(
        tenant_id=task["tenant_id"],
        lobster_id=task["lobster_id"],
        edge_node_id=current_node_id,
        edge_node_tags=current_node_tags
    )
    
    # 检查龙虾是否在本节点被允许执行
    if not edge_ff_is_enabled(f"lobster.{task['lobster_id']}.enabled", ctx):
        return {"status": "disabled", "reason": "feature_flag_edge"}
    
    # 执行任务...
```

---

## 三、云端 API 增加边缘专用端点

```
GET /api/v1/feature-flags/edge
  参数：node_id, tags（逗号分隔）
  返回：过滤后的 flag 列表（只返回适用于该节点的 flag）
  
WS  /api/v1/feature-flags/ws
  参数：node_id
  推送：flag 变更事件（FLAG_UPDATED/FLAG_CREATED/FLAG_DELETED）
```

---

## 四、验收标准

- [ ] `feature_flag_proxy.py` 实现完整
- [ ] 冷启动时从备份文件恢复，无网络也可正常运行
- [ ] WebSocket 断线后自动重连，重连后增量同步
- [ ] `edge_ff_is_enabled()` 本地内存查找 < 1ms
- [ ] `marionette_executor.py` 执行前调用 flag 检查
- [ ] 备份文件在 `config/feature_flags_edge_backup.json`
- [ ] `get_status()` 返回连接状态和 flag 数量
- [ ] `PROJECT_CONTROL_CENTER.md` 更新

---

*Codex Task | 来源：UNLEASH_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
