"""
企业入驻流程模块
Dragon Senate — Enterprise Onboarding

客户购买系统时，通过4步入驻建立企业专属记忆库（Layer 3）：
  Step 1: 基本定位问卷（行业树选择，5分钟）
  Step 2: 品牌基因访谈（Commander 主导对话，15分钟）
  Step 3: 资源条件清点（表单）
  Step 4: 首次增长诊断（自动生成，Commander输出）
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from enterprise_memory import (
    EnterpriseMemoryBank,
    EnterpriseProfile,
    GrowthCampaignRecord,
    GrowthStage,
    IndustryL1,
    IndustryL2,
    PlatformAccountRecord,
    create_enterprise_profile_from_onboarding,
    get_lobster_context,
)


# ─────────────────────────────────────────
# Step 1：基本定位问卷
# ─────────────────────────────────────────

ONBOARDING_QUESTIONNAIRE = {
    "step1_basic": {
        "title": "基本定位（5分钟）",
        "questions": [
            {
                "id": "enterprise_name",
                "label": "您的店铺/品牌名称",
                "type": "text",
                "required": True,
                "example": "荣荣美院",
            },
            {
                "id": "industry_l1",
                "label": "所属行业大类",
                "type": "select",
                "options": [e.value for e in IndustryL1],
                "required": True,
            },
            {
                "id": "industry_l2",
                "label": "细分业态",
                "type": "select_dependent",
                "depends_on": "industry_l1",
                "options_map": {
                    "美业健康": ["美容院", "医美机构", "养生馆", "美发", "美甲"],
                    "餐饮": ["中餐", "西餐", "咖啡茶饮", "快餐", "火锅", "烧烤"],
                    "教育培训": ["K12教育", "职业技能培训", "语言培训", "艺术培训"],
                    "零售": ["服装", "化妆品", "母婴", "食品", "数码"],
                    "B2B企业服务": ["SaaS软件", "咨询", "设计", "供应链"],
                    "健身运动": ["健身房", "瑜伽", "游泳", "舞蹈"],
                    "房产家居": ["房产中介", "家装", "家具"],
                },
                "required": True,
            },
            {
                "id": "city",
                "label": "所在城市",
                "type": "text",
                "required": True,
                "example": "四川省XX市",
            },
            {
                "id": "city_tier",
                "label": "城市级别",
                "type": "select",
                "options": ["一线城市", "新一线城市", "二线城市", "三线城市", "四线及以下"],
                "required": True,
                "helper": "一线：北上广深；新一线：成都/杭州/武汉等；其余按规模判断",
            },
            {
                "id": "price_position",
                "label": "定价定位",
                "type": "select",
                "options": ["高端", "中端", "平价"],
                "required": True,
                "helper": {
                    "美容院": "高端：客单价>500元；中端：150-500元；平价：<150元",
                    "餐饮": "高端：人均>200元；中端：50-200元；平价：<50元",
                },
            },
            {
                "id": "founded_year",
                "label": "成立年份",
                "type": "number",
                "required": False,
            },
        ],
    },

    "step2_brand_dna": {
        "title": "品牌基因访谈（Commander 主导，15分钟对话）",
        "interview_questions": [
            {
                "id": "brand_core_value",
                "question": "用一句话告诉我，你们店最想让顾客感受到什么？",
                "probe": "不是功能，是情感——你们让顾客离开时心里留下的那个东西",
                "example": "让小城女性也能享受大城市的美容体验",
            },
            {
                "id": "brand_personality",
                "question": "用3个词描述你们品牌的风格",
                "probe": "想象一下你们的品牌是一个人，他/她是什么样的人？",
                "format": "list",
                "example": ["专业温暖", "亲切不距离", "细节控"],
            },
            {
                "id": "brand_taboo_persona",
                "question": "你们最不像哪种风格的同类品牌？",
                "probe": "这个问题帮助我们划定边界，什么是你们绝对不会做的",
                "format": "list",
                "example": ["冷漠高冷的网红店", "只追促销的大众团购店"],
            },
            {
                "id": "founder_story",
                "question": "你或者创始人有没有一个值得讲的背景故事？",
                "probe": "比如从哪里学的技术，做了多少年，经历过什么让你决定开这家店",
                "example": "荣荣姐2018年从成都进修回来开的，15年美业经验，想让本地人不用跑大城市也能做好皮肤",
            },
            {
                "id": "signature_service",
                "question": "你们最骄傲的一个服务项目或特色是什么？",
                "example": "定制化皮肤管理方案",
            },
            {
                "id": "brand_vocabulary_customer",
                "question": "你们的老顾客最常用哪些词来夸你们？",
                "probe": "不要你总结，要原话——他们发朋友圈、写评论时怎么说的",
                "format": "list",
                "example": ["皮肤变好了", "好舒服", "荣荣姐真的很用心", "感觉被当朋友对待"],
            },
            {
                "id": "primary_customer_pain_points",
                "question": "你们的客户来找你们之前，通常在为什么烦恼？",
                "format": "list",
                "example": ["三线城市选择少，不知道去哪家靠谱", "担心被黑心商家坑", "皮肤问题困扰了很久不知如何解决"],
            },
            {
                "id": "primary_decision_trigger",
                "question": "客户是什么情况下决定来你们这的？什么是那根稻草？",
                "example": "熟人推荐 > 看到朋友发的真实效果 > 在抖音刷到我们的视频",
            },
        ],
    },

    "step3_resources": {
        "title": "资源条件清点（表单）",
        "questions": [
            {
                "id": "platform_accounts",
                "label": "现有平台账号",
                "type": "multi_platform",
                "platforms": ["抖音", "小红书", "微信视频号", "微信公众号", "B站", "微博"],
                "fields_per_platform": ["account_id_or_name", "followers", "is_active"],
            },
            {
                "id": "staff_total",
                "label": "团队总人数",
                "type": "number",
            },
            {
                "id": "content_responsible",
                "label": "谁负责内容生产？",
                "type": "text",
                "example": "老板自己拍+一个助理剪辑",
            },
            {
                "id": "filming_capability",
                "label": "拍摄能力",
                "type": "select",
                "options": [
                    "手机拍摄，无专业设备",
                    "有稳定器/补光灯等基础设备",
                    "有专业相机/摄像机",
                    "有专职摄影师/摄像师",
                ],
            },
            {
                "id": "content_per_week",
                "label": "每周能生产几条内容？（视频/图文）",
                "type": "number",
                "min": 1,
                "max": 20,
            },
            {
                "id": "monthly_marketing_budget",
                "label": "每月可用于内容营销的预算（元）",
                "type": "number",
                "helper": "包括工具订阅、素材购买等，不含人工",
            },
            {
                "id": "platform_ads_willing",
                "label": "是否愿意投放平台广告（信息流广告）？",
                "type": "boolean",
            },
            {
                "id": "peak_busy_periods",
                "label": "哪些时间段店里最忙，不适合做需要即时响应的活动？",
                "type": "multi_select",
                "options": ["周末", "节假日", "月底", "暑假", "寒假", "其他"],
                "format": "list",
            },
        ],
    },
}


# ─────────────────────────────────────────
# Step 4：首次增长诊断（自动生成）
# ─────────────────────────────────────────

def generate_initial_diagnosis(profile: EnterpriseProfile) -> dict:
    """
    基于入驻档案自动生成首次增长诊断报告
    由 Commander 调用，生成3个优先建议
    
    返回结构：
    {
        "growth_stage": "扩张期",
        "stage_rationale": "...",
        "top3_priorities": [...],
        "primary_lobsters": [...],
        "first_month_goal": "...",
        "quick_wins": [...],
        "risks": [...],
    }
    """
    from enterprise_memory import INDUSTRY_KNOWLEDGE_TREE, REGIONAL_KNOWLEDGE

    # 读取行业知识
    industry_ctx = (
        INDUSTRY_KNOWLEDGE_TREE
        .get(profile.industry_l1, {})
        .get(profile.industry_l2, {})
        .get(profile.price_position, {})
    )
    regional_ctx = REGIONAL_KNOWLEDGE.get(profile.city_tier, {})

    stage = profile.growth_stage
    stage_cfg = profile.stage_config

    # 账号状态分析
    total_followers = sum(
        acc.get("followers", 0) if isinstance(acc, dict) else acc.followers
        for acc in profile.platform_accounts
    )
    has_active_accounts = total_followers > 0

    # 优先建议生成
    priorities = []

    if stage == GrowthStage.COLD_START.value:
        priorities = [
            {
                "priority": 1,
                "title": "垂直内容建立账号标签",
                "rationale": f"账号当前总粉丝{total_followers}人，处于冷启动期。算法需要时间识别账号定位，前20条内容必须高度垂直",
                "action": f"由 inkwriter + radar 主导，每周{profile.content_per_week}条{profile.industry_l2}垂直内容，优先搜索流量，不追热点",
                "kpi": "账号标签稳定（系统推荐人群精准），粉丝突破1000",
            },
            {
                "priority": 2,
                "title": "建立品牌专属词汇体系",
                "rationale": f"三线城市熟人经济，个人IP比品牌更有温度。{profile.founder_story or '创始人故事'}是差异化关键",
                "action": "用入驻时的品牌基因，建立inkwriter的专属词汇库，确保每条内容都有荣荣美院独特的语言风格",
                "kpi": "发布10条内容后，评论区开始出现客户用我们的品牌词汇回应",
            },
            {
                "priority": 3,
                "title": "打通私域-到店转化路径",
                "rationale": f"{profile.city_tier}微信私域转化率远高于公域，{regional_ctx.get('cultural_notes', '')}",
                "action": "每条内容结尾引导到微信，echoer 监控评论区意向信号，catcher 及时承接私信线索",
                "kpi": "内容→私信咨询转化率>3%",
            },
        ]
    elif stage == GrowthStage.EXPANSION.value:
        priorities = [
            {
                "priority": 1,
                "title": "激活现有粉丝中的潜在客户",
                "rationale": f"账号已有{total_followers}粉丝，但线索转化率可能尚未被系统跟进",
                "action": "catcher 评估存量粉丝中的高意向用户，followup 启动私信唤醒序列",
                "kpi": "存量线索激活率>10%，首月新增到店>20人",
            },
            {
                "priority": 2,
                "title": "打造爆款内容模板",
                "rationale": f"{profile.industry_l2}高端定位，{industry_ctx.get('peak_content_types', ['before-after对比'])[0]}类内容最易出圈",
                "action": "inkwriter+visualizer 打造3个内容模板，AB测试钩子类型，找到可复用的爆款公式",
                "kpi": "至少1条内容完播率>35%，互动率超账号均值50%",
            },
            {
                "priority": 3,
                "title": "建立活动引流机制",
                "rationale": "扩张期需要周期性活动拉动到店，但要避免低质量客户",
                "action": "strategist 设计有客单价门槛的到店活动，dispatcher 选择最优发布时间窗，echoer+catcher 高效转化意向",
                "kpi": "活动期间新客到店>30人，客单价≥历史均值90%",
            },
        ]
    elif stage == GrowthStage.MATURE.value:
        priorities = [
            {
                "priority": 1,
                "title": "复购率提升计划",
                "rationale": "成熟期获新客成本高，复购客户贡献更多利润",
                "action": "followup 设计复购唤醒序列，abacus 找出最高复购率的服务类型，strategist 制定复购激励方案",
                "kpi": "90天复购率提升至>40%",
            },
            {
                "priority": 2,
                "title": "客单价升级路径",
                "rationale": f"高端定位有溢价空间，通过内容建立'专业权威'认知后可引导高客单项目",
                "action": "inkwriter 专门打造高客单项目的内容，建立'为什么值这个价'的信任内容矩阵",
                "kpi": "高客单项目询单量增长>20%",
            },
            {
                "priority": 3,
                "title": "口碑裂变机制",
                "rationale": f"{profile.city_tier}口碑传播效率是一线城市{regional_ctx.get('word_of_mouth_multiplier', 1.5)}倍",
                "action": "设计老带新激励机制，echoer 在评论区激发UGC，让顾客主动分享成为内容创作者",
                "kpi": "新客中老带新占比>30%",
            },
        ]

    # 快速胜利机会
    quick_wins = []
    if has_active_accounts:
        best_platform_account = max(
            profile.platform_accounts,
            key=lambda a: a.get("followers", 0) if isinstance(a, dict) else a.followers,
            default=None,
        )
        if best_platform_account:
            platform = best_platform_account.get("platform", "抖音") if isinstance(best_platform_account, dict) else best_platform_account.platform
            followers = best_platform_account.get("followers", 0) if isinstance(best_platform_account, dict) else best_platform_account.followers
            quick_wins.append(f"{platform}账号现有{followers}粉丝，是当前最佳主投平台，应优先加大投入")

    if profile.founder_story:
        quick_wins.append("创始人故事是高价值内容素材，建议作为前5条内容之一发布（真实背书，高转化）")

    if regional_ctx.get("preferred_channels", {}).get("wechat_private") == "极强":
        quick_wins.append("微信私域是本地用户主要信任渠道，所有内容引导动作应优先指向加微信")

    return {
        "tenant_id": profile.tenant_id,
        "enterprise_name": profile.enterprise_name,
        "growth_stage": stage,
        "stage_rationale": stage_cfg["primary_goal"],
        "primary_lobsters": stage_cfg["primary_lobsters"],
        "top3_priorities": priorities,
        "first_month_goal": stage_cfg["success_metric"],
        "quick_wins": quick_wins,
        "risks": [
            f"内容生产能力有限（每周{profile.content_per_week}条），需要保证每条质量优先于频率",
            "三线城市决策周期较一线城市延长7天，不要用一线城市的转化速度衡量效果",
            "高端定位严禁出现促销感话术，否则损害品牌价值" if profile.price_position == "高端" else "",
        ],
        "generated_at": datetime.now().isoformat(),
    }


# ─────────────────────────────────────────
# 完整入驻流程执行器
# ─────────────────────────────────────────

class EnterpriseOnboardingPipeline:
    """
    入驻流程执行器
    
    使用方式：
    pipeline = EnterpriseOnboardingPipeline()
    
    # 从前端问卷收集的数据
    result = pipeline.run_onboarding({
        "tenant_id": "rongrong_beauty_2026",
        "enterprise_name": "荣荣美院",
        "industry_l1": "美业健康",
        "industry_l2": "美容院",
        "price_position": "高端",
        "city": "四川省XX市",
        "city_tier": "三线城市",
        "brand_core_value": "让小城女性也能享受大城市的美容体验",
        "brand_personality": ["专业温暖", "亲切不距离", "细节控"],
        "brand_taboo_persona": ["冷漠高冷", "促销感强"],
        "founder_story": "荣荣姐2018年从成都进修回来开的，15年美业经验",
        "signature_service": "定制化皮肤管理方案",
        "brand_vocabulary_customer": ["皮肤变好了", "好舒服", "荣荣姐说"],
        "primary_customer_pain_points": ["三线城市选择少", "担心被坑", "不知如何解决皮肤问题"],
        "primary_decision_trigger": ["熟人推荐", "真实效果分享"],
        "platform_accounts": [
            {"platform": "抖音", "followers": 8900, "health_status": "绿色"},
            {"platform": "小红书", "followers": 3200, "health_status": "绿色"},
        ],
        "staff_total": 6,
        "content_responsible": "老板自己拍+1个助理剪辑",
        "filming_capability": "手机拍摄，无专业设备",
        "content_per_week": 2,
        "monthly_marketing_budget": 3000,
        "platform_ads_willing": False,
        "peak_busy_periods": ["周末", "节假日"],
    })
    """

    def __init__(self):
        self.bank = EnterpriseMemoryBank()

    def run_onboarding(self, questionnaire_data: dict) -> dict:
        """
        执行完整入驻流程，返回诊断报告
        """
        # 1. 创建企业档案
        profile = create_enterprise_profile_from_onboarding(questionnaire_data)

        # 2. 保存到记忆库
        self.bank.save_profile(profile)

        # 3. 生成首次增长诊断
        diagnosis = generate_initial_diagnosis(profile)

        # 4. 将诊断结果写入记忆（永久有效）
        self.bank.write_memory(
            tenant_id=profile.tenant_id,
            key="initial_diagnosis",
            value=diagnosis,
            category="campaign_result",
            expires_days=-1,
        )

        return {
            "status": "onboarded",
            "tenant_id": profile.tenant_id,
            "enterprise_name": profile.enterprise_name,
            "growth_stage": profile.growth_stage,
            "diagnosis": diagnosis,
            "next_action": "Commander 将基于诊断结果，制定第一个月的具体执行计划",
        }

    def get_lobster_brief(self, tenant_id: str, lobster_id: str) -> dict:
        """
        获取指定龙虾的客户上下文 brief
        在龙虾执行任务前调用，注入企业知识
        """
        return get_lobster_context(tenant_id, lobster_id)
