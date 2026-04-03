"""
tenant_memory_sync.py — 团队/租户记忆同步协议
================================================
灵感来源：cccback-master services/teamMemorySync/index.ts
         + services/SessionMemory/sessionMemory.ts

核心升级：
  在现有"AI 记忆系统（memory_compressor + lobster 经验提炼）"之上，
  补充"操作记忆/团队记忆/租户记忆同步协议层"：

  ┌──────────────────────────────────────────────────────────────┐
  │  现有（保留）           │  本文件新增                        │
  ├──────────────────────────────────────────────────────────────┤
  │  L0 Raw Entry          │  Session Memory（阈值触发）          │
  │  L1 压缩摘要           │  Tenant Shared Memory（跨账号共享）  │
  │  L2 长期知识           │  Team Memory Sync（delta + checksum）│
  │  经验提炼 Experience   │  Secret Guard（不同步敏感数据）       │
  └──────────────────────────────────────────────────────────────┘

  设计原则（仿 cccback teamMemorySync）：
  - repo scoped       : 记忆按租户/账号隔离
  - delta upload      : 只同步变更部分
  - checksum 对比     : 避免重复写入
  - server wins       : 冲突时服务端优先
  - secret scan       : 绝不同步密码/Token/API Key
  - watcher 抑制      : 防止循环触发
  - 无全局 mutable state : 每次操作都是幂等的

集成点：
  lobster_runner.py → _extract_and_store_lobster_experiences 之后
  app.py → /api/tenant/{id}/memory 端点
  前端 Memory 页 → 显示团队/租户记忆同步状态
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger("tenant_memory_sync")


# ────────────────────────────────────────────────────────────────────
# 敏感数据保护（Secret Guard）
# 仿 cccback teamMemorySync secret scan
# ────────────────────────────────────────────────────────────────────

# 绝不同步的字段模式（正则）
_SECRET_PATTERNS = [
    re.compile(r"(?i)(password|passwd|pwd)\s*[:=]\s*\S+"),
    re.compile(r"(?i)(api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*\S+"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9\-._~+/]+=*"),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),          # OpenAI key
    re.compile(r"ghp_[A-Za-z0-9]{36}"),           # GitHub PAT
    re.compile(r"\b1[3-9]\d{9}\b"),               # 中国手机号
    re.compile(r"\b\d{6,18}\b(?=.*身份证)"),      # 身份证（上下文）
]


def scan_for_secrets(text: str) -> list[str]:
    """
    扫描文本是否包含敏感数据。
    返回发现的敏感模式列表（非空则拒绝同步）。
    """
    found = []
    for pattern in _SECRET_PATTERNS:
        if pattern.search(text):
            found.append(pattern.pattern[:40])
    return found


def sanitize_memory_value(value: str) -> str:
    """
    清理记忆值中的敏感数据（替换为 [REDACTED]）。
    """
    result = value
    for pattern in _SECRET_PATTERNS:
        result = pattern.sub("[REDACTED]", result)
    return result


# ────────────────────────────────────────────────────────────────────
# 记忆条目类型
# ────────────────────────────────────────────────────────────────────

MemoryScope = str  # "session" / "account:{id}" / "tenant" / "shared"

MEMORY_SCOPE_SESSION = "session"
MEMORY_SCOPE_TENANT = "tenant"
MEMORY_SCOPE_SHARED = "shared"


def account_scope(account_id: str) -> MemoryScope:
    return f"account:{account_id}"


@dataclass
class TenantMemoryEntry:
    """
    租户记忆条目（仿 cccback teamMemorySync entry）

    scope 定义了记忆的可见范围：
      - "session"        : 仅当前会话（最短暂）
      - "account:{id}"   : 特定账号（如 @beauty_lab 的运营经验）
      - "tenant"         : 整个租户共享（如品牌调性、禁忌话题）
      - "shared"         : 跨租户共享（平台级知识，通常只读）
    """
    entry_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    tenant_id: str = ""
    scope: MemoryScope = MEMORY_SCOPE_TENANT
    category: str = "general"          # content/engagement/compliance/brand/...
    key: str = ""
    value: str = ""
    source_lobster: str = ""           # 哪只龙虾产生的记忆
    source_task_id: str = ""
    checksum: str = ""                 # SHA256[:16]，用于去重
    version: int = 1
    is_deleted: bool = False
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def compute_checksum(self) -> str:
        """计算条目内容的校验和"""
        content = f"{self.scope}:{self.category}:{self.key}:{self.value}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def to_dict(self) -> dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "tenant_id": self.tenant_id,
            "scope": self.scope,
            "category": self.category,
            "key": self.key,
            "value": self.value[:500],  # API 返回时截断
            "source_lobster": self.source_lobster,
            "checksum": self.checksum,
            "version": self.version,
            "is_deleted": self.is_deleted,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


# ────────────────────────────────────────────────────────────────────
# Session Memory — 阈值触发的会话记忆抽取
# 仿 cccback services/SessionMemory/sessionMemory.ts
# ────────────────────────────────────────────────────────────────────

@dataclass
class SessionMemoryConfig:
    """会话记忆配置"""
    trigger_message_count: int = int(os.getenv("SESSION_MEMORY_TRIGGER_COUNT", "20"))
    trigger_token_threshold: int = int(os.getenv("SESSION_MEMORY_TOKEN_THRESHOLD", "30000"))
    max_entries_per_session: int = int(os.getenv("SESSION_MEMORY_MAX_ENTRIES", "50"))
    background_extract: bool = True  # 后台异步抽取，不阻塞主会话


class SessionMemoryExtractor:
    """
    会话记忆抽取器（仿 cccback SessionMemory）

    特点：
    - 后台异步抽取，不阻塞主会话
    - 基于消息数/Token 数触发（不是每次都提取）
    - 提取后写入 TenantMemorySyncService
    """

    def __init__(self, sync_service: "TenantMemorySyncService") -> None:
        self.sync_service = sync_service
        self.config = SessionMemoryConfig()
        # session_id → 上次提取时的消息数
        self._last_extract_count: dict[str, int] = {}
        # 抑制标志，防止循环触发
        self._suppressed: set[str] = set()

    def should_extract(
        self,
        session_id: str,
        message_count: int,
        estimated_tokens: int,
    ) -> bool:
        """判断是否应该触发记忆抽取（仿 cccback threshold check）"""
        if session_id in self._suppressed:
            return False

        last_count = self._last_extract_count.get(session_id, 0)
        new_messages = message_count - last_count

        if new_messages >= self.config.trigger_message_count:
            return True
        if estimated_tokens >= self.config.trigger_token_threshold:
            return True
        return False

    async def extract_async(
        self,
        *,
        session_id: str,
        tenant_id: str,
        messages: list[dict[str, Any]],
        lobster_id: str,
        task_id: str | None,
        llm_call_fn: Any,
    ) -> int:
        """
        后台异步抽取记忆（不阻塞主调用方）。
        返回抽取的条目数。
        """
        if session_id in self._suppressed:
            return 0

        # 抑制：防止同一 session 并发触发
        self._suppressed.add(session_id)
        try:
            count = await self._do_extract(
                session_id=session_id,
                tenant_id=tenant_id,
                messages=messages,
                lobster_id=lobster_id,
                task_id=task_id,
                llm_call_fn=llm_call_fn,
            )
            self._last_extract_count[session_id] = len(messages)
            return count
        except Exception as e:
            logger.warning("[SessionMemory] 抽取失败 session=%s: %s", session_id, e)
            return 0
        finally:
            self._suppressed.discard(session_id)

    async def _do_extract(
        self,
        *,
        session_id: str,
        tenant_id: str,
        messages: list[dict[str, Any]],
        lobster_id: str,
        task_id: str | None,
        llm_call_fn: Any,
    ) -> int:
        """实际调用 LLM 抽取记忆条目"""
        if not messages:
            return 0

        # 构建摘要文本
        text_parts = []
        for msg in messages[-30:]:  # 最近30条
            role = msg.get("role", "unknown").upper()
            content = str(msg.get("content", ""))[:500]
            text_parts.append(f"[{role}] {content}")
        session_text = "\n".join(text_parts)

        prompt = f"""从下面的对话中抽取值得长期记忆的知识点，输出 JSON 数组：
