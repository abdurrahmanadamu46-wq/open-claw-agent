import fs from 'node:fs';
import path from 'node:path';

import { buildIndustryWorkflowRuntimeHandoffBundle } from './industry-workflow-runtime-handoff.js';

const outPath = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1] ?? '')
  : path.resolve('F:/openclaw-agent/docs/architecture/LOBSTER_INDUSTRY_RUNTIME_HANDOFF_SMOKE_2026-03-30.json');

const handoff = buildIndustryWorkflowRuntimeHandoffBundle({
  workflowId: 'industry-workflow-smoke-dental',
  categoryId: 'medical_health',
  subIndustryId: 'dental_clinic',
  channels: ['xiaohongshu', 'douyin'],
  merchantProfile: {
    brandName: '亮哥口腔增长样板',
    tenantId: 'tenant-dental-smoke',
    bindAccounts: ['edge-account-demo-01'],
    customerPainPoints: [
      '发了内容没有有效私信',
      '评论很多但无法快速分辨高意向客户',
      '销售跟进不及时导致线索流失'
    ],
    solvedProblems: [
      '把内容生产、发布、承接和转化做成闭环',
      '让评论和私信自动回流到云端打分',
      '让高意向客户更快进入预约和电话推进'
    ],
    personaBackground: '10年本地商家增长顾问，长期服务口腔与医疗健康机构。',
    competitiveAdvantages: [
      '不是单点 AI 工具，而是云边协同增长系统',
      '高风险动作默认审批、可审计、可回滚',
      '行业打法可复用，内容和线索闭环会越跑越强'
    ]
  },
  callScoreThreshold: 88
});

fs.writeFileSync(outPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, outPath, runtimeStepCount: handoff.runtimeSteps.length }, null, 2));
