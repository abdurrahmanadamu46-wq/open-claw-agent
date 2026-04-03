# 燎原引擎（Liaoyuan OS）全流程落地手册

版本: v1.0  
用途: 将白皮书叙事转为可执行工程流程（研发、测试、运维、发布统一对齐）

---

## 1. 术语到工程模块映射

| 白皮书术语 | 工程实体 | 当前代码位置 |
|---|---|---|
| 燎原引擎 / 龙虾深海协议 | 云边分布式系统 + 任务协议 + 调度总线 | `backend/src/gateway/*`, `backend/src/autopilot/*`, `src/agent/*` |
| 星火客户端（Spark Client） | 边缘执行器（PC/Android） | 外部客户端（通过 `/fleet` 或 `/lobster` 接入） |
| 虾粮（Lobster Feed） | 算力结算与信誉体系（待接入） | 建议新增 `backend/src/billing/*` |
| 超级海港（Super Harbor） | 多租户 SaaS 控制台 + 中控后端 | `web/*` + `backend/*` |
| 龙虾舰队出海 | 批量分布式任务 | `backend/src/autopilot/workers/*`, `src/agent/node-manager.ts` |

---

## 2. 8 个 AI Agent 与流水线对照

| 元老院角色 | 工程职责 | 流水线阶段 | 状态 |
|---|---|---|---|
| 触须虾 Radar | 竞品数据抓取/聚合 | `radar_sniffing_queue` | 已有骨架 |
| 脑虫虾 Strategist | 策略分析与参数路由 | Radar 后置分析层 | 需补独立模块 |
| 吐墨虾 Ink Writer | 文案/脚本结构化输出 | `content_forge_queue` | 已有骨架 |
| 幻影虾 Visualizer | 多模态提示词转换 | content_forge 子步骤 | 需补明确接口 |
| 点兵虾 Dispatcher | 任务拆分与节点派发 | `matrix_dispatch_queue` | 已有骨架（下发待实装） |
| 回声虾 Echoer | 评论互动生成 | 分发后互动引擎 | 待补 |
| 铁网虾 Catcher | 意图识别/高意向拦截 | lead 过滤中间层 | 待补 |
| 金算虾 Abacus | 线索评分与 webhook 推送 | `lead_harvest_queue` + integrations | 骨架已在 |

---

## 3. 端到端主流程（业务视角）

```mermaid
flowchart LR
  A["超级海港（Web）创建任务"] --> B["Backend 接收 Campaign"]
  B --> C["元老院流水线：Radar -> Strategist -> Ink -> Visualizer"]
  C --> D["Dispatcher 拆分 Job Payload"]
  D --> E["WSS Dispatch Hub 定向下发到星火客户端"]
  E --> F["边缘端执行 RPA + 防检测策略"]
  F --> G["任务进度/结果回传"]
  G --> H["Catcher 意图识别 + Abacus 评分推送 CRM"]
  H --> I["Web 大盘回显 + 虾粮结算"]
```

---

## 4. 技术链路（工程视角）

1. Web 统一调用 backend:
   - `web/src/services/*` 仅通过 `NEXT_PUBLIC_API_BASE_URL` 调 `/api/v1/*`。
2. Backend 统一编排:
   - 控制器接入鉴权和租户隔离。
   - Autopilot 队列串联任务阶段。
3. Agent Runtime 负责执行态:
   - 节点分配、回收、健康检查、状态机维护。
4. Edge 仅执行，不决策:
   - 动态接收 SOP payload，不固化业务逻辑。

---

## 5. 任务状态机与补偿策略（强约束）

标准状态流:

`Pending -> Executing -> Ack -> Completed | Failed | ReRouted | Canceled`

补偿规则:

1. `Pending` 超时未 Ack:
   - 立即触发重派发到同租户健康节点。
2. `Executing` 中断线:
   - 进入 `ReRouted` 并记账一次失败重试。
3. 超过最大重试:
   - 进入死信队列并通知人工处理。

关键要求:

1. 每个任务必须持有幂等键:
   - `tenantId:campaignId:taskId:nodeId`
2. 每个状态迁移必须记录:
   - `traceId`, `operator`, `timestamp`, `reason`

---

## 6. 防作弊探针流程（Telemetry & Anti-Cheat）

客户端探针采集:

1. 设备指纹: MAC、CPU 温度波动、运行特征。
2. 行为轨迹: 鼠标贝塞尔曲线、人类输入节律。
3. 网络可信度: 真实住宅 IP 与代理一致性检查。

云端判定策略:

1. 风险评分低于阈值:
   - 正常发放虾粮并可参与调度。
2. 风险评分高于阈值:
   - 限流、隔离、冻结结算、进入人工复核池。

---

## 7. OTA 热更新流程（RPA 逻辑云端注入）

1. 云端维护脚本仓库:
   - DOM 选择器、XPath、点击坐标、反检测参数模板。
2. 任务下发时动态注入:
   - Edge 客户端只解释执行，不持久保存业务规则。
3. 版本与回滚:
   - 每次脚本更新有 `payload_version`，支持按租户回滚。
4. 故障保护:
   - 新脚本灰度失败自动回退上一版本。

---

## 8. 四周执行节奏（与现有清单对齐）

1. Week 1:
   - 安全与可靠性底座（鉴权、幂等、DLQ、内部签名）。
   - 文档: `docs/phase-d-week1-execution-checklist.md`
2. Week 2:
   - 可观测与告警（trace/log/SLI/告警联动）。
   - 文档: `docs/phase-d-week2-execution-checklist.md`
3. Week 3:
   - 前端生产化收口与全链路联调。
   - 文档: `docs/phase-d-week3-execution-checklist.md`
4. Week 4:
   - 发布治理、灰度、回滚、值班体系。
   - 文档: `docs/phase-d-week4-execution-checklist.md`

---

## 9. 统一交付入口与出口

开发入口:

1. 从周清单任务 ID 开工（D1/D2/D3/D4/D5）。
2. 每项任务必须附带:
   - 变更文件
   - 验收标准
   - 自动化测试

上线出口:

1. 通过性能、稳定性、安全性三大门禁。
2. 灰度 7 天稳定。
3. 回滚演练通过。
4. 值班手册完成并交接。

---

## 10. 当前仓库建议下一步（立即执行）

1. 先完成 Week 1 的所有 P0。
2. 并行启动 Week 2 的 trace/log 结构字段统一，避免后续返工。
3. 在 Week 3 前冻结前端 mock 扩散，所有新页面必须走真实 API 或明确 demo 开关。

