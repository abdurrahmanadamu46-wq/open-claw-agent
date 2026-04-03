"""
Token budget helpers for fresh-context and history trimming.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("token_budget")


def estimate_tokens(text: str) -> int:
    chinese_chars = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
    other_chars = len(text) - chinese_chars
    return max(1, int(chinese_chars * 0.7 + other_chars / 3.5))


def estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    total = 0
    for message in messages:
        content = str(message.get("content") or "")
        total += estimate_tokens(content) + 4
    return total


def truncate_history(
    messages: list[dict[str, Any]],
    *,
    max_messages: int = 50,
    max_tokens: int = 8000,
    preserve_system: bool = True,
) -> tuple[list[dict[str, Any]], bool]:
    if not messages:
        return messages, False

    system_messages = [item for item in messages if item.get("role") == "system"] if preserve_system else []
    non_system = [item for item in messages if item.get("role") != "system"]
    was_truncated = False

    if len(non_system) > max_messages:
        non_system = non_system[-max_messages:]
        was_truncated = True

    result = [*system_messages, *non_system]
    total_tokens = estimate_messages_tokens(result)
    while total_tokens > max_tokens and len(non_system) > 1:
        non_system = non_system[1:]
        result = [*system_messages, *non_system]
        total_tokens = estimate_messages_tokens(result)
        was_truncated = True

    if was_truncated:
        logger.info("[TokenBudget] truncated history -> %d messages, ~%d tokens", len(result), total_tokens)
    return result, was_truncated


def apply_fresh_context(spec: Any, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if getattr(spec, "fresh_context", False):
        system_messages = [item for item in messages if item.get("role") == "system"]
        logger.info("[TokenBudget] fresh_context enabled; dropped %d history messages", max(0, len(messages) - len(system_messages)))
        return system_messages

    result, _ = truncate_history(
        messages,
        max_messages=max(1, int(getattr(spec, "max_history_messages", 50) or 50)),
        max_tokens=max(256, int(getattr(spec, "max_context_tokens", 8000) or 8000)),
    )
    return result
