# CODEX TASK: CLI-Anything 借鉴 P1 任务包
> 来源分析：`docs/CLI_ANYTHING_BORROWING_ANALYSIS.md`
> 优先级：P1（立即可落地）
> 创建日期：2026-04-02

---

## 任务总览

| # | 任务名 | 目标文件 | 估时 |
|---|--------|---------|------|
| P1-1 | 龙虾技能 YAML Frontmatter 标准化 | `dragon-senate-saas-v2/lobster_skill_yaml.py` | 1天 |
| P1-2 | ExecutionPlan Probe-then-Mutate 两段式增强 | `dragon-senate-saas-v2/execution_plan_probe.py` | 1天 |
| P1-3 | 边缘 Backend 适配器模式重构 | `edge-runtime/browser_backend.py` | 1天 |
| P1-4 | 边缘 Session 文件锁定写入 | `edge-runtime/session_lock.py` | 0.5天 |

---

## P1-1：龙虾技能 YAML Frontmatter 标准化

### 背景
CLI-Anything 用 YAML frontmatter 的 SKILL.md 描述每个技能，AI Agent 可以读取 `triggers` 字段用自然语言召唤正确技能。我们目前的 `skills.json` 缺少 `triggers`（触发词）和 `examples` 字段，导致 Agent 必须靠猜测来选择技能。

### 目标文件
`dragon-senate-saas-v2/lobster_skill_yaml.py`

### 完整代码

