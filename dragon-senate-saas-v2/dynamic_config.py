"""
DynamicConfig — 动态配置热更新
=================================
灵感来源：Temporal common/dynamicconfig 包
借鉴要点：
  - 运行时修改任何参数，无需重启服务
  - 配置存储在 SQLite，每 60 秒自动重新读取
  - 支持 namespace（租户）级别覆盖（对应 Temporal Namespace-scoped dynamic config）
  - 类型安全：int / float / bool / str / json 五种类型
  - 支持回调通知（配置变更时触发）

Temporal dynamicconfig 映射：
  config.Get("history.defaultActivityRetryPolicy", ...)   → DynamicConfig.get("default_activity_retry_max", 3)
  config.GetDurationProperty(...)                          → DynamicConfig.get_float("step_timeout_sec", 300.0)
  Namespace-scoped override                                → DynamicConfig.get("max_concurrent", 5, namespace="tenant_001")

使用方式：
    cfg = DynamicConfig()

    # 读取配置（带默认值）
    max_concurrent = cfg.get_int("lobster_pool_max_concurrent", default=5)
    timeout_sec    = cfg.get_float("workflow_total_timeout_min", default=120.0)
    debug_mode     = cfg.get_bool("debug_mode", default=False)

    # 写入配置（运营控制台调用）
    cfg.set("lobster_pool_max_concurrent", 8, description="高峰期临时调高并发")

    # 租户级别覆盖
    cfg.set("lobster_pool_max_concurrent", 2, namespace="tenant_free_tier")
    max_for_free = cfg.get_int("lobster_pool_max_concurrent", default=5, namespace="tenant_free_tier")
    # → 2（免费租户被限制为2）

    # 注册变更回调
    cfg.on_change("lobster_pool_max_concurrent", lambda val: update_semaphore(int(val)))
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

# ─────────────────────────────────────────────────────────────────
# 配置项定义（内置默认值 + 说明）
# ─────────────────────────────────────────────────────────────────

# 所有可动态配置的参数及其默认值
DEFAULT_CONFIG: dict[str, Any] = {
    # 龙虾池
    "lobster_pool_max_concurrent":     2,      # 全局最大并发龙虾数（防止LLM费用失控）
    "lobster_step_timeout_sec":        300,    # 单步龙虾执行超时（秒）
    "lobster_default_max_retries":     3,      # 默认最大重试次数
    "lobster_backoff_base_sec":        5,      # 退避基础时间（秒）
    "lobster_backoff_max_sec":         60,     # 退避最大时间（秒）

    # 工作流
    "workflow_total_timeout_min":      120.0,  # 工作流整体超时（分钟）
    "workflow_max_parallel_steps":     2,      # 最大并行步骤数

    # 边缘层
    "edge_heartbeat_interval_sec":     30,     # 边缘心跳间隔（秒）
    "edge_heartbeat_timeout_sec":      90,     # 心跳超时判断阈值（秒）
    "edge_poll_interval_sec":          10,     # Long Poll 轮询间隔（秒）
    "edge_task_retry_limit":           3,      # 边缘任务最大重试次数
    "edge_download_timeout_sec":       300,    # 视频下载超时（秒）
    "edge_max_concurrent_publish":     2,      # 单节点最大并发发布数

    # LLM
    "llm_default_temperature":         0.7,    # 默认 LLM temperature
    "llm_default_max_tokens":          4096,   # 默认最大输出 token
    "llm_request_timeout_sec":         120,    # LLM 调用超时（秒）

    # 租户配额（默认值，可被租户级覆盖）
    "tenant_monthly_workflow_quota":   100,    # 每租户每月工作流配额
    "tenant_daily_api_call_limit":     1000,   # 每租户每天 API 调用限制
    "tenant_max_concurrent_workflows": 3,      # 每租户最大并发工作流数

    # 计费
    "billing_free_tier_token_limit":   50000,  # 免费层 token 限制（每月）
    "billing_alert_threshold_cny":     100.0,  # 费用告警阈值（元）

    # 可观测性
    "metrics_enabled":                 True,   # 是否启用 Prometheus metrics
    "debug_mode":                      False,  # 调试模式
    "log_level":                       "INFO", # 日志级别
}

DEFAULT_CONFIG.update({
    "lobster_step_timeout_sec": 300,
    "online_eval_enabled": True,
    "online_eval_sampling_rate": 0.1,
    "online_eval_metrics": ["task_completion", "hallucination"],
})

_DB_PATH = os.getenv("DYNAMIC_CONFIG_DB", "./data/dynamic_config.sqlite")
_REFRESH_INTERVAL_SEC = int(os.getenv("DYNAMIC_CONFIG_REFRESH_SEC", "60"))


class DynamicConfig:
    """
    动态配置热更新引擎（对应 Temporal dynamicconfig）。

    特性：
    - 配置持久化到 SQLite
    - 每 60 秒自动从 DB 刷新到内存缓存
    - 支持 namespace（租户）级别覆盖
    - 支持变更回调通知
    - 类型安全读取（get_int / get_float / get_bool / get_str / get_json）
    """

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, Any] = {}          # 全局配置缓存
        self._ns_cache: dict[str, dict[str, Any]] = {}  # 租户级覆盖缓存
        self._callbacks: dict[str, list[Callable]] = {}  # 变更回调
        self._lock = threading.RLock()
        self._last_refresh: float = 0.0
        self._ensure_schema()
        self._seed_defaults()
        self._refresh()
        self._start_background_refresh()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS dynamic_config (
                    key         TEXT NOT NULL,
                    namespace   TEXT NOT NULL DEFAULT '__global__',
                    value       TEXT NOT NULL,
                    value_type  TEXT NOT NULL DEFAULT 'str',
                    description TEXT DEFAULT '',
                    updated_by  TEXT DEFAULT 'system',
                    updated_at  TEXT NOT NULL,
                    PRIMARY KEY (key, namespace)
                );
                CREATE INDEX IF NOT EXISTS idx_cfg_ns ON dynamic_config(namespace, key);
                CREATE TABLE IF NOT EXISTS dynamic_config_history (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    key         TEXT NOT NULL,
                    namespace   TEXT NOT NULL,
                    old_value   TEXT,
                    new_value   TEXT NOT NULL,
                    updated_by  TEXT DEFAULT 'system',
                    updated_at  TEXT NOT NULL
                );
            """)
            conn.commit()
        finally:
            conn.close()

    def _seed_defaults(self) -> None:
        """写入内置默认值（仅当 key 不存在时）"""
        now = datetime.now(timezone.utc).isoformat()
        conn = self._conn()
        try:
            for key, val in DEFAULT_CONFIG.items():
                existing = conn.execute(
                    "SELECT 1 FROM dynamic_config WHERE key=? AND namespace='__global__'", (key,)
                ).fetchone()
                if not existing:
                    conn.execute(
                        """INSERT INTO dynamic_config (key, namespace, value, value_type, description, updated_at)
                           VALUES (?, '__global__', ?, ?, ?, ?)""",
                        (key, json.dumps(val), self._infer_type(val),
                         DEFAULT_CONFIG.get(f"_{key}_desc", ""), now)
                    )
            conn.commit()
        finally:
            conn.close()

    def _infer_type(self, val: Any) -> str:
        if isinstance(val, bool):
            return "bool"
        if isinstance(val, int):
            return "int"
        if isinstance(val, float):
            return "float"
        if isinstance(val, (dict, list)):
            return "json"
        return "str"

    def _refresh(self) -> None:
        """从 DB 刷新到内存缓存"""
        with self._lock:
            conn = self._conn()
            try:
                rows = conn.execute("SELECT * FROM dynamic_config").fetchall()
                new_cache: dict[str, Any] = {}
                new_ns_cache: dict[str, dict[str, Any]] = {}
                for row in rows:
                    key = row["key"]
                    ns = row["namespace"]
                    val = self._parse_value(row["value"], row["value_type"])
                    if ns == "__global__":
                        old_val = self._cache.get(key)
                        new_cache[key] = val
                        # 触发变更回调
                        if old_val != val and key in self._callbacks:
                            for cb in self._callbacks[key]:
                                try:
                                    cb(val)
                                except Exception:
                                    pass
                    else:
                        if ns not in new_ns_cache:
                            new_ns_cache[ns] = {}
                        new_ns_cache[ns][key] = val
                self._cache = new_cache
                self._ns_cache = new_ns_cache
            finally:
                conn.close()
            self._last_refresh = time.time()

    def _parse_value(self, raw: str, vtype: str) -> Any:
        try:
            if vtype == "bool":
                return json.loads(raw)
            if vtype == "int":
                return int(json.loads(raw))
            if vtype == "float":
                return float(json.loads(raw))
            if vtype == "json":
                return json.loads(raw)
            return json.loads(raw) if raw.startswith(("{", "[", '"')) else raw
        except Exception:
            return raw

    def _maybe_refresh(self) -> None:
        if time.time() - self._last_refresh > _REFRESH_INTERVAL_SEC:
            self._refresh()

    def _start_background_refresh(self) -> None:
        def _loop():
            while True:
                time.sleep(_REFRESH_INTERVAL_SEC)
                try:
                    self._refresh()
                except Exception:
                    pass
        t = threading.Thread(target=_loop, daemon=True, name="dynamic-config-refresh")
        t.start()

    # ── 读取接口 ──────────────────────────────────────────────────

    def get(self, key: str, default: Any = None, namespace: str = "__global__") -> Any:
        """
        读取配置值（对应 Temporal dynamicconfig.GetIntPropertyFn）。
        优先级：namespace 级别覆盖 > 全局值 > 代码默认值
        """
        self._maybe_refresh()
        with self._lock:
            # 租户级别覆盖优先
            if namespace != "__global__" and namespace in self._ns_cache:
                ns_val = self._ns_cache[namespace].get(key)
                if ns_val is not None:
                    return ns_val
            return self._cache.get(key, default)

    def get_int(self, key: str, default: int = 0, namespace: str = "__global__") -> int:
        val = self.get(key, default, namespace)
        try:
            return int(val)
        except (TypeError, ValueError):
            return default

    def get_float(self, key: str, default: float = 0.0, namespace: str = "__global__") -> float:
        val = self.get(key, default, namespace)
        try:
            return float(val)
        except (TypeError, ValueError):
            return default

    def get_bool(self, key: str, default: bool = False, namespace: str = "__global__") -> bool:
        val = self.get(key, default, namespace)
        if isinstance(val, bool):
            return val
        if isinstance(val, str):
            return val.lower() in ("true", "1", "yes")
        return bool(val)

    def get_str(self, key: str, default: str = "", namespace: str = "__global__") -> str:
        val = self.get(key, default, namespace)
        return str(val) if val is not None else default

    def get_json(self, key: str, default: Any = None, namespace: str = "__global__") -> Any:
        val = self.get(key, default, namespace)
        if isinstance(val, str):
            try:
                return json.loads(val)
            except Exception:
                return default
        return val

    # ── 写入接口 ──────────────────────────────────────────────────

    def set(
        self,
        key: str,
        value: Any,
        namespace: str = "__global__",
        description: str = "",
        updated_by: str = "system",
    ) -> None:
        """
        写入/更新配置值（对应 Temporal dynamic config file update）。
        不需要重启服务，下次 get() 调用时自动生效。
        """
        now = datetime.now(timezone.utc).isoformat()
        vtype = self._infer_type(value)
        raw_val = json.dumps(value, ensure_ascii=False)

        conn = self._conn()
        try:
            # 查询旧值
            old = conn.execute(
                "SELECT value FROM dynamic_config WHERE key=? AND namespace=?",
                (key, namespace)
            ).fetchone()
            old_val = old["value"] if old else None

            conn.execute(
                """INSERT INTO dynamic_config (key, namespace, value, value_type, description, updated_by, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(key, namespace) DO UPDATE SET
                     value=excluded.value, value_type=excluded.value_type,
                     description=CASE WHEN excluded.description != '' THEN excluded.description ELSE description END,
                     updated_by=excluded.updated_by, updated_at=excluded.updated_at""",
                (key, namespace, raw_val, vtype, description, updated_by, now)
            )
            # 写历史记录
            if old_val != raw_val:
                conn.execute(
                    """INSERT INTO dynamic_config_history (key, namespace, old_value, new_value, updated_by, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (key, namespace, old_val, raw_val, updated_by, now)
                )
            conn.commit()
        finally:
            conn.close()

        # 立即刷新缓存
        self._refresh()

    def delete(self, key: str, namespace: str = "__global__") -> None:
        """删除配置项（恢复为代码默认值）"""
        conn = self._conn()
        try:
            conn.execute(
                "DELETE FROM dynamic_config WHERE key=? AND namespace=?",
                (key, namespace)
            )
            conn.commit()
        finally:
            conn.close()
        self._refresh()

    # ── 变更回调 ──────────────────────────────────────────────────

    def on_change(self, key: str, callback: Callable[[Any], None]) -> None:
        """
        注册配置变更回调（对应 Temporal dynamicconfig 的订阅模式）。
        配置值变更时自动调用 callback(new_value)。
        常用场景：lobster_pool_max_concurrent 变更时实时更新信号量。
        """
        with self._lock:
            if key not in self._callbacks:
                self._callbacks[key] = []
            self._callbacks[key].append(callback)

    # ── 查询接口 ──────────────────────────────────────────────────

    def list_all(self, namespace: str = "__global__") -> list[dict[str, Any]]:
        """列出所有配置项（供运营控制台展示）"""
        self._maybe_refresh()
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM dynamic_config WHERE namespace=? ORDER BY key",
                (namespace,)
            ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                d["parsed_value"] = self._parse_value(d["value"], d["value_type"])
                d["default_value"] = DEFAULT_CONFIG.get(d["key"])
                d["is_custom"] = d["parsed_value"] != d["default_value"]
                result.append(d)
            return result
        finally:
            conn.close()

    def get_history(self, key: str, limit: int = 20) -> list[dict[str, Any]]:
        """查询配置变更历史（对应 Temporal audit log）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM dynamic_config_history WHERE key=? ORDER BY updated_at DESC LIMIT ?",
                (key, limit)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def export_snapshot(self) -> dict[str, Any]:
        """导出当前所有配置快照（用于备份 / 迁移）"""
        self._maybe_refresh()
        with self._lock:
            return {
                "global": dict(self._cache),
                "namespaces": {ns: dict(vals) for ns, vals in self._ns_cache.items()},
                "exported_at": datetime.now(timezone.utc).isoformat(),
            }


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_cfg: DynamicConfig | None = None


def get_dynamic_config() -> DynamicConfig:
    """获取全局默认 DynamicConfig 单例"""
    global _default_cfg
    if _default_cfg is None:
        _default_cfg = DynamicConfig()
    return _default_cfg


# ── 便捷函数（常用配置直接调用）────────────────────────────────

def get_pool_max_concurrent(namespace: str = "__global__") -> int:
    return get_dynamic_config().get_int("lobster_pool_max_concurrent", 5, namespace)

def get_workflow_timeout_min(namespace: str = "__global__") -> float:
    return get_dynamic_config().get_float("workflow_total_timeout_min", 120.0, namespace)

def get_step_timeout_sec(namespace: str = "__global__") -> int:
    return get_dynamic_config().get_int("lobster_step_timeout_sec", 300, namespace)

def get_default_max_retries(namespace: str = "__global__") -> int:
    return get_dynamic_config().get_int("lobster_default_max_retries", 3, namespace)

def is_debug_mode() -> bool:
    return get_dynamic_config().get_bool("debug_mode", False)
