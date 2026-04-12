# 🎯 Codex Task: SP4 — 前端看板接入（工作流可视化看板）

> **给 Codex 的任务说明书**
> 复制以下全部内容发送给 Codex 即可。

---

## 你要做什么

在 `web/src/` 下创建一组 React 组件，将后端已有的 **工作流执行数据** 可视化为看板页面。数据类型已经定义好（见下文），你只需要创建 UI 组件来渲染它们。

## 项目背景

这是一个 AI 增长操作系统的 SaaS 前端（Next.js 14 App Router）。系统有 9 只"龙虾"AI 代理协同工作。后端会产出一个 `IndustryWorkflowFrontendPreview` 数据结构，包含：
- **stepCards**: 每一步的详细卡片（负责哪只虾、什么状态、审批要求等）
- **workflowLanes**: 按类别分的泳道（策略/内容/运营/线索/转化/复盘/风控）
- **approvalCards**: 需要人工审批的步骤
- **runtimeCards**: 需要边缘执行的步骤

## 技术栈（已有，不需要安装）

- Next.js 14 (App Router, `'use client'`)
- React 18
- TypeScript
- Tailwind CSS
- lucide-react (图标)
- @tanstack/react-query (数据获取)
- 已有 UI 组件: `@/components/ui/Card`, `@/components/ui/Button`, `@/components/ui/Dialog`, `@/components/ui/Progress`, `@/components/ui/Skeleton`

## 你需要创建的文件

### 1. `web/src/components/workflow/WorkflowBoard.tsx`（核心看板）

一个**泳道看板组件**，类似 Trello/Kanban 风格，按 `workflowLanes` 分列：

```tsx
interface WorkflowBoardProps {
  preview: IndustryWorkflowFrontendPreview;
  onStepClick?: (stepCard: StepCard) => void;
  onApprove?: (stepId: string) => void;
  onReject?: (stepId: string) => void;
}
```

**UI 要求**：
- 水平滚动的泳道（7列：Strategy / Content / Runtime / Lead / Conversion / Review / Risk）
- 每列顶部显示：列名、步骤数量、审批数量徽标
- 列内纵向排列 StepCard 卡片
- 空列显示灰色占位

### 2. `web/src/components/workflow/StepCard.tsx`（步骤卡片）

单个步骤的卡片组件：

```tsx
interface StepCardProps {
  card: IndustryWorkflowFrontendPreviewStepCard;
  onClick?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}
```

**UI 要求**：
- 卡片顶部：步骤编号 + 标题
- 第二行：负责虾的名称 + 图标（根据 `ownerRole` 映射）
- 状态徽标：用颜色区分 `readinessState`
  - `ready` → 绿色
  - `approval_pending` → 黄色
  - `blocked` → 红色
  - `watch` → 蓝色
- 如果 `approvalRequired`，显示审批按钮（通过/拒绝）
- 底部显示 `primaryOutput` 工件名
- 点击展开详情（operatorChecklist、payloadGaps、suggestedCommands）

**龙虾角色映射**（用于显示中文名和图标）：
```typescript
const LOBSTER_META: Record<string, { zhName: string; emoji: string }> = {
  radar:      { zhName: '触须虾', emoji: '📡' },
  strategist: { zhName: '脑虫虾', emoji: '🧠' },
  inkwriter:  { zhName: '吐墨虾', emoji: '✒️' },
  visualizer: { zhName: '幻影虾', emoji: '🎬' },
  dispatcher: { zhName: '点兵虾', emoji: '📦' },
  echoer:     { zhName: '回声虾', emoji: '💬' },
  catcher:    { zhName: '铁网虾', emoji: '🎯' },
  abacus:     { zhName: '金算虾', emoji: '🧮' },
  followup:   { zhName: '回访虾', emoji: '🔄' },
  feedback:   { zhName: '反馈虾', emoji: '📊' },
};
```

### 3. `web/src/components/workflow/ApprovalPanel.tsx`（审批面板）

只显示需要审批的步骤，适合移动端快速审批：

