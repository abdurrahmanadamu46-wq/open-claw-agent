const assert = require('node:assert/strict');

const BASE_URL = process.env.STAGING_BASE_URL?.trim();
const TOKEN = process.env.STAGING_JWT?.trim();
const WEBHOOK_URL = process.env.STAGING_WEBHOOK_URL?.trim() || 'https://example.com/webhook/staging-live-test';
const RESTORE_AFTER_TEST =
  (process.env.STAGING_RESTORE_AFTER_TEST ?? '1').toLowerCase() !== '0' &&
  (process.env.STAGING_RESTORE_AFTER_TEST ?? '1').toLowerCase() !== 'false';

function requireEnv() {
  if (!BASE_URL || !TOKEN) {
    throw new Error(
      'Missing required env: STAGING_BASE_URL and STAGING_JWT. Example: ' +
        'STAGING_BASE_URL=https://staging-api.example.com STAGING_JWT=<token> npm run test:integrations:staging-live',
    );
  }
}

async function request(method, path, body) {
  const url = `${BASE_URL.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`[${method}] ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  requireEnv();
  const path = '/api/v1/tenant/integrations';

  const before = await request('GET', path);
  assert.equal(before?.code, 0, 'GET integrations should return code=0');
  const beforeData = before.data ?? {};

  const patchPayload = {
    webhook: {
      ...(beforeData.webhook ?? {}),
      enabled: true,
      leadCaptureUrl: WEBHOOK_URL,
    },
  };
  const patched = await request('PATCH', path, patchPayload);
  assert.equal(patched?.code, 0, 'PATCH integrations should return code=0');
  assert.equal(patched?.data?.webhook?.enabled, true, 'webhook.enabled should be true');
  assert.equal(
    patched?.data?.webhook?.leadCaptureUrl,
    WEBHOOK_URL,
    'webhook.leadCaptureUrl should match patch payload',
  );

  const testWebhook = await request('POST', `${path}/webhook/test`, {});
  assert.equal(testWebhook?.code, 0, 'POST webhook/test should return code=0');
  assert.ok(testWebhook?.jobId, 'webhook/test should return jobId');

  const after = await request('GET', path);
  assert.equal(after?.code, 0, 'GET integrations(after) should return code=0');
  assert.equal(after?.data?.webhook?.enabled, true, 'webhook.enabled should stay true');
  assert.equal(
    after?.data?.webhook?.leadCaptureUrl,
    WEBHOOK_URL,
    'webhook.leadCaptureUrl should stay patched',
  );

  if (RESTORE_AFTER_TEST && beforeData.webhook) {
    await request('PATCH', path, { webhook: beforeData.webhook });
  }

  console.log('integrations-staging-live: all checks passed');
}

main().catch((err) => {
  console.error('integrations-staging-live: failed');
  console.error(err);
  process.exit(1);
});
