# SuperHarbor — 超级海港

大 B 端控制台 · 燎原引擎 (Liaoyuan OS) 全域分布式调度架构前端 MVP。

## 技术栈

- **Next.js 14** (App Router)
- **Tailwind CSS** + 类 shadcn/ui 组件
- **Zustand** 状态管理
- **Lucide Icons**

## 目录结构

```
superharbor/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # 根布局 + 侧栏
│   │   ├── page.tsx           # 重定向 /dashboard
│   │   ├── globals.css
│   │   ├── dashboard/         # 总览大盘
│   │   ├── campaigns/
│   │   │   ├── page.tsx       # 重定向 /campaigns/new
│   │   │   └── new/           # 战役创建中心 (Campaign Builder)
│   │   ├── tasks/             # 任务调度大厅
│   │   └── leads/             # 线索 CRM 库
│   ├── components/
│   │   ├── ui/                # Button, Card, Input, Label, Select, Textarea
│   │   └── layout/            # Sidebar
│   ├── lib/
│   │   ├── api.ts             # 统一业务网关 API（createCampaign）
│   │   └── utils.ts
│   ├── store/                 # Zustand: dashboard, campaigns, leads
│   ├── types/                 # CampaignCreatePayload, EdgeNode, Lead 等
│   └── constants/
│       └── sop-templates.ts   # SOP 模版选项
├── package.json
├── tailwind.config.ts
└── next.config.js
```

## 启动

```bash
cd superharbor
npm install
cp .env.local.example .env.local
npm run dev
```

浏览器打开 **http://localhost:4000**。默认 Mock 模式，无需后端即可体验四大模块。

## 与后端联调

1. 在 `.env.local` 中设置 `NEXT_PUBLIC_API_BASE_URL=http://你的后端地址`。
2. 设置 `NEXT_PUBLIC_USE_MOCK=false`。
3. 后端需提供 `POST /api/v1/campaigns`，请求体参见 `src/lib/api.ts`。

## 四大模块

| 模块 | 路径 | 说明 |
|------|------|------|
| 总览大盘 | /dashboard | 在线节点数、今日 Token、今日派发任务数；边缘节点列表 |
| 战役创建中心 | /campaigns/new | 目标 URL、产品名、卖点、SOP 模版；提交触发 AI 编排 |
| 任务调度大厅 | /tasks | 战役进度条、状态 Pending/Generating/Dispatching/Completed/Failed |
| 线索 CRM 库 | /leads | 平台、昵称、意向等级、抓取时间、「通知销售跟进」 |
