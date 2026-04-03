# CODEX TASK: 龙虾成本效益追踪器 lobster_economics.py

**来源借鉴**: ClawWork economic_tracker.py (33KB)  
**优先级**: 🔴 高  
**预计工时**: 2-3h  
**产出文件**: `dragon-senate-saas-v2/lobster_economics.py`

---

## 任务背景

ClawWork 为每个 Agent 实现了精密的经济追踪：token成本实时扣费、任务完成收入到账、余额盈亏可视化。

我们有 `saas_billing.py`（租户计费）和 `llm_call_logger.py`（LLM调用日志），但**缺少"每只龙虾的成本效益报告"**。现在完全不知道哪只龙虾最高效、哪只最贵、ROI 是多少。

---

## 目标

为10只龙虾建立独立的成本效益账本，整合现有的 llm_call_logger 数据，输出 ROI 报告，并在 Dashboard 新增绩效卡片。

---

## 实现规格

### 数据模型

```python
# lobster_economics.py

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import json
from pathlib import Path

# LLM Token 定价（USD per 1M tokens，按主流模型）
TOKEN_PRICES = {
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-haiku-4-5": {"input": 0.25, "output": 1.25},
    "qwen3-plus": {"input": 0.50, "output": 2.00},
    "glm-4": {"input": 0.10, "output": 0.10},
    "default": {"input": 1.00, "output": 3.00},
}

# 龙虾任务类型的参考市场价值（USD/task，参考 ClawWork GDPVal）
TASK_VALUE_REFERENCE = {
    "content_creation": 8.0,      # inkwriter：文案撰写
    "video_script": 15.0,         # inkwriter：视频脚本
    "data_analysis": 20.0,        # abacus：数据分析
    "strategy_planning": 35.0,    # strategist：策略规划
    "visual_design": 12.0,        # visualizer：视觉设计
    "market_research": 18.0,      # radar：市场调研
    "task_dispatch": 5.0,         # dispatcher：任务分发
    "customer_followup": 6.0,     # followup：客户跟进
    "content_capture": 8.0,       # catcher：内容捕获
    "report_writing": 14.0,       # echoer：报告撰写
    "default": 10.0,
}

@dataclass
class TokenCostRecord:
    """单次 LLM 调用的成本记录"""
    record_id: str
    lobster_id: str
    task_id: str
    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    timestamp: str

@dataclass  
class TaskValueRecord:
    """单次任务完成的价值记录"""
    record_id: str
    lobster_id: str
    task_id: str
    task_type: str
    quality_score: float        # 0-5，来自 llm_quality_judge
    base_value: float           # 该任务类型的参考价值
    actual_value: float         # 按质量分加权后的实际价值
    timestamp: str
```

### 核心类：LobsterEconomics

```python
class LobsterEconomics:
    """龙虾成本效益追踪器"""
    
    STORE_PATH = Path("dragon-senate-saas-v2/data/lobster_economics.jsonl")
    
    def __init__(self):
        self.STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    # ── 成本记录 ────────────────────────────────────
    
    def record_token_cost(
        self,
        lobster_id: str,
        task_id: str,
        model: str,
        tokens_in: int,
        tokens_out: int,
    ) -> TokenCostRecord:
        """
        记录一次 LLM 调用的 token 成本。
        在 llm_call_logger.py 的每次调用后自动触发。
        """
        price = TOKEN_PRICES.get(model, TOKEN_PRICES["default"])
        cost = (tokens_in / 1_000_000) * price["input"] + \
               (tokens_out / 1_000_000) * price["output"]
        
        record = TokenCostRecord(
            record_id=f"cost_{lobster_id}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            lobster_id=lobster_id,
            task_id=task_id,
            model=model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=round(cost, 6),
            timestamp=datetime.now().isoformat(),
        )
        self._append_record("cost", record.__dict__)
        return record
    
    # ── 价值记录 ────────────────────────────────────
    
    def record_task_completion(
        self,
        lobster_id: str,
        task_id: str,
        task_type: str,
        quality_score: float,       # 0-5
    ) -> TaskValueRecord:
        """
        记录任务完成的产出价值。
        quality_score 0-5 → 价值系数 0.0-1.2（超4分有奖励）
        """
        base_value = TASK_VALUE_REFERENCE.get(task_type, TASK_VALUE_REFERENCE["default"])
        
        # 质量-价值曲线（参考 ClawWork 的 quality threshold）
        if quality_score >= 4.5:
            multiplier = 1.2   # 优秀：20%溢价
        elif quality_score >= 4.0:
            multiplier = 1.0   # 良好：按基础价值
        elif quality_score >= 3.0:
            multiplier = 0.7   # 合格：70%
        elif quality_score >= 2.0:
            multiplier = 0.3   # 较差：30%
        else:
            multiplier = 0.0   # 不合格：不计价值
        
        actual_value = round(base_value * multiplier, 2)
        
        record = TaskValueRecord(
            record_id=f"value_{lobster_id}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            lobster_id=lobster_id,
            task_id=task_id,
            task_type=task_type,
            quality_score=quality_score,
            base_value=base_value,
            actual_value=actual_value,
            timestamp=datetime.now().isoformat(),
        )
        self._append_record("value", record.__dict__)
        return record
    
    # ── 查询与报告 ────────────────────────────────────
    
    def get_lobster_roi(
        self,
        lobster_id: str,
        period_days: int = 7,
    ) -> dict:
        """
        计算龙虾在过去 N 天的成本效益报告。
        
        返回：
        {
          "lobster_id": "inkwriter",
          "period_days": 7,
          "total_cost_usd": 3.42,
          "total_value_usd": 145.60,
          "roi_multiplier": 42.6,         # 价值/成本倍数
          "net_profit_usd": 142.18,
          "tasks_completed": 18,
          "tasks_zero_value": 2,          # 质量不达标的任务数
          "quality_avg": 4.1,
          "cost_per_task_usd": 0.19,
          "tokens_in_total": 1240000,
          "tokens_out_total": 380000,
          "most_expensive_model": "claude-sonnet-4-6",
        }
        """
        ...
    
    def get_all_lobsters_ranking(self, period_days: int = 7) -> list[dict]:
        """
        返回所有龙虾按 ROI 排序的排行榜。
        用于 Dashboard 的绩效排行榜视图。
        """
        rankings = []
        for lobster_id in ALL_LOBSTERS:
            roi = self.get_lobster_roi(lobster_id, period_days)
            rankings.append(roi)
        return sorted(rankings, key=lambda x: x["roi_multiplier"], reverse=True)
    
    def _append_record(self, record_type: str, data: dict):
        """追加记录到 JSONL 文件"""
        data["_type"] = record_type
        with open(self.STORE_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(data, ensure_ascii=False) + "\n")
```

