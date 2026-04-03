"""
YAML workflow definition loader.

This sits alongside workflow_engine.py and provides a lighter-weight metadata
loader for design-time workflow introspection.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

WORKFLOWS_DIR = Path(__file__).resolve().parent / "workflows"


@dataclass
class WorkflowNodeDef:
    id: str
    lobster: str
    description: str
    node_type: str = "worker"
    expects: str | None = None
    max_retries: int = 0
    timeout_seconds: int = 60


@dataclass
class WorkflowEdgeDef:
    from_node: str
    to_nodes: list[str]
    parallel: bool = False
    wait_for: str | None = None
    condition: str | None = None


@dataclass
class WorkflowDef:
    workflow_id: str
    version: str
    description: str
    nodes: list[WorkflowNodeDef] = field(default_factory=list)
    edges: list[WorkflowEdgeDef] = field(default_factory=list)
    config: dict[str, Any] = field(default_factory=dict)
    loaded_at: float = field(default_factory=time.monotonic)


class WorkflowLoader:
    def __init__(self, workflows_dir: str | Path = WORKFLOWS_DIR) -> None:
        self._dir = Path(workflows_dir)
        self._cache: dict[str, WorkflowDef] = {}
        self._mtime_cache: dict[str, float] = {}

    def load(self, workflow_id: str) -> WorkflowDef:
        path = self._dir / f"{workflow_id}.yaml"
        current_mtime = path.stat().st_mtime
        if workflow_id in self._cache and current_mtime <= self._mtime_cache.get(workflow_id, 0):
            return self._cache[workflow_id]
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        workflow = self._parse(raw)
        self._cache[workflow_id] = workflow
        self._mtime_cache[workflow_id] = current_mtime
        return workflow

    def load_or_fallback(self, workflow_id: str) -> WorkflowDef | None:
        try:
            return self.load(workflow_id)
        except Exception:
            return None

    def _parse(self, raw: dict[str, Any]) -> WorkflowDef:
        metadata = raw.get("metadata", {}) or {}
        nodes = [
            WorkflowNodeDef(
                id=str(item.get("id") or ""),
                lobster=str(item.get("lobster") or item.get("id") or ""),
                description=str(item.get("description") or ""),
                node_type=str(item.get("type") or "worker"),
                expects=item.get("expects"),
                max_retries=int(item.get("max_retries", 0) or 0),
                timeout_seconds=int(item.get("timeout_seconds", 60) or 60),
            )
            for item in list(raw.get("nodes") or [])
            if str(item.get("id") or "").strip()
        ]
        edges = []
        for item in list(raw.get("edges") or []):
            to = item.get("to") or []
            to_nodes = [str(to)] if isinstance(to, str) else [str(node) for node in to]
            edges.append(
                WorkflowEdgeDef(
                    from_node=str(item.get("from") or ""),
                    to_nodes=to_nodes,
                    parallel=bool(item.get("parallel", False)),
                    wait_for=str(item.get("wait_for") or "").strip() or None,
                    condition=str(item.get("condition") or "").strip() or None,
                )
            )
        return WorkflowDef(
            workflow_id=str(metadata.get("workflow_id") or "unknown"),
            version=str(metadata.get("version") or "0.0.0"),
            description=str(metadata.get("description") or ""),
            nodes=nodes,
            edges=edges,
            config=dict(raw.get("config") or {}),
        )


_loader: WorkflowLoader | None = None


def get_workflow_loader() -> WorkflowLoader:
    global _loader
    if _loader is None:
        _loader = WorkflowLoader()
    return _loader
