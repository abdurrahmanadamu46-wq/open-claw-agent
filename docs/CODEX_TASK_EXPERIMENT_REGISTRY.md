# CODEX TASK: 龙虾实验注册表 + 多版本对比 UI（ExperimentRegistry）

**优先级：P1**  
**来源：OPIK_BORROWING_ANALYSIS.md P1-#1（Opik Experiment 框架）**

---

## 背景

龙虾目前是"点评估"——每次运行只知道当前版本的分数，无法回答"v2.3 的策略龙虾比 v2.2 好多少"。借鉴 Opik Experiment 框架，建立 ExperimentRegistry 存储每次 prompt/模型版本迭代的评估结果，配合前端多版本并排对比 UI，直接驱动龙虾进化决策。复用已有的 `dataset_store.py` + `llm_quality_judge.py`，无需重复建设评估基础设施。

---

## 一、后端：ExperimentRegistry

```python
# dragon-senate-saas-v2/experiment_registry.py

import time
import uuid
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum

class ExperimentStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

@dataclass
class ExperimentResult:
    """单条评估样本的结果"""
    dataset_item_id: str
    input: dict
    output: str
    scores: dict[str, float]  # {"task_completion": 0.87, "hallucination": 0.12}
    tokens_used: int = 0
    latency_ms: int = 0
    error: Optional[str] = None

@dataclass
class Experiment:
    """一次龙虾版本评估实验"""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""                        # e.g. "strategist-v2.3-gpt4o"
    lobster_name: str = ""                # "strategist" / "radar" / ...
    prompt_version: str = ""             # "v2.3"
    model: str = ""                      # "gpt-4o" / "gpt-3.5-turbo"
    dataset_id: str = ""                 # 使用的评估数据集 ID
    tenant_id: str = ""
    status: ExperimentStatus = ExperimentStatus.RUNNING
    config: dict = field(default_factory=dict)   # 任意额外配置

    # 汇总指标（计算完成后填充）
    avg_scores: dict[str, float] = field(default_factory=dict)
    total_items: int = 0
    completed_items: int = 0
    avg_latency_ms: float = 0.0
    avg_tokens: float = 0.0
    total_cost_usd: float = 0.0

    created_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None

    # 结果列表（详情）
    results: list[ExperimentResult] = field(default_factory=list)


class ExperimentRegistry:
    """
    龙虾实验注册表
    
    使用方式：
      # 创建实验
      exp = registry.create("strategist-v2.3", lobster_name="strategist",
                             prompt_version="v2.3", model="gpt-4o",
                             dataset_id="golden_set_001", tenant_id=tenant_id)
      
      # 运行评估
      for item in dataset.items:
          output = await strategist.run(item.input)
          scores = quality_judge.evaluate(item.input, output)
          registry.add_result(exp.id, ExperimentResult(...))
      
      # 完成实验（计算汇总）
      registry.complete(exp.id)
      
      # 查询：某龙虾的所有实验版本
      exps = registry.list_by_lobster("strategist", tenant_id=tenant_id)
    """

    def __init__(self, db):
        self.db = db  # 复用已有 DB（SQLAlchemy / SQLite）

    def create(
        self,
        name: str,
        lobster_name: str,
        prompt_version: str,
        model: str,
        dataset_id: str,
        tenant_id: str,
        config: dict = None,
    ) -> Experiment:
        exp = Experiment(
            name=name,
            lobster_name=lobster_name,
            prompt_version=prompt_version,
            model=model,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            config=config or {},
        )
        self.db.save_experiment(exp)
        return exp

    def add_result(self, experiment_id: str, result: ExperimentResult):
        """添加单条评估结果"""
        exp = self.db.get_experiment(experiment_id)
        exp.results.append(result)
        exp.completed_items += 1
        self.db.save_experiment(exp)

    def complete(self, experiment_id: str):
        """完成实验，计算汇总指标"""
        exp = self.db.get_experiment(experiment_id)
        results = [r for r in exp.results if r.error is None]

        if results:
            # 按 metric 聚合平均分
            all_metrics = set(k for r in results for k in r.scores.keys())
            exp.avg_scores = {
                m: round(sum(r.scores.get(m, 0) for r in results) / len(results), 3)
                for m in all_metrics
            }
            exp.avg_latency_ms = sum(r.latency_ms for r in results) / len(results)
            exp.avg_tokens = sum(r.tokens_used for r in results) / len(results)

        exp.status = ExperimentStatus.COMPLETED
        exp.completed_at = time.time()
        self.db.save_experiment(exp)

    def list_by_lobster(
        self,
        lobster_name: str,
        tenant_id: str,
        limit: int = 20,
    ) -> list[Experiment]:
        """列出某龙虾的所有实验（按时间倒序）"""
        return self.db.query_experiments(
            lobster_name=lobster_name,
            tenant_id=tenant_id,
            limit=limit,
        )

    def compare(
        self,
        exp_id_a: str,
        exp_id_b: str,
    ) -> dict:
        """对比两个实验的指标差异"""
        a = self.db.get_experiment(exp_id_a)
        b = self.db.get_experiment(exp_id_b)

        metrics = set(list(a.avg_scores.keys()) + list(b.avg_scores.keys()))
        comparison = {}
        for m in metrics:
            score_a = a.avg_scores.get(m, 0)
            score_b = b.avg_scores.get(m, 0)
            comparison[m] = {
                "a": score_a,
                "b": score_b,
                "delta": round(score_b - score_a, 3),
                "winner": "b" if score_b > score_a else "a" if score_a > score_b else "tie",
            }
        return {
            "experiment_a": {"id": a.id, "name": a.name, "prompt_version": a.prompt_version},
            "experiment_b": {"id": b.id, "name": b.name, "prompt_version": b.prompt_version},
            "metrics": comparison,
            "latency_delta_ms": round(b.avg_latency_ms - a.avg_latency_ms, 1),
            "tokens_delta": round(b.avg_tokens - a.avg_tokens, 0),
        }
```

