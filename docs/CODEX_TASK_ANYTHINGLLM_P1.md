# CODEX TASK: AnythingLLM 借鉴 P1 任务包
> 来源分析：`docs/ANYTHINGLLM_BORROWING_ANALYSIS.md`
> 优先级：P1（立即可落地）
> 创建日期：2026-04-02

---

## 任务总览

| # | 任务名 | 目标文件 | 估时 |
|---|--------|---------|------|
| P1-1 | Provider 标准接口规范（4接口强制规范） | `dragon-senate-saas-v2/provider_registry.py` 升级 | 0.5天 |
| P1-2 | 龙虾技能白名单（租户级技能开关） | `dragon-senate-saas-v2/lobster_skill_whitelist.py` | 1天 |
| P1-3 | 龙虾斜线命令系统（/radar /post /follow） | `dragon-senate-saas-v2/slash_command_router.py` | 1天 |
| P1-4 | SystemPrompt 动态变量注入引擎 | `dragon-senate-saas-v2/prompt_variable_engine.py` | 0.5天 |
| P1-5 | Commander 执行实时 WebSocket 推流（解决 ⚠️ 风险项） | `dragon-senate-saas-v2/execution_ws_room.py` | 1.5天 |
| P1-6 | OpenAI 兼容 API 层（让龙虾变成标准 AI 接口） | `dragon-senate-saas-v2/openai_compat_api.py` | 1天 |

---

## P1-1：Provider 标准接口规范

### 背景
AnythingLLM 的 30+ Provider 都实现相同的 4 个接口，保证可互换性。我们的 `provider_registry.py` 接口不统一，切换 Provider 容易出现兼容性问题。

### 目标文件
在 `dragon-senate-saas-v2/provider_registry.py` 中新增抽象基类

### 完整代码

