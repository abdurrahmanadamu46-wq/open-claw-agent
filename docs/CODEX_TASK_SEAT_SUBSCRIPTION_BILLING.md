# CODEX TASK: 席位订阅计费系统落地指南
**任务ID**: CODEX-BILLING-001  
**优先级**: 🔴 P0（商业化最大 Blocker）  
**依赖文件**: `dragon-senate-saas-v2/saas_billing.py`, `saas_pricing_model.py`  
**预计工期**: 3天

---

## 一、任务背景

V7 收费模式已在 `saas_pricing_model.py` 完整定义（6档阶梯 ¥4,800→¥1,980，底线保护，代理分销）。  
但 `saas_billing.py` 目前是骨架代码，缺少：
- 真实支付网关（微信支付/支付宝）
- 订阅生命周期（试用→付费→续费→升降级→欠费暂停→恢复）
- 发票/收据生成
- 代理层级自动升降价

**当前痛点**：无法向客户收款，是商业化的硬阻断。

---

## 二、架构设计

```
┌─────────────────────────────────────────────────────────┐
│              Dragon Senate 计费系统                      │
├─────────────────────────────────────────────────────────┤
│  前端：座席购买页 → Checkout → 支付结果页               │
│  后端：                                                  │
│    seat_subscription_service.py  ← 核心服务             │
│    ├── SeatPlan（席位套餐）                              │
│    ├── Subscription（订阅实例）                          │
│    ├── PaymentGateway（微信/支付宝适配）                 │
│    ├── InvoiceGenerator（发票/收据）                     │
│    └── AgentTierUpgrade（代理层级自动升降）              │
└─────────────────────────────────────────────────────────┘
```

---

## 三、数据模型设计

```python
# dragon-senate-saas-v2/seat_subscription_service.py

from dataclasses import dataclass, field
from datetime import datetime, date
from enum import Enum
from typing import Optional
import uuid

class SubscriptionStatus(Enum):
    TRIAL = "trial"           # 试用中（14天免费）
    ACTIVE = "active"         # 正常付费
    PAST_DUE = "past_due"     # 欠费（宽限期7天）
    SUSPENDED = "suspended"   # 暂停（欠费超7天，服务停止）
    CANCELLED = "cancelled"   # 已取消

class BillingCycle(Enum):
    MONTHLY = "monthly"       # 月付
    ANNUAL = "annual"         # 年付（额外9折，但不低于¥1,980）

@dataclass
class SeatSubscription:
    """席位订阅实例 - 对应一个租户的合同"""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str = ""
    agent_id: Optional[str] = None     # 代理商ID（直签为None）
    
    # 席位配置
    seat_count: int = 1                # 购买席位数（每席=1个社交账号）
    unit_price: int = 4800             # 实际单席月价（经过阶梯折扣后）
    floor_price: int = 1980            # 底线价（任何情况不低于此）
    billing_cycle: BillingCycle = BillingCycle.MONTHLY
    
    # 订阅状态
    status: SubscriptionStatus = SubscriptionStatus.TRIAL
    trial_ends_at: Optional[datetime] = None
    current_period_start: Optional[date] = None
    current_period_end: Optional[date] = None
    
    # 计算字段
    @property
    def monthly_amount(self) -> int:
        """月付金额（分）"""
        return max(self.unit_price, self.floor_price) * self.seat_count
    
    @property
    def annual_amount(self) -> int:
        """年付金额（底线保护）"""
        annual_unit = max(int(self.unit_price * 0.9), self.floor_price)
        return annual_unit * self.seat_count * 12
```

---

## 四、核心实现步骤

### Step 1：升级 `saas_billing.py` — 订阅生命周期

