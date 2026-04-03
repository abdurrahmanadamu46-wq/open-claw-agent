# CODEX TASK: 边缘节点标签系统（Tag CRUD + 按标签筛选/批量操作）

**优先级：P1**  
**来源：MESHCENTRAL_BORROWING_ANALYSIS.md P1-#2（MeshCentral Device Group + Tags）**

---

## 背景

边缘节点目前只有 `tenant_id` 分组，无法按地区/类型/等级等维度批量操作。借鉴 MeshCentral 设备标签，为边缘节点添加灵活标签系统（`key:value` 格式），与已落地的 Canary Deploy、Device Twin、Config Broadcast 配合，解锁按标签灰度部署、按标签推配置等能力。

---

## 一、数据模型

```python
# dragon-senate-saas-v2/edge_node_tags.py

# 标签格式：key:value（如 "region:华北"、"tier:premium"、"type:store"）
# 存储：edge_nodes.tags = JSON Array

TAG_FORMATS = [
    "region:{city}",       # 地区：region:华北 / region:华南
    "tier:{level}",        # 等级：tier:premium / tier:standard
    "type:{node_type}",    # 类型：type:store / type:warehouse
    "env:{environment}",   # 环境：env:prod / env:staging
    "version:{ver}",       # 版本：version:v2.2.0（自动维护，勿手动设置）
]

class EdgeNodeTagService:
    """边缘节点标签管理服务"""

    def __init__(self, db):
        self.db = db

    def get_tags(self, edge_id: str) -> list[str]:
        node = self.db.get_edge_node(edge_id)
        return node.tags or []

    def add_tags(self, edge_id: str, tags: list[str], operator: str = "user"):
        """添加标签（幂等）"""
        node = self.db.get_edge_node(edge_id)
        current = set(node.tags or [])
        new_tags = [t for t in tags if self._validate_tag(t)]
        current.update(new_tags)
        node.tags = sorted(current)
        self.db.save(node)
        self._audit(edge_id, "tags_added", {"tags": new_tags, "operator": operator})

    def remove_tags(self, edge_id: str, tags: list[str], operator: str = "user"):
        """移除标签"""
        node = self.db.get_edge_node(edge_id)
        current = set(node.tags or [])
        current -= set(tags)
        node.tags = sorted(current)
        self.db.save(node)
        self._audit(edge_id, "tags_removed", {"tags": tags, "operator": operator})

    def set_tags(self, edge_id: str, tags: list[str], operator: str = "user"):
        """全量替换标签"""
        node = self.db.get_edge_node(edge_id)
        node.tags = sorted(set(t for t in tags if self._validate_tag(t)))
        self.db.save(node)
        self._audit(edge_id, "tags_set", {"tags": node.tags, "operator": operator})

    def query_by_tags(
        self,
        tenant_id: str,
        include_tags: list[str] = None,   # AND 语义：必须包含全部
        exclude_tags: list[str] = None,   # 排除含任意一个的节点
        any_tags: list[str] = None,       # OR 语义：包含任意一个即可
        online_only: bool = False,
    ) -> list[str]:
        """按标签筛选边缘节点，返回 edge_id 列表"""
        nodes = self.db.list_edge_nodes(tenant_id=tenant_id, online_only=online_only)
        result = []
        for node in nodes:
            node_tags = set(node.tags or [])
            # AND 语义
            if include_tags and not set(include_tags).issubset(node_tags):
                continue
            # 排除
            if exclude_tags and node_tags.intersection(set(exclude_tags)):
                continue
            # OR 语义
            if any_tags and not node_tags.intersection(set(any_tags)):
                continue
            result.append(node.edge_id)
        return result

    def get_tag_stats(self, tenant_id: str) -> dict:
        """统计各标签的节点数量"""
        nodes = self.db.list_edge_nodes(tenant_id=tenant_id)
        stats: dict[str, int] = {}
        for node in nodes:
            for tag in (node.tags or []):
                stats[tag] = stats.get(tag, 0) + 1
        return stats

    @staticmethod
    def _validate_tag(tag: str) -> bool:
        """标签格式验证：key:value，key和value只含字母数字.-_"""
        import re
        return bool(re.match(r'^[a-zA-Z0-9_-]+:[a-zA-Z0-9_\u4e00-\u9fff.-]+$', tag))

    def _audit(self, edge_id: str, action: str, detail: dict):
        from .tenant_audit_log import log_audit
        log_audit(resource="edge_node", resource_id=edge_id,
                  action=action, detail=detail)
```

---

## 二、API