```python
"""
Provider 标准接口规范
借鉴：AnythingLLM server/utils/AiProviders/ 统一 4 接口设计
强制所有 Provider 实现：streaming_enabled / prompt_window_limit / construct_messages / chunk_response
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncGenerator, Optional
import logging

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# 标准消息格式
# ─────────────────────────────────────────────

@dataclass
class ChatMessage:
    role: str       # "system" | "user" | "assistant"
    content: str
    name: Optional[str] = None   # 多 Agent 场景下的发言者名字


@dataclass
class StreamChunk:
    """流式响应的单个 chunk"""
    content: str
    finish_reason: Optional[str] = None   # "stop" | "length" | None
    usage: Optional[dict] = None          # {"prompt_tokens": 100, "completion_tokens": 50}


# ─────────────────────────────────────────────
# 抽象基类：所有 Provider 必须实现的 4 个接口
# 借鉴 AnythingLLM AiProvider 统一接口规范
# ─────────────────────────────────────────────

class BaseAiProvider(ABC):
    """
    AI Provider 抽象基类
    所有 Provider 必须实现以下 4 个接口，保证可互换性。

    借鉴来源：AnythingLLM server/utils/AiProviders/openAi/index.js
    """

    # ── 接口 1：是否支持流式输出 ──
    @property
    @abstractmethod
    def streaming_enabled(self) -> bool:
        """
        该 Provider 是否支持流式输出（SSE/WebSocket streaming）。
        支持 → True，需要走 chunk_response 路径
        不支持 → False，走普通 complete 路径
        """
        ...

    # ── 接口 2：上下文窗口大小（token 数）──
    @property
    @abstractmethod
    def prompt_window_limit(self) -> int:
        """
        该 Provider 支持的最大 context window（prompt tokens）。
        用于 conversation_compactor 判断是否需要压缩历史。
        示例：gpt-4o → 128000，claude-3-haiku → 200000
        """
        ...

    # ── 接口 3：构造消息列表 ──
    @abstractmethod
    def construct_messages(
        self,
        system_prompt: str,
        history: list[ChatMessage],
        user_message: str,
    ) -> list[dict]:
        """
        将系统 Prompt + 历史对话 + 当前用户消息，构造成该 Provider 接受的消息格式。
        不同 Provider 的消息格式略有差异（anthropic 不支持 system 在 messages 中等）。

        Returns:
            List of message dicts，格式符合该 Provider 的 API 要求
        """
        ...

    # ── 接口 4：流式输出 chunk 处理 ──
    @abstractmethod
    async def chunk_response(
        self,
        messages: list[dict],
        **kwargs,
    ) -> AsyncGenerator[StreamChunk, None]:
        """
        发起流式请求，逐 chunk 返回 StreamChunk。
        非流式 Provider 可以在此模拟单次返回。
        """
        ...

    # ── 可选接口：完整非流式请求 ──
    async def complete(
        self,
        messages: list[dict],
        **kwargs,
    ) -> str:
        """
        非流式完整请求。默认实现：聚合 chunk_response 的所有 chunk。
        Provider 可以覆盖此方法以使用原生非流式 API。
        """
        full_content = ""
        async for chunk in self.chunk_response(messages, **kwargs):
            full_content += chunk.content
        return full_content

    # ── 工具方法：检查消息是否超出窗口限制 ──
    def is_within_window(self, messages: list[dict]) -> bool:
        """
        粗略检查消息是否在窗口限制内（基于字符数估算）。
        精确计算可覆盖此方法使用 tiktoken 等库。
        """
        total_chars = sum(len(str(m.get("content", ""))) for m in messages)
        estimated_tokens = total_chars // 4   # 粗略：4字符 ≈ 1 token
        return estimated_tokens < self.prompt_window_limit


# ─────────────────────────────────────────────
# 示例：OpenAI Provider 实现
# ─────────────────────────────────────────────

class OpenAiProvider(BaseAiProvider):
    """OpenAI Provider 标准实现"""

    def __init__(self, api_key: str, model: str = "gpt-4o", base_url: str = None):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url or "https://api.openai.com/v1"

    @property
    def streaming_enabled(self) -> bool:
        return True

    @property
    def prompt_window_limit(self) -> int:
        limits = {
            "gpt-4o": 128000,
            "gpt-4o-mini": 128000,
            "gpt-4-turbo": 128000,
            "gpt-3.5-turbo": 16385,
        }
        return limits.get(self.model, 128000)

    def construct_messages(
        self,
        system_prompt: str,
        history: list[ChatMessage],
        user_message: str,
    ) -> list[dict]:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        for msg in history:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": user_message})
        return messages

    async def chunk_response(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        **kwargs,
    ) -> AsyncGenerator[StreamChunk, None]:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        stream = await client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
            temperature=temperature,
            **kwargs,
        )
        async for event in stream:
            delta = event.choices[0].delta if event.choices else None
            if delta and delta.content:
                yield StreamChunk(
                    content=delta.content,
                    finish_reason=event.choices[0].finish_reason,
                )


class AnthropicProvider(BaseAiProvider):
    """Anthropic Claude Provider 标准实现"""

    def __init__(self, api_key: str, model: str = "claude-3-5-sonnet-20241022"):
        self.api_key = api_key
        self.model = model

    @property
    def streaming_enabled(self) -> bool:
        return True

    @property
    def prompt_window_limit(self) -> int:
        limits = {
            "claude-3-5-sonnet-20241022": 200000,
            "claude-3-haiku-20240307": 200000,
            "claude-3-opus-20240229": 200000,
        }
        return limits.get(self.model, 200000)

    def construct_messages(
        self,
        system_prompt: str,
        history: list[ChatMessage],
        user_message: str,
    ) -> list[dict]:
        # Anthropic: system 不在 messages 中，单独传
        messages = []
        for msg in history:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": user_message})
        # 注：system_prompt 需要在调用时单独传给 anthropic client
        return messages

    async def chunk_response(
        self,
        messages: list[dict],
        system_prompt: str = "",
        temperature: float = 0.7,
        **kwargs,
    ) -> AsyncGenerator[StreamChunk, None]:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=self.api_key)
        async with client.messages.stream(
            model=self.model,
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
            temperature=temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield StreamChunk(content=text)


# ─────────────────────────────────────────────
# Provider 注册表（更新版，强制接口校验）
# ─────────────────────────────────────────────

class ProviderRegistry:
    """
    Provider 注册表，自动校验 Provider 是否实现 4 个必须接口
    """
    _providers: dict[str, BaseAiProvider] = {}

    @classmethod
    def register(cls, name: str, provider: BaseAiProvider):
        """注册 Provider，自动校验接口合规性"""
        if not isinstance(provider, BaseAiProvider):
            raise TypeError(
                f"Provider '{name}' 必须继承 BaseAiProvider 并实现 4 个标准接口"
            )
        cls._providers[name] = provider
        logger.info(f"[ProviderRegistry] 注册 Provider: {name} "
                    f"(streaming={provider.streaming_enabled}, window={provider.prompt_window_limit})")

    @classmethod
    def get(cls, name: str) -> BaseAiProvider:
        if name not in cls._providers:
            raise KeyError(f"Provider '{name}' 未注册。已注册: {list(cls._providers.keys())}")
        return cls._providers[name]

    @classmethod
    def list_providers(cls) -> list[dict]:
        return [
            {
                "name": name,
                "streaming_enabled": p.streaming_enabled,
                "prompt_window_limit": p.prompt_window_limit,
            }
            for name, p in cls._providers.items()
        ]
```

---

## P1-2：龙虾技能白名单

### 背景
AnythingLLM 的 `agentSkillWhitelist` 允许每个工作区单独开启/关闭特定技能。我们需要同样的租户级龙虾技能开关，让不同客户有不同的龙虾能力配置。

### 目标文件
`dragon-senate-saas-v2/lobster_skill_whitelist.py`（新建）

