"""
Edge node group / hierarchy management.
"""

from __future__ import annotations

import os
import sqlite3
import time
import uuid
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any


DB_PATH = Path(os.getenv("EDGE_NODE_GROUP_DB", "./data/edge_node_groups.sqlite"))


@dataclass(slots=True)
class EdgeNodeGroup:
    group_id: str
    tenant_id: str
    name: str
    parent_group_id: str | None = None
    description: str = ""
    tags: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    is_active: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class EdgeNodeGroupManager:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS edge_node_groups (
                    group_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    parent_group_id TEXT,
                    description TEXT DEFAULT '',
                    tags_json TEXT DEFAULT '[]',
                    is_active INTEGER DEFAULT 1,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_edge_groups_tenant ON edge_node_groups(tenant_id, is_active);
                CREATE INDEX IF NOT EXISTS idx_edge_groups_parent ON edge_node_groups(parent_group_id);

                CREATE TABLE IF NOT EXISTS edge_node_group_members (
                    tenant_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    group_id TEXT NOT NULL,
                    assigned_at REAL NOT NULL,
                    PRIMARY KEY (tenant_id, node_id)
                );
                CREATE INDEX IF NOT EXISTS idx_edge_group_members_group ON edge_node_group_members(group_id, tenant_id);
                """
            )
            conn.commit()
        finally:
            conn.close()

    def create_group(
        self,
        *,
        name: str,
        tenant_id: str,
        parent_group_id: str | None = None,
        description: str = "",
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        group = EdgeNodeGroup(
            group_id=f"grp_{uuid.uuid4().hex[:12]}",
            tenant_id=tenant_id,
            name=name,
            parent_group_id=parent_group_id,
            description=description,
            tags=[str(item).strip() for item in (tags or []) if str(item).strip()],
        )
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO edge_node_groups (
                    group_id, tenant_id, name, parent_group_id, description,
                    tags_json, is_active, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    group.group_id,
                    group.tenant_id,
                    group.name,
                    group.parent_group_id,
                    group.description,
                    json_dumps(group.tags),
                    1 if group.is_active else 0,
                    group.created_at,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return group.to_dict()

    def get_groups(self, tenant_id: str) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT * FROM edge_node_groups
                WHERE tenant_id=? AND is_active=1
                ORDER BY name ASC
                """,
                (tenant_id,),
            ).fetchall()
            return [self._serialize_group(row) for row in rows]
        finally:
            conn.close()

    def get_group_tree(self, tenant_id: str) -> list[dict[str, Any]]:
        groups = self.get_groups(tenant_id)
        node_map = self.get_node_group_map(tenant_id)
        node_count_map: dict[str, int] = {}
        for node in node_map.values():
            group_id = str(node.get("group_id") or "")
            if group_id:
                node_count_map[group_id] = node_count_map.get(group_id, 0) + 1
        group_lookup = {
            item["group_id"]: {**item, "children": [], "node_count": int(node_count_map.get(item["group_id"], 0))}
            for item in groups
        }
        roots: list[dict[str, Any]] = []
        for item in group_lookup.values():
            parent_id = item.get("parent_group_id")
            if parent_id and parent_id in group_lookup:
                group_lookup[parent_id]["children"].append(item)
            else:
                roots.append(item)
        return roots

    def add_node_to_group(self, *, tenant_id: str, node_id: str, group_id: str) -> dict[str, Any]:
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO edge_node_group_members (tenant_id, node_id, group_id, assigned_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(tenant_id, node_id) DO UPDATE SET
                    group_id=excluded.group_id,
                    assigned_at=excluded.assigned_at
                """,
                (tenant_id, node_id, group_id, time.time()),
            )
            conn.commit()
        finally:
            conn.close()
        return {"tenant_id": tenant_id, "node_id": node_id, "group_id": group_id}

    def remove_node_from_group(self, *, tenant_id: str, node_id: str) -> bool:
        conn = self._conn()
        try:
            conn.execute(
                "DELETE FROM edge_node_group_members WHERE tenant_id=? AND node_id=?",
                (tenant_id, node_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def get_node_group_map(self, tenant_id: str) -> dict[str, dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT m.node_id, m.group_id, g.name AS group_name, g.parent_group_id
                FROM edge_node_group_members m
                LEFT JOIN edge_node_groups g ON g.group_id=m.group_id
                WHERE m.tenant_id=?
                """,
                (tenant_id,),
            ).fetchall()
            return {
                str(row["node_id"]): {
                    "group_id": row["group_id"],
                    "group_name": row["group_name"],
                    "parent_group_id": row["parent_group_id"],
                }
                for row in rows
            }
        finally:
            conn.close()

    def get_nodes_in_group(self, tenant_id: str, group_id: str, include_subgroups: bool = True) -> list[str]:
        target_ids = {group_id}
        if include_subgroups:
            target_ids |= self._collect_subgroup_ids(tenant_id, group_id)
        conn = self._conn()
        try:
            node_ids: list[str] = []
            for gid in target_ids:
                rows = conn.execute(
                    "SELECT node_id FROM edge_node_group_members WHERE tenant_id=? AND group_id=?",
                    (tenant_id, gid),
                ).fetchall()
                node_ids.extend(str(row["node_id"]) for row in rows)
            return sorted(set(node_ids))
        finally:
            conn.close()

    def _collect_subgroup_ids(self, tenant_id: str, group_id: str) -> set[str]:
        conn = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT group_id FROM edge_node_groups
                WHERE tenant_id=? AND parent_group_id=? AND is_active=1
                """,
                (tenant_id, group_id),
            ).fetchall()
        finally:
            conn.close()
        ids = {str(row["group_id"]) for row in rows}
        for child in list(ids):
            ids |= self._collect_subgroup_ids(tenant_id, child)
        return ids

    def _serialize_group(self, row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data["tags"] = json_loads(data.pop("tags_json", "[]"))
        data["is_active"] = bool(data.get("is_active"))
        return data


def json_dumps(value: Any) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)


def json_loads(value: str) -> Any:
    import json

    try:
        return json.loads(value)
    except Exception:
        return []


_default_manager: EdgeNodeGroupManager | None = None


def get_edge_node_group_manager() -> EdgeNodeGroupManager:
    global _default_manager
    if _default_manager is None:
        _default_manager = EdgeNodeGroupManager()
    return _default_manager
