const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const webRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(webRoot, 'test-results');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(outputRoot, `knowledge-context-real-${timestamp}`);

const baseUrl = String(process.env.KNOWLEDGE_CONTEXT_BASE_URL || 'http://127.0.0.1:48789').replace(/\/+$/, '');
const authPath = String(process.env.KNOWLEDGE_CONTEXT_AUTH_PATH || '/auth/login');
const runPath = String(process.env.KNOWLEDGE_CONTEXT_RUN_PATH || '/api/v1/ai/run-dragon-team');
const username = String(process.env.KNOWLEDGE_CONTEXT_USERNAME || process.env.E2E_LIVE_USERNAME || 'admin');
const password = String(process.env.KNOWLEDGE_CONTEXT_PASSWORD || process.env.E2E_LIVE_PASSWORD || 'change_me');
const tenantId = String(process.env.KNOWLEDGE_CONTEXT_TENANT_ID || 'tenant_main');
const devJwtSecret = String(process.env.KNOWLEDGE_CONTEXT_DEV_JWT_SECRET || '').trim();
const industryTag = String(process.env.KNOWLEDGE_CONTEXT_INDUSTRY_TAG || 'food_service_chinese_restaurant');
const requestTimeoutMs = Math.max(1000, Number(process.env.KNOWLEDGE_CONTEXT_REQUEST_TIMEOUT_MS || 8000) || 8000);
const runTimeoutMs = Math.max(3000, Number(process.env.KNOWLEDGE_CONTEXT_RUN_TIMEOUT_MS || 30000) || 30000);
const preflightOnly = String(process.env.KNOWLEDGE_CONTEXT_PREFLIGHT_ONLY || '').trim() === '1';
const contextOnly = String(process.env.KNOWLEDGE_CONTEXT_CONTEXT_ONLY || '').trim() === '1';
const seedTenantPrivate = String(process.env.KNOWLEDGE_CONTEXT_SEED_TENANT_PRIVATE || '').trim() === '1';
const loginRetries = Math.max(1, Number(process.env.KNOWLEDGE_CONTEXT_LOGIN_RETRIES || 3) || 3);
const taskDescription = String(
  process.env.KNOWLEDGE_CONTEXT_TASK
    || 'Generate an auditable local-growth strategy and prove three-layer knowledge context injection.',
);

fs.mkdirSync(artifactDir, { recursive: true });

function writeJson(name, data) {
  const target = path.join(artifactDir, name);
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
  return target;
}

function writeReport(summary) {
  const reportPath = path.join(artifactDir, 'REPORT.md');
  fs.writeFileSync(
    reportPath,
    [
      '# Knowledge Context Runtime Evidence',
      '',
      `Generated at: ${summary.generated_at}`,
      `Base URL: \`${summary.base_url}\``,
      `Auth path: \`${summary.auth_path}\``,
      `Run path: \`${summary.run_path}\``,
      `Request timeout: \`${summary.request_timeout_ms}ms\``,
      `Run timeout: \`${summary.run_timeout_ms}ms\``,
      `Mode: \`${summary.mode}\``,
      `Knowledge context only: ${summary.knowledge_context_only ? 'yes' : 'no'}`,
      `Seed tenant private: ${summary.seed_tenant_private ? 'yes' : 'no'}`,
      `Seed strategy: ${summary.seed_strategy || 'none'}`,
      `Tenant: \`${summary.tenant_id}\``,
      `Industry: \`${summary.industry_tag}\``,
      '',
      '## Preflight',
      '',
      `- base reachable: ${summary.preflight.base_reachable ? 'yes' : 'no'}`,
      `- auth endpoint available: ${summary.preflight.auth_endpoint_available ? 'yes' : 'no'}`,
      `- run endpoint available: ${summary.preflight.run_endpoint_available ? 'yes' : 'no'}`,
      `- JWT provided: ${summary.preflight.jwt_provided ? 'yes' : 'no'}`,
      `- preflight note: ${summary.preflight.note || 'none'}`,
      '',
      ...(summary.mode === 'preflight_only'
        ? [
            '## Runtime Checks',
            '',
            'Runtime knowledge checks skipped because `KNOWLEDGE_CONTEXT_PREFLIGHT_ONLY=1`.',
            '',
          ]
        : []),
      '## Checks',
      '',
      `- run-dragon-team responded: ${summary.checks.run_dragon_team_responded ? 'yes' : 'no'}`,
      `- platform_common present: ${summary.checks.platform_common_present ? 'yes' : 'no'}`,
      `- platform_industry present: ${summary.checks.platform_industry_present ? 'yes' : 'no'}`,
      `- tenant_private layer present: ${summary.checks.tenant_private_layer_present ? 'yes' : 'no'}`,
      `- tenant_private nonzero when seeded: ${summary.checks.tenant_private_nonzero_when_seeded ? 'yes' : 'no'}`,
      `- raw group-collab traces excluded: ${summary.checks.raw_group_collab_trace_excluded ? 'yes' : 'no'}`,
      `- tenant_private summary only: ${summary.checks.tenant_private_summary_only ? 'yes' : 'no'}`,
      `- platform backflow blocked: ${summary.checks.platform_backflow_blocked ? 'yes' : 'no'}`,
      '',
      '## Layer Counts',
      '',
      `- platform_common: ${summary.layer_counts.platform_common}`,
      `- platform_industry: ${summary.layer_counts.platform_industry}`,
      `- tenant_private: ${summary.layer_counts.tenant_private}`,
      '',
      '## Artifacts',
      '',
      '- summary: `summary.json`',
      '- preflight: `preflight.json`',
      ...(summary.seed_tenant_private ? ['- seed result: `tenant-private-seed.json`'] : []),
      '- response: `run-dragon-team-response.json`',
      '- extracted context: `knowledge-context.json`',
      '',
      summary.ok
        ? `Result: pass${summary.mode === 'preflight_only' ? ' (preflight only)' : ''}`
        : `Result: fail\n\nFailure reason: ${summary.failure_reason || 'unknown'}`,
    ].join('\n'),
    'utf8',
  );
  return reportPath;
}

