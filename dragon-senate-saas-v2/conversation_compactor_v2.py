"""
Layered conversation compactor inspired by lossless-claw.

This keeps a fresh tail uncompressed, builds leaf summaries for older chunks,
optionally rolls them up into a session summary, and exposes a compatibility
wrapper so existing callers can migrate incrementally.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("conversation_compactor_v2")

FRESH_TAIL_COUNT = 32
LEAF_CHUNK_MAX_TOKENS = 8000
LEAF_MIN_MESSAGES = 8
SESSION_MIN_LEAVES = 3
SUMMARY_MAX_TOKENS = 2000
CHARS_PER_TOKEN = 4


def estimate_text_tokens(text: str) -> int:
    return max(1, len(str(text or "")) // CHARS_PER_TOKEN)


def estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    total = 0
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, list):
            content = " ".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
        total += estimate_text_tokens(str(content))
    return total


def check_integrity(summary: str, marker: str = "【摘要完毕】") -> bool:
    return str(summary or "").strip().endswith(marker)


def deterministic_truncate(text: str, max_tokens: int = SUMMARY_MAX_TOKENS) -> str:
    max_chars = max_tokens * CHARS_PER_TOKEN
    trimmed = str(text or "")[:max_chars].rstrip()
    if not trimmed:
        return "（无内容）"
    return trimmed


def chunk_messages(messages: list[dict[str, Any]], max_tokens: int = LEAF_CHUNK_MAX_TOKENS) -> list[list[dict[str, Any]]]:
    chunks: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_tokens = 0
    for message in messages:
        message_tokens = estimate_text_tokens(json.dumps(message, ensure_ascii=False))
        if current and current_tokens + message_tokens > max_tokens:
            chunks.append(current)
            current = []
            current_tokens = 0
        current.append(message)
        current_tokens += message_tokens
    if current:
        chunks.append(current)
    return chunks


@dataclass
class CompactorV2Result:
    lobster_id: str
    mode: str
    fresh_tail: list[dict[str, Any]]
    leaves: list[dict[str, Any]]
    session_summary: dict[str, Any] | None
    context_for_next_turn: str
    stats: dict[str, Any]
    compacted_at: float = field(default_factory=time.time)


class ConversationCompactorV2:
    LEAF_PROMPT = """你是专业的对话压缩助手。
请将以下对话块压缩成 300-800 字摘要，保留任务目标、关键决策、结果、未完成事项、重要数字。
必须以【摘要完毕】结尾。
"""

    SESSION_PROMPT = """你是专业的会话压缩助手。
