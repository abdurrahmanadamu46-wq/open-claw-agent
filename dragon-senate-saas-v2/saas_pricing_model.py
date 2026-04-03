"""
SaaS 定价模型 V7 — 账号席，单席底线 ¥1,980（入库）
Dragon Senate — SaaS Pricing Model

定价版本：V7-FINAL（2026-04-02）
参考文档：docs/COST_ANALYSIS_AND_PRICING_V7.md

═══════════════════════════════════════════════════════════
  V7 修正：多席折扣底线不低于 ¥1,980/席/月
═══════════════════════════════════════════════════════════

  【席位定义（同V6）】
    1 席 = 服务 1 个社交媒体账号（抖音/小红书/视频号/公众号之一）
    每席每月：视频20条 / 图片30张 / 数字人讲解3条 / 客服互动500次

  【V7 价格底线】
    最低单席价：¥1,980/席/月（300席+大总代）
    不再低于此价，保护品牌定价体系和渠道秩序

  V7 单席 AI 直接成本：¥784/月（同V6）
  平台固定成本：¥281,000/月

═══════════════════════════════════════════════════════════
  V7 座席折扣定价表（锚点 ¥4,800，底线 ¥1,980）
═══════════════════════════════════════════════════════════

  1-4席（直签小品牌）   ¥4,800/席/月   — 锚点价
  5-19席                ¥3,800/席/月   （79折）
  20-49席               ¥2,980/席/月   （62折）← 代理起步
  50-99席               ¥2,480/席/月   （52折）← 区域代理
  100-299席             ¥2,180/席/月   （45折）← 省级代理
  300席+                ¥1,980/席/月   （41折）← 总代理，底线价

  单席 AI 成本 ¥784，即使 300席底线 ¥1,980 仍有毛利率 ≈ 60%

  代理利润示例（100席省代，向下游按¥3,800/席卖）：
    采购：100 × ¥2,180 = ¥218,000/月
    销售：100 × ¥3,800 = ¥380,000/月
    运营：≈ ¥80,000/月
    月净利：¥82,000（¥8.2万）
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ══════════════════════════════════════════════════════════
# 席位定义（V7，同V6）
# ══════════════════════════════════════════════════════════

SEAT_DEFINITION = """
【V7 席位定义】
1 席 = 服务 1 个社交媒体账号（抖音/小红书/视频号/微信公众号 之一）

每席每月标准产出（基于真实单账号需求）：
  AI视频：20条（Seedance 2.0，15s，¥30/条含损耗）
  AI图片：30张（Imagen 4，¥0.29/张）
  数字人讲解：3条（HeyGen Pro，约2分钟/条）
  数字人客服互动：500次（私信/评论回复）
  数字人销售外呼：30次（catcher/followup）
  LLM策略/文案任务：50次

