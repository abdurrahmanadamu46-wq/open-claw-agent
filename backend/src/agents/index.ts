/**
 * OpenClaw Agent Registry — 1 Commander + 9 Lobster Agents
 *
 * 权威来源：dragon-senate-saas-v2/lobsters-registry.json
 *
 * 架构：
 *   Commander（元老院总脑）— 编排大脑，不执行具体任务
 *   └─ radar       触须虾   ① 信号发现
 *   └─ strategist  脑虫虾   ② 策略制定
 *   └─ inkwriter   吐墨虾   ③-A 文案生产
 *   └─ visualizer  幻影虾   ③-B 视觉生产
 *   └─ dispatcher  点兵虾   ④ 调度分发
 *   └─ echoer      回声虾   ⑤-A 互动转化
 *   └─ catcher     铁网虾   ⑤-B 线索识别
 *   └─ followup    回访虾   ⑥ 客户跟进
 *   └─ abacus      金算虾   ⑦ 数据复盘
 */

// ── Brain ────────────────────────────────────────────────────────────────────
export { AGENT_ID as COMMANDER_ID, AGENT_NAME as COMMANDER_NAME } from './commander';

// ── 9 Execution Lobsters ─────────────────────────────────────────────────────
export { AGENT_ID as RADAR_ID,      AGENT_NAME as RADAR_NAME      } from './radar';
export { AGENT_ID as STRATEGIST_ID, AGENT_NAME as STRATEGIST_NAME } from './strategist';
export { AGENT_ID as INKWRITER_ID,  AGENT_NAME as INKWRITER_NAME  } from './inkwriter';
export { AGENT_ID as VISUALIZER_ID, AGENT_NAME as VISUALIZER_NAME } from './visualizer';
export { AGENT_ID as DISPATCHER_ID, AGENT_NAME as DISPATCHER_NAME } from './dispatcher';
export { AGENT_ID as ECHOER_ID,     AGENT_NAME as ECHOER_NAME     } from './echoer';
export { AGENT_ID as CATCHER_ID,    AGENT_NAME as CATCHER_NAME    } from './catcher';
export { AGENT_ID as FOLLOWUP_ID,   AGENT_NAME as FOLLOWUP_NAME   } from './followup';
export { AGENT_ID as ABACUS_ID,     AGENT_NAME as ABACUS_NAME     } from './abacus';

// ── Lobster ID 列表（用于循环、校验等）────────────────────────────────────────
export const ALL_LOBSTER_IDS = [
  'commander',
  'radar',
  'strategist',
  'inkwriter',
  'visualizer',
  'dispatcher',
  'echoer',
  'catcher',
  'followup',
  'abacus',
] as const;

export type LobsterId = typeof ALL_LOBSTER_IDS[number];

export const EXECUTION_LOBSTER_IDS = ALL_LOBSTER_IDS.filter(
  (id): id is Exclude<LobsterId, 'commander'> => id !== 'commander'
);
