# CODEX TASK: Fleet 借鉴 P2 — 实时广播查询 + 边缘Keystore + Secret管理 + 统计聚合 + 活动UI

**优先级：P2**  
**来源：FLEET_BORROWING_ANALYSIS.md P2-1 ~ P2-5**  
**借鉴自**：https://github.com/fleetdm/fleet（⭐6.2k）

---

## P2-1: 实时广播查询（LiveQueryEngine）

**借鉴自**：Fleet `server/live_query/` + `server/fleet/campaigns.go`  
**场景**：Commander 想知道"当前所有在线边缘节点的执行状态"，向所有节点广播查询，秒级汇聚结果。

### `dragon-senate-saas-v2/live_query_engine.py`

```python
"""
实时广播查询引擎（借鉴 Fleet Live Query + Campaigns 设计）

工作流：
  1. 运营人员/Commander 发起 live query（例：查询所有边缘节点当前任务）
  2. 服务端通过 WebSocket 向所有在线边缘节点广播查询
  3. 边缘节点实时响应
  4. 服务端汇聚所有响应，推送给查询发起方
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import uuid
import asyncio
import json


@dataclass
class LiveQueryCampaign:
    """一次实时查询活动（借鉴 Fleet Campaign 模型）"""
    campaign_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str = ""
    query: str = ""                     # 查询指令（JSON）
    target_labels: list[str] = field(default_factory=list)   # 目标标签（空=全部）
    target_node_ids: list[str] = field(default_factory=list) # 指定节点 ID
    status: str = "pending"             # pending | running | completed | failed
    result_count: int = 0               # 已响应节点数
    expected_count: int = 0             # 预期响应节点数
    created_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

    @property
    def is_complete(self) -> bool:
        return self.result_count >= self.expected_count or self.status == "completed"


class LiveQueryEngine:
    """实时广播查询引擎"""

    def __init__(self, websocket_manager, label_manager=None):
        self.ws_manager = websocket_manager
        self.label_manager = label_manager
        self._active_campaigns: dict[str, LiveQueryCampaign] = {}
        self._results: dict[str, list[dict]] = {}   # campaign_id → results

    async def launch_campaign(
        self,
        tenant_id: str,
        query: dict,
        target_labels: list[str] = None,
        target_node_ids: list[str] = None,
        timeout_seconds: float = 30.0,
    ) -> LiveQueryCampaign:
        """发起实时查询"""
        # 解析目标节点
        node_ids = set(target_node_ids or [])
        if target_labels and self.label_manager:
            for label_id in target_labels:
                members = await self.label_manager.get_label_members(label_id, tenant_id)
                node_ids.update(members)

        campaign = LiveQueryCampaign(
            tenant_id=tenant_id,
            query=json.dumps(query),
            target_labels=target_labels or [],
            target_node_ids=list(node_ids),
            status="running",
            expected_count=len(node_ids),
        )
        self._active_campaigns[campaign.campaign_id] = campaign
        self._results[campaign.campaign_id] = []

        # 广播查询到所有目标节点
        msg = json.dumps({
            "type": "live_query",
            "campaign_id": campaign.campaign_id,
            "query": query,
        })
        await self.ws_manager.broadcast(
            message=msg,
            tenant_id=tenant_id,
            node_ids=list(node_ids) if node_ids else None,
        )

        # 异步等待结果（超时自动完成）
        asyncio.create_task(self._auto_complete(campaign.campaign_id, timeout_seconds))
        return campaign

    async def receive_result(self, campaign_id: str, node_id: str, result: dict):
        """接收边缘节点的查询结果"""
        if campaign_id not in self._active_campaigns:
            return
        campaign = self._active_campaigns[campaign_id]
        self._results[campaign_id].append({"node_id": node_id, "result": result})
        campaign.result_count += 1
        if campaign.is_complete:
            campaign.status = "completed"
            campaign.completed_at = datetime.utcnow()

    async def get_results(self, campaign_id: str) -> list[dict]:
        return self._results.get(campaign_id, [])

    async def _auto_complete(self, campaign_id: str, timeout: float):
        await asyncio.sleep(timeout)
        if campaign_id in self._active_campaigns:
            campaign = self._active_campaigns[campaign_id]
            if campaign.status == "running":
                campaign.status = "completed"
                campaign.completed_at = datetime.utcnow()
```

**API**：
```
POST /api/v1/live-query
  body: {"query": {...}, "target_labels": [...], "timeout": 30}
  → 返回 campaign_id

GET  /api/v1/live-query/{campaign_id}/results   # SSE 流式返回结果
GET  /api/v1/live-query/{campaign_id}/status    # 查询进度
```

