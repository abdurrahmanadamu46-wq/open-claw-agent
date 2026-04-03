# CODEX_TASK: 对话压缩系统（Conversation Compaction）

> **灵感来源**：cccback-master `services/compact/compact.ts`（1500行工业实现）  
> **优先级**：🔴 P0  
> **预估工作量**：3天  
> **负责模块**：dragon-senate-saas-v2/conversation_compactor.py（新建）

---

## 目标

实现完整的对话压缩系统，解决长任务 Token 无限膨胀问题：
1. 自动检测压缩触发条件（Token > 阈值）
2. 调用 LLM 生成摘要（forked agent）
3. 清空历史消息，重注入5类关键 attachment
4. 压缩后预判是否会立即再次触发（避免无限循环）

---

## 背景：为什么需要这个

当前缺口：
- 龙虾长时间运行时 Token 无限膨胀，导致 API 报错或截断
- `CODEX_TASK_FRESH_CONTEXT` 只做了历史截断（删除旧消息），没有摘要
- 没有压缩后的 attachment 恢复机制（关键文件/计划/技能会丢失）

cccback 的解法成熟度：1500行工业实现，我们可直接移植核心逻辑。

---

## 核心实现

### 1. CompactionResult 数据结构

```python
# dragon-senate-saas-v2/conversation_compactor.py

from dataclasses import dataclass, field
from typing import Optional
import time

@dataclass
class CompactionResult:
    """压缩结果"""
    boundary_marker: dict          # 压缩边界标记消息
    summary_messages: list[dict]   # LLM 生成的摘要消息
    attachments: list[dict]        # 5类 attachment 重注入
    pre_compact_token_count: int   # 压缩前 Token 数
    post_compact_token_count: int  # 压缩后 Token 数（估算）
    will_retrigger: bool           # 压缩后是否会立即再次触发
    compacted_at: float = field(default_factory=time.time)

@dataclass
class CompactionConfig:
    """压缩配置"""
    max_context_tokens: int = 150_000   # 最大上下文 Token 数
    safety_buffer: int = 20_000         # 安全缓冲（预留给摘要本身）
    post_compact_max_files: int = 5     # 压缩后最多恢复的文件数
    post_compact_token_budget: int = 50_000  # 压缩后 attachment 预算
    max_tokens_per_skill: int = 5_000   # 单个技能最大 Token
    ptl_retry_max: int = 3              # PTL 重试最大次数
    
    @property
    def trigger_threshold(self) -> int:
        return self.max_context_tokens - self.safety_buffer
```

### 2. ConversationCompactor 主类

