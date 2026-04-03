# CODEX TASK: 边缘端灰度部署分组（Canary → 全量，失败率自动熔断）

**优先级：P1**  
**来源：MENDER_BORROWING_ANALYSIS.md P1-#1（Mender Deployment Groups）**

---

## 背景

我们推送边缘端 `edge-runtime` 新版本时，当前是全量推送（所有边缘节点同时升级）。一旦新版本有 bug，全部代理商节点受影响。借鉴 Mender 灰度部署策略，实现 Canary → 全量 分阶段升级，并在失败率超阈值时自动暂停 + 告警。

---

## 一、数据模型

```python
# dragon-senate-saas-v2/edge_deployment_manager.py

from dataclasses import dataclass, field
from typing import Optional, List
from enum import Enum
from datetime import datetime
import uuid

class DeploymentStrategy(str, Enum):
    ALL    = "all"       # 全量（所有节点）
    CANARY = "canary"    # 金丝雀：先10%，观察后再全量
    PHASED = "phased"    # 阶段：10% → 50% → 100%

class DeploymentStatus(str, Enum):
    PENDING   = "pending"   # 待下发
    RUNNING   = "running"   # 下发中
    PAUSED    = "paused"    # 失败率过高，自动暂停
    COMPLETED = "completed" # 全部完成
    FAILED    = "failed"    # 终止失败

@dataclass
class DeploymentRecord:
    """一次版本推送记录"""
    deployment_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str = ""
    edge_version: str = ""          # 目标版本号（如 "v2.3.0"）
    strategy: DeploymentStrategy = DeploymentStrategy.CANARY
    target_edge_ids: List[str] = field(default_factory=list)   # 本轮目标节点
    all_edge_ids: List[str] = field(default_factory=list)      # 全部节点
    current_phase: int = 1          # 当前阶段（1=金丝雀，2=全量）
    status: DeploymentStatus = DeploymentStatus.PENDING
    
    # 统计
    success_count: int = 0
    failure_count: int = 0
    pending_count: int = 0
    
    # 配置
    failure_rate_threshold: float = 0.05   # 失败率阈值（5%）
    canary_ratio: float = 0.10             # 金丝雀比例（10%）
    observe_minutes: int = 60              # 金丝雀观察期（分钟）
    
    # 时间
    created_at: datetime = field(default_factory=datetime.utcnow)
    phase_started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    operator: str = "system"

    @property
    def failure_rate(self) -> float:
        total = self.success_count + self.failure_count
        return self.failure_count / total if total > 0 else 0.0

    @property
    def is_over_threshold(self) -> bool:
        total = self.success_count + self.failure_count
        return total >= 5 and self.failure_rate > self.failure_rate_threshold
```

---

## 二、部署管理器

