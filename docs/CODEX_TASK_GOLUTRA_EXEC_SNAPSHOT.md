# CODEX TASK: 边缘执行快照系统（借鉴 Golutra Terminal Snapshot Audit）
**任务ID**: CODEX-GOLUTRA-SNAPSHOT-P2-003  
**优先级**: 🟡 P2（边缘可观测性增强）  
**依赖文件**: `edge-runtime/marionette_executor.py`  
**参考项目**: Golutra（terminal_engine/session/snapshot_service.rs + snapshot_dump.rs + terminalSnapshotAuditStore.ts）  
**预计工期**: 2天

---

## 一、Golutra 原始设计

Golutra 在每个 CLI Agent 终端会话中实现了"快照审计"系统：
- `snapshot_service.rs` — 定期截取终端状态快照
- `snapshot_dump.rs` — 快照导出/持久化
- `terminalSnapshotAuditStore.ts` — 前端快照审计 Store
- `TerminalSnapshotAuditReportModal.vue` — 审计报告弹窗（可查看任意时间点的执行状态）

核心理念：**Agent 的每次操作都是可回溯的**，运营人员可以"回放"任意时间点的执行现场。

---

## 二、我们的痛点

当前边缘执行层（`marionette_executor.py`）执行完浏览器操作后：
- ❌ 不知道操作前页面是什么状态
- ❌ 不知道操作中经历了哪些步骤
- ❌ 出错时无法复现当时的执行环境
- ❌ 没有截图/录屏证据链

---

## 三、实现代码

### 3.1 边缘侧：执行快照采集

