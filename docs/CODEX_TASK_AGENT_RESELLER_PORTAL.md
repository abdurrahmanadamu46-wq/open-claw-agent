# CODEX TASK: 代理商管理后台落地指南
**任务ID**: CODEX-AGENT-PORTAL-001  
**优先级**: 🟠 P1（20席+代理的核心购买理由）  
**依赖文件**: `dragon-senate-saas-v2/regional_agent_system.py`, `saas_pricing_model.py`, `rbac_permission.py`  
**参考项目**: Refine（管理后台框架）、Tremor（KPI看板组件）、ERPNext 合作伙伴管理  
**预计工期**: 4天

---

## 一、任务背景

V7 定价体系中，**代理商是核心收入引擎**：
- 20席起步代理：每席¥2,980采购，¥4,800转售，利润丰厚
- 100席省级代理：月净利 ¥82,000
- 代理需要"统一管理后台"（V7 权益表明确列出：20席+白标管理后台）

**当前痛点**：`regional_agent_system.py` 有骨架，但缺少：
- 代理入驻门户（Web界面）
- 席位分配和管理面板
- 跨账号数据汇总看板（核心购买理由）
- 代理层级自动升级通知
- 子代理管理（省代→区域代→起步代）

---

## 二、后端 API 设计

### Step 1：升级 `regional_agent_system.py` — 代理商核心 API

