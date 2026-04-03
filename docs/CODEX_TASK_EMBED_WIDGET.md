# CODEX TASK: 嵌入式对话小部件（EmbedWidget）

**优先级：P1**  
**来源：ONYX_BORROWING_ANALYSIS.md P1-2**  
**借鉴自**：Onyx `widget/` — 可嵌入任意网页的独立对话小部件

---

## 背景

当前线索进入路径：客户看到内容 → 点击官网链接 → 填表单/加微信（转化率损耗极大）。
借鉴 Onyx `widget/` 的思路，在客户官网/落地页嵌入龙虾对话框，**让 echoer 直接在客户官网接待访客**，实时对话后将线索推给 catcher。

---

## 实现

### 边缘服务

```python
# edge-runtime/widget_server.py

import asyncio
import json
import logging
import uuid
from typing import Optional

logger = logging.getLogger(__name__)


class WidgetServer:
    """
    嵌入式对话小部件服务端
    
    功能：
      1. 生成 widget embed 脚本（每个租户独立 widget_id）
      2. 处理访客匿名会话（无需登录）
      3. 将对话路由到 echoer 龙虾
      4. 对话结束后自动生成 LeadAssessment 推给 catcher
      5. 支持自定义欢迎语/主题色/限制域名（防盗用）
    """

    def __init__(self, saas_client, echoer, catcher, allowed_origins_store):
        self.saas_client = saas_client
        self.echoer = echoer
        self.catcher = catcher
        self.allowed_origins = allowed_origins_store
        self._sessions: dict[str, dict] = {}

    def get_embed_script(self, widget_id: str, tenant_id: str) -> str:
        """生成客户粘贴到官网的 <script> 标签"""
        config = self._get_widget_config(widget_id, tenant_id)
        endpoint = config.get("endpoint", "https://openclaw.ai/widget")
        return f"""
<!-- OpenClaw Widget -->
<script>
(function(){{
  var s=document.createElement('script');
  s.src='{endpoint}/loader.js?wid={widget_id}';
  s.async=true;
  document.head.appendChild(s);
}})();
</script>
""".strip()

    async def handle_visitor_message(
        self,
        widget_id: str,
        session_id: Optional[str],
        message: str,
        visitor_meta: dict,
        origin: str,
    ) -> dict:
        """处理访客消息，路由到 echoer"""
        tenant_id = self._resolve_tenant(widget_id)
        if not tenant_id:
            return {"error": "invalid_widget_id"}

        # 域名校验防盗用
        if not self._check_origin(tenant_id, origin):
            return {"error": "origin_not_allowed"}

        # 创建/复用会话
        if not session_id:
            session_id = str(uuid.uuid4())
            self._sessions[session_id] = {
                "widget_id": widget_id,
                "tenant_id": tenant_id,
                "visitor_meta": visitor_meta,
                "messages": [],
                "started_at": asyncio.get_event_loop().time(),
            }

        session = self._sessions.get(session_id, {})
        session["messages"].append({"role": "user", "content": message})

        # 调用 echoer 龙虾
        reply = await self.echoer.reply_visitor(
            tenant_id=tenant_id,
            session_id=session_id,
            message=message,
            history=session["messages"][-10:],  # 最近10轮
            visitor_meta=visitor_meta,
        )

        session["messages"].append({"role": "assistant", "content": reply["text"]})

        # 如果 echoer 判断访客是高意向线索，自动触发 catcher
        if reply.get("is_lead", False):
            asyncio.create_task(
                self._capture_lead(session_id, session, reply.get("lead_info", {}))
            )

        return {
            "session_id": session_id,
            "reply": reply["text"],
            "show_cta": reply.get("show_cta", False),
            "cta_text": reply.get("cta_text", "联系我们"),
        }

    async def close_session(self, session_id: str) -> dict:
        """会话结束，强制触发线索沉淀"""
        session = self._sessions.pop(session_id, None)
        if not session:
            return {"status": "not_found"}
        await self._capture_lead(session_id, session, {})
        return {"status": "closed"}

    async def _capture_lead(self, session_id: str, session: dict, lead_info: dict):
        """推线索给 catcher"""
        try:
            await self.catcher.ingest_lead({
                "source": "embed_widget",
                "session_id": session_id,
                "tenant_id": session["tenant_id"],
                "visitor_meta": session["visitor_meta"],
                "conversation_summary": session["messages"][-5:],
                "extra": lead_info,
            })
            logger.info(f"[Widget] 线索已推送 session={session_id}")
        except Exception as e:
            logger.error(f"[Widget] 线索推送失败 session={session_id} err={e}")

    def _resolve_tenant(self, widget_id: str) -> Optional[str]:
        return self.saas_client.get_tenant_by_widget(widget_id)

    def _check_origin(self, tenant_id: str, origin: str) -> bool:
        allowed = self.allowed_origins.get(tenant_id, [])
        if not allowed:
            return True  # 未配置则放行（测试友好）
        return any(origin.endswith(d) for d in allowed)

    def _get_widget_config(self, widget_id: str, tenant_id: str) -> dict:
        return self.saas_client.get_widget_config(widget_id, tenant_id) or {}
```

### 前端（loader.js 核心结构）

```javascript
// edge-runtime/static/widget/loader.js（伪代码结构）
(function() {
  const wid = new URLSearchParams(document.currentScript.src.split('?')[1]).get('wid');
  
  // 注入悬浮按钮
  const btn = document.createElement('div');
  btn.id = 'oc-widget-btn';
  btn.innerHTML = '💬';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:var(--oc-primary,#6366f1);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:9999';
  document.body.appendChild(btn);

  // 注入对话 iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'oc-widget-frame';
  iframe.src = `https://openclaw.ai/widget/chat?wid=${wid}`;
  iframe.style.cssText = 'display:none;position:fixed;bottom:90px;right:20px;width:360px;height:520px;border:none;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.18);z-index:9999';
  document.body.appendChild(iframe);

  btn.addEventListener('click', () => {
    const open = iframe.style.display === 'none';
    iframe.style.display = open ? 'block' : 'none';
  });
})();
```

### 管理台配置

```
/settings/widget
  ├── 生成 embed 代码（复制粘贴到官网 </body> 前）
  ├── 允许域名（whitelist，防止盗用）
  ├── 欢迎语配置
  ├── 主题色 / Logo
  └── 对话结束动作（仅记录 / 推 CRM / 触发工作流）
```

---

## 验收标准

- [ ] `WidgetServer.get_embed_script()` 生成有效 `<script>` 标签
- [ ] `handle_visitor_message()` 路由到 echoer + 返回 reply + session_id
- [ ] 高意向线索自动推 catcher（`is_lead=True` 时）
- [ ] 域名白名单校验（非白名单域名返回 `origin_not_allowed`）
- [ ] `close_session()` 强制沉淀线索
- [ ] 管理台 `/settings/widget` — 域名/欢迎语/主题色配置 + embed 代码复制

---

*Codex Task | 来源：ONYX_BORROWING_ANALYSIS.md P1-2 | 2026-04-02*