---

## 二、API

```python
# dragon-senate-saas-v2/api_experiments.py

from fastapi import APIRouter, Depends
from .experiment_registry import ExperimentRegistry, Experiment

router = APIRouter(prefix="/api/v1/experiments")

@router.post("/")
async def create_experiment(body: CreateExperimentBody, ctx=Depends(get_tenant_context)):
    """创建实验（手动触发 or 自动触发）"""
    exp = registry.create(
        name=body.name,
        lobster_name=body.lobster_name,
        prompt_version=body.prompt_version,
        model=body.model,
        dataset_id=body.dataset_id,
        tenant_id=ctx.tenant_id,
        config=body.config,
    )
    # 后台异步运行评估
    background_tasks.add_task(run_experiment_evaluation, exp.id)
    return {"experiment_id": exp.id, "status": "running"}

@router.get("/")
async def list_experiments(
    lobster_name: str = None,
    ctx=Depends(get_tenant_context),
):
    """列出实验（按龙虾过滤）"""
    exps = registry.list_by_lobster(
        lobster_name=lobster_name,
        tenant_id=ctx.tenant_id,
    )
    return {"experiments": [_serialize(e) for e in exps]}

@router.get("/{experiment_id}")
async def get_experiment(experiment_id: str, ctx=Depends(get_tenant_context)):
    """获取实验详情（含逐条结果）"""
    exp = registry.db.get_experiment(experiment_id)
    return _serialize_detail(exp)

@router.get("/compare")
async def compare_experiments(
    a: str,   # experiment_id A
    b: str,   # experiment_id B
    ctx=Depends(get_tenant_context),
):
    """对比两个实验"""
    return registry.compare(a, b)
```

---

## 三、前端：实验列表 + 对比 UI