```python
# dragon-senate-saas-v2/saas_billing.py — 新增以下方法

class SeatBillingService:
    
    async def create_subscription(
        self,
        tenant_id: str,
        seat_count: int,
        billing_cycle: str = "monthly",
        agent_id: str = None,
        trial_days: int = 14
    ) -> dict:
        """
        创建席位订阅
        
        自动：
        1. 查 V7 阶梯定价表获取单席价格
        2. 创建14天试用期
        3. 设置首次扣款时间
        4. 初始化席位配额（20视频/30图/500客服）
        5. 发送欢迎邮件
        """
        from saas_pricing_model import get_seat_unit_price, FLOOR_PRICE
        
        unit_price = get_seat_unit_price(seat_count)
        
        # 底线价格保护（铁律）
        if unit_price < FLOOR_PRICE:
            raise ValueError(f"单席价格 {unit_price} 低于底线 {FLOOR_PRICE}，拒绝创建")
        
        subscription = {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "agent_id": agent_id,
            "seat_count": seat_count,
            "unit_price": unit_price,
            "floor_price": FLOOR_PRICE,
            "billing_cycle": billing_cycle,
            "status": "trial",
            "trial_ends_at": (datetime.now() + timedelta(days=trial_days)).isoformat(),
            "monthly_amount": unit_price * seat_count,
            "created_at": datetime.now().isoformat(),
        }
        
        # 持久化
        await self.db.subscriptions.insert(subscription)
        
        # 初始化席位配额
        await self._init_seat_quotas(tenant_id, seat_count)
        
        # 发欢迎消息（通过 lobster_im_channel）
        await self._send_welcome_message(tenant_id, subscription)
        
        return subscription
    
    async def upgrade_seats(self, tenant_id: str, new_seat_count: int) -> dict:
        """
        席位升级（加号）
        
        场景：代理从20席升到50席，价格自动从 ¥2,980 降到 ¥2,480
        按日计算差价，当月剩余天数补差价
        """
        sub = await self.db.subscriptions.find_one({"tenant_id": tenant_id})
        old_count = sub["seat_count"]
        old_price = sub["unit_price"]
        
        from saas_pricing_model import get_seat_unit_price
        new_price = get_seat_unit_price(new_seat_count)
        
        # 差价计算（按剩余天数）
        days_remaining = self._days_remaining_in_period(sub)
        days_in_period = self._days_in_current_period(sub)
        
        # 新增席位的差价
        added_seats = new_seat_count - old_count
        price_diff = new_price - old_price  # 可能是负数（升档降价）
        
        proration = (
            added_seats * new_price * days_remaining / days_in_period
            + old_count * price_diff * days_remaining / days_in_period  # 老席位的降价返还
        )
        
        # 更新订阅
        await self.db.subscriptions.update(
            {"tenant_id": tenant_id},
            {"seat_count": new_seat_count, "unit_price": new_price}
        )
        
        # 扩充配额
        await self._expand_seat_quotas(tenant_id, added_seats)
        
        return {
            "old_seats": old_count,
            "new_seats": new_seat_count,
            "old_unit_price": old_price,
            "new_unit_price": new_price,
            "proration_amount": round(proration),
            "note": f"升至{new_seat_count}席后单席价降至¥{new_price:,}（阶梯折扣）"
        }
    
    async def handle_payment_failed(self, tenant_id: str) -> None:
        """欠费处理流程"""
        sub = await self.db.subscriptions.find_one({"tenant_id": tenant_id})
        
        # 第1次失败：状态→past_due，发短信提醒
        if sub["status"] == "active":
            await self.db.subscriptions.update(
                {"tenant_id": tenant_id},
                {"status": "past_due", "past_due_since": datetime.now().isoformat()}
            )
            await self._send_payment_reminder(tenant_id, "first_reminder")
        
        # 7天后仍未付：暂停服务
        elif sub["status"] == "past_due":
            past_due_days = (datetime.now() - datetime.fromisoformat(sub["past_due_since"])).days
            if past_due_days >= 7:
                await self.db.subscriptions.update(
                    {"tenant_id": tenant_id},
                    {"status": "suspended"}
                )
                # 暂停龙虾执行（不删数据）
                await self._suspend_lobster_execution(tenant_id)
                await self._send_suspension_notice(tenant_id)
```

### Step 2：新建 `payment_gateway.py` — 支付网关

