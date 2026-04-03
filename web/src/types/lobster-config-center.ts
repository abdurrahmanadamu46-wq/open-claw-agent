export type LobsterToolSummary = {
  toolId: string;
  name?: string;
  enabled?: boolean;
  description?: string;
  category?: string;
  lastUpdatedAt?: string;
};

export type LobsterSkillSummary = {
  skillId: string;
  name?: string;
  capability?: string;
  status?: 'active' | 'inactive' | string;
  lastUpdatedAt?: string;
};

export type LobsterConfigSummary = {
  lobsterId: string;
  name?: string;
  displayName?: string;
  lifecycle?: string;
  status?: string;
  strategyLevel?: string;
  autonomyLevel?: string;
  customPrompt?: string;
  toolsCount?: number;
  skillsCount?: number;
  lastUpdatedAt?: string;
};

export type LobsterConfigDetail = LobsterConfigSummary & {
  description?: string;
  strategyPolicy?: string;
  autonomyPolicy?: string;
  defaultTools?: LobsterToolSummary[];
  defaultSkills?: LobsterSkillSummary[];
  tools?: LobsterToolSummary[];
  skills?: LobsterSkillSummary[];
  extra?: Record<string, unknown>;
};

export type LobsterConfigUpdatePayload = {
  strategy_level?: string;
  autonomy_level?: string;
  custom_prompt?: string;
  notes?: string;
};
