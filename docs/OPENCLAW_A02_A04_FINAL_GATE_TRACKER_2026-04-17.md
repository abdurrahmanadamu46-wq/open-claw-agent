# OpenClaw A-02 / A-04 最终门禁追踪包
> 日期：2026-04-17
> 用途：关闭客户级对外交付从 `CONDITIONAL GO` 到 `GO` 的两个剩余门禁。
> 当前结论：前端已正式收口；A-04 发布流程认可已补齐；客户级对外交付剩余门禁集中在 A-02 真实环境签收。

## 1. 当前门禁总览

| 门禁 | 当前状态 | 当前证据 | 剩余动作 | 负责人 |
| --- | --- | --- | --- | --- |
| A-02 Execution monitor real-environment verification | 待真实环境最终签收 | 本地 live evidence 已齐 | QA 在真实 control-plane websocket 环境下给最终结论 | QA 审核 + 稳定性负责人 |
| A-04 Demo skills freeze recognition | passed | Skills freeze signoff + release recognition 已存在 | 无，除非 release scope 变化 | Skills 负责人 + 项目总控 |

## 2. A-02 当前证据

已有本地证据目录：

- `docs/qa-evidence/A02_EXECUTION_MONITOR_LOCAL_EVIDENCE_2026-04-14`
- `web/test-results/execution-monitor-live-2026-04-17T08-34-11-756Z`

已有文件：

- `authorized-frames.json`
- `unauthorized-4401.json`
- `forbidden-4403.json`
- `frontend-dev.log`
- `monitor-live.png`
- `REPORT.md`
- `summary.json`

已证明的能力：

- `hello` frame 存在
- `execution_log` frame 存在
- `node_heartbeat` frame 存在
- 未授权关闭码：4401
- 越权租户关闭码：4403
- 合同版本：`execution-logs.v1`

最新本地 harness 复跑结果：

- 生成时间：`2026-04-17T08:34:32.258Z`
- 产物目录：`web/test-results/execution-monitor-live-2026-04-17T08-34-11-756Z`
- 报告：`web/test-results/execution-monitor-live-2026-04-17T08-34-11-756Z/REPORT.md`
- summary：`web/test-results/execution-monitor-live-2026-04-17T08-34-11-756Z/summary.json`
- 结论：hello / execution_log / node_heartbeat / 4401 / 4403 均已在本地 harness 中通过

最新真实环境预检结果：

- 生成时间：`2026-04-18T04:33:56.972Z`
- 产物目录：`web/test-results/execution-monitor-real-2026-04-18T04-33-56-972Z`
- 报告：`web/test-results/execution-monitor-real-2026-04-18T04-33-56-972Z/PREFLIGHT.md`
- summary：`web/test-results/execution-monitor-real-2026-04-18T04-33-56-972Z/preflight-summary.json`
- 结论：当前机器缺少真实 `EXEC_MONITOR_WS_URL` 或 `EXEC_MONITOR_BASE_URL + EXEC_MONITOR_JWT`，并建议补 `EXEC_MONITOR_TENANT_ID`

当前缺口：

- 这些证据是本地 harness / 本地前端环境证据。
- 客户级对外交付前，还需要 QA 在真实 control-plane websocket 环境下完成最终签收。

## 3. A-02 最终签收动作

QA 执行：

1. 打开 `/operations/project-closeout`。
2. 打开 `/operations/monitor`。
3. 先复跑本地 harness 证据，确认基础契约仍然可用：

```bash
cd web && npm.cmd run evidence:execution-monitor:live
```

4. 在真实 control-plane websocket 环境下配置以下环境变量：

```bash
set EXEC_MONITOR_BASE_URL=https://your-control-plane.example.com
set EXEC_MONITOR_JWT=your-qa-token
set EXEC_MONITOR_TENANT_ID=tenant_main
```

或者直接提供完整 websocket URL：

```bash
set EXEC_MONITOR_WS_URL=wss://your-control-plane.example.com/ws/execution-logs?access_token=your-qa-token&tenant_id=tenant_main
```

5. 如果不确定环境变量是否齐全，先运行预检：

```bash
cd web && npm.cmd run evidence:execution-monitor:real:preflight
```

6. 运行真实环境采样：

```bash
cd web && npm.cmd run evidence:execution-monitor:real
```

7. 检查真实环境 artifact：
   - `summary.json`
   - `frames.json`
   - `unauthorized-4401.json`
   - `forbidden-4403.json`