```python
# dragon-senate-saas-v2/payment_gateway.py
"""
支付网关适配器
支持：微信支付 v3 API、支付宝
中国境内收款核心模块

环境变量（secrets，不要硬编码）：
  WECHAT_PAY_MCH_ID
  WECHAT_PAY_PRIVATE_KEY_PATH
  WECHAT_PAY_CERT_SERIAL
  WECHAT_PAY_API_KEY
  ALIPAY_APP_ID
  ALIPAY_PRIVATE_KEY
  ALIPAY_PUBLIC_KEY
"""

import httpx
import hashlib
import hmac
import json
import time
import uuid
from abc import ABC, abstractmethod

class PaymentGatewayBase(ABC):
    @abstractmethod
    async def create_payment(self, amount_fen: int, description: str, out_trade_no: str) -> dict:
        """创建支付订单，返回二维码/支付链接"""
        pass
    
    @abstractmethod
    async def query_payment(self, out_trade_no: str) -> dict:
        """查询支付状态"""
        pass
    
    @abstractmethod
    async def refund(self, out_trade_no: str, refund_amount_fen: int, reason: str) -> dict:
        """退款"""
        pass
    
    @abstractmethod
    def verify_webhook(self, headers: dict, body: bytes) -> bool:
        """验证 Webhook 签名（防伪造）"""
        pass


class WechatPayV3Gateway(PaymentGatewayBase):
    """微信支付 v3 API 适配器"""
    
    BASE_URL = "https://api.mch.weixin.qq.com"
    
    def __init__(self, mch_id: str, private_key: str, cert_serial: str, api_key: str):
        self.mch_id = mch_id
        self.private_key = private_key
        self.cert_serial = cert_serial
        self.api_key = api_key
    
    async def create_payment(self, amount_fen: int, description: str, out_trade_no: str) -> dict:
        """
        创建扫码付款（NATIVE模式）
        返回：{ "code_url": "weixin://..." }  → 前端生成二维码
        """
        body = {
            "appid": "your_appid",
            "mchid": self.mch_id,
            "description": description,
            "out_trade_no": out_trade_no,
            "notify_url": "https://api.dragonsaas.cn/webhooks/wechat-pay",
            "amount": {
                "total": amount_fen,
                "currency": "CNY"
            }
        }
        
        # 签名（微信 v3 RSA-SHA256）
        headers = self._build_auth_headers("POST", "/v3/pay/transactions/native", json.dumps(body))
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.BASE_URL}/v3/pay/transactions/native",
                json=body,
                headers=headers
            )
            resp.raise_for_status()
            return resp.json()
    
    def verify_webhook(self, headers: dict, body: bytes) -> bool:
        """验证微信支付 Webhook 签名"""
        timestamp = headers.get("Wechatpay-Timestamp", "")
        nonce = headers.get("Wechatpay-Nonce", "")
        signature = headers.get("Wechatpay-Signature", "")
        
        message = f"{timestamp}\n{nonce}\n{body.decode()}\n"
        # RSA-SHA256 验证（使用微信平台公钥）
        # 略：具体实现参考微信支付文档
        return True  # placeholder
    
    def _build_auth_headers(self, method: str, url: str, body: str) -> dict:
        """构建微信支付 v3 认证头"""
        timestamp = str(int(time.time()))
        nonce_str = str(uuid.uuid4()).replace("-", "")
        
        message = f"{method}\n{url}\n{timestamp}\n{nonce_str}\n{body}\n"
        # RSA-SHA256 签名
        # 略：使用 cryptography 库
        signature = "calculated_signature"
        
        authorization = (
            f'WECHATPAY2-SHA256-RSA2048 mchid="{self.mch_id}",'
            f'serial_no="{self.cert_serial}",'
            f'nonce_str="{nonce_str}",'
            f'timestamp="{timestamp}",'
            f'signature="{signature}"'
        )
        
        return {
            "Authorization": authorization,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }


class AlipayGateway(PaymentGatewayBase):
    """支付宝 SDK 适配器（扫码付/电脑网站付）"""
    
    async def create_payment(self, amount_fen: int, description: str, out_trade_no: str) -> dict:
        amount_yuan = amount_fen / 100  # 支付宝用元
        # 使用 alipay-sdk-python
        # alipay.api_alipay_trade_precreate(...)
        return {"qr_code": "https://qr.alipay.com/xxx"}
    
    def verify_webhook(self, headers: dict, body: bytes) -> bool:
        # 支付宝异步通知签名验证
        return True


# 工厂函数
def get_payment_gateway(channel: str = "wechat") -> PaymentGatewayBase:
    import os
    if channel == "wechat":
        return WechatPayV3Gateway(
            mch_id=os.environ["WECHAT_PAY_MCH_ID"],
            private_key=open(os.environ["WECHAT_PAY_PRIVATE_KEY_PATH"]).read(),
            cert_serial=os.environ["WECHAT_PAY_CERT_SERIAL"],
            api_key=os.environ["WECHAT_PAY_API_KEY"],
        )
    elif channel == "alipay":
        return AlipayGateway()
    raise ValueError(f"Unknown payment channel: {channel}")
```