### 完整代码

```python
"""
龙虾技能白名单
借鉴：AnythingLLM server/models/agentSkillWhitelist.js
用途：租户级别的龙虾技能开关，控制不同客户可以使用哪些龙虾技能
"""

import json
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# 默认开放给所有租户的技能（无需白名单控制）
DEFAULT_ALLOWED_SKILLS = {"*"}   # "*" 表示全部允许

# 高风险技能（需要租户显式开启才允许）
HIGH_RISK_SKILLS = {
    "dispatcher_wechat_publish",    # 微信发布（需要绑定账号授权）
    "dispatcher_douyin_publish",    # 抖音发布
    "catcher_crm_write",           # 写入 CRM 数据
    "followup_bulk_send",          # 批量发送跟进消息
}


class LobsterSkillWhitelist:
    """
    租户级龙虾技能白名单
    
    数据存储：tenant_skill_whitelist.json（持久化）
    或对接 DB（生产环境）
    
    设计原则：
    - 默认：所有非高风险技能对所有租户开放
    - 高风险技能：需要租户显式开启
    - 可以针对特定龙虾的特定技能做精细控制
    """

    def __init__(self, store_path: str = "data/tenant_skill_whitelist.json"):
        self.store_path = store_path
        self._whitelist: dict[str, dict[str, list[str]]] = {}  # {tenant_id: {lobster_id: [skill_ids]}}
        self._load()

    def _load(self):
        try:
            import os
            if os.path.exists(self.store_path):
                with open(self.store_path, "r", encoding="utf-8") as f:
                    self._whitelist = json.load(f)
        except Exception as e:
            logger.warning(f"[SkillWhitelist] 加载失败，使用空白名单: {e}")
            self._whitelist = {}

    def _save(self):
        import os
        os.makedirs(os.path.dirname(self.store_path), exist_ok=True)
        with open(self.store_path, "w", encoding="utf-8") as f:
            json.dump(self._whitelist, f, ensure_ascii=False, indent=2)

    def is_skill_allowed(
        self,
        tenant_id: str,
        lobster_id: str,
        skill_id: str,
    ) -> bool:
        """
        检查租户是否有权使用特定龙虾技能。
        
        逻辑：
        1. 高风险技能 → 必须在白名单中明确允许
        2. 普通技能 → 默认允许，除非被明确禁用
        3. 租户有自定义配置 → 按配置执行
        """
        # 高风险技能：必须显式允许
        if skill_id in HIGH_RISK_SKILLS:
            return self._is_in_whitelist(tenant_id, lobster_id, skill_id)

        # 普通技能：检查是否被明确禁用
        tenant_config = self._whitelist.get(tenant_id, {})
        lobster_config = tenant_config.get(lobster_id, None)

        if lobster_config is None:
            return True  # 无配置 → 默认全部允许

        if "*" in lobster_config:
            return True  # 通配符 → 全部允许

        return skill_id in lobster_config

    def _is_in_whitelist(self, tenant_id: str, lobster_id: str, skill_id: str) -> bool:
        tenant_config = self._whitelist.get(tenant_id, {})
        lobster_config = tenant_config.get(lobster_id, [])
        return skill_id in lobster_config or "*" in lobster_config

    def get_allowed_skills(self, tenant_id: str, lobster_id: str) -> list[str]:
        """获取租户某只龙虾的允许技能列表"""
        tenant_config = self._whitelist.get(tenant_id, {})
        lobster_config = tenant_config.get(lobster_id, None)
        if lobster_config is None:
            return ["*"]  # 默认全部
        return lobster_config

    def set_skill_whitelist(
        self,
        tenant_id: str,
        lobster_id: str,
        skills: list[str],
        operator: str = "system",
    ):
        """
        设置租户某只龙虾的技能白名单。
        
        Args:
            tenant_id: 租户 ID
            lobster_id: 龙虾 canonical_id
            skills: 允许的技能列表，["*"] 表示全部允许
            operator: 操作者（用于审计日志）
        """
        if tenant_id not in self._whitelist:
            self._whitelist[tenant_id] = {}

        self._whitelist[tenant_id][lobster_id] = skills
        self._save()

        logger.info(
            f"[SkillWhitelist] 更新 tenant={tenant_id} lobster={lobster_id} "
            f"skills={skills} by={operator}"
        )

    def enable_high_risk_skill(
        self,
        tenant_id: str,
        lobster_id: str,
        skill_id: str,
        operator: str = "admin",
    ):
        """显式开启高风险技能（需要管理员权限）"""
        if skill_id not in HIGH_RISK_SKILLS:
            logger.warning(f"[SkillWhitelist] {skill_id} 不是高风险技能，无需显式开启")

        current = self.get_allowed_skills(tenant_id, lobster_id)
        if skill_id not in current:
            current.append(skill_id)
            self.set_skill_whitelist(tenant_id, lobster_id, current, operator)

    def disable_skill(
        self,
        tenant_id: str,
        lobster_id: str,
        skill_id: str,
        operator: str = "admin",
    ):
        """禁用某个技能"""
        current = self.get_allowed_skills(tenant_id, lobster_id)
        if "*" in current:
            # 从全部允许变为：除了这个技能
            # 需要先获取所有已知技能列表，移除目标技能
            logger.warning(
                f"[SkillWhitelist] 当前配置为'全部允许'，"
                f"禁用 {skill_id} 需要先获取完整技能列表"
            )
            return

        if skill_id in current:
            current.remove(skill_id)
            self.set_skill_whitelist(tenant_id, lobster_id, current, operator)

    def get_tenant_overview(self, tenant_id: str) -> dict:
        """获取租户的技能配置概览"""
        return {
            "tenant_id": tenant_id,
            "lobster_configs": self._whitelist.get(tenant_id, {}),
            "high_risk_skills": list(HIGH_RISK_SKILLS),
            "checked_at": datetime.now().isoformat(),
        }
```

