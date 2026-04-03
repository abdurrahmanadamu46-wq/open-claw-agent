'use client';

import posthog from 'posthog-js';

type EventProperties = Record<string, string | number | boolean | null | undefined>;

let initialized = false;
let identifiedUserId: string | null = null;

function getPosthogConfig() {
  return {
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim(),
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || 'https://app.posthog.com',
  };
}

export function initAnalytics(distinctId?: string): void {
  if (initialized || typeof window === 'undefined') return;

  const { key, host } = getPosthogConfig();
  if (!key) {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug('[analytics] NEXT_PUBLIC_POSTHOG_KEY is missing, analytics disabled');
    }
    return;
  }

  posthog.init(key, {
    api_host: host,
    capture_pageview: false,
    persistence: 'localStorage+cookie',
    person_profiles: 'identified_only',
  });

  initialized = true;
  if (distinctId) {
    identifyUser(distinctId);
  }
}

export function identifyUser(userId: string, props?: EventProperties): void {
  if (!userId || typeof window === 'undefined') return;
  initAnalytics(userId);
  if (!initialized) return;
  if (identifiedUserId === userId) return;

  posthog.identify(userId, props);
  identifiedUserId = userId;
}

export function trackEvent(event: string, properties?: EventProperties): void {
  if (typeof window === 'undefined') return;
  initAnalytics();

  if (!initialized) {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug('[analytics:disabled]', event, properties);
    }
    return;
  }

  posthog.capture(event, properties);
}

export function track(event: string, properties?: EventProperties): void {
  trackEvent(event, properties);
}

export function trackPageView(path: string): void {
  trackEvent('$pageview', {
    path,
    distinct_id: identifiedUserId ?? undefined,
  });
}

export function resetAnalytics(): void {
  if (initialized) {
    posthog.reset();
  }
  initialized = false;
  identifiedUserId = null;
}

export const AnalyticsEvent = {
  PAGE_VIEWED: 'page_viewed',
  LOBSTER_RUN_STARTED: 'lobster_run_started',
  LOBSTER_RUN_COMPLETED: 'lobster_run_completed',
  LOBSTER_RUN_FAILED: 'lobster_run_failed',
  SKILL_PUBLISHED: 'skill_published',
  SKILL_APPROVED: 'skill_approved',
  LEAD_CAPTURED: 'lead_captured',
  CAMPAIGN_CREATED: 'campaign_created',
  STRATEGY_GENERATED: 'strategy_generated',
  STRATEGY_SUBMITTED: 'strategy_submitted',
  STRATEGY_INTENSITY_ADJUSTED: 'strategy_intensity_adjusted',
  INDUSTRY_SELECTED: 'industry_selected',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  ONBOARDING_FINISHED: 'onboarding_finished',
  FEISHU_WEBHOOK_SAVED: 'feishu_webhook_saved',
  CONTENT_APPROVED: 'content_approved',
  CONTENT_REJECTED: 'content_rejected',
  WIDGET_SCRIPT_COPIED: 'widget_script_copied',
  WIDGET_PREVIEW_OPENED: 'widget_preview_opened',
  WIDGET_POSITION_CHANGED: 'widget_position_changed',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];
