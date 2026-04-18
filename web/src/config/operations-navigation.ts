import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Bell,
  BookOpenText,
  Bot,
  ClipboardList,
  Cpu,
  Database,
  FileSearch,
  FileText,
  Gauge,
  Handshake,
  HelpCircle,
  Home,
  Layers3,
  Lock,
  MessageSquare,
  Network,
  Radio,
  Scale,
  Settings2,
  Shield,
  Sparkles,
  Target,
  Waypoints,
  Wrench,
} from 'lucide-react';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';

export type Locale = 'zh' | 'en';
export type LocalizedText = Record<Locale, string>;
export type ProductLensId =
  | 'command'
  | 'lobsters'
  | 'training'
  | 'collab'
  | 'execution'
  | 'governance'
  | 'knowledge';

export type ProductNavItem = {
  href: string;
  label: LocalizedText;
  icon: LucideIcon;
  exact?: boolean;
};

export type ProductZone = {
  id: Exclude<ProductLensId, 'command'>;
  href: string;
  title: LocalizedText;
  description: LocalizedText;
  icon: LucideIcon;
  items: ProductNavItem[];
};

export type ProductLens = {
  id: ProductLensId;
  href: string;
  icon: LucideIcon;
  label: LocalizedText;
  description: LocalizedText;
  match: string[];
};

export const PRODUCT_BRAND = {
  title: { zh: '龙虾坑', en: 'LobsterPit' } as LocalizedText,
  subtitle: { zh: 'AI 增长操作系统', en: 'AI Growth OS' } as LocalizedText,
  start: { zh: '从首页开始', en: 'Start From Onboard' } as LocalizedText,
};

export const CONTROL_DECK_ITEM: ProductNavItem = {
  href: '/',
  label: { zh: '租户增长总控台', en: 'Tenant Control Deck' },
  icon: Home,
  exact: true,
};

