# Knowledge Context QA Runbook

最后更新：2026-04-17

## 目的

这份 runbook 用来验证 OpenClaw 的三层知识边界是否真的被运行时消费：

1. `platform_common`
2. `platform_industry`
3. `tenant_private`

同时要求验证下面三条红线仍然成立：

- 原始 `group-collab trace` 不进入 `platform_common`
- 原始 `group-collab trace` 不进入 `platform_industry`
- 只有脱敏后的 `tenant_private` 摘要可以进入运行时知识上下文

## 适用对象

- QA
- AI 收尾总指挥
- 项目总控
- 后端工程师
- 知识库优化负责人

## 一键命令

### 1. 快速验证：只看知识上下文，不跑长图

适合场景：
- 想快速确认服务是否能起来
- 想确认 `knowledge_context` 注入链是否正常
- 想确认 `tenant_private` 是否能被带进运行时

命令：

```bash
cd web
npm run evidence:knowledge-context:local:context
```

结果：
- 会自动拉起本地 Python SaaS 运行时
- 会自动拉起本地 Nest backend
- 会自动生成一条 `tenant_private` 摘要
- 会跑一次 `knowledge_context_only` 证据请求
- 跑完自动清理进程

### 2. 完整验证：跑真实 `run-dragon-team`

适合场景：
- 要做阶段签收
- 要证明完整长图执行时也真的消费了三层知识
- 要给总工程师交付最终证据包

命令：

```bash
cd web
npm run evidence:knowledge-context:local
```

结果：
- 会自动拉起本地 Python SaaS 运行时
- 会自动拉起本地 Nest backend
- 优先走真实协作流 `dispatch + inbound approval`
- 生成 `tenant_private` 脱敏摘要
- 跑一次完整 `runtime_evidence`
- 跑完自动清理进程

## 成功标准

打开生成的 `REPORT.md` 和 `summary.json`，至少要看到：

- `run-dragon-team responded = yes`
- `platform_common present = yes`
- `platform_industry present = yes`
- `tenant_private layer present = yes`
- `raw group-collab traces excluded = yes`
- `tenant_private summary only = yes`
- `platform backflow blocked = yes`

如果本次启用了 seed，还应该看到：

- `tenant_private nonzero when seeded = yes`
- `tenant_private > 0`

## 证据文件位置

所有证据都落在：

```text
F:/openclaw-agent/web/test-results/
```

常见目录：

- `knowledge-context-local-*`
- `knowledge-context-real-*`

重点文件：

- `REPORT.md`
- `summary.json`
- `knowledge-context.json`
- `tenant-private-seed.json`
- `preflight.json`

## 如何读报告

### `Mode`

- `preflight_only`
  只验证 auth/run 路由是否挂出来，不验证运行时知识消费
- `knowledge_context_only`
  只验证知识上下文注入，不跑长图
- `runtime_evidence`
  跑真实 `run-dragon-team`

### `Seed strategy`

- `collab_dispatch`
  说明 tenant private 摘要是通过真实协作流生成的
- `manual_summary_fallback`
  说明真实协作流失败，脚本退回到管理员写入的脱敏摘要

签收时优先接受：

- `mode = runtime_evidence`
- `seed_strategy = collab_dispatch`

### `tenant_private`

- `0`
  说明当前没有私有摘要被注入
- `1+`
  说明至少一条脱敏摘要进入了运行时知识上下文

## 失败时怎么判断

### 情况 1：auth 或 run endpoint 是 404

结论：
- 后端路由没挂好

先找：
- 后端工程师

### 情况 2：`run-dragon-team` 超时

结论：
- 可能卡在 Python 长图执行
- 也可能卡在 provider / Redis / 外部依赖

先看：
- `preflight.json`
- `run-dragon-team-response.json`
- backend / python stdout/stderr 日志

### 情况 3：`tenant_private = 0`

结论：
- 没有摘要被写入
- 或者运行时没读到摘要

先看：
- `tenant-private-seed.json`
- `knowledge-context.json`

如果 `tenant-private-seed.json` 里 `seedStrategy = collab_dispatch` 且 `summaries.total > 0`，但 `knowledge-context.json` 里还是 `tenant_private = 0`，优先找：
- 知识库优化负责人
- 后端工程师

## 当前推荐签收顺序

1. 先跑 `npm run evidence:knowledge-context:local:context`
2. 再跑 `npm run evidence:knowledge-context:local`
3. 最后看 `REPORT.md`

如果两步都 pass，就可以认定：

- 三层知识边界已真实接入运行时
- `tenant_private` 摘要已可被真实消费
- 原始协作正文未越权进入平台层

## 当前已知通过样本

完整长图通过样本：

- `F:/openclaw-agent/web/test-results/knowledge-context-real-2026-04-17T06-33-26-088Z`

本地一键包装样本：

- `F:/openclaw-agent/web/test-results/knowledge-context-local-2026-04-17T08-40-07-846Z`

整包 release gate 样本：

- `F:/openclaw-agent/web/test-results/release-gate-local-2026-04-17T08-38-28-478Z`

关键结果：

- `mode = runtime_evidence`
- `seed_strategy = collab_dispatch`
- `platform_common = 2`
- `platform_industry = 2`
- `tenant_private = 2`
