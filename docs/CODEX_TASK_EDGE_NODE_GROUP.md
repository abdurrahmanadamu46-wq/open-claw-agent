# CODEX TASK: 边缘节点分组/层级管理（EdgeNodeGroup）

**优先级：P1**  
**来源：OPENREMOTE_BORROWING_ANALYSIS.md P1-#1（Asset Tree）**

---

## 背景

边缘节点目前是平铺的（只有 node_id + tenant_id），企业客户无法按"区域/部门/项目"组织节点，也无法批量派任务或批量升级。借鉴 OpenRemote 资产树，引入 `EdgeNodeGroup`（组）概念，节点挂在组下，组支持批量操作。

---

## 实现

```python
# dragon-senate-saas-v2/edge_node_group.py

from dataclasses import dataclass, field
from typing import Optional
import time
import logging

logger = logging.getLogger(__name__)


@dataclass
class EdgeNodeGroup:
    """
    边缘节点分组
    
    树形结构：租户 → 组（可嵌套）→ 节点
    支持：批量派任务 / 批量升级 / 批量状态查询
    """
    group_id: str
    tenant_id: str
    name: str                           # 组名（如"华东区 / 上海团队"）
    parent_group_id: Optional[str] = None  # 父组 ID（支持嵌套）
    description: str = ""
    tags: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    is_active: bool = True


class EdgeNodeGroupManager:
    """
    边缘节点分组管理器
    
    使用方式：
      mgr = EdgeNodeGroupManager(db)
      
      # 创建组
      mgr.create_group("华东区", tenant_id)
      
      # 节点加入组
      mgr.add_node_to_group(node_id, group_id)
      
      # 批量对组内节点派任务
      nodes = mgr.get_nodes_in_group(group_id)
      for node in nodes:
          await task_dispatcher.dispatch(node.node_id, task)
    """

    def __init__(self, db):
        self.db = db

    def create_group(
        self,
        name: str,
        tenant_id: str,
        parent_group_id: Optional[str] = None,
        description: str = "",
        tags: list[str] = None,
    ) -> EdgeNodeGroup:
        """创建节点组"""
        import uuid
        group = EdgeNodeGroup(
            group_id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            name=name,
            parent_group_id=parent_group_id,
            description=description,
            tags=tags or [],
        )
        self.db.insert("edge_node_groups", {
            "group_id": group.group_id,
            "tenant_id": group.tenant_id,
            "name": group.name,
            "parent_group_id": group.parent_group_id,
            "description": group.description,
            "tags": group.tags,
            "created_at": group.created_at,
        })
        logger.info(f"[NodeGroup] 创建组: {name} tenant={tenant_id}")
        return group

    def add_node_to_group(self, node_id: str, group_id: str):
        """将节点加入组"""
        self.db.update(
            "edge_nodes",
            {"group_id": group_id},
            where={"node_id": node_id},
        )
        logger.info(f"[NodeGroup] 节点 {node_id} → 组 {group_id}")

    def remove_node_from_group(self, node_id: str):
        """将节点从组移除"""
        self.db.update(
            "edge_nodes",
            {"group_id": None},
            where={"node_id": node_id},
        )

    def get_groups(self, tenant_id: str) -> list[dict]:
        """获取租户所有组（平铺，含层级信息）"""
        return self.db.query(
            "edge_node_groups",
            where={"tenant_id": tenant_id, "is_active": True},
        )

    def get_group_tree(self, tenant_id: str) -> list[dict]:
        """
        获取组树（嵌套结构，供前端渲染）
        
        Returns:
            [
              {"group_id": ..., "name": "华东区", "children": [
                {"group_id": ..., "name": "上海", "children": [], "node_count": 3},
              ], "node_count": 0},
            ]
        """
        groups = self.get_groups(tenant_id)
        nodes = self.db.query("edge_nodes", where={"tenant_id": tenant_id})

        # 计算每组节点数
        node_count_map: dict[str, int] = {}
        for node in nodes:
            gid = node.get("group_id")
            if gid:
                node_count_map[gid] = node_count_map.get(gid, 0) + 1

        # 构建树
        group_map = {g["group_id"]: {**g, "children": [], "node_count": node_count_map.get(g["group_id"], 0)} for g in groups}
        roots = []
        for g in group_map.values():
            parent = g.get("parent_group_id")
            if parent and parent in group_map:
                group_map[parent]["children"].append(g)
            else:
                roots.append(g)
        return roots

    def get_nodes_in_group(
        self, group_id: str, include_subgroups: bool = True
    ) -> list[dict]:
        """获取组内所有节点（可选包含子组节点）"""
        if not include_subgroups:
            return self.db.query("edge_nodes", where={"group_id": group_id})

        # 递归收集子组 ID
        all_group_ids = self._collect_subgroup_ids(group_id)
        all_group_ids.add(group_id)

        nodes = []
        for gid in all_group_ids:
            nodes.extend(self.db.query("edge_nodes", where={"group_id": gid}))
        return nodes

    def _collect_subgroup_ids(self, group_id: str) -> set[str]:
        """递归收集所有子组 ID"""
        children = self.db.query(
            "edge_node_groups",
            where={"parent_group_id": group_id, "is_active": True},
        )
        ids = set()
        for child in children:
            ids.add(child["group_id"])
            ids |= self._collect_subgroup_ids(child["group_id"])
        return ids

    async def batch_dispatch_to_group(
        self, group_id: str, task: dict, task_dispatcher
    ) -> dict:
        """批量向组内所有在线节点派发任务"""
        nodes = self.get_nodes_in_group(group_id)
        online_nodes = [n for n in nodes if n.get("status") == "online"]

        results = {"total": len(nodes), "online": len(online_nodes), "dispatched": 0, "failed": 0}
        for node in online_nodes:
            try:
                await task_dispatcher.dispatch(node["node_id"], task)
                results["dispatched"] += 1
            except Exception as e:
                logger.warning(f"[NodeGroup] 批量派任务失败 node={node['node_id']}: {e}")
                results["failed"] += 1

        logger.info(f"[NodeGroup] 批量派任务完成 group={group_id} {results}")
        return results
```

