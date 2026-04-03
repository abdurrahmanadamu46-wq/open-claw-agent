# CODEX TASK: Docuseal 代理电子合同自动签署系统
**任务ID**: CODEX-DOCUSEAL-001  
**优先级**: 🟡 P2（代理入驻合规化，20席+ 代理签约必备）  
**依赖文件**: `dragon-senate-saas-v2/regional_agent_system.py`, `saas_pricing_model.py`  
**参考项目**: Docuseal（https://github.com/docusealco/docuseal）开源电子签名  
**预计工期**: 2天  
**部署方式**: Docker 自托管 Docuseal（数据留在自己服务器，合规）

---

## 一、任务背景

V7 代理体系中，代理协议签署是**入驻必经环节**：
- 起步代理（20席）：需要签署《代理合作协议》+ 《价格保密协议》
- 区域代理（50席+）：需要额外签署《区域独家协议》
- 省级代理（100席+）：需要签署《省级代理框架合同》+ 《资金往来协议》

**当前痛点**：
- 目前靠人工微信传文件、钉钉签署 → 流程慢（等待2-3天）
- 签署完的合同分散在各人电脑 → 无法统一管理
- 平台没有合同归档和检索能力

**Docuseal 借鉴理由**：
- 开源可自托管（数据不出境，合规）
- 支持 API 调用（程序化触发签署流程）
- 支持模板管理（一套模板套用所有代理）
- 支持短信/邮件/链接方式送达签署请求
- 代理在手机上即可完成签署（无需安装 App）

---

## 二、Docker 自托管部署

```yaml
# docker-compose.docuseal.yml

version: '3.8'

services:
  docuseal:
    image: docuseal/docuseal:latest
    ports:
      - "3000:3000"
    volumes:
      - /data/docuseal:/data
    environment:
      - SECRET_KEY_BASE=${DOCUSEAL_SECRET}        # 随机生成的加密密钥
      - DATABASE_URL=postgresql://docuseal:${DB_PASS}@db/docuseal
      - SMTP_ADDRESS=${SMTP_HOST}
      - SMTP_PORT=587
      - SMTP_USER=${SMTP_USER}
      - SMTP_PASSWORD=${SMTP_PASS}
      - SMTP_FROM=contracts@dragonsaas.cn
    depends_on:
      - db
    restart: unless-stopped
    
  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=docuseal
      - POSTGRES_USER=docuseal
      - POSTGRES_PASSWORD=${DB_PASS}
    volumes:
      - /data/docuseal-db:/var/lib/postgresql/data
    restart: unless-stopped
```

---

## 三、合同模板设计

```
合同类型（Docuseal 模板 ID）：
  TEMPLATE_STARTER_AGENT     = "tpl_starter_001"    # 起步代理协议（20席）
  TEMPLATE_REGIONAL_AGENT    = "tpl_regional_001"   # 区域代理协议（50席+）
  TEMPLATE_PROVINCIAL_AGENT  = "tpl_provincial_001" # 省级代理框架合同（100席+）
  TEMPLATE_CONFIDENTIALITY   = "tpl_nda_001"        # 价格保密协议（所有代理必签）

合同变量（Docuseal 动态字段）：
  {{agent_company}}       → 代理公司名称
  {{agent_name}}          → 代理联系人姓名
  {{agent_region}}        → 负责区域（省/市）
  {{seat_count}}          → 购买席位数
  {{unit_price}}          → 采购单价（¥/席/月）
  {{monthly_total}}       → 月度采购总额
  {{contract_start_date}} → 合同起始日期
  {{contract_term}}       → 合同期限（12个月/24个月）
  {{floor_price}}         → 底线价格（¥1,980，印在合同上作为保障）
```

---

## 四、核心集成代码

