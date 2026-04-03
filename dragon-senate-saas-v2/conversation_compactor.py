"""
ConversationCompactor — 对话压缩系统
======================================
灵感来源：cccback-master services/compact/compact.ts（1500行工业实现）

解决问题：
  龙虾长时间运行时 Token 无限膨胀，导致 API 报错或截断。
  现有 FRESH_CONTEXT 只是粗暴截断，此模块实现：
  1. 自动检测 Token 超阈值
  2. 去图片 → LLM 生成摘要 → 5类 attachment 重注入
  3. PTL（Prompt Too Long）重试机制
  4. 压缩后预判是否会立即再次触发（防无限循环）

集成点：
  lobster_runner.py → _check_and_compact() 在每次 LLM 调用前调用
  app.py            → /api/session/{id}/compaction-stats 和 /compact 端点
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

logger = logging.getLogger("conversation_compactor")


# ────────────────────────────────────────────────────────────────────
# 配置
# ────────────────────────────────────────────────────────────────────

@dataclass
class CompactionConfig:
    """压缩配置（所有阈值均可通过环境变量覆盖）"""

    max_context_tokens: int = int(os.getenv("COMPACT_MAX_TOKENS", "150000"))
    safety_buffer: int = int(os.getenv("COMPACT_SAFETY_BUFFER", "20000"))
    post_compact_max_files: int = int(os.getenv("COMPACT_MAX_FILES", "5"))
    post_compact_token_budget: int = int(os.getenv("COMPACT_ATTACH_BUDGET", "50000"))
    max_tokens_per_skill: int = int(os.getenv("COMPACT_MAX_SKILL_TOKENS", "5000"))
    ptl_retry_max: int = int(os.getenv("COMPACT_PTL_RETRIES", "3"))

    @property
    def trigger_threshold(self) -> int:
        return self.max_context_tokens - self.safety_buffer


# ────────────────────────────────────────────────────────────────────
# 数据结构
# ────────────────────────────────────────────────────────────────────

@dataclass
class CompactionResult:
    """完整的压缩结果"""
    boundary_marker: dict[str, Any]
    summary_messages: list[dict[str, Any]]
    attachments: list[dict[str, Any]]
    pre_compact_token_count: int
    post_compact_token_count: int
    will_retrigger: bool
    compacted_at: float = field(default_factory=time.time)

    def as_new_history(self) -> list[dict[str, Any]]:
        """返回可直接替换 session messages 的压缩后消息列表"""
        return (
            [self.boundary_marker]
            + self.summary_messages
            + self.attachments
        )


# ────────────────────────────────────────────────────────────────────
# Compactor 主体
# ────────────────────────────────────────────────────────────────────

class ConversationCompactor:
    """
    对话压缩器（仿 cccback services/compact/compact.ts）

    工作流：
        1. should_compact()  — 检测是否超过阈值
        2. compact()         — 执行完整压缩
           a. _strip_images()                    去除图片节省 token
           b. _generate_summary_with_retry()     LLM 生成摘要（含 PTL 重试）
           c. _build_post_compact_attachments()  5类 attachment 重注入
        3. apply_compaction()                    将结果应用为新历史
    """

    # 生成摘要的 System Prompt（仿 cccback getCompactSystemPrompt）
    COMPACT_SYSTEM_PROMPT = """你是一个专业的对话摘要专家，为 ClawCommerce AI 营销系统服务。

将下面的对话历史压缩为一个详细的摘要，必须保留以下信息：

1. **已完成的操作**：列出所有已执行的操作和结果（账号操作、发布、互动等）
2. **当前状态**：系统/任务的当前状态（哪些账号已处理，哪些未处理）
3. **关键发现**：重要数据、洞察或决策（效果数据、问题、风险）
4. **未完成的工作**：仍需执行的事项（明确列出）
5. **账号状态**：各个账号/平台的操作历史和当前状态