```python
# dragon-senate-saas-v2/regional_agent_system.py — 新增/升级

from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List
from pydantic import BaseModel
from agent_tier_manager import AgentTierManager  # 来自 CODEX-BILLING-001
from seat_quota_tracker import SeatQuotaTracker   # 来自 CODEX-BILLING-001

router = APIRouter(prefix="/api/agent", tags=["代理商管理"])

# ─── 数据模型 ─────────────────────────────────────────────

class AgentProfile(BaseModel):
    """代理商档案"""
    agent_id: str
    company_name: str
    contact_name: str
    contact_phone: str
    contact_wechat: str
    region: str                     # 省/市
    tier: str                       # 起步代理/区域代理/省级代理/总代理
    total_seats_managed: int        # 总管理席位数
    unit_purchase_price: int        # 当前采购价（根据层级自动计算）
    floor_price: int = 1980         # 底线价（任何情况不低于此）
    joined_at: str
    is_active: bool = True

class SeatAssignment(BaseModel):
    """席位分配"""
    seat_id: str
    seat_name: str                  # 账号名称（如"XX品牌抖音账号"）
    platform: str                   # xiaohongshu/douyin/weixin_video/weixin_gzh
    account_username: str           # 平台账号名
    assigned_at: str
    client_name: str                # 这个席位服务的终端客户名称
    
class AgentDashboardData(BaseModel):
    """代理商看板数据"""
    agent_id: str
    tier: str
    total_seats: int
    active_seats: int
    monthly_revenue: int            # 代理转售收入
    platform_cost: int              # 向平台的采购成本
    estimated_net_profit: int       # 预估月净利
    seat_quota_summary: dict        # 所有席位配额汇总
    content_published_this_month: dict  # 本月内容产出统计
    top_performing_seats: list      # 表现最好的5个席位


# ─── API 端点 ──────────────────────────────────────────────

@router.post("/register")
async def register_agent(profile: AgentProfile):
    """
    代理商注册入驻
    
    自动：
    1. 验证席位数（≥20席才能成为代理）
    2. 根据席位数设置采购价（阶梯定价）
    3. 开通代理管理后台权限（白标）
    4. 发送入驻确认（企业微信/邮件）
    """
    from saas_pricing_model import get_seat_unit_price, FLOOR_PRICE
    
    if profile.total_seats_managed < 20:
        raise HTTPException(
            status_code=400,
            detail=f"代理商最低需管理20席，当前申请{profile.total_seats_managed}席"
        )
    
    # 计算采购价（底线保护）
    unit_price = get_seat_unit_price(profile.total_seats_managed)
    if unit_price < FLOOR_PRICE:
        raise HTTPException(status_code=400, detail="采购价低于底线，请联系平台")
    
    # 确定代理层级
    tier_mgr = AgentTierManager()
    tier_info = tier_mgr.get_agent_tier(profile.total_seats_managed)
    
    agent_data = {
        **profile.dict(),
        "tier": tier_info["name"],
        "unit_purchase_price": unit_price,
        "floor_price": FLOOR_PRICE,
        "portal_access_enabled": True,
        "white_label_enabled": profile.total_seats_managed >= 20,
    }
    
    # 保存代理档案
    await db.agents.insert(agent_data)
    
    # 开通管理后台（设置 RBAC 角色）
    await grant_agent_role(profile.agent_id, tier_info["name"])
    
    # 发送入驻通知
    await send_agent_welcome(profile)
    
    return {
        "status": "success",
        "agent_id": profile.agent_id,
        "tier": tier_info["name"],
        "unit_purchase_price": unit_price,
        "portal_url": f"https://agent.dragonsaas.cn/{profile.agent_id}",
        "message": f"欢迎加入 Dragon Senate {tier_info['name']}体系！"
    }


@router.get("/dashboard/{agent_id}")
async def get_agent_dashboard(agent_id: str):
    """
    代理商看板数据（核心 API，前端看板的数据源）
    
    返回：
    - 总席位数、活跃席位数
    - 本月内容产出统计（视频/图片/客服互动）
    - 每席配额使用率
    - 预估收入和利润
    - 表现最好/最差的席位
    """
    agent = await db.agents.find_one({"agent_id": agent_id})
    if not agent:
        raise HTTPException(status_code=404, detail="代理商不存在")
    
    # 获取代理管理的所有席位
    seats = await db.seat_assignments.find({"agent_id": agent_id}).to_list()
    seat_ids = [s["seat_id"] for s in seats]
    
    # 配额汇总（来自 SeatQuotaTracker）
    tracker = SeatQuotaTracker(redis_client=get_redis())
    quota_summary = await tracker.get_tenant_usage_summary(agent_id, seat_ids)
    
    # 内容发布统计（来自 publish_result_log）
    content_stats = await get_content_stats(agent_id, seat_ids)
    
    # 财务计算
    from saas_pricing_model import get_seat_unit_price, FLOOR_PRICE
    purchase_price = get_seat_unit_price(len(seat_ids))
    resell_price = _get_resell_price(len(seat_ids))
    platform_cost = purchase_price * len(seat_ids)
    resell_revenue = resell_price * len(seat_ids)
    ops_cost = max(20000, len(seat_ids) * 600)
    net_profit = resell_revenue - platform_cost - ops_cost
    
    # 找出最活跃的席位
    seat_scores = []
    for seat in seats:
        sid = seat["seat_id"]
        seat_quota = await tracker.get_seat_usage_summary(sid)
        # 活跃度评分：配额使用率的平均值
        avg_usage = sum(
            v["usage_pct"] for v in seat_quota["quotas"].values()
        ) / len(seat_quota["quotas"])
        seat_scores.append({"seat_id": sid, "seat_name": seat["seat_name"], "score": avg_usage})
    
    top_seats = sorted(seat_scores, key=lambda x: x["score"], reverse=True)[:5]
    
    return AgentDashboardData(
        agent_id=agent_id,
        tier=agent["tier"],
        total_seats=len(seat_ids),
        active_seats=len([s for s in seat_scores if s["score"] > 10]),
        monthly_revenue=resell_revenue,
        platform_cost=platform_cost,
        estimated_net_profit=net_profit,
        seat_quota_summary=quota_summary,
        content_published_this_month=content_stats,
        top_performing_seats=top_seats,
    )


@router.get("/seats/{agent_id}")
async def list_agent_seats(agent_id: str):
    """列出代理管理的所有席位（含配额状态）"""
    seats = await db.seat_assignments.find({"agent_id": agent_id}).to_list()
    tracker = SeatQuotaTracker(redis_client=get_redis())
    
    result = []
    for seat in seats:
        quota = await tracker.get_seat_usage_summary(seat["seat_id"])
        result.append({
            **seat,
            "quota_status": quota["quotas"],
            "overall_health": _calc_seat_health(quota),
        })
    return result


@router.post("/seats/{agent_id}/assign")
async def assign_seat(agent_id: str, assignment: SeatAssignment):
    """为代理分配新席位"""
    # 检查代理是否有权限再分配席位（未超过采购数量）
    current_count = await db.seat_assignments.count({"agent_id": agent_id})
    agent = await db.agents.find_one({"agent_id": agent_id})
    
    if current_count >= agent["total_seats_managed"]:
        raise HTTPException(400, "已达到购买席位上限，请先升级席位数")
    
    # 记录席位分配
    await db.seat_assignments.insert({
        **assignment.dict(),
        "agent_id": agent_id,
        "status": "pending_onboarding",  # 等待边缘节点扫码登录
    })
    
    # 初始化配额
    tracker = SeatQuotaTracker(redis_client=get_redis())
    # 配额由 seat_quota_tracker 自动在首次 consume 时初始化
    
    return {"status": "assigned", "seat_id": assignment.seat_id}


@router.post("/upgrade/{agent_id}")
async def upgrade_agent_tier(agent_id: str, new_seat_count: int):
    """
    代理层级升级（购买更多席位）
    自动重新计算采购价，底线¥1,980保护
    """
    agent = await db.agents.find_one({"agent_id": agent_id})
    old_seats = agent["total_seats_managed"]
    
    from saas_pricing_model import get_seat_unit_price, FLOOR_PRICE
    new_price = max(get_seat_unit_price(new_seat_count), FLOOR_PRICE)
    
    # 检查是否触发层级升级
    tier_mgr = AgentTierManager()
    upgrade_info = tier_mgr.check_tier_upgrade(agent_id, old_seats, new_seat_count)
    
    await db.agents.update(
        {"agent_id": agent_id},
        {
            "total_seats_managed": new_seat_count,
            "unit_purchase_price": new_price,
            "tier": tier_mgr.get_agent_tier(new_seat_count)["name"],
        }
    )
    
    return {
        "status": "upgraded",
        "old_seats": old_seats,
        "new_seats": new_seat_count,
        "new_unit_price": new_price,
        "tier_upgrade": upgrade_info,
    }


@router.get("/roi/{agent_id}")
async def get_agent_roi(agent_id: str):
    """
    代理商 ROI 分析
    显示：采购成本、转售收入、运营成本、月净利、年净利
    """
    agent = await db.agents.find_one({"agent_id": agent_id})
    seats = agent["total_seats_managed"]
    
    from saas_pricing_model import PlatformCostModelV7
    model = PlatformCostModelV7()
    return model.reseller_roi_analysis(seats)


def _get_resell_price(seat_count: int) -> int:
    """代理建议转售价（向下游出售的价格）"""
    if seat_count >= 300:
        return 2980
    elif seat_count >= 100:
        return 3800
    elif seat_count >= 50:
        return 3800
    else:
        return 4800

def _calc_seat_health(quota_summary: dict) -> str:
    """计算席位健康度（基于配额使用率）"""
    avg = sum(v["usage_pct"] for v in quota_summary["quotas"].values()) / len(quota_summary["quotas"])
    if avg < 30:
        return "低活跃"
    elif avg < 70:
        return "正常"
    elif avg < 90:
        return "活跃"
    else:
        return "配额告急"
```

