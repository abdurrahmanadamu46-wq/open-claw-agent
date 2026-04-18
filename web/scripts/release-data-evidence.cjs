const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(webRoot, 'test-results');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(outputRoot, `release-data-evidence-${timestamp}`);

const baseUrl = String(process.env.RELEASE_DATA_BASE_URL || 'http://127.0.0.1:48999').replace(/\/+$/, '');
const auxBaseUrl = String(process.env.RELEASE_DATA_AUX_BASE_URL || '').replace(/\/+$/, '');
const token = String(process.env.RELEASE_DATA_JWT || '').trim();
const tenantId = String(process.env.RELEASE_DATA_TENANT_ID || 'tenant_main').trim();
const traceId = String(process.env.RELEASE_DATA_TRACE_ID || '').trim();
const timeoutMs = Math.max(1000, Number(process.env.RELEASE_DATA_TIMEOUT_MS || 8000) || 8000);

const probes = [
  {
    key: 'monitor_overview',
    label: 'Execution Monitor Snapshot',
    path: `/api/v1/control-plane/monitor/overview?tenant_id=${encodeURIComponent(tenantId)}`,
    required: true,
    check: (payload) => ({
      nodes: Array.isArray(payload?.snapshot?.nodes) ? payload.snapshot.nodes.length : 0,
      logs: Array.isArray(payload?.snapshot?.recent_logs) ? payload.snapshot.recent_logs.length : 0,
      runtime_foreground: Array.isArray(payload?.snapshot?.runtime_foreground) ? payload.snapshot.runtime_foreground.length : 0,
      task_notifications: Array.isArray(payload?.snapshot?.recent_task_notifications) ? payload.snapshot.recent_task_notifications.length : 0,
      has_snapshot: Boolean(payload?.snapshot),
    }),
  },
  {
    key: 'edge_adapters',
    label: 'Channel Adapter Governance',
    path: '/api/v1/ai/edge/adapters',
    required: true,
    fallbackPath: '/api/v1/edge/adapters',
    check: (payload) => ({
      count: Number(payload?.count ?? payload?.items?.length ?? 0) || 0,
      warn_or_block: Array.isArray(payload?.items)
        ? payload.items.filter((item) => ['warn', 'block'].includes(String(item.scan_status || ''))).length
        : 0,
    }),
  },
  {
    key: 'skills',
    label: 'Skill Governance',
    path: '/api/v1/ai/skills',
    required: true,
    fallbackPath: '/api/v1/skills',
    check: (payload) => {
      const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.skills) ? payload.skills : [];
      return {
        count: items.length,
        warn_or_block: items.filter((item) => ['warn', 'block'].includes(String(item.scan_status || ''))).length,
      };
    },
  },
  {
    key: 'providers',
    label: 'Provider Governance',
    path: '/api/v1/ai/providers',
    required: true,
    fallbackPath: '/api/v1/providers',
    check: (payload) => ({
      count: Array.isArray(payload?.providers) ? payload.providers.length : 0,
      warn_or_block: Array.isArray(payload?.providers)
        ? payload.providers.filter((item) => ['warn', 'block'].includes(String(item.scan_status || ''))).length
        : 0,
    }),
  },
  ...(traceId
    ? [
        {
          key: 'kernel_report',
          label: 'Trace Kernel Report',
          path: `/api/v1/ai/kernel/report/${encodeURIComponent(traceId)}`,
          required: false,
          check: (payload) => ({
            has_kernel_report: Boolean(payload?.kernel_report),
            risk_level: String(payload?.kernel_report?.risk_level ?? ''),
            trace_id: String(payload?.trace_id ?? traceId),
          }),
        },
      ]
    : []),
];

fs.mkdirSync(artifactDir, { recursive: true });

function writeJson(name, data) {
  const target = path.join(artifactDir, name);
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
  return target;
}

function parsePayload(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text.slice(0, 1000) };
  }
}