单席AI直接成本：¥784/月
最低定价底线：¥1,980/席（300席+总代理）
"""

# ══════════════════════════════════════════════════════════
# 座席折扣档位（V7，底线 ¥1,980）
# ══════════════════════════════════════════════════════════

# 折扣阶梯：(最小席数, 最大席数含, 单席月价)
SEAT_PRICE_TIERS: list[tuple[int, int, int]] = [
    (1,    4,   4_800),   # 锚点价，单席/小量直签
    (5,   19,   3_800),   # 79折，小品牌/小代理
    (20,  49,   2_980),   # 62折，代理起步线
    (50,  99,   2_480),   # 52折，区域代理
    (100, 299,  2_180),   # 45折，省级代理
    (300, 9999, 1_980),   # 41折，总代理，底线价
]

# 底线价格保护
FLOOR_PRICE = 1_980   # 任何情况下单席不低于此价


def get_seat_unit_price(seat_count: int) -> int:
    """根据座席数返回单席月价（不低于底线 ¥1,980）"""
    for min_seats, max_seats, price in SEAT_PRICE_TIERS:
        if min_seats <= seat_count <= max_seats:
            return max(price, FLOOR_PRICE)
    return SEAT_PRICE_TIERS[-1][2]


def get_seat_total_price(seat_count: int, billing_cycle: str = "monthly") -> dict:
    """
    计算座席总价及折扣信息

    参数：
      seat_count: 购买座席数（每席=1个社交账号）
      billing_cycle: "monthly" | "annual"（年付额外9折，但不低于底线）
    """
    unit_price = get_seat_unit_price(seat_count)
    list_price = SEAT_PRICE_TIERS[0][2]  # 锚点价 ¥4,800

    monthly_total = unit_price * seat_count
    annual_discount = 0.90 if billing_cycle == "annual" else 1.0
    # 年付折后价也不低于底线
    annual_unit = max(int(unit_price * annual_discount), FLOOR_PRICE)
    annual_total = annual_unit * seat_count * 12

    discount_pct = round((1 - unit_price / list_price) * 100, 1)

    # 判断渠道档位和建议转售价
    if seat_count >= 300:
        channel = "总代理（底线价）"
        suggested_resell_price = 2_980
    elif seat_count >= 100:
        channel = "省级代理"
        suggested_resell_price = 3_800
    elif seat_count >= 50:
        channel = "区域代理"
        suggested_resell_price = 3_800
    elif seat_count >= 20:
        channel = "代理起步"
        suggested_resell_price = 4_800
    else:
        channel = "品牌直签"
        suggested_resell_price = None

    result = {
        "seat_count": seat_count,
        "seat_definition": "每席=1个社交媒体账号（抖音/小红书/视频号等）",
        "billing_cycle": billing_cycle,
        "unit_price": unit_price,
        "list_price": list_price,
        "floor_price": FLOOR_PRICE,
        "discount_pct": discount_pct,
        "monthly_total": monthly_total,
        "annual_total": annual_total if billing_cycle == "annual" else None,
        "channel_label": channel,
        "suggested_resell_unit_price": suggested_resell_price,
    }

    if suggested_resell_price and seat_count >= 20:
        resell_revenue = suggested_resell_price * seat_count
        ops_cost = max(20_000, seat_count * 600)
        agent_gross = resell_revenue - monthly_total
        agent_net = agent_gross - ops_cost
        result["reseller_roi"] = {
            "resell_revenue_monthly": resell_revenue,
            "platform_fee_monthly": monthly_total,
            "ops_cost_estimate": ops_cost,
            "agent_gross_profit": agent_gross,
            "agent_net_profit": agent_net,
            "agent_gross_margin_pct": round(agent_gross / resell_revenue * 100, 1),
            "summary": (
                f"代理管理{seat_count}席账号，向下游售价¥{suggested_resell_price:,}/席\n"
                f"月收入 ¥{resell_revenue:,} - 平台费 ¥{monthly_total:,} - 运营 ¥{ops_cost:,}\n"
                f"= 月净利 ¥{agent_net:,}（毛利{round(agent_gross / resell_revenue * 100, 1)}%）"
            ),
        }

    return result


# ══════════════════════════════════════════════════════════
# 标准产品配置（V7，单席=单账号，全功能，同V6）
# ══════════════════════════════════════════════════════════

ALL_LOBSTERS = [
    "commander",   # 陈指挥  — 任务总调度
    "strategist",  # 苏思    — 增长策略
    "radar",       # 林涛    — 市场情报
    "inkwriter",   # 墨小雅  — 内容创作
    "visualizer",  # 影子    — 视觉创意
    "dispatcher",  # 老坚    — 任务协调
    "echoer",      # 阿声    — 社群互动/数字人客服
    "catcher",     # 铁钩    — 商机捕获/数字人销售
    "followup",    # 小锤    — 客户跟进/数字人回访
    "abacus",      # 算无遗策 — 数据复盘
]


@dataclass
class StandardSeatConfig:
    """
    V7 标准座席产品配置

    1席 = 1个社交媒体账号
    单席AI成本 ¥784/月
    最低定价 ¥1,980/席（300席+）
    即使在底线价格，平台每席仍有 ¥1,980 - ¥884 = ¥1,096 边际贡献
    """

    product_name: str = "Dragon Senate 龙虾团队账号席"
    product_tagline: str = "每个账号独立的AI运营团队，10只龙虾全开"
    seat_unit: str = "1席 = 1个社交媒体账号（抖音/小红书/视频号/公众号之一）"
    floor_price: int = 1_980   # 底线价，任何情况不低于此

    # ── V7 生成模型（统一顶配，同V6）──────────────────────
    video_model: str = "字节 Seedance 2.0（¥1/秒，15s视频API成本¥15，2x损耗→¥30/条交付）"
    image_model: str = "Google Imagen 4 / Banana（¥0.29/张，2x损耗）"
    dh_model: str = "HeyGen Pro（情感自然，嘴型准确，¥6/分钟）"
    llm_model: str = "Claude Sonnet（主力）+ Claude Opus（关键节点）"

    # ── 单席每月内容配额（真实单账号需求）──────────────────
    monthly_ai_videos: int = 20          # 条/月（每条15秒，Seedance 2.0）
    monthly_ai_images: int = 30          # 张/月（Imagen 4）
    monthly_dh_clips: int = 3            # 条/月数字人讲解（约2分钟/条）
    monthly_dh_service_interactions: int = 500   # 次/月 echoer客服
    monthly_dh_sales_outreach: int = 30          # 次/月 catcher/followup销售
    monthly_llm_tasks: int = 50          # 次/月 LLM策略/文案

    lobster_roster: list = field(default_factory=lambda: ALL_LOBSTERS)

    has_content_analytics: bool = True
    has_competitor_radar: bool = True
    has_brand_voice_training: bool = True
    has_roi_report: bool = True
    has_custom_dh_avatar: bool = True

    sla_response_hours: int = 8
    sla_availability_pct: float = 99.5
    has_csm: bool = True

    # ── V7 单席 AI 直接成本（同V6，按真实单账号需求）────────
    # 视频：20条 × 15s × ¥1/s × 2x = ¥600
    # 图片：30张 × 2x × ¥0.29 = ¥17.4
    # 数字人讲解：3条 × 3.3x × ¥6/min × 2min = ¥118.8
    # 数字人客服：500次 × ¥0.01 = ¥5
    # 数字人销售：30次 × ¥0.05 = ¥1.5
    # LLM：50次 × 40k tokens × 1.7x × ¥0.12/k = ¥40.8
    # 合计：¥783.5 → ¥784
    ai_direct_cost_per_seat: int = 784
    waste_buffer: int = 100


STANDARD_SEAT = StandardSeatConfig()


# ══════════════════════════════════════════════════════════
# 大客户/高席数专属权益升级
# ══════════════════════════════════════════════════════════

def get_seat_tier_perks(seat_count: int) -> dict:
    """根据购买席数返回对应专属权益"""
    perks = {
        "seat_count": seat_count,
        "unit_price": get_seat_unit_price(seat_count),
        "floor_price": FLOOR_PRICE,
        "seat_definition": "每席=1个社交媒体账号",
        "lobster_roster": "全10只（含echoer客服/catcher销售/followup回访）",
        "monthly_quota": "视频20条/图片30张/数字人讲解3条+500次客服+30次销售/账号/月",
        "video_model": "字节 Seedance 2.0（¥1/秒，2x损耗）",
        "image_model": "Google Imagen 4 / Banana（¥0.29/张）",
        "brand_voice_training": "✅（每账号独立风格）",
        "custom_dh_avatar": "✅",
        "roi_analytics": "✅",
        "csm": "✅",
        "sla": "8h响应 / 99.5%可用性",
        "white_label": "❌",
        "multi_tenant_mgmt": "❌",
    }

    if seat_count >= 20:
        perks.update({
            "sla": "4h响应 / 99.5%可用性",
            "white_label": "✅（龙虾改名为代理品牌的AI助理）",
            "multi_tenant_mgmt": "✅（统一管理后台）",
            "cross_account_dashboard": "✅（跨账号数据汇总看板）",
        })

    if seat_count >= 50:
        perks.update({
            "api_access": "✅（平台数据API）",
            "sso": "✅",
            "csm_checkin": "双周主动check-in",
        })

    if seat_count >= 100:
        perks.update({
            "sla": "2h响应 / 99.9%可用性",
            "dedicated_resources": "✅（独立调度资源）",
            "api_access": "✅（全量API）",
            "csm_checkin": "周例会",
            "qbr": "✅（季度代理业务复盘）",
            "priority_roadmap": "✅",
        })

    if seat_count >= 300:
        perks.update({
            "price_note": f"底线价 ¥{FLOOR_PRICE:,}/席，不再下调，保护渠道定价秩序",
            "support": "7×24专属支持 + 专属工程师",
            "erp_integration": "✅（ERP/CRM集成接口）",
        })

    return perks


# ══════════════════════════════════════════════════════════
# 平台成本模型 V7
# ══════════════════════════════════════════════════════════

class PlatformCostModelV7:
    """
    V7 成本测算引擎

    席位定义：单个社交媒体账号（每月20条视频真实需求）
    单席AI成本：¥784/月
    底线价格：¥1,980/席/月（300席+总代理）
    即使在底线价格，边际贡献仍有 ¥1,980 - ¥884 = ¥1,096/席
    """

    FIXED_TOTAL = 281_000   # 元/月
    AI_DIRECT_PER_SEAT = 784
    WASTE_BUFFER = 100

    def unit_economics(self, seat_count: int) -> dict:
        unit_price = get_seat_unit_price(seat_count)
        fixed_per_seat = self.FIXED_TOTAL / seat_count
        total_cost = self.AI_DIRECT_PER_SEAT + fixed_per_seat + self.WASTE_BUFFER

        gp = unit_price - total_cost
        margin = round(gp / unit_price * 100, 1) if unit_price else 0

        total_revenue = unit_price * seat_count
        total_profit = total_revenue - self.AI_DIRECT_PER_SEAT * seat_count - self.FIXED_TOTAL

        # 边际贡献（最关键指标：即使在底线价，每席边际贡献仍 > ¥1,000）
        marginal = unit_price - self.AI_DIRECT_PER_SEAT - self.WASTE_BUFFER

        return {
            "seat_count": seat_count,
            "seat_definition": "每席=1个社交媒体账号",
            "unit_price": unit_price,
            "floor_price": FLOOR_PRICE,
            "marginal_contribution": marginal,
            "cost_per_seat": {
                "ai_direct": self.AI_DIRECT_PER_SEAT,
                "fixed_allocated": round(fixed_per_seat, 0),
                "waste_buffer": self.WASTE_BUFFER,
                "total": round(total_cost, 0),
            },
            "gross_profit_per_seat": round(gp, 0),
            "gross_margin_pct": margin,
            "platform_total": {
                "revenue": total_revenue,
                "ai_cost": self.AI_DIRECT_PER_SEAT * seat_count,
                "fixed_cost": self.FIXED_TOTAL,
                "net_profit": round(total_profit, 0),
                "net_margin_pct": round(total_profit / total_revenue * 100, 1) if total_revenue else 0,
            },
        }

    def breakeven_analysis(self) -> dict:
        results = []
        for min_seats, max_seats, price in SEAT_PRICE_TIERS:
            price = max(price, FLOOR_PRICE)
            marginal = price - self.AI_DIRECT_PER_SEAT - self.WASTE_BUFFER
            if marginal > 0:
                breakeven = int(self.FIXED_TOTAL / marginal) + 1
                results.append({
                    "price_tier": f"¥{price:,}/席",
                    "seat_range": f"{min_seats}-{max_seats if max_seats < 9999 else '∞'}席",
                    "marginal_contribution": marginal,
                    "breakeven_seats": breakeven,
                    "note": "底线价" if price == FLOOR_PRICE else "",
                })
        return {
            "fixed_cost": self.FIXED_TOTAL,
            "ai_direct_per_seat": self.AI_DIRECT_PER_SEAT,
            "floor_price": FLOOR_PRICE,
            "floor_marginal": FLOOR_PRICE - self.AI_DIRECT_PER_SEAT - self.WASTE_BUFFER,
            "tiers": results,
            "key_insight": (
                f"底线价 ¥{FLOOR_PRICE:,}/席：边际贡献 ¥{FLOOR_PRICE - 884:,}，"
                f"盈亏平衡需 {int(self.FIXED_TOTAL / (FLOOR_PRICE - 884)) + 1} 席\n"
                "锚点价 ¥4,800/席：边际贡献 ¥3,916，盈亏平衡仅需 72 席"
            ),
        }

    def scale_profit_forecast(self) -> list[dict]:
        """规模化利润预测（V7，底线¥1,980）"""
        scenarios = [
            (72,    "72席（锚点价盈亏平衡）",  4_800),
            (200,   "200席混合",              3_200),
            (500,   "500席（含代理批量）",    2_600),
            (1000,  "1000席（以代理为主）",   2_200),
            (3000,  "3000席总代规模",         1_980),
        ]
        results = []
        for seats, desc, avg_price in scenarios:
            avg_price = max(avg_price, FLOOR_PRICE)
            revenue = avg_price * seats
            ai_cost = self.AI_DIRECT_PER_SEAT * seats
            net_profit = revenue - ai_cost - self.FIXED_TOTAL
            results.append({
                "seats": seats,
                "scenario": desc,
                "avg_unit_price": avg_price,
                "monthly_revenue": revenue,
                "ai_cost": ai_cost,
                "fixed_cost": self.FIXED_TOTAL,
                "net_profit": round(net_profit, 0),
                "net_margin_pct": round(net_profit / revenue * 100, 1),
            })
        return results

    def reseller_roi_analysis(self, seat_count: int) -> dict:
        """代理 ROI 分析（V7，底线¥1,980）"""
        purchase_price = get_seat_unit_price(seat_count)

        if seat_count >= 300:
            resell_price = 2_980
        elif seat_count >= 100:
            resell_price = 3_800
        elif seat_count >= 50:
            resell_price = 3_800
        else:
            resell_price = 4_800

        ops_cost = max(20_000, seat_count * 600)
        monthly_platform_fee = purchase_price * seat_count
        monthly_resell_revenue = resell_price * seat_count
        monthly_gross = monthly_resell_revenue - monthly_platform_fee
        monthly_net = monthly_gross - ops_cost
        platform_profit = monthly_platform_fee - (self.AI_DIRECT_PER_SEAT * seat_count + self.FIXED_TOTAL)

        return {
            "seat_count": seat_count,
            "seat_definition": "每席=1个社交媒体账号",
            "purchase_unit_price": purchase_price,
            "resell_unit_price": resell_price,
            "monthly_platform_fee": monthly_platform_fee,
            "monthly_resell_revenue": monthly_resell_revenue,
            "monthly_gross_profit": monthly_gross,
            "monthly_ops_cost": ops_cost,
            "monthly_net_profit": monthly_net,
            "gross_margin_pct": round(monthly_gross / monthly_resell_revenue * 100, 1),
            "annual_net_profit": monthly_net * 12,
            "platform_profit_v7": round(platform_profit, 0),
            "summary": (
                f"代理管理{seat_count}个账号席（¥{purchase_price:,}/席采购）\n"
                f"向下游转售（¥{resell_price:,}/席）\n"
                f"代理月净利润：¥{monthly_net:,}  年净利润：¥{monthly_net * 12:,}\n"
                f"平台侧月净利润（V7）：¥{round(platform_profit, 0):,}"
            ),
        }


# ══════════════════════════════════════════════════════════
# 对外公开的快捷函数
# ══════════════════════════════════════════════════════════

def quote(seat_count: int, billing_cycle: str = "monthly") -> dict:
    """
    一站式报价函数（每席=1个社交媒体账号，底线¥1,980）

    示例：
      quote(1)              → 1个账号 ¥4,800/月
      quote(10)             → 10账号 ¥3,800/席 共¥38,000/月
      quote(100)            → 省级代理 ¥2,180/席 共¥218,000/月
      quote(300, "annual")  → 总代理年付 ¥1,980×0.9=¥1,782/席（不低于底线¥1,980，取¥1,980）
    """
    price_info = get_seat_total_price(seat_count, billing_cycle)
    perks = get_seat_tier_perks(seat_count)
    cost_model = PlatformCostModelV7()
    economics = cost_model.unit_economics(seat_count)

    return {
        "quote": price_info,
        "perks": perks,
        "platform_economics": economics,
        "standard_product": {
            "version": "V7",
            "seat_definition": STANDARD_SEAT.seat_unit,
            "floor_price": FLOOR_PRICE,
            "lobsters": "全10只（commander/strategist/radar/inkwriter/visualizer/"
                        "dispatcher/echoer/catcher/followup/abacus）",
            "monthly_per_seat": {
                "videos": STANDARD_SEAT.monthly_ai_videos,
                "images": STANDARD_SEAT.monthly_ai_images,
                "dh_clips": STANDARD_SEAT.monthly_dh_clips,
                "dh_service_interactions": STANDARD_SEAT.monthly_dh_service_interactions,
                "dh_sales_outreach": STANDARD_SEAT.monthly_dh_sales_outreach,
                "llm_tasks": STANDARD_SEAT.monthly_llm_tasks,
            },
            "models": {
                "video": STANDARD_SEAT.video_model,
                "image": STANDARD_SEAT.image_model,
                "dh": STANDARD_SEAT.dh_model,
                "llm": STANDARD_SEAT.llm_model,
            },
            "ai_cost_per_seat": STANDARD_SEAT.ai_direct_cost_per_seat,
        },
    }