输出格式：结构化 Markdown，便于后续龙虾无缝继续任务。
不要截断任何重要信息。摘要要足够详细，让新会话可以立即接续工作。
不要输出任何 JSON 或其他格式，只输出 Markdown。"""

    def __init__(
        self,
        llm_router: Any,
        config: CompactionConfig | None = None,
    ) -> None:
        """
        Args:
            llm_router: LLMRouter 实例（来自 llm_router.py）
            config:     压缩配置，None 则使用默认值
        """
        self.llm_router = llm_router
        self.config = config or CompactionConfig()

    # ── 公共接口 ──────────────────────────────────────────────────────

    def should_compact(
        self,
        messages: list[dict[str, Any]],
        estimated_tokens: int | None = None,
    ) -> bool:
        """
        检测是否需要压缩（仿 autoCompact.ts shouldAutoCompact）

        Args:
            messages:         当前消息历史
            estimated_tokens: 外部预估的 token 数（None 则内部计算）
        """
        token_count = estimated_tokens if estimated_tokens is not None else self._estimate_tokens(messages)
        return token_count >= self.config.trigger_threshold

    async def compact(
        self,
        messages: list[dict[str, Any]],
        context: dict[str, Any] | None = None,
    ) -> CompactionResult:
        """
        执行完整的对话压缩流程。

        Args:
            messages: 当前消息历史（含 system / user / assistant / tool）
            context:  上下文信息，包含：
                      - recent_files:      list[str]  最近读取的文件路径
                      - current_workflow:  str | None  当前 YAML 工作流计划
                      - used_skills:       list[dict]  本次用过的 SOP 技能
                      - background_lobsters: list[dict] 后台运行的龙虾任务
                      - account_snapshot:  str | None  账号状态快照
        Returns:
            CompactionResult（可调用 .as_new_history() 直接替换消息历史）
        """
        context = context or {}
        pre_token_count = self._estimate_tokens(messages)

        # Step 1: 去除图片（节省大量 token）
        clean_messages = self._strip_images(messages)

        # Step 2: 生成摘要（带 PTL 重试）
        summary_msg = await self._generate_summary_with_retry(clean_messages)

        # Step 3: 构造5类 attachment
        attachments = await self._build_post_compact_attachments(context)

        # Step 4: 压缩边界标记
        boundary = self._create_boundary_marker(pre_token_count)

        # Step 5: 估算压缩后 token 数
        post_messages = [boundary, summary_msg] + attachments
        post_token_count = self._estimate_tokens(post_messages)

        # Step 6: 预判是否会立即再次触发
        will_retrigger = post_token_count >= self.config.trigger_threshold

        result = CompactionResult(
            boundary_marker=boundary,
            summary_messages=[summary_msg],
            attachments=attachments,
            pre_compact_token_count=pre_token_count,
            post_compact_token_count=post_token_count,
            will_retrigger=will_retrigger,
        )

        if will_retrigger:
            logger.warning(
                "[Compactor] ⚠️ 压缩后仍超过阈值！"
                "压缩后 token=%d，阈值=%d。建议减少 attachment 数量或降低 max_files。",
                post_token_count,
                self.config.trigger_threshold,
            )

        logger.info(
            "[Compactor] 压缩完成：pre=%d → post=%d token（节省 %.1f%%），attachment=%d 块",
            pre_token_count,
            post_token_count,
            (1 - post_token_count / max(pre_token_count, 1)) * 100,
            len(attachments),
        )

        return result

    def apply_compaction(self, result: CompactionResult) -> list[dict[str, Any]]:
        """将压缩结果应用为新的消息历史，返回压缩后的消息列表。"""
        return result.as_new_history()

    # ── 内部方法 ──────────────────────────────────────────────────────

    def _strip_images(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        去除消息中的图片内容（仿 stripImagesFromMessages）。
        图片占用大量 token，压缩前先移除可显著减少摘要请求的大小。
        """
        cleaned: list[dict[str, Any]] = []
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list):
                # 过滤 image_url / image 类型的内容块
                filtered = [
                    part for part in content
                    if isinstance(part, dict) and part.get("type") not in ("image_url", "image")
                ]
                cleaned.append({**msg, "content": filtered})
            else:
                cleaned.append(msg)
        return cleaned

    async def _generate_summary_with_retry(
        self,
        messages: list[dict[str, Any]],
        retry_count: int = 0,
    ) -> dict[str, Any]:
        """
        调用 LLM 生成摘要，失败时截断头部重试（仿 truncateHeadForPTLRetry）。
        PTL = Prompt Too Long
        """
        if retry_count >= self.config.ptl_retry_max:
            logger.error("[Compactor] PTL 重试超过最大次数 %d，返回空摘要", self.config.ptl_retry_max)
            return {
                "role": "user",
                "content": "[对话摘要]\n\n（摘要生成失败，请继续任务）",
                "metadata": {"is_compaction_summary": True, "failed": True},
            }

        try:
            from llm_router import RouteMeta

            # 将消息历史转换为纯文本
            history_text = self._messages_to_text(messages)

            summary_text = await self.llm_router.routed_ainvoke_text(
                system_prompt=self.COMPACT_SYSTEM_PROMPT,
                user_prompt=f"请压缩以下对话历史：\n\n{history_text}",
                meta=RouteMeta(
                    critical=False,
                    est_tokens=self._estimate_tokens(messages) + 4000,
                    tenant_tier="basic",
                    user_id="compactor",
                    tenant_id="system",
                    task_type="conversation_compact",
                ),
                temperature=0.1,
            )

            return {
                "role": "user",
                "content": f"[对话摘要 — 压缩于 {time.strftime('%Y-%m-%d %H:%M')}]\n\n{summary_text}",
                "metadata": {"is_compaction_summary": True},
            }

        except Exception as e:
            err_str = str(e).lower()
            is_ptl = any(kw in err_str for kw in (
                "too long", "context length", "context window", "token", "maximum context"
            ))

            if is_ptl:
                logger.warning(
                    "[Compactor] PTL 错误（第 %d 次重试）：%s，截断头部重试",
                    retry_count + 1, str(e)[:200],
                )
                truncated = self._truncate_head_for_ptl(messages, retry_count + 1)
                return await self._generate_summary_with_retry(truncated, retry_count + 1)

            logger.error("[Compactor] 摘要生成失败（非 PTL）：%s", str(e))
            raise

    def _truncate_head_for_ptl(
        self,
        messages: list[dict[str, Any]],
        retry_num: int,
    ) -> list[dict[str, Any]]:
        """
        PTL 重试时从头部截断（仿 truncateHeadForPTLRetry）。
        每次重试删除更多头部，最多删除 75%。
        """
        cut_ratio = min(retry_num * 0.25, 0.75)
        cut_index = int(len(messages) * cut_ratio)

        # 确保从完整的 user 轮次边界截断（不在 assistant/tool 中间切断）
        while cut_index < len(messages) and messages[cut_index].get("role") != "user":
            cut_index += 1

        logger.info(
            "[Compactor] PTL 截断：删除前 %d 条消息（共 %d 条，%.0f%%）",
            cut_index, len(messages), cut_ratio * 100,
        )
        return messages[cut_index:]

    async def _build_post_compact_attachments(
        self,
        context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        构造压缩后5类 attachment 重注入（仿 cccback 5 种恢复函数）：
          1. 最近读取的文件（最多 post_compact_max_files 个）
          2. 当前工作流计划（YAML）
          3. 已使用的 SOP 技能（最近3个）
          4. 后台龙虾任务状态
          5. 账号状态快照
        """
        attachments: list[dict[str, Any]] = []

        # ── 1. 最近读取的文件 ────────────────────────────────────────
        recent_files: list[str] = context.get("recent_files", [])
        for file_path in recent_files[:self.config.post_compact_max_files]:
            try:
                content = open(file_path, encoding="utf-8", errors="replace").read()
                # 截断过大的文件
                max_chars = self.config.max_tokens_per_skill * 4
                if len(content) > max_chars:
                    content = content[:max_chars] + "\n\n...[文件内容已截断]"
                attachments.append({
                    "role": "user",
                    "content": f"[文件恢复: {file_path}]\n```\n{content}\n```",
                    "metadata": {"attachment_type": "file", "path": file_path},
                })
            except Exception as e:
                logger.debug("[Compactor] 恢复文件失败 %s: %s", file_path, e)

        # ── 2. 当前工作流计划 ────────────────────────────────────────
        if workflow_plan := context.get("current_workflow"):
            attachments.append({
                "role": "user",
                "content": f"[当前工作流计划]\n```yaml\n{workflow_plan}\n```",
                "metadata": {"attachment_type": "workflow_plan"},
            })

        # ── 3. 已使用的 SOP 技能 ─────────────────────────────────────
        used_skills: list[dict[str, Any]] = context.get("used_skills", [])
        if used_skills:
            skill_parts: list[str] = []
            for skill in used_skills[-3:]:  # 最近3个
                name = skill.get("name", "unknown")
                steps = str(skill.get("steps", ""))
                # 截断过长技能
                max_skill_chars = self.config.max_tokens_per_skill * 4
                if len(steps) > max_skill_chars:
                    steps = steps[:max_skill_chars] + "\n...[已截断]"
                skill_parts.append(f"### {name}\n{steps}")
            attachments.append({
                "role": "user",
                "content": f"[本次使用的 SOP 技能]\n\n" + "\n\n".join(skill_parts),
                "metadata": {"attachment_type": "skills"},
            })

        # ── 4. 后台龙虾任务状态 ──────────────────────────────────────
        background_lobsters: list[dict[str, Any]] = context.get("background_lobsters", [])
        if background_lobsters:
            lines = [
                f"- {t.get('lobster_id', '?')} ({t.get('run_id', '?')}): "
                f"{t.get('status', '?')} — {t.get('description', '')}"
                for t in background_lobsters
            ]
            attachments.append({
                "role": "user",
                "content": "[后台运行中的龙虾任务]\n" + "\n".join(lines),
                "metadata": {"attachment_type": "background_tasks"},
            })

        # ── 5. 账号状态快照 ──────────────────────────────────────────
        if account_snapshot := context.get("account_snapshot"):
            attachments.append({
                "role": "user",
                "content": f"[账号状态快照]\n{account_snapshot}",
                "metadata": {"attachment_type": "account_snapshot"},
            })

        return attachments

    def _create_boundary_marker(self, pre_token_count: int) -> dict[str, Any]:
        """创建压缩边界标记（用于日志/调试/龙虾感知）"""
        return {
            "role": "user",
            "content": (
                f"[系统：对话已自动压缩]\n"
                f"压缩时间：{time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                f"压缩前 Token 估算：{pre_token_count:,}\n"
                f"以下为压缩后恢复的上下文，请继续执行任务，勿重复已完成的操作。"
            ),
            "metadata": {"is_compaction_boundary": True, "pre_tokens": pre_token_count},
        }

    def _estimate_tokens(self, messages: list[dict[str, Any]]) -> int:
        """
        粗略估算 token 数（4字符 ≈ 1 token）。
        生产环境如需精确，可替换为 tiktoken。
        """
        total_chars = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                # 多模态内容块
                for part in content:
                    if isinstance(part, dict):
                        total_chars += len(str(part.get("text", "")))
            else:
                total_chars += len(str(content))
        return total_chars // 4

    def _messages_to_text(self, messages: list[dict[str, Any]]) -> str:
        """将消息历史转换为 LLM 友好的纯文本格式"""
        parts: list[str] = []
        for msg in messages:
            role = msg.get("role", "unknown").upper()
            name = msg.get("name", "")
            header = f"[{role}]" + (f" ({name})" if name else "")
            content = msg.get("content", "")
            if isinstance(content, list):
                # 只保留文字部分
                content = " ".join(
                    str(part.get("text", "")) for part in content
                    if isinstance(part, dict) and "text" in part
                )
            parts.append(f"{header}\n{content}")
        return "\n\n---\n\n".join(parts)

    def get_stats(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        """返回当前会话的 Token 统计信息（供 API 端点使用）"""
        estimated = self._estimate_tokens(messages)
        threshold = self.config.trigger_threshold
        return {
            "estimated_tokens": estimated,
            "trigger_threshold": threshold,
            "max_context_tokens": self.config.max_context_tokens,
            "usage_percent": round(estimated / max(threshold, 1) * 100, 1),
            "should_compact": estimated >= threshold,
            "tokens_until_compact": max(0, threshold - estimated),
        }