---

## P1-3：龙虾斜线命令系统

### 背景
AnythingLLM 的 `slashCommandsPresets` 让用户输入 `/命令` 快速展开 Prompt。我们可以扩展为龙虾专属斜线命令：用户输入 `/radar` 直接触发雷达信号搜索，输入 `/post` 触发内容发布工作流。

### 目标文件
`dragon-senate-saas-v2/slash_command_router.py`（新建）

### 完整代码

```python
"""
龙虾斜线命令路由器
借鉴：AnythingLLM server/models/slashCommandsPresets.js
用途：用户输入 /command 快速触发龙虾技能或工作流
"""

import re
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class SlashCommand:
    """斜线命令定义"""
    command: str                    # 命令词，如 "radar"（不含斜杠）
    display_name: str               # 显示名称，如 "🦞 雷达信号搜索"
    description: str                # 命令说明
    lobster: Optional[str] = None   # 单龙虾命令
    skill: Optional[str] = None     # 直接触发的技能 ID
    workflow: Optional[str] = None  # 触发工作流名（多龙虾联合）
    prompt_template: str = ""       # 展开的 Prompt 模板（支持 {变量}）
    params: list[str] = field(default_factory=list)  # 参数名列表（从用户输入解析）
    require_params: bool = False    # 是否需要参数（否则直接触发）
    category: str = "general"       # 分类（用于 UI 分组显示）


# ─────────────────────────────────────────────
# 龙虾专属斜线命令注册表
# ─────────────────────────────────────────────

LOBSTER_SLASH_COMMANDS: dict[str, SlashCommand] = {
    "radar": SlashCommand(
        command="radar",
        display_name="🦞 雷达信号搜索",
        description="搜索最新竞品动态、行业信号、热点话题",
        lobster="radar",
        skill="radar_competitor_search",
        prompt_template="请搜索 {query} 的最新竞品动态和行业信号",
        params=["query"],
        require_params=True,
        category="research",
    ),
    "trend": SlashCommand(
        command="trend",
        display_name="🦞 热点趋势发现",
        description="发现当前平台热点趋势和爆款内容",
        lobster="radar",
        skill="radar_trend_discovery",
        prompt_template="发现 {platform} 平台最新热点趋势",
        params=["platform"],
        require_params=False,
        category="research",
    ),
    "strategy": SlashCommand(
        command="strategy",
        display_name="🦞 制定增长策略",
        description="为产品/品牌制定内容增长策略",
        lobster="strategist",
        skill="strategist_growth_plan",
        prompt_template="为 {product} 制定完整的内容增长策略，包含渠道选择、预算分配和KPI设定",
        params=["product"],
        require_params=True,
        category="strategy",
    ),
    "write": SlashCommand(
        command="write",
        display_name="🦞 写文案",
        description="快速生成营销文案",
        lobster="inkwriter",
        skill="inkwriter_copy_generation",
        prompt_template="为 {topic} 写一篇 {platform} 风格的营销文案",
        params=["topic", "platform"],
        require_params=True,
        category="content",
    ),
    "post": SlashCommand(
        command="post",
        display_name="🦞 内容发布工作流",
        description="写文案 + 安排发布（inkwriter + dispatcher 联合）",
        workflow="content-campaign",
        prompt_template="为 {topic} 创作内容并安排发布到 {platform}",
        params=["topic", "platform"],
        require_params=True,
        category="content",
    ),
    "follow": SlashCommand(
        command="follow",
        display_name="🦞 跟进客户",
        description="给客户发送个性化跟进消息",
        lobster="followup",
        skill="followup_send_message",
        prompt_template="给客户 {customer} 发送跟进消息，重点强调 {focus}",
        params=["customer", "focus"],
        require_params=True,
        category="crm",
    ),
    "score": SlashCommand(
        command="score",
        display_name="🦞 线索评分",
        description="评估并录入新线索",
        lobster="catcher",
        skill="catcher_lead_scoring",
        prompt_template="评估线索 {lead_info} 的质量，给出评分和入库建议",
        params=["lead_info"],
        require_params=True,
        category="crm",
    ),
    "roi": SlashCommand(
        command="roi",
        display_name="🦞 ROI 报告",
        description="生成营销活动 ROI 分析报告",
        lobster="abacus",
        skill="abacus_roi_report",
        prompt_template="生成 {campaign} 营销活动的 ROI 分析报告，时间范围：{period}",
        params=["campaign", "period"],
        require_params=False,
        category="analytics",
    ),
    "reply": SlashCommand(
        command="reply",
        display_name="🦞 回复评论",
        description="批量生成评论回复话术",
        lobster="echoer",
        skill="echoer_comment_reply",
        prompt_template="为以下评论生成专业回复：{comment}",
        params=["comment"],
        require_params=True,
        category="engagement",
    ),
}


# ─────────────────────────────────────────────
# 斜线命令路由器
# ─────────────────────────────────────────────

@dataclass
class SlashCommandResult:
    """斜线命令解析结果"""
    matched: bool
    command: Optional[SlashCommand] = None
    params: dict = field(default_factory=dict)
    expanded_prompt: str = ""        # 展开后的完整 Prompt
    route_to: str = ""               # 路由目标：lobster_id 或 workflow_id
    route_type: str = ""             # "lobster" | "workflow"
    original_input: str = ""


class SlashCommandRouter:
    """
    斜线命令路由器
    负责：解析用户输入 → 匹配命令 → 展开 Prompt → 路由到龙虾或工作流
    """

    def __init__(self, custom_commands: dict[str, SlashCommand] = None):
        self.commands = {**LOBSTER_SLASH_COMMANDS}
        if custom_commands:
            self.commands.update(custom_commands)

    def parse(self, user_input: str) -> SlashCommandResult:
        """
        解析用户输入，检查是否是斜线命令。
        
        支持格式：
        - /radar 竞品分析          → command="radar", params={"query": "竞品分析"}
        - /post 双11大促 小红书     → command="post", params={"topic": "双11大促", "platform": "小红书"}
        - /roi                     → command="roi", params={}（无参数版本）
        
        Returns:
            SlashCommandResult（matched=False 表示非斜线命令，正常处理）
        """
        stripped = user_input.strip()

        # 不是斜线命令
        if not stripped.startswith("/"):
            return SlashCommandResult(matched=False, original_input=user_input)

        # 解析命令词和参数
        parts = stripped[1:].split(maxsplit=1)
        command_word = parts[0].lower()
        args_text = parts[1] if len(parts) > 1 else ""

        if command_word not in self.commands:
            return SlashCommandResult(
                matched=False,
                original_input=user_input,
            )

        cmd = self.commands[command_word]

        # 如果需要参数但没有提供
        if cmd.require_params and not args_text:
            return SlashCommandResult(
                matched=True,
                command=cmd,
                params={},
                expanded_prompt=f"请提供参数：{', '.join(cmd.params)}\n用法：/{cmd.command} {' '.join(f'<{p}>' for p in cmd.params)}",
                route_to="",
                route_type="",
                original_input=user_input,
            )

        # 解析参数（简单空格分割，高级版可用 NLP）
        params = self._parse_params(cmd, args_text)

        # 展开 Prompt 模板
        expanded = self._expand_template(cmd.prompt_template, params, args_text)

        # 确定路由目标
        route_to = cmd.lobster or cmd.workflow or ""
        route_type = "lobster" if cmd.lobster else "workflow"

        return SlashCommandResult(
            matched=True,
            command=cmd,
            params=params,
            expanded_prompt=expanded,
            route_to=route_to,
            route_type=route_type,
            original_input=user_input,
        )

    def _parse_params(self, cmd: SlashCommand, args_text: str) -> dict:
        """简单参数解析：按空格分割，依次映射到 params 定义"""
        if not cmd.params:
            return {}

        arg_parts = args_text.split() if args_text else []

        params = {}
        for i, param_name in enumerate(cmd.params):
            if i < len(arg_parts):
                params[param_name] = arg_parts[i]
            else:
                params[param_name] = ""

        # 最后一个参数收集剩余文字
        if cmd.params and len(arg_parts) > len(cmd.params):
            last_param = cmd.params[-1]
            params[last_param] = " ".join(arg_parts[len(cmd.params) - 1:])

        return params

    def _expand_template(self, template: str, params: dict, fallback: str) -> str:
        """将参数注入 Prompt 模板"""
        if not template:
            return fallback
        try:
            return template.format(**params)
        except KeyError:
            return fallback or template

    def get_suggestions(self, prefix: str = "") -> list[dict]:
        """
        获取斜线命令建议列表（用于前端自动补全）
        
        Args:
            prefix: 用户已输入的前缀（不含斜杠），如 "r" 匹配 "radar"
        
        Returns:
            [{"command": "/radar", "display_name": "...", "description": "..."}]
        """
        suggestions = []
        for cmd_word, cmd in self.commands.items():
            if not prefix or cmd_word.startswith(prefix.lower()):
                suggestions.append({
                    "command": f"/{cmd_word}",
                    "display_name": cmd.display_name,
                    "description": cmd.description,
                    "params": cmd.params,
                    "category": cmd.category,
                    "example": f"/{cmd_word} {' '.join(f'<{p}>' for p in cmd.params)}",
                })
        return sorted(suggestions, key=lambda x: x["command"])
```

