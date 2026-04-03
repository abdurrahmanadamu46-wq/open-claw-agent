# CODEX TASK: OPA 借鉴 P2 合并任务包

**优先级：P2**  
**来源：OPA_BORROWING_ANALYSIS.md P2-1 ～ P2-4**  
**借鉴自**：https://github.com/open-policy-agent/opa（⭐11.5k）`ast/` + `plugins/` + `topdown/trace.go`

---

## P2-1: 策略可视化编辑器（前端）

**借鉴自**：OPA Playground — 在线编写/测试/调试 Rego 策略  
**落地路径**：前端 `/settings/policies`

### 功能说明

OPA Playground 允许用户：在线编写策略 → 输入测试数据 → 实时看评估结果。  
我们落地：**龙虾规则可视化配置**，运营人员无需改代码就能调整派发规则。

**页面布局**（借鉴 OPA Playground 三栏布局）：
```
┌──────────────────────────────────────────────────────────┐
│ 规则列表（左）   │  规则编辑器（中）  │  测试输入/结果（右）│
│ ○ DISPATCH-001  │  条件：             │  输入：             │
│ ○ DISPATCH-002  │  lead.score >= 80   │  {"lead":{"score":85}} │
│ ○ COMPLIANCE-01 │  效果：dispatch     │  ↓ 评估              │
│ + 新建规则      │  目标：followup     │  ✅ followup         │
└──────────────────────────────────────────────────────────┘
```

**规则编辑器字段**：
- 规则名称（必填）
- 策略路径（dispatch/compliance/rate_limit/allow）
- 条件列表（字段+操作符+值，支持拖拽排序）
- 效果（allow/deny/dispatch）+ 目标（dispatch 时显示）
- 优先级（数字，越小越优先）
- 适用范围（全局/仅当前租户）
- 启用/禁用开关

**测试面板**：
- 输入测试线索 JSON
- 点击"评估"调用 `POST /api/v1/policies/evaluate`
- 显示：命中规则 + 决策结果 + 匹配原因 + 耗时

### 验收标准
- [ ] 规则列表页（支持按 policy_path 过滤）
- [ ] 规则编辑器（条件动态增减）
- [ ] 测试面板（实时评估，结果高亮显示）
- [ ] 规则创建/修改后自动发布新 bundle
- [ ] 操作需要 Admin 权限（RBAC 控制）

---

## P2-2: 策略版本管理（PolicyVersionStore）

**借鉴自**：OPA `bundle/` — bundle 包含版本号、签名、变更记录  
**落地路径**：`dragon-senate-saas-v2/policy_version_store.py`

### 功能说明

OPA bundle 支持版本化，可以回滚到旧版本。  
我们落地：**规则集版本管理**，误改规则时一键回滚。

```python
# dragon-senate-saas-v2/policy_version_store.py
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import json
import hashlib

@dataclass
class PolicyVersion:
    """规则集版本快照"""
    version_id: str
    version_tag: str            # 如 "v1.2.3"
    rules_snapshot: list[dict]  # 完整规则列表快照
    checksum: str               # 快照 SHA256
    created_by: str             # 操作人
    change_summary: str         # 变更说明
    is_active: bool = False     # 是否为当前生效版本
    created_at: datetime = field(default_factory=datetime.utcnow)

class PolicyVersionStore:
    """策略版本管理（借鉴 OPA bundle 版本化）"""

    async def snapshot(
        self,
        rules: list[dict],
        version_tag: str,
        created_by: str,
        change_summary: str
    ) -> PolicyVersion:
        """创建规则集快照"""
        content = json.dumps(rules, sort_keys=True).encode()
        checksum = hashlib.sha256(content).hexdigest()[:16]
        ver = PolicyVersion(
            version_id=f"PV-{checksum}",
            version_tag=version_tag,
            rules_snapshot=rules,
            checksum=checksum,
            created_by=created_by,
            change_summary=change_summary,
        )
        # 存入 DB...
        return ver

    async def rollback(self, version_id: str) -> list[dict]:
        """回滚到指定版本"""
        # 从 DB 查询 version_id 的 rules_snapshot
        # 设置为 is_active=True，其余版本 is_active=False
        # 触发 PolicyBundleManager 重新发布
        pass

    async def list_versions(self, limit: int = 20) -> list[PolicyVersion]:
        """获取版本历史列表"""
        pass
```