```python
# dragon-senate-saas-v2/contract_service.py
"""
Docuseal 电子合同集成服务
代理入驻时自动触发合同签署流程

流程：
1. 代理注册 → 触发合同生成
2. Docuseal API 基于模板生成合同（预填代理信息）
3. 通过短信/微信链接推送给代理
4. 代理在线签署
5. 签署完成 → 回调通知平台 → 更新代理状态为"已签约"
6. 合同 PDF 存储到 artifact_store
"""

import httpx
from typing import Optional
from datetime import datetime, timedelta


DOCUSEAL_BASE_URL = "http://localhost:3000"  # 自托管地址

# 模板 ID（在 Docuseal 后台创建后获得）
TEMPLATES = {
    "starter": "tpl_starter_001",
    "regional": "tpl_regional_001",
    "provincial": "tpl_provincial_001",
    "nda": "tpl_nda_001",
}


class ContractService:
    
    def __init__(self):
        self.client = httpx.AsyncClient(
            base_url=DOCUSEAL_BASE_URL,
            headers={"X-Auth-Token": os.environ["DOCUSEAL_API_TOKEN"]},
            timeout=30.0,
        )
    
    async def create_agent_contract(
        self,
        agent_id: str,
        agent_info: dict,
        tier: str,  # starter / regional / provincial
    ) -> dict:
        """
        为代理创建电子合同并发送签署请求
        
        自动根据代理层级选择合同模板
        同时发送：主合同 + 价格保密协议（NDA）
        """
        from saas_pricing_model import get_seat_unit_price
        
        seat_count = agent_info["total_seats_managed"]
        unit_price = get_seat_unit_price(seat_count)
        monthly_total = unit_price * seat_count
        
        # 合同动态字段
        contract_data = {
            "agent_company": agent_info.get("company_name", ""),
            "agent_name": agent_info["contact_name"],
            "agent_region": agent_info.get("region", ""),
            "seat_count": str(seat_count),
            "unit_price": f"¥{unit_price:,}",
            "monthly_total": f"¥{monthly_total:,}",
            "contract_start_date": datetime.now().strftime("%Y年%m月%d日"),
            "contract_term": "12个月",
            "floor_price": "¥1,980",
        }
        
        # 签署人信息
        signer = {
            "name": agent_info["contact_name"],
            "email": agent_info.get("contact_email", ""),
            "phone": agent_info.get("contact_phone", ""),
        }
        
        # 创建主合同签署请求
        main_template_id = TEMPLATES.get(tier, TEMPLATES["starter"])
        main_submission = await self._create_submission(
            template_id=main_template_id,
            signer=signer,
            data=contract_data,
        )
        
        # 创建 NDA 签署请求（所有代理必签）
        nda_submission = await self._create_submission(
            template_id=TEMPLATES["nda"],
            signer=signer,
            data=contract_data,
        )
        
        # 保存合同记录
        await self._save_contract_record(
            agent_id=agent_id,
            tier=tier,
            main_submission_id=main_submission["id"],
            nda_submission_id=nda_submission["id"],
            signer_link=main_submission["signer_url"],
        )
        
        # 发送签署链接给代理（微信/短信/企业微信）
        await self._notify_signer(agent_info, main_submission["signer_url"])
        
        return {
            "status": "pending_signature",
            "agent_id": agent_id,
            "main_contract_id": main_submission["id"],
            "nda_contract_id": nda_submission["id"],
            "signer_url": main_submission["signer_url"],
            "expires_at": (datetime.now() + timedelta(days=7)).isoformat(),
        }
    
    async def _create_submission(
        self,
        template_id: str,
        signer: dict,
        data: dict,
    ) -> dict:
        """
        调用 Docuseal API 创建签署提交
        """
        response = await self.client.post(
            "/api/submissions",
            json={
                "template_id": template_id,
                "send_email": False,    # 我们自己发通知
                "submitters": [
                    {
                        "name": signer["name"],
                        "email": signer.get("email", ""),
                        "phone": signer.get("phone", ""),
                        "role": "代理方",
                        "values": data,  # 预填合同字段
                    },
                    {
                        "name": "Dragon Senate 平台",
                        "email": "legal@dragonsaas.cn",
                        "role": "甲方",
                    }
                ]
            }
        )
        response.raise_for_status()
        result = response.json()
        
        # 返回乙方（代理）的签署链接
        signer_info = next(
            (s for s in result["submitters"] if s["role"] == "代理方"),
            result["submitters"][0]
        )
        
        return {
            "id": result["id"],
            "signer_url": signer_info["embed_src"],  # 嵌入式签署链接
        }
    
    async def handle_docuseal_webhook(self, event: dict) -> dict:
        """
        处理 Docuseal 回调事件
        
        事件类型：
        - submission.completed：所有人都签完了 → 更新代理状态
        - submitter.completed：某个签署人完成 → 记录进度
        """
        event_type = event.get("event_type")
        
        if event_type == "submission.completed":
            submission_id = event["data"]["id"]
            
            # 找到对应的代理合同记录
            contract = await self._find_contract_by_submission(submission_id)
            if not contract:
                return {"status": "ignored", "reason": "未找到对应合同"}
            
            agent_id = contract["agent_id"]
            
            # 下载合同 PDF 并存储
            pdf_url = await self._download_and_store_contract(
                submission_id=submission_id,
                agent_id=agent_id,
            )
            
            # 更新合同状态为已签署
            await self._update_contract_status(
                agent_id=agent_id,
                submission_id=submission_id,
                status="signed",
                signed_at=datetime.now().isoformat(),
                pdf_url=pdf_url,
            )
            
            # 检查是否所有合同都签完了（主合同 + NDA）
            all_signed = await self._check_all_contracts_signed(agent_id)
            
            if all_signed:
                # 更新代理状态为"已签约激活"
                await self._activate_agent(agent_id)
                
                # 通知代理：合同签署完成，账号已激活
                await self._notify_agent_activated(agent_id)
                
                return {"status": "agent_activated", "agent_id": agent_id}
        
        elif event_type == "submitter.completed":
            # 某个签署人完成，记录进度（不完全激活）
            submitter = event["data"]
            if submitter.get("role") == "代理方":
                # 代理已签，等平台方签
                await self._notify_platform_to_countersign(event["data"])
        
        return {"status": "processed"}
    
    async def get_contract_status(self, agent_id: str) -> dict:
        """查询代理合同签署状态"""
        contracts = await self.db.agent_contracts.find(
            {"agent_id": agent_id}
        ).to_list()
        
        return {
            "agent_id": agent_id,
            "contracts": [
                {
                    "type": c["contract_type"],
                    "status": c["status"],
                    "signed_at": c.get("signed_at"),
                    "pdf_url": c.get("pdf_url"),
                }
                for c in contracts
            ],
            "all_signed": all(c["status"] == "signed" for c in contracts),
        }
    
    async def _download_and_store_contract(
        self,
        submission_id: str,
        agent_id: str,
    ) -> str:
        """下载签署完的合同 PDF 并存储到 artifact_store"""
        # 获取 PDF 下载链接
        response = await self.client.get(f"/api/submissions/{submission_id}/documents")
        docs = response.json()
        pdf_url = docs[0]["url"]
        
        # 下载 PDF
        pdf_resp = await self.client.get(pdf_url)
        pdf_bytes = pdf_resp.content
        
        # 存储到 artifact_store（已有模块）
        from artifact_store import ArtifactStore
        store = ArtifactStore()
        stored_url = await store.upload(
            content=pdf_bytes,
            filename=f"contract_{agent_id}_{submission_id}.pdf",
            content_type="application/pdf",
            tags={"agent_id": agent_id, "type": "contract"},
        )
        
        return stored_url
    
    async def _notify_signer(self, agent_info: dict, signer_url: str):
        """发送签署链接给代理"""
        from lobster_im_channel import LobsterIMChannel
        channel = LobsterIMChannel()
        
        message = (
            f"🖊️ 代理合同待签署\n\n"
            f"尊敬的{agent_info['contact_name']}，您的 Dragon Senate 代理协议已准备完毕。\n\n"
            f"请点击以下链接完成在线签署（7天内有效）：\n"
            f"{signer_url}\n\n"
            f"签署完成后，您的代理账号将立即激活。"
        )
        
        # 优先发企业微信
        if agent_info.get("contact_wechat"):
            await channel.send_to_agent(agent_info["contact_wechat"], message)
        
        # 同时发短信（接入阿里云短信）
        if agent_info.get("contact_phone"):
            await self._send_sms(
                phone=agent_info["contact_phone"],
                template="SMS_AGENT_CONTRACT",
                params={"name": agent_info["contact_name"], "url": signer_url[:30] + "..."}
            )
    
    async def _activate_agent(self, agent_id: str):
        """激活代理账号（合同签完后）"""
        await self.db.agents.update(
            {"agent_id": agent_id},
            {
                "contract_status": "signed",
                "is_active": True,
                "activated_at": datetime.now().isoformat(),
            }
        )
        
        # 触发代理看板权限开通（RBAC）
        from rbac_permission import grant_role
        await grant_role(agent_id, "agent_portal")
```

