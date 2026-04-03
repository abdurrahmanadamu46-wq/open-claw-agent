# 龙虾元老院交接入口（Start Here）
> 目标：让新的 Claude Code / Codex 团队在 **30 分钟内** 跑起主链路，并明确“已完成、待收口、不可踩线”。

Last Updated: 2026-03-26 (Asia/Shanghai)

## 0. 先确认你在正确目录
```powershell
cd C:\Users\Administrator\Desktop\openclaw-agent
```

## 1. 先读这 7 份文档（按顺序）
1. `docs/handover/00-START-HERE.md`
2. `docs/handover/01-REPO-MAP.md`
3. `docs/handover/02-RUN-AND-VERIFY.md`
4. `docs/handover/03-OPEN-ITEMS.md`
5. `docs/handover/04-CODEX-CLAUDE-ONBOARDING.md`
6. `docs/handover/05-PROGRESS-HIGHLIGHTS.md`
7. `docs/handover/06-OPS-RUNBOOK.md`

## 2. 当前唯一主线（必须遵守）
- 控制面：`web + backend`
- AI 子服务：`dragon-senate-saas-v2`（下游服务，不是平行产品）
- 边缘执行：`edge-runtime`（执行器，不下放策略脑）

## 3. 一键启动（推荐）
```powershell
npm run module:up:control
npm run module:ps
```

## 4. 当前可用测试入口（2026-03-26）
- Web 控制台：`http://127.0.0.1:3301`
- 登录页：`http://127.0.0.1:3301/login`
- Backend 状态：`http://127.0.0.1:48789/autopilot/status`
- AI 子服务文档：`http://127.0.0.1:18000/docs`
- AI 健康检查：`http://127.0.0.1:18000/healthz`

本地默认账号（开发环境）：`admin / change_me`

## 5. 发版门禁（唯一真门禁）
- Workflow：`.github/workflows/mainline-gate.yml`
- Required checks：
  - `contracts`
  - `week3-e2e-live`

## 6. 商业化完成度（证据驱动）
- 评分口径见：`COMMERCIALIZATION_SCORE.md`
- 最新结果：**69 / 100**

## 7. 红线（必须遵守）
1. 高风险动作默认 HITL，不允许默认自动放行。
2. 边缘节点只执行，不拥有策略脑。
3. 关键动作必须可审计、可回滚、可复盘。
4. 未验真的“免费/无限流量”来源不得进生产主链路。
5. 新模型/插件接入必须先走沙箱与灰度。

## 8. 新人首日执行（直接照做）
```powershell
npm run module:up:control
npm run module:test:release
npm run contracts:validate
npm run backup:f:sync
```

通过标准：
- 5 个入口可访问。
- 登录+受保护 API 调用通过。
- release 回归成功且有输出记录。