async function fetchJsonFromBase(targetBaseUrl, pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${targetBaseUrl}${pathname}`, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      base_url: targetBaseUrl,
      path: pathname,
      ok: response.ok,
      status: response.status,
      payload: parsePayload(text),
      error: '',
    };
  } catch (error) {
    return {
      base_url: targetBaseUrl,
      path: pathname,
      ok: false,
      status: 0,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function statusMeaning(status) {
  if (status === 0) return 'unreachable';
  if (status === 401) return 'auth_required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server_error';
  if (status >= 400) return `http_${status}`;
  return 'ok';
}

function diagnoseProbe(primary, fallback) {
  if (primary.ok) return 'primary_ok';
  if (!fallback) return `primary_${statusMeaning(primary.status)}`;
  if (fallback.ok && primary.status === 404) return 'proxy_missing_route_but_aux_ok';
  if (fallback.ok && primary.status >= 500) return 'proxy_upstream_error_but_aux_ok';
  if (fallback.ok) return 'primary_failed_but_aux_ok';
  if (fallback.status === 401 && primary.status === 404) return 'primary_missing_route_and_aux_requires_auth';
  if (fallback.status === 401 && primary.status >= 500) return 'primary_server_error_and_aux_requires_auth';
  if (fallback.status === 404) return 'primary_failed_and_aux_missing_route';
  if (fallback.status >= 500) return 'primary_failed_and_aux_server_error';
  if (fallback.status === 0) return 'primary_failed_and_aux_unreachable';
  return `primary_${statusMeaning(primary.status)}__aux_${statusMeaning(fallback.status)}`;
}

function writeReport(summary) {
  const lines = [
    '# Release Data Evidence',
    '',
    `Generated at: ${summary.generated_at}`,
    `Base URL: \`${summary.base_url}\``,
    `Aux Base URL: \`${summary.aux_base_url || 'not provided'}\``,
    `Tenant: \`${summary.tenant_id}\``,
    `Trace ID: \`${summary.trace_id || 'not provided'}\``,
    `JWT provided: ${summary.jwt_provided ? 'yes' : 'no'}`,
    '',
    '## Result',
    '',
    `- required probes passed: ${summary.required_passed}/${summary.required_total}`,
    `- optional probes passed: ${summary.optional_passed}/${summary.optional_total}`,
    `- result: ${summary.ok ? 'pass' : 'needs attention'}`,
    '',
    '## Probes',
    '',
  ];

  for (const item of summary.probes) {
    lines.push(
      `### ${item.label}`,
      `- key: \`${item.key}\``,
      `- primary path: \`${item.path}\``,
      `- required: ${item.required ? 'yes' : 'no'}`,
      `- primary status: ${item.status}`,
      `- primary ok: ${item.ok ? 'yes' : 'no'}`,
      `- diagnosis: \`${item.diagnosis}\``,
      `- artifact: \`${path.basename(item.artifact)}\``,
    );
    if (item.error) {
      lines.push(`- primary error: ${item.error}`);
    }
    if (item.checks) {
      lines.push(`- primary checks: \`${JSON.stringify(item.checks)}\``);
    }
    if (item.fallback) {
      lines.push(
        `- aux base: \`${item.fallback.base_url}\``,
        `- aux path: \`${item.fallback.path}\``,
        `- aux status: ${item.fallback.status}`,
        `- aux ok: ${item.fallback.ok ? 'yes' : 'no'}`,
        item.fallback.artifact ? `- aux artifact: \`${path.basename(item.fallback.artifact)}\`` : '',
        item.fallback.error ? `- aux error: ${item.fallback.error}` : '',
        item.fallback.checks ? `- aux checks: \`${JSON.stringify(item.fallback.checks)}\`` : '',
      );
    }
    lines.push('');
  }

  const target = path.join(artifactDir, 'REPORT.md');
  fs.writeFileSync(target, lines.filter(Boolean).join('\n'), 'utf8');
  return target;
}

async function main() {
  const results = [];

  for (const probe of probes) {
    const response = await fetchJsonFromBase(baseUrl, probe.path);
    const artifact = writeJson(`${probe.key}.json`, response.payload ?? { error: response.error });
    const checks = response.ok && response.payload ? probe.check(response.payload) : null;

    let fallback = null;
    if ((!response.ok || response.status === 404 || response.status >= 500) && auxBaseUrl && probe.fallbackPath) {
      const fallbackResponse = await fetchJsonFromBase(auxBaseUrl, probe.fallbackPath);
      fallback = {
        base_url: auxBaseUrl,
        path: probe.fallbackPath,
        status: fallbackResponse.status,
        ok: fallbackResponse.ok,
        error: fallbackResponse.error || '',
        checks: fallbackResponse.ok && fallbackResponse.payload ? probe.check(fallbackResponse.payload) : null,
        artifact: writeJson(`${probe.key}.fallback.json`, fallbackResponse.payload ?? { error: fallbackResponse.error }),
      };
    }

    results.push({
      ...probe,
      status: response.status,
      ok: response.ok,
      error: response.error || '',
      checks,
      fallback,
      diagnosis: diagnoseProbe(response, fallback),
      artifact,
    });
  }

  const required = results.filter((item) => item.required);
  const optional = results.filter((item) => !item.required);
  const summary = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    aux_base_url: auxBaseUrl,
    tenant_id: tenantId,
    trace_id: traceId,
    jwt_provided: Boolean(token),
    required_total: required.length,
    required_passed: required.filter((item) => item.ok).length,
    optional_total: optional.length,
    optional_passed: optional.filter((item) => item.ok).length,
    ok: required.every((item) => item.ok),
    probes: results,
  };

  const summaryPath = writeJson('summary.json', summary);
  const reportPath = writeReport(summary);

  console.log(JSON.stringify({
    ok: summary.ok,
    artifact_dir: artifactDir,
    summary: summaryPath,
    report: reportPath,
  }, null, 2));

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
