# CODEX TASK: OPA 声明式策略引擎 + 决策日志 + 边缘合规守卫

**优先级：P1**  
**来源：OPA_BORROWING_ANALYSIS.md P1-1 + P1-2 + P1-3 + P1-4**  
**借鉴自**：https://github.com/open-policy-agent/opa（⭐11.5k）`topdown/` + `plugins/logs/` + `plugins/bundle/`

---

## 背景

当前问题：龙虾的派发规则/合规规则/权限规则**硬编码在 Python 文件里**。

```python
# 现在 dispatcher.py 里这样写（问题）：
if lead.score > 80 and lead.source == "feishu":
    dispatch_to_followup()
elif lead.score > 60:
    dispatch_to_echoer()
# 改规则 = 改代码 = 重新部署 = 所有客户停机
```

OPA 的核心思想：**策略（Policy）与代码分离**。  
规则存在数据库/文件里，热更新，零停机，完整溯源。

---

## A. 声明式策略引擎（PolicyEngine）

### `dragon-senate-saas-v2/policy_engine.py`

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Optional
import json
import re
import time


@dataclass
class PolicyRule:
    """单条策略规则（JSON 存储，内存评估）"""
    rule_id: str
    name: str
    # 条件列表（AND 关系）
    conditions: list[dict]  # [{"field": "lead.score", "op": "gte", "value": 80}]
    # 结论
    effect: str             # "allow" | "deny" | "dispatch"
    target: Optional[str] = None    # effect=dispatch 时的目标（如 "followup"）
    priority: int = 100             # 数字越小优先级越高
    tenant_id: Optional[str] = None # None=全局规则，非None=租户私有规则
    enabled: bool = True
    description: str = ""


class PolicyEngine:
    """
    声明式策略评估引擎
    借鉴 OPA topdown/ 的策略评估架构（Python 原生实现，无需 Go 依赖）

    核心流程：
      input（线索/请求数据）+ rules（从DB加载）→ decision（allow/deny/dispatch）
    """

    def __init__(self):
        self._rules: list[PolicyRule] = []
        self._cache_ts: float = 0
        self._cache_ttl: float = 30.0  # 30秒热更新间隔

    def load_rules(self, rules: list[PolicyRule]):
        """加载/热更新规则（无需重启）"""
        self._rules = sorted(rules, key=lambda r: r.priority)
        self._cache_ts = time.time()

    def evaluate(
        self,
        input_data: dict,
        policy_path: str = "dispatch",
        tenant_id: Optional[str] = None
    ) -> dict:
        """
        评估策略，返回决策结果

        Args:
            input_data: 输入数据（线索/请求）
            policy_path: 策略路径（"dispatch" | "allow" | "rate_limit"）
            tenant_id: 租户 ID（用于过滤租户私有规则）

        Returns:
            {
                "decision": "followup" | "allow" | "deny",
                "rule_id": "RULE-001",
                "reason": "lead.score >= 80",
                "matched_rules": [...],
                "evaluation_ms": 0.5
            }
        """
        start = time.perf_counter()

        # 过滤适用规则（全局规则 + 该租户私有规则）
        applicable = [
            r for r in self._rules
            if r.enabled
            and (r.tenant_id is None or r.tenant_id == tenant_id)
        ]

        matched_rules = []
        decision = None
        reason = "no matching rule"
        matched_rule_id = None

        for rule in applicable:
            if self._match_all(rule.conditions, input_data):
                matched_rules.append(rule.rule_id)
                if decision is None:  # 第一条匹配的规则获胜（按priority排序）
                    decision = rule.target if rule.effect == "dispatch" else rule.effect
                    reason = self._build_reason(rule.conditions, input_data)
                    matched_rule_id = rule.rule_id

        elapsed_ms = (time.perf_counter() - start) * 1000

        return {
            "decision": decision or "deny",
            "rule_id": matched_rule_id,
            "reason": reason,
            "matched_rules": matched_rules,
            "evaluation_ms": round(elapsed_ms, 3),
            "policy_path": policy_path,
        }

    def _match_all(self, conditions: list[dict], input_data: dict) -> bool:
        """所有条件都匹配才返回 True（AND 关系）"""
        return all(self._match_one(c, input_data) for c in conditions)

    def _match_one(self, condition: dict, input_data: dict) -> bool:
        """评估单个条件"""
        field_val = self._get_field(condition["field"], input_data)
        op = condition["op"]
        threshold = condition["value"]

        ops = {
            "eq": lambda a, b: a == b,
            "ne": lambda a, b: a != b,
            "gt": lambda a, b: a > b,
            "gte": lambda a, b: a >= b,
            "lt": lambda a, b: a < b,
            "lte": lambda a, b: a <= b,
            "in": lambda a, b: a in b,
            "not_in": lambda a, b: a not in b,
            "contains": lambda a, b: b in str(a),
            "regex": lambda a, b: bool(re.search(b, str(a))),
            "exists": lambda a, b: a is not None,
        }
        fn = ops.get(op)
        if fn is None:
            return False
        try:
            return fn(field_val, threshold)
        except (TypeError, ValueError):
            return False

    def _get_field(self, path: str, data: dict) -> Any:
        """支持点号路径访问：'lead.score' → data['lead']['score']"""
        parts = path.split(".")
        cur = data
        for p in parts:
            if isinstance(cur, dict):
                cur = cur.get(p)
            else:
                return None
        return cur

    def _build_reason(self, conditions: list[dict], input_data: dict) -> str:
        parts = []
        for c in conditions:
            val = self._get_field(c["field"], input_data)
            parts.append(f"{c['field']}({val}) {c['op']} {c['value']}")
        return " AND ".join(parts)