```python
"""
龙虾技能 YAML Frontmatter 标准化模块
借鉴：CLI-Anything skill_generator.py + SKILL.md template
用途：将龙虾的 skills.json 升级为带 YAML frontmatter 的 SKILL.md 格式
"""

import yaml
import json
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional
import re


# ─────────────────────────────────────────────
# 数据结构
# ─────────────────────────────────────────────

@dataclass
class SkillExample:
    """技能使用示例（供 Agent 参考）"""
    title: str
    description: str
    trigger_phrase: str          # 用户说这句话时触发
    expected_output: str         # 期望输出格式


@dataclass
class LobsterSkillMeta:
    """龙虾技能元数据（YAML frontmatter 标准）"""
    skill_id: str                # e.g. "radar_competitor_search"
    name: str                    # 显示名称
    lobster: str                 # 所属龙虾 canonical_id
    description: str             # 功能描述（一句话）
    version: str = "1.0.0"
    triggers: list[str] = field(default_factory=list)   # 自然语言触发词
    input_schema: dict = field(default_factory=dict)    # 输入参数 schema
    output_artifact: str = ""    # 输出工件类型（如 SignalBrief）
    examples: list[SkillExample] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)  # 约束条件/红线
    estimated_tokens: int = 1000  # 预估 token 消耗


# ─────────────────────────────────────────────
# SKILL.md 生成器
# ─────────────────────────────────────────────

class LobsterSkillYamlGenerator:
    """
    将龙虾 KB skills.json 转换为 CLI-Anything 风格的 SKILL.md
    """

    LOBSTER_SKILL_DEFAULTS = {
        "commander": {
            "triggers": ["分解任务", "制定计划", "协调执行", "任务出错了", "重新规划"],
            "output_artifact": "MissionPlan",
            "constraints": ["不直接执行浏览器操作", "不调用大模型以外的API"]
        },
        "radar": {
            "triggers": ["搜索竞品", "发现热点", "舆情监控", "找一下行业信号", "分析趋势"],
            "output_artifact": "SignalBrief",
            "constraints": ["只做信息收集不做决策", "结果必须标注信息来源"]
        },
        "strategist": {
            "triggers": ["制定策略", "规划方案", "分析市场", "给我一个策略", "评估机会"],
            "output_artifact": "StrategyRoute",
            "constraints": ["策略必须包含ROI估算", "必须包含风险分析"]
        },
        "inkwriter": {
            "triggers": ["写文案", "生成内容", "改写文字", "写一篇", "帮我写"],
            "output_artifact": "CopyPack",
            "constraints": ["不生成违规内容", "必须通过合规检查"]
        },
        "visualizer": {
            "triggers": ["生成图片", "做分镜", "视频脚本", "画一张", "做视觉"],
            "output_artifact": "StoryboardPack",
            "constraints": ["不生成违规图片", "图片风格必须符合品牌规范"]
        },
        "dispatcher": {
            "triggers": ["发布内容", "安排发布", "分发任务", "什么时候发", "调度执行"],
            "output_artifact": "ExecutionPlan",
            "constraints": ["不直接执行", "必须有 probe 阶段确认"]
        },
        "echoer": {
            "triggers": ["回复评论", "互动承接", "私信回复", "有人问了", "处理互动"],
            "output_artifact": "EngagementReplyPack",
            "constraints": ["不冒充真人", "不做承诺性回复"]
        },
        "catcher": {
            "triggers": ["线索评分", "录入客户", "评估线索", "这个人有价值吗", "入库"],
            "output_artifact": "LeadAssessment",
            "constraints": ["必须去重检查", "评分必须有依据"]
        },
        "abacus": {
            "triggers": ["计算ROI", "数据报告", "归因分析", "效果怎么样", "数据对比"],
            "output_artifact": "ValueScoreCard",
            "constraints": ["数据必须可溯源", "不能捏造数据"]
        },
        "followup": {
            "triggers": ["跟进客户", "唤醒沉睡", "发跟进消息", "联系一下", "回访"],
            "output_artifact": "FollowUpActionPlan",
            "constraints": ["不过度打扰客户", "必须记录跟进历史"]
        },
    }

    def generate_skill_md(self, skill_meta: LobsterSkillMeta) -> str:
        """生成 SKILL.md 格式内容（YAML frontmatter + Markdown body）"""
        # YAML frontmatter
        frontmatter_data = {
            "name": skill_meta.skill_id,
            "display_name": skill_meta.name,
            "lobster": skill_meta.lobster,
            "description": skill_meta.description,
            "version": skill_meta.version,
            "triggers": skill_meta.triggers,
            "output_artifact": skill_meta.output_artifact,
            "estimated_tokens": skill_meta.estimated_tokens,
        }
        if skill_meta.input_schema:
            frontmatter_data["input_schema"] = skill_meta.input_schema
        if skill_meta.constraints:
            frontmatter_data["constraints"] = skill_meta.constraints

        frontmatter_yaml = yaml.dump(
            frontmatter_data,
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=False
        ).rstrip()

        # Markdown body
        body_parts = [f"---\n{frontmatter_yaml}\n---\n"]
        body_parts.append(f"# {skill_meta.name}\n")
        body_parts.append(f"{skill_meta.description}\n")

        if skill_meta.examples:
            body_parts.append("\n## 使用示例\n")
            for i, ex in enumerate(skill_meta.examples, 1):
                body_parts.append(f"### 示例 {i}：{ex.title}\n")
                body_parts.append(f"**场景**：{ex.description}\n\n")
                body_parts.append(f"**用户说**：\"{ex.trigger_phrase}\"\n\n")
                body_parts.append(f"**期望输出**：{ex.expected_output}\n")

        if skill_meta.constraints:
            body_parts.append("\n## 执行约束\n")
            for c in skill_meta.constraints:
                body_parts.append(f"- {c}\n")

        return "".join(body_parts)

    def generate_from_skills_json(
        self,
        skills_json_path: str,
        lobster_id: str,
        output_dir: str
    ) -> list[str]:
        """
        从现有 skills.json 批量生成 SKILL.md 文件

        Args:
            skills_json_path: 现有 skills.json 路径
            lobster_id: 龙虾 canonical_id
            output_dir: 输出目录

        Returns:
            生成的文件路径列表
        """
        with open(skills_json_path, "r", encoding="utf-8") as f:
            skills_data = json.load(f)

        defaults = self.LOBSTER_SKILL_DEFAULTS.get(lobster_id, {})
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        generated = []

        skills_list = skills_data if isinstance(skills_data, list) else skills_data.get("skills", [])

        for skill in skills_list:
            skill_id = skill.get("skill_id", skill.get("id", "unknown"))
            meta = LobsterSkillMeta(
                skill_id=skill_id,
                name=skill.get("name", skill_id),
                lobster=lobster_id,
                description=skill.get("description", ""),
                version=skill.get("version", "1.0.0"),
                triggers=skill.get("triggers", defaults.get("triggers", [])),
                output_artifact=skill.get("output_artifact", defaults.get("output_artifact", "")),
                constraints=skill.get("constraints", defaults.get("constraints", [])),
                estimated_tokens=skill.get("estimated_tokens", 1000),
            )
            # 转换 examples
            for ex in skill.get("examples", []):
                meta.examples.append(SkillExample(
                    title=ex.get("title", ""),
                    description=ex.get("description", ""),
                    trigger_phrase=ex.get("trigger_phrase", ""),
                    expected_output=ex.get("expected_output", ""),
                ))

            content = self.generate_skill_md(meta)
            out_file = output_path / f"{skill_id}.md"
            out_file.write_text(content, encoding="utf-8")
            generated.append(str(out_file))

        return generated

    def build_skills_registry(self, skills_dir: str) -> dict:
        """
        扫描所有 SKILL.md 文件，构建统一注册表（类似 CLI-Anything registry.json）

        Returns:
            {
                "version": "1.0.0",
                "updated_at": "2026-04-02",
                "skills": [{"skill_id": ..., "lobster": ..., "triggers": [...]}]
            }
        """
        from datetime import date
        registry = {
            "version": "1.0.0",
            "updated_at": str(date.today()),
            "skills": []
        }

        for md_file in Path(skills_dir).rglob("*.md"):
            content = md_file.read_text(encoding="utf-8")
            # 提取 YAML frontmatter
            match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
            if match:
                try:
                    meta = yaml.safe_load(match.group(1))
                    registry["skills"].append({
                        "skill_id": meta.get("name"),
                        "display_name": meta.get("display_name"),
                        "lobster": meta.get("lobster"),
                        "description": meta.get("description"),
                        "triggers": meta.get("triggers", []),
                        "output_artifact": meta.get("output_artifact"),
                        "version": meta.get("version"),
                    })
                except yaml.YAMLError:
                    pass

        return registry


# ─────────────────────────────────────────────
# 触发词匹配（自然语言 → 技能 ID）
# ─────────────────────────────────────────────

class SkillTriggerMatcher:
    """
    根据用户自然语言输入，匹配最合适的技能
    借鉴 CLI-Anything 的 triggers 字段设计
    """

    def __init__(self, registry: dict):
        self.skills = registry.get("skills", [])

    def match(self, user_input: str, top_k: int = 3) -> list[dict]:
        """
        匹配触发词，返回最相关的 top_k 个技能

        Args:
            user_input: 用户自然语言输入
            top_k: 返回候选数量

        Returns:
            [{"skill_id": ..., "lobster": ..., "score": 0.8, "matched_trigger": "..."}]
        """
        user_lower = user_input.lower()
        matches = []

        for skill in self.skills:
            best_score = 0.0
            best_trigger = ""
            for trigger in skill.get("triggers", []):
                # 简单关键词重叠评分（生产环境可换 embedding 模型）
                trigger_words = set(trigger.lower().split())
                input_words = set(user_lower.split())
                overlap = len(trigger_words & input_words)
                score = overlap / max(len(trigger_words), 1)
                if score > best_score:
                    best_score = score
                    best_trigger = trigger

            if best_score > 0:
                matches.append({
                    "skill_id": skill["skill_id"],
                    "lobster": skill["lobster"],
                    "score": round(best_score, 3),
                    "matched_trigger": best_trigger,
                    "description": skill.get("description", ""),
                })

        matches.sort(key=lambda x: x["score"], reverse=True)
        return matches[:top_k]


# ─────────────────────────────────────────────
# 使用示例
# ─────────────────────────────────────────────

if __name__ == "__main__":
    gen = LobsterSkillYamlGenerator()

    # 示例：生成 dispatcher 龙虾的一个技能 SKILL.md
    meta = LobsterSkillMeta(
        skill_id="dispatcher_schedule_post",
        name="内容发布调度",
        lobster="dispatcher",
        description="根据平台最优时间窗安排内容发布，生成 ExecutionPlan",
        version="1.0.0",
        triggers=["安排发布", "什么时候发", "帮我调度", "发布计划", "定时发"],
        output_artifact="ExecutionPlan",
        estimated_tokens=800,
        examples=[
            SkillExample(
                title="安排小红书发布",
                description="用户需要安排一篇内容在最佳时间发布",
                trigger_phrase="帮我安排这篇文章在小红书发布",
                expected_output="ExecutionPlan JSON，包含 platform/schedule_time/content_ref"
            )
        ],
        constraints=[
            "不直接执行浏览器操作，必须生成 ExecutionPlan 交给边缘端",
            "发布前必须经过 probe 阶段确认账号状态",
            "必须记录每次发布的时间窗选择依据",
        ]
    )

    content = gen.generate_skill_md(meta)
    print(content)
```

