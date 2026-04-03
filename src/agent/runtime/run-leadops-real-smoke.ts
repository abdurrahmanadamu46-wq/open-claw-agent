import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { pushLeadToBackend } from '../lead/lead-pusher.js';
import { resolveLeadPushRuntimeConfig } from '../lead/lead-runtime-config.js';
import type { ILeadSubmissionPayload } from '../../shared/contracts.js';

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const outIndex = argv.indexOf('--out');
  const tenantIndex = argv.indexOf('--tenant');
  const campaignIndex = argv.indexOf('--campaign');
  const contactIndex = argv.indexOf('--contact');
  const scoreIndex = argv.indexOf('--score');

  return {
    apply,
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
    tenantId:
      tenantIndex >= 0 && argv[tenantIndex + 1]
        ? argv[tenantIndex + 1]
        : 'shadow-tenant-smoke',
    campaignId:
      campaignIndex >= 0 && argv[campaignIndex + 1]
        ? argv[campaignIndex + 1]
        : 'leadops-smoke-campaign',
    contactInfo:
      contactIndex >= 0 && argv[contactIndex + 1]
        ? argv[contactIndex + 1]
        : 'smoke-contact-placeholder',
    intentionScore:
      scoreIndex >= 0 && argv[scoreIndex + 1]
        ? Number(argv[scoreIndex + 1])
        : 85,
  };
}

async function main() {
  const { apply, outPath, tenantId, campaignId, contactInfo, intentionScore } = parseArgs(process.argv.slice(2));
  const config = resolveLeadPushRuntimeConfig();

  const payload: ILeadSubmissionPayload = {
    tenant_id: tenantId,
    campaign_id: campaignId,
    contact_info: contactInfo,
    intention_score: intentionScore,
    source_platform: 'leadops-smoke',
    raw_context: JSON.stringify({
      smoke: true,
      created_at: new Date().toISOString(),
    }),
  } as ILeadSubmissionPayload;

  let result: Record<string, unknown> = {
    mode: 'dry_run',
  };

  if (apply) {
    result = {
      mode: 'apply',
      response: await pushLeadToBackend(payload),
    };
  }

  const report = {
    smokeVersion: 'lobster.leadops-real-smoke.v0.1',
    generatedAt: new Date().toISOString(),
    apply,
    runtimeConfig: {
      backendInternalUrl: config.backendInternalUrl,
      urlSource: config.urlSource,
      secretSource: config.secretSource,
      hasSecret: Boolean(config.internalApiSecret),
    },
    payload,
    result,
  };

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

void main();