8. 在真实 control-plane websocket 环境下触发或等待：
   - hello frame
   - execution_log frame
   - node_heartbeat frame
9. 验证未授权连接仍返回 4401。
10. 验证越权租户连接仍返回 4403。
11. 保存截图和 frame 样本。
12. 给出最终结论：
   - `A-02 passed`
   - `A-02 blocked with reason`
   - `A-02 needs retry`

13. 对真实环境 artifact 运行签收判定：

```bash
cd web && npm.cmd run verify:a02:execution-monitor -- --artifact=web/test-results/execution-monitor-real-xxxx
```

如果命令输出 `passed: yes`，可以把生成的 `A02_SIGNOFF_*.md` 作为 A-02 签收附件。

## 4. A-02 签收模板

```text
A-02 Execution monitor real-environment verification
结论：pass / blocked / needs retry
执行环境：
执行时间：
QA：
稳定性负责人：
证据路径：
真实环境命令：
真实环境 artifact：
确认项：
- hello frame：
- execution_log frame：
- node_heartbeat frame：
- unauthorized 4401：
- forbidden 4403：
备注：
```

## 5. A-04 当前证据

已有 freeze signoff：

- `packages/lobsters/SKILLS_FREEZE_SIGNOFF_2026-04-14.md`

已冻结角色：

- `strategist`
- `inkwriter`
- `visualizer`
- `dispatcher`
- `catcher`
- `followup`

已确认内容：

- 统一运行时 + 角色协议红线保持。
- 角色边界、升级规则、输出契约稳定到足够用于 demo。
- 知识消费语义没有在 skills freeze 中被重新定义。
- freeze 没有改运行时执行逻辑。

当前结果：

- freeze signoff 已存在。
- 发布流程认可记录已补齐：`packages/lobsters/SKILLS_FREEZE_RELEASE_RECOGNITION_2026-04-17.md`
- A-04 已从 `watch` 变成 `passed`。

## 6. A-04 最终签收动作

如果 release scope 未来发生变化，Skills 负责人再执行：

1. 打开 `packages/lobsters/SKILLS_FREEZE_SIGNOFF_2026-04-14.md`。
2. 复核 freeze scope 是否仍是当前演示窗口需要的角色。
3. 重新补发布流程正式认可记录。
4. 向项目总控反馈：
   - `A-04 passed`
   - `A-04 still watch`
   - `A-04 blocked with reason`

## 7. A-04 签收模板

```text
A-04 Demo skills freeze recognition
结论：passed / still watch / blocked
Skills 负责人：
项目总控：
确认时间：
确认范围：
- strategist：
- inkwriter：
- visualizer：
- dispatcher：
- catcher：
- followup：
发布流程认可记录路径：
备注：
```

## 8. 从 CONDITIONAL GO 变成 GO 的条件

客户级对外交付从 `CONDITIONAL GO` 变成 `GO`，需要同时满足：

- A-02 给出 `passed`
- A-04 保持 `passed`
- `evidence:execution-monitor:real` 中 hello / execution_log / node_heartbeat / 4401 / 4403 均通过
- `verify:a02:execution-monitor` 对真实环境 artifact 输出 `passed: yes`
- 最新 `verify:closeout:frontend` 仍通过
- 没有新增 high-priority static issue
- 项目总控确认不再扩前端新功能

## 9. 不要误判

不要把下面情况误判成 blocker：

- 前端已经 GO，但 A-02 还没真实环境签收。
- Skills freeze 已签字且 A-04 发布流程认可已补；除非 release scope 变化，不再把 A-04 当作剩余 blocker。
- 本地 evidence 已齐，但客户级对外交付仍需要真实环境确认。

真正 blocker 只有：

- A-02 真实环境无法看到必要 frames 或鉴权关闭码错误。
- A-04 发布流程在后续 release scope 变化后拒绝 demo skills freeze。
- 前端 closeout 复跑失败并出现 high-priority issue。

## 10. 当前建议

项目总控现在应直接派发：

- QA：按本文件第 3 节执行 A-02。
- Skills 负责人：保持 A-04 记录；只有 release scope 变化时再重跑第 6 节。
- 稳定性负责人：跟踪 A-02 证据产物和 release gate。
- 前端补位工程师：不扩功能，仅等待真实展示 bug。

## 11. 最终判断

当前状态：

- 内部评审：GO
- 老板汇报：GO
- 前端收口：GO
- 学习闭环验收：GO
- 客户级对外交付：CONDITIONAL GO

关闭 A-02 后，客户级对外交付可以升级为：

> GO