**API**：
```
GET  /api/v1/policies/versions          # 版本历史列表
GET  /api/v1/policies/versions/{id}     # 单个版本详情
POST /api/v1/policies/versions/{id}/activate  # 激活（回滚）
```

**前端版本页**：
- 版本时间线（类似 Git 历史）
- 两个版本之间的 diff 对比（新增/删除/修改的规则）
- 一键回滚按钮（需要 Admin 确认）

### 验收标准
- [ ] `PolicyVersionStore.snapshot()` 创建版本快照
- [ ] `rollback()` 一键回滚并触发 bundle 重新发布
- [ ] 前端版本历史页（时间线 + diff 对比）
- [ ] 回滚前需要二次确认弹窗

---

## P2-3: 规则冲突检测（PolicyConflictDetector）

**借鉴自**：OPA `ast/conflicts.go` — 检测策略逻辑冲突  
**落地路径**：`dragon-senate-saas-v2/policy_conflict_detector.py`

### 功能说明

OPA 在编译阶段检测策略中的逻辑冲突（两条规则互相矛盾）。  
我们落地：**规则冲突静态检测**，保存规则前自动扫描冲突。

```python
# dragon-senate-saas-v2/policy_conflict_detector.py
from dataclasses import dataclass
from typing import Optional

@dataclass
class ConflictReport:
    """冲突报告"""
    conflict_type: str      # "overlap" | "contradiction" | "shadow"
    rule_id_a: str
    rule_id_b: str
    description: str
    severity: str           # "error" | "warning"

class PolicyConflictDetector:
    """
    规则冲突检测器（借鉴 OPA ast/conflicts.go）

    检测类型：
    1. 重叠冲突（overlap）：两条规则的触发条件有重叠，且效果不同
    2. 矛盾冲突（contradiction）：两条规则条件相同但效果相反
    3. 遮蔽冲突（shadow）：低优先级规则永远无法被触发（被高优先级完全覆盖）
    """

    def detect(self, rules: list) -> list[ConflictReport]:
        """检测所有规则间的冲突"""
        reports = []
        for i, rule_a in enumerate(rules):
            for rule_b in rules[i+1:]:
                if rule_a.policy_path != rule_b.policy_path:
                    continue
                conflict = self._check_pair(rule_a, rule_b)
                if conflict:
                    reports.append(conflict)
        return reports

    def _check_pair(self, a, b) -> Optional[ConflictReport]:
        """检测两条规则之间的冲突"""
        # 简化版：检测条件完全相同但效果不同（矛盾）
        conds_a = frozenset(
            (c["field"], c["op"], str(c["value"]))
            for c in a.conditions
        )
        conds_b = frozenset(
            (c["field"], c["op"], str(c["value"]))
            for c in b.conditions
        )

        if conds_a == conds_b and a.effect != b.effect:
            return ConflictReport(
                conflict_type="contradiction",
                rule_id_a=a.rule_id,
                rule_id_b=b.rule_id,
                description=f"规则 {a.rule_id} 和 {b.rule_id} 条件完全相同但效果相反（{a.effect} vs {b.effect}）",
                severity="error",
            )

        # 遮蔽检测：a 的优先级更高 且 条件是 b 的超集（b 永远不会被触发）
        if a.priority < b.priority and conds_b.issubset(conds_a) and conds_a != conds_b:
            return ConflictReport(
                conflict_type="shadow",
                rule_id_a=a.rule_id,
                rule_id_b=b.rule_id,
                description=f"规则 {b.rule_id} 可能永远不会被触发（被 {a.rule_id} 遮蔽）",
                severity="warning",
            )
        return None
```

**集成点**：
- `POST /api/v1/policies`（创建规则前自动检测）
- `PUT /api/v1/policies/{id}`（修改规则后重新检测）
- 发现 `error` 级冲突时**阻止保存**，`warning` 级冲突提示确认