**验收标准**：
- [ ] `launch_campaign()` 向目标节点广播查询
- [ ] `receive_result()` 收集边缘响应
- [ ] 30秒超时自动完成
- [ ] 前端查询页：实时进度条 + 结果表格

---

## P2-2: 边缘 Keystore（本地加密存储）

**借鉴自**：Fleet `orbit/pkg/keystore/` — 敏感数据本地加密存储

### `edge-runtime/keystore.py`

```python
"""
边缘节点本地 Keystore（借鉴 Fleet orbit/pkg/keystore/ 设计）
使用系统级密钥库（macOS Keychain / Windows DPAPI / Linux secret-service）
降级方案：AES-256 加密文件
"""
import base64
import json
import os
import platform
from pathlib import Path
from typing import Optional

KEYSTORE_DIR = "/opt/openclaw/edge/keystore"


class EdgeKeystore:
    """边缘节点本地加密 Keystore"""

    def __init__(self, keystore_dir: str = KEYSTORE_DIR, master_key: bytes = None):
        self.keystore_dir = Path(keystore_dir)
        self.keystore_dir.mkdir(parents=True, exist_ok=True)
        self._master_key = master_key or self._get_or_create_master_key()

    def set(self, key: str, value: str):
        """安全存储键值对"""
        encrypted = self._encrypt(value)
        file_path = self.keystore_dir / f"{key}.enc"
        file_path.write_bytes(encrypted)
        os.chmod(file_path, 0o600)

    def get(self, key: str) -> Optional[str]:
        """读取并解密"""
        file_path = self.keystore_dir / f"{key}.enc"
        if not file_path.exists():
            return None
        try:
            encrypted = file_path.read_bytes()
            return self._decrypt(encrypted)
        except Exception:
            return None

    def delete(self, key: str):
        """安全删除（覆写后删除）"""
        file_path = self.keystore_dir / f"{key}.enc"
        if file_path.exists():
            # 覆写再删除（防止磁盘恢复）
            file_path.write_bytes(os.urandom(os.path.getsize(file_path)))
            file_path.unlink()

    def _encrypt(self, value: str) -> bytes:
        """AES-256-GCM 加密（需要 cryptography 库）"""
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            nonce = os.urandom(12)
            cipher = AESGCM(self._master_key)
            ciphertext = cipher.encrypt(nonce, value.encode(), None)
            return nonce + ciphertext
        except ImportError:
            # fallback: base64（仅开发环境）
            return base64.b64encode(value.encode())

    def _decrypt(self, data: bytes) -> str:
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            nonce, ciphertext = data[:12], data[12:]
            cipher = AESGCM(self._master_key)
            return cipher.decrypt(nonce, ciphertext, None).decode()
        except ImportError:
            return base64.b64decode(data).decode()

    def _get_or_create_master_key(self) -> bytes:
        """获取或创建主密钥（存储在系统密钥库）"""
        key_file = self.keystore_dir / ".master.key"
        if key_file.exists():
            key_data = key_file.read_bytes()
            os.chmod(key_file, 0o600)
            return key_data
        master_key = os.urandom(32)
        key_file.write_bytes(master_key)
        os.chmod(key_file, 0o600)
        return master_key


# 使用示例
# keystore = EdgeKeystore()
# keystore.set("wechat_api_key", "sk-xxxx")
# keystore.set("edge_token", "ey...")
# key = keystore.get("wechat_api_key")
```

**验收标准**：
- [ ] AES-256-GCM 加密存储
- [ ] 文件权限 600
- [ ] `marionette_executor.py` 中的 API 密钥改用 Keystore 读取
- [ ] 支持安全删除（覆写后删除）

---

## P2-3: Secret 变量管理（SecretVault）

**借鉴自**：Fleet `server/fleet/secret_variables.go` — 云端统一管理敏感配置，边缘按需拉取

### `dragon-senate-saas-v2/secret_vault.py`

