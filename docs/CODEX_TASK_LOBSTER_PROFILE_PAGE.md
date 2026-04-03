# CODEX TASK: 龙虾体系产品化 — 统一 Profile 页 + Artifact UI + 能力市场
> 优先级：P0/P1 | 来源：chakra-ui recipes + open-saas demo-ai-app + boxyhq components/team
> 目标：把9只龙虾从"技术模块"升级为"可展示、可审计、可售卖"的产品实体

---

## 任务背景

当前缺口：
- 每只龙虾没有统一的 profile 页（身份/能力/历史/状态一览）
- 龙虾产物（artifact）没有统一的可读/可审/可追踪 UI
- 没有"龙虾能力市场"（用户不知道每只龙虾能干什么）
- operator 无法看到龙虾的 explainability（为什么做了这个决策）

来源借鉴：
- chakra-ui `card/` + `data-list/` + `timeline/` → profile 卡片 + 数据列表 + 历史时间线
- open-saas `demo-ai-app/` → AI 任务结果展示模式
- boxyhq `components/team/` → 成员 profile + 权限 + 操作 的展示模式

---

## 一、龙虾名册（官方定死，10只，含 commander）

| canonical_id | 中文名 | 主职责 | 核心工件 |
|---|---|---|---|
| commander | 元老院总脑 | 编排、仲裁、异常处理、复盘 | MissionPlan |
| radar | 触须虾 | 信号发现、热点、竞品、舆情 | SignalBrief |
| strategist | 脑虫虾 | 策略规划、排期、实验、预算 | StrategyRoute |
| inkwriter | 吐墨虾 | 文案、话术、合规改写 | CopyPack |
| visualizer | 幻影虾 | 分镜、图片、视频、字幕 | StoryboardPack |
| dispatcher | 点兵虾 | 分发、调度、发布时间窗 | ExecutionPlan |
| echoer | 回声虾 | 评论、私信、互动承接 | EngagementReplyPack |
| catcher | 铁网虾 | 线索评分、CRM入库、去重 | LeadAssessment |
| abacus | 金算虾 | 归因、ROI、报告、反馈回收 | ValueScoreCard |
| followup | 回访虾 | 多触点跟进、唤醒、成交回写 | FollowupLog |

> ⚠️ 名称和 ID 已定死，不得自由发挥或改名。commander 是大脑/总编排，不对外当普通龙虾展示。

---

## 二、目标产物

```
src/
├── pages/lobsters/
│   ├── index.tsx               ← 龙虾列表页（能力市场入口）
│   └── [id].tsx                ← 龙虾 Profile 页（详情）
│
├── components/lobster/
│   ├── LobsterCard.tsx          ← 龙虾卡片（市场/列表用）
│   ├── LobsterProfile.tsx       ← 龙虾详情面板（Right Rail 或全页）
│   ├── LobsterArtifact.tsx      ← 产物展示（可读/可审/可复制）
│   ├── LobsterTimeline.tsx      ← 执行历史时间线
│   ├── LobsterSkillBadge.tsx    ← 技能标签（带治理级别颜色）
│   ├── LobsterExplainPanel.tsx  ← Explainability 面板（为什么这么做）
│   └── LobsterCapabilityMarket.tsx ← 能力市场页完整组件
│
└── hooks/
    └── useLobster.ts            ← 龙虾数据 hook
```

---

## 三、实现规范

### 1. LobsterCard.tsx — 市场卡片

