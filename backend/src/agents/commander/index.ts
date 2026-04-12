/**
 * Commander — 元老院总脑
 * 编排整个多虾工作流：任务分解、仲裁冲突、异常处理、总结复盘
 * 对应 Python v2: dragon-senate-saas-v2/lobsters/commander
 */
export const AGENT_ID = 'commander' as const;
export const AGENT_NAME = '元老院总脑';
export const AGENT_NAME_EN = 'Commander';
export const AGENT_ICON = '🏛️';
export const AGENT_PHASE = '⓪ 编排总控';
export const AGENT_ROLE = '编排仲裁';
export const AGENT_MODEL_TIER = 'frontier';

export const AGENT_SKILLS = [
  'commander_mission_plan',
  'commander_orchestrate',
  'commander_arbitrate',
  'commander_exception_handle',
  'commander_retrospect',
] as const;