### 验收标准
- [ ] 检测矛盾冲突（error 级，阻止保存）
- [ ] 检测遮蔽冲突（warning 级，提示确认）
- [ ] 规则保存前自动触发检测
- [ ] 前端冲突展示（标红 + 原因说明）

---

## P2-4: 策略评估追踪（PolicyTrace）

**借鉴自**：OPA `topdown/trace.go` — 策略评估全链路追踪，每步可见  
**落地路径**：`dragon-senate-saas-v2/policy_trace.py`

### 功能说明

OPA 的 trace 模式把评估过程每一步都展示出来（Enter/Exit/Fail/Redo 事件）。  
我们落地：**策略评估逐步追踪**，便于调试"为什么这条规则没有触发"。

```python
# dragon-senate-saas-v2/policy_trace.py
from dataclasses import dataclass, field
from typing import Any

@dataclass
class TraceEvent:
    """单步追踪事件（借鉴 OPA trace 事件模型）"""
    step: int
    event_type: str     # "enter_rule" | "eval_condition" | "condition_pass" | "condition_fail" | "rule_match" | "rule_skip"
    rule_id: str
    condition: dict = field(default_factory=dict)
    field_value: Any = None
    message: str = ""

class PolicyTrace:
    """策略评估追踪器（debug 模式使用）"""

    def __init__(self):
        self._events: list[TraceEvent] = []
        self._step = 0

    def record(self, event_type: str, rule_id: str, condition: dict = None, field_value: Any = None, message: str = ""):
        self._step += 1
        self._events.append(TraceEvent(
            step=self._step,
            event_type=event_type,
            rule_id=rule_id,
            condition=condition or {},
            field_value=field_value,
            message=message,
        ))

    def to_readable(self) -> list[str]:
        """生成可读的追踪报告"""
        lines = []
        for e in self._events:
            if e.event_type == "enter_rule":
                lines.append(f"Step {e.step}: 开始评估规则 [{e.rule_id}] {e.message}")
            elif e.event_type == "eval_condition":
                c = e.condition
                lines.append(f"  Step {e.step}: 检查条件 {c.get('field')}({e.field_value}) {c.get('op')} {c.get('value')}")
            elif e.event_type == "condition_pass":
                lines.append(f"    ✅ 条件通过")
            elif e.event_type == "condition_fail":
                lines.append(f"    ❌ 条件不满足 → 规则跳过")
            elif e.event_type == "rule_match":
                lines.append(f"  ✅ 规则命中！决策：{e.message}")
            elif e.event_type == "rule_skip":
                lines.append(f"  ⏭ 规则跳过")
        return lines
```

**使用方式**（debug 模式评估）：
```
POST /api/v1/policies/evaluate?trace=true
body: {"policy_path": "dispatch", "input": {"lead": {"score": 75}}}

响应：
{
  "decision": "echoer",
  "rule_id": "DISPATCH-002",
  "trace": [
    "Step 1: 开始评估规则 [DISPATCH-001] 高意向线索派发到跟进虾",
    "  Step 2: 检查条件 lead.score(75) gte 80",
    "    ❌ 条件不满足 → 规则跳过",
    "Step 3: 开始评估规则 [DISPATCH-002] 中意向线索派发到回声虾",
    "  Step 4: 检查条件 lead.score(75) gte 60",
    "    ✅ 条件通过",
    "  Step 5: 检查条件 lead.score(75) lt 80",
    "    ✅ 条件通过",
    "  ✅ 规则命中！决策：echoer"
  ]
}
```

### 验收标准
- [ ] `PolicyTrace` 记录每条规则的每个条件评估过程
- [ ] `to_readable()` 生成人类可读的追踪报告
- [ ] `?trace=true` 参数触发 trace 模式
- [ ] 前端测试面板展示追踪步骤（可折叠）

---

*Codex Task | 来源：OPA_BORROWING_ANALYSIS.md P2-1~P2-4 合并 | 2026-04-02*
