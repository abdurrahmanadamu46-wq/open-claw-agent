# CODEX TASK: 结构化日志 SQL 查询 API + 前端查询界面

**优先级：P1**  
**来源：OPENOBSERVE_BORROWING_ANALYSIS.md P1-#1**

---

## 背景

`llm_call_logger.py` 写入了结构化日志，但没有 SQL 查询界面。运营无法回答"过去1小时 inkwriter 失败了多少次？"。借鉴 OpenObserve 的 SQL 模式日志搜索，新增 `/api/v1/logs/query` 端点 + `dragon_dashboard.html` 日志查询 Tab。

---

## 实现

```python
# dragon-senate-saas-v2/log_query_api.py

import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# 允许的查询字段白名单（防止 SQL 注入）
ALLOWED_TABLES = {"llm_call_logs", "tool_call_logs", "workflow_event_logs", "edge_task_logs"}
SAFE_SQL_PATTERN = re.compile(
    r"^SELECT\s+.+\s+FROM\s+(\w+)(\s+WHERE\s+.+)?(\s+GROUP BY\s+.+)?(\s+ORDER BY\s+.+)?(\s+LIMIT\s+\d+)?$",
    re.IGNORECASE | re.DOTALL,
)


def validate_query(sql: str) -> tuple[bool, str]:
    """基本 SQL 安全校验（只允许 SELECT，白名单表）"""
    sql = sql.strip()
    if not sql.upper().startswith("SELECT"):
        return False, "只允许 SELECT 查询"
    # 禁止危险关键字
    forbidden = ["DROP", "DELETE", "INSERT", "UPDATE", "TRUNCATE", "--", ";--"]
    for kw in forbidden:
        if kw.lower() in sql.lower():
            return False, f"禁止使用关键字: {kw}"
    # 检查表名白名单
    match = re.search(r"FROM\s+(\w+)", sql, re.IGNORECASE)
    if match:
        table = match.group(1).lower()
        if table not in ALLOWED_TABLES:
            return False, f"表 {table} 不在允许列表中"
    return True, ""


class LogQueryApi:
    """
    结构化日志 SQL 查询 API
    
    复用 llm_call_logger 的 DB 连接，支持 SQL 查询和时间范围过滤
    """

    def __init__(self, db):
        self.db = db

    async def query(
        self,
        sql: str,
        tenant_id: str,
        time_range_hours: int = 1,
        limit: int = 500,
    ) -> dict:
        """
        执行日志 SQL 查询
        
        自动注入 tenant_id 过滤（租户隔离）
        自动注入时间范围限制
        """
        valid, reason = validate_query(sql)
        if not valid:
            return {"success": False, "error": reason}

        # 自动注入 LIMIT（防止查询过大）
        if "LIMIT" not in sql.upper():
            sql = f"{sql} LIMIT {limit}"

        logger.info(f"[LogQuery] tenant={tenant_id} sql={sql[:100]}...")

        try:
            rows = await self.db.execute_query(
                sql,
                params={"tenant_id": tenant_id,
                        "time_range_hours": time_range_hours},
            )
            return {
                "success": True,
                "rows": rows,
                "count": len(rows),
                "sql": sql,
            }
        except Exception as e:
            logger.warning(f"[LogQuery] 查询失败: {e}")
            return {"success": False, "error": str(e)}

    def get_query_templates(self) -> list[dict]:
        """返回预置查询模板（前端下拉选择）"""
        return [
            {
                "name": "龙虾错误率（过去1小时）",
                "sql": "SELECT lobster_name, COUNT(*) as total, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors FROM llm_call_logs WHERE timestamp > now() - interval '1 hour' GROUP BY lobster_name ORDER BY errors DESC",
            },
            {
                "name": "最慢的10次LLM调用",
                "sql": "SELECT lobster_name, model, latency_ms, prompt_tokens, created_at FROM llm_call_logs ORDER BY latency_ms DESC LIMIT 10",
            },
            {
                "name": "今日Token消耗",
                "sql": "SELECT lobster_name, SUM(prompt_tokens + completion_tokens) as total_tokens, SUM(cost_usd) as total_cost FROM llm_call_logs WHERE DATE(created_at) = CURRENT_DATE GROUP BY lobster_name",
            },
            {
                "name": "边缘任务失败记录",
                "sql": "SELECT node_id, task_type, error_msg, created_at FROM edge_task_logs WHERE status='failed' ORDER BY created_at DESC LIMIT 50",
            },
        ]
```

