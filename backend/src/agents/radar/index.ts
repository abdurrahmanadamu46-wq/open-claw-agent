/**
 * Radar — 触须虾
 * 信号发现：热点话题、竞品动态、行业舆情，输出 SignalBrief
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/radar
 */
export const AGENT_ID = 'radar' as const;
export const AGENT_NAME = '触须虾';
export const AGENT_NAME_EN = 'Radar';
export const AGENT_ICON = '📡';
export const AGENT_PHASE = '① 信号发现';
export const AGENT_ROLE = '信号发现';
export const AGENT_MODEL_TIER = 'standard';

export const AGENT_SKILLS = [
  'radar_web_search',
  'radar_trend_analysis',
  'radar_hotspot_monitor',
  'radar_competitor_track',
  'radar_keyword_radar',
  'radar_user_profiling',
  'radar_metrics_feedback',
  'radar_sentiment_alert',
  'radar_industry_tag_confirm',
] as const;
