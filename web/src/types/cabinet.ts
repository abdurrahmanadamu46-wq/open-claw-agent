/**
 * 数字内阁 — 与龙虾元老院对齐的角色 ID 与兼容层
 * 灵魂插槽、内阁侧栏 使用同一套 9 角色数据（见 data/custom-lobster-agents.ts）
 */
import {
  CUSTOM_LOBSTER_AGENTS,
  getCustomLobsterAgent,
  getAgentStatusPhrase,
  type CustomLobsterAgentId,
  type CustomLobsterAgent,
} from '@/data/custom-lobster-agents';

/** 与 CustomLobsterAgentId 一致，供 SoulBadge / 节点注魂 使用 */
export type CabinetRoleId = CustomLobsterAgentId;

/** 兼容旧用法：角色信息即定制龙虾 Agent */
export type CabinetRole = CustomLobsterAgent;

/** 9 大角色列表（龙虾元老院单源数据） */
export const CABINET_ROLES: CabinetRole[] = CUSTOM_LOBSTER_AGENTS;

export function getCabinetRole(id: CabinetRoleId | undefined): CabinetRole | undefined {
  return getCustomLobsterAgent(id);
}

/** 龙虾卡片动态状态文案 */
export function getRoleStatusPhrase(role: CabinetRole, seed: number): string {
  return getAgentStatusPhrase(role, seed);
}
