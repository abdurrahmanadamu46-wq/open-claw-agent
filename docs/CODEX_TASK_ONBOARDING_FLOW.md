# CODEX TASK: 产品转化闭环 — Onboarding + 邮件认证 + 升级 CTA
> 优先级：P0 | 来源：open-saas template/app/src/auth/ + payment/ + demo-ai-app/
> 目标：打通"官网→注册→引导→首任务→升级"完整 SaaS 转化路径

---

## 任务背景

当前缺口：
- 用户注册后直接进 dashboard，没有引导流程
- 没有邮件验证流
- 用量接近上限时没有升级 CTA
- 付款成功后没有确认页 + 欢迎邮件

来源借鉴：
- open-saas `auth/email-and-pass/` → 邮件验证 + 密码重置完整流程
- open-saas `demo-ai-app/operations.ts` → GPT 调用前的配额校验 + 积分扣减模式
- open-saas `payment/operations.ts` → generateCheckoutSession + getCustomerPortalUrl

---

## 目标产物

```
src/
├── components/onboarding/
│   ├── OnboardingFlow.tsx       ← 4步引导流（首次登录触发）
│   ├── OnboardingStep.tsx       ← 单步组件（progress + content + actions）
│   ├── StepConnectAccount.tsx   ← 步骤1：连接社媒账号
│   ├── StepSelectLobster.tsx    ← 步骤2：选择第一只龙虾
│   ├── StepFirstTask.tsx        ← 步骤3：发第一个任务
│   └── StepDone.tsx             ← 步骤4：完成（进入 dashboard）
│
├── components/billing/
│   ├── UsageGauge.tsx           ← 用量进度条（已用/上限）
│   ├── UpgradeCTA.tsx           ← 升级提示横幅/弹窗
│   ├── PricingModal.tsx         ← 快速查看计划对比
│   └── CheckoutSuccess.tsx      ← 付款成功页
│
└── hooks/
    ├── useOnboarding.ts         ← onboarding 状态管理
    └── useBillingQuota.ts       ← 用量配额 hook
```

---

## 实现规范

### 1. OnboardingFlow.tsx — 首次登录引导

```tsx
// src/components/onboarding/OnboardingFlow.tsx
// 触发时机：用户首次登录（onboarding_completed = false）

import { useState, useEffect } from 'react';
import { useOnboarding } from '@/hooks/useOnboarding';

const STEPS = [
  { id: 'connect', title: '连接账号', description: '连接你的第一个社媒账号', icon: '🔗' },
  { id: 'lobster', title: '选择龙虾', description: '选择你的第一只 AI 助手',  icon: '🦞' },
  { id: 'task',    title: '第一个任务', description: '让龙虾帮你完成一件事',   icon: '🎯' },
  { id: 'done',    title: '准备好了！', description: '开始使用龙虾池',  icon: '🎉' },
];

export function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const { markComplete } = useOnboarding();

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      markComplete();
      onComplete();
    }
  };

  const handleSkip = () => {
    markComplete();
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Progress Bar */}
        <div className="h-1.5 bg-gray-100">
          <div
            className="h-full bg-brand-500 transition-all duration-500"
            style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Steps Indicator */}
        <div className="flex items-center justify-center gap-2 pt-6 px-6">
          {STEPS.map((step, i) => (
            <div key={step.id} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                transition-colors ${i <= currentStep
                  ? 'bg-brand-500 text-white'
                  : 'bg-gray-100 text-gray-400'}`}>
                {i < currentStep ? '✓' : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-0.5 ${i < currentStep ? 'bg-brand-500' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="px-8 py-6">
          <div className="text-center mb-6">
            <div className="text-5xl mb-4">{STEPS[currentStep].icon}</div>
            <h2 className="text-xl font-bold text-gray-900">{STEPS[currentStep].title}</h2>
            <p className="text-gray-500 mt-1">{STEPS[currentStep].description}</p>
          </div>

          {/* Step-specific content */}
          {currentStep === 0 && <StepConnectAccount onDone={handleNext} />}
          {currentStep === 1 && <StepSelectLobster onDone={handleNext} />}
          {currentStep === 2 && <StepFirstTask onDone={handleNext} />}
          {currentStep === 3 && <StepDone onDone={handleNext} />}
        </div>

        {/* Footer */}
        <div className="px-8 pb-6 flex justify-between">
          <button
            onClick={handleSkip}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            跳过引导
          </button>
          <span className="text-sm text-gray-400">
            {currentStep + 1} / {STEPS.length}
          </span>
        </div>
      </div>
    </div>
  );
}
```

### 2. useOnboarding.ts — 状态管理

```tsx
// src/hooks/useOnboarding.ts
import { useState, useEffect } from 'react';