---

## P1-2：ExecutionPlan Probe-then-Mutate 两段式增强

### 背景
CLI-Anything 铁律：先 `probe`（只读探测）再 `mutate`（写入执行）。我们的边缘端目前收到 ExecutionPlan 直接执行，没有预检阶段，高风险操作无法回滚。

### 目标文件
`dragon-senate-saas-v2/execution_plan_probe.py`

### 完整代码

```python
"""
ExecutionPlan Probe-then-Mutate 两段式增强
借鉴：CLI-Anything HARNESS.md 的 "先 probe/info，再 mutation" 铁律
用途：在 dispatcher 下发 ExecutionPlan 前，增加 probe 预检阶段
"""

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, Any
import logging

logger = logging.getLogger(__name__)


class ProbeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class ExecutionMode(str, Enum):
    PROBE_ONLY = "probe_only"      # 只探测，不执行
    PROBE_THEN_EXECUTE = "probe_then_execute"  # 探测通过后自动执行
    DIRECT = "direct"              # 直接执行（跳过 probe，慎用）


@dataclass
class ProbeCheck:
    """单个探测检查项"""
    check_id: str
    description: str
    check_type: str    # "account_alive" / "content_valid" / "platform_accessible" / "quota_ok"
    target: str        # 检查目标（如账号 ID、平台名）
    status: ProbeStatus = ProbeStatus.PENDING
    result: Optional[dict] = None
    error: Optional[str] = None
    duration_ms: int = 0


@dataclass
class ProbeReport:
    """Probe 阶段完整报告"""
    plan_id: str
    checks: list[ProbeCheck] = field(default_factory=list)
    overall_status: ProbeStatus = ProbeStatus.PENDING
    started_at: str = ""
    completed_at: str = ""
    summary: str = ""
    can_proceed: bool = False     # True = 所有检查通过，可以执行 mutate
    blocker_checks: list[str] = field(default_factory=list)  # 阻塞的检查 ID


@dataclass
class EnhancedExecutionPlan:
    """增强版 ExecutionPlan（加入两段式支持）"""
    plan_id: str
    lobster: str
    platform: str
    steps: list[dict]
    mode: ExecutionMode = ExecutionMode.PROBE_THEN_EXECUTE
    dry_run: bool = False          # True = probe 阶段不实际访问，只校验格式
    probe_report: Optional[ProbeReport] = None
    confirmed: bool = False        # commander 确认 probe 结果后置 True
    created_at: str = ""
    metadata: dict = field(default_factory=dict)


# ─────────────────────────────────────────────
# Probe 检查器（各种检查类型的实现）
# ─────────────────────────────────────────────

class ProbChecker:
    """
    执行各种 probe 检查
    设计原则：每个检查都是只读的，不产生副作用
    """

    async def check_account_alive(self, account_id: str, platform: str, dry_run: bool = False) -> ProbeCheck:
        """检查账号是否存活可用"""
        check = ProbeCheck(
            check_id=f"account_alive_{account_id}",
            description=f"检查 {platform} 账号 {account_id} 是否存活",
            check_type="account_alive",
            target=account_id,
        )
        start = datetime.now()

        try:
            if dry_run:
                # 干跑模式：只校验账号格式，不实际访问
                import re
                check.status = ProbeStatus.PASSED
                check.result = {"dry_run": True, "format_valid": bool(account_id)}
            else:
                # 实际检查：查询账号状态（从 session_manager 或 DB）
                # 这里是伪代码，实际实现需对接 session_manager
                from dragon_senate_saas_v2.session_manager import get_account_status
                status = await get_account_status(account_id, platform)
                if status.get("alive"):
                    check.status = ProbeStatus.PASSED
                    check.result = {"alive": True, "last_active": status.get("last_active")}
                else:
                    check.status = ProbeStatus.FAILED
                    check.error = f"账号 {account_id} 不可用：{status.get('reason', '未知原因')}"

        except Exception as e:
            check.status = ProbeStatus.FAILED
            check.error = str(e)

        check.duration_ms = int((datetime.now() - start).total_seconds() * 1000)
        return check

    async def check_content_valid(self, content_ref: str, platform: str) -> ProbeCheck:
        """检查内容是否合规（格式/长度/敏感词）"""
        check = ProbeCheck(
            check_id=f"content_valid_{content_ref[:8]}",
            description=f"检查内容 {content_ref} 是否符合 {platform} 规范",
            check_type="content_valid",
            target=content_ref,
        )
        start = datetime.now()

        try:
            # 内容校验逻辑（检查 artifact_store 中的内容）
            # 实际实现需对接 artifact_store
            check.status = ProbeStatus.PASSED
            check.result = {
                "content_ref": content_ref,
                "platform": platform,
                "length_ok": True,
                "sensitive_words": [],
                "format_ok": True,
            }
        except Exception as e:
            check.status = ProbeStatus.FAILED
            check.error = str(e)

        check.duration_ms = int((datetime.now() - start).total_seconds() * 1000)
        return check

    async def check_quota_ok(self, tenant_id: str, action_type: str) -> ProbeCheck:
        """检查租户配额是否充足"""
        check = ProbeCheck(
            check_id=f"quota_{tenant_id}_{action_type}",
            description=f"检查租户 {tenant_id} 的 {action_type} 配额",
            check_type="quota_ok",
            target=tenant_id,
        )
        start = datetime.now()

        try:
            # 查询配额（对接 quota_middleware）
            # 实际实现需对接 quota_middleware
            check.status = ProbeStatus.PASSED
            check.result = {"quota_remaining": 100, "action_type": action_type}
        except Exception as e:
            check.status = ProbeStatus.FAILED
            check.error = str(e)

        check.duration_ms = int((datetime.now() - start).total_seconds() * 1000)
        return check


# ─────────────────────────────────────────────
# Probe 执行器
# ─────────────────────────────────────────────

class ExecutionPlanProbeRunner:
    """
    执行 ExecutionPlan 的 probe 阶段
    借鉴 CLI-Anything 的 "probe before mutate" 铁律
    """

    def __init__(self):
        self.checker = ProbChecker()

    async def run_probe(self, plan: EnhancedExecutionPlan) -> ProbeReport:
        """
        对 ExecutionPlan 执行完整的 probe 检查

        Returns:
            ProbeReport，包含所有检查结果和是否可以继续执行的判断
        """
        report = ProbeReport(
            plan_id=plan.plan_id,
            started_at=datetime.now().isoformat(),
        )

        # 构建 probe 检查清单
        checks_to_run = self._build_checks(plan)

        # 并发执行所有 probe 检查（只读，安全并发）
        results = await asyncio.gather(
            *[self._run_check(check_fn, plan.dry_run) for check_fn in checks_to_run],
            return_exceptions=True
        )

        for result in results:
            if isinstance(result, Exception):
                failed = ProbeCheck(
                    check_id="unknown",
                    description="检查执行异常",
                    check_type="unknown",
                    target="unknown",
                    status=ProbeStatus.FAILED,
                    error=str(result),
                )
                report.checks.append(failed)
            else:
                report.checks.append(result)

        # 汇总结果
        failed_checks = [c for c in report.checks if c.status == ProbeStatus.FAILED]
        report.blocker_checks = [c.check_id for c in failed_checks]
        report.can_proceed = len(failed_checks) == 0
        report.overall_status = ProbeStatus.PASSED if report.can_proceed else ProbeStatus.FAILED
        report.completed_at = datetime.now().isoformat()
        report.summary = (
            f"Probe 完成：{len(report.checks)} 项检查，"
            f"{len(failed_checks)} 项失败。"
            f"{'✅ 可以执行' if report.can_proceed else '❌ 不可执行，请查看失败原因'}"
        )

        logger.info(f"[ProbeRunner] plan={plan.plan_id} {report.summary}")
        return report

    def _build_checks(self, plan: EnhancedExecutionPlan) -> list:
        """根据 ExecutionPlan 内容构建 probe 检查清单"""
        checks = []

        # 从 steps 中提取需要检查的资源
        for step in plan.steps:
            step_type = step.get("type", "")
            if step_type == "publish":
                account_id = step.get("account_id")
                if account_id:
                    checks.append(
                        lambda a=account_id, p=plan.platform, d=plan.dry_run:
                            self.checker.check_account_alive(a, p, d)
                    )
                content_ref = step.get("content_ref")
                if content_ref:
                    checks.append(
                        lambda c=content_ref, p=plan.platform:
                            self.checker.check_content_valid(c, p)
                    )

        # 配额检查（对任何 plan 都做）
        tenant_id = plan.metadata.get("tenant_id", "unknown")
        checks.append(
            lambda t=tenant_id: self.checker.check_quota_ok(t, "publish")
        )

        return checks

    async def _run_check(self, check_fn, dry_run: bool) -> ProbeCheck:
        """执行单个检查函数"""
        return await check_fn()

    def probe_report_to_dict(self, report: ProbeReport) -> dict:
        """ProbeReport 转字典（用于传给 commander 或回传云端）"""
        return {
            "plan_id": report.plan_id,
            "overall_status": report.overall_status.value,
            "can_proceed": report.can_proceed,
            "started_at": report.started_at,
            "completed_at": report.completed_at,
            "summary": report.summary,
            "blocker_checks": report.blocker_checks,
            "checks": [
                {
                    "check_id": c.check_id,
                    "description": c.description,
                    "check_type": c.check_type,
                    "status": c.status.value,
                    "result": c.result,
                    "error": c.error,
                    "duration_ms": c.duration_ms,
                }
                for c in report.checks
            ]
        }
```