```python
# edge-runtime/execution_snapshot.py（新建）
"""
边缘执行快照系统（借鉴 Golutra snapshot_service）

每次边缘操作（发布/采集/回复）前后自动快照，
包含：页面URL、DOM摘要、关键步骤截图、操作耗时、最终状态。
快照上报云端，支持管理员远程回溯审计。
"""

import time
import json
import logging
from dataclasses import dataclass, field
from typing import Optional
from uuid import uuid4
from datetime import datetime

logger = logging.getLogger("execution_snapshot")


@dataclass
class StepCapture:
    """单步操作截取"""
    step_index: int
    step_name: str           # click_login / fill_content / submit_publish
    timestamp: float
    page_url: str
    screenshot_path: Optional[str] = None  # 本地截图路径（后续上传 OSS）
    dom_summary: str = ""    # 关键 DOM 元素摘要（如输入框内容长度）
    status: str = "ok"       # ok / warning / error
    error_msg: str = ""


@dataclass
class ExecutionSnapshot:
    """完整执行快照"""
    snapshot_id: str
    node_id: str
    tenant_id: str
    account_id: str
    platform: str            # xiaohongshu / douyin / weibo
    action_type: str         # publish / collect / reply / monitor
    
    # 操作时间线
    started_at: float = 0.0
    finished_at: float = 0.0
    duration_ms: int = 0
    
    # 操作前后状态
    before_url: str = ""
    after_url: str = ""
    before_screenshot: Optional[str] = None
    after_screenshot: Optional[str] = None
    
    # 步骤详情
    steps: list[StepCapture] = field(default_factory=list)
    total_steps: int = 0
    
    # 最终结果
    status: str = "pending"  # pending → running → success → failed → timeout
    result_summary: str = ""
    error_detail: str = ""
    
    # 关联ID
    task_id: Optional[str] = None
    workflow_run_id: Optional[str] = None


class SnapshotCollector:
    """
    快照采集器 — 包裹在 marionette_executor 的操作中
    
    用法：
        collector = SnapshotCollector(node_id, tenant_id, account_id, "xiaohongshu")
        
        async with collector.session("publish", task_id="task-001") as snap:
            snap.capture_before(page)
            
            snap.step("login", page)
            await do_login(page)
            
            snap.step("fill_content", page)
            await fill_content(page, content)
            
            snap.step("submit", page)
            await click_submit(page)
            
            snap.capture_after(page)
        
        # session 结束后自动上报云端
    """
    
    def __init__(self, node_id: str, tenant_id: str, account_id: str,
                 platform: str, uploader=None):
        self.node_id = node_id
        self.tenant_id = tenant_id
        self.account_id = account_id
        self.platform = platform
        self.uploader = uploader  # async def upload(snapshot) → 上报云端
        self._snapshots: list[ExecutionSnapshot] = []
    
    class _Session:
        def __init__(self, collector: "SnapshotCollector", action_type: str,
                     task_id: str = None):
            self.collector = collector
            self.snapshot = ExecutionSnapshot(
                snapshot_id=f"snap-{uuid4().hex[:12]}",
                node_id=collector.node_id,
                tenant_id=collector.tenant_id,
                account_id=collector.account_id,
                platform=collector.platform,
                action_type=action_type,
                task_id=task_id,
            )
            self._step_index = 0
        
        async def __aenter__(self):
            self.snapshot.started_at = time.time()
            self.snapshot.status = "running"
            logger.info(f"Snapshot session started: {self.snapshot.snapshot_id}")
            return self
        
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            self.snapshot.finished_at = time.time()
            self.snapshot.duration_ms = int(
                (self.snapshot.finished_at - self.snapshot.started_at) * 1000
            )
            self.snapshot.total_steps = len(self.snapshot.steps)
            
            if exc_type:
                self.snapshot.status = "failed"
                self.snapshot.error_detail = str(exc_val)
            elif self.snapshot.status == "running":
                self.snapshot.status = "success"
            
            # 上报云端
            self.collector._snapshots.append(self.snapshot)
            if self.collector.uploader:
                try:
                    await self.collector.uploader(self.snapshot)
                except Exception as e:
                    logger.warning(f"Snapshot upload failed: {e}")
            
            logger.info(
                f"Snapshot session ended: {self.snapshot.snapshot_id} "
                f"status={self.snapshot.status} "
                f"steps={self.snapshot.total_steps} "
                f"duration={self.snapshot.duration_ms}ms"
            )
            return False  # 不吞异常
        
        def capture_before(self, page=None):
            """截取操作前状态"""
            if page:
                self.snapshot.before_url = getattr(page, "url", "")
                try:
                    path = f"/tmp/snap_{self.snapshot.snapshot_id}_before.png"
                    # page.screenshot(path=path)  # Playwright API
                    self.snapshot.before_screenshot = path
                except Exception:
                    pass
        
        def capture_after(self, page=None):
            """截取操作后状态"""
            if page:
                self.snapshot.after_url = getattr(page, "url", "")
                try:
                    path = f"/tmp/snap_{self.snapshot.snapshot_id}_after.png"
                    # page.screenshot(path=path)
                    self.snapshot.after_screenshot = path
                except Exception:
                    pass
        
        def step(self, step_name: str, page=None, status: str = "ok",
                 error_msg: str = ""):
            """记录一个操作步骤"""
            self._step_index += 1
            capture = StepCapture(
                step_index=self._step_index,
                step_name=step_name,
                timestamp=time.time(),
                page_url=getattr(page, "url", "") if page else "",
                status=status,
                error_msg=error_msg,
            )
            
            # 可选：每步截图（生产环境可配置是否开启）
            if page and self._step_index <= 10:  # 最多截10步
                try:
                    path = f"/tmp/snap_{self.snapshot.snapshot_id}_step{self._step_index}.png"
                    # page.screenshot(path=path)
                    capture.screenshot_path = path
                except Exception:
                    pass
            
            self.snapshot.steps.append(capture)
    
    def session(self, action_type: str, task_id: str = None):
        """创建快照会话"""
        return self._Session(self, action_type, task_id)
    
    def get_recent(self, limit: int = 20) -> list[ExecutionSnapshot]:
        """获取最近的快照（本地缓存）"""
        return self._snapshots[-limit:]
    
    def to_report(self, snapshot: ExecutionSnapshot) -> dict:
        """转为可序列化的审计报告"""
        return {
            "snapshot_id": snapshot.snapshot_id,
            "node_id": snapshot.node_id,
            "tenant_id": snapshot.tenant_id,
            "account_id": snapshot.account_id,
            "platform": snapshot.platform,
            "action_type": snapshot.action_type,
            "status": snapshot.status,
            "duration_ms": snapshot.duration_ms,
            "total_steps": snapshot.total_steps,
            "started_at": datetime.fromtimestamp(snapshot.started_at).isoformat(),
            "finished_at": datetime.fromtimestamp(snapshot.finished_at).isoformat(),
            "before_url": snapshot.before_url,
            "after_url": snapshot.after_url,
            "result_summary": snapshot.result_summary,
            "error_detail": snapshot.error_detail,
            "steps": [
                {
                    "index": s.step_index,
                    "name": s.step_name,
                    "url": s.page_url,
                    "status": s.status,
                    "error": s.error_msg,
                    "screenshot": s.screenshot_path,
                }
                for s in snapshot.steps
            ],
        }
```

