/**
 * Strategist — 脑虫虾
 * 策略规划：内容方向、发布节奏、预算分配、A/B 实验，输出 StrategyRoute
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/strategist
 */
export const AGENT_ID = 'strategist' as const;
export const AGENT_NAME = '脑虫虾';
export const AGENT_NAME_EN = 'Strategist';
export const AGENT_ICON = '🧠';
export const AGENT_PHASE = '② 策略制定';
export const AGENT_ROLE = '策略制定';
export const AGENT_MODEL_TIER = 'complex';

export const AGENT_SKILLS = [
  'strategist_goal_decompose',
  'strategist_platform_allocation',
  'strategist_content_calendar',
  'strategist_ab_test_design',
  'strategist_budget_suggestion',
  'strategist_adaptive_adjust',
  'strategist_competitor_playbook',
  'strategist_industry_tag_lock',
  'strategist_customer_profile_ingest',
  'strategist_topic_generate',
] as const;
