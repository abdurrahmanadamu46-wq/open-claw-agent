/**
 * ClawCommerce 无头 E2E 联调脚本 (PM v1.14 - API First)
 * 纯 API 链路贯通，不依赖 Next.js / UI。跑通后即可接 UI。
 *
 * 用法：在项目根目录执行
 *   npx tsx scripts/test-e2e.ts
 * 或
 *   npm run e2e
 *
 * 环境变量（见 .env.e2e.example）：
 *   E2E_API_BASE_URL   - 后端 Base URL（如 http://localhost:3000）
 *   E2E_JWT            - 商家端 JWT（用于 POST/GET /api/v1/*）
 *   E2E_TENANT_ID      - 当前租户 ID（与 JWT 对应，用于内部线索回传）
 *   INTERNAL_API_SECRET - 与后端 .env 一致，用于 POST /api/internal/leads
 */

import 'dotenv/config';

const BASE = (process.env.E2E_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const JWT = process.env.E2E_JWT ?? '';
const TENANT_ID = process.env.E2E_TENANT_ID ?? '';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(msg: string, tag: 'INFO' | 'OK' | 'FAIL' | 'WARN' = 'INFO') {
  const prefix = tag === 'OK' ? '[PASS]' : tag === 'FAIL' ? '[FAIL]' : tag === 'WARN' ? '[WARN]' : '[----]';
  console.log(`${prefix} ${msg}`);
}

async function step1CreateCampaign(): Promise<string> {
  log('Step 1: POST /api/v1/campaigns (模拟前端创建任务)');
  const payload = {
    industry_template_id: '10秒爆款短视频',
    target_urls: ['https://v.douyin.com/test-e2e-link'],
    content_strategy: { template_type: '10秒爆款短视频', min_clips: 3, max_clips: 6 },
    bind_accounts: ['test-account-1'],
  };
  const res = await fetch(`${BASE}/api/v1/campaigns`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(JWT ? { Authorization: `Bearer ${JWT}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: { code?: number; data?: { campaign_id?: string; status?: string }; message?: string };
  try {
    data = JSON.parse(text);
  } catch {
    log(`Response not JSON: ${text.slice(0, 200)}`, 'FAIL');
    throw new Error('Step 1: invalid JSON');
  }
  if (!res.ok) {
    log(`HTTP ${res.status} ${data.message ?? text}`, 'FAIL');
    throw new Error(`Step 1: ${res.status}`);
  }
  const campaignId = data.data?.campaign_id;
  if (!campaignId) {
    log(`Missing campaign_id in response: ${text.slice(0, 300)}`, 'FAIL');
    throw new Error('Step 1: no campaign_id');
  }
  log(`Step 1: HTTP 200, campaign_id=${campaignId}`, 'OK');
  log('  请观测后端 BullMQ 终端：任务是否成功入队', 'WARN');
  return campaignId;
}

function step2Step3Observe() {
  log('Step 2 & 3: 观测后端 BullMQ 与 Agent 终端');
  log('  - 后端：BullMQ Processor 是否消费 job 并 POST 到 Agent /internal/campaign/execute', 'WARN');
  log('  - Agent：是否收到 execute，node-manager 是否分配节点、状态是否变为 SCRAPING', 'WARN');
}

async function step4PushMockLead(campaignId: string): Promise<void> {
  log('Step 4: POST /api/internal/leads (模拟战果回收)');
  if (!INTERNAL_SECRET) {
    log('INTERNAL_API_SECRET 未设置，请与后端 .env 保持一致', 'FAIL');
    throw new Error('Step 4: missing INTERNAL_API_SECRET');
  }
  if (!TENANT_ID) {
    log('E2E_TENANT_ID 未设置，无法推送线索', 'FAIL');
    throw new Error('Step 4: missing E2E_TENANT_ID');
  }
  const body = {
    tenant_id: TENANT_ID,
    campaign_id: campaignId,
    contact_info: '13812345678',
    intention_score: 85,
    source_platform: 'douyin',
    raw_context: 'E2E headless test',
  };
  const res = await fetch(`${BASE}/api/internal/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: { lead_id?: string; message?: string };
  try {
    data = JSON.parse(text);
  } catch {
    log(`Response not JSON: ${text.slice(0, 200)}`, 'FAIL');
    throw new Error('Step 4: invalid JSON');
  }
  if (!res.ok) {
    log(`HTTP ${res.status} ${data.message ?? text}`, 'FAIL');
    throw new Error(`Step 4: ${res.status}`);
  }
  log(`Step 4: HTTP 200, lead 已落库 (lead_id=${data.lead_id ?? '—'})`, 'OK');
}

async function step5VerifyLeadsList(campaignId: string): Promise<void> {
  log('Step 5: GET /api/v1/leads 验证落库与脱敏');
  const res = await fetch(`${BASE}/api/v1/leads?page=1&limit=20`, {
    headers: JWT ? { Authorization: `Bearer ${JWT}` } : {},
  });
  const text = await res.text();
  let data: { code?: number; data?: { total?: number; list?: Array<{ campaign_id: string; contact_info: string }> }; message?: string };
  try {
    data = JSON.parse(text);
  } catch {
    log(`Response not JSON: ${text.slice(0, 200)}`, 'FAIL');
    throw new Error('Step 5: invalid JSON');
  }
  if (!res.ok) {
    log(`HTTP ${res.status} ${data.message ?? text}`, 'FAIL');
    throw new Error(`Step 5: ${res.status}`);
  }
  const list = data.data?.list ?? [];
  const ours = list.filter((l) => l.campaign_id === campaignId);
  if (ours.length === 0) {
    log(`未在列表中找到 campaign_id=${campaignId} 的线索，当前 list 长度=${list.length}`, 'FAIL');
    throw new Error('Step 5: lead not found in list');
  }
  const contact = ours[0].contact_info ?? '';
  const maskedOk = /^\d{3}\*\*\*\*\d{4}$/.test(contact) || contact === '138****5678';
  if (!maskedOk) {
    log(`脱敏校验失败：期望 138****5678 形式，实际 contact_info="${contact}"`, 'FAIL');
    throw new Error('Step 5: masking check failed');
  }
  log(`Step 5: 线索可见且手机号已脱敏 contact_info="${contact}"`, 'OK');
}

async function main() {
  console.log('\n--- ClawCommerce 无头 E2E 联调 (PM v1.14) ---\n');
  if (!JWT) log('E2E_JWT 未设置，/api/v1/* 可能返回 401', 'WARN');
  if (!TENANT_ID) log('E2E_TENANT_ID 未设置，Step 4 将失败', 'WARN');

  try {
    const campaignId = await step1CreateCampaign();
    step2Step3Observe();
    await sleep(1500);
    await step4PushMockLead(campaignId);
    await sleep(500);
    await step5VerifyLeadsList(campaignId);
    console.log('\n--- 5 步 E2E 全部通过，大动脉已打通 ---\n');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
