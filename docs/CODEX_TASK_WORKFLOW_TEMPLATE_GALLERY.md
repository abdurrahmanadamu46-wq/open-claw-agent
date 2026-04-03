# CODEX TASK: 工作流模板市场（官方预设版）

**优先级：P1**  
**来源：N8N_BORROWING_ANALYSIS.md P1-#4（n8n Template Gallery）**

---

## 背景

新用户不知道怎么配工作流，是 SaaS 最大的上手门槛。n8n Template Gallery 提供 1800+ 工作流模板，一键导入即可使用。我们实现**官方预设版**：20个精品模板，工作流列表页顶部"从模板创建"入口，一键复制为自己的工作流。

---

## 一、WorkflowTemplate 数据模型

```python
# dragon-senate-saas-v2/workflow_template.py

from dataclasses import dataclass, field
from typing import Optional, List

@dataclass
class WorkflowTemplate:
    template_id: str
    name: str                    # "电商产品文案生成（14步）"
    description: str             # 简短描述
    category: str                # "电商" | "内容营销" | "社交媒体" | "客服" | "数据分析"
    use_case: str                # "抖音爆款带货文案生成"
    thumbnail_url: Optional[str] = None  # 预览缩略图
    lobsters_required: List[str] = field(default_factory=list)  # 需要哪些龙虾
    estimated_duration_seconds: int = 60  # 预计执行时长
    estimated_tokens: int = 2000         # 预计消耗 Token
    difficulty: str = "beginner"         # "beginner" | "intermediate" | "advanced"
    tags: List[str] = field(default_factory=list)
    is_featured: bool = False
    use_count: int = 0           # 使用次数（展示用）
    # 工作流定义（YAML 字符串或 dict）
    workflow_yaml: str = ""
    created_by: str = "official"  # "official" | 用户ID（未来支持用户分享）
```

---

## 二、官方预设 20 个模板

```python
# dragon-senate-saas-v2/official_templates.py

OFFICIAL_TEMPLATES = [
    # ── 电商类 ──────────────────────────────────
    {
        "template_id": "tpl_ecom_product_copy",
        "name": "电商产品文案生成",
        "description": "输入产品名称和卖点，自动生成适合各平台的产品详情文案",
        "category": "电商",
        "use_case": "淘宝/京东/拼多多产品详情页文案",
        "lobsters_required": ["strategist", "inkwriter", "visualizer"],
        "estimated_tokens": 3500,
        "difficulty": "beginner",
        "tags": ["电商", "文案", "产品"],
        "is_featured": True,
    },
    {
        "template_id": "tpl_ecom_review_reply",
        "name": "差评自动回复",
        "description": "分析客户差评情绪，生成专业、有温度的回复话术",
        "category": "客服",
        "lobsters_required": ["radar", "inkwriter"],
        "estimated_tokens": 800,
        "difficulty": "beginner",
        "tags": ["客服", "差评", "回复"],
    },
    # ── 社交媒体类 ────────────────────────────────
    {
        "template_id": "tpl_social_douyin_script",
        "name": "抖音爆款短视频脚本",
        "description": "分析热门话题，生成适合当前流量的短视频脚本（含开头钩子/主体/结尾CTA）",
        "category": "社交媒体",
        "lobsters_required": ["radar", "strategist", "inkwriter"],
        "estimated_tokens": 2000,
        "difficulty": "intermediate",
        "tags": ["抖音", "短视频", "脚本"],
        "is_featured": True,
    },
    {
        "template_id": "tpl_social_xiaohongshu",
        "name": "小红书种草笔记",
        "description": "生成符合小红书平台调性的种草笔记（含标题、正文、话题标签）",
        "category": "社交媒体",
        "lobsters_required": ["strategist", "inkwriter"],
        "estimated_tokens": 1200,
        "difficulty": "beginner",
        "tags": ["小红书", "种草", "笔记"],
    },
    {
        "template_id": "tpl_social_weixin_article",
        "name": "微信公众号文章",
        "description": "生成完整的公众号文章（标题、导语、正文、结尾引导）",
        "category": "内容营销",
        "lobsters_required": ["strategist", "inkwriter"],
        "estimated_tokens": 4000,
        "difficulty": "intermediate",
        "tags": ["公众号", "文章", "内容"],
    },
    # ── 竞品/市场分析类 ────────────────────────────
    {
        "template_id": "tpl_market_competitor",
        "name": "竞品分析报告",
        "description": "分析指定竞品的优缺点，生成结构化竞品分析报告",
        "category": "数据分析",
        "lobsters_required": ["radar", "strategist", "abacus"],
        "estimated_tokens": 5000,
        "difficulty": "advanced",
        "tags": ["竞品", "市场", "分析"],
    },
    # ── 客服类 ────────────────────────────────────
    {
        "template_id": "tpl_cs_welcome",
        "name": "新用户欢迎语",
        "description": "根据用户画像生成个性化欢迎语和产品推荐",
        "category": "客服",
        "lobsters_required": ["strategist", "inkwriter", "followup"],
        "estimated_tokens": 600,
        "difficulty": "beginner",
        "tags": ["客服", "欢迎", "新用户"],
    },
    # ... 更多模板（共20个）
]
```

