# CODEX TASK: 代理商佣金自动结算系统落地指南
**任务ID**: CODEX-AGENT-COMMISSION-001  
**优先级**: 🟡 P2（代理体系规模化的关键，ERPNext合伙伙伴管理理念落地）  
**依赖文件**: `dragon-senate-saas-v2/regional_agent_system.py`, `saas_billing.py`, `saas_pricing_model.py`  
**参考来源**: ERPNext 合作伙伴管理模块设计理念（非直接安装 ERPNext）  
**预计工期**: 3天

---

## 一、任务背景

V7 代理体系目前缺少**佣金自动结算**能力：
- 代理采购价已在 `saas_pricing_model.py` 定义（¥1,980~¥2,980/席）
- 代理转售价已在 `regional_agent_system.py` 定义（¥2,980~¥4,800/席）
- **但缺少**：月底自动结算、代理利润对账单、超量奖励机制

**ERPNext 借鉴的核心理念**：
1. **合伙伙伴台账**：每个代理有独立的采购/销售/利润台账
2. **月结佣金**：月末自动计算（转售收入 - 采购成本 - 运营成本）
3. **分级奖励**：超额完成业绩目标时给额外奖励
4. **在线查看**：代理可以实时查看自己的账期和利润

**财务影响**：
- 没有自动结算 → 代理不信任平台（担心账目不透明）
- 有透明账单 → 代理主动拓客（知道每招一个客户能多赚多少）

---

## 二、数据模型设计

```python
# dragon-senate-saas-v2/agent_commission_service.py
"""
代理商佣金自动结算引擎
V7 代理利润模型：
  采购价（平台→代理）：¥1,980~¥2,980/席
  转售价（代理→客户）：¥2,980~¥4,800/席
  代理月净利 = 转售收入 - 平台采购费 - 运营成本
  
超额奖励：
  超额完成季度目标席位数的10%以上 → 下季度采购价再降5%（不低于¥1,980底线）
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional, List
from enum import Enum
import uuid


class SettlementStatus(Enum):
    PENDING = "pending"         # 待结算（月末前）
    CALCULATED = "calculated"   # 已计算（等待代理确认）
    CONFIRMED = "confirmed"     # 代理已确认
    PAID = "paid"               # 已打款（代理预付款场景）
    DISPUTED = "disputed"       # 有争议


@dataclass
class MonthlyStatement:
    """代理月度对账单"""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    agent_id: str = ""
    period: str = ""                    # 格式：2026-04
    
    # 席位情况
    seats_purchased: int = 0            # 本月购买总席位数（合同数）
    seats_active: int = 0              # 本月实际活跃席位数
    
    # 采购（代理向平台）
    purchase_unit_price: int = 0        # 代理采购单价（按层级）
    total_purchase_cost: int = 0        # 采购总成本
    
    # 转售（代理向客户）
    resell_unit_price: int = 0          # 转售单价
    total_resell_revenue: int = 0       # 转售总收入
    
    # 利润
    gross_profit: int = 0               # 毛利润
    ops_cost_estimate: int = 0          # 运营成本估算（¥600/席/月）
    net_profit: int = 0                 # 净利润
    gross_margin_pct: float = 0.0       # 毛利率
    
    # 奖励机制
    bonus_seats_threshold: int = 0      # 本季度目标席位数
    bonus_achieved: bool = False        # 是否超额完成（超10%）
    bonus_description: str = ""         # 奖励描述（如"下季度采购价降5%"）
    
    # 状态
    status: SettlementStatus = SettlementStatus.PENDING
    calculated_at: Optional[str] = None
    confirmed_at: Optional[str] = None
    agent_confirmed_by: Optional[str] = None  # 代理确认人
    
    # 发票
    invoice_url: Optional[str] = None   # 电子发票下载链接


@dataclass  
class CommissionTier:
    """佣金档位（超额奖励阶梯）"""
    achievement_rate: float     # 目标达成率（如 1.1 = 超额10%）
    next_quarter_discount: float  # 下季度采购价折扣（如 0.05 = 再降5%）
    bonus_label: str            # 奖励标签描述
```