---

## 三、前端看板设计（Tremor + shadcn 组件规格）

### 代理商看板页面结构

```
/agent/{agent_id}/dashboard
├── 顶部 KPI 卡片行（4个）
│   ├── 总席位数（当前/购买上限）
│   ├── 本月内容产出（视频/图文/互动汇总）
│   ├── 预估月净利（¥82,000）
│   └── 配额使用率（XX%）
│
├── 中间：席位列表（TanStack Table）
│   ├── 席位名称 | 平台 | 账号名 | 视频进度 | 图片进度 | 互动进度 | 健康度 | 操作
│   ├── 视频进度：进度条 15/20 条（75%）
│   ├── 健康度：绿/黄/红 badge
│   └── 操作：查看详情 | 重置配额 | 暂停
│
├── 右侧：财务分析（Tremor AreaChart）
│   ├── 采购成本 vs 转售收入（折线图）
│   ├── 月净利趋势
│   └── 席位增长曲线
│
└── 底部：本月内容发布日历（热力图）
    └── 每天发布数量的热力图（Tremor HeatmapChart 或自定义）
```

### API 响应到组件的映射

```typescript
// src/components/agent/AgentDashboard.tsx

interface AgentDashboardProps {
  agentId: string;
}

export function AgentDashboard({ agentId }: AgentDashboardProps) {
  const { data } = useSWR(`/api/agent/dashboard/${agentId}`);
  
  if (!data) return <Skeleton />;
  
  return (
    <div className="space-y-6">
      {/* KPI 卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          title="管理席位"
          value={`${data.active_seats}/${data.total_seats}`}
          subtitle="活跃/总计"
          trend={data.total_seats >= 50 ? "up" : "neutral"}
        />
        <KpiCard
          title="本月视频"
          value={`${data.content_published_this_month.video}条`}
          subtitle={`共${data.total_seats * 20}条配额`}
          usage_pct={data.content_published_this_month.video / (data.total_seats * 20) * 100}
        />
        <KpiCard
          title="预估月净利"
          value={`¥${data.estimated_net_profit.toLocaleString()}`}
          subtitle="采购+运营后"
          color="green"
        />
        <KpiCard
          title="整体配额使用"
          value={`${calcOverallUsage(data.seat_quota_summary)}%`}
          subtitle="所有席位平均"
        />
      </div>
      
      {/* 席位列表 */}
      <SeatsTable agentId={agentId} />
      
      {/* 财务图表 */}
      <AgentFinanceChart agentId={agentId} />
    </div>
  );
}
```

