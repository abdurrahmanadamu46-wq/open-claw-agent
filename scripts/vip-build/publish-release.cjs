/**
 * Publish client release metadata to backend:
 * POST /api/v1/client-updates/release
 *
 * Required env:
 * - BACKEND_BASE_URL (e.g. http://127.0.0.1:3000)
 * - BACKEND_ADMIN_JWT
 * - RELEASE_VERSION (semver)
 * - RELEASE_DOWNLOAD_URL
 *
 * Required for integrity:
 * - RELEASE_FILE_PATH or RELEASE_SHA256
 *
 * Optional:
 * - RELEASE_PLATFORM (default: win-x64)
 * - RELEASE_CHANNEL (default: stable)
 * - RELEASE_NOTES
 * - RELEASE_MIN_REQUIRED_VERSION
 * - RELEASE_SIGN_PRIVATE_KEY_PATH or RELEASE_SIGN_PRIVATE_KEY
 */
const { createHash, createSign } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`missing required env: ${name}`);
  }
  return value;
}

function readPrivateKey() {
  const inline = String(process.env.RELEASE_SIGN_PRIVATE_KEY || '').trim();
  if (inline) return inline;
  const keyPath = String(process.env.RELEASE_SIGN_PRIVATE_KEY_PATH || '').trim();
  if (!keyPath) return '';
  const absolute = path.isAbsolute(keyPath) ? keyPath : path.resolve(process.cwd(), keyPath);
  return readFileSync(absolute, 'utf8').trim();
}

function computeFileSha256Hex(filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const data = readFileSync(absolute);
  return createHash('sha256').update(data).digest('hex');
}

function buildSignaturePayload(input) {
  return [
    `platform=${input.platform}`,
    `channel=${input.channel}`,
    `version=${input.version}`,
    `downloadUrl=${input.downloadUrl}`,
    `sha256=${input.sha256}`,
    `minRequiredVersion=${input.minRequiredVersion || ''}`,
    `signatureKeyId=${input.signatureKeyId || ''}`,
  ].join('\n');
}

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveRollout() {
  const percentRaw = String(process.env.RELEASE_ROLLOUT_PERCENT || '').trim();
  const allowlist = parseList(process.env.RELEASE_ROLLOUT_TENANTS_ALLOWLIST);
  const denylist = parseList(process.env.RELEASE_ROLLOUT_TENANTS_DENYLIST);
  const salt = String(process.env.RELEASE_ROLLOUT_SALT || '').trim();

  let percent;
  if (percentRaw) {
    const parsed = Number.parseInt(percentRaw, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error('RELEASE_ROLLOUT_PERCENT must be an integer between 0 and 100');
    }
    percent = Math.max(0, Math.min(100, parsed));
  }

  if (typeof percent === 'undefined' && !allowlist.length && !denylist.length && !salt) {
    return undefined;
  }

  return {
    ...(typeof percent === 'number' ? { percent } : {}),
    ...(allowlist.length ? { tenantsAllowlist: allowlist } : {}),
    ...(denylist.length ? { tenantsDenylist: denylist } : {}),
    ...(salt ? { salt } : {}),
  };
}

function resolveSha256() {
  const envSha = String(process.env.RELEASE_SHA256 || '').trim().toLowerCase();
  const filePath = String(process.env.RELEASE_FILE_PATH || '').trim();
  const fileSha = filePath ? computeFileSha256Hex(filePath) : '';

  if (envSha && !/^[0-9a-f]{64}$/i.test(envSha)) {
    throw new Error('RELEASE_SHA256 must be a 64-char hex digest');
  }
  if (fileSha && !/^[0-9a-f]{64}$/i.test(fileSha)) {
    throw new Error('computed file sha256 is invalid');
  }

  if (!envSha && !fileSha) {
    throw new Error('either RELEASE_FILE_PATH or RELEASE_SHA256 is required');
  }
  if (envSha && fileSha && envSha !== fileSha) {
    throw new Error(`sha256 mismatch: RELEASE_SHA256=${envSha} computed=${fileSha}`);
  }
  return envSha || fileSha;
}

async function main() {
  const baseUrl = required('BACKEND_BASE_URL').replace(/\/+$/, '');
  const token = required('BACKEND_ADMIN_JWT');
  const version = required('RELEASE_VERSION');
  const downloadUrl = required('RELEASE_DOWNLOAD_URL');

  const rollout = resolveRollout();

  const payload = {
    platform: String(process.env.RELEASE_PLATFORM || 'win-x64').trim(),
    channel: String(process.env.RELEASE_CHANNEL || 'stable').trim(),
    version,
    downloadUrl,
    sha256: resolveSha256(),
    ...(process.env.RELEASE_NOTES ? { notes: String(process.env.RELEASE_NOTES) } : {}),
    ...(process.env.RELEASE_MIN_REQUIRED_VERSION
      ? { minRequiredVersion: String(process.env.RELEASE_MIN_REQUIRED_VERSION).trim() }
      : {}),
    ...(rollout ? { rollout } : {}),
  };

  const privateKey = readPrivateKey();
  if (privateKey) {
    payload.signatureKeyId = String(process.env.RELEASE_SIGN_KEY_ID || 'default').trim() || 'default';
    const signer = createSign('RSA-SHA256');
    signer.update(buildSignaturePayload(payload), 'utf8');
    signer.end();
    payload.signature = signer.sign(privateKey).toString('base64');
    payload.signatureAlgorithm = 'RSA-SHA256';
  }

  const response = await fetch(`${baseUrl}/api/v1/client-updates/release`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`publish failed (${response.status}): ${text}`);
  }

  console.log('release publish success');
  console.log(
    JSON.stringify(
      {
        platform: payload.platform,
        channel: payload.channel,
        version: payload.version,
        sha256: payload.sha256,
        signed: Boolean(payload.signature),
        signatureKeyId: payload.signatureKeyId,
        rollout: payload.rollout,
      },
      null,
      2,
    ),
  );
  console.log(text);
}

main().catch((err) => {
  console.error(`release publish failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