---

## P1-4：SystemPrompt 动态变量注入引擎

### 背景
AnythingLLM 的 `systemPromptVariables` 支持在 System Prompt 中使用 `{variable}` 占位符，每次调用时动态注入用户信息、时间、工作区上下文等。我们当前的 `prompt_registry.py` 是静态 Prompt，缺少运行时动态注入。

### 目标文件
`dragon-senate-saas-v2/prompt_variable_engine.py`（新建）

### 完整代码

```python
"""
龙虾 Prompt 动态变量注入引擎
借鉴：AnythingLLM server/models/systemPromptVariables.js
用途：在 System Prompt 中使用 {variable} 动态注入运行时上下文
"""

import re
import logging
from datetime import datetime, date
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# 内置变量（自动从上下文提取，无需手动传入）
# ─────────────────────────────────────────────

def get_builtin_variables(
    tenant_id: str = "",
    user_name: str = "",
    lobster_id: str = "",
) -> dict[str, str]:
    """
    内置系统变量，每次 Prompt 渲染时自动注入。
    借鉴 AnythingLLM systemPromptVariables 的内置变量设计。
    """
    now = datetime.now()
    return {
        # 时间相关
        "current_date": date.today().isoformat(),            # 2026-04-02
        "current_time": now.strftime("%H:%M"),               # 07:45
        "current_datetime": now.strftime("%Y-%m-%d %H:%M"),  # 2026-04-02 07:45
        "current_year": str(now.year),                       # 2026
        "current_month": str(now.month),                     # 4
        "weekday": now.strftime("%A"),                       # Wednesday

        # 用户相关
        "user_name": user_name or "用户",
        "tenant_id": tenant_id or "",

        # 龙虾相关
        "lobster_id": lobster_id or "",

        # 平台相关（中国市场默认值）
        "default_platform": "小红书",
        "timezone": "Asia/Shanghai",
    }


# ─────────────────────────────────────────────
# Prompt 变量引擎
# ─────────────────────────────────────────────

class PromptVariableEngine:
    """
    动态变量注入引擎
    支持：{variable_name} 格式占位符
    支持：{variable_name|default_value} 格式（变量不存在时使用默认值）
    """

    VARIABLE_PATTERN = re.compile(r'\{([a-zA-Z_][a-zA-Z0-9_]*?)(?:\|([^}]*))?\}')

    def render(
        self,
        prompt_template: str,
        variables: dict[str, Any],
        tenant_id: str = "",
        user_name: str = "",
        lobster_id: str = "",
    ) -> str:
        """
        渲染 Prompt 模板，注入所有变量。
        
        Args:
            prompt_template: 包含 {variable} 占位符的 Prompt 模板
            variables: 额外变量（会覆盖同名内置变量）
            tenant_id: 租户 ID（用于内置变量）
            user_name: 用户名（用于内置变量）
            lobster_id: 龙虾 ID（用于内置变量）
        
        Returns:
            注入变量后的完整 Prompt
        
        示例：
            template = "你好 {user_name}，今天是 {current_date}，请帮助 {company_name} 的用户"
            result = engine.render(template, {"company_name": "OpenClaw"}, user_name="张三")
            # → "你好 张三，今天是 2026-04-02，请帮助 OpenClaw 的用户"
        """
        # 合并变量：内置 < 传入（传入优先）
        all_vars = {
            **get_builtin_variables(tenant_id, user_name, lobster_id),
            **{k: str(v) for k, v in variables.items()},
        }

        def replace_variable(match: re.Match) -> str:
            var_name = match.group(1)
            default_val = match.group(2)  # 可能为 None

            if var_name in all_vars:
                return str(all_vars[var_name])
            elif default_val is not None:
                return default_val
            else:
                logger.warning(f"[PromptVariableEngine] 未定义变量: {{{var_name}}}")
                return match.group(0)  # 保留原始占位符

        return self.VARIABLE_PATTERN.sub(replace_variable, prompt_template)

    def extract_variables(self, prompt_template: str) -> list[str]:
        """提取 Prompt 模板中所有变量名"""
        matches = self.VARIABLE_PATTERN.findall(prompt_template)
        return [m[0] for m in matches]

    def validate_template(
        self,
        prompt_template: str,
        available_variables: dict[str, Any],
    ) -> tuple[bool, list[str]]:
        """
        校验模板中的变量是否都能被满足。
        
        Returns:
            (is_valid, missing_variable_names)
        """
        all_available = {
            **get_builtin_variables(),
            **available_variables,
        }
        required = self.extract_variables(prompt_template)
        # 有默认值的变量（{var|default}）不算缺失
        template_vars = self.VARIABLE_PATTERN.findall(prompt_template)
        missing = [
            var_name for var_name, default_val in template_vars
            if var_name not in all_available and default_val == ""
        ]
        return len(missing) == 0, missing


# ─────────────────────────────────────────────
# 与 prompt_registry.py 的集成示例
# ─────────────────────────────────────────────

_engine = PromptVariableEngine()

def render_lobster_prompt(
    lobster_id: str,
    prompt_template: str,
    runtime_context: dict,
    tenant_id: str = "",
    user_name: str = "",
) -> str:
    """
    渲染龙虾 System Prompt。
    在 lobster_runner.py 中调用此函数替换静态 Prompt 加载。
    """
    return _engine.render(
        prompt_template=prompt_template,
        variables=runtime_context,
        tenant_id=tenant_id,
        user_name=user_name,
        lobster_id=lobster_id,
    )
```

