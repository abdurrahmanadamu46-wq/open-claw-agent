"""
skill_frontmatter.py — 龙虾技能 Frontmatter 协议对象
======================================================
灵感来源：cccback-master skills/loadSkillsDir.ts

核心升级：
  技能不再是"能力名 + gotchas"的静态 JSON，
  而是带完整元数据的"可执行协议对象"：

  - allowed_tools   : 此技能允许使用的工具列表
  - effort          : 预估 effort（quick/medium/deep）
  - paths           : 此技能作用的数据/文件路径
  - when_to_use     : 何时触发此技能（触发条件）
  - hooks           : 前置/后置 hook（校验/通知/记录）
  - execution_context: 执行上下文（platform/channel/tenant_tier）
  - source          : 技能来源（builtin/tenant_custom/marketplace/policy_managed）
  - governance_tier : 治理级别（open/supervised/restricted/locked）

集成点：
  lobster_skill_registry.py → 注册时解析 frontmatter
  skill_loader.py           → 加载时过滤 governance_tier
  commander_graph_builder.py → 路由时显示 effort/allowed_tools
  前端技能页                 → 展示所有字段
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore


# ────────────────────────────────────────────────────────────────────
# 技能来源分层（仿 cccback plugin source layering）
# ────────────────────────────────────────────────────────────────────

SkillSource = Literal[
    "builtin",           # 系统内置，不可删除
    "tenant_custom",     # 租户自定义（由运营上传）
    "marketplace",       # 从技能市场安装
    "policy_managed",    # 由平台策略管控（可远程开关）
    "experimental",      # 实验性功能（默认关闭）
]

SkillGovernanceTier = Literal[
    "open",         # 所有龙虾/租户可用
    "supervised",   # 需要人工确认才能执行
    "restricted",   # 仅特定 tenant_tier 可用
    "locked",       # 仅平台管理员可用
]

SkillEffort = Literal[
    "quick",    # < 30s，< 2k token
    "medium",   # 30s~3min，2k~20k token
    "deep",     # > 3min，> 20k token，可能需要后台化
]


# ────────────────────────────────────────────────────────────────────
# 技能 Hook 定义
# ────────────────────────────────────────────────────────────────────

@dataclass
class SkillHook:
    """
    技能前置/后置 hook（仿 cccback hooks 字段）

    before_run: 执行前校验（如：检查账号登录状态）
    after_run:  执行后通知/记录（如：写 audit log）
    on_error:   失败时处理（如：回滚、告警）
    """
    before_run: list[str] = field(default_factory=list)  # hook 函数名
    after_run: list[str] = field(default_factory=list)
    on_error: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> "SkillHook":
        if not d:
            return cls()
        return cls(
            before_run=list(d.get("before_run", []) or []),
            after_run=list(d.get("after_run", []) or []),
            on_error=list(d.get("on_error", []) or []),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "before_run": self.before_run,
            "after_run": self.after_run,
            "on_error": self.on_error,
        }


# ────────────────────────────────────────────────────────────────────
# 执行上下文约束
# ────────────────────────────────────────────────────────────────────

@dataclass
class SkillExecutionContext:
    """
    技能的执行上下文约束（仿 cccback executionContext）

    platforms:    此技能适用的平台（xhs/douyin/kuaishou/weixin/all）
    tenant_tiers: 允许的租户级别（basic/growth/enterprise）
    channels:     适用的渠道类型（posts/dms/comments/live）
    min_autonomy: 最低自主度要求（manual/supervised/autonomous）
    """
    platforms: list[str] = field(default_factory=lambda: ["all"])
    tenant_tiers: list[str] = field(default_factory=lambda: ["basic", "growth", "enterprise"])
    channels: list[str] = field(default_factory=lambda: ["all"])
    min_autonomy: str = "manual"

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> "SkillExecutionContext":
        if not d:
            return cls()
        return cls(
            platforms=list(d.get("platforms", ["all"]) or ["all"]),
            tenant_tiers=list(d.get("tenant_tiers", ["basic", "growth", "enterprise"]) or ["basic"]),
            channels=list(d.get("channels", ["all"]) or ["all"]),
            min_autonomy=str(d.get("min_autonomy", "manual") or "manual"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "platforms": self.platforms,
            "tenant_tiers": self.tenant_tiers,
            "channels": self.channels,
            "min_autonomy": self.min_autonomy,
        }


# ────────────────────────────────────────────────────────────────────
# SkillFrontmatter — 完整协议对象
# ────────────────────────────────────────────────────────────────────

@dataclass
class SkillFrontmatter:
    """
    龙虾技能完整协议对象（仿 cccback skills/loadSkillsDir.ts）

    这不只是一个配置，而是一个"可执行协议"：
    它定义了技能的能力边界、治理约束、执行条件和生命周期 hook。

    字段说明：
        id:                技能唯一 ID（如 "inkwriter_copy_generate"）
        name:              人类可读名称
        description:       用途描述
        lobster_ids:       此技能属于哪些龙虾（多对多）
        category:          技能分类（content/engagement/analysis/dispatch/...）

        allowed_tools:     执行此技能时允许调用的工具（精确控制）
        effort:            预估工作量（quick/medium/deep）
        paths:             此技能操作的数据路径（用于权限检查）
        when_to_use:       触发条件（自然语言，用于 commander 路由提示）
        gotchas:           已知陷阱/注意事项

        hooks:             生命周期 hook
        execution_context: 执行上下文约束

        source:            技能来源
        governance_tier:   治理级别
        version:           版本号
        enabled:           是否启用
        tags:              标签（用于搜索/过滤）

        steps:             技能执行步骤（Markdown 格式）
    """

    # 核心身份
    id: str = ""
    name: str = ""
    description: str = ""
    lobster_ids: list[str] = field(default_factory=list)
    category: str = "general"

    # 能力约束（最重要的新字段）
    allowed_tools: list[str] = field(default_factory=list)
    effort: SkillEffort = "medium"
    paths: list[str] = field(default_factory=list)
    when_to_use: str = ""
    gotchas: list[str] = field(default_factory=list)

    # 生命周期
    hooks: SkillHook = field(default_factory=SkillHook)
    execution_context: SkillExecutionContext = field(default_factory=SkillExecutionContext)

    # 治理
    source: SkillSource = "builtin"
    governance_tier: SkillGovernanceTier = "open"
    version: str = "1.0.0"
    enabled: bool = True
    tags: list[str] = field(default_factory=list)

    # 内容
    steps: str = ""  # Markdown 格式的执行步骤

    # ── 序列化/反序列化 ───────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "lobster_ids": self.lobster_ids,
            "category": self.category,
            "allowed_tools": self.allowed_tools,
            "effort": self.effort,
            "paths": self.paths,
            "when_to_use": self.when_to_use,
            "gotchas": self.gotchas,
            "hooks": self.hooks.to_dict(),
            "execution_context": self.execution_context.to_dict(),
            "source": self.source,
            "governance_tier": self.governance_tier,
            "version": self.version,
            "enabled": self.enabled,
            "tags": self.tags,
            "steps_preview": self.steps[:300] + "..." if len(self.steps) > 300 else self.steps,
        }

    def can_use_tool(self, tool_name: str) -> bool:
        """检查此技能是否允许使用指定工具"""
        if not self.allowed_tools:
            return True  # 无限制
        return tool_name in self.allowed_tools or "*" in self.allowed_tools

    def is_available_for(
        self,
        *,
        platform: str = "all",
        tenant_tier: str = "basic",
        channel: str = "all",
        autonomy: str = "manual",
    ) -> tuple[bool, str]:
        """
        检查此技能在给定上下文是否可用。
        返回 (可用, 原因)
        """
        if not self.enabled:
            return False, f"技能 {self.id} 已禁用"

        ctx = self.execution_context
        if platform != "all" and "all" not in ctx.platforms and platform not in ctx.platforms:
            return False, f"技能 {self.id} 不支持平台 {platform}（支持：{ctx.platforms}）"

        if tenant_tier not in ctx.tenant_tiers:
            return False, f"技能 {self.id} 需要 {ctx.tenant_tiers} 级别租户，当前为 {tenant_tier}"

        if channel != "all" and "all" not in ctx.channels and channel not in ctx.channels:
            return False, f"技能 {self.id} 不支持渠道 {channel}（支持：{ctx.channels}）"

        autonomy_order = {"manual": 0, "supervised": 1, "autonomous": 2}
        if autonomy_order.get(autonomy, 0) < autonomy_order.get(ctx.min_autonomy, 0):
            return False, f"技能 {self.id} 需要最低自主度 {ctx.min_autonomy}，当前为 {autonomy}"

        return True, "ok"

    def estimated_tokens(self) -> int:
        """预估此技能消耗的 Token 数（用于压缩时截断判断）"""
        effort_map = {"quick": 2000, "medium": 15000, "deep": 60000}
        return effort_map.get(self.effort, 15000)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SkillFrontmatter":
        return cls(
            id=str(d.get("id", "") or ""),
            name=str(d.get("name", "") or ""),
            description=str(d.get("description", "") or ""),
            lobster_ids=list(d.get("lobster_ids", []) or []),
            category=str(d.get("category", "general") or "general"),
            allowed_tools=list(d.get("allowed_tools", []) or []),
            effort=d.get("effort", "medium") or "medium",  # type: ignore[arg-type]
            paths=list(d.get("paths", []) or []),
            when_to_use=str(d.get("when_to_use", "") or ""),
            gotchas=list(d.get("gotchas", []) or []),
            hooks=SkillHook.from_dict(d.get("hooks")),
            execution_context=SkillExecutionContext.from_dict(d.get("execution_context")),
            source=d.get("source", "builtin") or "builtin",  # type: ignore[arg-type]
            governance_tier=d.get("governance_tier", "open") or "open",  # type: ignore[arg-type]
            version=str(d.get("version", "1.0.0") or "1.0.0"),
            enabled=bool(d.get("enabled", True)),
            tags=list(d.get("tags", []) or []),
            steps=str(d.get("steps", "") or ""),
        )

    @classmethod
    def from_markdown_file(cls, path: Path) -> "SkillFrontmatter":
        """
        从 Markdown 文件加载技能（仿 cccback loadSkillsDir.ts）。

        文件格式：
        ---
        id: inkwriter_copy_generate
        name: 小红书文案生成
        description: 生成符合平台风格的文案
        lobster_ids: [inkwriter]
        allowed_tools: [web_search, image_gen]
        effort: medium
        when_to_use: 用户需要发帖文案时
        paths: [/accounts/*/drafts]
        governance_tier: open
        source: builtin
        tags: [content, xhs]
        hooks:
          before_run: [check_account_login]
          after_run: [record_copy_to_draft]
        execution_context:
          platforms: [xhs, douyin]
          tenant_tiers: [basic, growth, enterprise]
        ---

        ## 执行步骤

        1. 分析账号风格...
        2. 生成文案...
        """
        content = path.read_text(encoding="utf-8", errors="replace")

        # 解析 frontmatter
        frontmatter_data: dict[str, Any] = {}
        steps = content

        fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)", content, re.DOTALL)
        if fm_match:
            fm_text = fm_match.group(1)
            steps = fm_match.group(2).strip()

            if yaml is not None:
                try:
                    parsed = yaml.safe_load(fm_text)
                    if isinstance(parsed, dict):
                        frontmatter_data = parsed
                except Exception:
                    pass
            else:
                # 降级：简单 key: value 解析
                for line in fm_text.splitlines():
                    if ":" in line:
                        k, _, v = line.partition(":")
                        frontmatter_data[k.strip()] = v.strip()

        # 如果没有显式 id，从文件名推断
        if not frontmatter_data.get("id"):
            frontmatter_data["id"] = path.stem

        frontmatter_data["steps"] = steps
        return cls.from_dict(frontmatter_data)


# ────────────────────────────────────────────────────────────────────
# SkillFrontmatterRegistry — 技能注册表
# ────────────────────────────────────────────────────────────────────

class SkillFrontmatterRegistry:
    """
    技能 Frontmatter 注册表。

    功能：
    1. 从 YAML/Markdown 文件加载技能协议对象
    2. 按龙虾ID/分类/治理级别过滤
    3. 检查工具访问权限
    4. 为 commander 路由提供技能元数据摘要

    目录结构（推荐）：
        skills/
          builtin/          # 系统内置技能（Markdown）
          tenant_custom/    # 租户自定义技能
          marketplace/      # 市场安装的技能
    """

    SKILLS_DIR = os.getenv("SKILLS_DIR", "./skills")

    def __init__(self) -> None:
        self._skills: dict[str, SkillFrontmatter] = {}
        self._loaded = False

    def load_all(self, force: bool = False) -> None:
        """加载所有技能（从磁盘 + 内置）"""
        if self._loaded and not force:
            return

        # 加载内置技能（Python 定义）
        for skill in _BUILTIN_SKILLS:
            self._skills[skill.id] = skill

        # 加载 Markdown 文件技能
        skills_root = Path(self.SKILLS_DIR)
        if skills_root.exists():
            for md_file in skills_root.rglob("*.md"):
                try:
                    skill = SkillFrontmatter.from_markdown_file(md_file)
                    if skill.id:
                        # 从路径推断 source
                        rel = md_file.relative_to(skills_root)
                        parts = rel.parts
                        if parts and parts[0] in ("builtin", "tenant_custom", "marketplace", "policy_managed"):
                            skill.source = parts[0]  # type: ignore[assignment]
                        self._skills[skill.id] = skill
                except Exception:
                    pass

        self._loaded = True

    def get(self, skill_id: str) -> SkillFrontmatter | None:
        self.load_all()
        return self._skills.get(skill_id)

    def list_for_lobster(
        self,
        lobster_id: str,
        *,
        enabled_only: bool = True,
        governance_tier: list[str] | None = None,
    ) -> list[SkillFrontmatter]:
        """获取指定龙虾的技能列表"""
        self.load_all()
        result = []
        for skill in self._skills.values():
            if enabled_only and not skill.enabled:
                continue
            if lobster_id not in skill.lobster_ids and "*" not in skill.lobster_ids:
                continue
            if governance_tier and skill.governance_tier not in governance_tier:
                continue
            result.append(skill)
        return sorted(result, key=lambda s: (s.effort, s.name))

    def list_all(
        self,
        *,
        source: str | None = None,
        governance_tier: str | None = None,
        enabled_only: bool = True,
        category: str | None = None,
    ) -> list[SkillFrontmatter]:
        """列出所有技能（供前端技能页使用）"""
        self.load_all()
        result = []
        for skill in self._skills.values():
            if enabled_only and not skill.enabled:
                continue
            if source and skill.source != source:
                continue
            if governance_tier and skill.governance_tier != governance_tier:
                continue
            if category and skill.category != category:
                continue
            result.append(skill)
        return sorted(result, key=lambda s: (s.lobster_ids[0] if s.lobster_ids else "", s.name))

    def get_commander_routing_summary(self, skill_ids: list[str]) -> str:
        """
        为 commander 路由决策生成技能元数据摘要（注入 system prompt）。

        输出示例：
            - inkwriter_copy_generate [effort=medium, tools=web_search+image_gen, platform=xhs+douyin]
              When: 用户需要发帖文案时
        """
        self.load_all()
        lines: list[str] = []
        for skill_id in skill_ids:
            skill = self._skills.get(skill_id)
            if not skill:
                continue
            tools_str = "+".join(skill.allowed_tools[:3]) or "any"
            platforms = "+".join(skill.execution_context.platforms[:3])
            lines.append(
                f"- {skill.id} [effort={skill.effort}, tools={tools_str}, platform={platforms}]"
                + (f"\n  When: {skill.when_to_use}" if skill.when_to_use else "")
            )
        return "\n".join(lines)

    def register(self, skill: SkillFrontmatter) -> None:
        """动态注册技能（运行时）"""
        self._skills[skill.id] = skill

    def to_api_list(self) -> list[dict[str, Any]]:
        """供前端 API 返回的完整技能列表"""
        self.load_all()
        return [s.to_dict() for s in self._skills.values()]


# ────────────────────────────────────────────────────────────────────
# 内置技能（Python 定义，作为默认值）
# ────────────────────────────────────────────────────────────────────

_BUILTIN_SKILLS: list[SkillFrontmatter] = [
    # ── radar 技能 ──────────────────────────────────────────────────
    SkillFrontmatter(
        id="radar_web_search",
        name="网络热点搜索",
        description="搜索当前热点话题、行业趋势、竞品动态",
        lobster_ids=["radar"],
        category="research",
        allowed_tools=["web_search", "news_search", "trend_api"],
        effort="quick",
        when_to_use="用户询问最新趋势、竞品、行业动态时",
        paths=["/signals/*"],
        governance_tier="open",
        source="builtin",
        tags=["research", "trend", "competitor"],
        execution_context=SkillExecutionContext(platforms=["all"], channels=["all"]),
    ),
    # ── strategist 技能 ─────────────────────────────────────────────
    SkillFrontmatter(
        id="strategist_content_calendar",
        name="内容日历规划",
        description="制定内容发布节奏、主题规划、A/B测试方案",
        lobster_ids=["strategist"],
        category="strategy",
        allowed_tools=["calendar_api", "analytics_read"],
        effort="medium",
        when_to_use="用户需要内容规划或发布策略时",
        paths=["/strategy/calendar/*"],
        governance_tier="open",
        source="builtin",
        tags=["strategy", "calendar", "content"],
        execution_context=SkillExecutionContext(
            platforms=["xhs", "douyin", "kuaishou"],
            channels=["posts"],
        ),
    ),
    # ── inkwriter 技能 ──────────────────────────────────────────────
    SkillFrontmatter(
        id="inkwriter_copy_generate",
        name="平台文案生成",
        description="生成符合小红书/抖音/快手平台风格的文案",
        lobster_ids=["inkwriter"],
        category="content",
        allowed_tools=["web_search", "template_render", "banned_word_check"],
        effort="medium",
        when_to_use="用户需要发帖文案、话术脚本时",
        paths=["/accounts/*/drafts"],
        gotchas=["必须先做违禁词检查", "不同平台风格差异大，不可混用"],
        governance_tier="open",
        source="builtin",
        tags=["content", "copywriting", "xhs", "douyin"],
        hooks=SkillHook(after_run=["record_copy_to_draft"]),
        execution_context=SkillExecutionContext(
            platforms=["xhs", "douyin", "kuaishou"],
            channels=["posts", "dms"],
        ),
    ),
    # ── visualizer 技能 ─────────────────────────────────────────────
    SkillFrontmatter(
        id="visualizer_storyboard",
        name="分镜脚本生成",
        description="生成视频分镜脚本、画面描述、字幕",
        lobster_ids=["visualizer"],
        category="content",
        allowed_tools=["image_gen", "video_template"],
        effort="medium",
        when_to_use="用户需要制作短视频、直播脚本时",
        paths=["/accounts/*/storyboards"],
        governance_tier="open",
        source="builtin",
        tags=["video", "storyboard", "visual"],
        execution_context=SkillExecutionContext(
            platforms=["douyin", "kuaishou"],
            channels=["posts"],
        ),
    ),
    # ── dispatcher 技能 ─────────────────────────────────────────────
    SkillFrontmatter(
        id="dispatcher_scheduled_publish",
        name="定时发布调度",
        description="计算最优发布时间窗，调度边缘节点执行发布",
        lobster_ids=["dispatcher"],
        category="dispatch",
        allowed_tools=["edge_publish_api", "scheduler_write", "account_status_check"],
        effort="quick",
        when_to_use="内容准备好后需要发布时",
        paths=["/accounts/*/queue"],
        gotchas=["发布前必须检查账号状态", "同一账号不要同时发多帖"],
        governance_tier="supervised",
        source="builtin",
        tags=["dispatch", "publish", "schedule"],
        hooks=SkillHook(
            before_run=["check_account_login", "check_daily_limit"],
            after_run=["record_publish_log"],
            on_error=["alert_on_publish_failure"],
        ),
        execution_context=SkillExecutionContext(
            platforms=["xhs", "douyin", "kuaishou"],
            channels=["posts"],
            min_autonomy="supervised",
        ),
    ),
    # ── echoer 技能 ─────────────────────────────────────────────────
    SkillFrontmatter(
        id="echoer_reply_generate",
        name="评论/私信回复",
        description="自动生成评论回复、私信话术",
        lobster_ids=["echoer"],
        category="engagement",
        allowed_tools=["comment_api", "dm_api", "template_render"],
        effort="quick",
        when_to_use="账号有未回复的评论或私信时",
        paths=["/accounts/*/inbox"],
        governance_tier="supervised",
        source="builtin",
        tags=["engagement", "reply", "community"],
        hooks=SkillHook(before_run=["check_reply_daily_limit"]),
        execution_context=SkillExecutionContext(
            platforms=["xhs", "douyin"],
            channels=["comments", "dms"],
            min_autonomy="supervised",
        ),
    ),
    # ── abacus 技能 ─────────────────────────────────────────────────
    SkillFrontmatter(
        id="abacus_roi_calc",
        name="ROI 分析",
        description="计算投放 ROI、转化漏斗、归因分析",
        lobster_ids=["abacus"],
        category="analysis",
        allowed_tools=["analytics_read", "crm_read", "report_generate"],
        effort="deep",
        when_to_use="需要分析投放效果、生成数据报告时",
        paths=["/analytics/*", "/reports/*"],
        governance_tier="open",
        source="builtin",
        tags=["analytics", "roi", "attribution"],
        execution_context=SkillExecutionContext(
            tenant_tiers=["growth", "enterprise"],
        ),
    ),
    # ── catcher 技能 ────────────────────────────────────────────────
    SkillFrontmatter(
        id="catcher_lead_score",
        name="线索评分入库",
        description="对潜在客户评分、去重、CRM 入库",
        lobster_ids=["catcher"],
        category="leads",
        allowed_tools=["crm_write", "lead_score_api", "dedup_check"],
        effort="quick",
        when_to_use="有新的潜在客户互动时",
        paths=["/leads/*", "/crm/*"],
        governance_tier="restricted",
        source="builtin",
        tags=["leads", "crm", "scoring"],
        hooks=SkillHook(
            before_run=["dedup_check"],
            after_run=["notify_sales_team"],
        ),
        execution_context=SkillExecutionContext(
            tenant_tiers=["growth", "enterprise"],
            min_autonomy="supervised",
        ),
    ),
    # ── followup 技能 ───────────────────────────────────────────────
    SkillFrontmatter(
        id="followup_multi_touch",
        name="多触点跟进",
        description="多渠道多触点跟进潜在客户，推进成交",
        lobster_ids=["followup"],
        category="followup",
        allowed_tools=["dm_api", "phone_api", "wechat_api", "crm_write"],
        effort="medium",
        when_to_use="需要主动跟进线索或唤醒沉默客户时",
        paths=["/leads/*/followup", "/crm/*/touchpoints"],
        gotchas=["不要过度骚扰，遵守触达频率限制", "私信违规可能封号"],
        governance_tier="restricted",
        source="builtin",
        tags=["followup", "crm", "conversion"],
        hooks=SkillHook(
            before_run=["check_contact_frequency_limit"],
            after_run=["record_touchpoint_to_crm"],
            on_error=["alert_on_compliance_risk"],
        ),
        execution_context=SkillExecutionContext(
            platforms=["all"],
            channels=["dms"],
            tenant_tiers=["enterprise"],
            min_autonomy="autonomous",
        ),
    ),
]


# ── 全局单例 ─────────────────────────────────────────────────────────

_global_skill_registry: SkillFrontmatterRegistry | None = None


def get_skill_frontmatter_registry() -> SkillFrontmatterRegistry:
    """获取全局技能 Frontmatter 注册表"""
    global _global_skill_registry
    if _global_skill_registry is None:
        _global_skill_registry = SkillFrontmatterRegistry()
    return _global_skill_registry
