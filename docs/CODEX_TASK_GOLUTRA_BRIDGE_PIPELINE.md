# CODEX TASK: 边缘消息处理管道（借鉴 Golutra message_service/pipeline）
**任务ID**: CODEX-GOLUTRA-PIPELINE-P1-001  
**优先级**: 🔴 P1（云边通讯可靠性核心）  
**依赖文件**: `dragon-senate-saas-v2/bridge_protocol.py`  
**参考项目**: Golutra（message_service/pipeline/: normalize → policy → reliability → throttle → dispatch）  
**预计工期**: 1天

---

## 一、当前痛点

**现状**：`bridge_protocol.py` 直接收发 WSS 消息，没有中间处理层：
```python
# 现状：收到边缘消息 → 直接处理
async def on_edge_message(raw_msg):
    msg_type = raw_msg["type"]
    if msg_type == "monitor_data":
        await process_monitor(raw_msg)  # 直接处理，没有过滤/去重/限流
```

**问题**：
- 边缘发来的消息没有**签名验证**（可能被伪造）
- 没有**幂等去重**（重传消息可能重复处理）
- 没有**限流**（恶意/故障边缘可以刷爆云端）
- 没有**标准化**（不同版本边缘发来的格式可能不一致）

---

## 二、完整实现代码

```python
# dragon-senate-saas-v2/bridge_pipeline.py（新建）
"""
边缘消息 5 层处理管道（借鉴 Golutra message_service/pipeline）

管道流程：
  raw_msg → normalize → policy → throttle → reliability → dispatch
  
每层职责：
  Layer 1 normalize: 格式标准化（版本兼容、字段补全）
  Layer 2 policy:    策略检查（签名验证、内容合规、租户权限）
  Layer 3 throttle:  限流（每节点/每租户速率限制）
  Layer 4 reliability: 可靠性（幂等去重、ACK 确认）
  Layer 5 dispatch:  路由分发（按消息类型分发到对应龙虾/处理器）
"""

import hashlib
import hmac
import json
import time
import logging
from dataclasses import dataclass, field
from typing import Optional, Callable, Awaitable
from collections import defaultdict

logger = logging.getLogger("bridge_pipeline")


# ── 消息标准格式 ──

@dataclass
class EdgeMessage:
    """标准化后的边缘消息"""
    msg_id: str                    # 消息唯一ID
    msg_type: str                  # monitor_data / publish_result / node_ping / ...
    tenant_id: str
    node_id: str
    account_id: Optional[str] = None
    platform: Optional[str] = None
    payload: dict = field(default_factory=dict)
    timestamp: float = 0.0
    signature: str = ""
    protocol_version: str = "1.0"
    
    def idempotency_key(self) -> str:
        """生成幂等键（用于去重）"""
        return f"{self.node_id}:{self.msg_id}"


# ── Layer 1: Normalize ──

class NormalizeLayer:
    """消息标准化：统一格式、版本兼容、字段补全"""
    
    REQUIRED_FIELDS = {"msg_id", "msg_type", "tenant_id", "node_id"}
    
    async def process(self, raw_msg: dict) -> EdgeMessage:
        # 字段校验
        missing = self.REQUIRED_FIELDS - set(raw_msg.keys())
        if missing:
            raise ValueError(f"Missing required fields: {missing}")
        
        # 版本兼容：v0.x 版本没有 protocol_version 字段
        version = raw_msg.get("protocol_version", "0.9")
        
        # v0.9 的 data 字段 → v1.0 的 payload 字段
        payload = raw_msg.get("payload", raw_msg.get("data", {}))
        
        return EdgeMessage(
            msg_id=raw_msg["msg_id"],
            msg_type=raw_msg["msg_type"],
            tenant_id=raw_msg["tenant_id"],
            node_id=raw_msg["node_id"],
            account_id=raw_msg.get("account_id"),
            platform=raw_msg.get("platform"),
            payload=payload,
            timestamp=raw_msg.get("timestamp", time.time()),
            signature=raw_msg.get("signature", ""),
            protocol_version=version,
        )


# ── Layer 2: Policy ──

class PolicyLayer:
    """消息策略检查：签名验证、内容合规、租户权限"""
    
    def __init__(self, hmac_secrets: dict[str, str]):
        """
        hmac_secrets: {node_id: secret_key} 每个节点的 HMAC 密钥
        """
        self.hmac_secrets = hmac_secrets
    
    async def process(self, msg: EdgeMessage) -> EdgeMessage:
        # 1. 签名验证
        await self._verify_signature(msg)
        
        # 2. 租户权限检查（节点是否属于该租户）
        await self._check_tenant_permission(msg)
        
        # 3. 内容合规检查（敏感词等，仅对 monitor_data 类型）
        if msg.msg_type == "monitor_data":
            await self._content_compliance(msg)
        
        return msg
    
    async def _verify_signature(self, msg: EdgeMessage):
        """HMAC 签名验证"""
        secret = self.hmac_secrets.get(msg.node_id)
        if not secret:
            raise PermissionError(f"Unknown node: {msg.node_id}")
        
        # 用 payload JSON 计算 HMAC
        payload_str = json.dumps(msg.payload, sort_keys=True)
        expected = hmac.new(
            secret.encode(), payload_str.encode(), hashlib.sha256
        ).hexdigest()
        
        if not hmac.compare_digest(msg.signature, expected):
            raise PermissionError(f"Invalid signature for msg {msg.msg_id}")
    
    async def _check_tenant_permission(self, msg: EdgeMessage):
        """检查节点是否属于声称的租户"""
        # 从节点注册表查询
        # registered_tenant = await node_registry.get_tenant(msg.node_id)
        # if registered_tenant != msg.tenant_id:
        #     raise PermissionError("Node-tenant mismatch")
        pass  # TODO: 接入 node_registry
    
    async def _content_compliance(self, msg: EdgeMessage):
        """内容合规：检查上报数据是否包含敏感信息"""
        # 防止边缘意外上报用户密码等敏感数据
        sensitive_fields = {"password", "token", "cookie", "secret"}
        for key in msg.payload.keys():
            if key.lower() in sensitive_fields:
                logger.warning(f"Sensitive field '{key}' stripped from msg {msg.msg_id}")
                msg.payload[key] = "[REDACTED]"


# ── Layer 3: Throttle ──

class ThrottleLayer:
    """消息限流：防止单个节点/租户刷爆云端"""
    
    def __init__(self, node_limit: int = 100, tenant_limit: int = 500, window_seconds: int = 60):
        self.node_limit = node_limit      # 每节点每分钟最多 100 条
        self.tenant_limit = tenant_limit  # 每租户每分钟最多 500 条
        self.window = window_seconds
        self.node_counters: dict[str, list[float]] = defaultdict(list)
        self.tenant_counters: dict[str, list[float]] = defaultdict(list)
    
    async def process(self, msg: EdgeMessage) -> EdgeMessage:
        now = time.time()
        
        # 清理过期计数
        self._cleanup(self.node_counters[msg.node_id], now)
        self._cleanup(self.tenant_counters[msg.tenant_id], now)
        
        # 节点级限流
        if len(self.node_counters[msg.node_id]) >= self.node_limit:
            raise RuntimeError(f"Node {msg.node_id} rate limit exceeded ({self.node_limit}/min)")
        
        # 租户级限流
        if len(self.tenant_counters[msg.tenant_id]) >= self.tenant_limit:
            raise RuntimeError(f"Tenant {msg.tenant_id} rate limit exceeded ({self.tenant_limit}/min)")
        
        # 记录
        self.node_counters[msg.node_id].append(now)
        self.tenant_counters[msg.tenant_id].append(now)
        
        return msg
    
    def _cleanup(self, timestamps: list[float], now: float):
        cutoff = now - self.window
        while timestamps and timestamps[0] < cutoff:
            timestamps.pop(0)


# ── Layer 4: Reliability ──

class ReliabilityLayer:
    """消息可靠性：幂等去重 + ACK 确认"""
    
    def __init__(self, ttl_seconds: int = 300):
        self.seen_keys: dict[str, float] = {}  # {idempotency_key: expire_time}
        self.ttl = ttl_seconds
    
    async def process(self, msg: EdgeMessage) -> Optional[EdgeMessage]:
        now = time.time()
        key = msg.idempotency_key()
        
        # 清理过期
        expired = [k for k, v in self.seen_keys.items() if v < now]
        for k in expired:
            del self.seen_keys[k]
        
        # 去重检查
        if key in self.seen_keys:
            logger.info(f"Duplicate message dropped: {key}")
            return None  # 重复消息，静默丢弃
        
        # 记录
        self.seen_keys[key] = now + self.ttl
        return msg


# ── Layer 5: Dispatch ──

class DispatchLayer:
    """消息路由分发：按类型分发到对应处理器"""
    
    def __init__(self):
        self.handlers: dict[str, Callable] = {}
    
    def register(self, msg_type: str, handler: Callable[[EdgeMessage], Awaitable]):
        self.handlers[msg_type] = handler
    
    async def process(self, msg: EdgeMessage):
        handler = self.handlers.get(msg.msg_type)
        if not handler:
            logger.warning(f"No handler for msg_type: {msg.msg_type}")
            return
        
        await handler(msg)


# ── 组合管道 ──

class EdgeMessagePipeline:
    """
    完整 5 层管道
    
    使用方式：
        pipeline = EdgeMessagePipeline(hmac_secrets={"node-001": "secret123"})
        pipeline.dispatch.register("monitor_data", handle_monitor)
        pipeline.dispatch.register("publish_result", handle_publish_result)
        
        await pipeline.process(raw_msg_dict)
    """
    
    def __init__(self, hmac_secrets: dict[str, str] = None):
        self.normalize = NormalizeLayer()
        self.policy = PolicyLayer(hmac_secrets or {})
        self.throttle = ThrottleLayer()
        self.reliability = ReliabilityLayer()
        self.dispatch = DispatchLayer()
    
    async def process(self, raw_msg: dict) -> bool:
        """
        处理一条原始边缘消息
        
        Returns: True=处理成功, False=被过滤/限流/去重
        """
        try:
            # Layer 1: Normalize
            msg = await self.normalize.process(raw_msg)
            
            # Layer 2: Policy
            msg = await self.policy.process(msg)
            
            # Layer 3: Throttle
            msg = await self.throttle.process(msg)
            
            # Layer 4: Reliability (去重)
            msg = await self.reliability.process(msg)
            if msg is None:
                return False  # 重复消息
            
            # Layer 5: Dispatch
            await self.dispatch.process(msg)
            
            return True
            
        except ValueError as e:
            logger.error(f"Normalize failed: {e}")
            return False
        except PermissionError as e:
            logger.error(f"Policy rejected: {e}")
            return False
        except RuntimeError as e:
            logger.warning(f"Throttled: {e}")
            return False
```