---

## 五、Webhook 路由配置

```python
# 新增到 dragon-senate-saas-v2/app.py

@app.post("/webhooks/docuseal")
async def docuseal_webhook(request: Request):
    """
    Docuseal 签署完成回调
    在 Docuseal 后台配置 Webhook URL：https://api.dragonsaas.cn/webhooks/docuseal
    """
    # 验证签名（Docuseal 发送 HMAC-SHA256 签名）
    signature = request.headers.get("X-Docuseal-Signature")
    body = await request.body()
    expected = hmac.new(
        os.environ["DOCUSEAL_WEBHOOK_SECRET"].encode(),
        body,
        hashlib.sha256
    ).hexdigest()
    
    if not hmac.compare_digest(signature or "", expected):
        raise HTTPException(403, "签名验证失败")
    
    event = await request.json()
    service = ContractService()
    return await service.handle_docuseal_webhook(event)


@app.get("/api/agent/{agent_id}/contracts")
async def get_agent_contracts(agent_id: str):
    """查询代理合同状态"""
    service = ContractService()
    return await service.get_contract_status(agent_id)


@app.post("/api/admin/contracts/resend/{agent_id}")
async def resend_contract(agent_id: str, admin_token: str):
    """重发签署链接（代理未收到时使用）"""
    if admin_token != os.environ["ADMIN_SECRET"]:
        raise HTTPException(403, "无权限")
    
    agent = await db.agents.find_one({"agent_id": agent_id})
    contract = await db.agent_contracts.find_one({
        "agent_id": agent_id,
        "status": "pending"
    })
    
    if not contract:
        raise HTTPException(404, "无待签合同")
    
    # 获取最新签署链接
    service = ContractService()
    resp = await service.client.get(
        f"/api/submissions/{contract['submission_id']}/submitters"
    )
    signer = next(s for s in resp.json() if s["role"] == "代理方")
    
    await service._notify_signer(agent, signer["embed_src"])
    return {"status": "resent", "agent_id": agent_id}
```

