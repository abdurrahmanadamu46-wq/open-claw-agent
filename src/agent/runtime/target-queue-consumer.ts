import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createTargetHandlerRegistryWithMode,
  toTargetHandlerInput,
} from './target-handlers.js';
import type {
  RuntimeLiveQueueRecord,
  RuntimeTargetHandlerMode,
  RuntimeTargetHandlerRegistry,
  RuntimeTargetQueueConsumeDecision,
  RuntimeTargetQueueConsumerPolicy,
  RuntimeTargetQueueConsumerReport,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPolicyPath = path.join(__dirname, 'config', 'target-queue-consumer.policy.json');

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

export function loadTargetQueueConsumerPolicy(
  policyPath?: string,
): RuntimeTargetQueueConsumerPolicy {
  const resolvedPath = policyPath ? path.resolve(policyPath) : defaultPolicyPath;

  if (!existsSync(resolvedPath)) {
    throw new Error(`Target queue consumer policy not found: ${resolvedPath}`);
  }

  return readJson<RuntimeTargetQueueConsumerPolicy>(resolvedPath);
}

async function processRecord(
  bridgeTarget: string,
  recordPath: string,
  policy: RuntimeTargetQueueConsumerPolicy,
  handlers: RuntimeTargetHandlerRegistry,
): Promise<RuntimeTargetQueueConsumeDecision> {
  const record = readJson<RuntimeLiveQueueRecord>(recordPath);
  const processedDir = policy.processedDirectories[bridgeTarget];
  const resultDir = policy.resultDirectories[bridgeTarget];
  const handler = handlers[bridgeTarget];

  if (!processedDir || !resultDir) {
    return {
      queueRecordId: record.dispatchId,
      bridgeTarget,
      action: 'denied',
      rationale: ['missing_processed_or_result_directory'],
    };
  }

  if (!handler) {
    return {
      queueRecordId: record.dispatchId,
      bridgeTarget,
      action: 'denied',
      rationale: ['missing_target_handler'],
    };
  }

  mkdirSync(processedDir, { recursive: true });
  mkdirSync(resultDir, { recursive: true });
  const result = await handler(
    toTargetHandlerInput(
      record.dispatchId,
      bridgeTarget,
      record.scopeId,
      record.payload,
      record.guardrails,
    ),
  );
  const resultPayload = {
    resultVersion: 'lobster.runtime-target-result.v0.1',
    processedAt: new Date().toISOString(),
    bridgeTarget,
    dispatchId: record.dispatchId,
    scopeId: record.scopeId,
    status: result.status,
    note: result.note,
    payload: result.payloadEcho ?? record.payload,
  };

  const resultPath = path.join(resultDir, path.basename(recordPath));
  const processedPath = path.join(processedDir, path.basename(recordPath));

  writeFileSync(resultPath, JSON.stringify(resultPayload, null, 2));
  renameSync(recordPath, processedPath);

  return {
    queueRecordId: record.dispatchId,
    bridgeTarget,
    action: 'processed',
    handlerSource: result.handlerSource ?? 'simulated',
    processedPath,
    resultPath,
    rationale: ['target_queue_record_processed'],
  };
}

export async function buildTargetQueueConsumerReport(
  policy: RuntimeTargetQueueConsumerPolicy,
  handlers: RuntimeTargetHandlerRegistry = createTargetHandlerRegistryWithMode({
    mode: 'simulated',
  }),
  handlerMode: RuntimeTargetHandlerMode = 'simulated',
  activeBindings: string[] = [],
): Promise<RuntimeTargetQueueConsumerReport> {
  const decisions: RuntimeTargetQueueConsumeDecision[] = [];
  const targetBreakdown: Record<string, number> = {};
  let recordCount = 0;

  for (const [bridgeTarget, queueDir] of Object.entries(policy.targetQueues)) {
    if (!existsSync(queueDir)) {
      continue;
    }

    const files = readdirSync(queueDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(queueDir, name));

    recordCount += files.length;

    for (const filePath of files) {
      const decision = await processRecord(bridgeTarget, filePath, policy, handlers);
      decisions.push(decision);
      if (decision.action === 'processed') {
        targetBreakdown[bridgeTarget] = (targetBreakdown[bridgeTarget] ?? 0) + 1;
      }
    }
  }

  return {
    consumerVersion: 'lobster.runtime-target-queue-consumer.v0.1',
    generatedAt: new Date().toISOString(),
    policyVersion: policy.version,
    handlerMode,
    activeBindings,
    summary: {
      recordCount,
      processedCount: decisions.filter((item) => item.action === 'processed').length,
      deniedCount: decisions.filter((item) => item.action === 'denied').length,
      injectedCount: decisions.filter((item) => item.handlerSource === 'injected').length,
      fallbackCount: decisions.filter((item) => item.handlerSource === 'fallback').length,
      targetBreakdown,
    },
    decisions,
  };
}
