import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ShadowTruthBundle, ShadowTruthRecord } from '../shadow/types.js';
import type { RuntimeFeedbackIngestReport } from './types.js';

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseDispatchId(dispatchId: string) {
  const parts = dispatchId.split(':');
  return {
    missionId: parts[1] ?? 'unknown-mission',
    stageId: parts[2] ?? 'unknown-stage',
    roleId: parts[3] ?? 'unknown-role',
  };
}

function listJsonFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  return readdirSync(dirPath)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dirPath, name));
}

function buildBaseRecord(
  filePath: string,
  bridgeTarget: string,
): { result: Record<string, unknown>; identity: ReturnType<typeof parseDispatchId>; baseRecord: ShadowTruthRecord } {
  const result = readJson<Record<string, unknown>>(filePath);
  const dispatchId = String(result.dispatchId ?? path.basename(filePath, '.json'));
  const identity = parseDispatchId(dispatchId);

  const sourceType =
    bridgeTarget === 'lead-ops-results'
      ? 'crm'
      : bridgeTarget === 'execute-campaign-results'
        ? 'runtime'
        : 'runtime';

  return {
    result,
    identity,
    baseRecord: {
      id: `ingest_${dispatchId.replace(/[:]/g, '_')}`,
      missionId: identity.missionId,
      sourceType,
      signal: `${bridgeTarget}_result`,
      roleId: identity.roleId,
      scopeId: typeof result.scopeId === 'string' ? result.scopeId : undefined,
      status: String(result.status ?? 'observed'),
      value: true,
      note: String(result.note ?? 'ingested result'),
      sourceRef: filePath,
    },
  };
}

function buildLeadOpsRecords(
  dispatchId: string,
  filePath: string,
  identity: ReturnType<typeof parseDispatchId>,
  payload: Record<string, unknown>,
): ShadowTruthRecord[] {
  const resultPayload = asRecord(payload.result);
  if (!resultPayload) {
    return [];
  }

  const leadId = typeof resultPayload.lead_id === 'string' ? resultPayload.lead_id : undefined;
  const error = typeof resultPayload.error === 'string' ? resultPayload.error : undefined;
  const status = resultPayload.ok === true ? 'success' : resultPayload.ok === false ? 'failed' : 'observed';
  const dispatchKey = dispatchId.replace(/[:]/g, '_');
  const scopeId =
    typeof payload.scopeId === 'string'
      ? payload.scopeId
      : typeof payload.scope_id === 'string'
        ? payload.scope_id
        : undefined;
  const records: ShadowTruthRecord[] = [
    {
      id: `ingest_${dispatchKey}_lead_push`,
      missionId: identity.missionId,
      sourceType: 'crm',
      signal: 'lead_push_result',
      roleId: identity.roleId,
      scopeId,
      status,
      value: resultPayload.ok === true,
      note: leadId ? `lead accepted: ${leadId}` : error ?? 'lead push observed',
      sourceRef: filePath,
    },
  ];

  if (leadId) {
    records.push({
      id: `ingest_${dispatchKey}_lead_id`,
      missionId: identity.missionId,
      sourceType: 'crm',
      signal: 'lead_id_assigned',
      roleId: identity.roleId,
      scopeId,
      status: 'success',
      value: true,
      note: leadId,
      sourceRef: filePath,
    });
  }

  return records;
}

