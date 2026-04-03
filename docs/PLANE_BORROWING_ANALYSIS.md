# Plane 借鉴分析报告
## https://github.com/makeplane/plane.git

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**

---

## 一、Plane 项目定性

```
Plane（Next.js 14 + Django + Celery，30k+ Star，开源项目管理 SaaS）：
  定位：开源版 Linear/Jira，企业项目协作与任务追踪
  技术栈：
    前端：Next.js 14 App Router + Tailwind CSS + MobX + Plate.js（富文本）
    后端：Django REST + Celery 异步任务 + Redis + PostgreSQL
    实时：Django Channels（WebSocket）
    部署：Docker Compose 一键 + Kubernetes Helm
  核心能力：
    Issue（任务）：创建/分配/优先级/截止日/标签/关系
    Cycle（冲刺）：Sprint 管理，任务归属冲刺
    Module（模块）：项目子模块，任务归属模块
    View（视图）：看板/列表/甘特图/日历多视图切换
    Analytics（分析）：任务完成趋势/成员工作量图表
    Pages（富文本文档）：Plate.js 协作文档，类 Notion
    Intake（需求收集）：外部提交需求入口（类 Canny）
    Webhook：任务状态变更事件推送
    多工作区 + 多成员 + 权限（Owner/Admin/Member/Viewer）
```

---

## 二、已落地的能力（略过）

```
CODEX_TASK_ANTFARM_WORKFLOW_ENGINE.md 已落地：
  ✅ 工作流引擎（任务状态流转）

CODEX_TASK_TENANT_CONTEXT.md 已落地（Keycloak 分析生成）：
  ✅ 多租户隔离

CODEX_TASK_RESOURCE_RBAC.md 已落地：
  ✅ RBAC 权限（Owner/Admin/Member/Viewer）

CODEX_TASK_SHADCN_FORM_SYSTEM.md 已落地：
  ✅ 表单系统

CODEX_TASK_DATATABLE_SERVER_MODE.md 已落地（TanStack 分析生成）：
  ✅ 数据表格（分页/过滤/排序）

CODEX_TASK_WORKFLOW_WEBHOOK_TRIGGER.md 已落地：
  ✅ Webhook 推送

CODEX_TASK_DOCKER_ONE_CLICK_DEPLOY.md 已落地：
  ✅ Docker 一键部署

dragon-senate-saas-v2/task_queue.py 已存在：
  ✅ 异步任务队列（Celery 同等能力）
```

---

## 三、Plane 对我们的真实价值

### 核心判断

Plane 是目前工程最完整的开源项目管理 SaaS，其精华是：
1. **龙虾任务看板**（Kanban视图）——龙虾任务目前无可视化管理界面；
2. **Intake 需求收集**——客户需求目前只通过 IM 流入，没有结构化收集入口；
3. **Analytics 任务分析**——我们有数据但缺乏"燃尽图/工作量分析"这类项目管理视图；
4. **Pages 富文本**——龙虾的策略文档、内容产出目前没有协作文档能力。

---

### 3.1 前端 — 龙虾任务看板视图（Kanban Board）

**Plane Kanban：**
```
Plane 的看板实现：
  列（Column）= 任务状态（Todo/In Progress/Done/Cancelled）
  卡片（Card）= Issue（任务），包含标题/负责人/优先级/截止日
  拖拽：react-beautiful-dnd（拖动卡片改变状态）
  过滤：按标签/负责人/优先级筛选
  快速添加：每列底部"+添加"按钮
```

**对我们的价值：**
```
我们的龙虾任务管理问题：
  dragon_dashboard.html 的任务列表只是一个平铺列表
  没有"当前任务在哪个阶段"的可视化视图
  运营无法一眼看出各龙虾的任务积压情况
  
借鉴 Plane Kanban：
  新增"龙虾任务看板"Tab（在 dragon_dashboard.html）：
    列 = 龙虾名（commander / inkwriter / radar...）
    行 = 状态（待处理 / 执行中 / 完成 / 失败）
    卡片 = 每个具体任务（点击展开详情）
    统计：每列任务数量 + 今日完成数
  
  技术：纯 CSS Grid + JS（不引入第三方拖拽库，保持轻量）
  数据：复用 task_queue.py 的任务状态数据
  
  实现：dragon_dashboard.html 新增 Kanban Tab
  工程量：1天
```

**优先级：P1**（运营最核心的诉求：一眼看懂龙虾工作状态）

---

### 3.2 SaaS 系统 — 客户需求收集入口（Intake）

**Plane Intake：**
```
Plane 的 Intake 功能：
  - 公开表单 URL（不需要登录）
  - 用户填写：标题 / 描述 / 优先级 / 附件
  - 提交后进入待审核队列
  - 管理员审核：接受（转为 Issue）/ 拒绝（附理由）
  - 提交者收到邮件通知
```