---

## 三、核心结算引擎

```python
# dragon-senate-saas-v2/agent_commission_service.py（续）

from saas_pricing_model import get_seat_unit_price, FLOOR_PRICE

# 超额奖励阶梯（V7 设定）
COMMISSION_TIERS = [
    CommissionTier(achievement_rate=1.5, next_quarter_discount=0.10, bonus_label="超额50%+：下季度采购价再降10%"),
    CommissionTier(achievement_rate=1.3, next_quarter_discount=0.07, bonus_label="超额30%+：下季度采购价再降7%"),
    CommissionTier(achievement_rate=1.1, next_quarter_discount=0.05, bonus_label="超额10%+：下季度采购价再降5%"),
]

class AgentCommissionService:
    
    async def calculate_monthly_statement(
        self,
        agent_id: str,
        period: str = None  # 格式：YYYY-MM，默认上个月
    ) -> MonthlyStatement:
        """
        计算代理月度对账单
        
        每月1日自动触发（前月结算）
        """
        if period is None:
            from datetime import datetime, timedelta
            last_month = datetime.now().replace(day=1) - timedelta(days=1)
            period = last_month.strftime("%Y-%m")
        
        agent = await self.db.agents.find_one({"agent_id": agent_id})
        seats = agent["total_seats_managed"]
        
        # 采购价（底线¥1,980）
        purchase_price = get_seat_unit_price(seats)
        
        # 转售价（代理向客户）
        resell_price = self._get_resell_price(seats)
        
        # 活跃席位（从配额系统查询实际使用过的席位数）
        active_seats = await self._count_active_seats(agent_id, period)
        
        # 财务计算
        total_purchase = purchase_price * seats
        total_resell = resell_price * active_seats  # 只对活跃席位结算
        gross_profit = total_resell - total_purchase
        ops_cost = max(20_000, seats * 600)
        net_profit = gross_profit - ops_cost
        gross_margin = round(gross_profit / total_resell * 100, 1) if total_resell else 0
        
        # 检查超额奖励
        quarterly_target = await self._get_quarterly_target(agent_id, period)
        bonus_info = self._calc_bonus(seats, quarterly_target)
        
        stmt = MonthlyStatement(
            agent_id=agent_id,
            period=period,
            seats_purchased=seats,
            seats_active=active_seats,
            purchase_unit_price=purchase_price,
            total_purchase_cost=total_purchase,
            resell_unit_price=resell_price,
            total_resell_revenue=total_resell,
            gross_profit=gross_profit,
            ops_cost_estimate=ops_cost,
            net_profit=net_profit,
            gross_margin_pct=gross_margin,
            bonus_seats_threshold=quarterly_target,
            bonus_achieved=bonus_info.get("achieved", False),
            bonus_description=bonus_info.get("description", ""),
            status=SettlementStatus.CALCULATED,
            calculated_at=datetime.now().isoformat(),
        )
        
        # 持久化
        await self.db.monthly_statements.insert(stmt.__dict__)
        
        # 通知代理（企业微信/邮件）
        await self._notify_agent_statement_ready(agent, stmt)
        
        return stmt
    
    async def batch_calculate_all_agents(self, period: str = None) -> dict:
        """
        批量结算所有代理（每月1日凌晨2点定时任务）
        """
        agents = await self.db.agents.find({"is_active": True}).to_list()
        
        results = {"success": [], "failed": []}
        for agent in agents:
            try:
                stmt = await self.calculate_monthly_statement(agent["agent_id"], period)
                results["success"].append({
                    "agent_id": agent["agent_id"],
                    "net_profit": stmt.net_profit,
                    "period": period,
                })
            except Exception as e:
                results["failed"].append({
                    "agent_id": agent["agent_id"],
                    "error": str(e),
                })
        
        return results
    
    async def agent_confirm_statement(
        self,
        agent_id: str,
        period: str,
        confirmed_by: str,
    ) -> dict:
        """
        代理确认对账单
        
        代理查看后点击"确认无误"，状态变更为 confirmed
        确认后系统自动：
        1. 生成电子发票（通过税务 API）
        2. 如有超额奖励，更新下季度采购价
        3. 记录到台账
        """
        stmt = await self.db.monthly_statements.find_one({
            "agent_id": agent_id,
            "period": period,
        })
        
        if not stmt:
            raise ValueError(f"对账单不存在：{agent_id} / {period}")
        
        if stmt["status"] == SettlementStatus.CONFIRMED.value:
            raise ValueError("对账单已确认")
        
        # 更新状态
        await self.db.monthly_statements.update(
            {"agent_id": agent_id, "period": period},
            {
                "status": SettlementStatus.CONFIRMED.value,
                "confirmed_at": datetime.now().isoformat(),
                "agent_confirmed_by": confirmed_by,
            }
        )
        
        # 如有超额奖励，更新下季度采购价
        if stmt.get("bonus_achieved"):
            await self._apply_next_quarter_discount(agent_id, stmt)
        
        # 生成电子发票（接入税务局电子发票平台）
        invoice_url = await self._generate_invoice(agent_id, stmt)
        await self.db.monthly_statements.update(
            {"agent_id": agent_id, "period": period},
            {"invoice_url": invoice_url}
        )
        
        return {
            "status": "confirmed",
            "period": period,
            "net_profit": stmt["net_profit"],
            "invoice_url": invoice_url,
            "bonus_applied": stmt.get("bonus_achieved", False),
        }
    
    async def dispute_statement(
        self,
        agent_id: str,
        period: str,
        reason: str,
    ) -> dict:
        """
        代理对对账单提出争议
        通知平台客服处理，状态变更为 disputed
        """
        await self.db.monthly_statements.update(
            {"agent_id": agent_id, "period": period},
            {
                "status": SettlementStatus.DISPUTED.value,
                "dispute_reason": reason,
                "disputed_at": datetime.now().isoformat(),
            }
        )
        
        # 通知平台客服
        await self._notify_platform_dispute(agent_id, period, reason)
        
        return {"status": "disputed", "message": "争议已提交，客服将在24小时内联系您"}
    
    def _calc_bonus(self, actual_seats: int, target_seats: int) -> dict:
        """计算超额奖励"""
        if target_seats <= 0:
            return {"achieved": False, "description": ""}
        
        rate = actual_seats / target_seats
        
        for tier in COMMISSION_TIERS:
            if rate >= tier.achievement_rate:
                return {
                    "achieved": True,
                    "achievement_rate": rate,
                    "discount": tier.next_quarter_discount,
                    "description": tier.bonus_label,
                }
        
        return {"achieved": False, "description": ""}
    
    async def _apply_next_quarter_discount(self, agent_id: str, stmt: dict):
        """
        应用超额奖励：下季度采购价再降折扣
        底线保护：折后价不低于 ¥1,980
        """
        agent = await self.db.agents.find_one({"agent_id": agent_id})
        current_price = agent["unit_purchase_price"]
        discount = stmt.get("bonus_discount", 0.05)
        
        new_price = max(
            int(current_price * (1 - discount)),
            FLOOR_PRICE  # ¥1,980 铁律
        )
        
        await self.db.agents.update(
            {"agent_id": agent_id},
            {
                "unit_purchase_price": new_price,
                "price_note": f"超额奖励：从¥{current_price:,}降至¥{new_price:,}/席",
            }
        )
    
    async def _count_active_seats(self, agent_id: str, period: str) -> int:
        """统计本月实际产生内容的活跃席位数"""
        # 从 publish_result_log 查询本月有发布记录的 seat_id 数量
        active = await self.db.publish_results.distinct(
            "seat_id",
            {"agent_id": agent_id, "period": period, "status": "published"}
        )
        return len(active)
    
    async def _get_quarterly_target(self, agent_id: str, period: str) -> int:
        """获取当季度的目标席位数（由平台在季度初设定）"""
        target = await self.db.quarterly_targets.find_one({
            "agent_id": agent_id,
            "quarter": self._get_quarter(period),
        })
        return target["target_seats"] if target else 0
    
    def _get_resell_price(self, seat_count: int) -> int:
        """代理转售价（向下游出售的价格）"""
        if seat_count >= 300:
            return 2_980
        elif seat_count >= 100:
            return 3_800
        elif seat_count >= 50:
            return 3_800
        else:
            return 4_800
    
    def _get_quarter(self, period: str) -> str:
        """从 YYYY-MM 获取季度标识，如 2026-Q2"""
        year, month = map(int, period.split("-"))
        q = (month - 1) // 3 + 1
        return f"{year}-Q{q}"
    
    async def _notify_agent_statement_ready(self, agent: dict, stmt: MonthlyStatement):
        """通知代理对账单已生成"""
        from lobster_im_channel import LobsterIMChannel
        channel = LobsterIMChannel()
        message = (
            f"📊 {stmt.period} 月度对账单已生成\n"
            f"管理席位：{stmt.seats_purchased}席（活跃{stmt.seats_active}席）\n"
            f"预估月净利：¥{stmt.net_profit:,}\n"
            f"{'🎉 ' + stmt.bonus_description if stmt.bonus_achieved else ''}\n"
            f"请登录代理后台确认：https://agent.dragonsaas.cn/{agent['agent_id']}/statements"
        )
        await channel.send_to_agent(agent["contact_wechat"], message)
    
    async def _generate_invoice(self, agent_id: str, stmt: dict) -> str:
        """对接电子发票平台生成发票（后续集成税务 API）"""
        # 暂时返回 placeholder，后续接入税务局电子发票 API
        return f"https://invoice.dragonsaas.cn/{agent_id}/{stmt['period']}.pdf"
    
    async def _notify_platform_dispute(self, agent_id: str, period: str, reason: str):
        """通知平台客服处理争议"""
        # 发到平台内部企业微信群
        pass


# ═══════════════════════════════════════════════════════════
# 结算定时任务（每月1日凌晨2点执行）
# ═══════════════════════════════════════════════════════════

async def monthly_settlement_cron():
    """
    月度结算定时任务
    部署：接入 APScheduler v4（edge_heartbeat 中已有调度器）
    或接入 Temporal（CODEX_TASK_TEMPORAL 中已有设计）
    """
    from datetime import datetime, timedelta
    last_month = (datetime.now().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    
    service = AgentCommissionService()
    result = await service.batch_calculate_all_agents(period=last_month)
    
    print(f"月度结算完成：{last_month}")
    print(f"成功：{len(result['success'])} 个代理")
    print(f"失败：{len(result['failed'])} 个代理")
    
    if result["failed"]:
        # 通知运营团队处理失败的结算
        for failure in result["failed"]:
            print(f"  ❌ {failure['agent_id']}: {failure['error']}")
```