```python
class ConversationCompactor:
    """
    对话压缩器（仿 cccback services/compact/compact.ts）
    
    工作流：
    1. shouldCompact() → 检测是否需要压缩
    2. compact() → 执行压缩
       a. 去除图片（节省 Token）
       b. 调用 LLM 生成摘要
       c. 重注入5类 attachment
    3. 压缩后预判下次是否会立即再次触发
    """
    
    COMPACT_SYSTEM_PROMPT = """
你是一个专业的对话摘要专家。
你的任务是将下面的对话历史压缩为一个详细的摘要，保留所有重要信息：

1. **已完成的操作**：列出所有已经执行的操作和结果
2. **当前状态**：描述系统/任务的当前状态
3. **关键发现**：任何重要的数据、洞察或决策
4. **未完成的工作**：还需要做什么（如果有）
5. **账号状态**：各账号的操作历史和当前状态

输出格式：结构化的 Markdown，便于后续继续任务。
不要截断任何重要信息。摘要应该足够详细，让新的对话可以无缝继续。
"""
    
    def __init__(self, llm, config: CompactionConfig | None = None):
        self.llm = llm
        self.config = config or CompactionConfig()
    
    def should_compact(self, messages: list[dict], estimated_tokens: int) -> bool:
        """
        检测是否需要压缩
        仿 cccback autoCompact.ts shouldAutoCompact()
        """
        return estimated_tokens >= self.config.trigger_threshold
    
    async def compact(
        self,
        messages: list[dict],
        context: dict,
    ) -> CompactionResult:
        """
        执行完整的对话压缩流程
        
        Args:
            messages: 当前消息历史
            context: 上下文信息（当前文件、计划、技能等）
        """
        pre_token_count = self._estimate_tokens(messages)
        
        # Step 1: 去除图片（节省大量 Token）
        clean_messages = self._strip_images(messages)
        
        # Step 2: 调用 LLM 生成摘要（带 PTL 重试）
        summary = await self._generate_summary_with_retry(clean_messages)
        
        # Step 3: 构造5类 attachment
        attachments = await self._build_post_compact_attachments(context)
        
        # Step 4: 构造压缩边界标记
        boundary = self._create_boundary_marker(pre_token_count)
        
        # Step 5: 估算压缩后 Token 数
        post_messages = [boundary, summary] + attachments
        post_token_count = self._estimate_tokens(post_messages)
        
        # Step 6: 预判是否会立即再次触发
        will_retrigger = post_token_count >= self.config.trigger_threshold
        
        return CompactionResult(
            boundary_marker=boundary,
            summary_messages=[summary],
            attachments=attachments,
            pre_compact_token_count=pre_token_count,
            post_compact_token_count=post_token_count,
            will_retrigger=will_retrigger,
        )
    
    def _strip_images(self, messages: list[dict]) -> list[dict]:
        """
        去除消息中的图片内容（仿 stripImagesFromMessages）
        图片通常占大量 Token，压缩时先移除
        """
        cleaned = []
        for msg in messages:
            if isinstance(msg.get("content"), list):
                # 过滤掉 image_url 类型的内容块
                content_parts = [
                    part for part in msg["content"]
                    if part.get("type") != "image_url"
                ]
                cleaned.append({**msg, "content": content_parts})
            else:
                cleaned.append(msg)
        return cleaned
    
    async def _generate_summary_with_retry(
        self,
        messages: list[dict],
        retry_count: int = 0,
    ) -> dict:
        """
        生成摘要，失败时截断头部重试（仿 truncateHeadForPTLRetry）
        PTL = Prompt Too Long
        """
        if retry_count >= self.config.ptl_retry_max:
            raise RuntimeError(f"摘要生成失败：超过最大重试次数 {self.config.ptl_retry_max}")
        
        try:
            summary_text = await self.llm.ainvoke(
                system=self.COMPACT_SYSTEM_PROMPT,
                messages=messages,
            )
            return {
                "role": "user",
                "content": f"[对话摘要]\n\n{summary_text}",
                "metadata": {"is_compaction_summary": True},
            }
        
        except Exception as e:
            error_msg = str(e).lower()
            if "too long" in error_msg or "context" in error_msg or "token" in error_msg:
                # PTL 错误：截断最旧的 API 轮次后重试
                truncated = self._truncate_head_for_ptl(messages, retry_count + 1)
                return await self._generate_summary_with_retry(truncated, retry_count + 1)
            raise
    
    def _truncate_head_for_ptl(
        self,
        messages: list[dict],
        retry_num: int,
    ) -> list[dict]:
        """
        PTL 重试时截断最旧的消息（仿 truncateHeadForPTLRetry）
        每次重试删除更多头部消息
        """
        # 每次重试删除 25% 的历史
        cut_ratio = retry_num * 0.25
        cut_index = int(len(messages) * cut_ratio)
        
        # 确保从完整的 user/assistant 轮次边界截断
        while cut_index < len(messages) and messages[cut_index]["role"] != "user":
            cut_index += 1
        
        return messages[cut_index:]
    
    async def _build_post_compact_attachments(self, context: dict) -> list[dict]:
        """
        构造压缩后的5类 attachment 重注入
        仿 cccback createPostCompactFileAttachments 等
        """
        attachments = []
        
        # 1. 最近读取的文件（最多5个）
        recent_files = context.get("recent_files", [])
        for file_path in recent_files[:self.config.post_compact_max_files]:
            try:
                content = open(file_path).read()
                attachments.append({
                    "role": "user",
                    "content": f"[文件恢复: {file_path}]\n```\n{content}\n```",
                    "metadata": {"attachment_type": "file", "path": file_path},
                })
            except Exception:
                pass
        
        # 2. 当前计划/工作流（YAML Workflow）
        if workflow_plan := context.get("current_workflow"):
            attachments.append({
                "role": "user",
                "content": f"[当前工作流计划]\n```yaml\n{workflow_plan}\n```",
                "metadata": {"attachment_type": "workflow_plan"},
            })
        
        # 3. 已使用的技能/SOP
        if skill_history := context.get("used_skills", []):
            skills_text = "\n\n".join([
                f"### {s['name']}\n{s['steps'][:self.config.max_tokens_per_skill]}"
                for s in skill_history[-3:]  # 最近3个技能
            ])
            attachments.append({
                "role": "user",
                "content": f"[本次使用的 SOP 技能]\n{skills_text}",
                "metadata": {"attachment_type": "skills"},
            })
        
        # 4. 后台龙虾任务状态
        if background_tasks := context.get("background_lobsters", []):
            tasks_text = "\n".join([
                f"- {t['lobster_id']} ({t['run_id']}): {t['status']} - {t['description']}"
                for t in background_tasks
            ])
            attachments.append({
                "role": "user",
                "content": f"[后台运行中的龙虾任务]\n{tasks_text}",
                "metadata": {"attachment_type": "background_tasks"},
            })
        
        # 5. 账号状态快照
        if account_snapshot := context.get("account_snapshot"):
            attachments.append({
                "role": "user",
                "content": f"[账号状态快照]\n{account_snapshot}",
                "metadata": {"attachment_type": "account_snapshot"},
            })
        
        return attachments
    
    def _create_boundary_marker(self, pre_token_count: int) -> dict:
        """创建压缩边界标记（用于日志/调试）"""
        return {
            "role": "user",
            "content": (
                f"[系统：对话已压缩]\n"
                f"压缩时间：{time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                f"压缩前 Token 数：{pre_token_count:,}\n"
                f"以下为压缩后恢复的上下文，请继续任务。"
            ),
            "metadata": {"is_compaction_boundary": True},
        }
    
    def _estimate_tokens(self, messages: list[dict]) -> int:
        """
        粗略估算 Token 数（4字符≈1 Token）
        生产环境建议接入 tiktoken
        """
        total_chars = sum(
            len(str(msg.get("content", "")))
            for msg in messages
        )
        return total_chars // 4
    
    def apply_compaction(
        self,
        result: CompactionResult,
    ) -> list[dict]:
        """
        将压缩结果应用为新的消息历史
        返回压缩后的完整消息列表
        """
        new_messages = (
            [result.boundary_marker]
            + result.summary_messages
            + result.attachments
        )
        
        if result.will_retrigger:
            # 警告：压缩后立即再次超过阈值
            import logging
            logging.warning(
                f"[Compactor] ⚠️ 压缩后仍超过阈值！"
                f"压缩后 Token：{result.post_compact_token_count:,}，"
                f"阈值：{self.config.trigger_threshold:,}。"
                f"建议减少 attachment 数量。"
            )
        
        return new_messages
```