---

## 三、与 bridge_protocol.py 集成

```python
# dragon-senate-saas-v2/bridge_protocol.py 升级点

from .bridge_pipeline import EdgeMessagePipeline

# 初始化管道
pipeline = EdgeMessagePipeline(hmac_secrets=load_node_secrets())

# 注册处理器（对应 EDGE_LITE_LOBSTER_ARCHITECTURE 的路由规则）
pipeline.dispatch.register("monitor_data", edge_data_processor.process_monitor_packet)
pipeline.dispatch.register("publish_result", edge_data_processor.process_publish_result)
pipeline.dispatch.register("node_ping", edge_data_processor.process_heartbeat)

# WSS 消息处理入口
async def on_edge_websocket_message(raw_msg: dict):
    """所有边缘消息统一经过 5 层管道"""
    await pipeline.process(raw_msg)
```

---

## 四、验收标准

- [ ] NormalizeLayer：缺失字段报错，v0.9 格式自动兼容
- [ ] PolicyLayer：伪造签名被拒绝，敏感字段被脱敏
- [ ] ThrottleLayer：单节点超 100 条/分钟被限流
- [ ] ReliabilityLayer：重复 msg_id 被静默丢弃
- [ ] DispatchLayer：按 msg_type 正确路由到对应处理器
- [ ] 完整管道：raw_msg → 5 层 → 最终处理器
- [ ] 与 bridge_protocol.py 集成：所有边缘消息经过管道


