"""
龙虾 IM 渠道模块
Dragon Senate — Lobster IM Channel (飞书 + 微信)

核心设计：
  每个龙虾拥有独立的飞书/微信账号身份
  客户购买服务后，Commander 自动创建三类群：
    群1：龙虾全员客户群（核心群，客户可见）
    群2：龙虾内部工作群（仅龙虾）
    群3：按需1v1快线群（高频协作用）

  客户在群里的消息通过智能路由分发给对应龙虾
  龙虾的回复、汇报、预警全部通过群聊呈现
  客户的反馈自动写入企业记忆库（永久有效）
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable

from lobster_auto_responder import should_respond


# ─────────────────────────────────────────
# 龙虾 IM 身份配置
# ─────────────────────────────────────────

LOBSTER_IM_IDENTITY: dict[str, dict] = {
    "commander": {
        "canonical_id": "commander",
        "display_name_feishu": "陈指挥 🐉",
        "display_name_wechat": "陈指挥-龙门参谋",
        "avatar_emoji": "🐉",
        "group_role": "群主",
        "response_scenarios": [
            "任务分发和协调",
            "客户@Commander 的紧急情况",
            "周计划/月计划发布",
            "客户投诉和不满处理",
            "没有明确@任何龙虾的问题（先接再转）",
        ],
        "auto_daily_report": True,
        "report_time": "09:00",
    },
    "strategist": {
        "canonical_id": "strategist",
        "display_name_feishu": "苏思 🧠",
        "display_name_wechat": "苏思-策略",
        "avatar_emoji": "🧠",
        "group_role": "策略顾问",
        "response_scenarios": [
            "客户质疑策略方向",
            "内容评判和选版本",
            "活动方案设计讨论",
            "行业趋势解读",
            "客户问'我们下一步该怎么做'",
        ],
        "auto_daily_report": False,
    },
    "radar": {
        "canonical_id": "radar",
        "display_name_feishu": "琳涛 📡",
        "display_name_wechat": "琳涛-情报",
        "avatar_emoji": "📡",
        "group_role": "情报播报",
        "response_scenarios": [
            "客户问热点/竞品动态",
            "平台算法变化通报",
            "每周热点简报发布",
        ],
        "auto_daily_report": True,
        "report_time": "08:30",
        "report_content": "每周热点简报（行业热词+竞品动态+平台机会窗口）",
    },
    "inkwriter": {
        "canonical_id": "inkwriter",
        "display_name_feishu": "墨小雅 ✍️",
        "display_name_wechat": "墨小雅-文案",
        "avatar_emoji": "✍️",
        "group_role": "文案提交",
        "response_scenarios": [
            "客户要求修改文案",
            "客户问某条内容的钩子设计",
            "提交新文案草稿供审核",
        ],
        "auto_daily_report": False,
    },
    "visualizer": {
        "canonical_id": "visualizer",
        "display_name_feishu": "影子 🎨",
        "display_name_wechat": "影子-视觉",
        "avatar_emoji": "🎨",
        "group_role": "视觉提交",
        "response_scenarios": [
            "客户要求修改封面/分镜",
            "视觉风格讨论",
            "提交新视觉方案",
        ],
        "auto_daily_report": False,
    },
    "dispatcher": {
        "canonical_id": "dispatcher",
        "display_name_feishu": "老坚 📤",
        "display_name_wechat": "老坚-发布",
        "avatar_emoji": "📤",
        "group_role": "发布汇报",
        "response_scenarios": [
            "客户问今天发什么",
            "账号健康状态查询",
            "发布时间调整申请",
        ],
        "auto_daily_report": True,
        "report_time": "09:00",
        "report_content": "今日发布计划 + 账号健康状态",
    },
    "echoer": {
        "canonical_id": "echoer",
        "display_name_feishu": "阿声 💬",
        "display_name_wechat": "阿声-互动",
        "avatar_emoji": "💬",
        "group_role": "互动汇报",
        "response_scenarios": [
            "评论区有人问地址/价格",
            "发现高意向评论",
            "客户问互动数据",
        ],
        "auto_daily_report": True,
        "report_time": "21:00",
        "report_content": "今日评论区高意向信号汇总",
    },
    "catcher": {
        "canonical_id": "catcher",
        "display_name_feishu": "铁狗 🎯",
        "display_name_wechat": "铁狗-获客",
        "avatar_emoji": "🎯",
        "group_role": "线索汇报",
        "response_scenarios": [
            "客户问今天有几条线索",
            "新增高意向线索通报",
            "线索质量分析",
        ],
        "auto_daily_report": True,
        "report_time": "18:00",
        "report_content": "今日新增线索数量 + 热线索列表（脱敏）",
    },
    "followup": {
        "canonical_id": "followup",
        "display_name_feishu": "小追 📞",
        "display_name_wechat": "小追-跟进",
        "avatar_emoji": "📞",
        "group_role": "跟进汇报",
        "response_scenarios": [
            "客户问成交进展",
            "某条线索超期未跟进预警",
            "跟进话术建议",
        ],
        "auto_daily_report": True,
        "report_time": "17:00",
        "report_content": "今日跟进情况 + 预计本周成交线索",
    },
    "abacus": {
        "canonical_id": "abacus",
        "display_name_feishu": "算无遗策 📊",
        "display_name_wechat": "算无遗策-数据",
        "avatar_emoji": "📊",
        "group_role": "数据播报",
        "response_scenarios": [
            "异常数据预警（完播率暴跌/线索断层）",
            "客户问效果如何",
            "周报/月报发布",
        ],
        "auto_daily_report": True,
        "report_time": "10:00",  # 周一发周报
        "report_content": "数据周报 / 异常预警（实时触发）",
    },
}


# ─────────────────────────────────────────
# 群组类型定义
# ─────────────────────────────────────────

class GroupType(str, Enum):
    MAIN_CLIENT = "龙虾全员客户群"      # 核心群，所有龙虾+客户
    INTERNAL = "龙虾内部工作群"         # 仅龙虾，无客户
    DIRECT_LINE = "1v1快线群"          # 某只虾+客户部分成员


class IMPlatform(str, Enum):
    FEISHU = "飞书"
    WECHAT = "微信"
    BOTH = "飞书+微信"


@dataclass
class LobsterGroup:
    """龙虾群组配置"""
    group_id: str
    tenant_id: str
    group_type: str
    platform: str
    group_name: str
    member_lobsters: list[str]        # 参与的龙虾 canonical_id 列表
    member_clients: list[str]         # 客户成员（飞书/微信账号）
    group_owner: str = "commander"    # 群主默认是 Commander
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    is_active: bool = True


# ─────────────────────────────────────────
# 消息路由规则
# ─────────────────────────────────────────

# 关键词 → 负责龙虾的映射
MESSAGE_ROUTING_RULES: list[dict] = [
    # 文案相关
    {"keywords": ["文案", "改一下", "这条写得", "标题", "钩子", "文字"], "route_to": "inkwriter", "priority": 2},
    # 视觉相关
    {"keywords": ["封面", "分镜", "视觉", "图片", "配色", "设计感"], "route_to": "visualizer", "priority": 2},
    # 策略相关
    {"keywords": ["策略", "方向", "为什么这样", "下一步", "该怎么做", "活动方案"], "route_to": "strategist", "priority": 3},
    # 情报相关
    {"keywords": ["热点", "竞品", "同行", "现在流行", "算法", "平台政策"], "route_to": "radar", "priority": 2},
    # 发布相关
    {"keywords": ["发布", "几点发", "今天发什么", "账号", "健康状态"], "route_to": "dispatcher", "priority": 2},
    # 互动相关
    {"keywords": ["评论", "留言", "有人问", "回复了", "互动"], "route_to": "echoer", "priority": 2},
    # 线索相关
    {"keywords": ["线索", "意向", "几个客户", "私信来了", "有人要来"], "route_to": "catcher", "priority": 2},
    # 跟进相关
    {"keywords": ["跟进", "成交", "那个客户怎么样", "有没有到店"], "route_to": "followup", "priority": 2},
    # 数据相关
    {"keywords": ["数据", "效果", "完播率", "播放量", "涨粉", "报表", "周报", "月报"], "route_to": "abacus", "priority": 2},
    # 紧急/投诉 → Commander 优先接
    {"keywords": ["紧急", "出问题了", "不满意", "退款", "投诉", "太慢了"], "route_to": "commander", "priority": 5},
    # 默认 → Commander 接
    {"keywords": [], "route_to": "commander", "priority": 0},  # fallback
]


def route_message(message_text: str) -> str:
    """
    根据消息内容，路由到对应龙虾
    返回 canonical_id
    """
    # 检查 @提及
    for lobster_id, config in LOBSTER_IM_IDENTITY.items():
        name = config["display_name_feishu"].replace(" " + config["avatar_emoji"], "")
        if f"@{name}" in message_text or f"@{lobster_id}" in message_text.lower():
            return lobster_id

    # 关键词匹配（按优先级排序）
    matched = []
    for rule in MESSAGE_ROUTING_RULES:
        if rule["keywords"] and any(kw in message_text for kw in rule["keywords"]):
            matched.append((rule["priority"], rule["route_to"]))

    if matched:
        matched.sort(key=lambda x: -x[0])
        return matched[0][1]

    return "commander"  # 默认由 Commander 接


# ─────────────────────────────────────────
# 客户反馈自动记忆写入
# ─────────────────────────────────────────

# 触发记忆写入的关键句式
MEMORY_TRIGGER_PATTERNS: list[dict] = [
    {
        "pattern": ["效果最好", "反响最好", "客户喜欢", "点赞最多"],
        "memory_key": "best_content_feedback",
        "category": "customer_preference",
        "expires_days": -1,
    },
    {
        "pattern": ["下次不要", "这种不行", "客户反映不好", "不喜欢"],
        "memory_key": "negative_content_feedback",
        "category": "customer_preference",
        "expires_days": -1,
    },
    {
        "pattern": ["竞争对手", "对面那家", "同行"],
        "memory_key": "competitor_mention",
        "category": "competitor",
        "expires_days": 30,
    },
    {
        "pattern": ["预算", "这个月只有", "不能超过"],
        "memory_key": "budget_constraint",
        "category": "customer_preference",
        "expires_days": 90,
    },
    {
        "pattern": ["那次活动", "上次做的", "之前的效果"],
        "memory_key": "historical_campaign_reference",
        "category": "campaign_result",
        "expires_days": -1,
    },
]


def extract_memory_from_message(
    tenant_id: str,
    message_text: str,
    sender: str,
    timestamp: str,
) -> list[dict]:
    """
    从客户群消息中提取值得沉淀的记忆条目
    返回需要写入企业记忆库的条目列表
    """
    memories_to_write = []
    for pattern_config in MEMORY_TRIGGER_PATTERNS:
        if any(p in message_text for p in pattern_config["pattern"]):
            memories_to_write.append({
                "tenant_id": tenant_id,
                "key": f"{pattern_config['memory_key']}_{timestamp[:10]}",
                "value": {
                    "raw_message": message_text,
                    "sender": sender,
                    "timestamp": timestamp,
                },
                "category": pattern_config["category"],
                "expires_days": pattern_config["expires_days"],
            })
    return memories_to_write


# ─────────────────────────────────────────
# 自动播报模板
# ─────────────────────────────────────────

class AutoReportTemplates:
    """各龙虾的自动播报消息模板"""

    @staticmethod
    def dispatcher_morning_report(
        enterprise_name: str,
        today_plan: list[dict],
        account_health: dict,
    ) -> str:
        """老坚每日早报"""
        plan_lines = "\n".join([
            f"  - {p.get('time', '')} @{p.get('platform', '')} 发布《{p.get('title', '')}》"
            for p in today_plan
        ])
        health_icons = {
            "绿色": "🟢", "黄色": "🟡", "橙色": "🟠", "红色": "🔴",
        }
        health_lines = "\n".join([
            f"  {health_icons.get(v, '⚪')} {k}"
            for k, v in account_health.items()
        ])
        return (
            f"早！{enterprise_name}今日发布计划 📤\n"
            f"{plan_lines}\n\n"
            f"账号健康状态：\n"
            f"{health_lines}\n\n"
            f"有问题随时@我 💪"
        )

    @staticmethod
    def abacus_anomaly_alert(
        enterprise_name: str,
        metric_name: str,
        current_value: float,
        historical_avg: float,
        content_title: str,
        possible_reasons: list[str],
        suggested_action: str,
    ) -> str:
        """算无遗策异常预警"""
        drop_pct = int((1 - current_value / historical_avg) * 100) if historical_avg else 0
        reasons = "\n".join([f"  - {r}" for r in possible_reasons])
        return (
            f"⚠️ 数据异常预警 | {enterprise_name}\n\n"
            f"《{content_title}》的 {metric_name} 出现异常：\n"
            f"  当前值：{current_value:.1%}（历史均值 {historical_avg:.1%}，下跌 {drop_pct}%）\n\n"
            f"可能原因：\n{reasons}\n\n"
            f"建议动作：{suggested_action}"
        )

    @staticmethod
    def echoer_intent_alert(
        enterprise_name: str,
        platform: str,
        content_title: str,
        intent_comments: list[dict],
    ) -> str:
        """阿声高意向评论预警"""
        comment_lines = "\n".join([
            f"  [{c.get('user', '用户')}] \"{c.get('text', '')}\""
            for c in intent_comments[:3]
        ])
        return (
            f"💬 高意向信号 | {enterprise_name}\n\n"
            f"@{platform} 《{content_title}》评论区发现 {len(intent_comments)} 条高意向评论：\n"
            f"{comment_lines}\n\n"
            f"铁狗已开始评分，小追准备承接 🎯"
        )

    @staticmethod
    def commander_weekly_plan(
        enterprise_name: str,
        week_range: str,
        strategy_focus: str,
        primary_lobsters: list[str],
        content_plan: list[dict],
        kpi_targets: dict,
    ) -> str:
        """Commander 周计划"""
        lobster_names = "、".join([
            LOBSTER_IM_IDENTITY.get(l, {}).get("display_name_feishu", l)
            for l in primary_lobsters
        ])
        content_lines = "\n".join([
            f"  - {c.get('day', '')}：{c.get('content', '')}"
            for c in content_plan
        ])
        kpi_lines = "\n".join([f"  - {k}：{v}" for k, v in kpi_targets.items()])
        return (
            f"🐉 本周作战计划 | {enterprise_name}\n"
            f"周期：{week_range}\n\n"
            f"战略重点：{strategy_focus}\n"
            f"本周主力：{lobster_names}\n\n"
            f"内容计划：\n{content_lines}\n\n"
            f"本周目标：\n{kpi_lines}\n\n"
            f"有问题随时@我，我们开始！"
        )

    @staticmethod
    def strategist_strategy_delivery(
        enterprise_name: str,
        campaign_name: str,
        strategy_options: list[dict],
        recommended_index: int = 0,
    ) -> str:
        """苏思策略发布到群"""
        options_text = ""
        for i, s in enumerate(strategy_options):
            marker = "⭐ 推荐" if i == recommended_index else f"方案{i+1}"
            options_text += (
                f"\n{marker}：{s.get('title', '')}\n"
                f"  {s.get('one_liner', '')}\n"
                f"  预期效果：{s.get('expected_outcome', '')}\n"
                f"  执行周期：{s.get('timeline_weeks', '?')}周\n"
            )
        return (
            f"🧠 增长策略方案 | {enterprise_name} × {campaign_name}\n"
            f"{options_text}\n"
            f"请查看后告诉我们选哪个方案，或者有疑问可以直接@苏思讨论 💪"
        )


# ─────────────────────────────────────────
# 群组管理器
# ─────────────────────────────────────────

class LobsterIMGroupManager:
    """
    龙虾群组管理器
    
    客户入驻后，Commander 调用此管理器：
    1. 创建三类群
    2. 配置龙虾身份
    3. 发送欢迎消息
    4. 启动自动播报定时器
    
    使用示例：
    manager = LobsterIMGroupManager()
    groups = manager.setup_client_groups(
        tenant_id="rongrong_beauty_2026",
        enterprise_name="荣荣美院",
        platform=IMPlatform.BOTH,
        client_members=["荣荣姐", "小助理"],
    )
    """

    def setup_client_groups(
        self,
        tenant_id: str,
        enterprise_name: str,
        platform: str = IMPlatform.BOTH.value,
        client_members: list[str] = None,
    ) -> dict[str, LobsterGroup]:
        """
        创建三类群组配置
        返回 {group_type: LobsterGroup}
        """
        client_members = client_members or []
        all_lobsters = list(LOBSTER_IM_IDENTITY.keys())

        groups = {}

        # 群1：龙虾全员客户群
        groups[GroupType.MAIN_CLIENT.value] = LobsterGroup(
            group_id=f"{tenant_id}_main",
            tenant_id=tenant_id,
            group_type=GroupType.MAIN_CLIENT.value,
            platform=platform,
            group_name=f"{enterprise_name}·龙门增长团队",
            member_lobsters=all_lobsters,
            member_clients=client_members,
            group_owner="commander",
        )

        # 群2：龙虾内部工作群
        groups[GroupType.INTERNAL.value] = LobsterGroup(
            group_id=f"{tenant_id}_internal",
            tenant_id=tenant_id,
            group_type=GroupType.INTERNAL.value,
            platform=platform,
            group_name=f"{enterprise_name}·龙虾内部作战室",
            member_lobsters=all_lobsters,
            member_clients=[],  # 无客户
            group_owner="commander",
        )

        return groups

    def generate_welcome_message(
        self,
        enterprise_name: str,
        growth_stage: str,
        top3_priorities: list[dict],
    ) -> str:
        """
        生成入群欢迎消息（由 Commander 发出）
        """
        priority_lines = "\n".join([
            f"  {i+1}. {p.get('title', '')}：{p.get('kpi', '')}"
            for i, p in enumerate(top3_priorities[:3])
        ])
        return (
            f"欢迎 {enterprise_name} 加入龙门增长团队！🐉\n\n"
            f"我是陈指挥，这个群里有10位专属增长顾问为你们服务：\n"
            f"  🧠 苏思——策略总设计\n"
            f"  📡 琳涛——市场情报\n"
            f"  ✍️ 墨小雅——内容文案\n"
            f"  🎨 影子——视觉创意\n"
            f"  📤 老坚——内容发布\n"
            f"  💬 阿声——互动运营\n"
            f"  🎯 铁狗——线索获客\n"
            f"  📞 小追——客户跟进\n"
            f"  📊 算无遗策——数据分析\n\n"
            f"基于你们的情况，我们判断当前处于【{growth_stage}】阶段。\n"
            f"本月三大优先事项：\n{priority_lines}\n\n"
            f"老坚明早9:00会发第一份发布计划，算无遗策每周一发数据周报。\n"
            f"有任何问题随时@我或者@对应的顾问，我们开始！ 💪"
        )

    def handle_incoming_message(
        self,
        tenant_id: str,
        message_text: str,
        sender: str,
        timestamp: str,
        chat_type: str = "p2p",
        mentions: list[str] | None = None,
        attachments: list[dict[str, Any]] | None = None,
        group_respond_mode: str = "intent",
        write_memory_callback: Callable | None = None,
    ) -> dict:
        """
        处理客户群消息：路由 + 记忆提取

        参数：
          write_memory_callback: 将记忆写入企业记忆库的回调函数
        
        返回：
        {
            "route_to": "strategist",  # 哪只龙虾来回复
            "memories_extracted": [...],  # 需要写入记忆库的条目
            "should_notify_internal": bool,  # 是否需要通知内部作战群
        }
        """
        message_ctx = {
            "text": message_text,
            "sender": sender,
            "timestamp": timestamp,
            "chat_type": chat_type,
            "mentions": list(mentions or []),
            "attachments": list(attachments or []),
        }
        should_reply = should_respond(message_ctx, group_respond_mode=group_respond_mode)
        if not should_reply:
            return {
                "route_to": None,
                "route_to_display": "",
                "memories_extracted": [],
                "should_notify_internal": False,
                "timestamp": timestamp,
                "filtered": True,
                "filter_reason": "no_intent_signal",
            }

        # 1. 消息路由
        route_to = route_message(message_text)

        # 2. 提取记忆
        memories = extract_memory_from_message(
            tenant_id=tenant_id,
            message_text=message_text,
            sender=sender,
            timestamp=timestamp,
        )

        # 3. 写入记忆库
        if write_memory_callback and memories:
            for mem in memories:
                write_memory_callback(
                    tenant_id=mem["tenant_id"],
                    key=mem["key"],
                    value=mem["value"],
                    category=mem["category"],
                    expires_days=mem["expires_days"],
                )

        # 4. 判断是否需要通知内部群
        # 异常/投诉类 → 同步到内部作战群
        internal_notify = any(
            kw in message_text
            for kw in ["紧急", "出问题了", "不满意", "投诉", "异常"]
        )

        return {
            "route_to": route_to,
            "route_to_display": LOBSTER_IM_IDENTITY.get(route_to, {}).get("display_name_feishu", route_to),
            "memories_extracted": memories,
            "should_notify_internal": internal_notify,
            "timestamp": timestamp,
            "filtered": False,
        }


# ─────────────────────────────────────────
# 龙虾账号注册表（入驻时生成）
# ─────────────────────────────────────────

def generate_lobster_contact_card(lobster_id: str) -> dict:
    """
    生成单只龙虾的联系人名片
    用于客户入驻时发送"认识团队"介绍
    """
    config = LOBSTER_IM_IDENTITY.get(lobster_id, {})
    return {
        "name": config.get("display_name_feishu", lobster_id),
        "role": config.get("group_role", ""),
        "when_to_find_me": config.get("response_scenarios", []),
        "auto_reports": (
            f"每日{config['report_time']} 发送：{config.get('report_content', '')}"
            if config.get("auto_daily_report") else "不定期汇报"
        ),
    }


def generate_team_introduction(enterprise_name: str) -> str:
    """生成完整团队介绍卡片（入驻欢迎使用）"""
    lines = [f"🐉 {enterprise_name} 专属增长团队\n"]
    for lobster_id, config in LOBSTER_IM_IDENTITY.items():
        scenarios = " / ".join(config["response_scenarios"][:2])
        lines.append(
            f"{config['avatar_emoji']} {config['display_name_feishu']}\n"
            f"   找他的场景：{scenarios}"
        )
    lines.append("\n有事直接@对应顾问，或者@陈指挥统一协调")
    return "\n".join(lines)
