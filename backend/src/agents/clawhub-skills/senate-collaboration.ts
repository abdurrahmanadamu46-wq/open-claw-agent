import type { ClawhubAgentId } from './schemas';

export type SenateTier =
  | 'intelligence'
  | 'content_factory'
  | 'orchestration'
  | 'conversion';

export type SenateDagEdge = {
  from: ClawhubAgentId;
  to: ClawhubAgentId;
  artifact: string;
};

export const SENATE_TIER_PLAN: Record<SenateTier, ClawhubAgentId[]> = {
  intelligence: ['radar', 'strategist'],
  content_factory: ['ink-writer', 'visualizer'],
  orchestration: ['dispatcher'],
  conversion: ['echoer', 'catcher', 'abacus', 'follow-up'],
};

export const SENATE_MAINLINE_DAG: SenateDagEdge[] = [
  { from: 'radar', to: 'strategist', artifact: 'market_intel' },
  { from: 'strategist', to: 'ink-writer', artifact: 'campaign_params' },
  { from: 'ink-writer', to: 'visualizer', artifact: 'storyboard_json' },
  { from: 'visualizer', to: 'dispatcher', artifact: 'prompt_pack' },
  { from: 'dispatcher', to: 'echoer', artifact: 'dispatch_plan' },
  { from: 'echoer', to: 'catcher', artifact: 'interaction_stream' },
  { from: 'catcher', to: 'abacus', artifact: 'intent_leads' },
  { from: 'abacus', to: 'follow-up', artifact: 'hot_lead_push' },
];

export const SENATE_EXECUTION_ORDER: ClawhubAgentId[] = [
  'radar',
  'strategist',
  'ink-writer',
  'visualizer',
  'dispatcher',
  'echoer',
  'catcher',
  'abacus',
  'follow-up',
];

export const SENATE_PARALLEL_GROUPS: ClawhubAgentId[][] = [
  ['ink-writer', 'visualizer'],
  ['echoer', 'catcher'],
];

export type PopularSkillCatalogPlan = {
  discoverySkill: 'find-skills';
  maxSkills: number;
  pageSize: number;
  maxPages: number;
  sortBy: 'downloads_stars_desc';
  safetyGate: 'skill-vetter';
};

/**
 * 支持不设上限的扩展入口：默认按 10000 上限拉取热门 skill。
 * 实际拉取可由调度器按分页循环执行 find-skills 后写入 Redis/DB。
 */
export const POPULAR_SKILL_CATALOG_PLAN: PopularSkillCatalogPlan = {
  discoverySkill: 'find-skills',
  maxSkills: 10000,
  pageSize: 200,
  maxPages: 50,
  sortBy: 'downloads_stars_desc',
  safetyGate: 'skill-vetter',
};