### Step 3：新建 `seat_quota_tracker.py` — 席位配额实时追踪

```python
# dragon-senate-saas-v2/seat_quota_tracker.py
"""
席位配额追踪器
V7 每席月度配额：
  video: 20条
  image: 30张
  dh_service: 500次（echoer 客服）
  dh_sales: 30次（catcher/followup 销售）
  llm_tasks: 50次

存储：Redis（实时） + PostgreSQL（月度归档）
"""

import json
from datetime import datetime, date
from typing import Optional
import redis.asyncio as aioredis

# V7 标准配额（每席每月）
SEAT_MONTHLY_QUOTAS = {
    "video": 20,
    "image": 30,
    "dh_service": 500,
    "dh_sales": 30,
    "llm_tasks": 50,
}

class SeatQuotaTracker:
    
    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
    
    def _quota_key(self, seat_id: str, resource: str, month: Optional[str] = None) -> str:
        """Redis key 格式：quota:{seat_id}:{resource}:{YYYY-MM}"""
        m = month or date.today().strftime("%Y-%m")
        return f"quota:{seat_id}:{resource}:{m}"
    
    async def consume(self, seat_id: str, resource: str, count: int = 1) -> dict:
        """
        消耗配额，返回消耗结果
        
        示例：
          await quota.consume("seat_abc", "video", 1)
          → {"allowed": True, "used": 15, "limit": 20, "remaining": 5}
        
        如果超额：
          → {"allowed": False, "used": 20, "limit": 20, "remaining": 0, "error": "quota_exceeded"}
        """
        limit = SEAT_MONTHLY_QUOTAS.get(resource)
        if limit is None:
            raise ValueError(f"Unknown resource type: {resource}")
        
        key = self._quota_key(seat_id, resource)
        
        # 原子性检查+扣减（Lua 脚本，防并发超额）
        lua_script = """
        local current = tonumber(redis.call('GET', KEYS[1]) or '0')
        local limit = tonumber(ARGV[1])
        local count = tonumber(ARGV[2])
        if current + count > limit then
            return {current, 0}  -- 超额，拒绝
        end
        local new = redis.call('INCRBY', KEYS[1], count)
        -- 设置到月末过期
        local ttl = redis.call('TTL', KEYS[1])
        if ttl < 0 then
            redis.call('EXPIRE', KEYS[1], 2678400)  -- ~31天
        end
        return {new, 1}  -- 成功
        """
        
        result = await self.redis.eval(lua_script, 1, key, limit, count)
        used, success = int(result[0]), int(result[1])
        
        return {
            "allowed": bool(success),
            "seat_id": seat_id,
            "resource": resource,
            "used": used,
            "limit": limit,
            "remaining": max(0, limit - used),
            "error": None if success else "quota_exceeded",
        }
    
    async def get_seat_usage_summary(self, seat_id: str) -> dict:
        """获取席位本月配额使用汇总（用于前端进度条显示）"""
        summary = {}
        for resource, limit in SEAT_MONTHLY_QUOTAS.items():
            key = self._quota_key(seat_id, resource)
            used = int(await self.redis.get(key) or 0)
            summary[resource] = {
                "used": used,
                "limit": limit,
                "remaining": max(0, limit - used),
                "usage_pct": round(used / limit * 100, 1),
                "status": "warning" if used / limit > 0.8 else "normal",
            }
        return {"seat_id": seat_id, "quotas": summary, "month": date.today().strftime("%Y-%m")}
    
    async def get_tenant_usage_summary(self, tenant_id: str, seat_ids: list[str]) -> dict:
        """代理商看板：汇总所有席位用量"""
        totals = {r: {"used": 0, "limit": 0} for r in SEAT_MONTHLY_QUOTAS}
        
        for seat_id in seat_ids:
            seat_summary = await self.get_seat_usage_summary(seat_id)
            for resource, data in seat_summary["quotas"].items():
                totals[resource]["used"] += data["used"]
                totals[resource]["limit"] += data["limit"]
        
        return {
            "tenant_id": tenant_id,
            "total_seats": len(seat_ids),
            "totals": totals,
            "month": date.today().strftime("%Y-%m"),
        }
```

