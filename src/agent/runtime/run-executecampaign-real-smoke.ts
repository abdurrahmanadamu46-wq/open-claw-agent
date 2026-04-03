import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ICampaignConfig } from '../../shared/contracts.js';
import {
  closeExecuteCampaignRuntimeContext,
  createExecuteCampaignRuntimeContext,
  ensureExecuteCampaignRuntimeNode,
  resolveExecuteCampaignRuntimeConfig,
  runExecuteCampaignWithRuntime,
} from './execute-campaign-runtime.js';
import { createRuntimeContentExecuteTask } from './execute-task-content-adapter.js';

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const ensureNode = argv.includes('--ensure-node') || !argv.includes('--no-ensure-node');
  const outIndex = argv.indexOf('--out');
  const tenantIndex = argv.indexOf('--tenant');
  const campaignIndex = argv.indexOf('--campaign');
  const industryIndex = argv.indexOf('--industry-template');
  const urlIndex = argv.indexOf('--target-url');
  const bindIndex = argv.indexOf('--bind-account');

  return {
    apply,
    ensureNode,
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
    tenantId:
      tenantIndex >= 0 && argv[tenantIndex + 1]
        ? argv[tenantIndex + 1]
        : 'shadow-tenant-execute-smoke',
    campaignId:
      campaignIndex >= 0 && argv[campaignIndex + 1]
        ? argv[campaignIndex + 1]
        : 'execute-campaign-smoke',
    industryTemplateId:
      industryIndex >= 0 && argv[industryIndex + 1]
        ? argv[industryIndex + 1]
        : 'content_production-template',
    targetUrl:
      urlIndex >= 0 && argv[urlIndex + 1]
        ? argv[urlIndex + 1]
        : 'https://example.com/placeholder',
    bindAccount:
      bindIndex >= 0 && argv[bindIndex + 1]
        ? argv[bindIndex + 1]
        : 'placeholder-account',
  };
}

async function main() {
  const {
    apply,
    ensureNode,
    outPath,
    tenantId,
    campaignId,
    industryTemplateId,
    targetUrl,
    bindAccount,
  } = parseArgs(process.argv.slice(2));
  const runtimeConfig = resolveExecuteCampaignRuntimeConfig();
  const payload: ICampaignConfig = {
    campaign_id: campaignId,
    tenant_id: tenantId,
    industry_template_id: industryTemplateId,
    target_urls: [targetUrl],
    bind_accounts: [bindAccount],
  };
  let nodePreview: Record<string, unknown> | null = null;
  let result: Record<string, unknown> = { mode: 'dry_run' };
  const context = await createExecuteCampaignRuntimeContext();

  try {
    if (ensureNode) {
      const node = await ensureExecuteCampaignRuntimeNode(context, {
        metadata: {
          smoke: true,
        },
      });
      nodePreview = {
        nodeId: node.nodeId,
        state: node.state,
        health: node.health,
      };
    }

    if (apply) {
      result = {
        mode: 'apply',
        response: await runExecuteCampaignWithRuntime(payload, {
          context,
          ensureNode,
          executeTask:
            process.env.LOBSTER_RUNTIME_ENABLE_CONTENT_EXECUTE_TASK === 'true'
              ? createRuntimeContentExecuteTask()
              : undefined,
        }),
      };
    }

    const report = {
      smokeVersion: 'lobster.execute-campaign-real-smoke.v0.1',
      generatedAt: new Date().toISOString(),
      apply,
      runtimeConfig,
      payload,
      nodePreview,
      result,
    };

    if (outPath) {
      writeFileSync(outPath, JSON.stringify(report, null, 2));
    }

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await closeExecuteCampaignRuntimeContext(context);
  }
}

void main();