```python
# dragon-senate-saas-v2/edge_deployment_manager.py（续）

import random
import asyncio
from .bridge_protocol import push_to_edge
from .webhook_event_bus import event_bus
from .event_subjects import EventSubjects

class EdgeDeploymentManager:
    """边缘端灰度部署管理器"""

    def __init__(self, db, redis_client):
        self.db = db
        self.redis = redis_client

    # ── 创建部署 ─────────────────────────────────────────────

    def create_deployment(
        self,
        tenant_id: str,
        edge_version: str,
        strategy: DeploymentStrategy = DeploymentStrategy.CANARY,
        operator: str = "system",
        failure_threshold: float = 0.05,
        canary_ratio: float = 0.10,
        observe_minutes: int = 60,
    ) -> DeploymentRecord:
        """创建一次部署计划"""
        all_edges = self._get_tenant_online_edges(tenant_id)
        if not all_edges:
            raise ValueError("没有在线边缘节点")

        if strategy == DeploymentStrategy.ALL:
            target = all_edges
        elif strategy == DeploymentStrategy.CANARY:
            # 随机抽取 10% 作为金丝雀组（至少1个）
            canary_count = max(1, int(len(all_edges) * canary_ratio))
            target = random.sample(all_edges, canary_count)
        else:  # PHASED
            canary_count = max(1, int(len(all_edges) * canary_ratio))
            target = random.sample(all_edges, canary_count)

        deployment = DeploymentRecord(
            tenant_id=tenant_id,
            edge_version=edge_version,
            strategy=strategy,
            target_edge_ids=target,
            all_edge_ids=all_edges,
            current_phase=1,
            pending_count=len(target),
            failure_rate_threshold=failure_threshold,
            canary_ratio=canary_ratio,
            observe_minutes=observe_minutes,
            operator=operator,
        )
        self._save_deployment(deployment)
        return deployment

    # ── 启动部署 ─────────────────────────────────────────────

    async def start_deployment(self, deployment_id: str):
        """开始向目标节点下发升级指令"""
        dep = self._get_deployment(deployment_id)
        dep.status = DeploymentStatus.RUNNING
        dep.phase_started_at = datetime.utcnow()
        self._save_deployment(dep)

        logger.info(f"[CanaryDeploy] 开始部署 {dep.edge_version} "
                    f"策略={dep.strategy} 目标={len(dep.target_edge_ids)}个节点")

        # 向目标节点逐个下发升级指令
        for edge_id in dep.target_edge_ids:
            push_to_edge(edge_id, {
                "type": "upgrade_request",
                "deployment_id": dep.deployment_id,
                "target_version": dep.edge_version,
                "rollback_on_failure": True,
            })
            await asyncio.sleep(0.5)  # 错峰下发，避免同时重启

        # 如果是 CANARY 策略，安排观察期检查
        if dep.strategy in (DeploymentStrategy.CANARY, DeploymentStrategy.PHASED):
            self._schedule_canary_check(
                deployment_id=dep.deployment_id,
                delay_minutes=dep.observe_minutes,
            )

        await event_bus.publish(
            EventSubjects.format("system.deployment.{dep_id}.started",
                                 dep_id=dep.deployment_id),
            {"deployment_id": dep.deployment_id, "version": dep.edge_version,
             "phase": dep.current_phase, "target_count": len(dep.target_edge_ids)},
        )

    # ── 边缘节点回报结果 ─────────────────────────────────────

    async def report_result(self, deployment_id: str, edge_id: str, success: bool, detail: dict = None):
        """边缘节点上报升级结果"""
        dep = self._get_deployment(deployment_id)
        if dep.status != DeploymentStatus.RUNNING:
            return

        if success:
            dep.success_count += 1
        else:
            dep.failure_count += 1
        dep.pending_count = max(0, dep.pending_count - 1)

        logger.info(f"[CanaryDeploy] {edge_id} 升级{'成功' if success else '失败'} "
                    f"({dep.success_count}成/{dep.failure_count}败/{dep.pending_count}待)")

        # 检查失败率是否超阈值
        if dep.is_over_threshold:
            await self._auto_pause(dep, reason=f"失败率 {dep.failure_rate:.1%} > 阈值 {dep.failure_rate_threshold:.1%}")
            return

        self._save_deployment(dep)

    # ── 观察期结束 → 推进下一阶段 ───────────────────────────

    async def advance_phase(self, deployment_id: str):
        """观察期结束，检查是否推进到全量"""
        dep = self._get_deployment(deployment_id)
        if dep.status != DeploymentStatus.RUNNING:
            return

        if dep.is_over_threshold:
            await self._auto_pause(dep, reason="观察期失败率超阈值")
            return

        if dep.current_phase == 1 and dep.strategy in (DeploymentStrategy.CANARY, DeploymentStrategy.PHASED):
            # 金丝雀通过 → 推全量
            already_upgraded = set(dep.target_edge_ids)
            remaining = [e for e in dep.all_edge_ids if e not in already_upgraded]

            if not remaining:
                dep.status = DeploymentStatus.COMPLETED
                dep.completed_at = datetime.utcnow()
                logger.info(f"[CanaryDeploy] {dep.deployment_id} 全量部署完成")
            else:
                dep.current_phase = 2
                dep.target_edge_ids = remaining
                dep.pending_count = len(remaining)
                dep.phase_started_at = datetime.utcnow()
                logger.info(f"[CanaryDeploy] 金丝雀通过，推进全量 → {len(remaining)}个节点")
                # 下发剩余节点
                for edge_id in remaining:
                    push_to_edge(edge_id, {
                        "type": "upgrade_request",
                        "deployment_id": dep.deployment_id,
                        "target_version": dep.edge_version,
                        "rollback_on_failure": True,
                    })
                    await asyncio.sleep(0.5)
        else:
            dep.status = DeploymentStatus.COMPLETED
            dep.completed_at = datetime.utcnow()

        self._save_deployment(dep)

    async def _auto_pause(self, dep: DeploymentRecord, reason: str):
        """自动暂停部署并告警"""
        dep.status = DeploymentStatus.PAUSED
        self._save_deployment(dep)
        logger.warning(f"[CanaryDeploy] 部署自动暂停: {dep.deployment_id} 原因={reason}")

        await event_bus.publish("system.alert.triggered", {
            "level": "critical",
            "title": f"边缘升级自动暂停 — {dep.edge_version}",
            "body": f"部署 {dep.deployment_id} 因{reason}已自动暂停，"
                    f"已升级节点={dep.success_count+dep.failure_count}，失败={dep.failure_count}",
            "deployment_id": dep.deployment_id,
        })

    def _schedule_canary_check(self, deployment_id: str, delay_minutes: int):
        from .task_queue import enqueue_background_task
        enqueue_background_task(
            "advance_edge_deployment_phase",
            {"deployment_id": deployment_id},
            delay=delay_minutes * 60,
        )

    def _get_tenant_online_edges(self, tenant_id: str) -> List[str]:
        """返回租户下所有在线边缘节点 ID"""
        return self.db.query("SELECT edge_id FROM edge_nodes WHERE tenant_id=? AND is_online=1", tenant_id)

    def _get_deployment(self, dep_id: str) -> DeploymentRecord:
        return self.db.get(DeploymentRecord, dep_id)

    def _save_deployment(self, dep: DeploymentRecord):
        self.db.save(dep)
```