### 3. 集成到 LobsterRunner

```python
# dragon-senate-saas-v2/lobster_runner.py

class LobsterRunner:
    def __init__(self, ...):
        ...
        self.compactor = ConversationCompactor(llm=self.llm)
        self._compaction_context: dict = {}
    
    async def _check_and_compact(self, messages: list[dict]) -> list[dict]:
        """
        在每次 LLM 调用前检查是否需要压缩
        集成到 _execute_lobster 的主循环中
        """
        estimated = self.compactor._estimate_tokens(messages)
        
        if not self.compactor.should_compact(messages, estimated):
            return messages  # 不需要压缩
        
        # 构建当前压缩上下文
        context = {
            "recent_files": self._compaction_context.get("recent_files", []),
            "current_workflow": self._compaction_context.get("current_workflow"),
            "used_skills": self._compaction_context.get("used_skills", []),
            "background_lobsters": [
                {
                    "run_id": t.run_id,
                    "lobster_id": t.lobster_id,
                    "description": t.description,
                    "status": "running",
                }
                for t in self.registry.list_foreground()
            ],
            "account_snapshot": self._compaction_context.get("account_snapshot"),
        }
        
        # 执行压缩
        result = await self.compactor.compact(messages, context)
        
        # 应用压缩
        new_messages = self.compactor.apply_compaction(result)
        
        # 记录压缩事件到 audit_log
        await self.audit_logger.log({
            "event": "conversation_compacted",
            "pre_tokens": result.pre_compact_token_count,
            "post_tokens": result.post_compact_token_count,
            "will_retrigger": result.will_retrigger,
        })
        
        return new_messages
    
    def update_compaction_context(self, key: str, value):
        """
        更新压缩上下文（龙虾工具调用时自动更新）
        例如：读取文件时记录文件路径
        """
        self._compaction_context[key] = value
    
    def track_file_read(self, file_path: str):
        """记录最近读取的文件（压缩时恢复）"""
        recent = self._compaction_context.get("recent_files", [])
        if file_path not in recent:
            recent.insert(0, file_path)
        # 只保留最近 N 个
        self._compaction_context["recent_files"] = recent[:self.compactor.config.post_compact_max_files]
```