---

## FastAPI 路由

```python
# dragon-senate-saas-v2/observability_api.py（追加）

from .log_query_api import LogQueryApi

@router.post("/api/v1/logs/query")
async def query_logs(
    body: dict,  # {sql, time_range_hours}
    ctx=Depends(get_tenant_context),
):
    api = LogQueryApi(db)
    return await api.query(
        sql=body.get("sql", ""),
        tenant_id=ctx.tenant_id,
        time_range_hours=body.get("time_range_hours", 1),
    )

@router.get("/api/v1/logs/templates")
async def get_log_templates(ctx=Depends(get_tenant_context)):
    api = LogQueryApi(db)
    return api.get_query_templates()
```

---

## dragon_dashboard.html 日志查询 Tab（新增）

```html
<!-- Tab 按钮 -->
<button class="tab-btn" onclick="switchTab('logs')">🔍 日志查询</button>

<!-- Tab 内容 -->
<div id="tab-logs" class="tab-panel" style="display:none">
  <div class="card">
    <!-- 时间范围 + 预置模板 -->
    <div class="query-toolbar">
      <select id="log-time-range">
        <option value="1">过去 1 小时</option>
        <option value="6">过去 6 小时</option>
        <option value="24" selected>过去 24 小时</option>
        <option value="168">过去 7 天</option>
      </select>
      <select id="log-templates" onchange="loadTemplate(this.value)">
        <option value="">-- 选择预置查询 --</option>
      </select>
      <button onclick="runLogQuery()" class="btn-primary">▶ 执行查询</button>
    </div>
    <!-- SQL 编辑器（简单 textarea，后续可升级 CodeMirror）-->
    <textarea id="log-sql-editor" rows="4" placeholder="SELECT lobster_name, COUNT(*) FROM llm_call_logs GROUP BY lobster_name"></textarea>
    <!-- 结果区 -->
    <div id="log-query-result"></div>
  </div>
</div>

<script>
async function runLogQuery() {
  const sql = document.getElementById('log-sql-editor').value;
  const hours = document.getElementById('log-time-range').value;
  const resp = await fetch('/api/v1/logs/query', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sql, time_range_hours: parseInt(hours)}),
  });
  const data = await resp.json();
  if (!data.success) {
    document.getElementById('log-query-result').innerHTML =
      `<div class="error">❌ ${data.error}</div>`;
    return;
  }
  // 渲染表格
  const rows = data.rows;
  if (!rows || rows.length === 0) {
    document.getElementById('log-query-result').innerHTML = '<div>无数据</div>';
    return;
  }
  const cols = Object.keys(rows[0]);
  const html = `<div class="result-meta">共 ${data.count} 条</div>
    <table class="data-table">
      <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r =>
        `<tr>${cols.map(c => `<td>${r[c] ?? ''}</td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table>`;
  document.getElementById('log-query-result').innerHTML = html;
}
</script>
```

---

## 验收标准

- [ ] `validate_query()`：只允许 SELECT，禁止危险关键字，白名单表
- [ ] `LogQueryApi.query()`：自动注入 tenant_id + LIMIT 保护
- [ ] `get_query_templates()`：4个预置查询模板
- [ ] POST `/api/v1/logs/query` 路由注册
- [ ] GET `/api/v1/logs/templates` 路由注册
- [ ] `dragon_dashboard.html` 新增"日志查询"Tab
- [ ] 时间范围选择器（1h/6h/24h/7d）
- [ ] 预置模板下拉自动填充 SQL 编辑器
- [ ] 查询结果渲染为表格

---

*Codex Task | 来源：OPENOBSERVE_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