export const PRODUCT_ZONES: ProductZone[] = [
  {
    id: 'lobsters',
    href: '/agents/cabinet',
    title: { zh: '龙虾主管区', en: 'Lobster Supervisors' },
    description: {
      zh: '查看岗位总览、主管详情、能力树和能力配置，把角色理解收回到同一块主管视图里。',
      en: 'See supervisor overview, detail, capability tree, and configuration in one product area.',
    },
    icon: Cpu,
    items: [
      { href: '/agents/cabinet', label: { zh: '主管总览', en: 'Supervisor Overview' }, icon: Bot },
      { href: '/lobsters', label: { zh: '主管详情', en: 'Supervisor Detail' }, icon: Gauge },
      { href: '/lobsters/capability-tree', label: { zh: '能力地图', en: 'Capability Map' }, icon: Sparkles },
      { href: '/operations/lobster-config', label: { zh: '能力配置', en: 'Capability Config' }, icon: Wrench },
      { href: '/operations/skills-pool', label: { zh: '技能池', en: 'Skill Pool' }, icon: Database },
      { href: '/dashboard/lobster-pool', label: { zh: '运行池', en: 'Runtime Pool' }, icon: Activity },
    ],
  },
  {
    id: 'training',
    href: '/operations/strategy',
    title: { zh: '练兵区', en: 'Training Ground' },
    description: {
      zh: '把雷达、策略、任务链、工件和复盘串成一条真正可训练的增长主线。',
      en: 'Connect radar, strategy, missions, artifacts, and replay into one training lane.',
    },
    icon: Target,
    items: [
      { href: '/ai-brain/radar', label: { zh: '对标雷达', en: 'Radar' }, icon: FileSearch },
      { href: '/operations/strategy', label: { zh: '策略编排', en: 'Strategy' }, icon: Sparkles },
      { href: '/campaigns', label: { zh: '增长任务', en: 'Growth Tasks' }, icon: ClipboardList },
      { href: '/operations/workflows', label: { zh: '任务链', en: 'Workflow Chain' }, icon: Layers3 },
      { href: '/operations/autopilot/artifacts', label: { zh: '工件成果', en: 'Artifacts' }, icon: FileText },
      { href: '/operations/autopilot/trace', label: { zh: '复盘回放', en: 'Trace Replay' }, icon: FileSearch },
    ],
  },
  {
    id: 'collab',
    href: '/collab',
    title: { zh: '群协作区', en: 'Collab' },
    description: {
      zh: '把群播报、待确认项、审批和催办组织在同一块协作面上，不再散落在私聊和旧后台里。',
      en: 'Organize reports, confirmations, approvals, and nudges in one collaboration surface.',
    },
    icon: MessageSquare,
    items: [
      { href: '/collab', label: { zh: '协作总览', en: 'Collab Overview' }, icon: MessageSquare },
      { href: '/collab/reports', label: { zh: '群播报', en: 'Group Reports' }, icon: Bell },
      { href: '/collab/approvals', label: { zh: '待确认项', en: 'Confirmations' }, icon: Shield },
      { href: '/operations/channels/feishu', label: { zh: '飞书接入', en: 'Feishu Channel' }, icon: Bell },
    ],
  },
  {
    id: 'execution',
    href: '/fleet',
    title: { zh: '本地执行区', en: 'Local Execution' },
    description: {
      zh: '把 Fleet、调度、监控、手动发布和边缘审计收拢到统一执行视图里。',
      en: 'Bring fleet, scheduler, monitor, manual publish, and edge audit into one execution view.',
    },
    icon: Radio,
    items: [
      { href: '/fleet', label: { zh: 'Fleet', en: 'Fleet' }, icon: Network },
      { href: '/operations/scheduler', label: { zh: '调度中心', en: 'Scheduler' }, icon: Waypoints },
      { href: '/operations/monitor', label: { zh: '心跳与回执', en: 'Monitor' }, icon: Activity },
      { href: '/missions/manual-publish', label: { zh: '手动发布', en: 'Manual Publish' }, icon: Sparkles },
      { href: '/operations/edge-audit', label: { zh: '边缘审计', en: 'Edge Audit' }, icon: Shield },
    ],
  },
  {
    id: 'governance',
    href: '/governance',
    title: { zh: '治理中心', en: 'Governance' },
    description: {
      zh: `把审批、告警、审计、权限、上线闸门和${LEARNING_LOOP_ROUTES.frontendGaps.title}统一收口在这里。`,
      en: 'Keep approvals, alerts, audit, permissions, launch gate, and integration checklist together.',
    },
    icon: Shield,
    items: [
      { href: '/governance', label: { zh: '治理总览', en: 'Governance Overview' }, icon: Shield },
      { href: LEARNING_LOOP_ROUTES.tenantCockpit.href, label: { zh: LEARNING_LOOP_ROUTES.tenantCockpit.title, en: 'Tenant Cockpit' }, icon: ClipboardList },
      { href: '/governance/capability-routes', label: { zh: '能力路由预览', en: 'Capability Routes' }, icon: Shield },
      { href: '/governance/platform-feedback', label: { zh: '平台反馈预览', en: 'Platform Feedback' }, icon: Database },
      { href: '/operations/autopilot/approvals', label: { zh: '审批中心', en: 'Approvals' }, icon: Shield },
      { href: '/operations/alerts', label: { zh: '风险与告警', en: 'Alerts' }, icon: Bell },
      { href: '/settings/audit', label: { zh: '审计日志', en: 'Audit Logs' }, icon: FileSearch },
      { href: '/settings/permissions', label: { zh: '权限管理', en: 'Permissions' }, icon: Lock },
      { href: '/settings/policies', label: { zh: '策略治理', en: 'Policies' }, icon: Scale },
      { href: '/settings/commercial-readiness', label: { zh: '上线闸门', en: 'Launch Gate' }, icon: Settings2 },
      { href: LEARNING_LOOP_ROUTES.frontendGaps.href, label: { zh: LEARNING_LOOP_ROUTES.frontendGaps.title, en: 'Frontend Gap Board' }, icon: ClipboardList },
      { href: LEARNING_LOOP_ROUTES.releaseChecklist.href, label: { zh: LEARNING_LOOP_ROUTES.releaseChecklist.title, en: 'Release Checklist' }, icon: ClipboardList },
    ],
  },
  {
    id: 'knowledge',
    href: '/knowledge',
    title: { zh: '知识区', en: 'Knowledge' },
    description: {
      zh: '围绕平台通用知识、平台行业知识、租户私有知识、角色知识包和双轨记忆组织知识视图。',
      en: 'Browse platform knowledge, industry knowledge, tenant knowledge, role packs, and memory layers.',
    },
    icon: Database,
    items: [
      { href: '/knowledge', label: { zh: '知识总览', en: 'Knowledge Overview' }, icon: Database },
      { href: '/knowledge/platform-industries', label: { zh: '平台行业知识', en: 'Platform Industries' }, icon: BookOpenText },
      { href: '/operations/knowledge-base', label: { zh: '租户私有知识', en: 'Tenant Knowledge' }, icon: Layers3 },
      { href: '/ai-brain/prompt-lab', label: { zh: '角色知识包', en: 'Role Knowledge Packs' }, icon: FileText },
      { href: LEARNING_LOOP_ROUTES.memory.href, label: { zh: LEARNING_LOOP_ROUTES.memory.title, en: 'Memory Layers' }, icon: Database },
      { href: '/ai-brain/studio', label: { zh: '知识中台', en: 'Knowledge Studio' }, icon: Bot },
    ],
  },
];