```tsx
interface ApprovalPanelProps {
  approvalCards: IndustryWorkflowFrontendPreviewStepCard[];
  onApprove: (stepId: string) => void;
  onReject: (stepId: string) => void;
}
```

**UI 要求**：
- 列表形式，每行一个待审批项
- 显示：步骤名、负责虾、审批动作名称、风险等级
- 通过/拒绝按钮

### 4. `web/src/components/workflow/WorkflowHeader.tsx`（看板头部）

显示工作流总览信息：

```tsx
interface WorkflowHeaderProps {
  header: IndustryWorkflowFrontendPreview['header'];
  highlights: IndustryWorkflowFrontendPreview['highlights'];
}
```

**UI 要求**：
- 左侧：行业名称 + 品牌名 + 渠道标签
- 右侧：4个统计卡片（总步骤数、运行时步骤、审批步骤、门控步骤）
- 底部：高亮数据（选题评分维度数、云端输出数、边缘输出数、参与agent数）

### 5. `web/src/components/workflow/LobsterRoster.tsx`（龙虾阵容）

显示参与本次工作流的龙虾阵容：

```tsx
interface LobsterRosterProps {
  agents: IndustryWorkflowFrontendPreview['baselineAgentSummary'];
}
```

**UI 要求**：
- 横向卡片排列，每只参与的虾一张卡
- 显示：emoji + 中文名 + 默认桥接目标 + 技能标签
- 不参与的虾灰显

### 6. `web/src/app/operations/workflow-board/page.tsx`（页面入口）

```tsx
'use client';
// 从 API 获取 preview 数据，渲染 WorkflowBoard
// API: GET /api/agent/industry/preview?workflowId=xxx
// 如果 API 未就绪，使用 mock 数据
```

### 7. `web/src/data/workflow-board-mock.ts`（Mock 数据）

生成一份符合 `IndustryWorkflowFrontendPreview` 类型的完整 mock 数据，用于开发和演示。

## 数据类型定义（已存在，直接引用）

以下类型已经在项目中定义好，你可以从路径引用或在组件中重新声明：

```typescript
// 核心数据结构 — 从后端 API 返回

interface IndustryWorkflowFrontendPreviewStepCard {
  stepNumber: number;
  stepId: string;
  workflowId: string;
  workflowStageId: string;
  workflowCategory: string;
  title: string;
  goal: string;
  ownerRole: string;                    // 负责的虾 ID
  ownerAgentId: string | null;
  ownerStarterSkills: string[];
  supportAgents: Array<{ roleId: string; baselineAgentId: string }>;
  missionType: string;
  bridgeTarget: string;
  scopeId: string | null;
  surface: 'cloud' | 'edge' | 'approval' | 'lead' | 'followup';
  badges: string[];
  readinessState: 'ready' | 'approval_pending' | 'blocked' | 'watch';
  blockedReason: string | null;
  operatorChecklist: string[];          // 操作员检查清单
  payloadGaps: Array<{                  // 未填字段
    fieldPath: string;
    source: string;
    required: boolean;
    note: string;
  }>;
  suggestedCommands: string[];          // 建议的操作命令
  handoffTargets: string[];
  rollbackHint: string | null;
  approvalRequired: boolean;
  approvalActions: string[];            // 需要的审批动作
  primaryOutput: string | null;         // 主输出工件
}

interface IndustryWorkflowFrontendPreviewLane {
  laneId: 'strategy' | 'content' | 'runtime' | 'lead' | 'conversion' | 'review' | 'risk';
  label: string;
  stepCount: number;
  summary: {
    approvalCount: number;
    runtimeCount: number;
    liveFacingCount: number;
    topOwners: Array<{ roleId: string; count: number }>;
    primaryActions: string[];
    nextAttention: string[];
  };
  laneBadges: string[];
  stepCards: IndustryWorkflowFrontendPreviewStepCard[];
}

interface IndustryWorkflowFrontendPreview {
  version: string;
  generatedAt: string;
  header: {
    workflowId: string;
    industryLabel: string;
    brandName: string;
    channels: string[];
    totalSteps: number;
    runtimeStepCount: number;
    approvalStepCount: number;
    gatedStepCount: number;
  };
  highlights: {
    topicRubricCount: number;
    cloudOutputCount: number;
    edgeOutputCount: number;
    baselineAgentCount: number;
  };
  stepCards: IndustryWorkflowFrontendPreviewStepCard[];
  runtimeCards: IndustryWorkflowFrontendPreviewStepCard[];
  approvalCards: IndustryWorkflowFrontendPreviewStepCard[];
  workflowLanes: IndustryWorkflowFrontendPreviewLane[];
  baselineAgentSummary: Array<{
    roleId: string;
    baselineAgentId: string;
    defaultBridgeTarget: string | null;
    defaultScopeId: string | null;
    starterSkills: string[];
  }>;
}
```

