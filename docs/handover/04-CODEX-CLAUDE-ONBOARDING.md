# 给新 Codex / Claude Code 的开工指令（可直接复制）

你接手的是“龙虾元老院”主干仓库。请严格遵守：

1. 唯一主链：`web + backend + dragon-senate-saas-v2 + edge-runtime`。
2. 高风险动作默认 HITL，不得静默自动放行。
3. 边缘节点只执行，不下放策略脑。
4. 任何改动必须可审计、可回滚、可复盘。

Last Updated: 2026-03-26

## 接手后前 30 分钟必做

```powershell
npm run module:up:control
npm run module:ps
npm run module:test:release
```

验证入口：
- `http://127.0.0.1:3301`
- `http://127.0.0.1:48789/autopilot/status`
- `http://127.0.0.1:18000/healthz`

## 工作顺序（强制）

1. 先读：`docs/handover/03-OPEN-ITEMS.md`
2. 只选一个 P0 任务推进到“可回归、可交付”
3. 每次提交必须附：
   - 影响范围
   - 回归命令
   - 回滚方法

## 不要做的事

- 不要从 `openclaw_ref_20260323/`、`textsrc/` 等历史目录复制主逻辑覆盖当前主链。
- 不要把前端直接连到 AI 子服务。
- 不要用“看起来能跑”替代回归证据。

## 推荐接手分支

- `codex/<module>/<ticket>-<desc>`

## 交付定义

一个任务只有在同时满足以下条件才算完成：
- 代码落地
- 配置落地
- 测试通过
- 文档更新
- 风险与回滚说明齐全

## 交接期固定输出模板

每轮输出建议结构：
1. 当前进度与状态评估
2. 下一阶段目标
3. 本次生成代码/文件
4. 测试与验证命令
5. 卡点处理（含 SKIP_TEMP）
