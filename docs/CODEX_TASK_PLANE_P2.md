# CODEX TASK: Plane P2 合并（任务优先级队列 + 龙虾文档库）

**优先级：P2**  
**来源：PLANE_BORROWING_ANALYSIS.md P2-#3 + P2-#4**

---

## P2-3：任务优先级队列（task_queue.py 改造）

### 背景

`task_queue.py` 所有任务 FIFO，无优先级区分。借鉴 Plane 5级优先级，新增 `priority` 字段，紧急任务插队，与 Intake 表单和 LobsterTriggerRule 联动。

### 实现

```python
# dragon-senate-saas-v2/task_queue.py（改造）

from enum import IntEnum

class TaskPriority(IntEnum):
    URGENT = 0   # 紧急：插队到队首
    HIGH   = 1   # 高
    MEDIUM = 2   # 中（默认）
    LOW    = 3   # 低

PRIORITY_NAMES = {0: "urgent", 1: "high", 2: "medium", 3: "low"}
PRIORITY_VALUES = {"urgent": 0, "high": 1, "medium": 2, "low": 3}


class PriorityTaskQueue:
    """
    优先级任务队列（改造现有 task_queue.py）
    
    入队：按优先级插入正确位置
    出队：总是取优先级最高的就绪任务
    """

    def enqueue(self, task: dict) -> str:
        """
        入队（支持优先级）
        
        task 必须包含字段：
          lobster_name, tenant_id, title, description
        可选字段：
          priority（默认 "medium"）, source, intake_id
        """
        import uuid, time
        priority_str = task.get("priority", "medium")
        priority_val = PRIORITY_VALUES.get(priority_str, TaskPriority.MEDIUM)

        task_id = task.get("task_id") or str(uuid.uuid4())
        record = {
            "task_id": task_id,
            "lobster_name": task["lobster_name"],
            "tenant_id": task["tenant_id"],
            "title": task.get("title", ""),
            "description": task.get("description", ""),
            "priority": priority_str,
            "priority_val": priority_val,
            "status": "pending",
            "source": task.get("source", "manual"),
            "intake_id": task.get("intake_id", ""),
            "contact": task.get("contact", ""),
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        self.db.insert("task_queue", record)
        return task_id

    def dequeue_next(self, lobster_name: str, tenant_id: str) -> dict | None:
        """取出下一个最高优先级的待处理任务"""
        rows = self.db.query_raw(
            """
            SELECT * FROM task_queue
            WHERE lobster_name=? AND tenant_id=? AND status='pending'
            ORDER BY priority_val ASC, created_at ASC
            LIMIT 1
            """,
            [lobster_name, tenant_id],
        )
        if not rows:
            return None
        task = rows[0]
        self.db.update("task_queue", {
            "status": "running",
            "updated_at": __import__("time").time(),
        }, where={"task_id": task["task_id"]})
        return task

    def set_status(self, task_id: str, status: str, error_msg: str = ""):
        """更新任务状态（done / failed / cancelled）"""
        import time
        self.db.update("task_queue", {
            "status": status,
            "error_msg": error_msg,
            "updated_at": time.time(),
        }, where={"task_id": task_id})
```

### 数据库迁移

```sql
-- task_queue 表新增字段
ALTER TABLE task_queue ADD COLUMN priority VARCHAR(10) DEFAULT 'medium';
ALTER TABLE task_queue ADD COLUMN priority_val INTEGER DEFAULT 2;
ALTER TABLE task_queue ADD COLUMN title VARCHAR(200) DEFAULT '';
ALTER TABLE task_queue ADD COLUMN source VARCHAR(50) DEFAULT 'manual';
ALTER TABLE task_queue ADD COLUMN intake_id VARCHAR(36) DEFAULT '';
ALTER TABLE task_queue ADD COLUMN contact VARCHAR(100) DEFAULT '';
ALTER TABLE task_queue ADD COLUMN error_msg TEXT DEFAULT '';

-- 优化索引（按龙虾+优先级+状态查询）
CREATE INDEX idx_task_queue_dispatch
  ON task_queue(lobster_name, tenant_id, status, priority_val, created_at);
```

### 验收标准

- [ ] `TaskPriority` 枚举（URGENT=0 / HIGH=1 / MEDIUM=2 / LOW=3）
- [ ] `enqueue()`：写入 priority_val 整数值（用于排序）
- [ ] `dequeue_next()`：按 priority_val ASC + created_at ASC 取最高优先级任务
- [ ] `set_status()`：支持 done / failed / cancelled + error_msg
- [ ] Intake 接受的任务自动带 priority 字段
- [ ] LobsterTriggerRule 触发的任务默认 HIGH

---

## P2-4：龙虾文档库（LobsterDocStore）

### 背景

龙虾（inkwriter/strategist）生成的策略文档、内容方案只存为聊天消息，运营无法在线编辑和归档。借鉴 Plane Pages，新增轻量 Markdown 文档库，自动保存龙虾产出，支持在线编辑和版本历史。

### 实现