---

## 三、API

```python
# dragon-senate-saas-v2/api_edge_deployment.py

@router.post("/edges/deployments")
async def create_deployment(body: CreateDeploymentBody, ctx=Depends(get_tenant_context)):
    """创建边缘端部署计划"""
    dep = deploy_mgr.create_deployment(
        tenant_id=ctx.tenant_id,
        edge_version=body.edge_version,
        strategy=body.strategy,               # "canary" | "phased" | "all"
        operator=ctx.user_id,
        failure_threshold=body.failure_threshold or 0.05,
        canary_ratio=body.canary_ratio or 0.10,
        observe_minutes=body.observe_minutes or 60,
    )
    return {"deployment_id": dep.deployment_id, "canary_count": len(dep.target_edge_ids)}

@router.post("/edges/deployments/{deployment_id}/start")
async def start_deployment(deployment_id: str, ctx=Depends(get_tenant_context)):
    await deploy_mgr.start_deployment(deployment_id)
    return {"status": "started"}

@router.post("/edges/deployments/{deployment_id}/resume")
async def resume_deployment(deployment_id: str, ctx=Depends(get_tenant_context)):
    """人工确认后恢复暂停的部署"""
    dep = deploy_mgr.get_deployment(deployment_id)
    dep.status = DeploymentStatus.RUNNING
    deploy_mgr.save(dep)
    await deploy_mgr.advance_phase(deployment_id)
    return {"status": "resumed"}

@router.get("/edges/deployments")
async def list_deployments(ctx=Depends(get_tenant_context)):
    """部署历史列表"""
    deps = deploy_mgr.list_tenant_deployments(ctx.tenant_id)
    return {"deployments": [asdict(d) for d in deps]}

@router.get("/edges/deployments/{deployment_id}")
async def get_deployment(deployment_id: str, ctx=Depends(get_tenant_context)):
    dep = deploy_mgr.get_deployment(deployment_id)
    return {
        **asdict(dep),
        "failure_rate_pct": f"{dep.failure_rate:.1%}",
        "progress_pct": (dep.success_count + dep.failure_count) / max(1, len(dep.all_edge_ids)),
    }

# 边缘节点回报升级结果（内部 API，由边缘端 WebSocket 消息触发）
@router.post("/internal/edges/deployments/{deployment_id}/result")
async def edge_report_result(deployment_id: str, body: EdgeUpgradeResultBody):
    await deploy_mgr.report_result(
        deployment_id=deployment_id,
        edge_id=body.edge_id,
        success=body.success,
        detail=body.detail,
    )
    return {"ok": True}
```

