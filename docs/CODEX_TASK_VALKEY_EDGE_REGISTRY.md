# CODEX TASK: Valkey 持久化 edge_registry（重启不丢节点）
**任务ID**: CODEX-VALKEY-P1-001  
**优先级**: 🟠 P1（云边调度层：edge_registry 重启丢失所有边缘节点注册信息）  
**依赖文件**: `dragon-senate-saas-v2/bridge_protocol.py`, `edge-runtime/edge_heartbeat.py`  
**参考项目**: Valkey（https://github.com/valkey-io/valkey）— Redis 7.4 BSD 分支  
**预计工期**: 1.5天

---

## 一、当前痛点

```
现状：edge_registry = {} （Python 内存字典）
      ↓
SaaS 服务重启 → edge_registry 清空 → 所有边缘节点"消失"
      ↓
边缘节点需等到下次心跳上报才重新注册
      ↓
重启窗口期（最长30秒）所有云端→边缘的任务下发失败
```

**Valkey 解决什么**：
- Redis 兼容（drop-in replacement），所有 Redis 客户端直接可用
- BSD 许可证（比 Redis 7.4+ SSPL 更友好）
- edge_registry 数据持久化到 Valkey，SaaS 重启后立即可用
- 边缘节点心跳 TTL 自动过期（无需手动清理下线节点）

---

## 二、edge_registry 持久化实现

