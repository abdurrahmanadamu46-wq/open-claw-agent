import fs from 'node:fs';
import path from 'node:path';

import {
  compileIndustryWorkflowHandler,
  getIndustryCatalogHandler,
  hydrateLeadPushRuntimeEnv,
  resolveLeadPushRuntimeConfig,
} from './index.js';

const outPath = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1] ?? '')
  : path.resolve('F:/openclaw-agent/docs/architecture/LOBSTER_PUBLIC_EXPORT_CHAIN_SMOKE_2026-03-30.json');

function createRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string | number>,
    body: '',
    setHeader(name: string, value: string | number) {
      this.headers[name] = value;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      if (headers) this.headers = { ...this.headers, ...headers };
    },
    end(body?: string) {
      this.body = body ?? '';
    },
  };
}

async function main() {
  const runtimeConfig = resolveLeadPushRuntimeConfig();
  hydrateLeadPushRuntimeEnv();

  const catalogRes = createRes();
  await getIndustryCatalogHandler()({ method: 'GET', url: '/api/agent/industry/catalog' }, catalogRes);
  const catalog = JSON.parse(catalogRes.body);

  const payload = {
    workflowId: 'wf_public_export_chain_smoke',
    categoryId: 'medical_health',
    subIndustryId: 'dental_clinic',
    merchantProfile: {
      brandName: '亮哥口腔增长样板',
      tenantId: 'tenant-dental-smoke',
      bindAccounts: ['edge-account-demo-01'],
      customerPainPoints: ['发了内容没有有效私信'],
      solvedProblems: ['把内容生产、发布、承接和转化做成闭环'],
      personaBackground: '10年本地商家增长顾问',
      competitiveAdvantages: ['高风险动作默认审批、可审计、可回滚'],
    },
  };
  const compileReq = {
    method: 'POST',
    url: '/api/agent/industry/compile',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload), 'utf8');
    },
  };
  const compileRes = createRes();
  await compileIndustryWorkflowHandler()(compileReq, compileRes);
  const compiled = JSON.parse(compileRes.body);

  const report = {
    smokeVersion: 'lobster.public-export-chain-smoke.v0.1',
    generatedAt: new Date().toISOString(),
    runtimeConfig: {
      backendInternalUrl: runtimeConfig.backendInternalUrl,
      urlSource: runtimeConfig.urlSource,
      secretSource: runtimeConfig.secretSource,
    },
    catalogStatus: catalogRes.statusCode,
    categoryCount: catalog.categories.length,
    compileStatus: compileRes.statusCode,
    previewVersion: compiled.version,
    previewHeader: compiled.frontendPreview.header,
  };

  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, outPath }, null, 2));
}

void main();