```python
# dragon-senate-saas-v2/lobster_doc_store.py

import time
import uuid
import logging
import hashlib

logger = logging.getLogger(__name__)

# 触发自动存为文档的龙虾白名单
AUTO_SAVE_LOBSTERS = {"inkwriter", "strategist", "visualizer"}
MIN_DOC_LENGTH = 200   # 内容少于200字不自动存为文档


class LobsterDocStore:
    """
    龙虾文档库
    
    用途：
      1. 龙虾产出自动存为文档（auto_save_from_task）
      2. 运营手动编辑文档（update_content）
      3. 查看历史版本（get_versions）
      4. 前端 Markdown 预览
    
    Schema: lobster_docs
      doc_id | tenant_id | lobster_name | title | content (Markdown)
             | task_id | version | created_at | updated_at | is_latest
    """

    def __init__(self, db):
        self.db = db

    def auto_save_from_task(
        self,
        task_id: str,
        lobster_name: str,
        tenant_id: str,
        output: str,
        title: str = "",
    ) -> str | None:
        """
        龙虾任务完成后自动保存输出为文档
        
        仅对 AUTO_SAVE_LOBSTERS 中的龙虾且内容足够长时保存
        """
        if lobster_name not in AUTO_SAVE_LOBSTERS:
            return None
        if len(output.strip()) < MIN_DOC_LENGTH:
            return None

        doc_id = str(uuid.uuid4())
        auto_title = title or self._extract_title(output, lobster_name)
        content_hash = hashlib.md5(output.encode()).hexdigest()[:8]

        self.db.insert("lobster_docs", {
            "doc_id": doc_id,
            "tenant_id": tenant_id,
            "lobster_name": lobster_name,
            "title": auto_title,
            "content": output,
            "content_hash": content_hash,
            "task_id": task_id,
            "version": 1,
            "is_latest": True,
            "created_at": time.time(),
            "updated_at": time.time(),
        })
        logger.info(f"[DocStore] 自动保存文档 doc={doc_id} lobster={lobster_name} len={len(output)}")
        return doc_id

    def update_content(
        self,
        doc_id: str,
        tenant_id: str,
        new_content: str,
        editor_id: str = "",
    ) -> dict:
        """运营手动编辑文档（创建新版本）"""
        current = self.db.query_one(
            "lobster_docs",
            where={"doc_id": doc_id, "tenant_id": tenant_id, "is_latest": True},
        )
        if not current:
            return {"success": False, "error": "文档不存在"}

        new_version = current["version"] + 1
        now = time.time()

        # 将旧版本 is_latest 置 False
        self.db.update("lobster_docs",
                       {"is_latest": False},
                       where={"doc_id": doc_id, "version": current["version"]})

        # 写新版本
        self.db.insert("lobster_docs", {
            **current,
            "version": new_version,
            "content": new_content,
            "content_hash": hashlib.md5(new_content.encode()).hexdigest()[:8],
            "is_latest": True,
            "editor_id": editor_id,
            "updated_at": now,
        })
        return {"success": True, "version": new_version}

    def get_doc(self, doc_id: str, tenant_id: str) -> dict | None:
        """获取文档最新版本"""
        return self.db.query_one(
            "lobster_docs",
            where={"doc_id": doc_id, "tenant_id": tenant_id, "is_latest": True},
        )

    def list_docs(self, tenant_id: str, lobster_name: str = "") -> list[dict]:
        """列出所有最新文档（可按龙虾过滤）"""
        where = {"tenant_id": tenant_id, "is_latest": True}
        if lobster_name:
            where["lobster_name"] = lobster_name
        return self.db.query("lobster_docs", where=where, order_by="updated_at DESC")

    def get_versions(self, doc_id: str, tenant_id: str) -> list[dict]:
        """获取文档所有版本历史"""
        return self.db.query_raw(
            "SELECT version, content_hash, updated_at, editor_id, is_latest "
            "FROM lobster_docs WHERE doc_id=? AND tenant_id=? ORDER BY version DESC",
            [doc_id, tenant_id],
        )

    def _extract_title(self, content: str, lobster_name: str) -> str:
        """从内容提取标题（取第一行，最多40字）"""
        first_line = content.strip().split("\n")[0].lstrip("#").strip()
        if first_line and len(first_line) <= 40:
            return first_line
        return f"{lobster_name} 文档 {time.strftime('%m-%d %H:%M')}"
```

### API 路由

```python
# dragon-senate-saas-v2/app.py（追加路由）

@router.get("/api/v1/docs")
async def list_docs(lobster_name: str = "", ctx=Depends(get_tenant_context)):
    store = LobsterDocStore(db)
    return store.list_docs(ctx.tenant_id, lobster_name)

@router.get("/api/v1/docs/{doc_id}")
async def get_doc(doc_id: str, ctx=Depends(get_tenant_context)):
    store = LobsterDocStore(db)
    doc = store.get_doc(doc_id, ctx.tenant_id)
    return doc or {"error": "not found"}

@router.put("/api/v1/docs/{doc_id}")
async def update_doc(doc_id: str, body: dict, ctx=Depends(get_tenant_context)):
    store = LobsterDocStore(db)
    return store.update_content(doc_id, ctx.tenant_id, body.get("content", ""), ctx.user_id)

@router.get("/api/v1/docs/{doc_id}/versions")
async def doc_versions(doc_id: str, ctx=Depends(get_tenant_context)):
    store = LobsterDocStore(db)
    return store.get_versions(doc_id, ctx.tenant_id)
```

### 验收标准

- [ ] `auto_save_from_task()`：仅 inkwriter/strategist/visualizer，内容 >= 200字
- [ ] `update_content()`：创建新版本，旧版本 is_latest=False
- [ ] `get_versions()`：版本列表（version / content_hash / updated_at）
- [ ] `list_docs()`：支持按 lobster_name 过滤
- [ ] 龙虾任务完成后调用 `auto_save_from_task()`（在 lobster_runner.py 中）
- [ ] 前端：文档列表页（管理台新 Tab）
- [ ] 前端：文档详情页（Markdown 渲染 + 编辑区 + 版本历史侧栏）

---

*Codex Task | 来源：PLANE_BORROWING_ANALYSIS.md P2-#3+4 | 2026-04-02*