```tsx
// src/components/lobster/LobsterCard.tsx
// 用于能力市场、龙虾列表页的卡片展示

import { StatusBadge } from '@/design-system/console/StatusBadge';

interface LobsterCardProps {
  id: string;
  name: string;         // "墨笔手"
  englishName: string;  // "InkWriter"
  role: string;         // "文案创作"
  emoji: string;        // "✍️"
  description: string;
  skills: string[];     // ["爆款文案", "SEO", "多平台适配"]
  status: 'online' | 'offline' | 'running' | 'paused';
  taskCount: number;    // 历史任务数
  successRate: number;  // 成功率 0-1
  tier: 'free' | 'basic' | 'growth' | 'enterprise';
  onSelect?: () => void;
  onRunTask?: () => void;
}

export function LobsterCard({
  id, name, englishName, role, emoji, description,
  skills, status, taskCount, successRate, tier, onSelect, onRunTask,
}: LobsterCardProps) {
  const tierColors: Record<string, string> = {
    free:       'bg-gray-100 text-gray-600',
    basic:      'bg-blue-50 text-blue-700',
    growth:     'bg-purple-50 text-purple-700',
    enterprise: 'bg-amber-50 text-amber-700',
  };
  const tierLabel: Record<string, string> = {
    free: '免费', basic: '基础版', growth: '成长版', enterprise: '企业版',
  };

  return (
    <div
      className="group bg-white border border-gray-200 rounded-2xl p-5 hover:border-brand-300
                 hover:shadow-md transition-all cursor-pointer flex flex-col gap-4"
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-100 to-brand-200
                          flex items-center justify-center text-2xl shadow-sm">
            {emoji}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-gray-900">{name}</h3>
              <span className="text-xs text-gray-400">{englishName}</span>
            </div>
            <p className="text-sm text-gray-500">{role}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={status} size="sm" />
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierColors[tier]}`}>
            {tierLabel[tier]}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-600 line-clamp-2">{description}</p>

      {/* Skills */}
      <div className="flex flex-wrap gap-1.5">
        {skills.slice(0, 4).map((skill) => (
          <span key={skill}
            className="text-xs px-2 py-1 bg-gray-50 text-gray-600 rounded-full border border-gray-200">
            {skill}
          </span>
        ))}
        {skills.length > 4 && (
          <span className="text-xs px-2 py-1 text-gray-400">+{skills.length - 4}</span>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-gray-400 pt-1 border-t border-gray-100">
        <span>📋 {taskCount} 次任务</span>
        <span>✅ {(successRate * 100).toFixed(0)}% 成功</span>
        <div className="flex-1" />
        <button
          onClick={(e) => { e.stopPropagation(); onRunTask?.(); }}
          className="px-3 py-1.5 bg-brand-500 text-white rounded-lg text-xs font-medium
                     hover:bg-brand-600 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          发布任务
        </button>
      </div>
    </div>
  );
}
```

### 2. LobsterProfile.tsx — 详情面板

```tsx
// src/components/lobster/LobsterProfile.tsx
// Right Rail 或全页模式的龙虾详情

interface LobsterProfileProps {
  lobsterId: string;
  mode?: 'rail' | 'page';   // rail=右侧面板，page=全页
}

export function LobsterProfile({ lobsterId, mode = 'rail' }: LobsterProfileProps) {
  const { lobster, recentTasks, skills, metrics, loading } = useLobster(lobsterId);

  if (loading) return <ProfileSkeleton />;
  if (!lobster) return <EmptyState title="龙虾不存在" />;

  return (
    <div className={`flex flex-col gap-6 ${mode === 'page' ? 'max-w-3xl mx-auto py-8 px-4' : ''}`}>

      {/* 身份卡 */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200
                        flex items-center justify-center text-3xl">
          {lobster.emoji}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold text-gray-900">{lobster.name}</h2>
            <StatusBadge status={lobster.status} />
          </div>
          <p className="text-sm text-gray-500">{lobster.role} · {lobster.englishName}</p>
        </div>
      </div>

      {/* 能力指标 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '历史任务', value: metrics.totalTasks, icon: '📋' },
          { label: '成功率', value: `${(metrics.successRate * 100).toFixed(0)}%`, icon: '✅' },
          { label: '平均耗时', value: `${metrics.avgDuration}s`, icon: '⏱' },
        ].map((m) => (
          <div key={m.label} className="bg-gray-50 rounded-xl p-3 text-center">
            <div className="text-xl mb-1">{m.icon}</div>
            <div className="font-bold text-gray-900">{m.value}</div>
            <div className="text-xs text-gray-400">{m.label}</div>
          </div>
        ))}
      </div>

      {/* 技能列表 */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">核心技能</h4>
        <div className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <LobsterSkillBadge key={skill.id} skill={skill} />
          ))}
        </div>
      </div>

      {/* 最近任务 */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">最近任务</h4>
        <LobsterTimeline tasks={recentTasks} />
      </div>

      {/* 操作区 */}
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button className="flex-1 py-2.5 bg-brand-500 text-white rounded-xl text-sm font-medium hover:bg-brand-600">
          发布新任务
        </button>
        <button className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
          查看全部历史
        </button>
      </div>
    </div>
  );
}
```

### 3. LobsterArtifact.tsx — 产物展示

```tsx
// src/components/lobster/LobsterArtifact.tsx
// 龙虾产物：可读、可审计、可复制、可导出

type ArtifactType = 'text' | 'markdown' | 'json' | 'image' | 'report' | 'schedule';

