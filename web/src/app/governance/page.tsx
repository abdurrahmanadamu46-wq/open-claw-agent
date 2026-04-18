'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Shield } from 'lucide-react';
import {
  SurfaceHero,
  SurfaceLinkCard,
  SurfaceMetric,
  SurfaceSection,
} from '@/components/operations/SurfacePrimitives';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';
import { fetchCommercialReadiness } from '@/services/endpoints/ai-subservice';

const GOVERNANCE_LINKS = [
  { title: LEARNING_LOOP_ROUTES.tenantCockpit.title, description: '按后端稳定 schema 聚合策略、任务、成本、图谱、能力、治理预览和学习闭环摘要。', href: LEARNING_LOOP_ROUTES.tenantCockpit.href },
  { title: LEARNING_LOOP_ROUTES.report.title, description: LEARNING_LOOP_ROUTES.report.description, href: LEARNING_LOOP_ROUTES.report.href },
  { title: LEARNING_LOOP_ROUTES.frontendGaps.title, description: '把入口边界、联调风险、QA 清单和 contract 缺口收成一张辅助总表。', href: LEARNING_LOOP_ROUTES.frontendGaps.href },
  { title: '能力路由预览', description: '把 governance.capability_routes_preview 做成列表页跳详情。', href: '/governance/capability-routes' },
  { title: '平台反馈预览', description: '把 governance.platform_feedback_preview 做成列表页跳详情。', href: '/governance/platform-feedback' },
  { title: '审批中心', description: '高风险动作、人工确认和放行都从这里统一处理。', href: '/operations/autopilot/approvals' },
  { title: '风险与告警', description: '集中看异常链路、告警规则和当前冒烟位置。', href: '/operations/alerts' },
  { title: '审计日志', description: '把变更、恢复、配置差异和实体操作统一留痕。', href: '/settings/audit' },
  { title: '权限管理', description: '资源级 RBAC 与角色矩阵。', href: '/settings/permissions' },
  { title: '策略治理', description: '治理规则、bundle 发布和决策模拟。', href: '/settings/policies' },
  { title: '上线闸门', description: '商业化切真、通知链路和外部集成阻塞项。', href: '/settings/commercial-readiness' },
] as const;

export default function GovernanceOverviewPage() {
  const readinessQuery = useQuery({
    queryKey: ['governance', 'commercial-readiness'],
    queryFn: fetchCommercialReadiness,
    retry: false,
    staleTime: 60_000,
  });

  const readiness = readinessQuery.data?.readiness;
  const blockerCount = Number(readiness?.blocker_count ?? 0);
  const deployMode = readiness?.deploy.mode || '待确认';
  const deployRegion = readiness?.deploy.region || '待确认';
  const paymentProvider = readiness?.payment.provider || '未配置';
  const paymentCheckout = readiness?.payment.checkout || '未配置';
  const notificationMode = readiness?.notifications.mode || '待确认';
  const smtpConfigured = readiness?.notifications.smtp?.configured === true;
  const feishuEnabled = readiness?.feishu.enabled === true;
  const feishuCallback = readiness?.feishu.callback_url || '缺少 callback 地址';

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <SurfaceHero
        eyebrow="治理中心"
        title="审批、风险、审计、权限和上线闸门统一收口"
        description="治理中心不再只是旧设置页集合，而是帮助 operator 和前端工程师一眼看清什么可以继续推进、什么需要人工确认、什么必须先补接口或补治理。"
      />

      <section className="grid gap-4 md:grid-cols-3">
        <SurfaceMetric
          label="当前闸门状态"
          value={readiness?.status || 'unknown'}
          helper={`就绪度 ${Number(readiness?.score ?? 0)}`}
          icon={<Shield className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="阻塞项"
          value={String(blockerCount)}
          helper={blockerCount > 0 ? '需要人工协同推进' : '当前没有硬阻塞'}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <SurfaceMetric
          label="治理目标"
          value="审计先于自动化"
          helper="任何新动作都要能解释、能留痕、能回退"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceMetric label="部署模式" value={deployMode} helper={`region ${deployRegion}`} />
        <SurfaceMetric label="支付提供方" value={paymentProvider} helper={`checkout ${paymentCheckout}`} />
        <SurfaceMetric label="通知模式" value={notificationMode} helper={smtpConfigured ? 'SMTP 已配置' : 'SMTP 待配置'} />
        <SurfaceMetric label="Feishu 回调" value={feishuEnabled ? '已启用' : '未启用'} helper={feishuCallback} />
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {GOVERNANCE_LINKS.map((item) => (
          <SurfaceLinkCard
            key={item.href}
            href={item.href}
            title={item.title}
            description={item.description}
            compact
          />
        ))}
      </div>

      <SurfaceSection title="学习闭环入口" description="治理中心除了审批、告警和权限，也应该能直达学习闭环的验收与总收口入口。">
        <div className="grid gap-4 md:grid-cols-2">
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.acceptance.href}
            title={LEARNING_LOOP_ROUTES.acceptance.title}
            description={LEARNING_LOOP_ROUTES.acceptance.description}
            compact
          />
          <SurfaceLinkCard
            href={LEARNING_LOOP_ROUTES.projectCloseout.href}
            title={LEARNING_LOOP_ROUTES.projectCloseout.title}
            description={LEARNING_LOOP_ROUTES.projectCloseout.description}
            compact
          />
        </div>
      </SurfaceSection>

      <SurfaceSection title="上线闸门镜像" description="治理中心会优先说明当前是可以继续交付，还是应该先补阻塞项。">
        <div className="rounded-2xl border px-4 py-4 text-sm text-slate-200">
          {blockerCount > 0 ? (
            <>
              <AlertTriangle className="mb-2 h-4 w-4 text-amber-300" />
              {`当前仍有阻塞项。建议优先推进审批、通知、回调链路和${LEARNING_LOOP_ROUTES.frontendGaps.title}里的接口补齐，再继续扩大交付和演示范围。`}
            </>
          ) : (
            <>
              <CheckCircle2 className="mb-2 h-4 w-4 text-emerald-300" />
              {`当前没有硬阻塞，可以继续推进真实交付和租户放量，但仍建议跟着${LEARNING_LOOP_ROUTES.frontendGaps.title}逐步把组合态页面收掉。`}
            </>
          )}
        </div>
      </SurfaceSection>
    </div>
  );
}