---

## 四、白标支持（20席+代理权益）

```python
# dragon-senate-saas-v2/white_label_service.py
"""
白标服务：龙虾改名为代理品牌的 AI 助理
仅对 20席+ 代理开放
"""

class WhiteLabelService:
    
    async def get_brand_config(self, agent_id: str) -> dict:
        """获取代理的白标配置"""
        agent = await db.agents.find_one({"agent_id": agent_id})
        
        if agent["total_seats_managed"] < 20:
            return {"white_label_enabled": False}
        
        config = await db.white_label_configs.find_one({"agent_id": agent_id})
        if not config:
            # 返回默认龙虾名称
            return {
                "white_label_enabled": True,
                "brand_name": "Dragon Senate",
                "lobster_names": {
                    "commander": "陈指挥",
                    "strategist": "苏思",
                    "radar": "林涛",
                    "inkwriter": "墨小雅",
                    "visualizer": "影子",
                    "dispatcher": "老坚",
                    "echoer": "阿声",
                    "catcher": "铁钩",
                    "followup": "小锤",
                    "abacus": "算无遗策",
                }
            }
        return config
    
    async def update_brand_config(self, agent_id: str, config: dict) -> dict:
        """
        代理自定义白标配置
        
        可以自定义：
        - 品牌名称（如"XX品牌AI运营团队"）
        - 10只龙虾的显示名称（重命名为自家 IP 形象）
        - 看板 Logo 和主题色
        """
        agent = await db.agents.find_one({"agent_id": agent_id})
        if agent["total_seats_managed"] < 20:
            raise HTTPException(403, "白标功能需要20席+代理")
        
        await db.white_label_configs.upsert(
            {"agent_id": agent_id},
            {**config, "agent_id": agent_id, "updated_at": datetime.now().isoformat()}
        )
        return {"status": "updated"}
```

