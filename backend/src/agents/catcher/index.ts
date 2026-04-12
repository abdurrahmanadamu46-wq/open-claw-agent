/**
 * Catcher — 铁网虾
 * 线索识别：线索评分、CRM 推送、跨平台去重、合规审核
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/catcher
 */
export const AGENT_ID = 'catcher' as const;
export const AGENT_NAME = '铁网虾';
export const AGENT_NAME_EN = 'Catcher';
export const AGENT_ICON = '🎯';
export const AGENT_PHASE = '⑤-B 线索';
export const AGENT_ROLE = '线索识别';
export const AGENT_MODEL_TIER = 'standard';

export const AGENT_SKILLS = [
  'catcher_lead_score',
  'catcher_crm_push',
  'catcher_cross_platform_dedup',
  'catcher_compliance_audit',
  'catcher_sensitive_word_filter',
  'catcher_complaint_risk_flag',
] as const;
