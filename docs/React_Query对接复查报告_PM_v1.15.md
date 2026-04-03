# ClawCommerce React Query 对接复查报告 (PM v1.15)

> 小军侧前端与后端 API 的对接状态复查，确保 E2E 跑通后 MVP 界面一把点亮，并满足 Demo 录屏 SOP 四幕。

---

## 一、全局与契约

| 项目 | 状态 | 说明 |
|------|------|------|
| **唯一 HTTP 出口** | ✅ | 所有请求经 `web/src/services/api.ts` 的 axios 实例，baseURL 仅指后端，禁止直连 Agent |
| **PRD v1.9 错误码** | ✅ | 40001/40101/40301/50001 在响应拦截器中映射 Toast + 401 强踢登录 |
| **JWT** | ✅ | 请求头从 `localStorage.getItem('clawcommerce_token')` 注入 Authorization |

---

## 二、React Query 与 Endpoints

| 能力 | Hook | Endpoint | 复查结论 |
|------|------|----------|----------|
| 大盘 | `useDashboardMetrics` | `GET /api/v1/dashboard/metrics` | queryKey `['dashboard','metrics']`，staleTime 5min，页面消费 total_leads_today / leads_growth_rate / active_campaigns / node_health_rate / chart_data_7days ✅ |
| 任务列表 | `useCampaigns(page, status)` | `GET /api/v1/campaigns` | queryKey 含 page/status，筛选与分页正确；终止后 invalidateQueries ✅ |
| 创建任务 | `useCreateCampaign` | `POST /api/v1/campaigns` | CreateCampaignPayload 与契约一致，onSuccess 刷新任务列表 ✅ |
| 终止任务 | `useTerminateCampaign` | `POST /api/v1/campaigns/:id/terminate` | 调用正确；运行中状态（含 SCRAPING/GENERATING）均显示「终止」✅ |
| 线索列表 | `useLeads(page, intentScoreMin)` | `GET /api/v1/leads` | queryKey 含 page/intentScoreMin，列表展示脱敏 contact_info ✅ |
| 查看完整联系方式 | `useRevealLead` | `GET /api/v1/leads/:id/reveal` | 已接：弹窗展示明文 + 绿色「Audit Log Recorded」提示 ✅ |

---

## 三、本次补齐与调整

1. **线索页「查看完整联系方式」**  
   新增 `useRevealLead` mutation，线索表增加「操作」列与按钮；点击后弹窗请求 reveal 接口，展示明文联系方式及「Audit Log Recorded（已记录安全审计）」绿色标签，满足 Demo 第四幕。

2. **任务状态 Badge**  
   `CampaignStatusBadge` 已支持 SCRAPING、GENERATING、MONITORING、PUBLISHING、PENDING、COMPLETED、TERMINATED，双屏联动时状态变色正确。

3. **终止按钮展示逻辑**  
   由「仅 PUBLISHING/PENDING」改为「非 COMPLETED/TERMINATED」即显示终止，与后端/Agent 状态机一致。

---

## 四、Demo 四幕与页面对应

| 幕 | 要求 | 前端对应 |
|----|------|----------|
| 第一幕 | Dashboard 大盘、今日线索、活跃任务、节点健康度 | `/` 页，4 张卡片 + 近 7 天趋势图 |
| 第二幕 | 新建任务：行业 + 3 条链接 + 策略 + 立即启动 | `/campaigns` 需有「新建任务」入口与表单（若当前仅有列表，需补创建表单页或入口） |
| 第三幕 | 任务列表状态 PENDING→SCRAPING→GENERATING + Agent 终端日志 | 列表与 Badge 已支持上述状态；录屏时切双屏 |
| 第四幕 | 线索列表、脱敏、查看完整联系方式、Audit 提示 | `/leads` 已实现列表 + 脱敏 + 弹窗明文 + 绿色审计提示 |

**待确认**：第二幕「新建任务」若尚无独立创建页，需在 campaigns 页增加创建入口与表单（industry_template_id、target_urls、content_strategy、立即启动），与 `useCreateCampaign` 对接。

---

## 五、E2E 脚本与下一步

- **无头 E2E**：`npm run e2e`（`scripts/test-e2e.ts`）已就绪，需后端 + Agent 齐备且配置 E2E_JWT / E2E_TENANT_ID / INTERNAL_API_SECRET 后一次性跑通。
- **建议**：优先跑通 E2E 再点亮 MVP UI；部署清单（Docker Compose / 环境变量）可与小明/DevOps 在准备测试服时一起产出，或由小军按当前架构先出一版草稿供评审。

---

**复查人**：小军（前端+Agent）  
**文档版本**：v1.15，与 PM 商业化 Demo SOP 对齐