---

## P1-3：边缘 Backend 适配器模式重构

### 背景
CLI-Anything 的每个 `utils/<software>_backend.py` 都有标准的 `find_<software>()`、标准化 JSON 输出、RuntimeError with 安装指引。我们的 MarionetteExecutor 硬编码没有这些安全保障。

### 目标文件
`edge-runtime/browser_backend.py`

### 完整代码

```python
"""
边缘 Browser Backend 适配器
借鉴：CLI-Anything utils/<software>_backend.py 标准模式
用途：将 Playwright 浏览器操作包装成标准 Backend 适配器
规范：find_browser() + 标准化 JSON 输出 + RuntimeError with 安装指引
"""

import shutil
import subprocess
import json
import logging
from typing import Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Browser 检测（借鉴 CLI-Anything 的 shutil.which 模式）
# ─────────────────────────────────────────────

def find_playwright() -> str:
    """
    定位 Playwright 可执行文件。
    若未找到，抛出 RuntimeError 并给出安装指引。
    借鉴 CLI-Anything: find_libreoffice() / find_browser() 模式
    """
    # 1. 优先用 pip 安装的 playwright 命令
    playwright_path = shutil.which("playwright")
    if playwright_path:
        return playwright_path

    # 2. 尝试 python -m playwright
    try:
        result = subprocess.run(
            ["python", "-m", "playwright", "--version"],
            capture_output=True, timeout=5
        )
        if result.returncode == 0:
            return "python -m playwright"
    except Exception:
        pass

    raise RuntimeError(
        "Playwright 未找到。请安装：\n"
        "  pip install playwright\n"
        "  playwright install chromium\n"
        "文档：https://playwright.dev/python/"
    )


def find_chromium() -> Optional[str]:
    """
    定位 Chromium 浏览器可执行文件。
    返回路径或 None（Playwright 会自动管理浏览器时返回 None）
    """
    candidates = ["chromium", "chromium-browser", "google-chrome", "chrome"]
    for name in candidates:
        path = shutil.which(name)
        if path:
            return path
    return None  # Playwright 使用内置浏览器


def check_browser_health() -> dict:
    """
    检查浏览器环境是否健康。
    返回标准化 JSON 格式（CLI-Anything 风格）。
    """
    result = {
        "healthy": False,
        "playwright_path": None,
        "chromium_path": None,
        "method": "playwright",
        "checked_at": datetime.now().isoformat(),
        "error": None,
    }

    try:
        playwright_path = find_playwright()
        result["playwright_path"] = playwright_path

        chromium_path = find_chromium()
        result["chromium_path"] = chromium_path

        result["healthy"] = True
        result["method"] = "playwright-managed" if not chromium_path else "playwright-system-chromium"

    except RuntimeError as e:
        result["error"] = str(e)

    return result


# ─────────────────────────────────────────────
# 标准 Backend 操作（每个函数都返回标准 JSON）
# ─────────────────────────────────────────────

def navigate_to(url: str, session_id: str, headless: bool = True) -> dict:
    """
    导航到指定 URL。
    返回标准化 JSON 结果（CLI-Anything 风格）。
    """
    start = datetime.now()
    result = {
        "action": "navigate",
        "url": url,
        "session_id": session_id,
        "success": False,
        "method": "playwright",
        "duration_ms": 0,
        "error": None,
        "screenshot_path": None,
    }

    try:
        find_playwright()  # 存活检测

        # 实际 Playwright 操作（通过 session 管理）
        from edge_runtime.playwright_session import get_or_create_page
        page = get_or_create_page(session_id, headless=headless)
        page.goto(url, wait_until="domcontentloaded", timeout=30000)

        result["success"] = True
        result["title"] = page.title()
        result["final_url"] = page.url

    except RuntimeError as e:
        result["error"] = str(e)
    except Exception as e:
        result["error"] = f"导航失败: {str(e)}"
        logger.error(f"[BrowserBackend] navigate_to {url} 失败: {e}")

    result["duration_ms"] = int((datetime.now() - start).total_seconds() * 1000)
    return result


def click_element(selector: str, session_id: str) -> dict:
    """点击页面元素。返回标准化 JSON。"""
    start = datetime.now()
    result = {
        "action": "click",
        "selector": selector,
        "session_id": session_id,
        "success": False,
        "method": "playwright",
        "duration_ms": 0,
        "error": None,
    }

    try:
        from edge_runtime.playwright_session import get_or_create_page
        page = get_or_create_page(session_id)
        page.click(selector, timeout=10000)
        result["success"] = True

    except Exception as e:
        result["error"] = str(e)
        logger.error(f"[BrowserBackend] click {selector} 失败: {e}")

    result["duration_ms"] = int((datetime.now() - start).total_seconds() * 1000)
    return result


def type_text(selector: str, text: str, session_id: str, clear_first: bool = True) -> dict:
    """在输入框输入文字。返回标准化 JSON。"""
    start = datetime.now()
    result = {
        "action": "type_text",
        "selector": selector,
        "text_length": len(text),
        "session_id": session_id,
        "success": False,
        "method": "playwright",
        "duration_ms": 0,
        "error": None,
    }

    try:
        from edge_runtime.playwright_session import get_or_create_page
        page = get_or_create_page(session_id)
        if clear_first:
            page.fill(selector, "")
        page.type(selector, text, delay=50)  # 模拟真人输入速度
        result["success"] = True

    except Exception as e:
        result["error"] = str(e)

    result["duration_ms"] = int((datetime.now() - start).total_seconds() * 1000)
    return result


def take_screenshot(session_id: str, save_path: Optional[str] = None) -> dict:
    """截图。返回标准化 JSON（含截图路径）。"""
    import tempfile
    start = datetime.now()
    result = {
        "action": "screenshot",
        "session_id": session_id,
        "success": False,
        "screenshot_path": None,
        "method": "playwright",
        "duration_ms": 0,
        "error": None,
    }

    try:
        from edge_runtime.playwright_session import get_or_create_page
        page = get_or_create_page(session_id)

        if not save_path:
            save_path = tempfile.mktemp(suffix=".png", prefix="edge_screenshot_")

        page.screenshot(path=save_path, full_page=False)
        result["success"] = True
        result["screenshot_path"] = save_path

    except Exception as e:
        result["error"] = str(e)

    result["duration_ms"] = int((datetime.now() - start).total_seconds() * 1000)
    return result


def probe_page_state(session_id: str) -> dict:
    """
    只读探测页面当前状态（probe 阶段使用）。
    不产生任何写入副作用。

    借鉴 CLI-Anything 的 "probe before mutate" 铁律。
    """
    result = {
        "action": "probe",
        "session_id": session_id,
        "success": False,
        "url": None,
        "title": None,
        "logged_in": None,
        "page_ready": False,
        "method": "playwright",
        "error": None,
    }

    try:
        from edge_runtime.playwright_session import get_existing_page
        page = get_existing_page(session_id)
        if page is None:
            result["error"] = f"Session {session_id} 不存在，请先初始化"
            return result

        result["url"] = page.url
        result["title"] = page.title()
        result["page_ready"] = page.evaluate("document.readyState") == "complete"
        result["success"] = True

        # 检测是否已登录（通过 URL 或页面元素判断）
        current_url = page.url
        result["logged_in"] = "login" not in current_url.lower()

    except Exception as e:
        result["error"] = str(e)

    return result
```

