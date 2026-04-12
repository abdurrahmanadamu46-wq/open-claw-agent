import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, type Method } from 'axios';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { getBooleanEnv, getNumberEnv, getOptionalEnv } from '../config/env';
import type {
  AiPublicAuthMeResponse,
  AiServiceLoginResponse,
  AnalyzeCompetitorInput,
  AnalyticsAttributionResponse,
  AnalyticsFunnelResponse,
  NlQueryPayload,
  NlQueryResponse,
  RunDragonTeamAsyncAccepted,
  RunDragonTeamAsyncStatus,
  RunDragonTeamInput,
  SurveyCreatePayload,
  SurveyReplyResponse,
  SurveyResponsePayload,
  SurveyResult,
  SurveySummary,
} from './ai-subservice.types';

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
} | null;

@Injectable()
export class AiSubserviceService {
  private readonly logger = new Logger(AiSubserviceService.name);
  private readonly baseUrl = getOptionalEnv('DRAGON_AI_BASE_URL') ?? 'http://127.0.0.1:8000';
  private readonly timeoutMs = getNumberEnv('DRAGON_AI_TIMEOUT_MS', 90_000);
  private readonly serviceUsername = getOptionalEnv('DRAGON_AI_SERVICE_USERNAME') ?? 'admin';
  private readonly servicePassword = getOptionalEnv('DRAGON_AI_SERVICE_PASSWORD') ?? 'change_me';
  private readonly requireHitl = getBooleanEnv('COMPLIANCE_REQUIRE_HITL', true);

  private readonly http: AxiosInstance = axios.create({
    baseURL: this.baseUrl,
    timeout: this.timeoutMs,
  });

  private tokenCache: TokenCache = null;

