"""
PromptRegistry — Prompt 版本管理系统
======================================
灵感来源：Langfuse Prompt Management
借鉴要点：
  - 版本化 Prompt（name / version / commit_message / is_active / labels）
  - 生产/预览环境标签（production / preview）
  - 通过 SDK 拉取指定版本（get_prompt("inkwriter_copy", version="production")）
  - 版本 Diff 对比
  - AB 测试：同一 Prompt 多版本并发实验

Langfuse 概念映射：
  Prompt.name          → prompt_name（如 "inkwriter_copy_generate"）
  Prompt.version       → version（整数自增）
  Prompt.labels        → labels（["production"] / ["preview"] / ["experiment-v2"]）
  Prompt.config        → config（temperature / max_tokens 等 LLM 参数）

使用方式：
    reg = PromptRegistry()

    # 发布新版本 Prompt
    pid = reg.push(
        name="inkwriter_copy_generate",
        lobster="inkwriter",
        skill="inkwriter_industry_vertical_copy",
        content="你是一位专业的{industry}行业文案师...",
        variables=["industry", "customer_name", "pain_point"],
        commit_message="增加行业垂类语气词",
        labels=["preview"],
        config={"temperature": 0.7, "max_tokens": 2000},
    )

    # 拉取生产版本
    prompt = reg.get("inkwriter_copy_generate", label="production")
    # → {"content": "...", "version": 3, "config": {...}}

    # 切换生产版本
    reg.promote(name="inkwriter_copy_generate", version=4, target_label="production")

    # 列出所有版本
    versions = reg.list_versions("inkwriter_copy_generate")
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


_DB_PATH = os.getenv("PROMPT_REGISTRY_DB", "./data/prompt_registry.sqlite")


class PromptRegistry:
    """
    Prompt 版本管理注册表（对应 Langfuse Prompts 功能）。

    特性：
    - 不可变版本：每次 push 产生新版本，历史版本永久保存
    - 标签机制：production / preview / experiment-xxx
    - 变量提取：自动解析 {variable} 占位符
    - Diff 对比：任意两个版本内容差异
    - AB 测试：同一 name 下多个 preview 版本并发实验
    """

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                -- Prompt 版本主表
                CREATE TABLE IF NOT EXISTS prompts (
                    prompt_id       TEXT PRIMARY KEY,
                    name            TEXT NOT NULL,        -- Prompt 名称（唯一标识）
                    lobster         TEXT NOT NULL DEFAULT '',  -- 归属龙虾
                    skill           TEXT DEFAULT '',           -- 归属技能
                    version         INTEGER NOT NULL,          -- 版本号（自增）
                    content         TEXT NOT NULL DEFAULT '',  -- Prompt 正文（支持 {variable} 占位符）
                    system_prompt   TEXT DEFAULT '',           -- System Prompt（可选）
                    variables       TEXT DEFAULT '[]',         -- 变量列表（JSON array）
                    labels          TEXT DEFAULT '[]',         -- 标签（JSON array）
                    config          TEXT DEFAULT '{}',         -- LLM 参数（temperature/max_tokens等）
                    commit_message  TEXT DEFAULT '',
                    author          TEXT DEFAULT 'system',
                    is_archived     INTEGER DEFAULT 0,
                    created_at      TEXT NOT NULL,
                    UNIQUE(name, version)
                );
                CREATE INDEX IF NOT EXISTS idx_prompt_name ON prompts(name, version DESC);
                CREATE INDEX IF NOT EXISTS idx_prompt_lobster ON prompts(lobster, name);

                -- Prompt 标签表（方便按标签查找最新版本）
                CREATE TABLE IF NOT EXISTS prompt_labels (
                    label_id        TEXT PRIMARY KEY,
                    name            TEXT NOT NULL,    -- Prompt 名称
                    label           TEXT NOT NULL,    -- 标签（production/preview/experiment-xxx）
                    prompt_id       TEXT NOT NULL,    -- 指向 prompts.prompt_id
                    version         INTEGER NOT NULL,
                    set_at          TEXT NOT NULL,
                    set_by          TEXT DEFAULT 'system',
                    UNIQUE(name, label),
                    FOREIGN KEY (prompt_id) REFERENCES prompts(prompt_id)
                );
                CREATE INDEX IF NOT EXISTS idx_label_name ON prompt_labels(name, label);

                -- Prompt 使用记录（统计哪个版本被调用了多少次）
                CREATE TABLE IF NOT EXISTS prompt_usage (
                    usage_id        TEXT PRIMARY KEY,
                    prompt_id       TEXT NOT NULL,
                    name            TEXT NOT NULL,
                    version         INTEGER NOT NULL,
                    tenant_id       TEXT DEFAULT 'tenant_main',
                    lobster         TEXT DEFAULT '',
                    gen_id          TEXT DEFAULT '',   -- 关联到 llm_call_logger 的 gen_id
                    used_at         TEXT NOT NULL,
                    FOREIGN KEY (prompt_id) REFERENCES prompts(prompt_id)
                );
                CREATE INDEX IF NOT EXISTS idx_usage_prompt ON prompt_usage(prompt_id, used_at);
                CREATE INDEX IF NOT EXISTS idx_usage_tenant ON prompt_usage(tenant_id, used_at);

                CREATE TABLE IF NOT EXISTS prompt_experiment_metrics (
                    id              TEXT PRIMARY KEY,
                    flag_name       TEXT NOT NULL,
                    lobster         TEXT NOT NULL,
                    skill           TEXT NOT NULL,
                    variant_name    TEXT NOT NULL DEFAULT 'control',
                    tenant_id       TEXT NOT NULL DEFAULT 'tenant_main',
                    gen_id          TEXT DEFAULT '',
                    quality_score   REAL DEFAULT 0.0,
                    latency_ms      INTEGER DEFAULT 0,
                    prompt_name     TEXT DEFAULT '',
                    prompt_version  INTEGER DEFAULT 0,
                    created_at      TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_prompt_exp_flag ON prompt_experiment_metrics(flag_name, created_at);
                CREATE INDEX IF NOT EXISTS idx_prompt_exp_tenant ON prompt_experiment_metrics(tenant_id, flag_name, created_at);
            """)
            cols = {str(row["name"]) for row in conn.execute("PRAGMA table_info(prompt_usage)").fetchall()}
            if "variant_name" not in cols:
                conn.execute("ALTER TABLE prompt_usage ADD COLUMN variant_name TEXT DEFAULT 'control'")
            if "quality_score" not in cols:
                conn.execute("ALTER TABLE prompt_usage ADD COLUMN quality_score REAL DEFAULT 0.0")
            if "latency_ms" not in cols:
                conn.execute("ALTER TABLE prompt_usage ADD COLUMN latency_ms INTEGER DEFAULT 0")
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _extract_variables(content: str) -> list[str]:
        """自动提取 {variable} 占位符"""
        return list(dict.fromkeys(re.findall(r"\{(\w+)\}", content)))

    # ── 核心 CRUD ──────────────────────────────────────────────────

    def push(
        self,
        name: str,
        content: str,
        lobster: str = "",
        skill: str = "",
        system_prompt: str = "",
        variables: Optional[list[str]] = None,
        labels: Optional[list[str]] = None,
        config: Optional[dict] = None,
        commit_message: str = "",
        author: str = "system",
        auto_promote: bool = False,
    ) -> str:
        """
        发布新版本 Prompt（对应 Langfuse Prompt.push）。
        版本号自动递增，不可变。
        auto_promote=True 时，发布后自动将该版本设为 production。
        返回 prompt_id。
        """
        conn = self._conn()
        try:
            # 获取当前最大版本号
            row = conn.execute(
                "SELECT MAX(version) as max_v FROM prompts WHERE name=?", (name,)
            ).fetchone()
            new_version = (row["max_v"] or 0) + 1

            # 自动提取变量
            extracted_vars = self._extract_variables(content)
            final_vars = variables if variables is not None else extracted_vars

            prompt_id = f"pr_{uuid.uuid4().hex[:12]}"
            conn.execute(
                """INSERT INTO prompts
                   (prompt_id, name, lobster, skill, version, content, system_prompt,
                    variables, labels, config, commit_message, author, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    prompt_id, name, lobster, skill, new_version,
                    content, system_prompt,
                    json.dumps(final_vars), json.dumps(labels or []),
                    json.dumps(config or {}), commit_message, author, self._now()
                )
            )
            conn.commit()
        finally:
            conn.close()

        # 自动 promote 到 production
        if auto_promote:
            self.promote(name, new_version, "production", set_by=author)
        elif labels and "preview" in labels:
            self.promote(name, new_version, "preview", set_by=author)

        return prompt_id

    def get(
        self,
        name: str,
        version: Optional[int] = None,
        label: str = "production",
    ) -> Optional[dict[str, Any]]:
        """
        拉取 Prompt（对应 Langfuse client.get_prompt(name, version="production")）。
        - version=None + label="production"：拉取 production 标签指向的版本
        - version=3：拉取指定版本
        - label="preview"：拉取 preview 标签指向的版本
        """
        conn = self._conn()
        try:
            if version is not None:
                row = conn.execute(
                    "SELECT * FROM prompts WHERE name=? AND version=?", (name, version)
                ).fetchone()
            else:
                # 通过 label 查找
                label_row = conn.execute(
                    "SELECT prompt_id, version FROM prompt_labels WHERE name=? AND label=?",
                    (name, label)
                ).fetchone()
                if label_row:
                    row = conn.execute(
                        "SELECT * FROM prompts WHERE prompt_id=?", (label_row["prompt_id"],)
                    ).fetchone()
                else:
                    # 如果没有 label，返回最新版本
                    row = conn.execute(
                        "SELECT * FROM prompts WHERE name=? ORDER BY version DESC LIMIT 1",
                        (name,)
                    ).fetchone()

            if not row:
                return None

            d = dict(row)
            d["variables"] = json.loads(d.get("variables", "[]"))
            d["labels"]    = json.loads(d.get("labels", "[]"))
            d["config"]    = json.loads(d.get("config", "{}"))

            # 查询当前标签状态
            labels_rows = conn.execute(
                "SELECT label FROM prompt_labels WHERE prompt_id=?", (d["prompt_id"],)
            ).fetchall()
            d["active_labels"] = [r["label"] for r in labels_rows]

            return d
        finally:
            conn.close()

    def promote(
        self,
        name: str,
        version: int,
        target_label: str = "production",
        set_by: str = "system",
    ) -> bool:
        """
        切换标签指向版本（对应 Langfuse Prompt.promote）。
        例如：将 v4 设为 production，替代之前的 v3。
        """
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT prompt_id FROM prompts WHERE name=? AND version=?",
                (name, version)
            ).fetchone()
            if not row:
                return False
            prompt_id = row["prompt_id"]
            label_id = f"lb_{uuid.uuid4().hex[:12]}"
            # UPSERT：如果 (name, label) 已存在则更新
            conn.execute(
                """INSERT INTO prompt_labels (label_id, name, label, prompt_id, version, set_at, set_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(name, label) DO UPDATE SET
                       prompt_id=excluded.prompt_id,
                       version=excluded.version,
                       set_at=excluded.set_at,
                       set_by=excluded.set_by""",
                (label_id, name, target_label, prompt_id, version, self._now(), set_by)
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def list_versions(
        self,
        name: str,
        include_archived: bool = False,
    ) -> list[dict[str, Any]]:
        """列出 Prompt 的所有版本（对应 Langfuse Prompts 列表页）"""
        conn = self._conn()
        try:
            q = "SELECT * FROM prompts WHERE name=?"
            params: list[Any] = [name]
            if not include_archived:
                q += " AND is_archived=0"
            q += " ORDER BY version DESC"
            rows = conn.execute(q, params).fetchall()

            # 附加 active_labels
            result = []
            for row in rows:
                d = dict(row)
                d["variables"] = json.loads(d.get("variables", "[]"))
                d["labels"]    = json.loads(d.get("labels", "[]"))
                d["config"]    = json.loads(d.get("config", "{}"))
                label_rows = conn.execute(
                    "SELECT label FROM prompt_labels WHERE prompt_id=?", (d["prompt_id"],)
                ).fetchall()
                d["active_labels"] = [r["label"] for r in label_rows]
                result.append(d)
            return result
        finally:
            conn.close()

    def list_prompts(
        self,
        lobster: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """列出所有 Prompt 名称（及当前生产版本）"""
        conn = self._conn()
        try:
            q = """
                SELECT p.name, p.lobster, p.skill,
                       pl_prod.version as production_version,
                       pl_prev.version as preview_version,
                       MAX(p.version) as latest_version,
                       COUNT(p.version) as total_versions
                FROM prompts p
                LEFT JOIN prompt_labels pl_prod ON pl_prod.name=p.name AND pl_prod.label='production'
                LEFT JOIN prompt_labels pl_prev ON pl_prev.name=p.name AND pl_prev.label='preview'
                WHERE p.is_archived=0
            """
            params: list[Any] = []
            if lobster:
                q += " AND p.lobster=?"
                params.append(lobster)
            q += " GROUP BY p.name ORDER BY p.lobster, p.name"
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def _parse_unified_diff(diff_lines: list[str]) -> list[dict[str, Any]]:
        hunks: list[dict[str, Any]] = []
        current_hunk: dict[str, Any] | None = None
        for line in diff_lines:
            if line.startswith("@@"):
                if current_hunk:
                    hunks.append(current_hunk)
                current_hunk = {"header": line, "lines": []}
                continue
            if current_hunk is None:
                continue
            if line.startswith("+++ ") or line.startswith("--- "):
                continue
            if line.startswith("+"):
                line_type = "add"
                content = line[1:]
            elif line.startswith("-"):
                line_type = "remove"
                content = line[1:]
            else:
                line_type = "context"
                content = line[1:] if line.startswith(" ") else line
            current_hunk["lines"].append({"type": line_type, "content": content})
        if current_hunk:
            hunks.append(current_hunk)
        return hunks

    def diff(self, name: str, version_a: int, version_b: int) -> dict[str, Any]:
        """
        版本 Diff 对比（对应 Langfuse Prompt Diff 视图）。
        返回两个版本的 content / config / variables 差异。
        """
        a = self.get(name, version=version_a)
        b = self.get(name, version=version_b)
        if not a or not b:
            return {"error": "版本不存在"}

        import difflib
        content_diff = list(difflib.unified_diff(
            a["content"].splitlines(keepends=True),
            b["content"].splitlines(keepends=True),
            fromfile=f"v{version_a}",
            tofile=f"v{version_b}",
            lineterm="",
        ))

        added_vars   = [v for v in b["variables"] if v not in a["variables"]]
        removed_vars = [v for v in a["variables"] if v not in b["variables"]]

        config_diff = {}
        for k in set(list(a["config"].keys()) + list(b["config"].keys())):
            va, vb = a["config"].get(k), b["config"].get(k)
            if va != vb:
                config_diff[k] = {"before": va, "after": vb}

        hunks = self._parse_unified_diff(content_diff)
        stats = {
            "added": sum(1 for h in hunks for line in h["lines"] if line["type"] == "add"),
            "removed": sum(1 for h in hunks for line in h["lines"] if line["type"] == "remove"),
            "context": sum(1 for h in hunks for line in h["lines"] if line["type"] == "context"),
        }

        return {
            "name": name,
            "version_a": version_a,
            "version_b": version_b,
            "content_diff": "\n".join(content_diff),
            "hunks": hunks,
            "stats": stats,
            "added_variables": added_vars,
            "removed_variables": removed_vars,
            "config_changes": config_diff,
            "commit_a": a.get("commit_message", ""),
            "commit_b": b.get("commit_message", ""),
        }

    def archive(self, name: str, version: int) -> bool:
        """归档旧版本（软删除）"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE prompts SET is_archived=1 WHERE name=? AND version=?",
                (name, version)
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def record_usage(
        self,
        name: str,
        version: int,
        tenant_id: str = "tenant_main",
        lobster: str = "",
        gen_id: str = "",
        variant_name: str = "control",
        quality_score: float = 0.0,
        latency_ms: int = 0,
    ) -> None:
        """记录 Prompt 使用次数（关联到 llm_call_logger 的 gen_id）"""
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT prompt_id FROM prompts WHERE name=? AND version=?", (name, version)
            ).fetchone()
            if not row:
                return
            conn.execute(
                """INSERT INTO prompt_usage
                   (usage_id, prompt_id, name, version, tenant_id, lobster, gen_id, used_at, variant_name, quality_score, latency_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"pu_{uuid.uuid4().hex[:12]}", row["prompt_id"],
                 name, version, tenant_id, lobster, gen_id, self._now(), variant_name, quality_score, latency_ms)
            )
            conn.commit()
        finally:
            conn.close()

    def get_usage_stats(
        self,
        name: str,
        days: int = 30,
    ) -> dict[str, Any]:
        """获取 Prompt 版本使用统计"""
        from datetime import timedelta
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        conn = self._conn()
        try:
            rows = conn.execute(
                """SELECT version, COUNT(*) as usage_count
                   FROM prompt_usage
                   WHERE name=? AND used_at >= ?
                   GROUP BY version ORDER BY version DESC""",
                (name, since)
            ).fetchall()
            return {
                "name": name,
                "days": days,
                "by_version": [dict(r) for r in rows],
                "total_calls": sum(r["usage_count"] for r in rows),
            }
        finally:
            conn.close()

    def render(self, name: str, variables: dict[str, str],
               label: str = "production") -> Optional[str]:
        """
        渲染 Prompt（替换变量占位符）。
        例如：render("inkwriter_copy", {"industry": "餐饮", "customer_name": "火锅店"})
        """
        prompt = self.get(name, label=label)
        if not prompt:
            return None
        content = prompt["content"]
        for k, v in variables.items():
            content = content.replace(f"{{{k}}}", str(v))
        return content

    def _prompt_version_path(self, lobster: str, skill: str, version: str) -> Path:
        return Path(__file__).resolve().parent / "prompts" / lobster / f"{skill}_{version}.md"

    def _stable_override_path(self, lobster: str, skill: str) -> Path:
        return Path(__file__).resolve().parent / "prompts" / lobster / f"{skill}_stable.md"

    def _read_prompt_file(self, path: Path) -> str:
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def get_prompt_with_ab(
        self,
        lobster_name: str,
        skill_name: str,
        ctx: Any,
        *,
        fallback_prompt: str = "",
    ) -> tuple[str, str]:
        """
        Resolve prompt text with feature-flag-based variant routing.
        """
        stable_override = self._read_prompt_file(self._stable_override_path(lobster_name, skill_name)).strip()
        base_prompt = stable_override or fallback_prompt
        try:
            from feature_flags import ff_get_variant
        except Exception:
            return base_prompt, "control"

        flag_name = f"prompt.{lobster_name}.{skill_name}.experiment"
        variant = ff_get_variant(flag_name, ctx)
        if not variant.enabled or variant.name == "control":
            return base_prompt, "control"

        prompt_version = str(variant.payload or variant.name).strip()
        experiment_path = self._prompt_version_path(lobster_name, skill_name, prompt_version)
        experiment_prompt = self._read_prompt_file(experiment_path).strip()
        if not experiment_prompt:
            return base_prompt, "control"
        return experiment_prompt, variant.name

    def record_experiment_outcome(
        self,
        *,
        flag_name: str,
        lobster: str,
        skill: str,
        variant_name: str,
        tenant_id: str,
        quality_score: float,
        latency_ms: int,
        prompt_name: str = "",
        prompt_version: int = 0,
        gen_id: str = "",
    ) -> None:
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO prompt_experiment_metrics(
                    id, flag_name, lobster, skill, variant_name, tenant_id, gen_id,
                    quality_score, latency_ms, prompt_name, prompt_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"pem_{uuid.uuid4().hex[:12]}",
                    flag_name,
                    lobster,
                    skill,
                    variant_name,
                    tenant_id,
                    gen_id,
                    float(quality_score),
                    int(latency_ms),
                    prompt_name,
                    int(prompt_version),
                    self._now(),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def get_experiment_report(
        self,
        flag_name: str,
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> dict[str, Any]:
        conn = self._conn()
        try:
            params: list[Any] = [flag_name]
            sql = """
                SELECT variant_name,
                       COUNT(*) as count,
                       AVG(quality_score) as avg_quality_score,
                       AVG(latency_ms) as avg_latency_ms
                FROM prompt_experiment_metrics
                WHERE flag_name = ?
            """
            if from_date:
                sql += " AND created_at >= ?"
                params.append(from_date)
            if to_date:
                sql += " AND created_at <= ?"
                params.append(to_date)
            sql += " GROUP BY variant_name ORDER BY count DESC"
            rows = conn.execute(sql, params).fetchall()
            variants = {}
            winner = None
            winner_score = -1.0
            total = 0
            for row in rows:
                data = {
                    "name": str(row["variant_name"]),
                    "weight": 0,
                    "count": int(row["count"] or 0),
                    "avg_quality_score": round(float(row["avg_quality_score"] or 0), 3),
                    "avg_latency_ms": round(float(row["avg_latency_ms"] or 0), 1),
                    "is_winner": False,
                }
                total += data["count"]
                variants[data["name"]] = data
                if data["avg_quality_score"] > winner_score:
                    winner_score = data["avg_quality_score"]
                    winner = data["name"]
            if winner and winner in variants:
                variants[winner]["is_winner"] = True
            return {
                "flag_name": flag_name,
                "period": {"from": from_date, "to": to_date},
                "variants": variants,
                "winner": winner,
                "confidence": round(min(0.99, total / 1000.0), 2) if total else 0.0,
            }
        finally:
            conn.close()

    def list_prompt_experiments(self) -> list[dict[str, Any]]:
        try:
            from feature_flags import Environment, get_feature_flag_client
        except Exception:
            return []
        rows = []
        for flag in get_feature_flag_client().list_flags():
            if not flag.name.startswith("prompt."):
                continue
            parts = flag.name.split(".")
            if len(parts) < 4:
                continue
            rows.append(
                {
                    "flag_name": flag.name,
                    "lobster_name": parts[1],
                    "skill_name": parts[2],
                    "status": "running" if flag.enabled else "stopped",
                    "environment": flag.environment.value if isinstance(flag.environment, Environment) else str(flag.environment),
                    "variants": [asdict(item) for item in flag.variants],
                    "started_at": flag.created_at,
                    "updated_at": flag.updated_at,
                }
            )
        return rows

    def promote_experiment(self, flag_name: str, winner_variant: str, *, changed_by: str = "system") -> dict[str, Any]:
        parts = flag_name.split(".")
        if len(parts) < 4:
            raise ValueError("invalid_flag_name")
        lobster_name = parts[1]
        skill_name = parts[2]
        source_path = self._prompt_version_path(lobster_name, skill_name, winner_variant)
        if not source_path.exists():
            raise FileNotFoundError(f"variant_prompt_not_found:{source_path}")
        target_path = self._stable_override_path(lobster_name, skill_name)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")
        try:
            from feature_flags import get_feature_flag_client

            client = get_feature_flag_client()
            flag = client.get_flag(flag_name, environment="prod")
            if flag is not None:
                flag.enabled = False
                client.upsert_flag(flag, changed_by=changed_by)
        except Exception:
            pass
        return {
            "flag_name": flag_name,
            "winner_variant": winner_variant,
            "stable_path": str(target_path),
        }


# ─────────────────────────────────────────────────────────────────
# 内置默认 Prompt 种子（供首次初始化使用）
# ─────────────────────────────────────────────────────────────────

SEED_PROMPTS: list[dict[str, Any]] = [
    {
        "name": "inkwriter_copy_generate",
        "lobster": "inkwriter",
        "skill": "inkwriter_industry_vertical_copy",
        "content": """你是一位专业的{industry}行业文案师，擅长创作能引发{target_audience}共鸣的社交媒体内容。

客户信息：
- 商家名称：{customer_name}
- 核心优势：{core_advantage}
- 客户痛点：{pain_point}
- 目标平台：{platform}

请根据以上信息，创作一篇{platform}风格的推广文案，要求：
1. 开头用一句话精准击中痛点（钩子句）
2. 中间展示解决方案和差异化优势
3. 结尾有明确的行动召唤（CTA）
4. 语气自然真实，避免广告感
5. 字数控制在{word_count}字以内

输出格式：
钩子：（1句话）
正文：（3-5段）
CTA：（1句话）""",
        "variables": ["industry", "target_audience", "customer_name", "core_advantage",
                      "pain_point", "platform", "word_count"],
        "commit_message": "初始版本：行业垂类文案生成模板",
        "config": {"temperature": 0.8, "max_tokens": 2000},
        "labels": ["production"],
    },
    {
        "name": "catcher_compliance_check",
        "lobster": "catcher",
        "skill": "catcher_compliance_audit",
        "content": """你是一位专业的内容合规审核员，负责审核社交媒体营销内容是否合规。

请审核以下内容：
{content_to_check}

审核维度：
1. 违禁词/敏感词（医疗宣传、绝对化用词、虚假宣传等）
2. 平台规则合规（{platform}平台特定禁忌）
3. 法律风险（虚假宣传、价格误导等）
4. 品牌安全（不涉及竞品攻击、政治敏感等）

请以JSON格式输出：
{
  "pass": true/false,
  "risk_level": "low/medium/high",
  "issues": [{"type": "违禁词", "content": "...", "suggestion": "..."}],
  "revised_content": "如有问题，提供修改后版本"
}""",
        "variables": ["content_to_check", "platform"],
        "commit_message": "初始版本：内容合规审核模板",
        "config": {"temperature": 0.1, "max_tokens": 1000},
        "labels": ["production"],
    },
    {
        "name": "abacus_lead_score",
        "lobster": "abacus",
        "skill": "abacus_lead_score_model",
        "content": """你是一位专业的销售线索评分分析师。

请分析以下用户行为数据，评估其购买意向：

用户互动记录：
{interaction_data}

商家类型：{business_type}
目标客单价：{target_price}

请从以下维度评分（每项0-10分）：
1. 互动质量（问问题的具体程度）
2. 需求明确度（是否有明确需求）
3. 购买紧迫性（时间敏感度）
4. 决策权判断（是否是决策者）

输出JSON：
{
  "total_score": 85,
  "intent_level": "high/medium/low",
  "scores": {"interaction_quality": 8, "need_clarity": 9, "urgency": 7, "decision_power": 8},
  "recommended_action": "立即电话跟进 / 推送优惠券 / 加入观察池",
  "follow_up_script": "推荐的开场白话术"
}""",
        "variables": ["interaction_data", "business_type", "target_price"],
        "commit_message": "初始版本：线索评分模板",
        "config": {"temperature": 0.2, "max_tokens": 800},
        "labels": ["production"],
    },
]


def seed_default_prompts(registry: Optional[PromptRegistry] = None) -> None:
    """
    初始化种子 Prompt（首次部署时调用）。
    已存在的 Prompt 不会重复创建。
    """
    if registry is None:
        registry = get_prompt_registry()

    for seed in SEED_PROMPTS:
        existing = registry.list_versions(seed["name"])
        if existing:
            continue  # 已有版本，跳过

        registry.push(
            name=seed["name"],
            lobster=seed.get("lobster", ""),
            skill=seed.get("skill", ""),
            content=seed["content"],
            variables=seed.get("variables"),
            labels=seed.get("labels"),
            config=seed.get("config"),
            commit_message=seed.get("commit_message", "seed"),
            auto_promote="production" in seed.get("labels", []),
        )


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_registry: Optional[PromptRegistry] = None


def get_prompt_registry() -> PromptRegistry:
    """获取全局默认 PromptRegistry 单例"""
    global _default_registry
    if _default_registry is None:
        _default_registry = PromptRegistry()
    return _default_registry
