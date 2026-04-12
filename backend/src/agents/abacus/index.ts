/**
 * Abacus — 金算虾
 * 数据分析：ROI 核算、多触点归因、策略复盘报告、反馈闭环
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/abacus
 */
export const AGENT_ID = 'abacus' as const;
export const AGENT_NAME = '金算虾';
export const AGENT_NAME_EN = 'Abacus';
export const AGENT_ICON = '🧮';
export const AGENT_PHASE = '⑦ 复盘';
export const AGENT_ROLE = '数据分析';
export const AGENT_MODEL_TIER = 'complex';

export const AGENT_SKILLS = [
  'abacus_roi_calc',
  'abacus_multi_touch_attribution',
  'abacus_strategy_report',
  'abacus_feedback_loop',
  'abacus_topic_score',
  'abacus_archive_report',
  'abacus_lead_score_model',
  'abacus_call_log_ingest',
] as const;
