# CLAUDE.md — Edge Runtime AI 协作规范

> 版本：1.0.0  
> 生效日期：2026-04-14  
> 来源：基于 [Karpathy Guidelines](https://github.com/forrestchang/andrej-karpathy-skills) 定制，针对边缘执行层做了专项约束

---

## 快速参考

```bash
# 边缘模块改动后必跑
cd ../dragon-senate-saas-v2
PYTHONIOENCODING=utf-8 python scripts/test_edge_publish_heartbeat_inprocess.py
# 期望：=== 所有边缘执行闭环 + 心跳验收测试通过 ===
```

---

## 边缘层核心约束（永久生效）

### 架构边界

```
edge-runtime/      ← 边缘执行层
  ├── 负责：浏览器自动化、平台发布、本地心跳、OS 命令执行
  ├── 不负责：LLM 调用、策略决策、内容生成
  └── 禁止：import dragon-senate-saas-v2 的任何模块
```

**边缘不调 LLM**——这是架构红线，不是建议。验证方式：

```bash
grep -r "from llm_\|import llm_\|from dragon_senate\|openai\|dashscope\|deepseek" . \
  --include="*.py" \
  --exclude-dir=__pycache__
# 期望：无输出
```

### 任务调度约束

- `EdgeTaskBundle` 字段只增不减，新增字段必须有默认值（`Optional` 或 `= None`）
- `HeartbeatPayload` 的 `timestamp` 必须是 ISO 8601 UTC 格式
- `wss_receiver.py` 的 `_task_heartbeat_loop` 心跳间隔默认 30s，不得改小于 15s

### 心跳保活（已实现，不得回退）

`_handle_task` 内部运行 `_task_heartbeat_loop` 协程，在任务执行期间每 30s 向云端发一次 `task_progress`。修改此函数时必须保留该协程。

验证：
```bash
PYTHONIOENCODING=utf-8 python -c "
import sys; sys.path.insert(0, '.')
import inspect
from wss_receiver import WSSReceiver
src = inspect.getsource(WSSReceiver._handle_task)
assert '_task_heartbeat_loop' in src, 'heartbeat loop 被删除了！'
print('OK: heartbeat loop 存在')
"
```

---

## 行为规则

### 规则 3：Surgical Changes 🔴

**只改被要求改的。发现问题报告，不处理。**

边缘层特殊说明：
- `browser_engine.py`、`context_navigator.py`、`marionette_executor.py` 是高敏感文件，任何改动前先说明影响范围
- `edge_heartbeat.py` 的 SQLite schema 不得改动，只能向 `edge_task_assignments` 加列，不得删列或改列名

### 规则 4：Goal-Driven Execution 🔴

**改动的退出条件：**

| 改动范围 | 退出条件 |
|---|---|
| `wss_receiver.py` | `test_edge_publish_heartbeat_inprocess.py` PASS |
| `edge_heartbeat.py` | `test_edge_publish_heartbeat_inprocess.py` PASS |
| `task_schema.py` | `test_edge_publish_heartbeat_inprocess.py` PASS + schema 字段数 ≥ 30 |
| `marionette_executor.py` | 手动验证 SOP 执行链路（自动化测试 pending） |
| `browser_engine.py` | 手动验证（依赖真实浏览器环境） |

### 规则 1：Think Before Coding 🟡

以下情况改动前必须先列假设并等确认：

- 修改 `wss_receiver.py` 的任务派发逻辑
- 修改 `edge_heartbeat.py` 的 SQLite 操作
- 修改 `task_schema.py` 的 Pydantic 模型（任何字段变动）

### 规则 2：Simplicity First 🟢

仅对新建 skill 脚本（`scripts/skills/`）强制执行。  
`edge_heartbeat.py`、`wss_receiver.py` 等核心文件豁免重构。

---

## 常用验证命令

```bash
# 边缘心跳 + schema 验收
cd ../dragon-senate-saas-v2
PYTHONIOENCODING=utf-8 python scripts/test_edge_publish_heartbeat_inprocess.py

# 架构边界检查（边缘不应 import 云端模块）
cd /f/openclaw-agent/edge-runtime
grep -r "from llm_\|import llm_\|from dragon_senate\|dashscope\|deepseek" . \
  --include="*.py" --exclude-dir=__pycache__

# heartbeat loop 存在性验证
PYTHONIOENCODING=utf-8 python -c "
import sys; sys.path.insert(0, '.')
import inspect; from wss_receiver import WSSReceiver
src = inspect.getsource(WSSReceiver._handle_task)
assert '_task_heartbeat_loop' in src
print('OK')
"

# task_schema 字段数验证（应 >= 30）
PYTHONIOENCODING=utf-8 python -c "
import sys; sys.path.insert(0, '.')
from task_schema import EdgeTaskBundle
fields = list(EdgeTaskBundle.model_fields.keys())
print(f'EdgeTaskBundle fields: {len(fields)}')
assert len(fields) >= 30, f'字段数异常: {len(fields)}'
print('OK')
"
```

---

## 变更日志

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-04-14 | 1.0.0 | 初始版本。规则 3+4 全量；规则 1 针对高敏感文件；规则 2 仅新 skill 脚本；新增架构边界检查命令和心跳保活验证 |
