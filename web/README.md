# ClawCommerce 商家控制台（前端）

PRD v1.9 / v1.10：前端架构限制与 React Query 数据流规范。

**架构底线（v1.12）**：前端只允许请求后端 NestJS（`NEXT_PUBLIC_API_BASE_URL`），禁止直连 Agent。

## 技术栈

- Next.js 14 (App Router) + React 18
- Tailwind CSS
- TanStack Query v5
- Axios（仅限 `src/services/`）

## 目录结构

```
src/
├── components/
│   ├── ui/          # Skeleton, Button
│   ├── business/    # CampaignStatusBadge, LeadScoreTag
│   └── layouts/     # Sidebar, Header
├── hooks/
│   ├── queries/     # useDashboardMetrics, useCampaigns, useLeads
│   └── mutations/   # useCreateCampaign, useTerminateCampaign
├── services/
│   ├── api.ts       # Axios 实例 + JWT + 统一错误 Toast
│   ├── mock-data.ts # PRD v1.9 示例 Mock
│   └── endpoints/   # dashboard, campaign, lead
├── store/           # (可选) Zustand UI 状态
└── app/             # 路由与页面
```

## 启动

```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev
```

- **Mock 模式**：`NEXT_PUBLIC_USE_MOCK=true` 时使用 `services/mock-data.ts`，不请求后端。
- **联调**：设置 `NEXT_PUBLIC_API_BASE_URL` 为后端地址，并关闭 Mock。

## 规范（PM v1.10）

- 前端 100% 通过 `src/services/` 发起请求，禁止在组件内裸写 fetch/axios。
- 所有列表/大盘数据经 React Query hooks 获取，组件只消费 `data | isLoading | isError`。
- 加载态统一用 Skeleton；API 错误由 `api.ts` 响应拦截器触发全局 Toast。