```

### 内置规则示例（存入 DB）

```python
BUILTIN_DISPATCH_RULES = [
    PolicyRule(
        rule_id="DISPATCH-001",
        name="高意向线索派发到跟进虾",
        conditions=[
            {"field": "lead.score", "op": "gte", "value": 80},
            {"field": "lead.followup_count", "op": "lt", "value": 3},
        ],
        effect="dispatch", target="followup", priority=10,
    ),
    PolicyRule(
        rule_id="DISPATCH-002",
        name="中意向线索派发到回声虾",
        conditions=[
            {"field": "lead.score", "op": "gte", "value": 60},
            {"field": "lead.score", "op": "lt", "value": 80},
        ],
        effect="dispatch", target="echoer", priority=20,
    ),
    PolicyRule(
        rule_id="COMPLIANCE-001",
        name="禁止向黑名单号码发送消息",
        conditions=[
            {"field": "lead.blacklisted", "op": "eq", "value": True},
        ],
        effect="deny", priority=1,  # 最高优先级
    ),
]
```

---

## B. 决策日志（DecisionLogger）

### `dragon-senate-saas-v2/decision_logger.py`

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

@dataclass
class DecisionLog:
    """每次策略评估的完整记录（借鉴 OPA plugins/logs/）"""
    log_id: str
    tenant_id: str
    policy_path: str            # "dispatch" | "allow" | "compliance"
    input_data: dict            # 输入数据（脱敏后）
    decision: str               # "followup" | "deny" | "allow"
    rule_id: Optional[str]      # 命中的规则 ID
    reason: str                 # 决策原因
    evaluation_ms: float        # 评估耗时
    lobster_id: Optional[str] = None   # 相关龙虾
    task_id: Optional[str] = None      # 相关任务
    timestamp: datetime = field(default_factory=datetime.utcnow)

class DecisionLogger:
    """决策日志记录器"""

    async def log(self, decision_result: dict, context: dict) -> DecisionLog:
        """记录一次策略评估决策"""
        log = DecisionLog(
            log_id=f"DL-{int(datetime.utcnow().timestamp()*1000)}",
            tenant_id=context.get("tenant_id", ""),
            policy_path=decision_result.get("policy_path", ""),
            input_data=self._sanitize(context.get("input_data", {})),
            decision=decision_result.get("decision", ""),
            rule_id=decision_result.get("rule_id"),
            reason=decision_result.get("reason", ""),
            evaluation_ms=decision_result.get("evaluation_ms", 0),
            lobster_id=context.get("lobster_id"),
            task_id=context.get("task_id"),
        )
        # 写入 DB...
        return log

    def _sanitize(self, data: dict) -> dict:
        """脱敏敏感字段"""
        sensitive = {"phone", "email", "id_card", "token", "password"}
        return {
            k: "***" if k in sensitive else v
            for k, v in data.items()
        }
```

