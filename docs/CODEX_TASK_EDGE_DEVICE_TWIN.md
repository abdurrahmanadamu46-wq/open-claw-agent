# CODEX TASK: 边缘孪生状态对比（Device Twin — desired vs actual 自动对齐）

**优先级：P1**  
**来源：KUBEEDGE_BORROWING_ANALYSIS.md P1-#2（KubeEdge Device Twin）**

---

## 背景

我们的边缘节点目前是无状态的：云端下发任务→边缘执行→返回结果，但云端不知道边缘节点当前的"真实状态"（使用哪个版本的龙虾配置、技能版本是否最新、有多少任务积压）。借鉴 KubeEdge Device Twin，在云端为每个边缘节点维护 desired state + actual state，持续比较差异并自动触发对齐。

---

## 一、数据模型

```python
# dragon-senate-saas-v2/edge_device_twin.py

from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

@dataclass
class EdgeDesiredState:
    """云端期望的边缘节点状态"""
    edge_id: str
    lobster_configs: dict        # { "inkwriter": "v3", "radar": "v2.1" }
    skill_versions: dict         # { "inkwriter": "2.1.0", "radar": "1.5.0" }
    max_concurrent_tasks: int    # 最大并发任务数
    log_level: str               # "INFO" | "DEBUG" | "WARNING"
    feature_flags: dict          # { "offline_mode": True, "auto_upgrade": True }
    resource_version: int        # 版本号（乐观锁，防止乱序覆盖）
    updated_at: datetime

@dataclass
class EdgeActualState:
    """边缘节点上报的实际状态"""
    edge_id: str
    lobster_configs: dict        # 实际加载的龙虾配置版本
    skill_versions: dict         # 实际运行的技能版本
    pending_task_count: int      # 当前待执行任务数
    running_task_count: int      # 当前运行中任务数
    cpu_usage_pct: float         # CPU 使用率
    memory_usage_mb: int         # 内存使用
    is_online: bool
    last_heartbeat_at: datetime
    reported_at: datetime
    edge_version: str            # edge-runtime 版本号

@dataclass
class EdgeTwinDiff:
    """期望状态与实际状态的差异"""
    edge_id: str
    has_diff: bool
    config_diffs: list           # 需要升级的配置列表
    skill_diffs: list            # 需要升级的技能列表
    param_diffs: dict            # 需要更新的参数
    computed_at: datetime
```

---

## 二、云端 Twin 管理服务