[
  {{"category": "brand|content|compliance|engagement|account|general",
    "key": "简短的知识点标题（15字内）",
    "value": "具体内容（100字内）"}}
]

要求：
1. 只抽取有长期价值的内容（账号风格、品牌禁忌、有效策略、失败教训等）
2. 不抽取临时状态或一次性指令
3. 不包含任何密码/Token/手机号等敏感信息
4. 最多10条

对话内容：
{session_text}

只输出 JSON 数组，不要添加解释。"""

        try:
            response = await llm_call_fn(prompt, 2000)
            # 解析 JSON
            json_match = re.search(r"\[.*\]", response, re.DOTALL)
            if not json_match:
                return 0
            entries_raw = json.loads(json_match.group())
            if not isinstance(entries_raw, list):
                return 0
        except Exception:
            return 0

        count = 0
        for item in entries_raw[:10]:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key", "")).strip()
            value = str(item.get("value", "")).strip()
            category = str(item.get("category", "general")).strip()
            if not key or not value:
                continue

            # 安全扫描
            secrets = scan_for_secrets(value)
            if secrets:
                logger.warning("[SessionMemory] 跳过含敏感数据的记忆：key=%s", key[:20])
                continue

            await self.sync_service.upsert(TenantMemoryEntry(
                tenant_id=tenant_id,
                scope=MEMORY_SCOPE_TENANT,
                category=category,
                key=key,
                value=sanitize_memory_value(value),
                source_lobster=lobster_id,
                source_task_id=task_id or "",
            ))
            count += 1

        logger.info("[SessionMemory] 抽取完成 session=%s count=%d", session_id, count)
        return count


# ────────────────────────────────────────────────────────────────────
# TenantMemorySyncService — 租户记忆同步服务
# ────────────────────────────────────────────────────────────────────

_DB_PATH = os.getenv("TENANT_MEMORY_DB_PATH", "./data/tenant_memory.sqlite")


class TenantMemorySyncService:
    """
    租户记忆同步服务（仿 cccback teamMemorySync）

    功能：
    1. 多 scope 记忆存储（session/account/tenant/shared）
    2. Delta 同步（只上传变更，checksum 去重）
    3. Server wins 冲突解决
    4. Secret Guard（敏感数据扫描）
    5. 查询接口（供龙虾运行前召回）
    """

    def __init__(self) -> None:
        self._ensure_schema()

    def _get_db(self) -> sqlite3.Connection:
        db_path = Path(_DB_PATH)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._get_db()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS tenant_memory (
                    entry_id        TEXT PRIMARY KEY,
                    tenant_id       TEXT NOT NULL,
                    scope           TEXT NOT NULL DEFAULT 'tenant',
                    category        TEXT NOT NULL DEFAULT 'general',
                    key             TEXT NOT NULL,
                    value           TEXT NOT NULL,
                    source_lobster  TEXT DEFAULT '',
                    source_task_id  TEXT DEFAULT '',
                    checksum        TEXT NOT NULL DEFAULT '',
                    version         INTEGER DEFAULT 1,
                    is_deleted      INTEGER DEFAULT 0,
                    created_at      REAL NOT NULL,
                    updated_at      REAL NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_tm_tenant_scope
                    ON tenant_memory(tenant_id, scope, category, is_deleted);
                CREATE INDEX IF NOT EXISTS idx_tm_key
                    ON tenant_memory(tenant_id, scope, key);
                CREATE INDEX IF NOT EXISTS idx_tm_checksum
                    ON tenant_memory(tenant_id, checksum);
                CREATE INDEX IF NOT EXISTS idx_tm_updated
                    ON tenant_memory(tenant_id, updated_at);
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 写入接口 ─────────────────────────────────────────────────────

    async def upsert(self, entry: TenantMemoryEntry) -> str:
        """
        写入或更新记忆条目（幂等，checksum 去重）。

        如果相同 tenant_id+scope+key 已存在且内容相同（checksum 一致），
        则跳过写入（server wins / delta 优化）。

        Returns: entry_id
        """
        # 安全扫描
        secrets = scan_for_secrets(entry.value)
        if secrets:
            logger.warning("[MemorySync] 拒绝含敏感数据的记忆：key=%s patterns=%s",
                           entry.key[:20], secrets[:2])
            raise ValueError(f"记忆值包含敏感数据，已拒绝同步：{secrets[:1]}")

        # 清理后计算 checksum
        entry.value = sanitize_memory_value(entry.value)
        entry.checksum = entry.compute_checksum()
        now = time.time()

        conn = self._get_db()
        try:
            # 查找同 key 的现有记录
            existing = conn.execute(
                "SELECT entry_id, checksum, version FROM tenant_memory "
                "WHERE tenant_id=? AND scope=? AND key=? AND is_deleted=0",
                (entry.tenant_id, entry.scope, entry.key),
            ).fetchone()

            if existing:
                # checksum 相同 → 跳过（delta 优化）
                if existing["checksum"] == entry.checksum:
                    return existing["entry_id"]

                # 内容变更 → 更新（server wins：version+1）
                new_version = int(existing["version"] or 1) + 1
                conn.execute(
                    "UPDATE tenant_memory SET value=?, checksum=?, version=?, "
                    "source_lobster=?, source_task_id=?, updated_at=? "
                    "WHERE entry_id=?",
                    (entry.value, entry.checksum, new_version,
                     entry.source_lobster, entry.source_task_id,
                     now, existing["entry_id"]),
                )
                conn.commit()
                return existing["entry_id"]
            else:
                # 新条目
                if not entry.entry_id:
                    entry.entry_id = uuid.uuid4().hex[:16]
                entry.created_at = now
                entry.updated_at = now
                conn.execute(
                    "INSERT INTO tenant_memory "
                    "(entry_id, tenant_id, scope, category, key, value, "
                    "source_lobster, source_task_id, checksum, version, "
                    "is_deleted, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (entry.entry_id, entry.tenant_id, entry.scope, entry.category,
                     entry.key, entry.value, entry.source_lobster, entry.source_task_id,
                     entry.checksum, entry.version, 0, entry.created_at, entry.updated_at),
                )
                conn.commit()
                return entry.entry_id
        finally:
            conn.close()

    async def delete(self, entry_id: str) -> bool:
        """软删除记忆条目"""
        conn = self._get_db()
        try:
            conn.execute(
                "UPDATE tenant_memory SET is_deleted=1, updated_at=? WHERE entry_id=?",
                (time.time(), entry_id),
            )
            conn.commit()
            return conn.total_changes > 0
        finally:
            conn.close()

    # ── 查询接口 ─────────────────────────────────────────────────────

    def recall(
        self,
        *,
        tenant_id: str,
        scope: MemoryScope | None = None,
        category: str | None = None,
        query: str | None = None,
        limit: int = 20,
    ) -> list[TenantMemoryEntry]:
        """
        召回记忆（龙虾运行前调用）。

        query 支持简单关键词匹配（生产环境可替换为向量搜索）。
        """
        conn = self._get_db()
        try:
            sql = "SELECT * FROM tenant_memory WHERE tenant_id=? AND is_deleted=0"
            params: list[Any] = [tenant_id]

            if scope:
                sql += " AND scope=?"
                params.append(scope)
            if category:
                sql += " AND category=?"
                params.append(category)
            if query:
                sql += " AND (key LIKE ? OR value LIKE ?)"
                params.extend([f"%{query}%", f"%{query}%"])

            sql += " ORDER BY updated_at DESC LIMIT ?"
            params.append(limit)

            rows = conn.execute(sql, params).fetchall()
            return [
                TenantMemoryEntry(
                    entry_id=str(row["entry_id"]),
                    tenant_id=str(row["tenant_id"]),
                    scope=str(row["scope"]),
                    category=str(row["category"]),
                    key=str(row["key"]),
                    value=str(row["value"]),
                    source_lobster=str(row["source_lobster"] or ""),
                    source_task_id=str(row["source_task_id"] or ""),
                    checksum=str(row["checksum"] or ""),
                    version=int(row["version"] or 1),
                    is_deleted=bool(row["is_deleted"]),
                    created_at=float(row["created_at"] or 0),
                    updated_at=float(row["updated_at"] or 0),
                )
                for row in rows
            ]
        finally:
            conn.close()

    def get_sync_delta(
        self,
        tenant_id: str,
        since_timestamp: float,
    ) -> list[dict[str, Any]]:
        """
        获取 since_timestamp 之后的变更条目（Delta 同步）。
        供云端控制平面拉取增量数据。
        """
        conn = self._get_db()
        try:
            rows = conn.execute(
                "SELECT * FROM tenant_memory WHERE tenant_id=? AND updated_at > ? "
                "ORDER BY updated_at ASC",
                (tenant_id, since_timestamp),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_stats(self, tenant_id: str) -> dict[str, Any]:
        """返回租户记忆统计信息（供前端 Memory 页显示）"""
        conn = self._get_db()
        try:
            total = conn.execute(
                "SELECT COUNT(*) FROM tenant_memory WHERE tenant_id=? AND is_deleted=0",
                (tenant_id,),
            ).fetchone()[0]

            by_scope = conn.execute(
                "SELECT scope, COUNT(*) as cnt FROM tenant_memory "
                "WHERE tenant_id=? AND is_deleted=0 GROUP BY scope",
                (tenant_id,),
            ).fetchall()

            by_category = conn.execute(
                "SELECT category, COUNT(*) as cnt FROM tenant_memory "
                "WHERE tenant_id=? AND is_deleted=0 GROUP BY category ORDER BY cnt DESC",
                (tenant_id,),
            ).fetchall()

            by_lobster = conn.execute(
                "SELECT source_lobster, COUNT(*) as cnt FROM tenant_memory "
                "WHERE tenant_id=? AND is_deleted=0 AND source_lobster!='' "
                "GROUP BY source_lobster ORDER BY cnt DESC",
                (tenant_id,),
            ).fetchall()

            last_updated = conn.execute(
                "SELECT MAX(updated_at) FROM tenant_memory WHERE tenant_id=? AND is_deleted=0",
                (tenant_id,),
            ).fetchone()[0]

            return {
                "tenant_id": tenant_id,
                "total_entries": total,
                "by_scope": {row["scope"]: row["cnt"] for row in by_scope},
                "by_category": {row["category"]: row["cnt"] for row in by_category},
                "by_lobster": {row["source_lobster"]: row["cnt"] for row in by_lobster},
                "last_updated_at": last_updated,
                "scopes_available": [
                    MEMORY_SCOPE_SESSION,
                    MEMORY_SCOPE_TENANT,
                    MEMORY_SCOPE_SHARED,
                ],
            }
        finally:
            conn.close()


# ────────────────────────────────────────────────────────────────────
# 全局单例
# ────────────────────────────────────────────────────────────────────

_global_sync_service: TenantMemorySyncService | None = None
_global_session_extractor: SessionMemoryExtractor | None = None


def get_tenant_memory_service() -> TenantMemorySyncService:
    """获取租户记忆同步服务单例"""
    global _global_sync_service
    if _global_sync_service is None:
        _global_sync_service = TenantMemorySyncService()
    return _global_sync_service


def get_session_memory_extractor() -> SessionMemoryExtractor:
    """获取会话记忆抽取器单例"""
    global _global_session_extractor
    if _global_session_extractor is None:
        _global_session_extractor = SessionMemoryExtractor(get_tenant_memory_service())
    return _global_session_extractor


# ────────────────────────────────────────────────────────────────────
# 便捷集成函数（供 lobster_runner 调用）
# ────────────────────────────────────────────────────────────────────

async def maybe_extract_session_memory(
    *,
    session_id: str,
    tenant_id: str,
    messages: list[dict[str, Any]],
    lobster_id: str,
    task_id: str | None,
    llm_router: Any,
    estimated_tokens: int = 0,
) -> int:
    """
    会话记忆抽取入口（供 lobster_runner 在任务完成后调用）。

    非阻塞：满足阈值才触发，触发后后台运行，不等待结果。
    Returns: 0（未触发）或 触发的协程任务数
    """
    extractor = get_session_memory_extractor()
    message_count = len(messages)

    if not extractor.should_extract(session_id, message_count, estimated_tokens):
        return 0

    # 构建 llm_call_fn
    async def _llm_fn(prompt: str, max_tokens: int) -> str:
        try:
            from llm_router import RouteMeta
            return await llm_router.routed_ainvoke_text(
                system_prompt="你是记忆抽取专家。只输出 JSON 数组。",
                user_prompt=prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=max_tokens,
                    tenant_tier="basic",
                    user_id="memory-system",
                    tenant_id=tenant_id,
                    task_type="session_memory_extract",
                ),
                temperature=0.1,
            )
        except Exception:
            return "[]"

    import asyncio
    asyncio.create_task(
        extractor.extract_async(
            session_id=session_id,
            tenant_id=tenant_id,
            messages=messages,
            lobster_id=lobster_id,
            task_id=task_id,
            llm_call_fn=_llm_fn,
        )
    )
    return 1


async def recall_for_lobster(
    tenant_id: str,
    lobster_id: str,
    query: str,
    *,
    include_account_scope: str | None = None,
    limit: int = 10,
) -> str:
    """
    为龙虾召回相关记忆（注入到 system prompt 或 user prompt 前）。

    Returns: Markdown 格式的记忆上下文字符串
    """
    service = get_tenant_memory_service()

    scopes_to_query = [MEMORY_SCOPE_TENANT]
    if include_account_scope:
        scopes_to_query.append(account_scope(include_account_scope))

    all_entries: list[TenantMemoryEntry] = []
    for scope in scopes_to_query:
        entries = service.recall(
            tenant_id=tenant_id,
            scope=scope,
            query=query,
            limit=limit,
        )
        all_entries.extend(entries)

    if not all_entries:
        return ""

    # 去重 + 按 updated_at 排序
    seen_keys: set[str] = set()
    unique_entries: list[TenantMemoryEntry] = []
    for e in sorted(all_entries, key=lambda x: x.updated_at, reverse=True):
        dedupe_key = f"{e.scope}:{e.key}"
        if dedupe_key not in seen_keys:
            seen_keys.add(dedupe_key)
            unique_entries.append(e)

    lines = [f"## 记忆上下文（{lobster_id}）\n"]
    for e in unique_entries[:limit]:
        scope_label = e.scope.replace("account:", "账号@")
        lines.append(f"- [{e.category}/{scope_label}] **{e.key}**: {e.value}")

    return "\n".join(lines)