### Step 4：新建 `agent_tier_manager.py` — 代理层级自动升降

```python
# dragon-senate-saas-v2/agent_tier_manager.py
"""
代理商层级自动管理
V7 层级：起步代理(20席) → 区域代理(50席) → 省级代理(100席) → 总代理(300席+)
底线保护：任何层级单席价不低于 ¥1,980
"""

from saas_pricing_model import SEAT_PRICE_TIERS, FLOOR_PRICE, get_seat_unit_price

AGENT_TIER_DEFINITIONS = [
    {"name": "品牌直签",   "min_seats": 1,   "max_seats": 19,  "label": "非代理"},
    {"name": "起步代理",   "min_seats": 20,  "max_seats": 49,  "purchase_price": 2980},
    {"name": "区域代理",   "min_seats": 50,  "max_seats": 99,  "purchase_price": 2480},
    {"name": "省级代理",   "min_seats": 100, "max_seats": 299, "purchase_price": 2180},
    {"name": "总代理",     "min_seats": 300, "max_seats": 9999,"purchase_price": 1980},
]

class AgentTierManager:
    
    def get_agent_tier(self, total_seats: int) -> dict:
        """根据总席位数获取代理层级"""
        for tier in AGENT_TIER_DEFINITIONS:
            if tier["min_seats"] <= total_seats <= tier["max_seats"]:
                unit_price = get_seat_unit_price(total_seats)
                return {
                    **tier,
                    "total_seats": total_seats,
                    "unit_price": max(unit_price, FLOOR_PRICE),
                    "floor_price": FLOOR_PRICE,
                    "floor_enforced": unit_price < FLOOR_PRICE,
                }
        return AGENT_TIER_DEFINITIONS[-1]
    
    def check_tier_upgrade(self, agent_id: str, old_seats: int, new_seats: int) -> Optional[dict]:
        """检查是否触发层级升级，返回升级通知"""
        old_tier = self.get_agent_tier(old_seats)
        new_tier = self.get_agent_tier(new_seats)
        
        if old_tier["name"] != new_tier["name"]:
            return {
                "agent_id": agent_id,
                "upgraded": True,
                "from_tier": old_tier["name"],
                "to_tier": new_tier["name"],
                "old_unit_price": old_tier["unit_price"],
                "new_unit_price": new_tier["unit_price"],
                "price_savings_per_seat": old_tier["unit_price"] - new_tier["unit_price"],
                "message": (
                    f"恭喜！您已升级为「{new_tier['name']}」🎉\n"
                    f"单席采购价从 ¥{old_tier['unit_price']:,} 降至 ¥{new_tier['unit_price']:,}\n"
                    f"每席每月节省 ¥{old_tier['unit_price'] - new_tier['unit_price']:,}"
                )
            }
        return None
    
    def validate_floor_price(self, unit_price: int) -> bool:
        """底线价格铁律检查（任何情况不低于 ¥1,980）"""
        return unit_price >= FLOOR_PRICE
```

---

## 五、API 路由（接入 `app.py`）