---

## 四、API 路由

```python
# 新增到 dragon-senate-saas-v2/app.py

@app.get("/api/agent/{agent_id}/statements")
async def list_statements(agent_id: str):
    """查看代理所有对账单列表"""
    stmts = await db.monthly_statements.find(
        {"agent_id": agent_id}
    ).sort("period", -1).to_list(24)  # 最近2年
    return stmts

@app.get("/api/agent/{agent_id}/statements/{period}")
async def get_statement_detail(agent_id: str, period: str):
    """查看指定月份对账单详情"""
    stmt = await db.monthly_statements.find_one({
        "agent_id": agent_id,
        "period": period,
    })
    if not stmt:
        raise HTTPException(404, "对账单不存在")
    return stmt

@app.post("/api/agent/{agent_id}/statements/{period}/confirm")
async def confirm_statement(agent_id: str, period: str, confirmed_by: str):
    """代理确认对账单"""
    service = AgentCommissionService()
    return await service.agent_confirm_statement(agent_id, period, confirmed_by)

@app.post("/api/agent/{agent_id}/statements/{period}/dispute")
async def dispute_statement(agent_id: str, period: str, reason: str):
    """代理对账单提出争议"""
    service = AgentCommissionService()
    return await service.dispute_statement(agent_id, period, reason)

@app.get("/api/agent/{agent_id}/profit-forecast")
async def profit_forecast(agent_id: str):
    """代理利润预测（基于当前席位数和转售价）"""
    agent = await db.agents.find_one({"agent_id": agent_id})
    from saas_pricing_model import PlatformCostModelV7
    model = PlatformCostModelV7()
    return model.reseller_roi_analysis(agent["total_seats_managed"])

# 平台内部 API：触发手动结算（运营用）
@app.post("/api/admin/settlement/trigger")
async def trigger_manual_settlement(period: str, admin_token: str):
    """手动触发月度结算（测试/补算用）"""
    if admin_token != os.environ["ADMIN_SECRET"]:
        raise HTTPException(403, "无权限")
    service = AgentCommissionService()
    return await service.batch_calculate_all_agents(period=period)
```