## 现有项目结构参考

```
web/
├── src/
│   ├── app/
│   │   ├── operations/
│   │   │   ├── strategy/page.tsx        ← 已有的策略页
│   │   │   ├── autopilot/page.tsx       ← 已有的自动驾驶页
│   │   │   ├── autopilot/approvals/page.tsx ← 已有审批页
│   │   │   └── workflow-board/page.tsx  ← 你要创建的
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/                          ← 已有基础组件
│   │   │   ├── Card.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Dialog.tsx
│   │   │   ├── Progress.tsx
│   │   │   └── Skeleton.tsx
│   │   ├── layouts/
│   │   │   ├── AppShell.tsx
│   │   │   └── Sidebar.tsx
│   │   └── workflow/                    ← 你要创建的目录
│   ├── data/
│   │   └── industry-workflow/
│   │       └── workflow-smoke.json      ← 已有的smoke测试数据
│   ├── lib/
│   │   ├── industry-workflow.ts         ← 已有的工作流辅助函数
│   │   └── industry-taxonomy.ts
│   └── services/
│       └── endpoints/
│           └── ai-subservice.ts         ← 已有的 API 调用函数
```

## 样式要求

- 使用 Tailwind CSS，暗色主题为主（`bg-gray-900`、`text-gray-100`）
- 卡片使用 `bg-gray-800 rounded-lg p-4 border border-gray-700`
- 状态颜色：
  - ready: `bg-green-500/20 text-green-400`
  - approval_pending: `bg-yellow-500/20 text-yellow-400`
  - blocked: `bg-red-500/20 text-red-400`
  - watch: `bg-blue-500/20 text-blue-400`
- 泳道列使用 `min-w-[280px]` 确保可读性

## 关键约束

1. **所有组件用 `'use client'`** — Next.js App Router 客户端组件
2. **不修改现有文件** — 只创建新文件
3. **Mock 优先** — 先用 mock 数据开发，API 调用可选
4. **响应式** — 桌面端水平泳道，移动端垂直堆叠
5. **TypeScript 严格** — 所有 props 有类型定义

## 验收标准

1. `npm run dev` 后访问 `/operations/workflow-board` 能看到完整看板
2. 7个泳道正确显示，步骤卡片按类别归入对应列
3. 审批卡片有通过/拒绝按钮（可 console.log，暂不需要真实调用）
4. 点击卡片能展开详情（checklist、payload gaps、commands）
5. 移动端响应式可用
6. 全部 TypeScript 无类型错误

## 你需要创建的文件清单

| 文件 | 说明 |
|------|------|
| `web/src/components/workflow/WorkflowBoard.tsx` | 泳道看板主组件 |
| `web/src/components/workflow/StepCard.tsx` | 步骤卡片组件 |
| `web/src/components/workflow/ApprovalPanel.tsx` | 审批面板 |
| `web/src/components/workflow/WorkflowHeader.tsx` | 看板头部 |
| `web/src/components/workflow/LobsterRoster.tsx` | 龙虾阵容 |
| `web/src/app/operations/workflow-board/page.tsx` | 页面入口 |
| `web/src/data/workflow-board-mock.ts` | Mock 数据 |

---

*任务ID: SP4-FRONTEND-DASHBOARD | 预估难度: 中 | 预估文件: 7个 | 预估代码量: 600-900行*