### 集成到现有系统

**1. 集成到 llm_call_logger.py**

```python
# 在 llm_call_logger.py 的 log_call() 函数中增加
from dragon_senate_saas_v2.lobster_economics import LobsterEconomics

_economics = LobsterEconomics()

def log_call(lobster_id, task_id, model, tokens_in, tokens_out, ...):
    # 原有逻辑...
    
    # 新增：成本追踪
    _economics.record_token_cost(
        lobster_id=lobster_id,
        task_id=task_id,
        model=model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
    )
```

**2. 集成到 lobster_runner.py**

```python
# 任务完成后调用
from dragon_senate_saas_v2.lobster_economics import LobsterEconomics

_economics = LobsterEconomics()

def on_task_complete(lobster_id, task_id, task_type, quality_score):
    _economics.record_task_completion(
        lobster_id=lobster_id,
        task_id=task_id,
        task_type=task_type,
        quality_score=quality_score,
    )
```

**3. 新增 API 端点（app.py）**

```python
@app.get("/api/lobster-economics/ranking")
def get_lobster_ranking(period_days: int = 7):
    """返回龙虾绩效排行榜"""
    economics = LobsterEconomics()
    return economics.get_all_lobsters_ranking(period_days)

@app.get("/api/lobster-economics/{lobster_id}")
def get_lobster_roi(lobster_id: str, period_days: int = 7):
    """返回单只龙虾的 ROI 报告"""
    economics = LobsterEconomics()
    return economics.get_lobster_roi(lobster_id, period_days)
```

---

## Dashboard 绩效排行榜卡片（dragon_dashboard.html 新增）

在 dragon_dashboard.html 中增加"龙虾绩效"视图：

```html
<!-- 龙虾绩效排行榜 -->
<div class="lobster-ranking">
  <h2>🦞 龙虾绩效排行榜（本周）</h2>
  <table>
    <thead>
      <tr>
        <th>排名</th>
        <th>龙虾</th>
        <th>完成任务</th>
        <th>产出价值</th>
        <th>Token成本</th>
        <th>ROI</th>
        <th>平均质量</th>
      </tr>
    </thead>
    <tbody id="ranking-tbody">
      <!-- 通过 /api/lobster-economics/ranking 动态填充 -->
    </tbody>
  </table>
</div>
```

---

## 验收标准

- [ ] `record_token_cost` 自动从 llm_call_logger 触发
- [ ] `record_task_completion` 在 lobster_runner 任务结束时触发
- [ ] `get_lobster_roi` 正确计算过去7天的 ROI
- [ ] `get_all_lobsters_ranking` 返回10只龙虾的排行
- [ ] API 端点 `/api/lobster-economics/ranking` 可正常访问
- [ ] Dashboard 新增排行榜视图（可读取 API 数据）
- [ ] 单元测试覆盖 quality_score → value 转换逻辑
