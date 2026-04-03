/**
 * 虚拟员工角色表 (AgentRole) — 与 agency-agents Markdown 结构对齐
 * 用于龙虾兵营 / 弹药库角色库，支持 GitHub 同步与出厂默认 Personas
 */

export interface AgentRole {
  id: string;
  name: string;
  description: string;
  /** 所属部门/分组，如 Engineering, Marketing, Specialized */
  division: string;
  /** 身份与性格 (# Identity & Personality) */
  identity: string;
  /** 核心任务 (# Core Mission) */
  core_mission: string;
  /** 生死红线 (# Critical Rules) */
  critical_rules: string;
  /** 标准工作流 (# Workflow Process) */
  workflow: string;
  /** UI 代表色，来自 frontmatter color */
  color?: string;
  /** 来源路径，如 marketing/marketing-content-creator.md */
  source_path?: string;
  /** 原始 frontmatter 其他字段 (tools 等) */
  meta?: Record<string, unknown>;
}