---

## 六、前端合同状态组件

```typescript
// src/components/agent/ContractStatus.tsx

export function ContractStatus({ agentId }: { agentId: string }) {
  const { data } = useSWR(`/api/agent/${agentId}/contracts`);
  
  if (!data) return <Skeleton />;
  
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">合同签署状态</h3>
      
      {data.contracts.map((contract) => (
        <div key={contract.type} className="flex items-center justify-between p-3 border rounded">
          <div>
            <span className="font-medium">{CONTRACT_TYPE_LABELS[contract.type]}</span>
            {contract.signed_at && (
              <span className="text-sm text-gray-500 ml-2">
                签署于 {formatDate(contract.signed_at)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge color={contract.status === "signed" ? "green" : "yellow"}>
              {contract.status === "signed" ? "✅ 已签署" : "⏳ 待签署"}
            </Badge>
            {contract.pdf_url && (
              <a href={contract.pdf_url} target="_blank" className="text-blue-500 text-sm">
                下载
              </a>
            )}
          </div>
        </div>
      ))}
      
      {!data.all_signed && (
        <p className="text-sm text-amber-600">
          ⚠️ 请完成所有合同签署后，代理账号才会完全激活
        </p>
      )}
    </div>
  );
}

const CONTRACT_TYPE_LABELS = {
  "starter": "代理合作协议",
  "regional": "区域代理协议",
  "provincial": "省级代理框架合同",
  "nda": "价格保密协议",
};
```

---

## 七、验收标准

- [ ] Docuseal Docker 自托管成功启动（数据存本地，合规）
- [ ] 4种合同模板在 Docuseal 后台配置完成（含动态字段）
- [ ] `create_agent_contract()` 自动根据层级选择正确模板
- [ ] 合同动态字段正确预填（代理公司名/席位数/采购价/底线价）
- [ ] 签署链接通过企业微信和短信双渠道发送
- [ ] Docuseal Webhook 正确处理签署完成事件
- [ ] 所有合同签完后自动激活代理账号（RBAC 开权限）
- [ ] 合同 PDF 下载并存储到 artifact_store
- [ ] 前端合同状态组件正确显示签署进度
- [ ] 管理员可重发签署链接（运营 API）
