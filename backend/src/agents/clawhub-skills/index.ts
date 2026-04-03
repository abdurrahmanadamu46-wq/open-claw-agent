/**
 * 龙虾元老院 ClawHub Skill 注册
 * 安全：安装任何技能前必须先 npx clawhub@latest install skill-vetter && clawhub vet <skill-name>
 */
export {
  getClawhubToolsForAgent,
  getUniversalSafetyTool,
  CLAWHUB_AGENT_TOOLS,
  SKILL_VETTER_TOOL,
} from './schemas.js';
export type { ClawhubAgentId } from './schemas.js';

export {
  SENATE_TIER_PLAN,
  SENATE_MAINLINE_DAG,
  SENATE_EXECUTION_ORDER,
  SENATE_PARALLEL_GROUPS,
  POPULAR_SKILL_CATALOG_PLAN,
} from './senate-collaboration.js';

export {
  SENATE_SKILL_DEPENDENCIES,
  SENATE_SKILL_CALL_EXAMPLES,
} from './senate-skill-interfaces.js';

export type {
  SkillInvokeContext,
  SkillExecutionEnvelope,
  SkillEdge,
} from './senate-skill-interfaces.js';

export {
  buildDiscoveryBatches,
  mergeDiscoveredSkills,
} from './popular-skill-catalog.js';

export type {
  DiscoveredSkill,
  DiscoveryBatch,
} from './popular-skill-catalog.js';
