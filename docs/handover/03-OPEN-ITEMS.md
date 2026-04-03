# 未收口清单（Open Items）
> 只保留真实可执行项，按优先级排序。状态：`OPEN` / `IN_PROGRESS` / `DONE_WAIT_VERIFY`。

Last Updated: 2026-03-29

0. `DONE_WAIT_VERIFY` 多租户注册表后端化
- 现状：前端 `TenantContext` 已从浏览器本地存储切到 backend Redis-backed tenant registry；注册流程会自动 ensure tenant 记录；`settings/tenants` 已改为真实后端租户源。
- 关键路径：`backend/src/tenant-profiles/tenant-registry.service.ts`、`backend/src/tenant-profiles/tenant-profiles.controller.ts`、`web/src/contexts/TenantContext.tsx`
- 待验证：接入真实团队账号后验证 admin / member 在租户页的权限差异与跨页同步表现。

## P0（商业化阻断）

1. `OPEN` 真实支付网关切真（Stripe/支付宝/微信）
- 现状：已补订单表、webhook 事件表、补偿任务、对账运行骨架，且已支持 sandbox checkout 与 trial activation；现已新增 `preflight_payment_provider.py` 与切真 runbook，但生产商户密钥和签约未入库。
- 关键路径：`dragon-senate-saas-v2/billing.py`、`dragon-senate-saas-v2/payment_gateway.py`、`dragon-senate-saas-v2/app.py`
- 收口标准：
  - 签名校验开启
  - webhook 幂等与重放防护通过
  - 对账 + 失败补偿 job 跑通

2. `DONE_WAIT_VERIFY` ICP/隐私合规材料自动打包
- 现状：已新增 `scripts/compliance/generate_icp_package.py`，可生成材料包、`manifest.json` 与 `AUDIT_SUMMARY.md`。
- 关键路径：`scripts/compliance/generate_icp_package.py`、`tmp/icp_materials/`
- 待验证：补齐线下主体/域名/授权材料后，确认交付包字段满足实际提交流程。

2.1 `OPEN` ICP 线下资料占位补齐
- 现状：已新增 `deploy/compliance/icp_launch_profile.template.json` 与 `scripts/compliance/validate_icp_profile.py`；当前校验仍有 11 个占位字段未填。
- 关键路径：`deploy/compliance/icp_launch_profile.template.json`
- 收口标准：主体、域名、联系人等占位字段全部替换为真实信息。

3. `OPEN` Feishu 公网回调切真
- 现状：本地链路可用；已补 `/integrations/feishu/status` 与 `/integrations/feishu/callback-readiness`，并新增 `12-FEISHU-CUTOVER-RUNBOOK.md`；公网 challenge/签名链路仍待收口。
- 关键路径：`dragon-senate-saas-v2/scripts/preflight_feishu_callback.py`、`dragon-senate-saas-v2/app.py`
- 收口标准：challenge 成功 + 签名校验通过 + 事件可回放。

4. `DONE_WAIT_VERIFY` 自助生命周期闭环（注册/登录/重置）
- 现状：统一控制面已提供 `/auth/register`、`/auth/login`、`/auth/forgot-password`、`/auth/reset-password`，并通过 backend JWT 统一接入控制台；重置通知默认写入文件 outbox。
- 路径：`backend/src/auth/session-auth.controller.ts`、`backend/src/ai-subservice/ai-subservice.service.ts`、`dragon-senate-saas-v2/user_auth.py`
- 待验证：切换真实 SMTP/短信后验证线上通知送达链路。

5. `OPEN` 真实 SMTP / 短信通知切真
- 现状：已新增通知中心，支持 `file / smtp / sms-mock` 模式，并提供 `/notifications/status`；现已新增 `preflight_notification_channels.py` 与切真 runbook；真实 SMTP/SMS 凭证未注入。
- 关键路径：`dragon-senate-saas-v2/notification_center.py`、`dragon-senate-saas-v2/user_auth.py`
- 收口标准：密码重置和关键通知在生产通道送达，且状态可观测。

## P1（稳定性与可运营）

6. `OPEN` 真实外呼供应商接入
- 现状：deterministic 子龙虾并发编排已完成；外呼执行仍是 mock adapter。
- 收口标准：小流量 canary 外呼 + 投诉率门槛 + 回放可追溯。

7. `DONE_WAIT_VERIFY` Research Radar 调度可靠性
- 现状：已补 `source health` 表、失败重试、24h SLO 汇总；`/research/source-health` 与日跑脚本均可读到健康度。
- 路径：`dragon-senate-saas-v2/research_radar_store.py`、`dragon-senate-saas-v2/app.py`、`dragon-senate-saas-v2/scripts/research_radar_daily*.py`
- 待验证：接入真实定时调度后观察 24h/72h 失败率与告警阈值。

8. `DONE_WAIT_VERIFY` ComfyUI 节点一键链路
- 现状：自动安装 + 版本锁定 + 健康检查 + 灰度开关脚本已落地。
- 缺口：真机全流程报告沉淀。
- 路径：`dragon-senate-saas-v2/scripts/comfy_nodes_oneclick.py`

## P2（体验与数据一致性）