请将多个 Leaf 摘要合并成更高层的会话摘要，保留整体脉络、关键结论、未完成事项。
必须以【会话摘要完毕】结尾。
"""

    def __init__(self, llm_router: Any) -> None:
        self.llm_router = llm_router

    async def summarize_with_fallback(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        fallback_source: str,
        integrity_marker: str,
    ) -> tuple[str, str]:
        try:
            from llm_router import RouteMeta

            result = await self.llm_router.routed_ainvoke_text(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=estimate_text_tokens(user_prompt) + SUMMARY_MAX_TOKENS,
                    tenant_tier="basic",
                    user_id="conversation_compactor_v2",
                    tenant_id="system",
                    task_type="conversation_compact_v2",
                ),
                temperature=0.1,
            )
            text = str(result or "").strip()
            if check_integrity(text, integrity_marker) and len(text) <= SUMMARY_MAX_TOKENS * CHARS_PER_TOKEN:
                return text, "normal"
        except Exception as exc:  # noqa: BLE001
            logger.warning("[CompactorV2] normal summarization failed: %s", exc)

        aggressive_prompt = user_prompt + "\n\n请更短、更结构化，只保留必要信息，并以指定结束标记收尾。"
        try:
            from llm_router import RouteMeta

            result = await self.llm_router.routed_ainvoke_text(
                system_prompt=system_prompt,
                user_prompt=aggressive_prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=estimate_text_tokens(aggressive_prompt) + SUMMARY_MAX_TOKENS,
                    tenant_tier="basic",
                    user_id="conversation_compactor_v2",
                    tenant_id="system",
                    task_type="conversation_compact_v2",
                ),
                temperature=0.05,
            )
            text = str(result or "").strip()
            if check_integrity(text, integrity_marker):
                return text, "aggressive"
        except Exception as exc:  # noqa: BLE001
            logger.warning("[CompactorV2] aggressive summarization failed: %s", exc)

        truncated = deterministic_truncate(fallback_source, SUMMARY_MAX_TOKENS)
        return truncated + f"\n{integrity_marker[:-1]}（截断版）】", "truncated"

    async def compress_to_leaves(
        self,
        lobster_id: str,
        messages: list[dict[str, Any]],
        previous_summary: str = "",
    ) -> tuple[list[dict[str, Any]], int]:
        leaves: list[dict[str, Any]] = []
        degraded_count = 0
        for index, chunk in enumerate(chunk_messages(messages), start=1):
            text = self._messages_to_text(chunk)
            earliest = str(chunk[0].get("timestamp") or chunk[0].get("created_at") or "")
            latest = str(chunk[-1].get("timestamp") or chunk[-1].get("created_at") or "")
            previous_tail = previous_summary[-300:] if previous_summary else ""
            summary, mode = await self.summarize_with_fallback(
                system_prompt=self.LEAF_PROMPT,
                user_prompt=(
                    f"时间范围：{earliest} - {latest}\n"
                    f"上一段摘要结尾：{previous_tail}\n\n"
                    f"对话内容：\n{text}"
                ),
                fallback_source=text,
                integrity_marker="【摘要完毕】",
            )
            degraded_count += 1 if mode != "normal" else 0
            leaves.append(
                {
                    "leaf_id": f"{lobster_id}_leaf_{index:03d}",
                    "depth": 0,
                    "kind": "leaf",
                    "content": summary,
                    "source_message_ids": [str(item.get("id") or item.get("message_id") or index) for item in chunk],
                    "token_count": estimate_text_tokens(summary),
                    "earliest_at": earliest,
                    "latest_at": latest,
                    "truncated": mode == "truncated",
                }
            )
            previous_summary = summary
        return leaves, degraded_count

    async def compress_leaves_to_session(self, lobster_id: str, leaves: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, int]:
        if len(leaves) < SESSION_MIN_LEAVES:
            return None, 0
        leaves_text = "\n\n".join(
            f"[{leaf.get('earliest_at')} - {leaf.get('latest_at')}]\n{leaf.get('content')}"
            for leaf in leaves
        )
        summary, mode = await self.summarize_with_fallback(
            system_prompt=self.SESSION_PROMPT,
            user_prompt=f"Leaf 摘要：\n{leaves_text}",
            fallback_source=leaves_text,
            integrity_marker="【会话摘要完毕】",
        )
        return (
            {
                "session_id": f"{lobster_id}_session_{int(time.time())}",
                "depth": 1,
                "kind": "session",
                "content": summary,
                "source_leaf_ids": [leaf["leaf_id"] for leaf in leaves],
                "token_count": estimate_text_tokens(summary),
                "earliest_at": leaves[0].get("earliest_at"),
                "latest_at": leaves[-1].get("latest_at"),
                "truncated": mode == "truncated",
            },
            1 if mode != "normal" else 0,
        )

    async def compact_lobster_session(
        self,
        lobster_id: str,
        messages: list[dict[str, Any]],
        existing_summaries: list[dict[str, Any]] | None = None,
        mode: str = "incremental",
    ) -> CompactorV2Result:
        existing_summaries = existing_summaries or []
        fresh_tail = messages[-FRESH_TAIL_COUNT:] if len(messages) > FRESH_TAIL_COUNT else list(messages)
        compress_target = messages[:-FRESH_TAIL_COUNT] if len(messages) > FRESH_TAIL_COUNT else []

        if len(compress_target) < LEAF_MIN_MESSAGES:
            context = self.assemble_context(None, [], fresh_tail)
            return CompactorV2Result(
                lobster_id=lobster_id,
                mode=mode,
                fresh_tail=fresh_tail,
                leaves=[],
                session_summary=None,
                context_for_next_turn=context,
                stats={
                    "messages_compressed": 0,
                    "messages_protected": len(fresh_tail),
                    "leaves_generated": 0,
                    "session_generated": False,
                    "degraded_count": 0,
                },
            )

        previous_summary = str(existing_summaries[-1].get("content") or "") if existing_summaries else ""
        leaves, degraded_leafs = await self.compress_to_leaves(lobster_id, compress_target, previous_summary)
        session_summary, degraded_session = await self.compress_leaves_to_session(lobster_id, leaves)
        context = self.assemble_context(session_summary, leaves, fresh_tail)

        return CompactorV2Result(
            lobster_id=lobster_id,
            mode=mode,
            fresh_tail=fresh_tail,
            leaves=leaves,
            session_summary=session_summary,
            context_for_next_turn=context,
            stats={
                "messages_compressed": len(compress_target),
                "messages_protected": len(fresh_tail),
                "leaves_generated": len(leaves),
                "session_generated": session_summary is not None,
                "degraded_count": degraded_leafs + degraded_session,
            },
        )

    def assemble_context(
        self,
        session_summary: dict[str, Any] | None,
        leaves: list[dict[str, Any]],
        fresh_tail: list[dict[str, Any]],
    ) -> str:
        parts: list[str] = []
        if session_summary:
            parts.append(f"## 历史会话摘要\n{session_summary['content']}")
        elif leaves:
            for leaf in leaves[-3:]:
                parts.append(f"## 对话块摘要（{leaf['earliest_at']} - {leaf['latest_at']}）\n{leaf['content']}")
        if fresh_tail:
            tail_lines = []
            for message in fresh_tail:
                role = message.get("role", "unknown")
                content = message.get("content", "")
                if isinstance(content, list):
                    content = " ".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
                tail_lines.append(f"[{role}]: {content}")
            parts.append("## 最近对话记录\n" + "\n".join(tail_lines))
        return "\n\n".join(parts)

    def _messages_to_text(self, messages: list[dict[str, Any]]) -> str:
        rows: list[str] = []
        for message in messages:
            role = str(message.get("role") or "unknown").upper()
            content = message.get("content", "")
            if isinstance(content, list):
                content = " ".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
            rows.append(f"[{role}]\n{content}")
        return "\n\n---\n\n".join(rows)


async def compact_conversation(lobster_id: str, messages: list[dict[str, Any]], llm_router: Any) -> str:
    result = await ConversationCompactorV2(llm_router).compact_lobster_session(lobster_id, messages)
    return result.context_for_next_turn