```python
# dragon-senate-saas-v2/edge_twin_manager.py

from datetime import datetime
from typing import Optional, List
from .edge_device_twin import EdgeDesiredState, EdgeActualState, EdgeTwinDiff

class EdgeTwinManager:
    """边缘孪生状态管理器"""

    def __init__(self, db, redis_client):
        self.db = db
        self.redis = redis_client

    # ── Desired State 管理 ───────────────────────────────────

    def get_desired_state(self, edge_id: str) -> Optional[EdgeDesiredState]:
        """获取云端期望状态"""
        record = self.db.query(EdgeDesiredStateModel).filter_by(edge_id=edge_id).first()
        return record.to_dataclass() if record else None

    def update_desired_state(self, edge_id: str, updates: dict, operator: str = "system"):
        """更新期望状态（带乐观锁）"""
        record = self.db.query(EdgeDesiredStateModel).filter_by(edge_id=edge_id).first()
        if not record:
            record = EdgeDesiredStateModel(edge_id=edge_id, resource_version=1)
            self.db.add(record)

        # 应用更新
        for key, value in updates.items():
            setattr(record, key, value)
        record.resource_version += 1
        record.updated_at = datetime.utcnow()
        self.db.commit()

        # 记录审计日志
        logger.info(f"[DeviceTwin] 期望状态已更新 edge={edge_id} by={operator} v={record.resource_version}")
        
        # 触发状态对比
        self._schedule_diff_check(edge_id)
        return record.resource_version

    # ── Actual State 管理 ────────────────────────────────────

    def update_actual_state(self, edge_id: str, actual: EdgeActualState):
        """边缘节点上报实际状态（heartbeat 时携带）"""
        record = self.db.query(EdgeActualStateModel).filter_by(edge_id=edge_id).first()
        if not record:
            record = EdgeActualStateModel(edge_id=edge_id)
            self.db.add(record)

        for key, value in vars(actual).items():
            if key != "edge_id":
                setattr(record, key, value)
        self.db.commit()

        # 收到状态上报 → 立即触发差异检测
        diff = self.compute_diff(edge_id)
        if diff.has_diff:
            self._trigger_sync(edge_id, diff)

    # ── 差异计算 ─────────────────────────────────────────────

    def compute_diff(self, edge_id: str) -> EdgeTwinDiff:
        """计算 desired vs actual 差异"""
        desired = self.get_desired_state(edge_id)
        actual_record = self.db.query(EdgeActualStateModel).filter_by(edge_id=edge_id).first()

        if not desired or not actual_record:
            return EdgeTwinDiff(edge_id=edge_id, has_diff=False,
                                config_diffs=[], skill_diffs=[], param_diffs={},
                                computed_at=datetime.utcnow())

        config_diffs = []
        # 龙虾配置版本对比
        for lobster_id, desired_ver in desired.lobster_configs.items():
            actual_ver = (actual_record.lobster_configs or {}).get(lobster_id)
            if actual_ver != desired_ver:
                config_diffs.append({
                    "lobster_id": lobster_id,
                    "desired": desired_ver,
                    "actual": actual_ver,
                    "action": "upgrade" if actual_ver else "install",
                })

        skill_diffs = []
        # 技能版本对比
        for skill_id, desired_ver in desired.skill_versions.items():
            actual_ver = (actual_record.skill_versions or {}).get(skill_id)
            if actual_ver != desired_ver:
                skill_diffs.append({
                    "skill_id": skill_id,
                    "desired": desired_ver,
                    "actual": actual_ver,
                })

        param_diffs = {}
        # 参数对比
        if actual_record.max_concurrent_tasks != desired.max_concurrent_tasks:
            param_diffs["max_concurrent_tasks"] = desired.max_concurrent_tasks
        if actual_record.log_level != desired.log_level:
            param_diffs["log_level"] = desired.log_level

        has_diff = bool(config_diffs or skill_diffs or param_diffs)
        return EdgeTwinDiff(
            edge_id=edge_id,
            has_diff=has_diff,
            config_diffs=config_diffs,
            skill_diffs=skill_diffs,
            param_diffs=param_diffs,
            computed_at=datetime.utcnow(),
        )

    def _trigger_sync(self, edge_id: str, diff: EdgeTwinDiff):
        """向边缘节点下发同步指令"""
        logger.info(f"[DeviceTwin] 检测到差异，触发同步: edge={edge_id} "
                    f"configs={len(diff.config_diffs)} skills={len(diff.skill_diffs)}")
        # 通过 WebSocket 下发差量更新
        from .bridge_protocol import push_to_edge
        push_to_edge(edge_id, {
            "type": "twin_sync",
            "config_updates": diff.config_diffs,
            "skill_updates": diff.skill_diffs,
            "param_updates": diff.param_diffs,
        })

    def _schedule_diff_check(self, edge_id: str):
        """将差异检查加入异步队列"""
        from .task_queue import enqueue_background_task
        enqueue_background_task("edge_twin_diff_check", {"edge_id": edge_id}, delay=2)
```

---

## 三、Twin 状态 API

```python
# dragon-senate-saas-v2/api_edge_twin.py

@router.get("/edges/{edge_id}/twin")
async def get_edge_twin(edge_id: str, tenant_context=Depends(get_tenant_context)):
    """获取边缘节点孪生状态（desired + actual + diff）"""
    desired = twin_mgr.get_desired_state(edge_id)
    actual = twin_mgr.get_actual_state(edge_id)
    diff = twin_mgr.compute_diff(edge_id)
    return {
        "edge_id": edge_id,
        "desired": asdict(desired) if desired else None,
        "actual": asdict(actual) if actual else None,
        "diff": asdict(diff),
        "is_synced": not diff.has_diff,
    }

@router.patch("/edges/{edge_id}/twin/desired")
async def update_desired_state(
    edge_id: str,
    body: UpdateDesiredStateBody,
    tenant_context=Depends(get_tenant_context),
):
    """更新边缘节点期望状态"""
    new_version = twin_mgr.update_desired_state(
        edge_id=edge_id,
        updates=body.updates,
        operator=tenant_context.user_id,
    )
    return {"resource_version": new_version, "message": "期望状态已更新，将自动同步到边缘"}

@router.get("/edges/twin-overview")
async def twin_overview(tenant_context=Depends(get_tenant_context)):
    """所有边缘节点孪生状态总览（哪些需要同步）"""
    edges = get_tenant_edges(tenant_context.tenant_id)
    result = []
    for edge in edges:
        diff = twin_mgr.compute_diff(edge.id)
        result.append({
            "edge_id": edge.id,
            "edge_name": edge.name,
            "is_synced": not diff.has_diff,
            "pending_config_updates": len(diff.config_diffs),
            "pending_skill_updates": len(diff.skill_diffs),
        })
    return {"edges": result, "total_unsynced": sum(1 for e in result if not e["is_synced"])}
```

---

## 四、边缘端接收同步指令

