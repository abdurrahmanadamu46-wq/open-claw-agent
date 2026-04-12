/**
 * Echoer — 回声虾
 * 互动转化：评论管理、私信自动回复、微信引流漏斗
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/echoer
 */
export const AGENT_ID = 'echoer' as const;
export const AGENT_NAME = '回声虾';
export const AGENT_NAME_EN = 'Echoer';
export const AGENT_ICON = '💬';
export const AGENT_PHASE = '⑤-A 互动';
export const AGENT_ROLE = '互动转化';
export const AGENT_MODEL_TIER = 'standard';

export const AGENT_SKILLS = [
  'echoer_reply_generate',
  'echoer_comment_manage',
  'echoer_dm_auto_reply',
  'echoer_wechat_funnel',
  'echoer_realtime_comment_stream',
  'echoer_dm_lead_capture',
] as const;