function buildExecuteCampaignRecords(
  dispatchId: string,
  filePath: string,
  identity: ReturnType<typeof parseDispatchId>,
  payload: Record<string, unknown>,
): ShadowTruthRecord[] {
  const resultPayload = asRecord(payload.result);
  const campaignPayload = asRecord(payload.campaignPayload);
  const scopeId =
    typeof payload.scopeId === 'string'
      ? payload.scopeId
      : typeof payload.scope_id === 'string'
        ? payload.scope_id
        : undefined;
  let executionDetails = asRecord(resultPayload?.executionDetails);

  if (!executionDetails) {
    const campaignId =
      typeof campaignPayload?.campaign_id === 'string' ? campaignPayload.campaign_id : identity.missionId;
    const fallbackArtifactPath = path.join(
      'F:\\openclaw-agent\\run\\execute-campaign-artifacts',
      `${campaignId}.json`,
    );

    if (existsSync(fallbackArtifactPath)) {
      executionDetails = asRecord(readJson<Record<string, unknown>>(fallbackArtifactPath));
    }
  }

  if (!executionDetails) {
    return [];
  }

  const dispatchKey = dispatchId.replace(/[:]/g, '_');
  const sceneCount =
    typeof executionDetails.sceneCount === 'number' ? executionDetails.sceneCount : undefined;
  const postResult = asRecord(executionDetails.postResult);
  const script = asRecord(executionDetails.script);
  const artifactPath =
    typeof executionDetails.artifactPath === 'string' ? executionDetails.artifactPath : filePath;
  const records: ShadowTruthRecord[] = [
    {
      id: `ingest_${dispatchKey}_execute_task`,
      missionId: identity.missionId,
      sourceType: 'runtime',
      signal: 'content_execute_task',
      roleId: identity.roleId,
      scopeId,
      status: 'success',
      value: true,
      note: `content adapter executed for ${identity.missionId}`,
      sourceRef: artifactPath,
    },
  ];

  if (sceneCount !== undefined) {
    records.push({
      id: `ingest_${dispatchKey}_scene_count`,
      missionId: identity.missionId,
      sourceType: 'runtime',
      signal: 'content_scene_count',
      roleId: identity.roleId,
      scopeId,
      status: 'measured',
      value: sceneCount,
      note: `scene_count=${sceneCount}`,
      sourceRef: artifactPath,
    });
  }

  if (script) {
    const scriptCopy = typeof script.copy === 'string' ? script.copy : '';
    records.push({
      id: `ingest_${dispatchKey}_script_generated`,
      missionId: identity.missionId,
      sourceType: 'runtime',
      signal: 'content_script_generated',
      roleId: identity.roleId,
      scopeId,
      status: scriptCopy ? 'success' : 'observed',
      value: scriptCopy.length,
      note: scriptCopy ? scriptCopy.slice(0, 120) : 'script generated without copy preview',
      sourceRef: artifactPath,
    });
  }

  if (postResult) {
    records.push({
      id: `ingest_${dispatchKey}_post_result`,
      missionId: identity.missionId,
      sourceType: 'runtime',
      signal: 'content_post_result',
      roleId: identity.roleId,
      scopeId,
      status: postResult.ok === true ? 'success' : postResult.ok === false ? 'failed' : 'observed',
      value: postResult.ok === true,
      note:
        typeof postResult.screenshotPath === 'string'
          ? postResult.screenshotPath
          : typeof postResult.error === 'string'
            ? postResult.error
            : 'post result observed',
      sourceRef: artifactPath,
    });
  }

  if (typeof executionDetails.platform === 'string') {
    records.push({
      id: `ingest_${dispatchKey}_platform`,
      missionId: identity.missionId,
      sourceType: 'runtime',
      signal: 'content_platform_selected',
      roleId: identity.roleId,
      scopeId,
      status: 'observed',
      value: executionDetails.platform,
      note: `platform=${executionDetails.platform}`,
      sourceRef: artifactPath,
    });
  }

  return records;
}

function recordsFromResult(filePath: string, bridgeTarget: string): ShadowTruthRecord[] {
  const { result, identity, baseRecord } = buildBaseRecord(filePath, bridgeTarget);
  const dispatchId = String(result.dispatchId ?? path.basename(filePath, '.json'));
  const payload = asRecord(result.payload) ?? {};
  const records = [baseRecord];

  if (bridgeTarget === 'lead-ops-results') {
    records.push(...buildLeadOpsRecords(dispatchId, filePath, identity, payload));
  }

  if (bridgeTarget === 'execute-campaign-results') {
    records.push(...buildExecuteCampaignRecords(dispatchId, filePath, identity, payload));
  }

  return records;
}

export function ingestRuntimeResults(options: {
  baseTruthPath?: string;
  outputTruthPath: string;
  resultDirectories: string[];
}): RuntimeFeedbackIngestReport {
  const baseBundle: ShadowTruthBundle | null =
    options.baseTruthPath && existsSync(options.baseTruthPath)
      ? readJson<ShadowTruthBundle>(options.baseTruthPath)
      : null;

  const inputFileCount = options.resultDirectories.reduce(
    (sum, dirPath) => sum + listJsonFiles(dirPath).length,
    0,
  );
  const ingestedRecords = options.resultDirectories.flatMap((dirPath) => {
    const bridgeTarget = path.basename(dirPath);
    return listJsonFiles(dirPath).flatMap((filePath) => recordsFromResult(filePath, bridgeTarget));
  });

  const mergedMap = new Map<string, ShadowTruthRecord>();

  for (const record of baseBundle?.records ?? []) {
    mergedMap.set(record.id, record);
  }

  for (const record of ingestedRecords) {
    mergedMap.set(record.id, record);
  }

  const mergedBundle: ShadowTruthBundle = {
    schemaVersion: 'lobster.shadow-truth.v0.2',
    generatedAt: new Date().toISOString(),
    records: [...mergedMap.values()],
  };

  writeFileSync(options.outputTruthPath, JSON.stringify(mergedBundle, null, 2));

  const sourceBreakdown: Record<string, number> = {};
  const signalBreakdown: Record<string, number> = {};
  for (const record of ingestedRecords) {
    increment(sourceBreakdown, record.sourceType);
    increment(signalBreakdown, record.signal);
  }

  return {
    ingestVersion: 'lobster.runtime-feedback-ingestor.v0.2',
    generatedAt: new Date().toISOString(),
    baseTruthPath: options.baseTruthPath ?? null,
    outputTruthPath: options.outputTruthPath,
    summary: {
      inputRecordCount: baseBundle?.records.length ?? 0,
      ingestedRecordCount: ingestedRecords.length,
      mergedRecordCount: mergedBundle.records.length,
      payloadExpandedCount: Math.max(ingestedRecords.length - inputFileCount, 0),
      sourceBreakdown,
      signalBreakdown,
    },
    ingestedRecordIds: ingestedRecords.map((record) => record.id),
  };
}