interface ArtifactProps {
  taskId: string;
  type: ArtifactType;
  content: string;
  lobsterName: string;
  createdAt: number;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | null;
  onApprove?: () => void;
  onReject?: () => void;
  onCopy?: () => void;
  onExport?: () => void;
}

export function LobsterArtifact({
  taskId, type, content, lobsterName, createdAt,
  approvalStatus, onApprove, onReject, onCopy, onExport,
}: ArtifactProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopy?.();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {/* Artifact Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">{lobsterName} 的产物</span>
          <span className="text-xs text-gray-400">#{taskId.slice(-6)}</span>
          <span className="text-xs text-gray-400">
            {new Date(createdAt * 1000).toLocaleString('zh-CN')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 审批状态 */}
          {approvalStatus === 'pending' && (
            <div className="flex gap-1.5">
              <button
                onClick={onApprove}
                className="px-3 py-1 text-xs font-medium bg-green-500 text-white rounded-lg hover:bg-green-600"
              >
                ✓ 批准
              </button>
              <button
                onClick={onReject}
                className="px-3 py-1 text-xs font-medium bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                ✗ 拒绝
              </button>
            </div>
          )}
          {approvalStatus === 'approved' && (
            <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-full">✓ 已批准</span>
          )}
          {approvalStatus === 'rejected' && (
            <span className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded-full">✗ 已拒绝</span>
          )}
          {/* 操作 */}
          <button
            onClick={handleCopy}
            className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
          >
            {copied ? '✓ 已复制' : '复制'}
          </button>
          {onExport && (
            <button
              onClick={onExport}
              className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
            >
              导出
            </button>
          )}
        </div>
      </div>

      {/* Artifact Content */}
      <div className="p-4">
        {type === 'text' && (
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{content}</p>
        )}
        {type === 'markdown' && (
          <div className="prose prose-sm max-w-none text-gray-700"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }} />
        )}
        {type === 'json' && (
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto text-gray-600 font-mono">
            {JSON.stringify(JSON.parse(content), null, 2)}
          </pre>
        )}
        {type === 'report' && <ReportArtifact content={content} />}
        {type === 'schedule' && <ScheduleArtifact content={content} />}
      </div>
    </div>
  );
}