```python
# 新增路由到 dragon-senate-saas-v2/app.py

@app.post("/api/billing/subscribe")
async def create_subscription(req: SubscribeRequest):
    """客户/代理创建席位订阅"""
    service = SeatBillingService(db=get_db())
    sub = await service.create_subscription(
        tenant_id=req.tenant_id,
        seat_count=req.seat_count,
        billing_cycle=req.billing_cycle,
        agent_id=req.agent_id,
    )
    return sub

@app.post("/api/billing/checkout")
async def create_checkout(req: CheckoutRequest):
    """创建支付二维码（微信/支付宝）"""
    gateway = get_payment_gateway(req.channel)
    sub = await get_subscription(req.subscription_id)
    payment = await gateway.create_payment(
        amount_fen=sub["monthly_amount"] * 100,
        description=f"Dragon Senate {sub['seat_count']}席/月",
        out_trade_no=f"ds_{req.subscription_id}_{int(time.time())}",
    )
    return payment

@app.post("/api/webhooks/wechat-pay")
async def wechat_pay_webhook(request: Request):
    """微信支付回调"""
    body = await request.body()
    gateway = get_payment_gateway("wechat")
    
    if not gateway.verify_webhook(dict(request.headers), body):
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    data = json.loads(body)
    out_trade_no = data["out_trade_no"]
    # 解析 subscription_id，标记付款成功
    await mark_subscription_paid(out_trade_no)
    return {"code": "SUCCESS", "message": "成功"}

@app.get("/api/billing/quota/{tenant_id}")
async def get_quota_summary(tenant_id: str):
    """获取租户所有席位配额汇总"""
    tracker = SeatQuotaTracker(redis_client=get_redis())
    seat_ids = await get_tenant_seat_ids(tenant_id)
    return await tracker.get_tenant_usage_summary(tenant_id, seat_ids)
```

---

## 六、环境变量（.env.example 新增）

```env
# 微信支付 v3
WECHAT_PAY_MCH_ID=your_mch_id
WECHAT_PAY_PRIVATE_KEY_PATH=/secrets/wechat_pay_private_key.pem
WECHAT_PAY_CERT_SERIAL=your_cert_serial
WECHAT_PAY_API_KEY=your_api_key_v3

# 支付宝
ALIPAY_APP_ID=your_app_id
ALIPAY_PRIVATE_KEY=your_private_key
ALIPAY_PUBLIC_KEY=alipay_public_key

# 配额追踪 Redis（可复用现有 Redis 实例）
QUOTA_REDIS_URL=redis://localhost:6379/2
```

---

## 七、测试用例

```python
# dragon-senate-saas-v2/tests/test_billing.py

def test_floor_price_enforcement():
    """底线价 ¥1,980 铁律测试"""
    from saas_pricing_model import get_seat_unit_price, FLOOR_PRICE
    # 300席+应该正好是底线价
    assert get_seat_unit_price(300) == FLOOR_PRICE
    assert get_seat_unit_price(1000) == FLOOR_PRICE
    # 任何价格不低于底线
    for seats in [1, 5, 20, 50, 100, 300, 500]:
        assert get_seat_unit_price(seats) >= FLOOR_PRICE

def test_quota_consume_atomic():
    """配额原子性扣减测试（防超额）"""
    # 并发20个请求同时消耗同一席位的最后1条视频
    # 预期：只有1个请求成功，其余19个返回 quota_exceeded

def test_agent_tier_upgrade():
    """代理层级自动升级测试"""
    mgr = AgentTierManager()
    result = mgr.check_tier_upgrade("agent_001", old_seats=45, new_seats=50)
    assert result["upgraded"] is True
    assert result["to_tier"] == "区域代理"
    assert result["new_unit_price"] == 2480
```

---

## 八、验收标准

- [ ] 创建订阅接口正常，返回订阅ID和试用期
- [ ] 微信支付二维码正常生成（需真实 MCH_ID）
- [ ] Webhook 回调正确标记付款成功
- [ ] 席位配额原子扣减，并发不超额
- [ ] 300席底线价¥1,980保护（单测覆盖）
- [ ] 代理升级到50席时收到升级通知
- [ ] 欠费7天后服务暂停（龙虾停止执行）
- [ ] 代理看板可以看到所有席位配额用量汇总