---

## 五、子代理管理（省代管理区域代理）

```python
# dragon-senate-saas-v2/sub_agent_manager.py
"""
子代理管理
场景：省级代理（100席）将席位分配给多个区域代理（20-50席）
"""

class SubAgentManager:
    
    async def create_sub_agent(
        self,
        parent_agent_id: str,
        sub_agent_profile: dict,
        allocated_seats: int
    ) -> dict:
        """
        省代创建子代理（区域代理）
        
        省代向平台采购 ¥2,180/席（100席省代价格）
        省代向区域代理出售 ¥2,480/席（区域代理价格）
        省代每席赚差价 ¥300
        """
        parent = await db.agents.find_one({"agent_id": parent_agent_id})
        
        # 检查省代是否有足够未分配席位
        allocated = await db.sub_agents.sum({"parent_agent_id": parent_agent_id}, "allocated_seats")
        if allocated + allocated_seats > parent["total_seats_managed"]:
            raise HTTPException(400, "省代可分配席位不足")
        
        # 计算子代理的采购价（省代向子代理卖的价格）
        from saas_pricing_model import get_seat_unit_price, FLOOR_PRICE
        parent_purchase_price = get_seat_unit_price(parent["total_seats_managed"])
        # 省代向子代理出售价格 = 子代理层级的正常价格（不低于底线）
        sub_resell_price = max(get_seat_unit_price(allocated_seats), FLOOR_PRICE)
        
        sub_agent = {
            **sub_agent_profile,
            "parent_agent_id": parent_agent_id,
            "allocated_seats": allocated_seats,
            "purchase_price_from_parent": sub_resell_price,
            "tier": "起步代理" if allocated_seats < 50 else "区域代理",
        }
        
        await db.sub_agents.insert(sub_agent)
        
        return {
            "sub_agent_id": sub_agent["agent_id"],
            "allocated_seats": allocated_seats,
            "purchase_price": sub_resell_price,
            "parent_profit_per_seat": sub_resell_price - parent_purchase_price,
        }
    
    async def get_sub_agent_tree(self, root_agent_id: str) -> dict:
        """获取代理树（省代→区域代→起步代）"""
        parent = await db.agents.find_one({"agent_id": root_agent_id})
        children = await db.sub_agents.find({"parent_agent_id": root_agent_id}).to_list()
        
        return {
            "agent": parent,
            "children": [
                await self.get_sub_agent_tree(child["agent_id"])
                for child in children
            ]
        }
```

---

## 六、文件清单

```
dragon-senate-saas-v2/
├── regional_agent_system.py      # 已有，大幅升级（新增 9 个 API 端点）
├── agent_tier_manager.py         # CODEX-BILLING-001 产出，这里直接复用
├── seat_quota_tracker.py         # CODEX-BILLING-001 产出，这里直接复用
├── white_label_service.py        # NEW：白标配置服务
├── sub_agent_manager.py          # NEW：子代理管理
└── app.py                        # 注册新路由

src/components/agent/             # 前端组件目录（NEW）
├── AgentDashboard.tsx            # 代理看板主页
├── SeatsTable.tsx                # 席位管理列表
├── AgentFinanceChart.tsx         # 财务分析图表
├── KpiCard.tsx                   # KPI 卡片组件
└── WhiteLabelConfig.tsx          # 白标配置页
```

---

## 七、验收标准

- [ ] 代理注册接口（20席验证+采购价自动计算）
- [ ] 代理看板 API 返回正确数据（席位数/配额/净利）
- [ ] 席位分配接口（不超过购买数量限制）
- [ ] 代理层级升级（45席→50席触发"区域代理"升级通知）
- [ ] 白标配置（20席+可以重命名10只龙虾）
- [ ] 子代理创建（省代向区域代分配席位）
- [ ] 前端看板展示：KPI卡片 + 席位列表 + 财务图表
- [ ] 底线价 ¥1,980 铁律：子代理分配时也不低于此价