async function parseResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error(`request timed out after ${timeoutMs}ms`);
      timeoutError.code = 'REQUEST_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function jsonRequest(method, urlPath, payload, token, timeoutMs = requestTimeoutMs) {
  const response = await fetchWithTimeout(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }, timeoutMs);
  const data = await parseResponse(response);
  if (!response.ok) {
    const error = new Error(`${method} ${urlPath} failed with status ${response.status}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function probe(pathname, options = {}) {
  try {
    const response = await fetchWithTimeout(`${baseUrl}${pathname}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.payload === undefined ? undefined : JSON.stringify(options.payload),
    }, options.timeoutMs || requestTimeoutMs);
    const payload = await parseResponse(response);
    return {
      reachable: true,
      status: response.status,
      ok: response.ok,
      available: response.status !== 404,
      payload_preview: payload && typeof payload === 'object'
        ? JSON.stringify(payload).slice(0, 240)
        : String(payload ?? '').slice(0, 240),
    };
  } catch (error) {
    const timedOut = error?.code === 'REQUEST_TIMEOUT';
    return {
      reachable: timedOut,
      status: 0,
      ok: false,
      available: timedOut,
      timed_out: timedOut,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectPreflight(token) {
  const root = await probe('/');
  const jwtProvided = Boolean(String(process.env.KNOWLEDGE_CONTEXT_JWT || '').trim() || devJwtSecret);
  const auth = jwtProvided
    ? {
        reachable: true,
        status: 0,
        ok: true,
        available: true,
        skipped: true,
        payload_preview: 'skipped because JWT was provided/generated',
      }
    : await probe(authPath, {
        method: 'POST',
        payload: { username, password },
      });
  const run = await probe(runPath, {
    method: 'POST',
    token: undefined,
    timeoutMs: requestTimeoutMs,
    payload: {},
  });
  const note = (() => {
    if (!root.reachable && !auth.reachable && !run.reachable) return 'base_url_unreachable';
    if (!auth.available && !jwtProvided) return 'auth_endpoint_not_found_or_wrong_base_url';
    if (!run.available) return 'run_endpoint_not_found_or_wrong_base_url';
    if (run.timed_out) return 'run_endpoint_timed_out_or_ai_dependency_unavailable';
    if (!jwtProvided && !auth.ok) return `auth_endpoint_returned_${auth.status}`;
    if (!run.ok) return `run_endpoint_returned_${run.status}`;
    return '';
  })();
  return {
    base_reachable: root.reachable || auth.reachable || run.reachable,
    auth_endpoint_available: auth.available,
    run_endpoint_available: run.available,
    jwt_provided: jwtProvided,
    note,
    probes: { root, auth, run },
  };
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signDevJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: username,
    userId: username,
    username,
    tenantId,
    role: 'admin',
    roles: ['admin'],
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', devJwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function resolveToken() {
  const provided = String(process.env.KNOWLEDGE_CONTEXT_JWT || '').trim();
  if (provided) return provided;
  if (devJwtSecret) return signDevJwt();
  let lastError = null;
  for (let attempt = 1; attempt <= loginRetries; attempt += 1) {
    try {
      const login = await jsonRequest('POST', authPath, { username, password });
      const token = String(login?.token || login?.access_token || '').trim();
      if (!token) throw new Error('login succeeded but no token/access_token was returned');
      return token;
    } catch (error) {
      lastError = error;
      if (attempt < loginRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
      }
    }
  }
  throw lastError || new Error('login failed');
}

async function seedTenantPrivateSummary(token) {
  if (!seedTenantPrivate) return { skipped: true };
  const evidenceRecordId = `manual_kctx_seed_${Date.now()}`;
  const approvedExcerpt = 'Approved excerpt seed: use concise deadline reminders for local food service follow-up.';

  try {
    const dispatch = await jsonRequest(
      'POST',
      '/api/v1/collab/dispatch',
      {
        objectType: 'approval',
        title: 'Runtime evidence approval',
        summary: 'Dispatch through collaboration pipeline before knowledge capture.',
        body: approvedExcerpt,
        deliveryMode: 'mock',
        traceId: `trc_kctx_${Date.now()}`,
        metadata: {
          knowledge_capture_rule_approved: true,
          evidence_purpose: 'knowledge_context_runtime_evidence',
        },
        target: {
          chatId: 'mock://knowledge-context-evidence',
          targetName: 'Knowledge Context Evidence Room',
        },
      },
      token,
      requestTimeoutMs,
    );
    const recordId = String(dispatch?.record?.recordId || '').trim();
    const inbound = recordId
      ? await jsonRequest(
          'POST',
          '/api/v1/collab/mock/inbound',
          {
            recordId,
            eventType: 'approval.approved',
            note: 'approved in mock inbound',
          },
          token,
          requestTimeoutMs,
        ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
      : null;
    const summaries = await jsonRequest(
      'GET',
      '/api/v1/collab/knowledge-summaries?limit=5',
      undefined,
      token,
      requestTimeoutMs,
    ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    return {
      skipped: false,
      seedStrategy: 'collab_dispatch',
      evidenceRecordId: recordId || evidenceRecordId,
      dispatch,
      inbound,
      summaries,
    };
  } catch (dispatchError) {
    const created = await jsonRequest(
      'POST',
      '/api/v1/collab/knowledge-summaries',
      {
        approvedExcerpt,
        sourceType: 'group_collab_approval_pattern',
        objectType: 'approval',
        evidenceRecordId,
      },
      token,
      requestTimeoutMs,
    );
    const summaries = await jsonRequest(
      'GET',
      '/api/v1/collab/knowledge-summaries?limit=5',
      undefined,
      token,
      requestTimeoutMs,
    ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    return {
      skipped: false,
      seedStrategy: 'manual_summary_fallback',
      fallbackReason: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
      evidenceRecordId,
      created,
      summaries,
    };
  }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function extractKnowledgeContext(payload) {
  const root = asRecord(payload);
  if (!root) return null;
  if (root.layers || root.resolved || root.explainable_sources || root.source_refs) return root;
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const key of ['knowledge_context', 'runtime_knowledge_context']) {
      const nested = asRecord(current[key]);
      if (nested) return nested;
    }
    for (const value of Object.values(current)) {
      const record = asRecord(value);
      if (record) queue.push(record);
    }
  }
  return null;
}

function layerItems(context, layer) {
  const record = asRecord(context);
  if (!record) return [];
  const layers = asRecord(record.layers);
  const fromLayers = asRecord(layers?.[layer]);
  if (Array.isArray(fromLayers?.items)) return fromLayers.items;
  const resolved = asRecord(record.resolved);
  if (Array.isArray(resolved?.[layer])) return resolved[layer];
  return [];
}

function layerCount(context, layer) {
  const layers = asRecord(asRecord(context)?.layers);
  const fromLayers = asRecord(layers?.[layer]);
  const explicit = Number(fromLayers?.count);
  if (Number.isFinite(explicit)) return explicit;
  return layerItems(context, layer).length;
}

async function main() {
  let responsePayload = null;
  let context = null;
  let failureReason = '';
  let token = '';
  let preflight = null;
  let seedResult = { skipped: true };

  try {
    token = await resolveToken();
    seedResult = await seedTenantPrivateSummary(token);
    preflight = await collectPreflight(token);
    if (!preflightOnly) {
      responsePayload = await jsonRequest(
        'POST',
        runPath,
        {
          task_description: taskDescription,
          industry_tag: industryTag,
          industry: industryTag,
          competitor_handles: [],
          execution_mode: 'assistive',
          knowledge_context_only: contextOnly,
        },
        token,
        runTimeoutMs,
      );
      context = extractKnowledgeContext(responsePayload);
    } else {
      responsePayload = { skipped: 'preflight_only' };
    }
  } catch (error) {
    failureReason = error instanceof Error ? error.message : String(error);
    responsePayload = error?.payload || { error: failureReason };
    preflight = await collectPreflight(token || undefined);
  }

  const policy = asRecord(context?.policy) || {};
  const layerCounts = {
    platform_common: layerCount(context, 'platform_common'),
    platform_industry: layerCount(context, 'platform_industry'),
    tenant_private: layerCount(context, 'tenant_private'),
  };
  const tenantPrivateNonzero = layerCounts.tenant_private > 0;
  const checks = {
    run_dragon_team_responded: Boolean(responsePayload && !responsePayload.error),
    platform_common_present: layerCounts.platform_common > 0,
    platform_industry_present: layerCounts.platform_industry > 0,
    tenant_private_layer_present: Boolean(asRecord(context?.layers)?.tenant_private || asRecord(context?.resolved)?.tenant_private),
    tenant_private_nonzero_when_seeded: seedTenantPrivate ? tenantPrivateNonzero : true,
    raw_group_collab_trace_excluded: policy.raw_group_collab_trace_included === false,
    tenant_private_summary_only: policy.tenant_private_summary_only === true,
    platform_backflow_blocked: policy.platform_backflow_allowed === false,
  };
  const preflightOk = Boolean(preflight?.base_reachable && preflight?.auth_endpoint_available && preflight?.run_endpoint_available);
  const ok = preflightOnly ? preflightOk : Object.values(checks).every(Boolean);
  if (ok && preflight && preflight.note) {
    preflight = {
      ...preflight,
      note: 'runtime_checks_passed',
    };
  }
  const summary = {
    ok,
    generated_at: new Date().toISOString(),
    mode: preflightOnly ? 'preflight_only' : contextOnly ? 'knowledge_context_only' : 'runtime_evidence',
    knowledge_context_only: contextOnly,
    seed_tenant_private: seedTenantPrivate,
    seed_strategy: seedResult?.seedStrategy || null,
    base_url: baseUrl,
    auth_path: authPath,
    run_path: runPath,
    request_timeout_ms: requestTimeoutMs,
    run_timeout_ms: runTimeoutMs,
    tenant_id: tenantId,
    industry_tag: industryTag,
    preflight,
    checks,
    layer_counts: layerCounts,
    failure_reason: ok ? '' : failureReason || preflight?.note || 'one or more checks failed',
  };

  writeJson('run-dragon-team-response.json', responsePayload);
  writeJson('knowledge-context.json', context || {});
  writeJson('preflight.json', preflight || {});
  if (seedTenantPrivate) writeJson('tenant-private-seed.json', seedResult || {});
  const summaryPath = writeJson('summary.json', summary);
  const reportPath = writeReport(summary);

  console.log(JSON.stringify({
    ok,
    artifact_dir: artifactDir,
    summary: summaryPath,
    report: reportPath,
  }, null, 2));

  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  const preflight = {
    base_reachable: false,
    auth_endpoint_available: false,
    run_endpoint_available: false,
    jwt_provided: Boolean(String(process.env.KNOWLEDGE_CONTEXT_JWT || '').trim()),
    note: 'collector_unhandled_error',
    probes: {},
  };
  const summary = {
    ok: false,
    generated_at: new Date().toISOString(),
    mode: preflightOnly ? 'preflight_only' : contextOnly ? 'knowledge_context_only' : 'runtime_evidence',
    knowledge_context_only: contextOnly,
    seed_tenant_private: seedTenantPrivate,
    seed_strategy: seedTenantPrivate ? 'manual_summary_fallback' : null,
    base_url: baseUrl,
    auth_path: authPath,
    run_path: runPath,
    request_timeout_ms: requestTimeoutMs,
    run_timeout_ms: runTimeoutMs,
    tenant_id: tenantId,
    industry_tag: industryTag,
    preflight,
    checks: {
      run_dragon_team_responded: false,
      platform_common_present: false,
      platform_industry_present: false,
      tenant_private_layer_present: false,
      tenant_private_nonzero_when_seeded: !seedTenantPrivate,
      raw_group_collab_trace_excluded: false,
      tenant_private_summary_only: false,
      platform_backflow_blocked: false,
    },
    layer_counts: {
      platform_common: 0,
      platform_industry: 0,
      tenant_private: 0,
    },
    failure_reason: error instanceof Error ? error.message : String(error),
  };
  writeJson('summary.json', summary);
  writeJson('preflight.json', preflight);
  writeReport(summary);
  console.error(error);
  process.exitCode = 1;
});
