import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  RuntimeLimitedLiveEnvelope,
  RuntimeLiveQueueConsumerDecision,
  RuntimeLiveQueueConsumerPolicy,
  RuntimeLiveQueueConsumerReport,
  RuntimeLiveQueueRecord,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPolicyPath = path.join(__dirname, 'config', 'live-queue-consumer.policy.json');

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

export function loadLiveQueueConsumerPolicy(
  policyPath?: string,
): RuntimeLiveQueueConsumerPolicy {
  const resolvedPath = policyPath ? path.resolve(policyPath) : defaultPolicyPath;

  if (!existsSync(resolvedPath)) {
    throw new Error(`Live queue consumer policy not found: ${resolvedPath}`);
  }

  return readJson<RuntimeLiveQueueConsumerPolicy>(resolvedPath);
}

function buildQueueRecord(envelope: RuntimeLimitedLiveEnvelope): RuntimeLiveQueueRecord {
  return {
    recordVersion: 'lobster.runtime-live-queue-record.v0.1',
    consumedAt: new Date().toISOString(),
    dispatchId: envelope.dispatchId,
    missionId: envelope.missionId,
    missionType: envelope.missionType,
    stageId: envelope.stageId,
    ownerRole: envelope.ownerRole,
    scopeId: envelope.scopeId,
    bridgeTarget: envelope.bridgeTarget,
    dispatchStrategy: envelope.dispatchStrategy,
    payload: envelope.payload,
    guardrails: envelope.guardrails,
  };
}

function groupLatestEnvelopePaths(sourceFiles: string[]): {
  latestFiles: string[];
  deduplicatedFiles: string[];
} {
  const latestByDispatch = new Map<string, { filePath: string; mtimeMs: number }>();
  const deduplicatedFiles: string[] = [];

  for (const filePath of sourceFiles) {
    const envelope = readJson<RuntimeLimitedLiveEnvelope>(filePath);
    const current = latestByDispatch.get(envelope.dispatchId);
    const mtimeMs = statSync(filePath).mtimeMs;

    if (!current || mtimeMs > current.mtimeMs) {
      if (current) {
        deduplicatedFiles.push(current.filePath);
      }
      latestByDispatch.set(envelope.dispatchId, { filePath, mtimeMs });
    } else {
      deduplicatedFiles.push(filePath);
    }
  }

  return {
    latestFiles: [...latestByDispatch.values()].map((item) => item.filePath),
    deduplicatedFiles,
  };
}

function consumeEnvelope(
  envelopePath: string,
  policy: RuntimeLiveQueueConsumerPolicy,
): RuntimeLiveQueueConsumerDecision {
  const envelope = readJson<RuntimeLimitedLiveEnvelope>(envelopePath);
  const targetQueue = policy.targetQueues[envelope.bridgeTarget];

  if (!targetQueue) {
    return {
      dispatchId: envelope.dispatchId,
      bridgeTarget: envelope.bridgeTarget,
      action: 'denied',
      rationale: ['missing_target_queue_mapping'],
    };
  }

  mkdirSync(targetQueue, { recursive: true });
  mkdirSync(policy.processedDirectory, { recursive: true });

  const queueRecord = buildQueueRecord(envelope);
  const queuePath = path.join(
    targetQueue,
    `${envelope.dispatchId.replace(/[:]/g, '__')}.json`,
  );
  const processedPath = path.join(policy.processedDirectory, path.basename(envelopePath));

  writeFileSync(queuePath, JSON.stringify(queueRecord, null, 2));
  renameSync(envelopePath, processedPath);

  return {
    dispatchId: envelope.dispatchId,
    bridgeTarget: envelope.bridgeTarget,
    action: 'queued',
    queuePath,
    processedPath,
    rationale: ['queued_to_target_directory'],
  };
}

export function buildLiveQueueConsumerReport(
  policy: RuntimeLiveQueueConsumerPolicy,
): RuntimeLiveQueueConsumerReport {
  mkdirSync(policy.sourceDirectory, { recursive: true });
  mkdirSync(policy.processedDirectory, { recursive: true });

  const sourceFiles = readdirSync(policy.sourceDirectory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(policy.sourceDirectory, name));
  const { latestFiles, deduplicatedFiles } = groupLatestEnvelopePaths(sourceFiles);
  const targetBreakdown: Record<string, number> = {};

  for (const duplicatePath of deduplicatedFiles) {
    const processedPath = path.join(
      policy.processedDirectory,
      path.basename(duplicatePath),
    );
    renameSync(duplicatePath, processedPath);
  }

  const decisions = latestFiles.map((filePath) => {
    const decision = consumeEnvelope(filePath, policy);

    if (decision.action === 'queued') {
      targetBreakdown[decision.bridgeTarget] =
        (targetBreakdown[decision.bridgeTarget] ?? 0) + 1;
    }

    return decision;
  });

  return {
    consumerVersion: 'lobster.runtime-live-queue-consumer.v0.1',
    generatedAt: new Date().toISOString(),
    policyVersion: policy.version,
    summary: {
      sourceCount: sourceFiles.length,
      queuedCount: decisions.filter((item) => item.action === 'queued').length,
      deniedCount: decisions.filter((item) => item.action === 'denied').length,
      deduplicatedCount: deduplicatedFiles.length,
      targetBreakdown,
    },
    decisions,
  };
}
