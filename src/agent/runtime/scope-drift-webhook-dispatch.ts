import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotEnv } from 'dotenv';

import type {
  RuntimeScopeDriftWebhookDispatchDecision,
  RuntimeScopeDriftWebhookDispatchReport,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPolicyPath = path.join(__dirname, 'config', 'scope-drift-webhook-dispatch.policy.json');

interface ScopeDriftWebhookTarget {
  id: string;
  enabled: boolean;
  payloadMode: 'raw_json' | 'feishu_text';
  urlEnvVar: string;
  urlEnvFallbacks?: string[];
  secretEnvVar?: string;
  secretEnvFallbacks?: string[];
  secretHeaderName?: string;
}

interface ScopeDriftWebhookDispatchPolicy {
  version: string;
  name: string;
  outboxDirectory: string;
  processedDirectory: string;
  failedDirectory: string;
  requestTimeoutMs: number;
  maxAttemptsPerTarget: number;
  retryBackoffMs: number;
  targets: ScopeDriftWebhookTarget[];
}

function findNearestEnv(startDir: string): string | null {
  let current = startDir;

  while (true) {
    const candidate = path.join(current, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

const nearestEnvPath = findNearestEnv(__dirname);
if (nearestEnvPath) {
  loadDotEnv({ path: nearestEnvPath, override: false });
}

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function listJsonFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  return readdirSync(dirPath)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dirPath, name));
}

export function loadScopeDriftWebhookDispatchPolicy(
  policyPath?: string,
): ScopeDriftWebhookDispatchPolicy {
  const resolved = policyPath ? path.resolve(policyPath) : defaultPolicyPath;
  if (!existsSync(resolved)) {
    throw new Error(`Scope drift webhook dispatch policy not found: ${resolved}`);
  }

  return readJson<ScopeDriftWebhookDispatchPolicy>(resolved);
}

function toFeishuPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const alert = payload.payload as Record<string, unknown> | undefined;
  const roleId = typeof alert?.roleId === 'string' ? alert.roleId : 'unknown-role';
  const scopeId = typeof alert?.scopeId === 'string' ? alert.scopeId : 'unknown-scope';
  const severity = typeof alert?.severity === 'string' ? alert.severity : 'unknown';
  const message = typeof alert?.message === 'string' ? alert.message : 'scope alert';

  return {
    msg_type: 'text',
    content: {
      text: `[Lobster Scope Alert]\n${roleId}.${scopeId}\nseverity=${severity}\n${message}`,
    },
  };
}

function signFeishuPayload(
  secret: string,
  timestamp: string,
): string {
  const stringToSign = `${timestamp}\n${secret}`;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(stringToSign)
    .digest();

  return digest.toString('base64');
}

function buildRequestBody(
  payloadMode: ScopeDriftWebhookTarget['payloadMode'],
  envelope: Record<string, unknown>,
  target: ScopeDriftWebhookTarget,
): Record<string, unknown> {
  if (payloadMode === 'feishu_text') {
    const payload = toFeishuPayload(envelope);
    const secret = resolveEnvValue(target.secretEnvVar, target.secretEnvFallbacks);
    if (secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      return {
        ...payload,
        timestamp,
        sign: signFeishuPayload(secret, timestamp),
      };
    }

    return payload;
  }

  return envelope;
}

function resolveEnvValue(primary: string | undefined, fallbacks: string[] | undefined): string {
  const candidates = [
    ...(primary ? [primary] : []),
    ...(fallbacks ?? []),
  ];

  for (const name of candidates) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return '';
}

async function delayMs(durationMs: number): Promise<void> {
  if (durationMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function dispatchToTarget(
  filePath: string,
  envelope: Record<string, unknown>,
  target: ScopeDriftWebhookTarget,
  requestTimeoutMs: number,
  maxAttempts: number,
  retryBackoffMs: number,
): Promise<RuntimeScopeDriftWebhookDispatchDecision> {
  const url = resolveEnvValue(target.urlEnvVar, target.urlEnvFallbacks);

  if (!url) {
    return {
      outboxPath: filePath,
      targetId: target.id,
      action: 'skipped_no_target',
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (target.secretEnvVar && target.secretHeaderName) {
    const secret = resolveEnvValue(target.secretEnvVar, target.secretEnvFallbacks);
    if (secret) {
      headers[target.secretHeaderName] = secret;
    }
  }

  const body = buildRequestBody(target.payloadMode, envelope, target);

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const preview = await response.text().catch(() => '');

      if (response.ok) {
        return {
          outboxPath: filePath,
          targetId: target.id,
          action: 'sent',
          responseStatus: response.status,
          responseBodyPreview: preview.slice(0, 240),
        };
      }

      if (attempt < maxAttempts && response.status >= 500) {
        await delayMs(retryBackoffMs * attempt);
        continue;
      }

      return {
        outboxPath: filePath,
        targetId: target.id,
        action: 'failed',
        responseStatus: response.status,
        responseBodyPreview: preview.slice(0, 240),
      };
    } catch (error) {
      if (attempt < maxAttempts) {
        await delayMs(retryBackoffMs * attempt);
        continue;
      }

      return {
        outboxPath: filePath,
        targetId: target.id,
        action: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    outboxPath: filePath,
    targetId: target.id,
    action: 'failed',
    error: 'unknown_dispatch_failure',
  };
}

export async function dispatchScopeDriftWebhookOutbox(
  policy: ScopeDriftWebhookDispatchPolicy,
): Promise<RuntimeScopeDriftWebhookDispatchReport> {
  mkdirSync(policy.outboxDirectory, { recursive: true });
  mkdirSync(policy.processedDirectory, { recursive: true });
  mkdirSync(policy.failedDirectory, { recursive: true });

  const decisions: RuntimeScopeDriftWebhookDispatchDecision[] = [];
  const outboxFiles = listJsonFiles(policy.outboxDirectory);

  for (const filePath of outboxFiles) {
    const envelope = readJson<Record<string, unknown>>(filePath);
    let hadFailure = false;
    let hadSuccessfulSend = false;

    for (const target of policy.targets.filter((item) => item.enabled)) {
      const decision = await dispatchToTarget(
        filePath,
        envelope,
        target,
        policy.requestTimeoutMs,
        policy.maxAttemptsPerTarget,
        policy.retryBackoffMs,
      );
      decisions.push(decision);

      if (decision.action === 'sent') {
        hadSuccessfulSend = true;
      }
      if (decision.action === 'failed') {
        hadFailure = true;
      }
    }

    const destinationBase = path.basename(filePath);
    if (hadFailure) {
      const failedPath = path.join(policy.failedDirectory, destinationBase);
      renameSync(filePath, failedPath);
      for (const decision of decisions.filter((item) => item.outboxPath === filePath && item.action === 'failed')) {
        decision.failedPath = failedPath;
      }
    } else if (hadSuccessfulSend) {
      const processedPath = path.join(policy.processedDirectory, destinationBase);
      renameSync(filePath, processedPath);
      for (const decision of decisions.filter((item) => item.outboxPath === filePath && item.action === 'sent')) {
        decision.processedPath = processedPath;
      }
    }
  }

  return {
    dispatchVersion: 'lobster.scope-drift-webhook-dispatch.v0.1',
    generatedAt: new Date().toISOString(),
    policyVersion: policy.version,
    summary: {
      outboxCount: outboxFiles.length,
      sentCount: decisions.filter((item) => item.action === 'sent').length,
      failedCount: decisions.filter((item) => item.action === 'failed').length,
      skippedCount: decisions.filter((item) => item.action === 'skipped_no_target').length,
    },
    decisions,
  };
}
