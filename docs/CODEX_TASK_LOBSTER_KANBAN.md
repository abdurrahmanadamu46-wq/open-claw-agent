# CODEX TASK: 龙虾任务看板视图（Kanban Board）

**优先级：P1**  
**来源：PLANE_BORROWING_ANALYSIS.md P1-#1**

---

## 背景

`dragon_dashboard.html` 的任务列表只是平铺列表，运营无法一眼看出各龙虾的任务积压情况和执行阶段。借鉴 Plane Kanban 看板，新增"龙虾任务看板"Tab，以龙虾为列、状态为行，卡片化展示任务。

---

## 前端实现（dragon_dashboard.html 新增 Tab）

```html
<!-- Tab 按钮 -->
<button class="tab-btn" onclick="switchTab('kanban')">🦞 任务看板</button>

<!-- Tab 内容 -->
<div id="tab-kanban" class="tab-panel" style="display:none">
  <div class="kanban-toolbar">
    <select id="kanban-filter-status" onchange="renderKanban()">
      <option value="">全部状态</option>
      <option value="pending">待处理</option>
      <option value="running">执行中</option>
      <option value="done">已完成</option>
      <option value="failed">失败</option>
    </select>
    <button onclick="refreshKanban()" class="btn-sm">🔄 刷新</button>
  </div>
  <div id="kanban-board" class="kanban-board"></div>
</div>

<style>
.kanban-board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  padding: 16px 0;
  overflow-x: auto;
}
.kanban-col {
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 8px;
  padding: 10px;
  min-width: 180px;
}
.kanban-col-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 2px solid var(--accent, #6366f1);
}
.kanban-col-count {
  background: var(--accent, #6366f1);
  color: #fff;
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 11px;
}
.kanban-card {
  background: #fff;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 6px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,.08);
  border-left: 3px solid transparent;
  transition: box-shadow .15s;
}
.kanban-card:hover { box-shadow: 0 3px 8px rgba(0,0,0,.15); }
.kanban-card.status-running  { border-left-color: #3b82f6; }
.kanban-card.status-done     { border-left-color: #22c55e; }
.kanban-card.status-failed   { border-left-color: #ef4444; }
.kanban-card.status-pending  { border-left-color: #a3a3a3; }
.kanban-card-title { font-weight: 500; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kanban-card-meta  { color: #888; font-size: 11px; }
.kanban-card-priority-urgent { color: #ef4444; }
.kanban-card-priority-high   { color: #f97316; }
.kanban-empty { color: #bbb; text-align: center; padding: 16px 0; font-size: 12px; }
</style>

<script>
const LOBSTERS_ORDER = [
  'commander','strategist','radar','inkwriter',
  'visualizer','dispatcher','echoer','catcher','abacus','followup'
];
const LOBSTER_EMOJI = {
  commander:'🧠', strategist:'📋', radar:'📡', inkwriter:'✍️',
  visualizer:'🎨', dispatcher:'🚀', echoer:'💬', catcher:'🎣',
  abacus:'🔢', followup:'📞',
};
const STATUS_LABEL = {
  pending:'待处理', running:'执行中', done:'已完成', failed:'失败'
};
const PRIORITY_CLASS = {
  urgent:'kanban-card-priority-urgent',
  high:'kanban-card-priority-high',
};

let _kanbanData = [];

async function refreshKanban() {
  try {
    const resp = await fetch('/api/v1/tasks/kanban');
    _kanbanData = await resp.json();
  } catch(e) {
    // 演示数据 fallback
    _kanbanData = [];
  }
  renderKanban();
}

function renderKanban() {
  const filterStatus = document.getElementById('kanban-filter-status')?.value || '';
  const board = document.getElementById('kanban-board');
  if (!board) return;

  // 按龙虾分组
  const grouped = {};
  LOBSTERS_ORDER.forEach(l => { grouped[l] = []; });
  _kanbanData.forEach(task => {
    const l = task.lobster_name;
    if (!grouped[l]) grouped[l] = [];
    if (!filterStatus || task.status === filterStatus) {
      grouped[l].push(task);
    }
  });

  board.innerHTML = LOBSTERS_ORDER.map(lobster => {
    const tasks = grouped[lobster] || [];
    const runningCount = tasks.filter(t => t.status === 'running').length;
    const cards = tasks.length === 0
      ? '<div class="kanban-empty">暂无任务</div>'
      : tasks.slice(0, 10).map(t => `
          <div class="kanban-card status-${t.status}" onclick="showTaskDetail('${t.task_id}')">
            <div class="kanban-card-title">${escHtml(t.title || t.task_id)}</div>
            <div class="kanban-card-meta">
              ${STATUS_LABEL[t.status] || t.status}
              ${t.priority && PRIORITY_CLASS[t.priority]
                ? `· <span class="${PRIORITY_CLASS[t.priority]}">${t.priority}</span>`
                : ''}
              ${t.created_at ? '· ' + relTime(t.created_at) : ''}
            </div>
          </div>`).join('');

    return `
      <div class="kanban-col">
        <div class="kanban-col-header">
          <span>${LOBSTER_EMOJI[lobster] || '🦞'} ${lobster}</span>
          <span class="kanban-col-count">${tasks.length}</span>
        </div>
        ${runningCount > 0 ? `<div style="color:#3b82f6;font-size:11px;margin-bottom:6px">⚡ ${runningCount}个执行中</div>` : ''}
        ${cards}
      </div>`;
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function relTime(ts) {
  const diff = Date.now()/1000 - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff/60) + '分钟前';
  return Math.floor(diff/3600) + '小时前';
}

// 初始化时加载
document.addEventListener('DOMContentLoaded', refreshKanban);
// 30秒自动刷新
setInterval(refreshKanban, 30000);
</script>
```

---

## 后端 API

```python
# dragon-senate-saas-v2/app.py（追加路由）

@router.get("/api/v1/tasks/kanban")
async def get_kanban_tasks(ctx=Depends(get_tenant_context)):
    """
    返回看板数据：最近24小时内的任务，按 lobster_name 分组
    """
    rows = await db.query_raw(
        """
        SELECT task_id, lobster_name, title, status, priority,
               created_at, updated_at, error_msg
        FROM task_queue
        WHERE tenant_id = ?
          AND created_at > ?
        ORDER BY
          CASE priority
            WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
            WHEN 'medium' THEN 2 ELSE 3
          END,
          created_at DESC
        LIMIT 200
        """,
        [ctx.tenant_id, time.time() - 86400],
    )
    return rows
```

---

## 验收标准

- [ ] 看板 Tab 显示10个龙虾列（按 LOBSTERS_ORDER 排序）
- [ ] 每列卡片按优先级排序（urgent → high → medium → low）
- [ ] 卡片颜色区分状态（蓝=执行中 / 绿=完成 / 红=失败 / 灰=待处理）
- [ ] 顶部状态过滤器（全部/待处理/执行中/已完成/失败）
- [ ] 每列头部显示任务数量徽章 + 执行中任务数
- [ ] 30秒自动刷新 + 手动刷新按钮
- [ ] 后端 `/api/v1/tasks/kanban` 路由（24小时内，按优先级排序）
- [ ] task_queue 表新增 `priority` 和 `title` 字段（配合 P2-3）

---

*Codex Task | 来源：PLANE_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