---

## 五、前端对账单页面规格

```typescript
// src/components/agent/StatementList.tsx

export function StatementList({ agentId }: { agentId: string }) {
  const { data: statements } = useSWR(`/api/agent/${agentId}/statements`);
  
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>结算月份</TableHead>
          <TableHead>管理席位</TableHead>
          <TableHead>活跃席位</TableHead>
          <TableHead>转售收入</TableHead>
          <TableHead>平台成本</TableHead>
          <TableHead>月净利</TableHead>
          <TableHead>超额奖励</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {statements?.map((stmt) => (
          <TableRow key={stmt.period}>
            <TableCell>{stmt.period}</TableCell>
            <TableCell>{stmt.seats_purchased}席</TableCell>
            <TableCell>{stmt.seats_active}席</TableCell>
            <TableCell>¥{stmt.total_resell_revenue.toLocaleString()}</TableCell>
            <TableCell>¥{stmt.total_purchase_cost.toLocaleString()}</TableCell>
            <TableCell className="font-bold text-green-600">
              ¥{stmt.net_profit.toLocaleString()}
            </TableCell>
            <TableCell>
              {stmt.bonus_achieved 
                ? <Badge color="gold">🎉 {stmt.bonus_description}</Badge>
                : <span className="text-gray-400">—</span>
              }
            </TableCell>
            <TableCell>
              <StatusBadge status={stmt.status} />
            </TableCell>
            <TableCell>
              {stmt.status === "calculated" && (
                <Button onClick={() => confirmStatement(agentId, stmt.period)}>
                  确认无误
                </Button>
              )}
              {stmt.invoice_url && (
                <a href={stmt.invoice_url} target="_blank">下载发票</a>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

---

## 六、验收标准

- [ ] 月度对账单自动计算（每月1日凌晨2点触发）
- [ ] 对账单包含：席位数/采购成本/转售收入/净利润
- [ ] 超额奖励计算（超10%→降5%，超30%→降7%，超50%→降10%）
- [ ] 奖励折扣不低于¥1,980底线（铁律保护）
- [ ] 代理在线确认对账单（确认后状态变更）
- [ ] 代理提交争议（24小时内客服响应）
- [ ] 对账单确认后自动生成电子发票链接
- [ ] 前端对账单列表页（含净利润、奖励状态）
- [ ] 定时任务正确执行（APScheduler集成）