interface OnboardingState {
  completed: boolean;
  currentStep: number;
  steps: {
    connect_account: boolean;
    select_lobster: boolean;
    first_task: boolean;
  };
}

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(() => {
    // 从 localStorage 或 API 读取
    const saved = localStorage.getItem('onboarding_state');
    if (saved) return JSON.parse(saved);
    return {
      completed: false,
      currentStep: 0,
      steps: { connect_account: false, select_lobster: false, first_task: false },
    };
  });

  const shouldShowOnboarding = !state.completed;

  const markStepDone = (step: keyof OnboardingState['steps']) => {
    setState((prev) => {
      const next = { ...prev, steps: { ...prev.steps, [step]: true } };
      localStorage.setItem('onboarding_state', JSON.stringify(next));
      return next;
    });
  };

  const markComplete = async () => {
    const next = { ...state, completed: true };
    setState(next);
    localStorage.setItem('onboarding_state', JSON.stringify(next));
    // 同步到后端
    await fetch('/api/user/onboarding-complete', { method: 'POST' });
  };

  return { state, shouldShowOnboarding, markStepDone, markComplete };
}
```

### 3. UsageGauge.tsx — 用量进度条

```tsx
// src/components/billing/UsageGauge.tsx
// 仿 open-saas 的 credits 扣减 + 配额展示

interface UsageGaugeProps {
  metric: string;        // "tokens" / "posts" / "accounts"
  used: number;
  limit: number;
  label: string;
  unit?: string;
  onUpgrade?: () => void;
}

export function UsageGauge({ metric, used, limit, label, unit = '', onUpgrade }: UsageGaugeProps) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const isWarning = pct >= 80;
  const isCritical = pct >= 95;

  const barColor = isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-brand-500';
  const textColor = isCritical ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-gray-600';

  const formatNum = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
    : String(n);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className={`font-medium ${textColor}`}>
          {formatNum(used)}{unit} / {formatNum(limit)}{unit}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isCritical && onUpgrade && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-red-600">配额即将用尽！</span>
          <button
            onClick={onUpgrade}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            立即升级 →
          </button>
        </div>
      )}
      {isWarning && !isCritical && (
        <span className="text-xs text-amber-600">已用 {pct.toFixed(0)}%，建议升级计划</span>
      )}
    </div>
  );
}
```

### 4. UpgradeCTA.tsx — 升级提示组件

```tsx
// src/components/billing/UpgradeCTA.tsx
// 仿 open-saas 的 credits 不足提示

type CTAVariant = 'banner' | 'inline' | 'gate';

interface UpgradeCTAProps {
  variant?: CTAVariant;
  reason?: string;          // "龙虾并发上限" / "账号数量上限"
  currentPlan?: string;
  onUpgrade?: () => void;
  onDismiss?: () => void;
}

export function UpgradeCTA({
  variant = 'banner',
  reason = '功能限制',
  currentPlan = '免费版',
  onUpgrade,
  onDismiss,
}: UpgradeCTAProps) {
  if (variant === 'gate') {
    // 功能门控：灰掉整个区域，中间显示升级提示
    return (
      <div className="relative">
        <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 
                        flex flex-col items-center justify-center rounded-xl">
          <div className="text-center px-6">
            <div className="text-3xl mb-3">🔒</div>
            <h3 className="font-semibold text-gray-900 mb-1">{reason}</h3>
            <p className="text-sm text-gray-500 mb-4">当前计划（{currentPlan}）不支持此功能</p>
            <button
              onClick={onUpgrade}
              className="px-5 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600"
            >
              升级解锁
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
        <span className="text-amber-500 flex-shrink-0">⚡</span>
        <p className="text-sm text-amber-800 flex-1">{reason} — 升级到成长版解锁更多</p>
        <button
          onClick={onUpgrade}
          className="flex-shrink-0 text-sm font-medium text-amber-800 border border-amber-400 
                     px-3 py-1 rounded-lg hover:bg-amber-100"
        >
          升级
        </button>
      </div>
    );
  }

  // banner（默认）
  return (
    <div className="flex items-center gap-4 px-5 py-3 bg-gradient-to-r from-brand-500 to-brand-600 
                    text-white rounded-xl shadow-sm">
      <span className="text-xl flex-shrink-0">🚀</span>
      <div className="flex-1">
        <p className="font-medium text-sm">升级到成长版</p>
        <p className="text-xs text-brand-100">{reason}</p>
      </div>
      <button
        onClick={onUpgrade}
        className="flex-shrink-0 px-4 py-1.5 bg-white text-brand-600 rounded-lg text-sm font-semibold hover:bg-brand-50"
      >
        立即升级
      </button>
      {onDismiss && (
        <button onClick={onDismiss} className="text-brand-200 hover:text-white ml-1">✕</button>
      )}
    </div>
  );
}
```

### 5. useBillingQuota.ts — 用量配额 Hook

```tsx
// src/hooks/useBillingQuota.ts
// 供所有龙虾执行入口使用，前置检查配额

