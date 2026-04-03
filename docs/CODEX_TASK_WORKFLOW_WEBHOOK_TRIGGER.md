# CODEX TASK: Webhook 触发器 — 用户自助配置外部系统触发工作流

**优先级：P1**  
**来源：N8N_BORROWING_ANALYSIS.md P1-#1（n8n Webhook Trigger）**

---

## 背景

工作流目前只支持定时 Cron 或手动触发。借鉴 n8n Webhook Trigger，用户可为工作流生成专属 Webhook URL，任意外部系统（电商后台/CRM/企业微信）POST 到此 URL 即可触发工作流执行，无需技术能力。

---

## 一、数据模型

```python
# dragon-senate-saas-v2/workflow_webhook.py

import secrets
from dataclasses import dataclass, field
from typing import Optional, Literal
from datetime import datetime

@dataclass
class WorkflowWebhook:
    webhook_id: str             # 短唯一 ID（URL 路径段）如 "wh_abc123xyz"
    workflow_id: str            # 关联工作流
    tenant_id: str
    name: str                   # 用户给的名称，如 "来自电商后台的触发"
    http_method: Literal["POST", "GET", "ANY"] = "POST"
    auth_type: Literal["none", "header_token", "basic_auth"] = "none"
    auth_config: dict = field(default_factory=dict)  # 加密存储
    response_mode: Literal["immediate", "wait_for_completion"] = "immediate"
    is_active: bool = True
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_triggered_at: Optional[datetime] = None
    trigger_count: int = 0

def generate_webhook_id() -> str:
    """生成短唯一 Webhook ID"""
    return "wh_" + secrets.token_urlsafe(12)
```

---

## 二、后端 Webhook 接收端点

```python
# dragon-senate-saas-v2/api_webhook_receiver.py
# 独立路由（不需要认证中间件，因为 Webhook 本身有 auth_type）

from fastapi import APIRouter, Request, HTTPException, Header
from typing import Optional
import asyncio, base64, hmac

webhook_router = APIRouter(prefix="/webhook", tags=["webhook"])

@webhook_router.post("/{webhook_id}")
@webhook_router.get("/{webhook_id}")
async def receive_webhook(
    webhook_id: str,
    request: Request,
):
    """公开 Webhook 端点（无需登录，自带认证验证）"""
    # 1. 查找 Webhook 配置
    webhook = db.query(WorkflowWebhook).filter(
        WorkflowWebhook.webhook_id == webhook_id,
        WorkflowWebhook.is_active == True,
    ).first()
    if not webhook:
        raise HTTPException(404, "Webhook 不存在或已禁用")

    # 2. 验证认证
    _verify_webhook_auth(webhook, request)

    # 3. 组装输入数据
    body = {}
    if request.method == "POST":
        try:
            body = await request.json()
        except Exception:
            body = {"raw": (await request.body()).decode()}

    input_data = {
        "trigger_type": "webhook",
        "webhook_id": webhook_id,
        "http_method": request.method,
        "headers": dict(request.headers),
        "query_params": dict(request.query_params),
        "body": body,
        "triggered_at": datetime.utcnow().isoformat(),
    }

    # 4. 更新触发统计
    webhook.last_triggered_at = datetime.utcnow()
    webhook.trigger_count += 1
    db.commit()

    # 5. 触发工作流
    if webhook.response_mode == "immediate":
        asyncio.create_task(trigger_workflow(webhook.workflow_id, input_data, webhook.tenant_id))
        return {"status": "accepted", "message": "工作流已触发"}
    else:
        result = await trigger_workflow_sync(webhook.workflow_id, input_data, webhook.tenant_id)
        return {"status": "completed", "result": result}


def _verify_webhook_auth(webhook: WorkflowWebhook, request: Request):
    """验证 Webhook 认证"""
    if webhook.auth_type == "none":
        return  # 无认证，直接通过

    elif webhook.auth_type == "header_token":
        expected = webhook.auth_config.get("token")
        actual = request.headers.get("X-Webhook-Token") or request.headers.get("Authorization", "").removeprefix("Bearer ")
        if not hmac.compare_digest(actual or "", expected or ""):
            raise HTTPException(401, "Webhook Token 验证失败")

    elif webhook.auth_type == "basic_auth":
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Basic "):
            raise HTTPException(401, "需要 Basic Auth")
        decoded = base64.b64decode(auth_header[6:]).decode()
        username, _, password = decoded.partition(":")
        if (username != webhook.auth_config.get("username") or
                password != webhook.auth_config.get("password")):
            raise HTTPException(401, "Basic Auth 验证失败")
```

---

## 三、Webhook 管理 API

