/**
 * FollowUp — 回访虾
 * 客户跟进：SOP 生成、多触点激活、休眠唤醒、飞书通知、电话触发
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/followup
 */
export const AGENT_ID = 'followup' as const;
export const AGENT_NAME = '回访虾';
export const AGENT_NAME_EN = 'FollowUp';
export const AGENT_ICON = '📞';
export const AGENT_PHASE = '⑥ 跟进';
export const AGENT_ROLE = '客户跟进';
export const AGENT_MODEL_TIER = 'standard';

export const AGENT_SKILLS = [
  'followup_sop_generate',
  'followup_multi_touch',
  'followup_dormant_wake',
  'followup_voiceover_collab',
  'followup_phone_trigger',
  'followup_feishu_notify',
  'followup_call_summary_push',
] as const;
