# ClawCommerce PRD v1.10 前端架构与交付说明

> 前端架构限制与 React Query 数据流规范 — 已按规范在 `web/` 落地。

---

## 一、核心铁律

- **前端 100% 为“笨傀儡”**：无过滤逻辑、无数据统计、无状态机、无裸 fetch/axios。
- 所有数据经 **src/services/** 封装，所有状态经 **TanStack Query** 接管。

---

## 二、已实现结构（web/）

| 路径 | 说明 |
|------|------|
| **services/api.ts** | Axios 实例、JWT 拦截器、统一错误 Toast（PRD v1.9 错误码 40001/40101/40301/50001） |
| **services/endpoints/** | dashboard.ts、campaign.ts、lead.ts（对应 GET/POST 接口） |
| **services/mock-data.ts** | PRD v1.9 示例 Mock，`NEXT_PUBLIC_USE_MOCK=true` 时启用 |
| **hooks/queries/** | useDashboardMetrics、useCampaigns、useLeads |
| **hooks/mutations/** | useCreateCampaign、useTerminateCampaign |
| **components/ui/** | Skeleton、Button |
| **components/business/** | CampaignStatusBadge、LeadScoreTag |
| **components/layouts/** | Sidebar、Header |
| **app/** | layout（Sidebar+Header+Providers）、page（大盘）、campaigns/page、leads/page |

---

## 三、数据流示例

1. **步骤 A**：`services/endpoints/campaign.ts` 定义 `fetchCampaigns(page)`，内部使用 `api.get`；Mock 模式下返回 `mock-data`。
2. **步骤 B**：`hooks/queries/useCampaigns.ts` 使用 `useQuery({ queryKey: ['campaigns', page], queryFn: () => fetchCampaigns(...) })`。
3. **步骤 C**：页面仅调用 `useCampaigns(1)`，根据 `data | isLoading | isError` 渲染表格或 Skeleton/ErrorAlert。

---

## 四、启动与联调

- `cd web && npm install && npm run dev`
- Mock：`.env.local` 中 `NEXT_PUBLIC_USE_MOCK=true`，无需后端即可看大盘/任务/线索页。
- 联调：`NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`，关闭 Mock，由小明后端提供 PRD v1.9 接口。

---

## 五、与小明后端的对接

- 前端仅调用小明提供的 `GET /api/v1/dashboard/metrics`、`GET/POST /api/v1/campaigns`、`GET /api/v1/leads`、`GET /api/v1/leads/:id/reveal`、`POST /api/v1/campaigns/:id/terminate`。
- 响应格式遵循 PRD v1.9（code、data、message）；错误码由 api 拦截器统一弹 Toast。
