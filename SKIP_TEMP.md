# SKIP_TEMP

Last Updated: 2026-03-26

## [SKIP_TEMP] Real payment merchant credentials/contracts
- Blocker: 生产 Stripe/支付宝/微信商户密钥与签约证书不在仓库。
- Impact: 支付主链可跑，但未完成生产切真。
- Workaround: 保持 provider adapter + mock/测试 provider，并保留切真开关。
- Cutover:
  1. 注入真实证书与密钥。
  2. 打开 webhook 签名和幂等校验。
  3. 运行对账/补偿回归并灰度放量。

## [SKIP_TEMP] ICP filing legal materials
- Blocker: 备案主体、域名实名、授权文件属于线下法务资产。
- Impact: 代码可生成模板，不能替代正式提交。
- Workaround: 保留备案材料模板和清单。
- Cutover:
  1. 补齐主体材料。
  2. 生成备案包并提交流程。

## [SKIP_TEMP] Feishu public callback closure
- Blocker: 公网域名回调链路未完全闭环（DNS/HTTPS/challenge/signature）。
- Impact: 本地可用，公网事件订阅不稳定。
- Workaround: 使用 `preflight_feishu_callback.py` 做前置诊断。
- Cutover:
  1. 域名解析与 HTTPS 完整生效。
  2. challenge 验证通过。
  3. 启用并验证签名校验。

## [SKIP_TEMP] Production telephony provider
- Blocker: 真实 SIP/WebRTC 外呼供应商密钥与资质未入库。
- Impact: 子龙虾并发编排已可用，但外呼执行层仍待切真。
- Workaround: 保持 deterministic 编排 + 持久化 + 审计可回放。
- Cutover:
  1. 配置 provider。
  2. 按 tenant/channel/% 做 canary。
  3. 通过质量与投诉门槛后全量。

## [SKIP_TEMP] Unverified free/unlimited external model sources
- Blocker: 第三方“免费无限流量”来源 SLA 与合规条款未验真。
- Impact: 不允许进入生产核心路由。
- Workaround: 沙箱灰度，非默认。
- Cutover:
  1. 验证稳定性和条款。
  2. 接入监控和熔断策略。
  3. 达标后纳入正式路由。

## [SKIP_TEMP] Full-repo UTF-8 historical cleanup
- Blocker: 仓库历史文件体量大且包含历史脏编码内容。
- Impact: 新增文件已 UTF-8，但历史包袱仍影响协作体验。
- Workaround: 先保证新增/修改文件编码干净，按模块分批清理历史文件。
- Cutover:
  1. 加编码巡检脚本。
  2. 在 CI 以 non-blocking 方式跑巡检。
  3. 按目录分批修复并回归。
