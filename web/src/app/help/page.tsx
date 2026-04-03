'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { BookOpen, Bot, LifeBuoy, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { fetchFeishuCallbackReadiness, fetchNotificationStatus } from '@/services/endpoints/billing';
import { getCurrentUser } from '@/services/endpoints/user';
import { getFleetMetrics } from '@/services/device-fleet';
import { getAiSubserviceHealth } from '@/services/endpoints/ai-subservice';

const quickLinks = [
  {
    href: '/onboard',
    title: '首启流程',
    desc: '用首启流程把租户、行业标签和 starter tasks 一次性配置到位。',
    icon: <BookOpen className="h-5 w-5 text-cyan-300" />,
  },
  {
    href: '/operations/log-audit',
    title: '日志审核',
    desc: '检查任务流、告警、Trace IDs 和 replay 历史。',
    icon: <ShieldCheck className="h-5 w-5 text-emerald-300" />,
  },
  {
    href: '/settings/integrations',
    title: '集成配置',
    desc: '配置服务商、Webhook、MCP 路由和对象存储。',
    icon: <Wrench className="h-5 w-5 text-amber-300" />,
  },
  {
    href: '/operations/skills-pool',
    title: '技能池',
    desc: '查看 9 龙虾岗位配置、行业知识资产和技能覆盖情况。',
    icon: <Sparkles className="h-5 w-5 text-fuchsia-300" />,
  },
  {
    href: '/settings/commercial-readiness',
    title: '商业化就绪度',
    desc: '在一页里核对支付、通知、Feishu 回调和 ICP 准备度。',
    icon: <Wrench className="h-5 w-5 text-sky-300" />,
  },
];

function roleLabel(role?: string): string {
  switch (role) {
    case 'admin':
      return '管理员';
    case 'operator':
      return '运营';
    case 'viewer':
      return '只读';
    default:
      return role || '-';
  }
}

function notificationModeLabel(mode?: string): string {
  switch (mode) {
    case 'file':
      return '文件模式';
    case 'smtp':
      return 'SMTP';
    case 'sms-mock':
      return '短信模拟';
    default:
      return mode || '待确认';
  }
}

export default function HelpPage() {
  const userQuery = useQuery({
    queryKey: ['help', 'current-user'],
    queryFn: getCurrentUser,
  });
  const fleetQuery = useQuery({
    queryKey: ['help', 'fleet-metrics'],
    queryFn: getFleetMetrics,
  });
  const aiHealthQuery = useQuery({
    queryKey: ['help', 'ai-health'],
    queryFn: getAiSubserviceHealth,
  });
  const notificationQuery = useQuery({
    queryKey: ['help', 'notification-status'],
    queryFn: fetchNotificationStatus,
    retry: false,
  });
  const feishuReadinessQuery = useQuery({
    queryKey: ['help', 'feishu-readiness'],
    queryFn: fetchFeishuCallbackReadiness,
    retry: false,
  });

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <LifeBuoy className="h-4 w-4" />
              帮助中心
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-5xl">给运营、交付和管理员的实时入口</h1>
            <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-300 md:text-base">
              这页不是帮助文档堆，而是一个实时运维入口。它把当前会话、系统健康、执行网络和最常见的下一步动作收在一起，方便团队快速做判断。
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
            {userQuery.data ? `当前会话：${userQuery.data.name}` : '当前会话：加载中'}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatusCard
          title="当前角色"
          value={roleLabel(userQuery.data?.role)}
          subtitle={userQuery.data?.tenantId ?? '当前租户暂不可用'}
          icon={<LifeBuoy className="h-5 w-5 text-sky-300" />}
        />
        <StatusCard
          title="在线节点"
          value={fleetQuery.data ? `${fleetQuery.data.onlineCount}/${fleetQuery.data.totalCount}` : '-'}
          subtitle={fleetQuery.data ? `当前利用率 ${fleetQuery.data.utilizationPercent}%` : '等待执行网络返回数据'}
          icon={<ShieldCheck className="h-5 w-5 text-emerald-300" />}
        />
        <StatusCard
          title="AI 服务"
          value={aiHealthQuery.data?.ok ? '健康' : '降级'}
          subtitle={aiHealthQuery.data?.baseUrl ?? '尚未连接 AI 子服务'}
          icon={<Bot className="h-5 w-5 text-amber-300" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatusCard
          title="通知模式"
          value={notificationModeLabel(notificationQuery.data?.notifications.mode)}
          subtitle={notificationQuery.data?.notifications.smtp?.configured ? 'SMTP 已配置' : 'SMTP 尚未配置'}
          icon={<Sparkles className="h-5 w-5 text-fuchsia-300" />}
        />
        <StatusCard
          title="Feishu 回调"
          value={feishuReadinessQuery.data?.ready ? '已就绪' : '未就绪'}
          subtitle={feishuReadinessQuery.data?.callback_url || '缺少公网 callback 地址'}
          icon={<Wrench className="h-5 w-5 text-cyan-300" />}
        />
      </div>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-4 text-lg font-semibold text-white">快捷路径</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {quickLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl border border-white/8 bg-slate-950/40 p-4 transition hover:border-cyan-500/45 hover:bg-slate-950/70"
            >
              <div className="flex items-center gap-2 text-slate-100">
                {item.icon}
                <span className="font-medium">{item.title}</span>
              </div>
              <p className="mt-2 text-sm leading-7 text-slate-300">{item.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatusCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
    </div>
  );
}