export const PRODUCT_LENSES: ProductLens[] = [
  {
    id: 'command',
    href: '/',
    icon: Waypoints,
    label: { zh: '租户增长总控台', en: 'Tenant Control Deck' },
    description: {
      zh: '先看这个租户今天该盯哪条链路，再决定进入主管区、练兵区、协作区还是本地执行区。',
      en: 'See the tenant-level growth picture first, then drill into the right execution area.',
    },
    match: ['/', '/dashboard', '/onboard', '/operations/leads', '/crm/leads', '/crm/graph', '/client-center', '/client-mobile'],
  },
  ...PRODUCT_ZONES.map((zone) => ({
    id: zone.id,
    href: zone.href,
    icon: zone.icon,
    label: zone.title,
    description: zone.description,
    match: [zone.href, ...zone.items.map((item) => item.href)],
  })),
];

export const SIDEBAR_FOOTER_ITEMS: ProductNavItem[] = [
  { href: LEARNING_LOOP_ROUTES.deliveryHub.href, label: { zh: LEARNING_LOOP_ROUTES.deliveryHub.title, en: 'Delivery Hub' }, icon: FileText },
  { href: '/partner/portal', label: { zh: '代理经营台', en: 'Partner Portal' }, icon: Handshake },
  { href: '/help', label: { zh: '帮助中心', en: 'Help Center' }, icon: HelpCircle },
];

export const MOBILE_NAV_ITEMS: ProductNavItem[] = [
  CONTROL_DECK_ITEM,
  { href: '/agents/cabinet', label: { zh: '主管区', en: 'Lobsters' }, icon: Cpu },
  { href: '/operations/strategy', label: { zh: '练兵区', en: 'Training' }, icon: Target },
  { href: '/collab', label: { zh: '协作区', en: 'Collab' }, icon: MessageSquare },
  { href: '/fleet', label: { zh: '执行区', en: 'Execution' }, icon: Radio },
];

export function t(locale: string, copy: LocalizedText): string {
  return copy[locale === 'en' ? 'en' : 'zh'];
}

export function isRouteActive(pathname: string, href: string, exact = false): boolean {
  if (href === '/') {
    return pathname === '/' || pathname === '/dashboard';
  }
  if (exact) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function resolveCurrentLens(pathname: string): ProductLens {
  return (
    PRODUCT_LENSES.find((item) =>
      item.match.some((prefix) =>
        prefix === '/'
          ? pathname === '/' || pathname === '/dashboard'
          : pathname === prefix || pathname.startsWith(`${prefix}/`),
      ),
    ) ?? PRODUCT_LENSES[0]
  );
}
