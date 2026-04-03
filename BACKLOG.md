# BACKLOG

Last Updated: 2026-03-29
Execution Principle: high ROI + low external dependency first.

## P0（商业化阻断）

1. 真实支付切真（Stripe/支付宝/微信）
2. Feishu 公网回调闭环（challenge + signature）
3. 真实邮件 / 短信通知切真（用于 password reset / onboarding）
4. ICP 线下主体与域名材料补齐并最终提交流程演练
5. 将 trial / sandbox checkout / compensation / readiness 接入更多运营视图与 dashboard 入口
6. 商业化就绪度看板继续扩展到 dashboard / onboarding / ops 入口
7. 用新增 `preflight:payment` / `preflight:notifications` / `preflight:feishu` 脚本完成三条切真彩排
8. 把 `deploy/env/cn-shanghai.env.example` 进一步并入主 `.env.example` / compose 默认项
状态：已并入主 `dragon-senate-saas-v2/.env.example`，后续可继续扩到更多部署脚本

## 子域对接

1. Aoto Cut 内容生产子域
状态：已补标准对象契约、handoff package 接口和集成文档；主仓不再重复建设其内容生产页面与内部对象模型
2. Commander / TG 指挥子域
状态：已补异步 submit/status 主通道、proxy 回归、控制面入口和集成文档；主仓不重复建设其编排层、TG 终端和模型绑定策略

## P1（稳定与运营）

1. 外呼 provider 真接入 + canary 策略
2. ComfyUI 真机报告沉淀与回滚SOP
3. Trace / Patrol 页进一步接入更多真实后端状态
4. 历史 lint warning 分批收口
5. Kernel autonomy metrics dashboard
状态：已落地首版后端聚合与 Trace 展示，下一步补更细的审批延迟来源与更多运营页入口
6. TrinityGuard-style risk taxonomy
状态：已落地 `single_agent / inter_agent / system_emergent` 分类、monitor rules、rollback preset 和 kernel alerts，看板已可见；下一步补自动化处置策略
7. Synthetic industry task generation
状态：已落地首版 starter kit 生成/验证/持久化与 onboarding 入口，下一步补更多行业 explorer 信号和模板联动
8. Mobile approval loop
状态：已落地首版 HITL 推送、多端审批 API、mobile web fallback、trace 跳转与真实 client-center 视图，下一步补真实 Feishu/DingTalk 生产卡片与更丰富事件类型

## P2（体验收口）

1. 前端“展示态”逐页清理为真实联动
2. Trace/巡检策略页交互优化（深色主题+可滚动日期）
3. RAG/技能池页面数据联动审计

## P3（分发与交付）

1. 桌面安装包签名更新链全流程
2. Runtime sandbox 策略矩阵治理
3. 大陆部署加速文档（cn-shanghai + 镜像）

## 新团队接手第一单

1. 跑起主链并保留证据。
2. 从 P0 选 1 项推进到“可回归可回滚”。
3. 同步更新 `docs/handover/03-OPEN-ITEMS.md` 与状态文件。

## 路线图已落地

1. ToolTree-lite Planner 已落到 `dragon-senate-saas-v2/campaign_graph.py`
2. Role-aligned memory and memory folding 已落到 `dragon-senate-saas-v2/memory_governor.py` 与 `dragon-senate-saas-v2/senate_kernel.py`
3. Autonomy metrics 与 risk family taxonomy 已落到 `memory_governor.py`、`app.py` 与控制面 Trace/Log Audit
4. Synthetic industry starter tasks 已落到 `industry_starter_kit.py`、`app.py` 与 onboarding 页面
5. Mobile approval loop 已落到 `app.py`、backend ai-subservice 代理与 `web/src/app/client-mobile/page.tsx`
