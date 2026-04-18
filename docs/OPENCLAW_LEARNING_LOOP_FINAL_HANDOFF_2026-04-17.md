# OpenClaw 学习闭环最终交接说明

> 日期：2026-04-17
> 范围：Hermes 风格双轨记忆 + Skill 自动进化闭环 + 商业化验收入口
> 当前状态：实现完成，前端验收面完成，可进入 QA / 内部汇报 / 交付阶段

## 1. 这份文档的用途

这份文档是 OpenClaw 学习闭环的最终交接说明。

它不是研发分析稿，也不是 brainstorm 记录，而是给下面这些角色直接使用的：

- 项目总控
- QA 审核
- AI 前端补位工程师
- 开发 skills 负责人
- 知识库优化负责人
- 稳定性负责人
- 老板 / 内部汇报对象

## 2. 已经落地的核心能力

### 2.1 双轨记忆系统

已经落地：

- 小而稳定的常驻记忆 resident
- 大而可检索的历史记忆 history
- source chain 溯源
- secret guard 脱敏
- resident 固定上下文预算

运行位置：

- `dragon-senate-saas-v2/dual_track_memory.py`
- 前端查看页：`/operations/memory`

### 2.2 Skill 自动进化闭环

已经落地：

- runtime failure / output validation failed / low quality / edge retry / human revision 等 signal 自动进入学习闭环
- signal 去重
- 低置信度拦截
- Skill improvement proposal 自动生成
- proposal 扫描 scan
- 人工 approve / reject
- approved 后 apply
- applied 后 rollback

运行位置：

- `dragon-senate-saas-v2/skill_improvement_proposal.py`
- `dragon-senate-saas-v2/skill_improvement_signal_router.py`
- 前端操作页：`/operations/skills-improvements`

### 2.3 发布后效果追踪

已经落地：

- apply / rollback 生命周期事件
- runtime 效果观测
- human feedback 效果观测
- edge telemetry 效果观测
- avg delta / 正负观测统计
- keep_applied / continue_observing / recommend_rollback 建议

运行位置：

- `dragon-senate-saas-v2/skill_improvement_proposal.py`
- 前端查看页：`/operations/skills-improvements`

### 2.4 商业化验收入口

已经落地的前端入口：

- `/operations/delivery-hub`
  最终交付导航页
- `/`
  首页轻量健康卡
- `/operations/tenant-cockpit`
  租户级商业化验收总览
- `/operations/skills-improvements`
  学习闭环完整操作台
- `/operations/memory`
  双轨记忆详情
- `/operations/release-checklist`
  QA 勾选清单
- `/operations/learning-loop-acceptance`
  一步一步验收说明
- `/operations/learning-loop-report`
  老板汇报版极简页

## 3. 建议的验收顺序

推荐按这个顺序验收：

1. 打开 `/`
   确认首页能看到学习闭环健康度。
2. 打开 `/operations/tenant-cockpit`
   确认 Cockpit 已聚合学习闭环摘要。
3. 打开 `/operations/memory`
   确认 resident / history / source chain / 手动沉淀可见。
4. 打开 `/operations/skills-improvements`
   确认 signal、proposal、scan、diff、approve、apply、rollback、effect tracking 全链路可见。
5. 打开 `/operations/release-checklist`
   逐项勾选学习闭环验收项。
6. 打开 `/operations/learning-loop-acceptance`
   复制 Markdown 验收摘要。
7. 打开 `/operations/learning-loop-report`
   复制老板汇报版 Markdown 摘要。

## 3.2 现在交接给总工程师时最该附带的样本

- 知识三层完整运行时样本：
  `F:/openclaw-agent/web/test-results/knowledge-context-real-2026-04-17T06-33-26-088Z`
- 知识三层本地包装样本：
  `F:/openclaw-agent/web/test-results/knowledge-context-local-2026-04-17T08-40-07-846Z`
- 整包 release gate：
  `F:/openclaw-agent/web/test-results/release-gate-local-2026-04-17T08-38-28-478Z`
- 前端总收尾样本：
  `F:/openclaw-agent/web/test-results/frontend-closeout-2026-04-17T08-37-32-066Z`

推荐一并带上的命令：

- `cd web && npm run evidence:knowledge-context:local`
- `cd web && npm run verify:release-gate:local`

## 3.1 当前推荐直接复跑的命令

- `cd web && npm run evidence:knowledge-context:local:context`
  快速确认知识三层注入，不跑长图
- `cd web && npm run evidence:knowledge-context:local`
  跑完整 `runtime_evidence`
- `cd web && npm run verify:release-gate:local`
  把 release UI smoke、release data 和 knowledge evidence 一起跑完

当前推荐样本：

- 知识三层完整运行时样本：
  `F:/openclaw-agent/web/test-results/knowledge-context-real-2026-04-17T06-33-26-088Z`
- 知识三层本地包装样本：
  `F:/openclaw-agent/web/test-results/knowledge-context-local-2026-04-17T08-40-07-846Z`
- 整包 release gate：
  `F:/openclaw-agent/web/test-results/release-gate-local-2026-04-17T08-38-28-478Z`

## 4. 当前边界与红线

以下边界必须继续保持：

- 边缘层只回传事实信号，不做学习决策。
- 龙虾仍然是统一运行时的角色协议，不是独立 agent。
- Skill 提案 apply 前必须经过 scan 和人工 approve。
- recommend_rollback 只是建议，不自动执行 rollback。
- 租户私有记忆不能静默上流成平台知识。
- 视频合成仍然只允许在云端。

## 5. 当前可以怎么对外表达

当前可以对内或对客户演示这样表达：

> OpenClaw 现在已经具备一套安全的经验积累闭环。
> 系统能把真实运行信号、人工改稿和边缘执行反馈沉淀为 Skill 改进提案；
> 提案必须经过扫描和人工审批后才能应用；
> 应用后还会持续追踪效果，并在必要时建议人工回滚。

不要这样表达：

- “系统会自动自己改自己”
- “系统会自动回滚”
- “所有经验都会自动升级成平台知识”

## 6. 当前剩余的非阻断项

这些不是阻断项，但如果继续打磨，会更适合正式交付：

- 把学习闭环总览继续接入 `/operations/control-panel` 或其他管理聚合面
- 增加更正式的导出报告文件下载能力
- 增加效果事件的时间趋势图
- 增加建议回滚后的人工处理记录模板

## 7. 当前结论

结论：

- 技术主链路：已收口
- 前端演示入口：已收口
- QA 清单：已接入
- 老板汇报入口：已接入
- 剩余工作：偏交付打磨，不是核心闭环缺失

因此这条学习闭环能力线，已经可以视为：

> 实现完成，可验收，可汇报，可交接