---

## P1-5：OpenAI 兼容 API 层

### 背景
AnythingLLM 实现了 `POST /api/openai/chat/completions` 让其他工具把 AnythingLLM 当普通 OpenAI 用。我们可以实现相同接口，让 Cursor/LobeHub/其他 AI 工具通过标准 OpenAI API 接入龙虾池。

### 目标文件
`dragon-senate-saas-v2/openai_compat_api.py`（新建）

### 完整代码

```python
"""
OpenAI 兼容 API 层
借鉴：AnythingLLM server/endpoints/api/openai/index.js
用途：让第三方 AI 工具通过标准 OpenAI API 接入龙虾池
接口：POST /v1/chat/completions + GET /v1/models
"""

import json
import asyncio
import logging
from datetime import datetime
from typing import Optional, AsyncGenerator
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["OpenAI Compatible API"])

# ─────────────────────────────────────────────
# 请求/响应 Schema（OpenAI 格式）
# ─────────────────────────────────────────────

class OpenAIMessage(BaseModel):
    role: str          # "system" | "user" | "assistant"
    content: str
    name: Optional[str] = None


class ChatCompletionRequest(BaseModel):
    model: str                          # 龙虾 canonical_id（如 "commander"、"radar"）
    messages: list[OpenAIMessage]
    stream: bool = False
    temperature: float = 0.7
    max_tokens: Optional[int] = None


# ─────────────────────────────────────────────
# 龙虾模型列表（GET /v1/models）
# ─────────────────────────────────────────────

LOBSTER_MODELS = [
    {"id": "commander", "object": "model", "owned_by": "openclaw", "display_name": "元老院总脑（Commander）"},
    {"id": "radar", "object": "model", "owned_by": "openclaw", "display_name": "触须虾 Radar（信号发现）"},
    {"id": "strategist", "object": "model", "owned_by": "openclaw", "display_name": "脑虫虾 Strategist（策略规划）"},
    {"id": "inkwriter", "object": "model", "owned_by": "openclaw", "display_name": "吐墨虾 Inkwriter（文案创作）"},
    {"id": "visualizer", "object": "model", "owned_by": "openclaw", "display_name": "幻影虾 Visualizer（图视觉）"},
    {"id": "dispatcher", "object": "model", "owned_by": "openclaw", "display_name": "点兵虾 Dispatcher（发布调度）"},
    {"id": "echoer", "object": "model", "owned_by": "openclaw", "display_name": "回声虾 Echoer（互动回复）"},
    {"id": "catcher", "object": "model", "owned_by": "openclaw", "display_name": "铁网虾 Catcher（线索评分）"},
    {"id": "abacus", "object": "model", "owned_by": "openclaw", "display_name": "金算虾 Abacus（ROI分析）"},
    {"id": "followup", "object": "model", "owned_by": "openclaw", "display_name": "回访虾 Followup（客户跟进）"},
]


@router.get("/models")
async def list_models(authorization: Optional[str] = Header(None)):
    """GET /v1/models - 返回龙虾列表（每只龙虾是一个"模型"）"""
    _verify_api_key(authorization)
    return JSONResponse({
        "object": "list",
        "data": LOBSTER_MODELS,
    })


# ─────────────────────────────────────────────
# 主接口：POST /v1/chat/completions
# ─────────────────────────────────────────────

@router.post("/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    authorization: Optional[str] = Header(None),
):
    """
    POST /v1/chat/completions
    OpenAI 兼容接口，将请求路由到对应龙虾。
    """
    api_key = _verify_api_key(authorization)
    lobster_id = request.model

    # 校验龙虾是否存在
    valid_lobsters = {m["id"] for m in LOBSTER_MODELS}
    if lobster_id not in valid_lobsters:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown model '{lobster_id}'. Valid models: {sorted(valid_lobsters)}"
        )

    # 提取对话内容
    system_prompt = next(
        (m.content for m in request.messages if m.role == "system"), ""
    )
    user_message = next(
        (m.content for m in reversed(request.messages) if m.role == "user"), ""
    )
    history = [m for m in request.messages if m.role in ("user", "assistant")]

    if request.stream:
        return StreamingResponse(
            _stream_lobster_response(lobster_id, system_prompt, user_message, history, api_key),
            media_type="text/event-stream",
        )
    else:
        return await _complete_lobster_response(lobster_id, system_prompt, user_message, history, api_key)


async def _stream_lobster_response(
    lobster_id: str,
    system_prompt: str,
    user_message: str,
    history: list,
    api_key: str,
) -> AsyncGenerator[str, None]:
    """流式响应生成器（SSE 格式）"""
    from dragon_senate_saas_v2.lobster_runner import run_lobster_stream

    try:
        request_id = f"chatcmpl-{int(datetime.now().timestamp())}"
        async for chunk_text in run_lobster_stream(
            lobster_id=lobster_id,
            user_message=user_message,
            system_prompt_override=system_prompt,
        ):
            chunk = {
                "id": request_id,
                "object": "chat.completion.chunk",
                "created": int(datetime.now().timestamp()),
                "model": lobster_id,
                "choices": [{
                    "index": 0,
                    "delta": {"role": "assistant", "content": chunk_text},
                    "finish_reason": None,
                }],
            }
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

        # 发送结束标记
        end_chunk = {
            "id": request_id,
            "object": "chat.completion.chunk",
            "created": int(datetime.now().timestamp()),
            "model": lobster_id,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(end_chunk)}\n\n"
        yield "data: [DONE]\n\n"

    except Exception as e:
        logger.error(f"[OpenAICompatAPI] 流式响应错误: {e}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


async def _complete_lobster_response(
    lobster_id: str,
    system_prompt: str,
    user_message: str,
    history: list,
    api_key: str,
) -> JSONResponse:
    """非流式完整响应"""
    from dragon_senate_saas_v2.lobster_runner import run_lobster_complete

    try:
        result = await run_lobster_complete(
            lobster_id=lobster_id,
            user_message=user_message,
            system_prompt_override=system_prompt,
        )
        response_text = result.get("output", "")

        return JSONResponse({
            "id": f"chatcmpl-{int(datetime.now().timestamp())}",
            "object": "chat.completion",
            "created": int(datetime.now().timestamp()),
            "model": lobster_id,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": response_text},
                "finish_reason": "stop",
            }],
            "usage": {
                "prompt_tokens": result.get("prompt_tokens", 0),
                "completion_tokens": result.get("completion_tokens", 0),
                "total_tokens": result.get("total_tokens", 0),
            },
        })
    except Exception as e:
        logger.error(f"[OpenAICompatAPI] 完整响应错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _verify_api_key(authorization: Optional[str]) -> str:
    """校验 API Key（Bearer token 格式）"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid API key")
    return authorization[7:]  # 去掉 "Bearer " 前缀
```