### 3.2 与 marionette_executor.py 集成

```python
# edge-runtime/marionette_executor.py 升级点

from .execution_snapshot import SnapshotCollector

class MarionetteExecutor:
    def __init__(self, node_id, tenant_id, ...):
        self.snapshot_collector = SnapshotCollector(
            node_id=node_id,
            tenant_id=tenant_id,
            account_id="",
            platform="",
            uploader=self._upload_snapshot,
        )
    
    async def execute_publish(self, task):
        self.snapshot_collector.account_id = task["account_id"]
        self.snapshot_collector.platform = task["platform"]
        
        async with self.snapshot_collector.session("publish", task["task_id"]) as snap:
            page = await self.browser.new_page()
            
            snap.capture_before(page)
            
            snap.step("navigate", page)
            await page.goto(task["target_url"])
            
            snap.step("login_check", page)
            await self.ensure_logged_in(page, task["account_id"])
            
            snap.step("fill_content", page)
            await self.fill_publish_form(page, task["content"])
            
            snap.step("submit", page)
            await self.click_publish(page)
            
            snap.capture_after(page)
            snap.snapshot.result_summary = "Published successfully"
```

### 3.3 云端侧：快照查询 API

```python
# dragon-senate-saas-v2/api_snapshot_audit.py（新建）

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/v1/snapshots", tags=["snapshot-audit"])

@router.get("/")
async def list_snapshots(
    tenant_id: str,
    node_id: str = None,
    account_id: str = None,
    status: str = None,
    limit: int = Query(20, le=100),
):
    """查询边缘执行快照列表"""
    # 从 DB 查询（边缘上报后存储）
    pass

@router.get("/{snapshot_id}")
async def get_snapshot_detail(snapshot_id: str, tenant_id: str):
    """查看快照详情（含步骤时间线+截图）"""
    pass

@router.get("/{snapshot_id}/replay")
async def get_snapshot_replay(snapshot_id: str, tenant_id: str):
    """获取快照回放数据（步骤时间线+截图序列）"""
    pass
```

---

## 四、前端审计页面（SaaS Dashboard）

参考 Golutra 的 `TerminalSnapshotAuditReportModal.vue`，在我们的 `dragon_dashboard` 中增加：

```
/operations/edge-audit
├── 快照列表（按时间/节点/账号/状态筛选）
├── 快照详情（步骤时间线 + 每步截图）
├── 回放模式（逐步播放截图序列，类似幻灯片）
└── 失败诊断（自动高亮失败步骤 + 错误详情）
```

---

## 五、验收标准

- [ ] SnapshotCollector 的 session 上下文管理器正常工作
- [ ] capture_before / capture_after 截取页面状态
- [ ] step() 记录每步操作（含 URL、时间戳、状态）
- [ ] 异常自动标记 failed + 记录 error_detail
- [ ] to_report() 输出可序列化的审计报告
- [ ] 与 marionette_executor.py 集成：每次操作自动快照
- [ ] 快照上报云端（通过 WSS 或 HTTP 上传）
- [ ] 云端 API：list / detail / replay 三个端点
- [ ] 截图限制：每次操作最多 10 张步骤截图（防止存储爆炸）