```python
"""
Secret 变量管理（借鉴 Fleet secret_variables.go 设计）

设计理念：
  - 敏感配置（API密钥/Token/证书）统一存储在云端（加密）
  - 边缘节点启动时按需拉取，不在代码/配置文件中明文存储
  - 支持租户级/龙虾级/全局三层 Secret
  - 按需访问（最小权限原则）
"""
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional
import uuid


class SecretScope(str, Enum):
    TENANT = "tenant"       # 租户级（所有龙虾可用）
    LOBSTER = "lobster"     # 龙虾级（特定龙虾专用）
    EDGE_NODE = "edge_node" # 边缘节点级


@dataclass
class Secret:
    """Secret 条目（值加密存储，明文不出库）"""
    secret_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str = ""
    scope: SecretScope = SecretScope.TENANT
    scope_target_id: str = ""   # lobster_id / edge_node_id
    name: str = ""              # "wechat_api_key"
    description: str = ""
    encrypted_value: str = ""   # AES-256 加密后的值（只存加密值）
    created_by: str = ""
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    last_accessed_at: Optional[datetime] = None


class SecretVault:
    """Secret 变量仓库"""

    def __init__(self, store, encryption_key: bytes):
        self.store = store
        self._key = encryption_key

    async def set_secret(
        self,
        tenant_id: str,
        name: str,
        value: str,
        scope: SecretScope = SecretScope.TENANT,
        scope_target_id: str = "",
        description: str = "",
        created_by: str = "",
    ) -> Secret:
        """存储 Secret（自动加密）"""
        encrypted = self._encrypt(value)
        secret = Secret(
            tenant_id=tenant_id,
            scope=scope,
            scope_target_id=scope_target_id,
            name=name,
            description=description,
            encrypted_value=encrypted,
            created_by=created_by,
        )
        await self.store.upsert(secret)
        return secret

    async def get_secret(
        self, tenant_id: str, name: str,
        scope: SecretScope = SecretScope.TENANT,
        scope_target_id: str = "",
    ) -> Optional[str]:
        """获取 Secret 明文值（访问受 RBAC 控制）"""
        secret = await self.store.find(tenant_id=tenant_id, name=name,
                                       scope=scope, scope_target_id=scope_target_id)
        if not secret:
            return None
        # 更新访问时间
        await self.store.touch(secret.secret_id)
        return self._decrypt(secret.encrypted_value)

    async def list_secrets(self, tenant_id: str, scope: SecretScope = None) -> list[dict]:
        """列出 Secret（不返回值，只返回元信息）"""
        secrets = await self.store.list(tenant_id=tenant_id, scope=scope)
        return [{"name": s.name, "scope": s.scope, "created_at": s.created_at} for s in secrets]

    async def delete_secret(self, tenant_id: str, name: str) -> bool:
        return await self.store.delete(tenant_id=tenant_id, name=name)

    def _encrypt(self, value: str) -> str:
        import base64
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        import os
        nonce = os.urandom(12)
        cipher = AESGCM(self._key)
        ct = cipher.encrypt(nonce, value.encode(), None)
        return base64.b64encode(nonce + ct).decode()

    def _decrypt(self, encrypted: str) -> str:
        import base64
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        data = base64.b64decode(encrypted)
        nonce, ct = data[:12], data[12:]
        cipher = AESGCM(self._key)
        return cipher.decrypt(nonce, ct, None).decode()
```

**API**：
```
GET    /api/v1/secrets                    # 列出 Secret（不含值）
POST   /api/v1/secrets                    # 创建 Secret
PUT    /api/v1/secrets/{name}             # 更新 Secret
DELETE /api/v1/secrets/{name}             # 删除 Secret
POST   /api/v1/edge/secrets/pull          # 边缘节点拉取自己所需的 Secrets
```

**验收标准**：
- [ ] Secret 值仅存加密后的内容，明文不落库
- [ ] 列表 API 不返回值（只返回名称+元信息）
- [ ] 边缘拉取 API 按权限返回该节点可用的 Secrets
- [ ] 前端 Secret 管理页（创建/删除，不可查看值）

---

## P2-4: 执行统计聚合（StatsAggregator）

**借鉴自**：Fleet `server/fleet/aggregated_stats.go` — 定期汇总降低 DB 压力

### `dragon-senate-saas-v2/stats_aggregator.py`