---

## 验收标准

| 任务 | 验收标准 |
|------|---------|
| P1-1 | `OpenAiProvider` / `AnthropicProvider` 均继承 `BaseAiProvider`，实现 4 个接口 |
| P1-1 | 未实现 4 接口的类注册到 `ProviderRegistry` 时抛出 `TypeError` |
| P1-2 | 高风险技能 `dispatcher_wechat_publish` 未开启时 `is_skill_allowed()` 返回 `False` |
| P1-2 | `set_skill_whitelist` 写入后持久化到 JSON 文件 |
| P1-3 | 输入 `/radar 竞品分析` 解析为 `{command: "radar", params: {query: "竞品分析"}}` |
| P1-3 | `get_suggestions("r")` 返回 "radar" 命令 |
| P1-4 | `render("你好 {user_name}，今天是 {current_date}", {}, user_name="张三")` 输出正确 |
| P1-4 | 未定义变量 `{undefined_var}` 保留原始占位符并打印 warning |
| P1-5 | `GET /v1/models` 返回 10 只龙虾列表 |
| P1-5 | `POST /v1/chat/completions` 使用 `model="radar"` 正确路由到 Radar 龙虾 |
| P1-5 | 流式模式返回 `text/event-stream` 格式，最后一行为 `data: [DONE]` |

---

*CODEX TASK 创建：2026-04-02 | 借鉴来源：AnythingLLM agentSkillWhitelist + slashCommandsPresets + openai/index.js*