// 简单 report 展示（为 analyst 龙虾专用）
function ReportArtifact({ content }: { content: string }) {
  let data: any = {};
  try { data = JSON.parse(content); } catch {}
  return (
    <div className="space-y-4">
      {data.summary && (
        <div className="p-3 bg-blue-50 rounded-lg">
          <h5 className="text-xs font-semibold text-blue-800 mb-1">执行摘要</h5>
          <p className="text-sm text-blue-700">{data.summary}</p>
        </div>
      )}
      {data.metrics && (
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(data.metrics).map(([k, v]) => (
            <div key={k} className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">{k}</div>
              <div className="font-bold text-gray-900">{String(v)}</div>
            </div>
          ))}
        </div>
      )}
      {data.recommendations && (
        <div>
          <h5 className="text-xs font-semibold text-gray-700 mb-2">建议</h5>
          <ul className="space-y-1">
            {data.recommendations.map((r: string, i: number) => (
              <li key={i} className="text-sm text-gray-600 flex gap-2">
                <span className="text-brand-500 flex-shrink-0">→</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### 4. LobsterExplainPanel.tsx — Explainability 面板

```tsx
// src/components/lobster/LobsterExplainPanel.tsx
// 为每个任务提供"为什么龙虾这么做"的解释（operator facing）

interface ExplainEntry {
  step: number;
  action: string;
  reasoning: string;
  tool_used?: string;
  confidence?: number;
}

interface ExplainPanelProps {
  taskId: string;
  lobsterName: string;
  entries: ExplainEntry[];
}

export function LobsterExplainPanel({ taskId, lobsterName, entries }: ExplainPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-purple-50 border-b border-purple-100">
        <h4 className="text-sm font-semibold text-purple-800">
          🧠 {lobsterName} 的决策过程
        </h4>
        <p className="text-xs text-purple-600 mt-0.5">任务 #{taskId.slice(-6)}</p>
      </div>
      <div className="divide-y divide-gray-100">
        {entries.map((entry) => (
          <div key={entry.step} className="px-4 py-3">
            <button
              className="w-full flex items-center justify-between text-left"
              onClick={() => setExpanded(expanded === entry.step ? null : entry.step)}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700
                                 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {entry.step}
                </span>
                <span className="text-sm font-medium text-gray-800">{entry.action}</span>
                {entry.tool_used && (
                  <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                    {entry.tool_used}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {entry.confidence !== undefined && (
                  <span className={`text-xs font-medium ${
                    entry.confidence > 0.8 ? 'text-green-600'
                    : entry.confidence > 0.5 ? 'text-amber-600' : 'text-red-600'
                  }`}>
                    {(entry.confidence * 100).toFixed(0)}%
                  </span>
                )}
                <span className="text-gray-400">{expanded === entry.step ? '▲' : '▼'}</span>
              </div>
            </button>
            {expanded === entry.step && (
              <div className="mt-2 ml-9 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                {entry.reasoning}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 5. LobsterCapabilityMarket.tsx — 能力市场入口页

```tsx
// src/pages/lobsters/index.tsx
// 完整的龙虾能力市场页面

export default function LobsterMarketPage() {
  const [filter, setFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const lobsters = LOBSTER_ROSTER.filter((l) =>
    (!filter || l.name.includes(filter) || l.role.includes(filter) || l.skills.some((s) => s.includes(filter))) &&
    (!tierFilter || l.tier === tierFilter)
  );

  return (
    <ConsoleLayout
      header={
        <PageHeader
          title="龙虾能力市场"
          description="9只 AI 龙虾，每只都有专精能力。选择合适的龙虾，发布你的第一个任务。"
          breadcrumb={[{ label: '运营', href: '/operations' }, { label: '龙虾' }]}
        />
      }
      metricRow={
        <>
          <MetricCard label="总龙虾数" value={9} icon="🦞" />
          <MetricCard label="当前在线" value={lobsters.filter(l => l.status === 'online').length} icon="🟢" />
          <MetricCard label="今日任务" value={142} trend={{ value: 8, label: 'vs 昨日' }} icon="📋" />
          <MetricCard label="整体成功率" value="96%" trend={{ value: 2, label: 'vs 上周' }} icon="✅" />
        </>
      }
      filterBar={
        <FilterBar
          searchPlaceholder="搜索龙虾名称、职能或技能..."
          onSearch={setFilter}
          filters={[
            {
              key: 'tier',
              label: '所需套餐',
              value: tierFilter,
              onChange: setTierFilter,
              options: [
                { label: '免费可用', value: 'free' },
                { label: '基础版', value: 'basic' },
                { label: '成长版', value: 'growth' },
                { label: '企业版', value: 'enterprise' },
              ],
            },
          ]}
        />
      }
      rightRail={selected ? <LobsterProfile lobsterId={selected} mode="rail" /> : undefined}
      rightRailTitle={selected ? `龙虾详情` : undefined}
      onCloseRightRail={() => setSelected(null)}
      empty={lobsters.length === 0}
      emptyState={<EmptyState icon="🦞" title="没有找到匹配的龙虾" description="尝试调整搜索条件" />}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {lobsters.map((lobster) => (
          <LobsterCard
            key={lobster.id}
            {...lobster}
            onSelect={() => setSelected(lobster.id)}
            onRunTask={() => {/* 打开任务发布弹窗 */}}
          />
        ))}
      </div>
    </ConsoleLayout>
  );
}

// ── 官方龙虾名册（定死，不得改名）────────────────────────────────────────
// commander 是大脑/总编排，不在市场页展示
// 以下9只是对外展示的执行龙虾
const LOBSTER_ROSTER = [
  {
    id: 'radar', name: '触须虾', artifact: 'SignalBrief', emoji: '📡',
    role: '信号发现',
    description: '实时监控热点、竞品动态和舆情变化，为策略规划提供情报支撑。',
    skills: ['热点发现', '竞品监控', '舆情追踪', '受众信号', '关键词雷达'],
    status: 'online' as const, taskCount: 623, successRate: 0.94, tier: 'basic' as const,
  },
  {
    id: 'strategist', name: '脑虫虾', artifact: 'StrategyRoute', emoji: '🧩',
    role: '策略规划',
    description: '全局内容策略制定、排期规划、增长实验设计和预算分配。',
    skills: ['策略规划', '内容排期', '实验设计', '预算分配', '矩阵协同'],
    status: 'online' as const, taskCount: 178, successRate: 0.93, tier: 'growth' as const,
  },
  {
    id: 'inkwriter', name: '吐墨虾', artifact: 'CopyPack', emoji: '✍️',
    role: '文案创作',
    description: '专业文案、话术生成和合规改写，适配多平台内容风格。',
    skills: ['文案创作', '话术生成', '合规改写', '多平台适配', '爆款标题'],
    status: 'online' as const, taskCount: 847, successRate: 0.97, tier: 'basic' as const,
  },
  {
    id: 'visualizer', name: '幻影虾', artifact: 'StoryboardPack', emoji: '🎨',
    role: '视觉设计',
    description: '分镜设计、图片生成、视频脚本和字幕处理，覆盖全视觉链路。',
    skills: ['分镜设计', '图片生成', '视频脚本', '字幕处理', '封面设计'],
    status: 'online' as const, taskCount: 289, successRate: 0.91, tier: 'enterprise' as const,
  },
  {
    id: 'dispatcher', name: '点兵虾', artifact: 'ExecutionPlan', emoji: '🎯',
    role: '分发调度',
    description: '内容分发、多账号调度和最佳发布时间窗管理，确保精准触达。',
    skills: ['内容分发', '多账号调度', '时间窗管理', '并行发布', '渠道协调'],
    status: 'online' as const, taskCount: 956, successRate: 0.98, tier: 'basic' as const,
  },
  {
    id: 'echoer', name: '回声虾', artifact: 'EngagementReplyPack', emoji: '💬',
    role: '互动承接',
    description: '7×24 评论回复、私信处理和互动承接，维护社区活跃度。',
    skills: ['评论回复', '私信处理', '互动承接', '危机过滤', 'DM营销'],
    status: 'running' as const, taskCount: 3201, successRate: 0.92, tier: 'growth' as const,
  },
  {
    id: 'catcher', name: '铁网虾', artifact: 'LeadAssessment', emoji: '🕸️',
    role: '线索捕获',
    description: '线索评分、CRM入库和去重处理，把社媒互动精准转化为销售线索。',
    skills: ['线索评分', 'CRM入库', '去重处理', '线索分级', '意向识别'],
    status: 'online' as const, taskCount: 534, successRate: 0.89, tier: 'growth' as const,
  },
  {
    id: 'abacus', name: '金算虾', artifact: 'ValueScoreCard', emoji: '📊',
    role: '数据归因',
    description: '归因分析、ROI核算、效果报告和反馈回收，量化每一分营销投入。',
    skills: ['归因分析', 'ROI核算', '效果报告', '反馈回收', '漏斗分析'],
    status: 'online' as const, taskCount: 412, successRate: 0.96, tier: 'growth' as const,
  },
  {
    id: 'followup', name: '回访虾', artifact: 'FollowupLog', emoji: '🤝',
    role: '多触点跟进',
    description: '多触点跟进、沉默用户唤醒和成交结果回写，驱动最终转化。',
    skills: ['多触点跟进', '用户唤醒', '成交回写', '跟进节奏管理', '商机激活'],
    status: 'online' as const, taskCount: 389, successRate: 0.87, tier: 'enterprise' as const,
  },
];
```

---

## 验收标准

- [ ] 能力市场页 `/lobsters` 展示全部9只龙虾（卡片网格）
- [ ] 支持按名称/职能/技能搜索过滤
- [ ] 支持按所需套餐过滤（免费/基础/成长/企业）
- [ ] 点击龙虾卡片，右侧 Rail 显示 Profile 详情
- [ ] Profile 显示：身份/指标/技能/最近任务时间线
- [ ] "发布新任务"按钮在 Profile 和卡片上都可点击
- [ ] LobsterArtifact 展示产物：文本/JSON/报告/日历 4种格式
- [ ] 审批状态（pending/approved/rejected）在 Artifact 上清晰显示
- [ ] ExplainPanel 展示执行步骤 + 推理过程（可折叠）
- [ ] 有 tier 门控：成长版/企业版龙虾对低层级用户显示 UpgradeCTA

---

## 参考文件

- `f:/openclaw-agent/dragon-senate-saas-v2/lobsters-registry.json` — 龙虾注册表
- `f:/openclaw-agent/dragon-senate-saas-v2/skill_frontmatter.py` — 技能 metadata
- `f:/openclaw-agent/docs/CODEX_TASK_OPERATIONS_CONSOLE_FRAMEWORK.md` — ConsoleLayout
- `f:/openclaw-agent/docs/CODEX_TASK_DESIGN_TOKEN_SYSTEM.md` — StatusBadge 颜色
- `f:/openclaw-agent/docs/OPENSAAS_ECOSYSTEM_BORROWING_ANALYSIS.md` 第二章
- chakra-ui: `packages/react/src/components/card/`
- chakra-ui: `packages/react/src/components/data-list/`