9. `DONE_WAIT_VERIFY` 前端残余“展示态”清理
- 现状：`settings/billing`、`settings/team`、`settings/audit`、`help`、`fleet/phone-pool`、`ai-brain/studio` 已接入真实数据、真实页面或真实运营跳转；新增 `landing/pricing/faq/legal/*` 公共站点页，`pricing` 支持自助 trial / sandbox checkout，`settings/commercial-readiness` 提供集中 readiness 总览，dashboard 与 onboarding 已接入 launch-readiness 入口。
- 收口标准：卡片/日志/图表全部来自后端或显式空态。

10. `DONE_WAIT_VERIFY` UTF-8 历史乱码专项
- 现状：已新增 `scripts/quality/scan_utf8.py`，并在 `.github/workflows/mainline-gate.yml` 中加入 non-blocking 巡检步骤。
- 待验证：按目录分批修复历史乱码文件，观察 CI 输出稳定性。

11. `IN_PROGRESS` Trace/巡检策略页面 UX 与真实联动
- 现状：Trace 页已具备滚轮日期选择、审批轮询、KB 命中明细；巡检页仍主要是本地策略编排视图，待继续接真。
- 收口标准：深色主题一致、日期可滚动可选、全量联动真实数据。

## 本次实测结果
1. `PASS` backend `build`
2. `PASS` backend `week3-contract-tests`
3. `PASS` backend `client-update-tests`
4. `PASS` backend `activation-device-tests`
5. `PASS` web `tsc --noEmit`
6. `PASS` web production `next build`
7. `PASS` Research Radar in-process regression
8. `PASS` UTF-8 scan（0 failures）
9. `PASS` ICP/compliance package generation
10. `PASS` client-update chain simulation
11. `PASS` web live release E2E：`login -> dashboard -> campaign create -> fleet dispatch -> leads reveal`
12. `PASS` backend auth proxy tests
13. `PASS` AI auth password reset in-process test
14. `PASS` billing commercialization in-process test
15. `PASS` public pricing self-service actions compiled into production build
16. `PASS` commercial readiness page compiled into production build
17. `PASS` notification test/outbox flow compiled into production build
18. `EXPECTED_BLOCKER` ICP validator reports unresolved offline placeholders until legal/domain inputs are provided
19. `PASS` commercial readiness in-process regression
20. `PASS` payment preflight script returns precise live-cutover blockers on `.env.example`
21. `PASS` notification preflight script returns precise live-cutover blockers on `.env.example`
22. `PASS` Feishu preflight script returns precise callback-domain blocker on `.env.example`
23. `PASS` dashboard / onboarding / commercial-readiness pages compile into production build with launch-readiness UI
24. `PASS` web production `next build` now runs without current lint/type warnings after hook dependency and image cleanup
25. `PASS` Patrol page rewritten with clean copy and launch-readiness context, and compiles into production build
26. `PASS` safe user cache cleanup script added and executed; pip/npm/crashdump/temp cache footprint reduced while `.ollama` remained intentionally untouched
27. `PASS` backend tenant registry build + auth proxy + tenant registry regression
28. `PASS` frontend tenant context switched to backend registry and `settings/tenants` compiles in production build
29. `PASS` mainland-first deployment profile template added at `deploy/env/cn-shanghai.env.example`
30. `PASS` ToolTree-lite planner landed in `campaign_graph.py` with selected/rejected branch trace output
31. `PASS` role memory / campaign memory / winning playbook folding landed and verified in-process
32. `PASS` kernel metrics dashboard now exposes autonomy metrics and risk-family aggregation
33. `PASS` Trace / Log Audit pages compile with risk family and autonomy context
34. `PASS` `.ollama` and `ms-playwright` migrated to `F:` with junction preservation; workspace hot backup synced to `F:\openclaw-agent\workspace`
35. `SKIP_TEMP` live workspace junction switch and Docker WSL data migration deferred to maintenance window to avoid breaking the active session
36. `PASS` starter kit generation for new industries landed in-process and is exposed through onboarding
37. `PASS` mainland-first defaults now exist in both `deploy/env/cn-shanghai.env.example` and main `dragon-senate-saas-v2/.env.example`
38. `PASS` mobile approval loop landed across HITL push fanout, backend approval APIs, and the mobile web page
39. `PASS` client-center rewritten into a real control page and mobile approvals now link back to Trace
40. `PASS` backend HITL proxy regression added and passing
41. `PASS` client-mobile deep-link filter by `approval_id` compiles and works with production build
42. `PASS` TrinityGuard-style monitor rules and rollback preset now surface in kernel report / Trace UI
43. `PASS` Aoto Cut integration prep completed with contract module, package ingestion endpoints, and boundary document
44. `PASS` Commander/TG integration prep completed with async run-dragon-team contract and proxy regression
45. `PASS` AI child service now exposes async run-dragon-team submit/status endpoints verified in-process
46. `PASS` strategy center now exposes async commander submit/status UI and compiles in production build
47. `PASS` kernel risk alerts endpoint and alert page section landed with in-process verification
48. `PASS` unified sub-domain architecture framework exported as standalone document for future subproject integration
49. `PASS` thread-oriented 10 subproject coordination contract exported
50. `PASS` machine-readable subproject registry manifest exported

## 本周建议执行顺序（新团队）
1. P0-支付切真预演（不放量）。
2. P0-飞书公网回调闭环。
3. P1-外呼 canary。
4. P2-前端展示态清理+Trace 页收口。