```python
# edge-runtime/wss_receiver.py — 处理 twin_sync 消息

class WSSReceiver:
    async def on_twin_sync(self, msg: dict):
        """处理云端下发的孪生同步指令"""
        logger.info(f"[DeviceTwin] 收到同步指令：configs={len(msg.get('config_updates',[]))} "
                    f"skills={len(msg.get('skill_updates',[]))}")
        
        # 更新龙虾配置
        for config_update in msg.get("config_updates", []):
            cache.save_lobster_config(CachedLobsterConfig(
                lobster_id=config_update["lobster_id"],
                config_version=config_update["desired"],
                config_json=json.dumps(config_update["config_data"]),
                synced_at=time.time(),
            ))
            logger.info(f"[DeviceTwin] 配置已同步: {config_update['lobster_id']} → {config_update['desired']}")

        # 更新运行参数
        for param, value in msg.get("param_updates", {}).items():
            apply_runtime_param(param, value)

        # 上报同步完成（更新 actual state）
        await self._report_actual_state()

    async def _report_actual_state(self):
        """上报当前实际状态给云端"""
        await self.wss.send({
            "type": "actual_state_report",
            "lobster_configs": {cfg.lobster_id: cfg.config_version
                                for cfg in cache.get_all_lobster_configs()},
            "skill_versions": get_current_skill_versions(),
            "pending_task_count": cache.count_pending_tasks(),
            "running_task_count": get_running_task_count(),
            "cpu_usage_pct": get_cpu_usage(),
            "memory_usage_mb": get_memory_usage_mb(),
            "edge_version": EDGE_RUNTIME_VERSION,
            "reported_at": time.time(),
        })
```

---

## 五、前端孪生状态监控组件

```typescript
// web/src/app/edges/page.tsx — 边缘节点列表新增同步状态列

// 在现有边缘节点列表中，每行显示孪生状态
<DataTable
  columns={[
    { header: "节点", accessor: "edge_name" },
    { header: "连接状态", cell: (row) => <OnlineStatusBadge status={row.is_online} /> },
    {
      header: "配置同步",
      cell: (row) => (
        <div className="flex items-center gap-1">
          {row.is_synced ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3 w-3" /> 已同步
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-orange-500">
              <AlertCircle className="h-3 w-3" />
              待同步 ({row.pending_config_updates}配置
              {row.pending_skill_updates > 0 ? `+${row.pending_skill_updates}技能` : ''})
            </span>
          )}
        </div>
      ),
    },
    {
      header: "操作",
      cell: (row) => (
        <Button size="sm" variant="ghost" onClick={() => openTwinDetail(row.edge_id)}>
          查看孪生状态
        </Button>
      ),
    },
  ]}
/>

// web/src/components/edge/EdgeTwinDetailDrawer.tsx
export function EdgeTwinDetailDrawer({ edgeId, open, onClose }) {
  const { data } = useQuery({
    queryFn: () => api.get(`/v1/edges/${edgeId}/twin`),
    enabled: open, refetchInterval: 10_000,
  });

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[500px]">
        <SheetHeader><SheetTitle>孪生状态 — {edgeId}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4">
          <div className={cn("p-3 rounded-md text-sm",
            data?.is_synced ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-700")}>
            {data?.is_synced ? "✅ 状态已完全同步" : "⚠️ 存在配置差异，正在同步..."}
          </div>
          
          {/* 差异列表 */}
          {data?.diff.config_diffs.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">待同步配置</p>
              {data.diff.config_diffs.map(d => (
                <div key={d.lobster_id} className="flex justify-between text-xs p-2 border rounded mb-1">
                  <span className="font-mono">{d.lobster_id}</span>
                  <span className="text-muted-foreground">{d.actual || '未安装'} → {d.desired}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

---

## 验收标准

**云端 Twin 管理（dragon-senate-saas-v2/）：**
- [ ] `EdgeDesiredState` + `EdgeActualState` + `EdgeTwinDiff` 数据模型
- [ ] `EdgeTwinManager.update_desired_state()`（带 resource_version 乐观锁）
- [ ] `EdgeTwinManager.update_actual_state()`（边缘上报时调用）
- [ ] `EdgeTwinManager.compute_diff()`：逐字段对比 desired vs actual
- [ ] `EdgeTwinManager._trigger_sync()`：差异时通过 WebSocket 下发 `twin_sync`
- [ ] `GET /edges/{id}/twin` API（desired + actual + diff）
- [ ] `PATCH /edges/{id}/twin/desired` API（更新期望状态）
- [ ] `GET /edges/twin-overview` API（所有节点同步状态总览）

**边缘端（edge-runtime/）：**
- [ ] `wss_receiver.on_twin_sync()`：接收并应用配置更新
- [ ] `_report_actual_state()`：同步完成后上报最新实际状态
- [ ] 心跳时自动携带 actual state（与 edge_heartbeat.py 集成）

**前端：**
- [ ] 边缘节点列表新增"配置同步"列（已同步绿/待同步橙）
- [ ] `EdgeTwinDetailDrawer`：孪生状态详情（差异列表）
- [ ] 同步状态每10秒自动刷新

---

*Codex Task | 来源：KUBEEDGE_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
