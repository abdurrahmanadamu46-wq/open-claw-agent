/**
 * Dispatcher — 点兵虾
 * 调度执行：任务拆分、定时发布、多账号轮转、边缘节点推送
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/dispatcher
 */
export const AGENT_ID = 'dispatcher' as const;
export const AGENT_NAME = '点兵虾';
export const AGENT_NAME_EN = 'Dispatcher';
export const AGENT_ICON = '📦';
export const AGENT_PHASE = '④ 分发';
export const AGENT_ROLE = '调度执行';
export const AGENT_MODEL_TIER = 'simple';

export const AGENT_SKILLS = [
  'dispatcher_task_split',
  'dispatcher_scheduled_publish',
  'dispatcher_multi_account_rotate',
  'dispatcher_emergency_takedown',
  'dispatcher_bgm_pack',
  'dispatcher_cloud_archive',
  'dispatcher_edge_health_check',
  'dispatcher_edge_task_push',
] as const;