import { useEffect, useState } from 'react';

interface QuotaState {
  tokens: { used: number; limit: number; ok: boolean };
  posts:  { used: number; limit: number; ok: boolean };
  accounts: { used: number; limit: number; ok: boolean };
  lobsters: { used: number; limit: number; ok: boolean };
  loading: boolean;
  tier: string;
}

export function useBillingQuota(tenantId: string) {
  const [quota, setQuota] = useState<QuotaState>({
    tokens:   { used: 0, limit: 500_000, ok: true },
    posts:    { used: 0, limit: 30, ok: true },
    accounts: { used: 0, limit: 1, ok: true },
    lobsters: { used: 0, limit: 1, ok: true },
    loading: true,
    tier: 'basic',
  });

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/tenant/${tenantId}/billing`)
      .then((r) => r.json())
      .then((data) => {
        const plan = data.plan ?? {};
        const usage = data.monthly_usage ?? {};
        setQuota({
          tokens:   { used: usage.tokens ?? 0, limit: plan.max_monthly_tokens ?? 500_000, ok: (usage.tokens ?? 0) < (plan.max_monthly_tokens ?? 500_000) },
          posts:    { used: usage.posts ?? 0,  limit: (plan.max_daily_posts ?? 5) * 30, ok: true },
          accounts: { used: 0, limit: plan.max_accounts ?? 1, ok: true },
          lobsters: { used: 0, limit: plan.max_lobsters ?? 1, ok: true },
          loading: false,
          tier: data.subscription?.tenant_tier ?? 'basic',
        });
      })
      .catch(() => setQuota((q) => ({ ...q, loading: false })));
  }, [tenantId]);

  const isAtLimit = (metric: keyof Omit<QuotaState, 'loading' | 'tier'>) =>
    !quota[metric].ok;

  const pct = (metric: keyof Omit<QuotaState, 'loading' | 'tier'>) => {
    const m = quota[metric];
    return m.limit > 0 ? Math.round((m.used / m.limit) * 100) : 0;
  };

  return { quota, isAtLimit, pct };
}
```

### 6. CheckoutSuccess.tsx — 付款成功页

```tsx
// src/components/billing/CheckoutSuccess.tsx
// 仿 open-saas CheckoutResultPage

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export function CheckoutSuccess() {
  const router = useRouter();
  const { plan } = router.query;

  useEffect(() => {
    // 延迟3秒跳转 dashboard
    const timer = setTimeout(() => router.push('/dashboard'), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">付款成功！</h1>
        <p className="text-gray-500 mb-2">
          欢迎升级到 <strong>{plan ?? '成长版'}</strong>
        </p>
        <p className="text-gray-400 text-sm mb-8">
          你现在拥有更多龙虾、更多账号和更多 Token。
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => router.push('/operations/lobsters')}
            className="px-6 py-3 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600"
          >
            开始使用新功能 →
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            返回 Dashboard
          </button>
        </div>
        <p className="mt-6 text-xs text-gray-300">4秒后自动跳转...</p>
      </div>
    </div>
  );
}
```

---

## 邮件模板（仿 open-saas auth/email-and-pass/emails.ts）

```typescript
// src/email/templates.ts

export const emailTemplates = {
  verificationEmail: (verifyLink: string) => ({
    subject: '验证你的龙虾池账号',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:40px 20px">
        <h1 style="font-size:24px;color:#111827">欢迎加入龙虾池 🦞</h1>
        <p style="color:#6b7280;line-height:1.6">点击下方按钮验证你的邮件地址，开始使用龙虾池 AI 社媒助手。</p>
        <a href="${verifyLink}"
           style="display:inline-block;margin:24px 0;padding:12px 24px;
                  background:#0ea5e9;color:#fff;text-decoration:none;
                  border-radius:8px;font-weight:600">
          验证邮件
        </a>
        <p style="color:#9ca3af;font-size:12px">链接24小时内有效。如果不是你注册的，请忽略此邮件。</p>
      </div>
    `,
  }),

  taskCompleted: (taskName: string, lobsterName: string, resultUrl: string) => ({
    subject: `✅ ${lobsterName} 完成了任务：${taskName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:40px 20px">
        <h2 style="color:#111827">任务完成通知</h2>
        <p style="color:#6b7280"><strong>${lobsterName}</strong> 已完成任务：<strong>${taskName}</strong></p>
        <a href="${resultUrl}"
           style="display:inline-block;margin:20px 0;padding:10px 20px;
                  background:#22c55e;color:#fff;text-decoration:none;border-radius:8px">
          查看任务结果
        </a>
      </div>
    `,
  }),

  upgradeReminder: (currentPlan: string, usagePct: number) => ({
    subject: `⚡ 你的 ${currentPlan} 配额已用 ${usagePct}%`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:40px 20px">
        <h2 style="color:#111827">配额提醒</h2>
        <p style="color:#6b7280">你的 ${currentPlan} 配额已用 <strong>${usagePct}%</strong>。</p>
        <p style="color:#6b7280">升级到成长版，获得更多龙虾、账号和 Token。</p>
        <a href="https://app.lobsterpit.cn/pricing"
           style="display:inline-block;margin:20px 0;padding:12px 24px;
                  background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          查看升级方案
        </a>
      </div>
    `,
  }),
};
```

---

## API 端点（需在 app.py 补充）

```python
# 在 app.py 或 api_governance_routes.py 中补充：

# POST /api/user/onboarding-complete
# 标记用户完成引导
@router.post("/api/user/onboarding-complete")
async def mark_onboarding_complete(request: Request):
    tenant_id = request.headers.get("X-Tenant-Id", "")
    # 更新用户记录
    return {"ok": True}

# GET /api/billing/checkout?plan_id=growth_monthly
# 生成结账会话（仿 open-saas generateCheckoutSession）
@router.get("/api/billing/checkout")
async def generate_checkout(plan_id: str = Query(...), tenant_id: str = Query(...)):
    from saas_billing import get_billing_service, get_plan
    plan = get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "计划不存在")
    # 接入 Stripe/微信/支付宝 生成支付链接
    # 这里返回 mock，实际需接入支付 SDK
    return {
        "ok": True,
        "session_url": f"https://pay.example.com/checkout?plan={plan_id}&tenant={tenant_id}",
        "plan": plan.to_dict(),
    }
```

---

## 验收标准

- [ ] 首次登录后自动弹出 OnboardingFlow（4步）
- [ ] 每步完成后有明确 UI 反馈
- [ ] 可随时跳过引导，下次登录不再弹出
- [ ] UsageGauge 在 Dashboard + Settings/Billing 页展示
- [ ] 用量 ≥80% 时显示黄色警告 + 升级提示
- [ ] 用量 ≥95% 时显示红色警告 + 强制升级 CTA
- [ ] 超过限额时功能门控（UpgradeCTA variant="gate"）
- [ ] 付款成功后跳转 CheckoutSuccess 页
- [ ] 邮件验证流完整（注册→验证邮件→点击→激活）
- [ ] 任务完成邮件通知（可配置开关）

---

## 参考文件

- `f:/openclaw-agent/dragon-senate-saas-v2/saas_billing.py`
- `f:/openclaw-agent/dragon-senate-saas-v2/api_governance_routes.py` (check-quota 端点)
- `f:/openclaw-agent/docs/OPENSAAS_ECOSYSTEM_BORROWING_ANALYSIS.md` 第四章
- open-saas: `template/app/src/payment/operations.ts`
- open-saas: `template/app/src/auth/email-and-pass/emails.ts`
- open-saas: `template/app/src/demo-ai-app/operations.ts`（配额扣减逻辑）