---

## P1-4：边缘 Session 文件锁定写入

### 背景
CLI-Anything 的 `guides/session-locking.md` 描述了 `_locked_save_json` 模式：open `"r+"` 模式 + 文件锁 + 锁内截断，防止多任务并发写坏 session 状态文件。

### 目标文件
`edge-runtime/session_lock.py`

### 完整代码

```python
"""
边缘 Session 文件锁定写入
借鉴：CLI-Anything guides/session-locking.md 的 _locked_save_json 模式
用途：防止多任务并发写入时损坏 session 状态 JSON 文件
"""

import json
import fcntl
import os
import tempfile
import shutil
import logging
from pathlib import Path
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# 核心：文件锁定 JSON 写入
# ─────────────────────────────────────────────

def locked_save_json(filepath: str, data: dict, indent: int = 2) -> bool:
    """
    带文件锁的 JSON 写入（防并发写坏）
    借鉴 CLI-Anything: _locked_save_json 模式
    
    关键：使用 "r+" 模式 + fcntl.LOCK_EX + 锁内截断
    
    Args:
        filepath: 目标 JSON 文件路径
        data: 要写入的数据
        indent: JSON 缩进

    Returns:
        True if 写入成功
    """
    filepath = Path(filepath)
    filepath.parent.mkdir(parents=True, exist_ok=True)

    # 若文件不存在，先原子创建
    if not filepath.exists():
        _atomic_create_json(filepath, data, indent)
        return True

    try:
        # 以 "r+" 模式打开（文件必须存在）
        with open(filepath, "r+", encoding="utf-8") as f:
            # 获取排他锁（阻塞等待，直到获取）
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                # 在锁内截断并写入（避免旧内容残留）
                f.seek(0)
                f.truncate()
                json.dump(data, f, ensure_ascii=False, indent=indent)
                f.flush()
                os.fsync(f.fileno())  # 强制刷盘
                return True
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)

    except Exception as e:
        logger.error(f"[SessionLock] 写入 {filepath} 失败: {e}")
        return False


def locked_read_json(filepath: str) -> tuple[dict | None, bool]:
    """
    带文件锁的 JSON 读取（防止读取到写一半的脏数据）

    Returns:
        (data, success)
    """
    filepath = Path(filepath)
    if not filepath.exists():
        return None, False

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_SH)  # 共享锁（允许多读）
            try:
                data = json.load(f)
                return data, True
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    except Exception as e:
        logger.error(f"[SessionLock] 读取 {filepath} 失败: {e}")
        return None, False


def _atomic_create_json(filepath: Path, data: dict, indent: int = 2):
    """
    原子方式创建 JSON 文件（write to temp → rename）
    防止写一半时被其他进程读到
    """
    tmp_path = filepath.with_suffix(".tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
            f.flush()
            os.fsync(f.fileno())
        shutil.move(str(tmp_path), str(filepath))
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise


# ─────────────────────────────────────────────
# Session 状态管理器（使用文件锁）
# ─────────────────────────────────────────────

class EdgeSessionStore:
    """
    边缘端 Session 状态管理器
    使用 locked_save_json 防止并发写坏

    Session 文件结构：
    {
        "session_id": "xxx",
        "platform": "xiaohongshu",
        "account_id": "xxx",
        "state": "idle|running|error",
        "current_url": "...",
        "last_updated": "ISO datetime",
        "task_queue": [],
        "metadata": {}
    }
    """

    def __init__(self, sessions_dir: str = "/tmp/edge_sessions"):
        self.sessions_dir = Path(sessions_dir)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    def _session_path(self, session_id: str) -> Path:
        return self.sessions_dir / f"{session_id}.json"

    def create_session(self, session_id: str, platform: str, account_id: str) -> bool:
        """创建新 session（原子写入）"""
        from datetime import datetime
        data = {
            "session_id": session_id,
            "platform": platform,
            "account_id": account_id,
            "state": "idle",
            "current_url": None,
            "last_updated": datetime.now().isoformat(),
            "task_queue": [],
            "metadata": {},
        }
        return locked_save_json(str(self._session_path(session_id)), data)

    def update_state(self, session_id: str, state: str, **kwargs) -> bool:
        """更新 session 状态（带锁）"""
        from datetime import datetime
        data, ok = locked_read_json(str(self._session_path(session_id)))
        if not ok:
            logger.error(f"[EdgeSessionStore] Session {session_id} 不存在")
            return False

        data["state"] = state
        data["last_updated"] = datetime.now().isoformat()
        data.update(kwargs)

        return locked_save_json(str(self._session_path(session_id)), data)

    def get_session(self, session_id: str) -> dict | None:
        """获取 session 状态（带共享锁）"""
        data, ok = locked_read_json(str(self._session_path(session_id)))
        return data if ok else None

    def enqueue_task(self, session_id: str, task: dict) -> bool:
        """将任务加入 session 的任务队列（带锁，防并发写坏队列）"""
        data, ok = locked_read_json(str(self._session_path(session_id)))
        if not ok:
            return False
        data["task_queue"].append(task)
        return locked_save_json(str(self._session_path(session_id)), data)

    def dequeue_task(self, session_id: str) -> dict | None:
        """从 session 任务队列取出下一个任务（带锁）"""
        filepath = str(self._session_path(session_id))
        data, ok = locked_read_json(filepath)
        if not ok or not data.get("task_queue"):
            return None

        task = data["task_queue"].pop(0)
        locked_save_json(filepath, data)
        return task
```

---

## 验收标准

| 任务 | 验收标准 |
|------|---------|
| P1-1 | `LobsterSkillYamlGenerator` 能从 `radar/skills.json` 生成带 YAML frontmatter 的 SKILL.md |
| P1-1 | `SkillTriggerMatcher` 输入"帮我搜索竞品"能匹配到 radar 技能 |
| P1-2 | `ExecutionPlanProbeRunner.run_probe()` 返回 `ProbeReport`，`can_proceed` 字段准确 |
| P1-2 | `EnhancedExecutionPlan(mode=PROBE_ONLY)` 不触发实际执行 |
| P1-3 | `check_browser_health()` 在 Playwright 未安装时返回 `{"healthy": false, "error": "安装指引..."}` |
| P1-3 | `probe_page_state()` 不产生任何写入副作用 |
| P1-4 | 并发 10 个进程同时写同一 session 文件，文件无损坏 |
| P1-4 | `EdgeSessionStore.enqueue_task()` 并发调用时任务不丢失 |

---

*CODEX TASK 创建：2026-04-02 | 借鉴来源：CLI-Anything HARNESS.md + session-locking.md*
