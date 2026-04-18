# OpenClaw 最终指挥动作清单
> 日期：2026-04-17
> 用途：给项目总控直接派发最后动作。
> 当前原则：不再扩前端新功能，进入最终验收盖章。

## 1. 当前总判断

前端线已经正式收口，学习闭环已经可验收、可汇报、可交接。

现在最后阶段不是继续开发功能，而是：

- QA 复核
- 真实环境签收
- 发布流程认可
- 老板汇报
- 客户演示 polish

## 2. 行动总表

| 负责人 | 最后动作 | 去哪看 | 完成标准 | 能否后置 |
| --- | --- | --- | --- | --- |
| 项目总控 | 统一节奏，决定是否进入最终验收盖章 | `docs/OPENCLAW_PROJECT_FINAL_STATUS_2026-04-17.md` | A-02 / A-04 责任人明确，老板汇报口径统一 | 不建议 |
| QA 审核 | 复跑前端 closeout，并推进 A-02 真实环境签收 | `/operations/release-checklist` | `verify:closeout:frontend` 通过，A-02 给出 pass / blocker 结论 | 不可后置 |
| Skills 负责人 | 保持 A-04 passed 记录，release scope 变化时重签 | `packages/lobsters/SKILLS_FREEZE_RELEASE_RECOGNITION_2026-04-17.md` | demo skills freeze 已在发布流程里被正式承认 | 已完成 |
| 稳定性负责人 | 盯 release gate、frontend closeout artifacts、operations scan | `/operations/project-closeout` | 最新验证产物可读，真实环境 blocker 有负责人和 ETA | 不可后置 |
| 知识库优化负责人 | 复核 A-05 knowledge evidence 和双轨记忆边界 | `/operations/memory` | tenant-private 不上流，knowledge evidence 可复跑 | 可短暂后置 |
| AI 前端补位工程师 | 只做最终人工复看和演示 polish | `/operations/frontend-gaps` | 不再扩新功能，只修真实展示问题 | 可后置 |
| AI 群协作集成工程师 | 确认 group-collab frozen contract 和真实通道回执差异 | `/collab` | mock / live 边界解释清楚，真实通道差异不误判为前端 blocker | 可短暂后置 |
| 后端工程师 | 保持 tenant-cockpit / skills / memory / release gate 读接口稳定 | `/operations/tenant-cockpit` | 页面能读到稳定 contract，不出现空白误判 | 不建议后置 |

## 3. 项目总控今天要做的 5 件事

1. 把 `docs/OPENCLAW_EXECUTIVE_BRIEF_2026-04-17.md` 发给老板和 AI 员工群。
2. 指定 QA 审核负责 A-02 真实环境签收。
3. 通知 Skills 负责人 A-04 已 passed，release scope 变化时再重签。
4. 要求稳定性负责人盯住最新验证产物和 release gate。
5. 明确通知前端线：不再扩新功能，只做复核和 polish。

## 4. QA 最后复核步骤

QA 按下面顺序执行：

1. 打开 `/operations/project-closeout`。
2. 查看“前端收尾验证”。
3. 复跑：

```bash
cd web && npm.cmd run verify:closeout:frontend
```

4. 打开 `/operations/release-checklist`。
5. 打开 `/operations/learning-loop-acceptance`。
6. 按人工复核路线逐页确认：

- `/`
- `/operations/tenant-cockpit`
- `/operations/skills-improvements`
- `/operations/memory`
- `/operations/release-checklist`
- `/operations/learning-loop-acceptance`
- `/operations/learning-loop-report`
- `/operations/project-closeout`
- `/operations/frontend-gaps`

7. 对 A-02 给出结论：

- pass
- blocked with reason
- needs real environment retry

## 5. Skills 负责人最后复核步骤

1. 打开 `packages/lobsters/SKILLS_FREEZE_SIGNOFF_2026-04-14.md`。
2. 打开 `packages/lobsters/SKILLS_FREEZE_RELEASE_RECOGNITION_2026-04-17.md`。
3. 确认 demo skills freeze 已经在发布流程里被承认。
4. 反馈给项目总控：

- A-04 passed
- A-04 needs re-sign only if release scope changed

## 6. 稳定性负责人最后复核步骤

重点盯这些产物：

- `web/test-results/frontend-closeout-2026-04-17T08-10-11-152Z`
- `web/test-results/frontend-critical-screens-2026-04-17T08-10-56-747Z`
- `web/test-results/operations-surface-scan-2026-04-17T08-12-34-745Z`

确认：

- closeout 验证通过
- 关键截图产物存在
- operations scan 无 high-priority issue
- A-02 真实环境验证有人负责

## 7. 知识库优化负责人最后复核步骤

1. 打开 `/operations/memory`。
2. 确认 resident / history 双轨记忆可见。
3. 确认 source chain 和脱敏边界可见。
4. 复核 A-05 evidence。
5. 明确结论：

- tenant-private 不上流
- raw trace 不进 platform
- summary only 进入 tenant-private

## 8. 前端补位工程师最后动作

只允许做：

- 修真实展示 bug
- 修错别字或明显乱码
- 做演示 polish
- 补截图或验证产物

不再做：

- 新页面
- 新功能
- 新入口
- 新闭环
- 改运行时 contract

## 9. 后端工程师最后动作

保持这些读接口稳定：

- skill improvement overview
- tenant cockpit overview
- tenant memory / dual-track memory
- release gate latest
- group-collab summary / records / pendingItems

完成标准：

- 前端页面不因为读接口不稳定出现空白误判
- mock / live / unavailable 状态能被明确区分
- 不新增绕过网关的调用

## 10. 仍然不能碰的边界

- 边缘层不做视频合成。
- 边缘层不做学习决策。
- 视频合成仍在云端。
- 龙虾不是独立 agent。
- 不能绕过 `lobster_pool_manager.py`。
- 工作流状态继续走 `workflow_event_log.py`。
- 动态配置继续走 `dynamic_config.py`。
- Skill 提案必须 scan + approve 后才能 apply。
- recommend_rollback 不自动 rollback。
- 租户私有记忆不静默上流。

## 11. 群里可直接发的任务分配

项目当前进入最终验收盖章，不再扩前端新功能。

QA：
- 复跑 `cd web && npm.cmd run verify:closeout:frontend`
- 推进 A-02 真实环境签收

Skills 负责人：
- 保持 A-04 passed；release scope 变化时再重签

稳定性负责人：
- 盯 release gate、frontend closeout artifacts、operations scan

知识库负责人：
- 复核 A-05 evidence 和双轨记忆边界

前端补位：
- 只做最终复看和演示 polish，不再扩新功能

项目总控：
- 准备老板汇报和客户演示话术

## 12. 最终判断

当前可以执行最终验收盖章流程。

前端线已经正式收口，学习闭环已经可验收、可汇报、可交接。

剩余动作的性质已经从“功能开发”变成“签收、复核和演示 polish”。