**API 接口**：
```
GET  /api/v1/audit/decisions?tenant_id=&policy_path=&start=&end=
     → 决策日志列表（支持按规则ID/决策结果过滤）

GET  /api/v1/audit/decisions/{log_id}
     → 单次决策详情（完整 input/output/reason）

GET  /api/v1/audit/decisions/stats
     → 统计：各决策类型占比、平均耗时、TOP拦截规则
```

---

## C. 策略热推送（PolicyBundleManager）

### `dragon-senate-saas-v2/policy_bundle_manager.py`

```python
import asyncio
import hashlib
import time
from dataclasses import dataclass
from typing import Optional

@dataclass
class PolicyBundle:
    """策略包（借鉴 OPA bundle 设计）"""
    bundle_id: str
    version: str
    rules: list[dict]   # 序列化的规则列表
    checksum: str       # SHA256 完整性校验
    created_at: float = 0

    @classmethod
    def create(cls, rules: list[dict], version: str) -> "PolicyBundle":
        content = str(rules).encode()
        checksum = hashlib.sha256(content).hexdigest()[:16]
        return cls(
            bundle_id=f"bundle-{version}",
            version=version,
            rules=rules,
            checksum=checksum,
            created_at=time.time()
        )

class PolicyBundleManager:
    """
    策略包管理器
    - 云端：维护最新 bundle，边缘节点轮询拉取
    - 边缘：接收 bundle，更新本地 PolicyEngine
    借鉴 OPA plugins/bundle/ 的热分发设计
    """

    def __init__(self, policy_engine: "PolicyEngine", poll_interval: int = 30):
        self.engine = policy_engine
        self.poll_interval = poll_interval
        self._current_version: Optional[str] = None

    async def start_polling(self, bundle_url: str):
        """启动轮询（边缘节点调用）"""
        while True:
            try:
                await self._fetch_and_apply(bundle_url)
            except Exception as e:
                print(f"[PolicyBundle] 拉取失败: {e}")
            await asyncio.sleep(self.poll_interval)

    async def _fetch_and_apply(self, url: str):
        import urllib.request, json
        with urllib.request.urlopen(url, timeout=10) as r:
            bundle_data = json.loads(r.read())
        new_version = bundle_data.get("version")
        if new_version == self._current_version:
            return  # 无变化，跳过

        # 验证 checksum
        rules = bundle_data.get("rules", [])
        expected_checksum = bundle_data.get("checksum")
        actual_checksum = hashlib.sha256(str(rules).encode()).hexdigest()[:16]
        if actual_checksum != expected_checksum:
            raise ValueError("Bundle checksum 验证失败，拒绝更新")

        # 应用新规则
        from policy_engine import PolicyRule
        rule_objects = [PolicyRule(**r) for r in rules]
        self.engine.load_rules(rule_objects)
        self._current_version = new_version
        print(f"[PolicyBundle] 规则已更新到 v{new_version}（{len(rules)} 条规则）")
```

---

## D. 边缘离线合规守卫

### `edge-runtime/policy_guard.py`

