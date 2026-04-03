export interface PromptRegistryListItem {
  name: string;
  lobster: string;
  skill: string;
  production_version?: number | null;
  preview_version?: number | null;
  latest_version: number;
  total_versions: number;
}

export interface PromptRegistryVersionItem {
  prompt_id: string;
  name: string;
  lobster: string;
  skill: string;
  version: number;
  content: string;
  system_prompt?: string;
  variables: string[];
  labels: string[];
  active_labels: string[];
  config: Record<string, unknown>;
  commit_message?: string;
  author?: string;
  is_archived?: number | boolean;
  created_at: string;
}

export interface PromptRegistryDiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

export interface PromptRegistryDiffHunk {
  header: string;
  lines: PromptRegistryDiffLine[];
}

export interface PromptRegistryDiff {
  name: string;
  version_a: number;
  version_b: number;
  content_diff: string;
  hunks: PromptRegistryDiffHunk[];
  stats: {
    added: number;
    removed: number;
    context: number;
  };
  added_vars: string[];
  removed_vars: string[];
  config_diff: Record<string, { before: unknown; after: unknown }>;
  prompt_a: PromptRegistryVersionItem;
  prompt_b: PromptRegistryVersionItem;
  error?: string;
}