**对我们的价值：**
```
我们的需求流入方式：
  客户在 IM（微信/企业微信）发消息 → echoer 龙虾接收
  缺少：结构化需求收集页（客户自助填写，不经过 IM）
  
借鉴 Plane Intake：
  新增"龙虾需求收集表单"：
    公开 URL：/intake/{tenant_slug}
    字段：需求标题 / 详细描述 / 优先级（高/中/低）/ 联系方式
    提交后：进入 catcher 龙虾的"需求待处理"队列
    管理台：运营可接受（转为正式任务）或拒绝（附理由）
  
  实现：dragon-senate-saas-v2/intake_form.py（路由 + 表单 handler）
  前端：简单的公开 HTML 表单页（无需登录）
  工程量：1天
```

**优先级：P1**（客户需求结构化的关键，直接影响 catcher 龙虾的输入质量）

---

### 3.3 支撑微服务 — 任务优先级队列（Priority-based Task Queue）

**Plane Priority：**
```
Plane 的优先级系统：
  5级优先级：Urgent / High / Medium / Low / None
  看板按优先级排序
  Cycle（冲刺）自动聚焦高优任务
  API：按优先级过滤任务
```

**对我们的价值：**
```
我们的 task_queue.py 没有优先级概念：
  所有任务 FIFO，重要任务和普通任务一样等待
  当积压时，"老板急需的任务"和"普通批量任务"同等优先
  
借鉴 Plane：
  在 task_queue.py 新增优先级支持：
    URGENT（紧急）：插队到队首
    HIGH（高）：排在 MEDIUM 前
    MEDIUM（中）：默认
    LOW（低）：排在最后
  
  触发：Intake 表单提交时可标注优先级
         LobsterTriggerRule 触发的任务默认 HIGH
  
  实现：task_queue.py 改造（已有文件，新增 priority 字段）
  工程量：0.5天
```

**优先级：P2**（与 P1 Intake 联动，工程量小）

---

### 3.4 前端 — 富文本协作文档（Pages / Plate.js）

**Plane Pages：**
```
Plane 的 Pages 功能：
  基于 Plate.js（Slate 上层封装）的富文本编辑器
  支持：/命令（斜杠命令）、@提及成员、图片、代码块
  实时协作：Django Channels + Yjs CRDT
  归属：工作区页面 / 项目页面
```

**对我们的价值：**
```
我们的龙虾内容产出（inkwriter/strategist）目前只输出纯文本：
  龙虾写的策略文档没有"结构化文档"存储，只有聊天消息
  运营无法在线编辑龙虾的输出内容
  
借鉴 Plane Pages（简化版）：
  新增"龙虾文档库"功能：
    龙虾生成的重要输出（策略报告/内容方案）自动存为文档
    运营可在管理台在线编辑（简单 textarea + Markdown preview）
    文档版本历史（每次编辑记录 diff）
  
  技术：不引入 Plate.js（过重），用 EasyMDE（轻量 Markdown 编辑器）
  
  实现：dragon-senate-saas-v2/lobster_doc_store.py + 前端 Markdown 编辑器
  工程量：1天
```

**优先级：P2**（内容沉淀的基础，但目前不是最紧迫的）

---

## 四、对比总结

| 维度 | Plane | 我们 | 胜负 | 行动 |
|-----|-------|------|------|------|
| **看板任务视图** | ✅ Kanban | 平铺列表 | Plane 胜 | **P1** |
| **需求收集入口** | ✅ Intake | 仅 IM | Plane 胜 | **P1** |
| **任务优先级队列** | ✅ 5级 | 无优先级 | Plane 胜 | **P2** |
| **富文本协作文档** | ✅ Plate.js | 无 | Plane 胜 | **P2** |
| 多租户 | ✅ | ✅ 已落地 | 平 | — |
| RBAC 权限 | ✅ | ✅ 已落地 | 平 | — |
| Webhook 推送 | ✅ | ✅ 已落地 | 平 | — |
| AI 龙虾 | ❌ | ✅ | 我们胜 | — |
| LLM 驱动 | ❌ | ✅ | 我们胜 | — |

---

## 五、借鉴清单

### P1（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 1 | **龙虾任务看板视图**（Dashboard Kanban Tab）| 1天 |
| 2 | **客户需求收集 Intake 表单**（公开 URL + catcher 队列）| 1天 |

### P2（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 3 | **任务优先级队列**（task_queue.py 新增 priority 字段）| 0.5天 |
| 4 | **龙虾文档库**（Markdown 编辑器 + 版本历史）| 1天 |

---

*分析基于 Plane main 分支（2026-04-02）*