### 4. 压缩状态 API

```python
# dragon-senate-saas-v2/app.py

@app.get("/api/session/{session_id}/compaction-stats")
async def get_compaction_stats(session_id: str):
    """查看当前会话的 Token 使用和压缩历史"""
    runner = get_runner(session_id)
    messages = runner.get_messages()
    estimated = runner.compactor._estimate_tokens(messages)
    threshold = runner.compactor.config.trigger_threshold
    
    return {
        "estimated_tokens": estimated,
        "trigger_threshold": threshold,
        "usage_percent": round(estimated / threshold * 100, 1),
        "should_compact": runner.compactor.should_compact(messages, estimated),
        "compaction_count": runner._compaction_context.get("compaction_count", 0),
    }

@app.post("/api/session/{session_id}/compact")
async def force_compact(session_id: str):
    """手动触发压缩（调试用）"""
    runner = get_runner(session_id)
    messages = runner.get_messages()
    context = runner._compaction_context
    result = await runner.compactor.compact(messages, context)
    new_messages = runner.compactor.apply_compaction(result)
    runner.set_messages(new_messages)
    return {
        "status": "compacted",
        "pre_tokens": result.pre_compact_token_count,
        "post_tokens": result.post_compact_token_count,
        "will_retrigger": result.will_retrigger,
    }
```

---

## 验收标准

- [ ] `should_compact()` 在 Token 超过阈值时返回 True
- [ ] `compact()` 调用 LLM 生成结构化摘要
- [ ] 摘要包含：已完成操作、当前状态、关键发现、未完成工作
- [ ] 5类 attachment 正确重注入：文件/计划/技能/后台任务/账号快照
- [ ] PTL 重试：摘要请求失败时最多重试3次，每次截断更多头部
- [ ] `_strip_images` 去除图片后再生成摘要
- [ ] `will_retrigger` 正确预判并输出警告日志
- [ ] 压缩事件写入 audit_log
- [ ] `/api/session/{id}/compaction-stats` 返回正确 Token 统计
- [ ] 手动 force compact 端点可用

---

## 与现有代码的关系

| 组件 | 关系 |
|------|------|
| `CODEX_TASK_FRESH_CONTEXT` | 互补：Fresh Context = 简单截断（快速），Compact = 智能压缩（准确） |
| `lobster_runner.py` | 在主循环中调用 `_check_and_compact` |
| `audit_logger.py` | 压缩事件写入审计日志 |
| `CODEX_TASK_LOBSTER_BACKGROUND` | 后台龙虾状态作为 attachment #4 恢复 |
| `CODEX_TASK_SOP_SKILL_LOADER` | 使用过的 SOP 技能作为 attachment #3 恢复 |

---

## 依赖

```
pip install tiktoken  # 精确 Token 计数（可选，替换字符估算）
```

---

*创建时间：2026-04-01 | 基于 cccback-master compact.ts 工业实现移植*
