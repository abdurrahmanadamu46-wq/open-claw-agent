# CODEX TASK: 客户需求收集 Intake 表单

**优先级：P1**  
**来源：PLANE_BORROWING_ANALYSIS.md P1-#2**

---

## 背景

客户需求目前只通过 IM（微信/企业微信）流入 echoer 龙虾，缺少结构化收集入口。借鉴 Plane Intake，新增公开表单页，客户自助填写后进入 catcher 龙虾的"待处理"队列，运营审核后转为正式任务。

---

## 后端实现

```python
# dragon-senate-saas-v2/intake_form.py

import time
import uuid
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

PRIORITY_VALUES = {"high", "medium", "low"}
MAX_TITLE_LEN = 200
MAX_DESC_LEN = 2000


@dataclass
class IntakeSubmission:
    """客户需求收集表单提交记录"""
    intake_id: str
    tenant_slug: str          # 租户标识（URL 中的唯一标识）
    title: str                # 需求标题
    description: str          # 详细描述
    priority: str             # high / medium / low
    contact: str              # 联系方式（邮件/手机/微信）
    status: str = "pending"   # pending / accepted / rejected
    reject_reason: str = ""
    created_at: float = field(default_factory=time.time)
    reviewed_at: float = 0.0
    reviewer_id: str = ""


class IntakeFormHandler:
    """
    需求收集表单 Handler
    
    公开接口（无需登录）：
      POST /intake/{tenant_slug}          → submit()
      GET  /intake/{tenant_slug}          → 渲染表单 HTML
    
    管理接口（需运营登录）：
      GET  /api/v1/intake/list            → list_pending()
      POST /api/v1/intake/{id}/accept     → accept()
      POST /api/v1/intake/{id}/reject     → reject()
    """

    def __init__(self, db, task_queue):
        self.db = db
        self.task_queue = task_queue

    def submit(
        self,
        tenant_slug: str,
        title: str,
        description: str,
        priority: str = "medium",
        contact: str = "",
    ) -> dict:
        """处理表单提交（公开接口）"""
        # 参数校验
        title = title.strip()[:MAX_TITLE_LEN]
        description = description.strip()[:MAX_DESC_LEN]
        priority = priority if priority in PRIORITY_VALUES else "medium"
        contact = contact.strip()[:100]

        if not title:
            return {"success": False, "error": "需求标题不能为空"}

        # 查询租户是否存在
        tenant = self.db.query_one("tenants", where={"slug": tenant_slug})
        if not tenant:
            return {"success": False, "error": "租户不存在"}

        # 保存提交记录
        submission = IntakeSubmission(
            intake_id=str(uuid.uuid4()),
            tenant_slug=tenant_slug,
            title=title,
            description=description,
            priority=priority,
            contact=contact,
        )
        self.db.insert("intake_submissions", {
            "intake_id": submission.intake_id,
            "tenant_id": tenant["tenant_id"],
            "tenant_slug": tenant_slug,
            "title": submission.title,
            "description": submission.description,
            "priority": submission.priority,
            "contact": submission.contact,
            "status": "pending",
            "created_at": submission.created_at,
        })
        logger.info(f"[Intake] 新提交 id={submission.intake_id} tenant={tenant_slug}")
        return {"success": True, "intake_id": submission.intake_id,
                "message": "需求已提交，我们会尽快处理！"}

    def list_pending(self, tenant_id: str, status: str = "pending") -> list[dict]:
        """获取待审核列表（运营管理台使用）"""
        return self.db.query(
            "intake_submissions",
            where={"tenant_id": tenant_id, "status": status},
            order_by="created_at DESC",
        )

    def accept(self, intake_id: str, tenant_id: str, reviewer_id: str) -> dict:
        """
        接受需求 → 转为 catcher 龙虾任务
        """
        row = self._get_and_validate(intake_id, tenant_id)
        if not row:
            return {"success": False, "error": "记录不存在"}

        # 更新状态
        self.db.update("intake_submissions", {
            "status": "accepted",
            "reviewed_at": time.time(),
            "reviewer_id": reviewer_id,
        }, where={"intake_id": intake_id})

        # 投入 catcher 龙虾的任务队列
        self.task_queue.enqueue({
            "task_id": str(uuid.uuid4()),
            "lobster_name": "catcher",
            "tenant_id": tenant_id,
            "title": f"[需求] {row['title']}",
            "description": row["description"],
            "priority": row["priority"],
            "source": "intake",
            "intake_id": intake_id,
            "contact": row["contact"],
        })
        logger.info(f"[Intake] 接受需求 id={intake_id} → catcher 队列")
        return {"success": True}

    def reject(
        self, intake_id: str, tenant_id: str, reviewer_id: str, reason: str = ""
    ) -> dict:
        """拒绝需求（附理由）"""
        row = self._get_and_validate(intake_id, tenant_id)
        if not row:
            return {"success": False, "error": "记录不存在"}

        self.db.update("intake_submissions", {
            "status": "rejected",
            "reject_reason": reason.strip()[:500],
            "reviewed_at": time.time(),
            "reviewer_id": reviewer_id,
        }, where={"intake_id": intake_id})

        logger.info(f"[Intake] 拒绝需求 id={intake_id} reason={reason[:50]}")
        return {"success": True}

    def _get_and_validate(self, intake_id: str, tenant_id: str) -> Optional[dict]:
        row = self.db.query_one("intake_submissions", where={"intake_id": intake_id})
        if not row or row.get("tenant_id") != tenant_id:
            return None
        if row.get("status") != "pending":
            return None  # 已处理过，不重复操作
        return row
```

---

## FastAPI 路由

