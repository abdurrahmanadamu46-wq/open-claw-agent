# 05-PROGRESS-HIGHLIGHTS（交接速览）

Last Updated: 2026-03-26

## 一、当前进度（给接手团队）

- 主链路可运行：`web + backend + ai-subservice + postgres + redis + qdrant + ollama`
- 关键功能状态：
  - Auth/JWT：已完成
  - 多租户基础：已完成（仍有历史 tenant_demo 样例数据）
  - Industry KB：已完成基础链路（按行业检索/注入）
  - Senate Kernel：已完成模块化（治理/验证/记忆/回滚）
  - FollowUp 子龙虾并发：已完成 deterministic 编排与持久化
  - 支付：适配层完成，生产切真未收口

## 二、最容易踩坑点

1. Backend 探活不是 `/health`，用 `/autopilot/status`。
2. AI 探活是 `/healthz`，不是 `/health`。
3. 前端部分页面可能出现“展示态”，接手时要逐页确认数据来源。
4. 飞书回调必须先过 challenge，再开签名校验。
5. 外呼链路要先 canary，不允许直接全量。

## 三、建议接手顺序（1 周内）

- Day 1: 跑通并记录主链回归证据。
- Day 2-3: 支付切真预演（不放量）。
- Day 4: 飞书公网回调闭环。
- Day 5: 外呼 provider canary + 质量门槛。
- Day 6-7: 前端展示态清理与联动核对。

## 四、回归命令基线

```powershell
npm run module:up:control
npm run module:test:release
npm run contracts:validate
npm run backup:f:sync
```

## 五、当前收口建议
- 文档优先：所有跨模块变更必须同步 `PROJECT_STATE.md` + `docs/handover/03-OPEN-ITEMS.md`。
- 数据优先：页面必须绑定真实接口，禁止伪日志/伪 token/伪成本长期驻留。
- 风险优先：高风险自动化路径必须经过审批和审计落盘。