```typescript
// web/src/app/experiments/page.tsx — 实验列表页

export function ExperimentsPage() {
  const [lobsterFilter, setLobsterFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data } = useQuery({
    queryKey: ["experiments", lobsterFilter],
    queryFn: () => api.listExperiments({ lobster_name: lobsterFilter !== "all" ? lobsterFilter : undefined }),
  });

  const canCompare = selectedIds.length === 2;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">龙虾实验</h1>
        <div className="flex gap-2">
          {canCompare && (
            <Button size="sm" onClick={() => navigate(`/experiments/compare?a=${selectedIds[0]}&b=${selectedIds[1]}`)}>
              对比选中 (2)
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            新建实验
          </Button>
        </div>
      </div>

      {/* 龙虾筛选 */}
      <Select value={lobsterFilter} onValueChange={setLobsterFilter}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部龙虾</SelectItem>
          {LOBSTER_NAMES.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* 实验表格 */}
      <DataTable
        data={data?.experiments || []}
        columns={[
          { header: "", cell: (row) => (
            <Checkbox checked={selectedIds.includes(row.id)}
              onCheckedChange={(v) => toggleSelect(row.id, !!v)}
              disabled={!selectedIds.includes(row.id) && selectedIds.length >= 2} />
          )},
          { header: "实验名称", cell: (row) => (
            <Link href={`/experiments/${row.id}`} className="font-medium hover:underline">
              {row.name}
            </Link>
          )},
          { header: "龙虾", accessor: "lobster_name" },
          { header: "Prompt", accessor: "prompt_version" },
          { header: "模型", accessor: "model" },
          { header: "完成率", cell: (row) => (
            <span className="font-mono">{((row.avg_scores?.task_completion || 0) * 100).toFixed(1)}%</span>
          )},
          { header: "幻觉率", cell: (row) => (
            <span className={cn("font-mono", (row.avg_scores?.hallucination || 0) > 0.3 && "text-red-500")}>
              {((row.avg_scores?.hallucination || 0) * 100).toFixed(1)}%
            </span>
          )},
          { header: "延迟", cell: (row) => <span className="font-mono">{row.avg_latency_ms}ms</span> },
          { header: "状态", cell: (row) => <ExperimentStatusBadge status={row.status} /> },
          { header: "时间", cell: (row) => formatRelativeTime(row.created_at) },
        ]}
      />
    </div>
  );
}

// web/src/app/experiments/compare/page.tsx — 对比页
export function ExperimentComparePage() {
  const { a, b } = useSearchParams();
  const { data } = useQuery({
    queryKey: ["experiment-compare", a, b],
    queryFn: () => api.compareExperiments(a!, b!),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">实验对比</h1>

      {/* 基本信息 */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="font-medium">{data?.experiment_a.name}</div>
          <div className="text-sm text-muted-foreground">{data?.experiment_a.prompt_version}</div>
        </Card>
        <Card className="p-4">
          <div className="font-medium">{data?.experiment_b.name}</div>
          <div className="text-sm text-muted-foreground">{data?.experiment_b.prompt_version}</div>
        </Card>
      </div>

      {/* 指标对比表 */}
      <Card className="p-4">
        <h2 className="font-medium mb-3">指标对比</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>指标</th><th>版本A</th><th>版本B</th><th>差异</th><th>优胜</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data?.metrics || {}).map(([metric, v]: any) => (
              <tr key={metric} className="border-t">
                <td className="py-2 font-mono text-xs">{metric}</td>
                <td className="font-mono">{(v.a * 100).toFixed(1)}%</td>
                <td className="font-mono">{(v.b * 100).toFixed(1)}%</td>
                <td className={cn("font-mono", v.delta > 0 ? "text-green-600" : v.delta < 0 ? "text-red-500" : "")}>
                  {v.delta > 0 ? "+" : ""}{(v.delta * 100).toFixed(1)}%
                </td>
                <td>
                  {v.winner === "b" ? <Badge variant="default">B 更好</Badge> :
                   v.winner === "a" ? <Badge variant="secondary">A 更好</Badge> :
                   <Badge variant="outline">持平</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

---

## 验收标准

**后端（dragon-senate-saas-v2/experiment_registry.py）：**
- [ ] `Experiment` 数据模型：id/name/lobster/prompt_version/model/dataset/status/avg_scores
- [ ] `ExperimentRegistry.create()`：创建实验记录
- [ ] `add_result()`：追加逐条评估结果
- [ ] `complete()`：计算汇总指标（avg_scores/latency/tokens）
- [ ] `list_by_lobster()`：按龙虾过滤，时间倒序
- [ ] `compare(a, b)`：输出 metrics delta + winner 判断

**API（api_experiments.py）：**
- [ ] `POST /experiments`：创建实验 + 后台异步运行评估
- [ ] `GET /experiments`：列出实验（?lobster_name 过滤）
- [ ] `GET /experiments/{id}`：实验详情（含逐条结果）
- [ ] `GET /experiments/compare?a=&b=`：两实验对比

**前端（web/src/app/experiments/）：**
- [ ] 实验列表页：表格（name/lobster/版本/模型/完成率/幻觉率/延迟/状态/时间）
- [ ] 龙虾筛选下拉
- [ ] 多选 Checkbox + 对比按钮（选中2个时激活）
- [ ] 对比页：左右两栏基本信息 + 指标对比表（含 delta/winner）
- [ ] 状态 Badge：running（蓝）/ completed（绿）/ failed（红）

**集成：**
- [ ] 与 `dataset_store.py` 集成（读取评估数据集）
- [ ] 与 `llm_quality_judge.py` 集成（评分计算）

---

*Codex Task | 来源：OPIK_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