```python
# dragon-senate-saas-v2/api_workflow_webhooks.py

@router.get("/workflows/{workflow_id}/webhooks")
async def list_workflow_webhooks(workflow_id: str, tenant_context=Depends(get_tenant_context)):
    webhooks = db.query(WorkflowWebhook).filter(
        WorkflowWebhook.workflow_id == workflow_id,
        WorkflowWebhook.tenant_id == tenant_context.tenant_id,
    ).all()
    return {"webhooks": [asdict(w) for w in webhooks]}

@router.post("/workflows/{workflow_id}/webhooks")
async def create_webhook(
    workflow_id: str,
    body: CreateWebhookBody,
    tenant_context=Depends(get_tenant_context),
):
    """为工作流创建 Webhook"""
    webhook = WorkflowWebhook(
        webhook_id=generate_webhook_id(),
        workflow_id=workflow_id,
        tenant_id=tenant_context.tenant_id,
        name=body.name,
        http_method=body.http_method,
        auth_type=body.auth_type,
        auth_config=encrypt_auth_config(body.auth_config),  # 加密存储
        response_mode=body.response_mode,
    )
    db.add(webhook)
    db.commit()
    
    webhook_url = f"{settings.BASE_URL}/webhook/{webhook.webhook_id}"
    return {"webhook": asdict(webhook), "webhook_url": webhook_url}

@router.delete("/workflows/{workflow_id}/webhooks/{webhook_id}")
async def delete_webhook(workflow_id: str, webhook_id: str, tenant_context=Depends(get_tenant_context)):
    db.query(WorkflowWebhook).filter(
        WorkflowWebhook.webhook_id == webhook_id,
        WorkflowWebhook.tenant_id == tenant_context.tenant_id,
    ).delete()
    db.commit()
    return {"message": "Webhook 已删除"}
```

---

## 四、前端 Webhook 配置 UI

```typescript
// web/src/app/workflows/[id]/triggers/page.tsx
// 工作流触发器配置页（触发方式：手动 / Cron / Webhook）

export function WebhookTriggerPanel({ workflowId }) {
  const [webhooks, setWebhooks] = useState<WorkflowWebhook[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (values: CreateWebhookForm) => {
    const res = await api.post(`/v1/workflows/${workflowId}/webhooks`, values);
    setWebhooks(prev => [...prev, res.data.webhook]);
    setCreatedUrl(res.data.webhook_url);
    toast({ title: "Webhook 已创建", description: "复制下方 URL 配置到外部系统" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Webhook 触发器</h3>
          <p className="text-sm text-muted-foreground">
            外部系统发送 HTTP 请求到此 URL，即可触发工作流执行
          </p>
        </div>
        <Button size="sm" onClick={() => setIsCreating(true)}>+ 添加 Webhook</Button>
      </div>

      {/* 已创建的 Webhook 列表 */}
      {webhooks.map(webhook => (
        <WebhookCard key={webhook.webhook_id} webhook={webhook} workflowId={workflowId} />
      ))}

      {/* 创建 Webhook 表单 */}
      {isCreating && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-4">
            <Form onSubmit={handleCreate}>
              <FormField name="name" label="名称" placeholder="来自电商后台" required />
              <div className="grid grid-cols-2 gap-3">
                <FormField name="http_method" label="HTTP 方法" type="select"
                  options={[{ value: "POST", label: "POST" }, { value: "GET", label: "GET" }, { value: "ANY", label: "任意" }]} />
                <FormField name="response_mode" label="响应模式" type="select"
                  options={[
                    { value: "immediate", label: "立即响应 200（异步执行）" },
                    { value: "wait_for_completion", label: "等待执行完成后响应" },
                  ]} />
              </div>
              <FormField name="auth_type" label="认证方式" type="select"
                options={[
                  { value: "none", label: "无认证" },
                  { value: "header_token", label: "Header Token（X-Webhook-Token）" },
                  { value: "basic_auth", label: "Basic Auth" },
                ]} />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" type="button" onClick={() => setIsCreating(false)}>取消</Button>
                <Button type="submit">创建 Webhook</Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WebhookCard({ webhook, workflowId }) {
  const webhookUrl = `${window.location.origin.replace(':3000', ':8000')}/webhook/${webhook.webhook_id}`;
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{webhook.name}</span>
            <Badge variant={webhook.is_active ? "default" : "secondary"}>
              {webhook.is_active ? "活跃" : "禁用"}
            </Badge>
            <Badge variant="outline">{webhook.http_method}</Badge>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            触发 {webhook.trigger_count} 次
            {webhook.last_triggered_at && ` · 最近 ${formatRelativeTime(webhook.last_triggered_at)}`}
          </div>
        </div>

        {/* Webhook URL 显示 + 复制 */}
        <div className="flex items-center gap-2 p-2 bg-muted rounded font-mono text-xs">
          <span className="flex-1 truncate">{webhookUrl}</span>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={copy}>
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## 验收标准

- [ ] `WorkflowWebhook` 数据模型（webhook_id / auth_type / response_mode / trigger_count）
- [ ] `generate_webhook_id()` 生成短唯一 ID（`wh_` 前缀 + 12位随机）
- [ ] `POST/GET /webhook/{webhook_id}` 公开接收端点（无需登录）
- [ ] 三种认证验证：none / header_token（`X-Webhook-Token`）/ basic_auth
- [ ] `response_mode=immediate`：异步触发，立即返回 `{"status":"accepted"}`
- [ ] `response_mode=wait_for_completion`：同步等待，返回工作流结果
- [ ] Webhook 触发计数（`trigger_count` + `last_triggered_at` 更新）
- [ ] 认证 config 加密存储（不明文存 DB）
- [ ] `GET /workflows/{id}/webhooks` — 列表
- [ ] `POST /workflows/{id}/webhooks` — 创建
- [ ] `DELETE /workflows/{id}/webhooks/{webhook_id}` — 删除
- [ ] 前端工作流触发器配置页（`/workflows/[id]/triggers`）
- [ ] `WebhookCard`：URL 一键复制 + 触发次数 + 最近触发时间
- [ ] Webhook 创建表单：名称 / HTTP方法 / 响应模式 / 认证方式

---

*Codex Task | 来源：N8N_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
