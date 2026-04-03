import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LeadPushRuntimeConfig {
  backendInternalUrl: string;
  internalApiSecret: string;
  urlSource: 'BACKEND_INTERNAL_URL' | 'NEW_API_BASE_URL' | 'BACKEND_HOST_PORT' | 'fallback';
  secretSource: 'INTERNAL_API_SECRET' | 'NEW_API_TOKEN' | 'missing';
  envPath?: string;
}

type EnvMap = Record<string, string>;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '../../..');

function parseDotEnv(raw: string): EnvMap {
  const env: EnvMap = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function findDotEnv(startDir: string): string | null {
  let current = startDir;
  while (true) {
    const candidate = path.join(current, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function loadAmbientEnv(): { values: EnvMap; envPath?: string } {
  const values: EnvMap = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') values[key] = value;
  }

  const envPath = findDotEnv(repoRoot) ?? findDotEnv(process.cwd());
  if (!envPath) return { values };

  try {
    const parsed = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
    return {
      values: { ...parsed, ...values },
      envPath,
    };
  } catch {
    return { values };
  }
}

export function hydrateLeadPushRuntimeEnv(): LeadPushRuntimeConfig {
  const { values, envPath } = loadAmbientEnv();

  const explicitUrl = values.BACKEND_INTERNAL_URL?.trim();
  const newApiBaseUrl = values.NEW_API_BASE_URL?.trim();
  const backendHostPort = values.BACKEND_HOST_PORT?.trim();
  const explicitSecret = values.INTERNAL_API_SECRET?.trim();
  const newApiToken = values.NEW_API_TOKEN?.trim();

  let backendInternalUrl = 'http://localhost:3000';
  let urlSource: LeadPushRuntimeConfig['urlSource'] = 'fallback';

  if (explicitUrl) {
    backendInternalUrl = explicitUrl.replace(/\/$/, '');
    urlSource = 'BACKEND_INTERNAL_URL';
  } else if (newApiBaseUrl) {
    backendInternalUrl = newApiBaseUrl.replace(/\/$/, '');
    urlSource = 'NEW_API_BASE_URL';
    process.env.BACKEND_INTERNAL_URL = backendInternalUrl;
  } else if (backendHostPort) {
    backendInternalUrl = `http://127.0.0.1:${backendHostPort}`;
    urlSource = 'BACKEND_HOST_PORT';
    process.env.BACKEND_INTERNAL_URL = backendInternalUrl;
  }

  let internalApiSecret = '';
  let secretSource: LeadPushRuntimeConfig['secretSource'] = 'missing';

  if (explicitSecret) {
    internalApiSecret = explicitSecret;
    secretSource = 'INTERNAL_API_SECRET';
  } else if (newApiToken) {
    internalApiSecret = newApiToken;
    secretSource = 'NEW_API_TOKEN';
    process.env.INTERNAL_API_SECRET = internalApiSecret;
  }

  return {
    backendInternalUrl,
    internalApiSecret,
    urlSource,
    secretSource,
    envPath,
  };
}

export function resolveLeadPushRuntimeConfig(): LeadPushRuntimeConfig {
  return hydrateLeadPushRuntimeEnv();
}
