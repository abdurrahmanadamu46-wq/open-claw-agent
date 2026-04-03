const assert = require('node:assert/strict');
const { FleetController } = require('../dist/fleet/fleet.controller.js');
const { CampaignController } = require('../dist/campaign/campaign.controller.js');
const { DashboardController } = require('../dist/dashboard/dashboard.controller.js');

async function main() {
  const tenantReq = { user: { tenantId: 'tenantA', isAdmin: true, roles: ['admin'] } };

  const fleetController = new FleetController({
    async listNodes() {
      return [{ nodeId: 'node-1', tenantId: 'tenantA', status: 'ONLINE' }];
    },
    async forceOffline() {
      return { ok: true };
    },
    async dispatchCommand() {
      return { commandId: 'cmd-1', status: 'SENT' };
    },
  });
  const fleetList = await fleetController.listNodes(tenantReq);
  assert.equal(fleetList.code, 0);
  assert.ok(Array.isArray(fleetList.data.list));
  const fleetOffline = await fleetController.forceOffline('node-1', tenantReq);
  assert.equal(fleetOffline.code, 0);
  assert.equal(fleetOffline.data.ok, true);
  const fleetCommand = await fleetController.dispatchCommand(
    { targetNodeId: 'node-1', actionType: 'START_CAMPAIGN', payload: {} },
    tenantReq,
  );
  assert.equal(fleetCommand.code, 0);
  assert.equal(fleetCommand.data.commandId, 'cmd-1');

  const campaignController = new CampaignController({
    async list() {
      return {
        total: 1,
        list: [
          {
            campaign_id: 'CAMP_1',
            industry_template_id: 'tpl',
            status: 'PENDING',
            daily_publish_limit: 10,
            leads_collected: 0,
            created_at: new Date().toISOString(),
          },
        ],
      };
    },
    async create() {
      return { campaign_id: 'CAMP_1', status: 'PENDING' };
    },
    async terminate() {
      return { ok: true };
    },
  });
  const campaignList = await campaignController.listCampaigns('1', '10', undefined, tenantReq);
  assert.equal(campaignList.code, 0);
  assert.equal(campaignList.data.total, 1);
  const created = await campaignController.createCampaign(
    { industry_template_id: 'tpl', target_urls: ['https://x.com/a'] },
    tenantReq,
  );
  assert.equal(created.code, 0);
  assert.equal(created.data.campaign_id, 'CAMP_1');
  const terminated = await campaignController.terminateCampaign('CAMP_1', tenantReq);
  assert.equal(terminated.code, 0);
  assert.equal(terminated.data.ok, true);

  const dashboardController = new DashboardController({
    async getMetrics() {
      return {
        total_leads_today: 12,
        leads_growth_rate: '20%',
        active_campaigns: 3,
        total_videos_published: 9,
        node_health_rate: '85%',
        chart_data_7days: [],
      };
    },
  });
  const dashboard = await dashboardController.getMetrics(tenantReq);
  assert.equal(dashboard.code, 0);
  assert.equal(typeof dashboard.data.total_leads_today, 'number');
  assert.equal(typeof dashboard.data.node_health_rate, 'string');
  assert.ok(Array.isArray(dashboard.data.chart_data_7days));

  console.log('week3-contract-tests: all tests passed');
}

main().catch((err) => {
  console.error('week3-contract-tests: test failed');
  console.error(err);
  process.exit(1);
});

