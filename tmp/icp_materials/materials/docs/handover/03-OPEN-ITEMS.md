# 未收口清单（Open Items）
> 只保留真实可执行项，按优先级排序。状态：`OPEN` / `IN_PROGRESS` / `DONE_WAIT_VERIFY`。

Last Updated: 2026-03-26

## P0（商业化阻断）

1. `OPEN` 真实支付网关切真（Stripe/支付宝/微信）
- 现状：适配层已完成，业务主链可跑；生产商户密钥和签约未入库。
- 关键路径：`dragon-senate-saas-v2/billing.py`、`dragon-senate-saas-v2/payment_gateway.py`
- 收口标准：
  - 签名校验开启
  - webhook 幂等与重放防护通过
  - 对账 + 失败补偿 job 跑通

2. `OPEN` ICP/隐私合规材料自动打包
- 现状：模板有，自动打包与提交流程未闭环。
- 关键路径：`docs/`、`deploy/`
- 收口标准：可一键生成备案材料包并附审计摘要。

3. `OPEN` Feishu 公网回调切真
- 现状：本地链路可用，公网 challenge/签名链路仍待收口。
- 关键路径：`dragon-senate-saas-v2/scripts/preflight_feishu_callback.py`
- 收口标准：challenge 成功 + 签名校验通过 + 事件可回放。

## P1（稳定性与可运营）

4. `OPEN` 真实外呼供应商接入
- 现状：deterministic 子龙虾并发编排已完成；外呼执行仍是 mock adapter。
- 收口标准：小流量 canary 外呼 + 投诉率门槛 + 回放可追溯。

5. `OPEN` Research Radar 调度可靠性
- 现状：A/B/C 拉取 + 排序 + 摘要已就绪。
- 缺口：失败重试、SLO、source health telemetry。
- 收口标准：日报成功率可观测可告警。

6. `DONE_WAIT_VERIFY` ComfyUI 节点一键链路
- 现状：自动安装 + 版本锁定 + 健康检查 + 灰度开关脚本已落地。
- 缺口：真机全流程报告沉淀。
- 路径：`dragon-senate-saas-v2/scripts/comfy_nodes_oneclick.py`

## P2（体验与数据一致性）

7. `OPEN` 前端残余“展示态”清理
- 现状：多数页面已接真实接口，仍需逐页排查无意义展示项。
- 收口标准：卡片/日志/图表全部来自后端或显式空态。

8. `OPEN` UTF-8 历史乱码专项
- 现状：handover 文档已修复；仓库历史文件仍有乱码。
- 收口标准：新增编码巡检脚本 + CI 非阻断检查。

9. `OPEN` Trace/巡检策略页面 UX 与真实联动
- 现状：用户反馈日期选择器、状态联动、信息密度仍需优化。
- 收口标准：深色主题一致、日期可滚动可选、全量联动真实数据。

## 本周建议执行顺序（新团队）
1. P0-支付切真预演（不放量）。
2. P0-飞书公网回调闭环。
3. P1-外呼 canary。
4. P2-前端展示态清理+Trace 页收口。