```python
# dragon-senate-saas-v2/edge_registry.py（新建）
"""
EdgeRegistry - 基于 Valkey/Redis 的边缘节点注册中心

替代原有 bridge_protocol.py 中的内存字典。
Valkey 提供：
1. 持久化（SaaS重启不丢节点信息）
2. TTL 自动过期（节点下线自动清除）
3. 发布/订阅（节点上下线事件广播）
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

# Valkey 连接配置（兼容 Redis 协议）
VALKEY_URL = "redis://localhost:6379/2"  # DB 2 专用于 edge_registry
HEARTBEAT_TTL = 60  # 心跳超时（秒），超过此时间视为离线
EDGE_KEY_PREFIX = "edge:node:"
EDGE_SET_KEY = "edge:active_nodes"


class EdgeRegistry:
    """
    边缘节点注册中心
    
    使用方式：
        registry = EdgeRegistry()
        await registry.connect()
        
        # 注册/更新节点
        await registry.register(edge_node_id, metadata)
        
        # 查询在线节点
        nodes = await registry.list_online_nodes()
        
        # 检查节点是否在线
        online = await registry.is_online(edge_node_id)
    """
    
    def __init__(self, valkey_url: str = VALKEY_URL):
        self.valkey_url = valkey_url
        self.client: aioredis.Redis = None
    
    async def connect(self):
        """连接 Valkey"""
        self.client = aioredis.from_url(
            self.valkey_url,
            decode_responses=True,
            retry_on_timeout=True,
        )
        # 测试连接
        await self.client.ping()
        logger.info("EdgeRegistry 已连接 Valkey")
    
    async def register(self, edge_node_id: str, metadata: dict):
        """
        注册/刷新边缘节点（心跳调用此方法）
        
        每次心跳刷新 TTL，超时未刷新自动过期 → 视为离线
        """
        key = f"{EDGE_KEY_PREFIX}{edge_node_id}"
        
        node_info = {
            "node_id": edge_node_id,
            "last_heartbeat": datetime.now(timezone.utc).isoformat(),
            "ip": metadata.get("ip", "unknown"),
            "version": metadata.get("version", "unknown"),
            "os": metadata.get("os", "unknown"),
            "capabilities": json.dumps(metadata.get("capabilities", [])),
            "active_jobs": json.dumps(metadata.get("active_jobs", [])),
            "status": "online",
        }
        
        pipe = self.client.pipeline()
        
        # 存储节点详细信息（Hash）
        pipe.hset(key, mapping=node_info)
        # 设置 TTL（心跳超时自动过期）
        pipe.expire(key, HEARTBEAT_TTL)
        # 加入活跃节点集合
        pipe.sadd(EDGE_SET_KEY, edge_node_id)
        
        await pipe.execute()
        
        logger.debug(f"节点注册/刷新 | node={edge_node_id}")
    
    async def unregister(self, edge_node_id: str):
        """主动注销节点（节点优雅退出时调用）"""
        key = f"{EDGE_KEY_PREFIX}{edge_node_id}"
        
        pipe = self.client.pipeline()
        pipe.delete(key)
        pipe.srem(EDGE_SET_KEY, edge_node_id)
        await pipe.execute()
        
        logger.info(f"节点注销 | node={edge_node_id}")
    
    async def is_online(self, edge_node_id: str) -> bool:
        """检查节点是否在线"""
        key = f"{EDGE_KEY_PREFIX}{edge_node_id}"
        return await self.client.exists(key) > 0
    
    async def get_node_info(self, edge_node_id: str) -> Optional[dict]:
        """获取节点详细信息"""
        key = f"{EDGE_KEY_PREFIX}{edge_node_id}"
        info = await self.client.hgetall(key)
        if not info:
            return None
        
        # 反序列化 JSON 字段
        if "capabilities" in info:
            info["capabilities"] = json.loads(info["capabilities"])
        if "active_jobs" in info:
            info["active_jobs"] = json.loads(info["active_jobs"])
        
        return info
    
    async def list_online_nodes(self) -> list:
        """列出所有在线节点"""
        node_ids = await self.client.smembers(EDGE_SET_KEY)
        
        online_nodes = []
        for node_id in node_ids:
            info = await self.get_node_info(node_id)
            if info:
                online_nodes.append(info)
            else:
                # TTL 过期但未从集合移除 → 清理
                await self.client.srem(EDGE_SET_KEY, node_id)
        
        return online_nodes
    
    async def get_node_count(self) -> int:
        """获取在线节点数量"""
        return await self.client.scard(EDGE_SET_KEY)
    
    async def find_available_node(self, required_capability: str = None) -> Optional[str]:
        """
        查找可用节点（dispatcher 任务分发时调用）
        
        策略：选择活跃任务最少的节点（负载均衡）
        """
        nodes = await self.list_online_nodes()
        
        if required_capability:
            nodes = [
                n for n in nodes
                if required_capability in n.get("capabilities", [])
            ]
        
        if not nodes:
            return None
        
        # 按活跃任务数排序，选最少的
        nodes.sort(key=lambda n: len(n.get("active_jobs", [])))
        return nodes[0]["node_id"]
    
    async def close(self):
        """关闭连接"""
        if self.client:
            await self.client.close()


# ══════════════════════════════════════════════════════════
# 全局单例
# ══════════════════════════════════════════════════════════

_registry: Optional[EdgeRegistry] = None

async def get_edge_registry() -> EdgeRegistry:
    """获取 EdgeRegistry 单例"""
    global _registry
    if _registry is None:
        _registry = EdgeRegistry()
        await _registry.connect()
    return _registry
```

---

## 三、集成到现有组件

```python
# bridge_protocol.py — 替换内存字典
# 原: self.edge_nodes = {}
# 新: self.registry = await get_edge_registry()

# edge_heartbeat.py — 心跳上报改为调用 registry.register()
# app.py — 启动时初始化 EdgeRegistry
```

---

## 四、Docker Compose 新增 Valkey

```yaml
# docker-compose.yml 新增
services:
  valkey:
    image: valkey/valkey:8-alpine
    ports:
      - "6379:6379"
    volumes:
      - valkey-data:/data
    command: valkey-server --save 60 1 --loglevel warning
    restart: unless-stopped

volumes:
  valkey-data:
```

---

## 五、验收标准

- [ ] Valkey 容器启动，`redis-cli ping` 返回 PONG
- [ ] `EdgeRegistry.register()` 正确写入节点信息（Hash）
- [ ] 心跳 TTL 生效：60秒无心跳 → 节点键自动删除
- [ ] SaaS 服务重启后：`list_online_nodes()` 立即返回仍在线的节点
- [ ] `find_available_node()` 按负载均衡选择节点
- [ ] 节点优雅退出时 `unregister()` 立即清除
- [ ] 多实例 SaaS 共享同一 Valkey → 节点信息一致