```python
# dragon-senate-saas-v2/app.py（追加路由）

from .intake_form import IntakeFormHandler

# 公开接口（无需登录）
@app.post("/intake/{tenant_slug}")
async def intake_submit(tenant_slug: str, body: dict):
    handler = IntakeFormHandler(db, task_queue)
    return handler.submit(
        tenant_slug=tenant_slug,
        title=body.get("title", ""),
        description=body.get("description", ""),
        priority=body.get("priority", "medium"),
        contact=body.get("contact", ""),
    )

@app.get("/intake/{tenant_slug}", response_class=HTMLResponse)
async def intake_page(tenant_slug: str):
    return INTAKE_PAGE_HTML.replace("{{TENANT_SLUG}}", tenant_slug)

# 管理接口（需登录）
@router.get("/api/v1/intake/list")
async def intake_list(status: str = "pending", ctx=Depends(get_tenant_context)):
    handler = IntakeFormHandler(db, task_queue)
    return handler.list_pending(ctx.tenant_id, status)

@router.post("/api/v1/intake/{intake_id}/accept")
async def intake_accept(intake_id: str, ctx=Depends(get_tenant_context)):
    handler = IntakeFormHandler(db, task_queue)
    return handler.accept(intake_id, ctx.tenant_id, ctx.user_id)

@router.post("/api/v1/intake/{intake_id}/reject")
async def intake_reject(intake_id: str, body: dict, ctx=Depends(get_tenant_context)):
    handler = IntakeFormHandler(db, task_queue)
    return handler.reject(intake_id, ctx.tenant_id, ctx.user_id, body.get("reason", ""))
```

---

## 公开表单页 HTML（内嵌模板）

```python
INTAKE_PAGE_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>提交需求</title>
  <style>
    body{font-family:-apple-system,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#222;}
    h1{font-size:22px;margin-bottom:4px;}
    .sub{color:#888;font-size:13px;margin-bottom:28px;}
    label{display:block;font-size:13px;font-weight:600;margin-bottom:4px;}
    input,textarea,select{width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;
      font-size:14px;margin-bottom:16px;box-sizing:border-box;outline:none;}
    input:focus,textarea:focus,select:focus{border-color:#6366f1;}
    button{background:#6366f1;color:#fff;border:none;padding:10px 24px;border-radius:6px;
      font-size:14px;cursor:pointer;width:100%;}
    button:hover{background:#4f46e5;}
    .success{color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;
      border-radius:6px;padding:12px 16px;display:none;}
    .error{color:#dc2626;font-size:12px;margin-top:-12px;margin-bottom:12px;display:none;}
  </style>
</head>
<body>
  <h1>💬 提交需求</h1>
  <p class="sub">告诉我们您的想法，我们会尽快跟进</p>
  <form id="intake-form">
    <label>需求标题 *</label>
    <input type="text" id="f-title" placeholder="一句话描述您的需求" maxlength="200" required>
    <div class="error" id="e-title"></div>
    <label>详细描述</label>
    <textarea id="f-desc" rows="4" placeholder="请详细描述使用场景、期望效果..." maxlength="2000"></textarea>
    <label>优先级</label>
    <select id="f-priority">
      <option value="medium">中（正常处理）</option>
      <option value="high">高（尽快处理）</option>
      <option value="low">低（空闲时处理）</option>
    </select>
    <label>联系方式（可选）</label>
    <input type="text" id="f-contact" placeholder="邮箱 / 手机 / 微信">
    <button type="submit">提交需求</button>
  </form>
  <div class="success" id="success-msg">✅ 需求已提交！我们会尽快处理，感谢您的反馈。</div>
  <script>
    document.getElementById('intake-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('f-title').value.trim();
      if (!title) {
        const el = document.getElementById('e-title');
        el.textContent = '请填写需求标题';
        el.style.display = 'block';
        return;
      }
      const resp = await fetch('/intake/{{TENANT_SLUG}}', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          title,
          description: document.getElementById('f-desc').value,
          priority: document.getElementById('f-priority').value,
          contact: document.getElementById('f-contact').value,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        document.getElementById('intake-form').style.display = 'none';
        document.getElementById('success-msg').style.display = 'block';
      }
    });
  </script>
</body>
</html>"""
```

---

## 数据库 Schema

```sql
CREATE TABLE intake_submissions (
    intake_id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    tenant_slug VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT DEFAULT '',
    priority VARCHAR(10) DEFAULT 'medium',
    contact VARCHAR(100) DEFAULT '',
    status VARCHAR(20) DEFAULT 'pending',  -- pending / accepted / rejected
    reject_reason TEXT DEFAULT '',
    created_at FLOAT NOT NULL,
    reviewed_at FLOAT DEFAULT 0,
    reviewer_id VARCHAR(36) DEFAULT ''
);
CREATE INDEX idx_intake_tenant_status ON intake_submissions(tenant_id, status);
```

---

## 验收标准

- [ ] `submit()`：参数校验（标题必填、长度截断、优先级白名单）
- [ ] `submit()`：验证 tenant_slug 存在，保存到 DB
- [ ] `accept()`：状态改为 accepted + 投入 catcher 队列
- [ ] `reject()`：状态改为 rejected + 记录拒绝理由
- [ ] 公开表单页：`GET /intake/{tenant_slug}` 返回静态 HTML
- [ ] 表单提交：`POST /intake/{tenant_slug}` 无需登录
- [ ] 管理台：`GET /api/v1/intake/list`（分 pending/accepted/rejected）
- [ ] 管理台：接受/拒绝按钮 + 拒绝时填写理由
- [ ] intake_submissions 数据库表 + 索引

---

*Codex Task | 来源：PLANE_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
