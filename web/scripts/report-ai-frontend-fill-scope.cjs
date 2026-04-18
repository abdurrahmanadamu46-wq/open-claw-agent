const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

const groups = [
  {
    title: 'AI_FRONTEND_FILL_DELIVERY_PACKAGE',
    files: [
      'web/src/app/collab/page.tsx',
      'web/src/app/collab/reports/page.tsx',
      'web/src/app/collab/approvals/page.tsx',
      'web/src/app/lobsters/[id]/capabilities/page.tsx',
      'web/src/components/collab/CollabMetricCard.tsx',
      'web/src/components/collab/CollabRecordCard.tsx',
      'web/src/components/operations/IntegrationHelpCard.tsx',
      'web/src/components/lobster/SupervisorCapabilityTree.tsx',
      'web/src/lib/lobster-capability-tree.ts',
      'web/src/app/operations/tenant-cockpit/page.tsx',
      'web/src/app/operations/control-panel/page.tsx',
      'web/src/app/operations/frontend-gaps/page.tsx',
      'web/e2e/ai-frontend-owned-surfaces.spec.ts',
      'web/e2e/run-owned-surfaces-smoke.cjs',
      'web/docs/AI_FRONTEND_FILL_HANDOFF_2026-04-17.md',
      'web/docs/AI_FRONTEND_FILL_DELIVERY_SCOPE_2026-04-17.md',
      'web/package.json',
    ],
  },
  {
    title: 'OTHER_OWNER_CONFIRMATION_REQUIRED',
    files: [
      'web/src/app/page.tsx',
      'web/src/components/layout/AppSidebar.tsx',
      'web/src/components/layouts/Header.tsx',
      'web/src/services/endpoints/group-collab.ts',
      'web/src/types/integrations.ts',
    ],
  },
  {
    title: 'BUILD_UNBLOCK_FIXES_OUTSIDE_OWNERSHIP',
    files: [
      'web/src/app/operations/memory/page.tsx',
      'web/src/app/operations/channels/xiaohongshu/page.tsx',
    ],
  },
];

function runGit(args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    status: result.status ?? 1,
  };
}

for (const group of groups) {
  console.log(`\n--- ${group.title} ---`);
  const status = runGit(['status', '--short', '--', ...group.files]);
  if (status.stdout) {
    console.log(status.stdout);
  } else {
    console.log('(no changes)');
  }
  if (status.stderr) {
    console.error(status.stderr);
  }
}

console.log('\n--- VERIFY_COMMANDS ---');
console.log('npm run test:e2e:owned');
console.log('npm run build');