---

## FastAPI 路由

```python
# dragon-senate-saas-v2/app.py（追加路由）

from .edge_node_group import EdgeNodeGroupManager

@router.get("/api/v1/edge/groups/tree")
async def get_group_tree(ctx=Depends(get_tenant_context)):
    mgr = EdgeNodeGroupManager(db)
    return mgr.get_group_tree(ctx.tenant_id)

@router.post("/api/v1/edge/groups")
async def create_group(body: dict, ctx=Depends(get_tenant_context)):
    mgr = EdgeNodeGroupManager(db)
    group = mgr.create_group(
        name=body["name"],
        tenant_id=ctx.tenant_id,
        parent_group_id=body.get("parent_group_id"),
        description=body.get("description", ""),
        tags=body.get("tags", []),
    )
    return {"group_id": group.group_id, "name": group.name}

@router.post("/api/v1/edge/groups/{group_id}/batch-dispatch")
async def batch_dispatch(group_id: str, body: dict, ctx=Depends(get_tenant_context)):
    mgr = EdgeNodeGroupManager(db)
    return await mgr.batch_dispatch_to_group(group_id, body["task"], task_dispatcher)
```

---

## 数据库 Schema

```sql
-- 新增表
CREATE TABLE edge_node_groups (
    group_id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    parent_group_id VARCHAR(36),   -- NULL = 根组
    description TEXT DEFAULT '',
    tags JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    created_at FLOAT NOT NULL
);

-- edge_nodes 表新增字段
ALTER TABLE edge_nodes ADD COLUMN group_id VARCHAR(36);
```

---

## 验收标准

- [ ] `EdgeNodeGroup` 数据结构（支持嵌套 parent_group_id）
- [ ] `create_group()` / `add_node_to_group()` / `remove_node_from_group()`
- [ ] `get_group_tree()`：返回嵌套树结构（含 node_count）
- [ ] `get_nodes_in_group()`：支持递归包含子组节点
- [ ] `batch_dispatch_to_group()`：批量派任务（只对 online 节点）
- [ ] REST API：组树查询 / 创建组 / 批量派任务
- [ ] 前端：边缘节点管理页增加"组树"视图（可折叠树）
- [ ] 前端：节点详情中显示所属组，支持转移组

---

*Codex Task | 来源：OPENREMOTE_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