---

## 三、后端模板 API

```python
# dragon-senate-saas-v2/api_workflow_templates.py

@router.get("/workflow-templates")
async def list_templates(
    category: Optional[str] = None,
    difficulty: Optional[str] = None,
    featured_only: bool = False,
    search: Optional[str] = None,
):
    """获取工作流模板列表"""
    templates = OFFICIAL_TEMPLATES.copy()
    if category:
        templates = [t for t in templates if t["category"] == category]
    if difficulty:
        templates = [t for t in templates if t["difficulty"] == difficulty]
    if featured_only:
        templates = [t for t in templates if t.get("is_featured")]
    if search:
        templates = [t for t in templates 
                     if search.lower() in t["name"].lower() or 
                        search.lower() in t["description"].lower()]
    return {"templates": templates, "total": len(templates)}

@router.post("/workflow-templates/{template_id}/use")
async def create_workflow_from_template(
    template_id: str,
    body: CreateFromTemplateBody,
    tenant_context: TenantContext = Depends(get_tenant_context),
):
    """从模板创建工作流（深拷贝，与模板解耦）"""
    template = next((t for t in OFFICIAL_TEMPLATES if t["template_id"] == template_id), None)
    if not template:
        raise HTTPException(404, "模板不存在")
    
    # 从 YAML 模板生成工作流
    workflow_data = {
        "name": body.name or template["name"],
        "description": template["description"],
        "tenant_id": tenant_context.tenant_id,
        "source_template_id": template_id,
        "steps": parse_workflow_yaml(template["workflow_yaml"]),
        "status": "draft",
    }
    new_workflow = Workflow(**workflow_data)
    db.add(new_workflow)
    db.commit()
    
    # 更新模板使用次数
    # template["use_count"] += 1  # 实际用 Redis 计数
    
    return {"workflow_id": new_workflow.id, "message": "工作流已从模板创建"}
```

---

## 四、前端模板画廊 UI

