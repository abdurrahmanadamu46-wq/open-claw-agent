/**
 * InkWriter — 吐墨虾
 * 文案生产：多平台文案、标题、口播脚本、违禁词检查
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/inkwriter
 */
export const AGENT_ID = 'inkwriter' as const;
export const AGENT_NAME = '吐墨虾';
export const AGENT_NAME_EN = 'InkWriter';
export const AGENT_ICON = '✍️';
export const AGENT_PHASE = '③-A 文案';
export const AGENT_ROLE = '文案生产';
export const AGENT_MODEL_TIER = 'complex';

export const AGENT_SKILLS = [
  'inkwriter_copy_generate',
  'inkwriter_multiplatform_adapt',
  'inkwriter_hashtag_gen',
  'inkwriter_banned_word_check',
  'inkwriter_dm_script',
  'inkwriter_industry_vertical_copy',
  'inkwriter_voiceover_script',
  'inkwriter_title_ab_generate',
] as const;