```python
# dragon-senate-saas-v2/api_edge_tags.py

@router.get("/edges/{edge_id}/tags")
async def get_edge_tags(edge_id: str, ctx=Depends(get_tenant_context)):
    return {"tags": tag_svc.get_tags(edge_id)}

@router.post("/edges/{edge_id}/tags")
async def add_edge_tags(edge_id: str, body: TagsBody, ctx=Depends(get_tenant_context)):
    tag_svc.add_tags(edge_id, body.tags, operator=ctx.user_id)
    return {"tags": tag_svc.get_tags(edge_id)}

@router.delete("/edges/{edge_id}/tags")
async def remove_edge_tags(edge_id: str, body: TagsBody, ctx=Depends(get_tenant_context)):
    tag_svc.remove_tags(edge_id, body.tags, operator=ctx.user_id)
    return {"tags": tag_svc.get_tags(edge_id)}

@router.put("/edges/{edge_id}/tags")
async def set_edge_tags(edge_id: str, body: TagsBody, ctx=Depends(get_tenant_context)):
    tag_svc.set_tags(edge_id, body.tags, operator=ctx.user_id)
    return {"tags": tag_svc.get_tags(edge_id)}

@router.post("/edges/query-by-tags")
async def query_edges_by_tags(body: TagQueryBody, ctx=Depends(get_tenant_context)):
    """按标签筛选边缘节点"""
    edge_ids = tag_svc.query_by_tags(
        tenant_id=ctx.tenant_id,
        include_tags=body.include_tags,
        exclude_tags=body.exclude_tags,
        any_tags=body.any_tags,
        online_only=body.online_only,
    )
    return {"edge_ids": edge_ids, "count": len(edge_ids)}

@router.get("/edges/tag-stats")
async def get_tag_stats(ctx=Depends(get_tenant_context)):
    """标签统计（各标签有多少节点）"""
    return {"stats": tag_svc.get_tag_stats(ctx.tenant_id)}

# 灰度部署按标签筛选（与 CODEX_TASK_EDGE_CANARY_DEPLOY 集成）
@router.post("/edges/deployments")
async def create_deployment_with_tags(body: CreateDeploymentBody, ctx=Depends(get_tenant_context)):
    if body.tag_filter:
        # 按标签筛选目标节点
        target_ids = tag_svc.query_by_tags(
            tenant_id=ctx.tenant_id,
            include_tags=body.tag_filter.include_tags,
            online_only=True,
        )
        body.target_edge_ids = target_ids
    dep = deploy_mgr.create_deployment(...)
    return {"deployment_id": dep.deployment_id}
```

---

## 三、前端标签组件

```typescript
// web/src/components/edge/EdgeTagManager.tsx
export function EdgeTagManager({ edgeId }: { edgeId: string }) {
  const { data, refetch } = useQuery({ queryFn: () => api.getEdgeTags(edgeId) });
  const [input, setInput] = useState("");

  const addTag = async () => {
    if (!input.includes(":")) return toast.error("标签格式：key:value");
    await api.addEdgeTags(edgeId, [input]);
    setInput(""); refetch();
  };

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {data?.tags.map(tag => (
        <Badge key={tag} variant="secondary" className="flex items-center gap-1">
          {tag}
          <X className="h-3 w-3 cursor-pointer" onClick={() => removeTag(tag)} />
        </Badge>
      ))}
      <div className="flex gap-1">
        <Input value={input} onChange={e => setInput(e.target.value)}
          placeholder="region:华北" className="h-6 w-32 text-xs"
          onKeyDown={e => e.key === "Enter" && addTag()} />
        <Button size="sm" variant="ghost" onClick={addTag}>+</Button>
      </div>
    </div>
  );
}

// web/src/components/edge/EdgeTagFilter.tsx — 按标签筛选节点列表
export function EdgeTagFilter({ onChange }: { onChange: (tags: string[]) => void }) {
  const { data: stats } = useQuery({ queryFn: api.getEdgeTagStats });
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (tag: string) => {
    const next = selected.includes(tag)
      ? selected.filter(t => t !== tag)
      : [...selected, tag];
    setSelected(next);
    onChange(next);
  };

  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(stats?.stats || {}).map(([tag, count]) => (
        <Badge key={tag} variant={selected.includes(tag) ? "default" : "outline"}
          className="cursor-pointer" onClick={() => toggle(tag)}>
          {tag} <span className="ml-1 text-xs opacity-60">{count}</span>
        </Badge>
      ))}
    </div>
  );
}
```

---

## 验收标准

**云端（dragon-senate-saas-v2/）：**
- [ ] `EdgeNodeTagService`：get/add/remove/set/query_by_tags/get_tag_stats
- [ ] `query_by_tags()`：支持 AND（include）/ OR（any）/ 排除（exclude）语义
- [ ] `_validate_tag()`：格式验证（key:value，支持中文 value）
- [ ] 标签变更写入审计日志
- [ ] API：GET/POST/DELETE/PUT /edges/{id}/tags
- [ ] API：POST /edges/query-by-tags（按标签筛选节点列表）
- [ ] API：GET /edges/tag-stats（标签统计）
- [ ] 灰度部署支持 tag_filter 参数（与 edge_deployment_manager 集成）

**前端：**
- [ ] `EdgeTagManager`：内联标签管理（展示/添加/删除）
- [ ] `EdgeTagFilter`：标签筛选器（多选，节点列表过滤）
- [ ] 边缘节点列表显示 tags 列（最多3个，超出显示 +N）

---

*Codex Task | 来源：MESHCENTRAL_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