```python
"""
边缘节点本地策略守卫
- 无需回云查询，本地评估（<1ms）
- 断网时依然能执行合规规则
- 借鉴 OPA sidecar 模式
"""
from __future__ import annotations
import json
import os
from typing import Optional

# 边缘节点本地缓存的规则文件
EDGE_POLICY_FILE = "/opt/openclaw/edge/policies.json"

class EdgePolicyGuard:
    """边缘端策略守卫（离线可用）"""

    def __init__(self, policy_file: str = EDGE_POLICY_FILE):
        self._rules: list[dict] = []
        self._load_local(policy_file)

    def _load_local(self, path: str):
        """从本地文件加载规则（支持离线启动）"""
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._rules = data.get("rules", [])
            print(f"[EdgeGuard] 加载 {len(self._rules)} 条规则（本地）")
        else:
            # 使用内置兜底规则
            self._rules = self._builtin_rules()
            print("[EdgeGuard] 使用内置兜底规则（无本地策略文件）")

    def update_rules(self, rules: list[dict], policy_file: str = EDGE_POLICY_FILE):
        """接收云端推送的规则并持久化"""
        self._rules = rules
        os.makedirs(os.path.dirname(policy_file), exist_ok=True)
        with open(policy_file, "w", encoding="utf-8") as f:
            json.dump({"rules": rules}, f, ensure_ascii=False, indent=2)

    def check(self, action: str, context: dict) -> dict:
        """
        执行合规检查
        Returns: {"allowed": True/False, "reason": "..."}
        """
        for rule in self._rules:
            if rule.get("policy_path") != action:
                continue
            conditions = rule.get("conditions", [])
            if self._match_all(conditions, context):
                effect = rule.get("effect", "deny")
                return {
                    "allowed": effect == "allow",
                    "reason": rule.get("name", ""),
                    "rule_id": rule.get("rule_id"),
                }
        return {"allowed": True, "reason": "no blocking rule"}

    def _match_all(self, conditions: list[dict], ctx: dict) -> bool:
        for c in conditions:
            v = ctx.get(c["field"])
            op, thr = c["op"], c["value"]
            if op == "eq" and v != thr: return False
            if op == "gte" and (v is None or v < thr): return False
            if op == "in" and v not in thr: return False
        return True

    @staticmethod
    def _builtin_rules() -> list[dict]:
        """内置兜底安全规则（不可被覆盖）"""
        return [
            {
                "rule_id": "BUILTIN-001",
                "name": "禁止向黑名单号码发送消息",
                "policy_path": "send_message",
                "conditions": [{"field": "blacklisted", "op": "eq", "value": True}],
                "effect": "deny",
            },
            {
                "rule_id": "BUILTIN-002",
                "name": "禁止单日发送超过50条消息",
                "policy_path": "send_message",
                "conditions": [{"field": "daily_send_count", "op": "gte", "value": 50}],
                "effect": "deny",
            },
        ]
```

---

## API 接口

```
# 策略管理
GET  /api/v1/policies                   # 所有规则列表
POST /api/v1/policies                   # 创建规则
PUT  /api/v1/policies/{id}              # 修改规则
DEL  /api/v1/policies/{id}              # 删除规则
POST /api/v1/policies/evaluate          # 临时评估（测试用）
  body: {"policy_path": "dispatch", "input": {...}}

# Bundle 管理
GET  /api/v1/policies/bundle/current    # 当前 bundle 版本
POST /api/v1/policies/bundle/publish    # 发布新 bundle（推送到边缘）

# 决策日志
GET  /api/v1/audit/decisions            # 决策日志列表
GET  /api/v1/audit/decisions/stats      # 统计信息
```

---

## 验收标准

### PolicyEngine（P1-1）
- [ ] `PolicyEngine.evaluate()` 支持 AND 条件组合
- [ ] 支持10种操作符（eq/gte/lt/in/contains/regex 等）
- [ ] 点号路径访问（`lead.score`）
- [ ] 规则优先级（priority 数字越小越优先）
- [ ] 租户私有规则（tenant_id 过滤）
- [ ] 热更新（`load_rules()` 无需重启）
- [ ] 评估耗时 < 1ms（内存操作）

### DecisionLogger（P1-2）
- [ ] 每次评估记录 input/decision/reason/耗时
- [ ] 敏感字段自动脱敏
- [ ] `GET /api/v1/audit/decisions` 分页查询
- [ ] 前端决策日志页：时间轴 + 规则命中高亮 + "为什么被拒绝"

### PolicyBundleManager（P1-3）
- [ ] bundle checksum 完整性校验
- [ ] 30秒轮询，版本号相同跳过
- [ ] 云端 `/api/v1/policies/bundle/current` 接口
- [ ] 边缘节点接收 bundle 后持久化到本地文件

### EdgePolicyGuard（P1-4）
- [ ] 离线启动（从本地文件加载规则）
- [ ] 无本地文件时使用内置兜底规则
- [ ] `check()` 纯内存评估，< 1ms
- [ ] 接收云端推送时持久化到本地（保证重启后可用）
- [ ] 在 `marionette_executor` 中集成：发消息前必须 `guard.check("send_message", ctx)`

---

*Codex Task | 来源：OPA_BORROWING_ANALYSIS.md P1-1~P1-4 | 2026-04-02*