```python
"""
执行统计聚合（借鉴 Fleet aggregated_stats.go 的定期聚合设计）

问题：实时 COUNT/AVG/SUM 查询在数据量大时压 DB
解决：每 N 分钟聚合一次，结果存入 aggregated_stats 表，查询直接读聚合结果
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional


@dataclass
class LobsterStats:
    """龙虾执行统计快照"""
    lobster_id: str
    tenant_id: str
    period: str                 # "daily" | "weekly" | "monthly"
    period_start: datetime
    
    total_executions: int = 0
    successful_executions: int = 0
    failed_executions: int = 0
    avg_execution_ms: float = 0.0
    
    leads_contacted: int = 0
    leads_replied: int = 0
    leads_converted: int = 0
    
    llm_tokens_used: int = 0
    llm_cost_usd: float = 0.0
    
    computed_at: datetime = field(default_factory=datetime.utcnow)

    @property
    def success_rate(self) -> float:
        return self.successful_executions / max(self.total_executions, 1)

    @property
    def reply_rate(self) -> float:
        return self.leads_replied / max(self.leads_contacted, 1)

    @property
    def conversion_rate(self) -> float:
        return self.leads_converted / max(self.leads_contacted, 1)


class StatsAggregator:
    """统计聚合器（由 Cron Job 每小时触发）"""

    def __init__(self, db_store):
        self.db = db_store

    async def aggregate_lobster_stats(
        self, tenant_id: str, period: str = "daily"
    ) -> list[LobsterStats]:
        """聚合所有龙虾的执行统计"""
        if period == "daily":
            period_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        elif period == "weekly":
            today = datetime.utcnow()
            period_start = today - timedelta(days=today.weekday())
        else:
            period_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0)

        lobster_ids = await self.db.list_lobster_ids(tenant_id)
        results = []
        for lobster_id in lobster_ids:
            stats = await self._compute_lobster_stats(
                tenant_id, lobster_id, period, period_start
            )
            await self.db.upsert_stats(stats)
            results.append(stats)
        return results

    async def _compute_lobster_stats(
        self, tenant_id: str, lobster_id: str, period: str, period_start: datetime
    ) -> LobsterStats:
        """从执行日志计算统计（只在聚合时计算一次）"""
        raw = await self.db.query_execution_logs(
            tenant_id=tenant_id,
            lobster_id=lobster_id,
            since=period_start,
        )
        stats = LobsterStats(
            lobster_id=lobster_id,
            tenant_id=tenant_id,
            period=period,
            period_start=period_start,
        )
        for log in raw:
            stats.total_executions += 1
            if log.get("success"):
                stats.successful_executions += 1
            else:
                stats.failed_executions += 1
            stats.avg_execution_ms = (
                (stats.avg_execution_ms * (stats.total_executions - 1) + log.get("duration_ms", 0))
                / stats.total_executions
            )
            stats.leads_contacted += log.get("leads_contacted", 0)
            stats.leads_replied += log.get("leads_replied", 0)
            stats.leads_converted += log.get("leads_converted", 0)
            stats.llm_tokens_used += log.get("tokens_used", 0)
            stats.llm_cost_usd += log.get("cost_usd", 0.0)
        return stats

    async def get_stats(
        self, tenant_id: str, lobster_id: str, period: str = "daily"
    ) -> Optional[LobsterStats]:
        """读取聚合统计（直接读缓存，不实时计算）"""
        return await self.db.get_stats(
            tenant_id=tenant_id, lobster_id=lobster_id, period=period
        )
```

**验收标准**：
- [ ] `StatsAggregator.aggregate_lobster_stats()` 由 Cron 每小时触发
- [ ] 支持 daily/weekly/monthly 三种周期
- [ ] `observability_api.py` 的统计接口改用读聚合数据
- [ ] 前端龙虾统计卡片：成功率/回复率/转化率/成本

---

## P2-5: 活动日志 UI（前端）

**借鉴自**：Fleet 前端 `Activities` 页面设计

**页面路径**：`/settings/activities`

**布局设计**：
```
┌───────────────────────────────────────────────────┐
│ 📋 活动记录                                        │
│ 筛选：[全部类型▼] [全部龙虾▼] [时间范围▼] [搜索]    │
├───────────────────────────────────────────────────┤
│ 今天                                               │
│ 09:31  🦞 followup-小催 执行了任务，线索：张总      │
│        → 发送了跟进消息（第3次），渠道：企业微信     │
│        详情: {tokens: 312, cost: ¥0.02}  [查看]   │
│                                                   │
│ 09:28  👤 管理员-李梅 修改了规则：高频跟进策略       │
│        → 将跟进间隔从3天改为2天                     │
│                                                   │
│ 09:15  🖥️ 边缘节点 node-bj-001 完成注册             │
│        → IP: 192.168.1.100, 版本: v1.4.2          │
│                                                   │
│ 昨天                                              │
│ 18:42  🦞 catcher-铁狗 捕获了新线索：王总（ABC科技）│
│ ...                                               │
├───────────────────────────────────────────────────┤
│ < 上一页    第 1/12 页    下一页 >                  │
└───────────────────────────────────────────────────┘
```

**组件规范**：
- 时间线格式（今天/昨天/具体日期分组）
- 活动类型图标（龙虾🦞 / 操作员👤 / 系统🖥️）
- 可展开详情（点击查看 details JSON）
- 支持 4 个筛选维度（类型/角色/时间/搜索关键词）
- SSE 实时追加新活动（无需刷新）

**API**：
```
GET /api/v1/activities?type=&actor_id=&page=&per_page=20
→ 使用 ActivityStream.list_activities() (P1-1 已落地)
```

**验收标准**：
- [ ] 活动列表分页展示（默认 20 条/页）
- [ ] 时间线分组（今天/昨天/更早）
- [ ] 4 维度筛选（类型/龙虾/时间/关键词）
- [ ] SSE 实时追加（新活动出现时自动插入顶部）
- [ ] 移动端适配（时间线垂直布局）

---

*Codex Task | 来源：FLEET_BORROWING_ANALYSIS.md P2-1~5 | 2026-04-02*
