"""
Memory Consolidator — Edge Runtime Token Budget Memory
=======================================================
借鉴 NanoBot MemoryConsolidator 的设计，为 Edge Runtime 的 WSS 会话
提供基于 token 预算的自动记忆归纳。

当会话上下文接近 token 上限时，自动将旧消息归纳为摘要，
保持会话可用性，避免 token 溢出。

Architecture boundary: 这是边缘端组件，仅做会话管理，
不做策略决策、不调用大模型（归纳由云端完成）。

Key design (from NanoBot):
  1. Token 预算控制: budget = context_window - max_completion - safety_buffer
  2. User-turn 边界: 只在 user 消息边界处切割
  3. 降级策略: LLM 归纳失败 N 次后 raw dump
  4. 两层存储: 长期记忆 + 可搜索历史日志
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Awaitable, Optional

logger = logging.getLogger("edge_memory")


# ────────────────────────────────────────────────────────────────────
# Token Estimation
# ────────────────────────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """
    Fast token estimation (no tokenizer dependency on edge).
    ~4 chars per token for English, ~2 chars per CJK character.
    """
    if not text:
        return 0
    # Count CJK characters (roughly 1 token each)
    cjk_count = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    # Non-CJK portion at ~4 chars/token
    non_cjk_len = len(text) - cjk_count
    return cjk_count + max(1, non_cjk_len // 4)


def estimate_message_tokens(msg: dict[str, Any]) -> int:
    """Estimate tokens for a single message."""
    content = msg.get("content", "")
    if isinstance(content, str):
        return estimate_tokens(content) + 4  # message overhead
    elif isinstance(content, list):
        total = 4
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                total += estimate_tokens(block.get("text", ""))
        return total
    return 4


def estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    """Estimate total tokens for a list of messages."""
    return sum(estimate_message_tokens(m) for m in messages)


# ────────────────────────────────────────────────────────────────────
# Session Memory Store
# ────────────────────────────────────────────────────────────────────

@dataclass
class SessionMemory:
    """
    Per-session memory state on the edge.

    - messages: full message history
    - last_consolidated: index up to which messages have been archived
    - long_term_memory: persistent facts (set by cloud consolidation callback)
    - history_entries: searchable log entries
    """
    session_id: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    last_consolidated: int = 0
    long_term_memory: str = ""
    history_entries: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @property
    def unconsolidated_messages(self) -> list[dict[str, Any]]:
        """Messages not yet archived."""
        return self.messages[self.last_consolidated:]

    @property
    def total_tokens(self) -> int:
        """Estimate total tokens in current messages."""
        return estimate_messages_tokens(self.messages)

    @property
    def unconsolidated_tokens(self) -> int:
        """Estimate tokens in unconsolidated messages."""
        return estimate_messages_tokens(self.unconsolidated_messages)

    def add_message(self, role: str, content: str, **extra: Any) -> None:
        """Add a message to the session."""
        msg: dict[str, Any] = {
            "role": role,
            "content": content,
            "timestamp": time.time(),
        }
        msg.update(extra)
        self.messages.append(msg)
        self.updated_at = time.time()

    def get_context_messages(self, max_messages: int = 0) -> list[dict[str, Any]]:
        """
        Get messages for context, starting from last_consolidated.
        If max_messages > 0, returns at most that many recent messages.
        """
        msgs = self.messages[self.last_consolidated:]
        if max_messages > 0 and len(msgs) > max_messages:
            msgs = msgs[-max_messages:]
        return msgs

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "message_count": len(self.messages),
            "last_consolidated": self.last_consolidated,
            "total_tokens_est": self.total_tokens,
            "unconsolidated_tokens_est": self.unconsolidated_tokens,
            "has_long_term_memory": bool(self.long_term_memory),
            "history_entry_count": len(self.history_entries),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


# ────────────────────────────────────────────────────────────────────
# Consolidation Result
# ────────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class ConsolidationResult:
    """Result of a consolidation attempt."""
    success: bool
    messages_archived: int = 0
    tokens_freed: int = 0
    method: str = "none"  # "cloud_summary" | "raw_archive" | "none"
    error: str | None = None


# ────────────────────────────────────────────────────────────────────
# Memory Consolidator
# ────────────────────────────────────────────────────────────────────

class MemoryConsolidator:
    """
    Token-budget-aware memory consolidator for edge runtime sessions.

    When a session's token count exceeds the budget, it:
    1. Finds a safe user-turn boundary in the message history
    2. Extracts the chunk of old messages
    3. Sends them to cloud for summarization (via callback)
    4. On success: updates long_term_memory + history, advances pointer
    5. On failure (after N retries): raw-archives messages as fallback

    Usage:
        consolidator = MemoryConsolidator(
            context_window_tokens=65536,
            max_completion_tokens=4096,
            cloud_summarize_fn=my_cloud_callback,
        )

        # Before each LLM call:
        result = await consolidator.maybe_consolidate(session)
    """

    # Safety margin for tokenizer estimation drift
    _SAFETY_BUFFER = 1024

    # Max consolidation rounds per check
    _MAX_ROUNDS = 5

    # After this many consecutive failures, fall back to raw archive
    _MAX_FAILURES_BEFORE_RAW = 3

    def __init__(
        self,
        context_window_tokens: int = 65536,
        max_completion_tokens: int = 4096,
        cloud_summarize_fn: Optional[Callable[[list[dict[str, Any]], str], Awaitable[dict[str, str]]]] = None,
    ) -> None:
        """
        Args:
            context_window_tokens: Total context window size
            max_completion_tokens: Reserved for completion
            cloud_summarize_fn: async (messages, current_memory) -> {"summary": "...", "memory_update": "..."}
                                If None, only raw archive is available.
        """
        self.context_window_tokens = context_window_tokens
        self.max_completion_tokens = max_completion_tokens
        self.cloud_summarize_fn = cloud_summarize_fn
        self._consecutive_failures: dict[str, int] = {}

    @property
    def budget(self) -> int:
        """Available tokens for prompt (context - completion - safety)."""
        return self.context_window_tokens - self.max_completion_tokens - self._SAFETY_BUFFER

    @property
    def target(self) -> int:
        """Target token count after consolidation (half of budget)."""
        return self.budget // 2

    async def maybe_consolidate(self, session: SessionMemory) -> ConsolidationResult:
        """
        Check if session needs consolidation and perform it if so.

        Returns ConsolidationResult describing what happened.
        """
        if not session.messages or self.context_window_tokens <= 0:
            return ConsolidationResult(success=True, method="none")

        estimated = session.unconsolidated_tokens
        if estimated < self.budget:
            logger.debug(
                "Session %s: %d/%d tokens, no consolidation needed",
                session.session_id, estimated, self.budget,
            )
            return ConsolidationResult(success=True, method="none")

        logger.info(
            "Session %s: %d/%d tokens, starting consolidation",
            session.session_id, estimated, self.budget,
        )

        total_archived = 0
        total_freed = 0
        method = "none"

        for round_num in range(self._MAX_ROUNDS):
            estimated = session.unconsolidated_tokens
            if estimated <= self.target:
                break

            boundary = self._find_boundary(session, max(1, estimated - self.target))
            if boundary is None:
                logger.debug(
                    "Session %s: no safe boundary found (round %d)",
                    session.session_id, round_num,
                )
                break

            end_idx, tokens_to_free = boundary
            chunk = session.messages[session.last_consolidated:end_idx]
            if not chunk:
                break

            logger.info(
                "Session %s round %d: archiving %d messages (%d tokens)",
                session.session_id, round_num, len(chunk), tokens_to_free,
            )

            result = await self._archive_chunk(session, chunk, end_idx)
            if result.success:
                total_archived += result.messages_archived
                total_freed += result.tokens_freed
                method = result.method
                self._consecutive_failures[session.session_id] = 0
            else:
                failures = self._consecutive_failures.get(session.session_id, 0) + 1
                self._consecutive_failures[session.session_id] = failures

                if failures >= self._MAX_FAILURES_BEFORE_RAW:
                    # Fall back to raw archive
                    self._raw_archive(session, chunk, end_idx)
                    total_archived += len(chunk)
                    total_freed += estimate_messages_tokens(chunk)
                    method = "raw_archive"
                    self._consecutive_failures[session.session_id] = 0
                else:
                    return ConsolidationResult(
                        success=False,
                        messages_archived=total_archived,
                        tokens_freed=total_freed,
                        method=method,
                        error=result.error,
                    )

        return ConsolidationResult(
            success=True,
            messages_archived=total_archived,
            tokens_freed=total_freed,
            method=method,
        )

    def _find_boundary(
        self, session: SessionMemory, tokens_to_remove: int
    ) -> Optional[tuple[int, int]]:
        """
        Find a user-turn boundary that removes enough tokens.

        Only cuts at user message boundaries to preserve conversation coherence.
        Returns (end_index, tokens_at_boundary) or None.
        """
        start = session.last_consolidated
        if start >= len(session.messages) or tokens_to_remove <= 0:
            return None

        removed_tokens = 0
        last_boundary: Optional[tuple[int, int]] = None

        for idx in range(start, len(session.messages)):
            msg = session.messages[idx]
            if idx > start and msg.get("role") == "user":
                last_boundary = (idx, removed_tokens)
                if removed_tokens >= tokens_to_remove:
                    return last_boundary
            removed_tokens += estimate_message_tokens(msg)

        return last_boundary

    async def _archive_chunk(
        self,
        session: SessionMemory,
        chunk: list[dict[str, Any]],
        end_idx: int,
    ) -> ConsolidationResult:
        """
        Archive a chunk of messages using cloud summarization.
        Falls back to raw archive if no cloud function available.
        """
        if not self.cloud_summarize_fn:
            self._raw_archive(session, chunk, end_idx)
            return ConsolidationResult(
                success=True,
                messages_archived=len(chunk),
                tokens_freed=estimate_messages_tokens(chunk),
                method="raw_archive",
            )

        try:
            result = await self.cloud_summarize_fn(chunk, session.long_term_memory)

            summary = result.get("summary", "")
            memory_update = result.get("memory_update", session.long_term_memory)

            if not summary:
                return ConsolidationResult(
                    success=False,
                    error="Cloud summarization returned empty summary",
                )

            # Update session
            session.history_entries.append(summary)
            if memory_update and memory_update != session.long_term_memory:
                session.long_term_memory = memory_update
            session.last_consolidated = end_idx
            session.updated_at = time.time()

            return ConsolidationResult(
                success=True,
                messages_archived=len(chunk),
                tokens_freed=estimate_messages_tokens(chunk),
                method="cloud_summary",
            )

        except Exception as e:
            logger.warning(
                "Cloud summarization failed for session %s: %s",
                session.session_id, e,
            )
            return ConsolidationResult(
                success=False,
                error=f"{type(e).__name__}: {e}",
            )

    def _raw_archive(
        self,
        session: SessionMemory,
        chunk: list[dict[str, Any]],
        end_idx: int,
    ) -> None:
        """
        Fallback: dump raw messages to history without LLM summarization.
        """
        lines = []
        for msg in chunk:
            role = msg.get("role", "?").upper()
            content = str(msg.get("content", ""))[:200]
            ts = msg.get("timestamp", "?")
            if isinstance(ts, float):
                ts = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))
            lines.append(f"[{ts}] {role}: {content}")

        entry = f"[RAW ARCHIVE] {len(chunk)} messages:\n" + "\n".join(lines)
        session.history_entries.append(entry)
        session.last_consolidated = end_idx
        session.updated_at = time.time()

        logger.warning(
            "Session %s: raw-archived %d messages (degraded mode)",
            session.session_id, len(chunk),
        )

    def describe(self) -> dict[str, Any]:
        """Return consolidator configuration for diagnostics."""
        return {
            "context_window_tokens": self.context_window_tokens,
            "max_completion_tokens": self.max_completion_tokens,
            "budget": self.budget,
            "target": self.target,
            "has_cloud_summarize": self.cloud_summarize_fn is not None,
            "safety_buffer": self._SAFETY_BUFFER,
            "max_rounds": self._MAX_ROUNDS,
            "max_failures_before_raw": self._MAX_FAILURES_BEFORE_RAW,
        }