---

## 四、前端部署管理页面

```typescript
// web/src/app/edges/deployments/page.tsx

export function EdgeDeploymentsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data } = useQuery({ queryFn: api.listDeployments, refetchInterval: 5000 });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">边缘版本部署</h1>
        <Button onClick={() => setCreateOpen(true)}>+ 新建部署</Button>
      </div>

      <DataTable
        data={data?.deployments || []}
        columns={[
          { header: "版本", accessor: "edge_version" },
          { header: "策略", cell: (row) => (
            <Badge variant={row.strategy === "canary" ? "secondary" : "default"}>
              {row.strategy === "canary" ? "🐦 金丝雀" : row.strategy === "phased" ? "📶 阶段" : "📡 全量"}
            </Badge>
          )},
          { header: "状态", cell: (row) => <DeploymentStatusBadge status={row.status} /> },
          { header: "进度", cell: (row) => (
            <div className="flex items-center gap-2">
              <Progress value={row.progress_pct * 100} className="w-20" />
              <span className="text-xs text-muted-foreground">
                {row.success_count}✓ {row.failure_count}✗ {row.pending_count}待
              </span>
            </div>
          )},
          { header: "失败率", cell: (row) => (
            <span className={cn("text-xs font-mono",
              parseFloat(row.failure_rate_pct) > 5 ? "text-red-600" : "text-green-600")}>
              {row.failure_rate_pct}
            </span>
          )},
          { header: "操作", cell: (row) => (
            <div className="flex gap-1">
              {row.status === "pending" && (
                <Button size="sm" onClick={() => startDeployment(row.deployment_id)}>启动</Button>
              )}
              {row.status === "paused" && (
                <Button size="sm" variant="outline" onClick={() => resumeDeployment(row.deployment_id)}>
                  恢复
                </Button>
              )}
            </div>
          )},
        ]}
      />

      <CreateDeploymentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
```

---

## 验收标准

**云端（dragon-senate-saas-v2/）：**
- [ ] `DeploymentRecord` 数据模型（strategy/status/success/failure/threshold）
- [ ] `create_deployment()`：按策略选取金丝雀节点（10%），ALL/CANARY/PHASED 三种
- [ ] `start_deployment()`：错峰下发 `upgrade_request` 消息（每节点间隔0.5秒）
- [ ] `report_result()`：边缘回报后累计成功/失败，超阈值自动暂停
- [ ] `advance_phase()`：观察期结束 → 金丝雀通过推全量 or 触发暂停
- [ ] `_auto_pause()`：暂停 + 发 `system.alert.triggered` 事件
- [ ] API：POST /deployments、POST /start、POST /resume、GET /deployments/{id}
- [ ] 内部 API：POST /internal/.../result（边缘回报升级结果）
- [ ] 后台任务：`advance_edge_deployment_phase`（观察期到期触发）

**前端：**
- [ ] 部署列表页：版本/策略/状态/进度/失败率/操作
- [ ] 创建部署弹窗：选版本 + 选策略 + 观察时间配置
- [ ] 失败率超 5% 标红显示
- [ ] 暂停状态显示"恢复"按钮（人工审核后继续）
- [ ] 每5秒自动刷新进度

---

*Codex Task | 来源：MENDER_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