```typescript
// web/src/app/workflows/templates/page.tsx
// 模板画廊页面（工作流列表页"从模板创建"按钮跳转）

export default function WorkflowTemplatesPage() {
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const { data } = useQuery({ queryFn: () => api.get('/v1/workflow-templates', { params: { category, search } }) });

  const CATEGORIES = ['全部', '电商', '社交媒体', '内容营销', '客服', '数据分析'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">工作流模板</h1>
        <p className="text-muted-foreground">从精品模板开始，一键复制到你的账户</p>
      </div>

      {/* 搜索 + 分类过滤 */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="搜索模板..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <div className="flex gap-1">
          {CATEGORIES.map(cat => (
            <Button
              key={cat}
              variant={category === (cat === '全部' ? 'all' : cat) ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCategory(cat === '全部' ? 'all' : cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* 精选模板（大卡片）*/}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">⭐ 精选推荐</h2>
        <div className="grid grid-cols-3 gap-4">
          {data?.templates.filter(t => t.is_featured).map(template => (
            <TemplateCard key={template.template_id} template={template} featured />
          ))}
        </div>
      </div>

      {/* 全部模板 */}
      <div className="grid grid-cols-4 gap-3">
        {data?.templates.map(template => (
          <TemplateCard key={template.template_id} template={template} />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({ template, featured = false }) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleUseTemplate = async () => {
    setIsCreating(true);
    const res = await api.post(`/v1/workflow-templates/${template.template_id}/use`, {
      name: template.name,
    });
    router.push(`/workflows/${res.data.workflow_id}/edit`);
  };

  const DIFFICULTY_LABEL = { beginner: '简单', intermediate: '中级', advanced: '高级' };
  const DIFFICULTY_COLOR = { beginner: 'text-green-600', intermediate: 'text-orange-500', advanced: 'text-red-600' };

  return (
    <Card className={cn("hover:shadow-md transition-shadow cursor-pointer group", featured && "col-span-1")}>
      <CardContent className="p-4 space-y-3">
        {/* 分类 Badge + 难度 */}
        <div className="flex items-center justify-between">
          <Badge variant="secondary">{template.category}</Badge>
          <span className={cn("text-xs", DIFFICULTY_COLOR[template.difficulty])}>
            {DIFFICULTY_LABEL[template.difficulty]}
          </span>
        </div>

        {/* 模板名称 */}
        <div>
          <h3 className="font-semibold text-sm leading-tight">{template.name}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{template.description}</p>
        </div>

        {/* 龙虾参与 */}
        <div className="flex items-center gap-1">
          {template.lobsters_required.map(l => (
            <span key={l} className="text-xs px-1.5 py-0.5 rounded bg-muted font-mono">{l}</span>
          ))}
        </div>

        {/* 指标 + 使用按钮 */}
        <div className="flex items-center justify-between pt-1">
          <div className="text-xs text-muted-foreground">
            ~{Math.round(template.estimated_tokens / 1000)}k tokens · {template.use_count} 次使用
          </div>
          <Button
            size="sm"
            className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleUseTemplate}
            disabled={isCreating}
          >
            {isCreating ? '创建中...' : '使用模板'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## 五、工作流列表页接入入口

```typescript
// web/src/app/workflows/page.tsx — 顶部添加"从模板创建"入口

<div className="flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-bold">工作流</h1>
  </div>
  <div className="flex gap-2">
    <Button variant="outline" onClick={() => router.push('/workflows/templates')}>
      📋 从模板创建
    </Button>
    <Button onClick={() => router.push('/workflows/new')}>
      + 新建工作流
    </Button>
  </div>
</div>
```

---

## 验收标准

- [ ] `WorkflowTemplate` 数据模型（Python dataclass）
- [ ] 20 个官方预设模板（含完整 workflow_yaml / 分类 / 难度 / 龙虾列表 / 预计 Token）
- [ ] `GET /v1/workflow-templates`（支持 category / difficulty / featured_only / search 过滤）
- [ ] `POST /v1/workflow-templates/{template_id}/use`（从模板深拷贝创建工作流）
- [ ] 创建后记录 `source_template_id`（来源追踪）
- [ ] 前端模板画廊页（`/workflows/templates`）
- [ ] 精选模板大卡片区 + 全部模板网格区
- [ ] `TemplateCard`：悬浮显示"使用模板"按钮 + 龙虾参与列表 + Token/使用次数
- [ ] 工作流列表页"从模板创建"入口按钮
- [ ] 从模板创建后，自动跳转到工作流编辑页（草稿状态）
- [ ] 精选至少包含：电商产品文案 / 抖音脚本 / 差评回复 3 个 is_featured 模板

---

*Codex Task | 来源：N8N_BORROWING_ANALYSIS.md P1-#4 | 2026-04-02*