  private async getServiceToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.tokenCache && this.tokenCache.expiresAtMs > now + 15_000) {
      return this.tokenCache.accessToken;
    }

    try {
      const { data } = await this.http.post<AiServiceLoginResponse>('/auth/login', {
        username: this.serviceUsername,
        password: this.servicePassword,
      });
      const accessToken = String(data?.access_token ?? '').trim();
      if (!accessToken) {
        throw new Error('empty access_token');
      }
      const expiresInSec = Math.max(60, Number(data?.expires_in ?? 3600));
      this.tokenCache = {
        accessToken,
        expiresAtMs: now + expiresInSec * 1000,
      };
      return accessToken;
    } catch (error) {
      this.logger.error(`[ai-subservice] login failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new BadGatewayException('AI subservice login failed');
    }
  }

  private async authedRequest<T>(
    method: Method,
    path: string,
    payload?: unknown,
    query?: Record<string, unknown>,
    retries = 1,
  ): Promise<T> {
    const token = await this.getServiceToken(false);
    try {
      const { data } = await this.http.request<T>({
        method,
        url: path,
        data: payload,
        params: query,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return data;
    } catch (error) {
      if (retries <= 0) {
        throw new BadGatewayException(`AI subservice request failed: ${path}`);
      }
      const retryToken = await this.getServiceToken(true);
      const { data } = await this.http.request<T>({
        method,
        url: path,
        data: payload,
        params: query,
        headers: {
          Authorization: `Bearer ${retryToken}`,
        },
      });
      return data;
    }
  }

  private async publicRequest<T>(
    method: Method,
    path: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    try {
      const { data } = await this.http.request<T>({
        method,
        url: path,
        data: payload,
        headers,
      });
      return data;
    } catch (error) {
      this.logger.error(`[ai-subservice] public request failed ${path}: ${error instanceof Error ? error.message : String(error)}`);
      throw new BadGatewayException(`AI subservice public request failed: ${path}`);
    }
  }

  private mapProxyError(path: string, error: unknown): never {
    if (axios.isAxiosError(error)) {
      const status = Number(error.response?.status ?? 0);
      const detail = (() => {
        const payload = error.response?.data;
        if (typeof payload === 'string' && payload.trim()) return payload;
        if (payload && typeof payload === 'object') {
          const detailValue = (payload as Record<string, unknown>).detail;
          if (typeof detailValue === 'string' && detailValue.trim()) return detailValue;
        }
        return `AI subservice request failed: ${path}`;
      })();
      if (status === 400) throw new BadRequestException(detail);
      if (status === 401) throw new UnauthorizedException(detail);
      if (status === 403) throw new ForbiddenException(detail);
      if (status === 404) throw new NotFoundException(detail);
    }
    throw new BadGatewayException(`AI subservice request failed: ${path}`);
  }

  private async authedRequestWithUserHeader<T>(
    authHeader: string | undefined,
    method: Method,
    path: string,
    payload?: unknown,
    query?: Record<string, unknown>,
  ): Promise<T> {
    const normalizedHeader = String(authHeader ?? '').trim();
    if (!normalizedHeader.toLowerCase().startsWith('bearer ')) {
      return this.authedRequest<T>(method, path, payload, query);
    }
    try {
      const { data } = await this.http.request<T>({
        method,
        url: path,
        data: payload,
        params: query,
        headers: {
          Authorization: normalizedHeader,
        },
      });
      return data;
    } catch (error) {
      this.mapProxyError(path, error);
    }
  }

  private async authedStreamRequest(path: string, retries = 1): Promise<any> {
    const token = await this.getServiceToken(false);
    try {
      return await this.http.request({
        method: 'GET',
        url: path,
        responseType: 'stream',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
      });
    } catch (error) {
      if (retries <= 0) {
        throw new BadGatewayException(`AI subservice stream request failed: ${path}`);
      }
      const retryToken = await this.getServiceToken(true);
      return this.http.request({
        method: 'GET',
        url: path,
        responseType: 'stream',
        headers: {
          Authorization: `Bearer ${retryToken}`,
          Accept: 'text/event-stream',
        },
      });
    }
  }

  async publicPasswordLogin(input: { username: string; password: string }): Promise<AiServiceLoginResponse> {
    return this.publicRequest<AiServiceLoginResponse>('POST', '/auth/login', {
      username: input.username,
      password: input.password,
    });
  }

  async publicRegister(input: {
    email: string;
    password: string;
    username?: string;
    tenant_id?: string;
    roles?: string[];
  }): Promise<Record<string, unknown>> {
    return this.publicRequest<Record<string, unknown>>('POST', '/auth/register', {
      email: input.email,
      password: input.password,
      username: input.username,
      tenant_id: input.tenant_id,
      roles: input.roles ?? ['member'],
      is_active: true,
      is_verified: true,
      is_superuser: false,
    });
  }

  async publicAuthMe(accessToken: string): Promise<AiPublicAuthMeResponse> {
    return this.publicRequest<AiPublicAuthMeResponse>('GET', '/auth/me', undefined, {
      Authorization: `Bearer ${accessToken}`,
    });
  }

  async publicForgotPassword(email: string): Promise<Record<string, unknown>> {
    return this.publicRequest<Record<string, unknown>>('POST', '/auth/forgot-password', {
      email,
    });
  }

  async publicResetPassword(input: { token: string; password: string }): Promise<Record<string, unknown>> {
    return this.publicRequest<Record<string, unknown>>('POST', '/auth/reset-password', {
      token: input.token,
      password: input.password,
    });
  }

  getStrategyIntensity(input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/strategy/intensity',
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  getStrategyIntensityHistory(input?: {
    tenant_id?: string;
    lobster_id?: string;
    days?: number;
    limit?: number;
  }): Promise<Record<string, unknown>> {
    const query: Record<string, string | number> = {};
    if (input?.tenant_id) {
      query.tenant_id = input.tenant_id;
    }
    if (input?.lobster_id) {
      query.lobster_id = input.lobster_id;
    }
    if (typeof input?.days === 'number') {
      query.days = input.days;
    }
    if (typeof input?.limit === 'number') {
      query.limit = input.limit;
    }
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/strategy/intensity/history',
      undefined,
      query,
    );
  }

  escalateStrategyIntensity(input?: { tenant_id?: string; lobster_id?: string; reason?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      '/api/strategy/intensity/escalate',
      input ?? {},
    );
  }

  deescalateStrategyIntensity(input?: { tenant_id?: string; lobster_id?: string; reason?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      '/api/strategy/intensity/deescalate',
      input ?? {},
    );
  }

  runDragonTeam(input: RunDragonTeamInput): Promise<Record<string, unknown>> {
    if (!input.task_description?.trim()) {
      throw new BadRequestException('task_description is required');
    }
    if (this.requireHitl && input.execution_mode === 'auto') {
      throw new BadRequestException('Compliance policy blocks full-auto execution. Use assistive mode.');
    }

    return this.authedRequest<Record<string, unknown>>('POST', '/run-dragon-team', {
      task_description: input.task_description,
      user_id: input.user_id,
      industry_tag: input.industry_tag,
      competitor_handles: input.competitor_handles ?? [],
      edge_targets: input.edge_targets ?? [],
      client_preview: input.client_preview ?? {},
      industry_workflow_context: input.industry_workflow_context ?? {},
    });
  }

  runDragonTeamAsync(input: RunDragonTeamInput): Promise<RunDragonTeamAsyncAccepted> {
    if (!input.task_description?.trim()) {
      throw new BadRequestException('task_description is required');
    }
    return this.authedRequest<RunDragonTeamAsyncAccepted>('POST', '/run-dragon-team-async', {
      task_description: input.task_description,
      user_id: input.user_id,
      industry_tag: input.industry_tag,
      competitor_handles: input.competitor_handles ?? [],
      edge_targets: input.edge_targets ?? [],
      client_preview: input.client_preview ?? {},
      industry_workflow_context: input.industry_workflow_context ?? {},
    });
  }

  getRunDragonTeamAsyncStatus(jobId: string): Promise<RunDragonTeamAsyncStatus> {
    return this.authedRequest<RunDragonTeamAsyncStatus>(
      'GET',
      `/run-dragon-team-async/${encodeURIComponent(jobId)}`,
    );
  }

  analyzeCompetitorFormula(input: AnalyzeCompetitorInput): Promise<Record<string, unknown>> {
    if (!input.target_account_url?.trim()) {
      throw new BadRequestException('target_account_url is required');
    }
    return this.authedRequest<Record<string, unknown>>('POST', '/analyze_competitor_formula', {
      target_account_url: input.target_account_url,
      user_id: input.user_id,
      competitor_handles: input.competitor_handles ?? [],
    });
  }

  getUserStatus(userId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', `/status/${encodeURIComponent(userId)}`);
  }

  getBillingPlans(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/billing/plans');
  }

  getBillingSubscription(input: { user_id: string; tenant_id: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/billing/subscription/me',
      undefined,
      {
        user_id: input.user_id,
        tenant_id: input.tenant_id,
      },
    );
  }

  getBillingUsageSummary(input: {
    user_id: string;
    tenant_id: string;
    from_ts?: string;
    to_ts?: string;
  }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {
      user_id: input.user_id,
      tenant_id: input.tenant_id,
    };
    if (input.from_ts) params.from_ts = input.from_ts;
    if (input.to_ts) params.to_ts = input.to_ts;
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/billing/usage/summary',
      undefined,
      params,
    );
  }

  getBillingProvidersStatus(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/billing/providers/status');
  }

  getBillingOrders(input: { user_id: string; tenant_id: string; limit?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/billing/orders',
      undefined,
      {
        user_id: input.user_id,
        tenant_id: input.tenant_id,
        limit: input.limit ?? 50,
      },
    );
  }

  activateBillingTrial(input: {
    user_id: string;
    tenant_id: string;
    plan_code?: string;
    duration_days?: number;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/billing/trial/activate', input);
  }

  createBillingCheckout(input: {
    user_id: string;
    tenant_id: string;
    plan_code: string;
    cycle: string;
    provider?: string;
    return_url?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/billing/checkout', input);
  }

  getBillingCompensation(input: { tenant_id: string; status?: string; limit?: number }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {
      tenant_id: input.tenant_id,
      limit: input.limit ?? 50,
    };
    if (input.status) params.status = input.status;
    return this.authedRequest<Record<string, unknown>>('GET', '/billing/compensation', undefined, params);
  }

  resolveBillingCompensationTask(input: { task_id: string; status: string; notes?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/billing/compensation/${encodeURIComponent(input.task_id)}/resolve`,
      {
        status: input.status,
        notes: input.notes,
      },
    );
  }

  runBillingReconciliation(input: {
    provider?: string;
    tenant_id?: string;
    stale_minutes?: number;
    lookback_days?: number;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/billing/reconcile/run', input);
  }

  getBillingWebhookEvents(input: { tenant_id: string; limit?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/billing/webhook/events',
      undefined,
      {
        tenant_id: input.tenant_id,
        limit: input.limit ?? 50,
      },
    );
  }

  getSeatBillingPlans(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/billing/seats/plans');
  }

  getSeatBillingSubscription(input: { tenant_id: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/billing/seats/subscription', undefined, input);
  }

  createSeatBillingSubscription(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/billing/seats/subscription', input);
  }

  createSeatBillingCheckout(subscriptionId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/billing/seats/subscription/${encodeURIComponent(subscriptionId)}/checkout`,
      input,
    );
  }

  upgradeSeatBillingSubscription(subscriptionId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/billing/seats/subscription/${encodeURIComponent(subscriptionId)}/upgrade`,
      input,
    );
  }

  getSeatQuotaSummary(tenantId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', `/billing/seats/quotas/${encodeURIComponent(tenantId)}`);
  }

  registerPartner(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/partner/register', input);
  }

  getPartnerDashboard(agentId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/partner/dashboard', undefined, { agent_id: agentId });
  }

  getPartnerSeats(agentId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/partner/seats', undefined, { agent_id: agentId });
  }

  assignPartnerSeat(agentId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/partner/seats/assign', input, { agent_id: agentId });
  }

  upgradePartner(agentId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/partner/upgrade', input, { agent_id: agentId });
  }

  getPartnerWhiteLabel(agentId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/partner/white-label', undefined, { agent_id: agentId });
  }

  updatePartnerWhiteLabel(agentId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('PUT', '/partner/white-label', input, { agent_id: agentId });
  }

  createPartnerSubAgent(agentId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/partner/sub-agents', input, { agent_id: agentId });
  }

  getPartnerSubAgentTree(agentId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/partner/sub-agents/tree', undefined, { agent_id: agentId });
  }

  getPartnerStatements(agentId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/partner/statements', undefined, { agent_id: agentId });
  }

  getPartnerStatementDetail(agentId: string, period: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/partner/statements/${encodeURIComponent(period)}`,
      undefined,
      { agent_id: agentId },
    );
  }

  confirmPartnerStatement(agentId: string, period: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/partner/statements/${encodeURIComponent(period)}/confirm`,
      input,
      { agent_id: agentId },
    );
  }

  disputePartnerStatement(agentId: string, period: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/partner/statements/${encodeURIComponent(period)}/dispute`,
      input,
      { agent_id: agentId },
    );
  }

  getPartnerProfitForecast(agentId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/partner/profit-forecast', undefined, { agent_id: agentId });
  }

  getAdminResources(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/admin/resources');
  }

  getAdminList(resource: string, query?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', `/api/admin/${encodeURIComponent(resource)}`, undefined, query);
  }

  getAdminOne(resource: string, id: string, query?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/admin/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`,
      undefined,
      query,
    );
  }

  createAdminItem(resource: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', `/api/admin/${encodeURIComponent(resource)}`, input);
  }

  updateAdminItem(resource: string, id: string, input: Record<string, unknown>, query?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/admin/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`,
      input,
      query,
    );
  }

  deleteAdminItem(resource: string, id: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('DELETE', `/api/admin/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`);
  }

  getKernelReport(traceId: string, userId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/kernel/report/${encodeURIComponent(traceId)}`,
      undefined,
      { user_id: userId },
    );
  }

  listKernelReports(userId: string, limit = 50): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/kernel/reports',
      undefined,
      { user_id: userId, limit },
    );
  }

  rollbackKernelReport(input: {
    traceId: string;
    userId: string;
    stage: 'preflight' | 'postgraph';
    dryRun?: boolean;
    approval_id?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/kernel/report/${encodeURIComponent(input.traceId)}/rollback`,
      {
        stage: input.stage,
        dry_run: input.dryRun !== false,
        approval_id: input.approval_id,
      },
      { user_id: input.userId },
    );
  }

  getKernelRolloutPolicy(tenantId?: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/kernel/rollout/policy',
      undefined,
      tenantId ? { tenant_id: tenantId } : undefined,
    );
  }

  getKernelRolloutTemplates(input?: { tenant_id?: string; limit?: number }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input?.tenant_id) params.tenant_id = input.tenant_id;
    if (typeof input?.limit === 'number' && Number.isFinite(input.limit)) {
      params.limit = input.limit;
    }
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/kernel/rollout/templates',
      undefined,
      params,
    );
  }

  exportKernelRolloutTemplates(input?: { tenant_id?: string; limit?: number }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input?.tenant_id) params.tenant_id = input.tenant_id;
    if (typeof input?.limit === 'number' && Number.isFinite(input.limit)) {
      params.limit = input.limit;
    }
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/kernel/rollout/templates/export',
      undefined,
      params,
    );
  }

  saveKernelRolloutTemplate(input: {
    tenant_id?: string;
    template_key?: string;
    template_name: string;
    risk_rollout: Record<string, unknown>;
    note?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/kernel/rollout/templates', input);
  }

  importKernelRolloutTemplates(input: {
    tenant_id?: string;
    source_tenant_id?: string;
    mode?: 'upsert' | 'skip_existing' | 'replace_all';
    templates: Array<{
      template_key?: string;
      template_name: string;
      risk_rollout?: Record<string, unknown>;
      note?: string;
    }>;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/kernel/rollout/templates/import', input);
  }

  renameKernelRolloutTemplate(input: {
    tenant_id?: string;
    template_key: string;
    new_template_key?: string;
    template_name?: string;
    note?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PATCH',
      `/kernel/rollout/templates/${encodeURIComponent(input.template_key)}`,
      {
        tenant_id: input.tenant_id,
        new_template_key: input.new_template_key,
        template_name: input.template_name,
        note: input.note,
      },
    );
  }

  deleteKernelRolloutTemplate(input: {
    tenant_id?: string;
    template_key: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/kernel/rollout/templates/${encodeURIComponent(input.template_key)}`,
      undefined,
      input.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  updateKernelRolloutPolicy(input: {
    tenant_id?: string;
    enabled: boolean;
    rollout_ratio: number;
    block_mode: 'hitl' | 'deny';
    risk_rollout?: Record<string, unknown>;
    window_start_utc?: string;
    window_end_utc?: string;
    note?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('PUT', '/kernel/rollout/policy', input);
  }

  getKernelMetricsDashboard(input: {
    tenant_id?: string;
    from?: string;
    to?: string;
    granularity?: 'hour' | 'day';
  }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input.tenant_id) params.tenant_id = input.tenant_id;
    if (input.from) params.from = input.from;
    if (input.to) params.to = input.to;
    if (input.granularity) params.granularity = input.granularity;
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/kernel/metrics/dashboard',
      undefined,
      params,
    );
  }

  getKernelAlerts(input?: {
    tenant_id?: string;
    from?: string;
    to?: string;
    granularity?: 'hour' | 'day';
  }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input?.tenant_id) params.tenant_id = input.tenant_id;
    if (input?.from) params.from = input.from;
    if (input?.to) params.to = input.to;
    if (input?.granularity) params.granularity = input.granularity;
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/kernel/alerts/evaluate',
      undefined,
      params,
    );
  }

  getLlmModelCatalog(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/llm/model/catalog');
  }

  getLlmProviderConfigs(input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/llm/providers',
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  updateLlmProviderConfig(
    providerId: string,
    input: {
      tenant_id?: string;
      enabled: boolean;
      route: 'local' | 'cloud';
      base_url: string;
      default_model: string;
      api_key?: string | null;
      note?: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/llm/providers/${encodeURIComponent(providerId)}`,
      input,
    );
  }

  getLlmAgentBindings(input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/llm/agent-bindings',
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  updateLlmAgentBinding(
    agentId: string,
    input: {
      tenant_id?: string;
      enabled: boolean;
      task_type: string;
      provider_id: string;
      model_name: string;
      temperature: number;
      max_tokens: number;
      note?: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/llm/agent-bindings/${encodeURIComponent(agentId)}`,
      input,
    );
  }

  getAgentExtensions(input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/agent/extensions',
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  getAgentExtensionProfile(agentId: string, input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/agent/extensions/${encodeURIComponent(agentId)}`,
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  updateAgentExtensionProfile(
    agentId: string,
    input: {
      tenant_id?: string;
      enabled: boolean;
      profile_version: string;
      runtime_mode: 'local' | 'cloud' | 'hybrid';
      role_prompt?: string;
      skills?: Array<Record<string, unknown>>;
      nodes?: Array<Record<string, unknown>>;
      hooks?: Record<string, unknown>;
      limits?: Record<string, unknown>;
      tags?: string[];
    },
  ): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/agent/extensions/${encodeURIComponent(agentId)}`,
      input,
    );
  }

  getSkillsPoolOverview(input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/skills-pool/overview',
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  getUsecases(input?: { category?: string; difficulty?: string }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input?.category) params.category = input.category;
    if (input?.difficulty) params.difficulty = input.difficulty;
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/usecases',
      undefined,
      params,
    );
  }

  getUsecaseCategories(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/usecases/categories',
    );
  }

  getUsecase(usecaseId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/usecases/${encodeURIComponent(usecaseId)}`,
    );
  }

  getWorkflowDefinitions(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/workflow/list');
  }

  startWorkflowRun(input: {
    workflow_id: string;
    task: string;
    industry?: string;
    industry_tag?: string;
    context?: Record<string, unknown>;
    notify_url?: string;
    idempotency_key?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/workflow/run', input);
  }

  getWorkflowRun(runId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/workflow/run/${encodeURIComponent(runId)}`,
    );
  }

  resumeWorkflowRun(runId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/workflow/run/${encodeURIComponent(runId)}/resume`,
      {},
    );
  }

  pauseWorkflowRun(runId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/workflow/run/${encodeURIComponent(runId)}/pause`,
      {},
    );
  }

  listWorkflowRuns(input?: { limit?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/workflow/runs',
      undefined,
      input?.limit ? { limit: Math.max(1, Math.min(input.limit, 200)) } : undefined,
    );
  }

  getProviderHealth(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/providers/health');
  }

  listProviders(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/providers');
  }

  listFeatureFlags(input?: { environment?: string; tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/feature-flags',
      undefined,
      input,
    );
  }

  createFeatureFlag(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/feature-flags', input);
  }

  getFeatureFlag(name: string, input?: { environment?: string; tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/feature-flags/${encodeURIComponent(name)}`,
      undefined,
      input,
    );
  }

  updateFeatureFlag(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/feature-flags/${encodeURIComponent(name)}`,
      input,
    );
  }

  deleteFeatureFlag(name: string, input?: { environment?: string; tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/v1/feature-flags/${encodeURIComponent(name)}`,
      undefined,
      input,
    );
  }

  enableFeatureFlag(name: string, input?: { environment?: string; tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/feature-flags/${encodeURIComponent(name)}/enable`,
      {},
      input,
    );
  }

  disableFeatureFlag(name: string, input?: { environment?: string; tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/feature-flags/${encodeURIComponent(name)}/disable`,
      {},
      input,
    );
  }

  updateFeatureFlagStrategies(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/feature-flags/${encodeURIComponent(name)}/strategies`,
      input,
    );
  }

  updateFeatureFlagVariants(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/feature-flags/${encodeURIComponent(name)}/variants`,
      input,
    );
  }

  checkFeatureFlag(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/feature-flags/check', input);
  }

  getFeatureFlagChangelog(input?: { name?: string; limit?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/feature-flags/changelog', undefined, input);
  }

  exportFeatureFlags(input?: { environment?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/feature-flags/export', undefined, input);
  }

  importFeatureFlags(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/feature-flags/import', input);
  }

  listPromptExperiments(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/prompt-experiments');
  }

  createPromptExperiment(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/prompt-experiments', input);
  }

  getPromptExperimentReport(flagName: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/prompt-experiments/${encodeURIComponent(flagName)}/report`,
    );
  }

  promotePromptExperiment(flagName: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/prompt-experiments/${encodeURIComponent(flagName)}/promote`,
      input,
    );
  }

  stopPromptExperiment(flagName: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/prompt-experiments/${encodeURIComponent(flagName)}/stop`,
      {},
    );
  }

  listExperiments(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/experiments');
  }

  createExperiment(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/experiments', input);
  }

  getExperiment(experimentId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/experiments/${encodeURIComponent(experimentId)}`,
    );
  }

  compareExperiments(baseId: string, compareId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/experiments/compare', undefined, {
      a: baseId,
      b: compareId,
    });
  }

  runExperiment(experimentId: string, input?: { concurrency?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/experiments/${encodeURIComponent(experimentId)}/run`,
      input ?? {},
    );
  }

  diffPromptVersions(
    promptName: string,
    input?: { version_a?: string; version_b?: string },
  ): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/prompts/${encodeURIComponent(promptName)}/diff`,
      undefined,
      {
        version_a: input?.version_a,
        version_b: input?.version_b,
      },
    );
  }

  listPrompts(authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/prompts',
    );
  }

  listPromptVersions(promptName: string, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/prompts/${encodeURIComponent(promptName)}/versions`,
    );
  }

  getModules(input?: { lobster_id?: string }, authHeader?: string): Promise<Record<string, unknown>> {
    const query: Record<string, unknown> = {};
    if (input?.lobster_id) {
      query.lobster_id = input.lobster_id;
    }
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/modules',
      undefined,
      query,
    );
  }

  parseFile(input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/v1/files/parse',
      input,
    );
  }

  extractBusinessCard(input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/v1/files/extract-business-card',
      input,
    );
  }

  getMindMap(tenantId: string, leadId: string, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/mind-map/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}`,
    );
  }

  getMindMapQuestions(
    tenantId: string,
    leadId: string,
    input?: { limit?: number },
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    const query: Record<string, unknown> = {};
    if (typeof input?.limit === 'number') {
      query.limit = input.limit;
    }
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/mind-map/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/questions`,
      undefined,
      query,
    );
  }

  getMindMapBriefing(tenantId: string, leadId: string, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/mind-map/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/briefing`,
    );
  }

  updateMindMapNode(
    tenantId: string,
    leadId: string,
    dimension: string,
    input: Record<string, unknown>,
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      `/api/v1/mind-map/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/nodes/${encodeURIComponent(dimension)}`,
      input,
    );
  }

  generateRagTestset(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/rag/testsets/generate', input);
  }

  search(input: { q: string; types?: string; limit?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/search',
      undefined,
      {
        q: input.q,
        types: input.types,
        limit: input.limit,
      },
    );
  }

  getLobsters(input?: { lifecycle?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/lobsters',
      undefined,
      input,
    );
  }

  getLobster(lobsterId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/lobsters/${encodeURIComponent(lobsterId)}`,
    );
  }

  getLobsterStats(lobsterId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/lobsters/${encodeURIComponent(lobsterId)}/stats`,
    );
  }

  getLobsterRuns(
    lobsterId: string,
    input?: { limit?: number; page?: number; page_size?: number; sort_by?: string; sort_dir?: string },
  ): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/lobsters/${encodeURIComponent(lobsterId)}/runs`,
      undefined,
      input,
    );
  }

  getEdgeGroupTree(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/edge/groups/tree');
  }

  getEdgeGroupNodeMap(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/edge/groups/node-map');
  }

  getEdgeGroupNodes(groupId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/edge/groups/${encodeURIComponent(groupId)}/nodes`,
    );
  }

  createEdgeGroup(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/edge/groups', input);
  }

  assignNodeToEdgeGroup(groupId: string, nodeId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/edge/groups/${encodeURIComponent(groupId)}/nodes/${encodeURIComponent(nodeId)}`,
      {},
    );
  }

  removeNodeFromEdgeGroup(groupId: string, nodeId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/v1/edge/groups/${encodeURIComponent(groupId)}/nodes/${encodeURIComponent(nodeId)}`,
    );
  }

  listLobsterTriggerRules(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/lobster-trigger-rules');
  }

  createLobsterTriggerRule(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/lobster-trigger-rules', input);
  }

  updateLobsterTriggerRule(ruleId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/lobster-trigger-rules/${encodeURIComponent(ruleId)}`,
      input,
    );
  }

  deleteLobsterTriggerRule(ruleId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/v1/lobster-trigger-rules/${encodeURIComponent(ruleId)}`,
    );
  }

  evaluateLobsterTriggerRules(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/lobster-trigger-rules/evaluate', {});
  }

  getLobsterMetricsHistory(lobsterName: string, days = 30): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/metrics/lobster/${encodeURIComponent(lobsterName)}/history`,
      undefined,
      { days },
    );
  }

  listLobsterRuns(input?: {
    lobster_id?: string;
    status?: string;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_dir?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/lobsters/runs',
      undefined,
      input,
    );
  }

  getLobsterDocs(lobsterId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/lobsters/${encodeURIComponent(lobsterId)}/docs`,
    );
  }

  getLobsterSkills(lobsterId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/lobsters/${encodeURIComponent(lobsterId)}/skills`,
    );
  }

  getLobsterLifecycle(lobsterId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/lobsters/${encodeURIComponent(lobsterId)}/lifecycle`,
    );
  }

  getLobsterConfigs(tenantId?: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/lobster-config',
      undefined,
      tenantId ? { tenant_id: tenantId } : undefined,
    );
  }

  getLobsterConfig(lobsterId: string, tenantId?: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/lobster-config/${encodeURIComponent(lobsterId)}`,
      undefined,
      tenantId ? { tenant_id: tenantId } : undefined,
    );
  }

  updateLobsterConfig(lobsterId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PATCH',
      `/api/v1/lobster-config/${encodeURIComponent(lobsterId)}`,
      input,
    );
  }

  updateLobsterLifecycle(lobsterId: string, input: { new_lifecycle: string; reason?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/lobsters/${encodeURIComponent(lobsterId)}/lifecycle`,
      input,
    );
  }

  executeLobster(
    lobsterId: string,
    input: {
      prompt: string;
      industry?: string;
      industry_tag?: string;
      execution_mode?: 'foreground' | 'background' | 'auto';
      session_mode?: string;
      peer_id?: string;
      fresh_context?: boolean;
      enable_output_validation?: boolean;
      auto_retry_on_violation?: boolean;
      reply_channel_id?: string;
      reply_chat_id?: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/lobsters/${encodeURIComponent(lobsterId)}/execute`,
      input,
    );
  }

  listSkills(input?: {
    lobster_id?: string;
    category?: string;
    enabled_only?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/skills',
      undefined,
      input,
    );
  }

  getSkillDetail(skillId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/skills/${encodeURIComponent(skillId)}`,
    );
  }

  patchSkillStatus(
    skillId: string,
    input: { status: string; note?: string },
  ): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PATCH',
      `/api/v1/skills/${encodeURIComponent(skillId)}/status`,
      input,
    );
  }

  registerSkillPackage(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      '/api/v1/skills/register',
      input,
    );
  }

  getLobsterQualityStats(lobsterId: string, days = 30): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/lobsters/${encodeURIComponent(lobsterId)}/quality-stats`,
      undefined,
      { days: Math.max(1, Math.min(days, 365)) },
    );
  }

  submitFeedback(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/feedbacks', input);
  }

  getTaskFeedback(taskId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/feedbacks/${encodeURIComponent(taskId)}`,
    );
  }

  exportFeedbackDataset(lobsterId: string, limit = 200): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/feedbacks/export',
      undefined,
      { lobster_id: lobsterId, limit: Math.max(1, Math.min(limit, 1000)) },
    );
  }

  listKnowledgeBases(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/knowledge-bases');
  }

  createKnowledgeBase(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/knowledge-bases', input);
  }

  getKnowledgeBase(kbId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}`,
    );
  }

  uploadKnowledgeBaseDocument(kbId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents`,
      input,
    );
  }

  bindKnowledgeBase(kbId: string, lobsterId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/bind/${encodeURIComponent(lobsterId)}`,
      {},
    );
  }

  searchKnowledgeBase(kbId: string, query: string, topK = 5): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/search`,
      undefined,
      { q: query, top_k: Math.max(1, Math.min(topK, 20)) },
    );
  }

  getWorkflowLifecycle(workflowId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/lifecycle`,
    );
  }

  updateWorkflowLifecycle(
    workflowId: string,
    input: { new_lifecycle: string; reason?: string },
  ): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/lifecycle`,
      input,
    );
  }

  listWorkflowCatalog(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/workflows');
  }

  getWorkflowDetail(workflowId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/workflows/${encodeURIComponent(workflowId)}`,
    );
  }

  updateWorkflowDefinition(workflowId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/workflows/${encodeURIComponent(workflowId)}`,
      input,
    );
  }

  listWorkflowExecutions(
    workflowId: string,
    input?: { page?: number; page_size?: number; status?: string },
  ): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/executions`,
      undefined,
      input,
    );
  }

  getWorkflowExecution(executionId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/workflows/executions/${encodeURIComponent(executionId)}`,
    );
  }

  openWorkflowExecutionStream(executionId: string): Promise<any> {
    return this.authedStreamRequest(
      `/api/v1/workflows/executions/${encodeURIComponent(executionId)}/stream`,
    );
  }

  replayWorkflowExecution(executionId: string, input?: { from_step_id?: string | null }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/workflows/executions/${encodeURIComponent(executionId)}/replay`,
      input ?? {},
    );
  }

  listWorkflowWebhooks(workflowId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/webhooks`,
    );
  }

  createWorkflowWebhook(workflowId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/webhooks`,
      input,
    );
  }

  deleteWorkflowWebhook(workflowId: string, webhookId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/webhooks/${encodeURIComponent(webhookId)}`,
    );
  }

  listWorkflowTemplates(input?: {
    category?: string;
    difficulty?: string;
    featured_only?: boolean;
    search?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/workflow-templates',
      undefined,
      input,
    );
  }

  useWorkflowTemplate(templateId: string, input?: { name?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/workflow-templates/${encodeURIComponent(templateId)}/use`,
      input ?? {},
    );
  }

  createProvider(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/providers', input);
  }

  updateProvider(providerId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/providers/${encodeURIComponent(providerId)}`,
      input,
    );
  }

  deleteProvider(providerId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/v1/providers/${encodeURIComponent(providerId)}`,
    );
  }

  getTenantConcurrencyStats(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/tenant/concurrency-stats');
  }

  getAdminConcurrencyOverview(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/admin/concurrency-overview');
  }

  reloadProvider(providerId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/providers/${encodeURIComponent(providerId)}/reload`,
      {},
    );
  }

  smokeProvider(providerId: string, prompt?: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/providers/${encodeURIComponent(providerId)}/smoke`,
      prompt ? { prompt } : {},
    );
  }

  getProviderMetrics(providerId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/providers/${encodeURIComponent(providerId)}/metrics`,
    );
  }

  listRbacPermissions(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/rbac/permissions');
  }

  createRbacPermission(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/rbac/permissions', input);
  }

  deleteRbacPermission(permissionId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/v1/rbac/permissions/${encodeURIComponent(permissionId)}`,
    );
  }

  listUserRbacPermissions(userId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/rbac/users/${encodeURIComponent(userId)}/permissions`,
    );
  }

  checkRbacPermission(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/rbac/check', input);
  }

  getRbacMatrix(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/rbac/matrix');
  }

  getAuditEventTypes(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/audit/event-types');
  }

  getAuditEvents(input?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/audit/events', undefined, input);
  }

  listObservabilityTraces(input?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/observability/traces', undefined, input);
  }

  getObservabilityTrace(traceId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/observability/traces/${encodeURIComponent(traceId)}`,
    );
  }

  getChartAnnotations(input?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/observability/chart/annotations', undefined, input);
  }

  getEventBusSubjects(input?: { prefix?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/observability/event-bus/subjects',
      undefined,
      input,
    );
  }

  getEventBusPrefixSummary(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/observability/event-bus/prefix-summary',
    );
  }

  queryLogs(input: { sql: string; time_range_hours?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/logs/query', input);
  }

  getLogQueryTemplates(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/logs/templates');
  }

  listAlertRules(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/alerts/rules');
  }

  createAlertRule(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/alerts/rules', input);
  }

  updateAlertRule(ruleId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/alerts/rules/${encodeURIComponent(ruleId)}`,
      input,
    );
  }

  evaluateAlerts(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/alerts/evaluate', {});
  }

  listAlertEvents(limit?: number): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/alerts/events', undefined, limit ? { limit } : undefined);
  }

  listAlertChannels(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/alerts/channels');
  }

  createAlertChannel(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/alerts/channels', input);
  }

  runAuditCleanup(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/audit/cleanup', {});
  }

  getWhiteLabelConfig(tenantId: string): Promise<Record<string, unknown>> {
    return this.publicRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/white-label/${encodeURIComponent(tenantId)}`,
    );
  }

  resolveWhiteLabel(input?: { tenant_id?: string; host?: string }): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (input?.tenant_id) params.set('tenant_id', input.tenant_id);
    if (input?.host) params.set('host', input.host);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.publicRequest<Record<string, unknown>>('GET', `/api/v1/white-label/resolve${suffix}`);
  }

  getWhiteLabelPreview(tenantId: string): Promise<Record<string, unknown>> {
    return this.publicRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/white-label/${encodeURIComponent(tenantId)}/preview`,
    );
  }

  updateWhiteLabelConfig(tenantId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/white-label/${encodeURIComponent(tenantId)}`,
      input,
    );
  }

  uploadWhiteLabelLogo(tenantId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/white-label/${encodeURIComponent(tenantId)}/logo`,
      input,
    );
  }

  deleteWhiteLabelConfig(tenantId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/v1/white-label/${encodeURIComponent(tenantId)}`,
    );
  }

  getWidgetConfig(tenantId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/widget/config',
      undefined,
      { tenant_id: tenantId },
    );
  }

  updateWidgetConfig(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      '/api/v1/widget/config',
      input,
    );
  }

  async getWidgetScript(widgetId: string): Promise<Record<string, unknown>> {
    const { data } = await this.http.request<string>({
      method: 'GET',
      url: `/api/v1/widget/script/${encodeURIComponent(widgetId)}`,
      responseType: 'text',
    });
    return {
      ok: true,
      script: {
        widgetId,
        script: typeof data === 'string' ? data : '',
        language: 'javascript',
      },
    };
  }

  getEscalations(input?: { status?: string; limit?: number }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input?.status) params.status = input.status;
    if (input?.limit) params.limit = Math.max(1, Math.min(input.limit, 200));
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/escalations', undefined, params);
  }

  resolveEscalation(input: {
    escalation_id: string;
    resolution: 'continue' | 'skip' | 'retry';
    note?: string;
    resolved_by?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/escalations/${encodeURIComponent(input.escalation_id)}/resolve`,
      {
        resolution: input.resolution,
        note: input.note,
        resolved_by: input.resolved_by,
      },
    );
  }

  triggerActiveHeartbeatCheck(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/heartbeat/active-check');
  }

  getActiveHeartbeatHistory(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/heartbeat/active-check/history');
  }

  getCommanderSuggestedIntents(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/commander/suggested-intents');
  }

  getRestoreEvents(input?: { limit?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/restore-events',
      undefined,
      input?.limit ? { limit: Math.max(1, Math.min(input.limit, 200)) } : undefined,
    );
  }

  listMcpServers(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/mcp/servers');
  }

  registerMcpServer(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/mcp/servers', input);
  }

  updateMcpServer(serverId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/mcp/servers/${encodeURIComponent(serverId)}`,
      input,
    );
  }

  deleteMcpServer(serverId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/v1/mcp/servers/${encodeURIComponent(serverId)}`,
    );
  }

  discoverMcpTools(serverId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/mcp/servers/${encodeURIComponent(serverId)}/tools`,
    );
  }

  pingMcpServer(serverId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      `/api/v1/mcp/servers/${encodeURIComponent(serverId)}/ping`,
      {},
    );
  }

  callMcpTool(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/mcp/call', input);
  }

  getMcpCallHistory(limit = 100): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/mcp/call/history',
      undefined,
      { limit: Math.max(1, Math.min(limit, 500)) },
    );
  }

  getMcpToolMonitorTop(limit = 10): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/monitor/tools/top',
      undefined,
      { limit: Math.max(1, Math.min(limit, 50)) },
    );
  }

  getMcpToolMonitorHeatmap(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/monitor/tools/heatmap');
  }

  getMcpToolMonitorFailures(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/monitor/tools/failures');
  }

  getMcpToolMonitorRecent(limit = 50): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/monitor/tools/recent',
      undefined,
      { limit: Math.max(1, Math.min(limit, 200)) },
    );
  }

  listMcpPolicies(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/mcp/policies');
  }

  updateMcpPolicy(lobsterName: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/mcp/policies/${encodeURIComponent(lobsterName)}`,
      input,
    );
  }

  listToolMarketplace(input?: { category?: string; tag?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/tools/marketplace', undefined, input);
  }

  publishToolMarketplace(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/tools/marketplace', input);
  }

  listToolSubscriptions(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/api/v1/tools/subscriptions');
  }

  subscribeTool(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/tools/subscribe', input);
  }

  unsubscribeTool(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/api/v1/tools/unsubscribe', input);
  }

  getAutonomyPolicy(input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/autonomy/policy',
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  updateAutonomyPolicy(input: {
    tenant_id?: string;
    default_level?: number;
    per_lobster_overrides?: Record<string, number>;
    reason?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      '/api/autonomy/policy',
      input,
    );
  }

  getSessions(input?: { peer_id?: string; lobster_id?: string }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input?.peer_id) params.peer_id = input.peer_id;
    if (input?.lobster_id) params.lobster_id = input.lobster_id;
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/sessions',
      undefined,
      params,
    );
  }

  getSessionHistory(sessionId: string, input?: { limit?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}/history`,
      undefined,
      input?.limit ? { limit: Math.max(1, Math.min(input.limit, 200)) } : undefined,
    );
  }

  clearSession(sessionId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  getChannelStatus(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/channels/status',
    );
  }

  getChannelAccounts(channel: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/channels/${encodeURIComponent(channel)}/accounts`,
    );
  }

  updateChannelAccountOptions(input: {
    channel: string;
    account_id: string;
    dm_scope: 'shared' | 'per-peer' | 'isolated';
    group_respond_mode?: 'always' | 'intent' | 'mention_only';
    thinking_placeholder_enabled?: boolean;
    thinking_threshold_ms?: number;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'PUT',
      `/api/v1/channels/${encodeURIComponent(input.channel)}/accounts/${encodeURIComponent(input.account_id)}`,
      {
        dm_scope: input.dm_scope,
        group_respond_mode: input.group_respond_mode,
        thinking_placeholder_enabled: input.thinking_placeholder_enabled,
        thinking_threshold_ms: input.thinking_threshold_ms,
      },
    );
  }

  getSchedulerTasks(input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/scheduler/tasks',
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  createSchedulerTask(input: {
    name: string;
    kind: 'cron' | 'every' | 'once';
    schedule: string;
    lobster_id: string;
    prompt: string;
    session_mode?: 'shared' | 'isolated';
    delivery_channel?: string;
    max_retries?: number;
    tenant_id?: string;
    enabled?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      '/api/scheduler/tasks',
      input,
    );
  }

  disableSchedulerTask(taskId: string, input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/scheduler/tasks/${encodeURIComponent(taskId)}`,
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  getSchedulerTaskHistory(taskId: string, input?: { limit?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/scheduler/tasks/${encodeURIComponent(taskId)}/history`,
      undefined,
      input?.limit ? { limit: Math.max(1, Math.min(input.limit, 200)) } : undefined,
    );
  }

  getMemoryWisdoms(input?: {
    tenant_id?: string;
    category?: string;
    lobster_id?: string;
    limit?: number;
  }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input?.tenant_id) params.tenant_id = input.tenant_id;
    if (input?.category) params.category = input.category;
    if (input?.lobster_id) params.lobster_id = input.lobster_id;
    if (input?.limit) params.limit = Math.max(1, Math.min(input.limit, 200));
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/memory/wisdoms',
      undefined,
      params,
    );
  }

  getMemoryReports(input?: {
    tenant_id?: string;
    lobster_id?: string;
    limit?: number;
  }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input?.tenant_id) params.tenant_id = input.tenant_id;
    if (input?.lobster_id) params.lobster_id = input.lobster_id;
    if (input?.limit) params.limit = Math.max(1, Math.min(input.limit, 200));
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/memory/reports',
      undefined,
      params,
    );
  }

  getMemoryStats(input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/memory/stats',
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  getLobsterMemoryStats(input: { tenant_id: string; lobster_id: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/memory/${encodeURIComponent(input.tenant_id)}/${encodeURIComponent(input.lobster_id)}/stats`,
    );
  }

  searchLobsterMemory(input: {
    tenant_id: string;
    lobster_id: string;
    query: string;
    category?: string;
    top_k?: number;
  }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {
      query: input.query,
      top_k: input.top_k ?? 5,
    };
    if (input.category) params.category = input.category;
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/memory/${encodeURIComponent(input.tenant_id)}/${encodeURIComponent(input.lobster_id)}/search`,
      undefined,
      params,
    );
  }

  hybridMemorySearch(input: {
    tenant_id: string;
    node_id?: string;
    lobster_name?: string;
    query: string;
    memory_type?: string;
    days?: number;
    top_k?: number;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      '/api/v1/memory/hybrid-search',
      input,
    );
  }

  triggerVectorBackup(input?: { collections?: string[] }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      '/api/v1/vector-backup/trigger',
      input ?? {},
    );
  }

  listVectorBackupSnapshots(collectionName: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/vector-backup/snapshots/${encodeURIComponent(collectionName)}`,
    );
  }

  listVectorBackupHistory(input?: { collection_name?: string; limit?: number }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/vector-backup/history',
      undefined,
      input,
    );
  }

  listLobsterMemoryByCategory(input: {
    tenant_id: string;
    lobster_id: string;
    category: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/memory/${encodeURIComponent(input.tenant_id)}/${encodeURIComponent(input.lobster_id)}/${encodeURIComponent(input.category)}`,
    );
  }

  deleteLobsterMemoryItem(input: {
    tenant_id: string;
    lobster_id: string;
    category: string;
    key: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'DELETE',
      `/api/v1/memory/${encodeURIComponent(input.tenant_id)}/${encodeURIComponent(input.lobster_id)}/${encodeURIComponent(input.category)}/${encodeURIComponent(input.key)}`,
    );
  }

  getPendingTasks(input: { tenant_id: string; lobster_id: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/tasks/${encodeURIComponent(input.tenant_id)}/${encodeURIComponent(input.lobster_id)}/pending`,
    );
  }

  getAgentRagCatalog(input?: { tenant_id?: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/agent-rag/catalog',
      undefined,
      input?.tenant_id ? { tenant_id: input.tenant_id } : undefined,
    );
  }

  getAgentRagPacks(input?: { tenant_id?: string; profile?: string }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (input?.tenant_id) params.tenant_id = input.tenant_id;
    if (input?.profile) params.profile = input.profile;
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/agent-rag/packs',
      undefined,
      params,
    );
  }

  getHitlStatus(approvalId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/hitl/status/${encodeURIComponent(approvalId)}`,
    );
  }

  getHitlPending(limit = 50): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/hitl/pending',
      undefined,
      { limit: Math.max(1, Math.min(limit, 200)) },
    );
  }

  async decideHitl(input: {
    approval_id: string;
    decision: 'approved' | 'rejected';
    operator: string;
    reason?: string;
  }): Promise<Record<string, unknown>> {
    const secret = getOptionalEnv('HITL_SHARED_SECRET') ?? getOptionalEnv('EDGE_SHARED_SECRET') ?? 'edge-demo-secret';
    return this.publicRequest<Record<string, unknown>>('POST', '/hitl/decide', {
      approval_id: input.approval_id,
      decision: input.decision,
      operator: input.operator,
      reason: input.reason,
    }, {
      'x-hitl-secret': secret,
    });
  }

  getLibtvStatus(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/integrations/libtv/status',
    );
  }

  getLibtvSession(sessionId: string, afterSeq = 0): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/integrations/libtv/session/${encodeURIComponent(sessionId)}`,
      undefined,
      { after_seq: Math.max(0, Number(afterSeq) || 0) },
    );
  }

  getIndustryKbTaxonomy(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/industry-kb/taxonomy',
    );
  }

  bootstrapIndustryKb(input: {
    tenant_id?: string;
    force?: boolean;
    selected_industry_tag?: string;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      '/industry-kb/bootstrap',
      input,
    );
  }

  generateIndustryStarterTasks(input: {
    tenant_id?: string;
    industry_tag: string;
    force?: boolean;
    max_tasks?: number;
  }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'POST',
      '/industry-kb/starter-kit/generate',
      input,
    );
  }

  getIndustryStarterTasks(input: {
    tenant_id?: string;
    industry_tag: string;
    status?: string;
    limit?: number;
  }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {
      industry_tag: input.industry_tag,
      limit: input.limit ?? 20,
    };
    if (input.tenant_id) params.tenant_id = input.tenant_id;
    if (input.status) params.status = input.status;
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/industry-kb/starter-kit/tasks',
      undefined,
      params,
    );
  }

  async getHealth(): Promise<Record<string, unknown>> {
    try {
      const { data } = await this.http.get<Record<string, unknown>>('/healthz');
      return {
        ok: true,
        baseUrl: this.baseUrl,
        ...data,
      };
    } catch (error) {
      return {
        ok: false,
        baseUrl: this.baseUrl,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getNotificationStatus(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/notifications/status');
  }

  getNotificationOutbox(limit = 20): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/notifications/outbox', undefined, { limit });
  }

  sendNotificationTest(input: { target: string; text: string }): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('POST', '/notifications/test', input);
  }

  getFeishuStatus(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/integrations/feishu/status');
  }

  getFeishuCallbackReadiness(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/integrations/feishu/callback-readiness');
  }

  getAnalyticsAttribution(input: {
    tenant_id?: string;
    model?: string;
    start?: string;
    end?: string;
  }): Promise<AnalyticsAttributionResponse> {
    const params: Record<string, string> = {};
    if (input.tenant_id) params.tenant_id = input.tenant_id;
    if (input.model) params.model = input.model;
    if (input.start) params.start = input.start;
    if (input.end) params.end = input.end;
    return this.authedRequest<AnalyticsAttributionResponse>(
      'GET',
      '/api/v1/analytics/attribution',
      undefined,
      Object.keys(params).length ? params : undefined,
    );
  }

  getAnalyticsFunnel(input: {
    tenant_id: string;
    start?: string;
    end?: string;
  }): Promise<AnalyticsFunnelResponse> {
    const params: Record<string, string> = { tenant_id: input.tenant_id };
    if (input.start) params.start = input.start;
    if (input.end) params.end = input.end;
    return this.authedRequest<AnalyticsFunnelResponse>(
      'GET',
      '/api/v1/analytics/funnel',
      undefined,
      params,
    );
  }

  getLeadConversionStatus(tenantId: string, leadId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/leads/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/conversion-status`,
    );
  }

  getLeadConversionHistory(tenantId: string, leadId: string, limit?: number): Promise<Record<string, unknown>> {
    const params: Record<string, number> | undefined =
      typeof limit === 'number' && Number.isFinite(limit) ? { limit } : undefined;
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/leads/${encodeURIComponent(tenantId)}/${encodeURIComponent(leadId)}/conversion-history`,
      undefined,
      params,
    );
  }

  getActivities(query?: { limit?: number; offset?: number; type?: string }): Promise<Record<string, unknown>> {
    const params: Record<string, string | number> = {};
    if (typeof query?.limit === 'number' && Number.isFinite(query.limit)) {
      params.limit = query.limit;
    }
    if (typeof query?.offset === 'number' && Number.isFinite(query.offset)) {
      params.offset = query.offset;
    }
    if (query?.type) {
      params.type = query.type;
    }
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      '/api/v1/activities',
      undefined,
      Object.keys(params).length ? params : undefined,
    );
  }

  getActivity(activityId: string): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/activities/${encodeURIComponent(activityId)}`,
    );
  }

  getKanbanTasks(
    input?: { recent_hours?: number },
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    const params: Record<string, number> = {};
    if (typeof input?.recent_hours === 'number' && Number.isFinite(input.recent_hours)) {
      params.recent_hours = input.recent_hours;
    }
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/tasks/kanban',
      undefined,
      Object.keys(params).length ? params : undefined,
    );
  }

  private mapDaysToRange(days?: number): '1d' | '7d' | '30d' | undefined {
    if (typeof days !== 'number' || !Number.isFinite(days)) return undefined;
    if (days <= 1) return '1d';
    if (days <= 7) return '7d';
    return '30d';
  }

  getLobsterCostSummary(
    input?: { days?: number },
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    const range = this.mapDaysToRange(input?.days);
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/cost/lobsters',
      undefined,
      range ? { range } : undefined,
    );
  }

  getLobsterCostDetail(
    lobsterId: string,
    input?: { days?: number },
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    const range = this.mapDaysToRange(input?.days);
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/cost/lobsters/${encodeURIComponent(lobsterId)}`,
      undefined,
      range ? { range } : undefined,
    );
  }

  getLobsterCostTimeseries(
    lobsterId: string,
    input?: { days?: number; bucket?: string },
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    const range = this.mapDaysToRange(input?.days);
    if (range) params.range = range;
    if (input?.bucket) params.bucket = input.bucket;
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/cost/lobsters/${encodeURIComponent(lobsterId)}/timeseries`,
      undefined,
      Object.keys(params).length ? params : undefined,
    );
  }

  listPolicies(authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/policies',
    );
  }

  createPolicy(input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/v1/policies',
      input,
    );
  }

  updatePolicy(ruleId: string, input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'PUT',
      `/api/v1/policies/${encodeURIComponent(ruleId)}`,
      input,
    );
  }

  deletePolicy(ruleId: string, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'DELETE',
      `/api/v1/policies/${encodeURIComponent(ruleId)}`,
    );
  }

  evaluatePolicy(input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/v1/policies/evaluate',
      input,
    );
  }

  getCurrentPolicyBundle(authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/policies/bundle/current',
    );
  }

  publishPolicyBundle(input?: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/v1/policies/bundle/publish',
      input ?? {},
    );
  }

  getGraphSnapshot(
    tenantId: string,
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/graph/${encodeURIComponent(tenantId)}/snapshot`,
    );
  }

  async getGraphTimeline(
    tenantId: string,
    input?: { limit?: number; entity_name?: string; lead_id?: string },
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    if (input?.entity_name) params.entity_name = input.entity_name;
    if (input?.lead_id) params.lead_id = input.lead_id;
    const response = await this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/graph/${encodeURIComponent(tenantId)}/timeline`,
      undefined,
      Object.keys(params).length ? params : undefined,
    );
    if (typeof input?.limit === 'number' && Number.isFinite(input.limit)) {
      const payload = response as Record<string, unknown>;
      const data = payload.data;
      if (Array.isArray(data)) {
        return {
          ...payload,
          data: data.slice(0, Math.max(1, input.limit)),
        };
      }
    }
    return response;
  }

  listSurveys(input?: { tenant_id?: string }): Promise<{ ok?: boolean; count?: number; surveys: SurveySummary[] }> {
    const params = input?.tenant_id ? { tenant_id: input.tenant_id } : undefined;
    return this.authedRequest<{ ok?: boolean; count?: number; surveys: SurveySummary[] }>(
      'GET',
      '/api/v1/surveys',
      undefined,
      params,
    );
  }

  createSurvey(payload: SurveyCreatePayload): Promise<{ ok?: boolean; survey_id?: string }> {
    return this.authedRequest<{ ok?: boolean; survey_id?: string }>('POST', '/api/v1/surveys', payload);
  }

  getSurveyResults(surveyId: string): Promise<{ ok?: boolean; survey_id?: string; results: SurveyResult[] }> {
    return this.authedRequest<{ ok?: boolean; survey_id?: string; results: SurveyResult[] }>(
      'GET',
      `/api/v1/surveys/${encodeURIComponent(surveyId)}/results`,
    );
  }

  respondSurvey(payload: SurveyResponsePayload): Promise<SurveyReplyResponse> {
    return this.authedRequest<SurveyReplyResponse>('POST', '/api/v1/surveys/respond', payload);
  }

  postNaturalLanguageQuery(payload: NlQueryPayload): Promise<NlQueryResponse> {
    return this.authedRequest<NlQueryResponse>('POST', '/api/v1/analytics/nl-query', payload);
  }

  getCommercialReadiness(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>('GET', '/commercial/readiness');
  }

  createMobilePairCode(input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/mobile/pair/code',
      input,
    );
  }

  pairMobileDevice(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.publicRequest<Record<string, unknown>>(
      'POST',
      '/api/mobile/pair',
      input,
    );
  }

  sendMobilePush(input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/notify/push',
      input,
    );
  }

  getVoiceHealth(authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/voice/health',
    );
  }

  listVoiceProfiles(authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/voice/profiles',
    );
  }

  createVoiceProfile(input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/v1/voice/profiles',
      input,
    );
  }

  getVoiceProfile(profileId: string, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/voice/profiles/${encodeURIComponent(profileId)}`,
    );
  }

  disableVoiceProfile(profileId: string, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      `/api/v1/voice/profiles/${encodeURIComponent(profileId)}/disable`,
      {},
    );
  }

  approveVoiceProfile(profileId: string, input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      `/api/v1/voice/profiles/${encodeURIComponent(profileId)}/approve`,
      input,
    );
  }

  rejectVoiceProfile(profileId: string, input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      `/api/v1/voice/profiles/${encodeURIComponent(profileId)}/reject`,
      input,
    );
  }

  revokeVoiceProfile(profileId: string, input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      `/api/v1/voice/profiles/${encodeURIComponent(profileId)}/revoke`,
      input,
    );
  }

  listVoiceConsents(authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/voice/consents',
    );
  }

  createVoiceConsent(input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/v1/voice/consents',
      input,
    );
  }

  getVoiceConsent(consentId: string, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/voice/consents/${encodeURIComponent(consentId)}`,
    );
  }

  approveVoiceConsent(consentId: string, input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      `/api/v1/voice/consents/${encodeURIComponent(consentId)}/approve`,
      input,
    );
  }

  rejectVoiceConsent(consentId: string, input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      `/api/v1/voice/consents/${encodeURIComponent(consentId)}/reject`,
      input,
    );
  }

  revokeVoiceConsent(consentId: string, input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      `/api/v1/voice/consents/${encodeURIComponent(consentId)}/revoke`,
      input,
    );
  }

  synthesizeVoice(input: Record<string, unknown>, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'POST',
      '/api/v1/voice/synthesize',
      input,
    );
  }

  listVoiceJobs(
    input?: { run_id?: string; lobster_id?: string; status?: string; limit?: number },
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    const query: Record<string, unknown> = {};
    if (input?.run_id) query.run_id = input.run_id;
    if (input?.lobster_id) query.lobster_id = input.lobster_id;
    if (input?.status) query.status = input.status;
    if (typeof input?.limit === 'number') query.limit = input.limit;
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/voice/jobs',
      undefined,
      query,
    );
  }

  getVoiceJob(jobId: string, authHeader?: string): Promise<Record<string, unknown>> {
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      `/api/v1/voice/jobs/${encodeURIComponent(jobId)}`,
    );
  }

  listVoiceArtifacts(
    input?: { run_id?: string; lobster_id?: string; artifact_type?: string; limit?: number },
    authHeader?: string,
  ): Promise<Record<string, unknown>> {
    const query: Record<string, unknown> = {};
    if (input?.run_id) query.run_id = input.run_id;
    if (input?.lobster_id) query.lobster_id = input.lobster_id;
    if (input?.artifact_type) query.artifact_type = input.artifact_type;
    if (typeof input?.limit === 'number') query.limit = input.limit;
    return this.authedRequestWithUserHeader<Record<string, unknown>>(
      authHeader,
      'GET',
      '/api/v1/voice/artifacts',
      undefined,
      query,
    );
  }
}
