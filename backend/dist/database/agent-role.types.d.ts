export interface AgentRole {
    id: string;
    name: string;
    description: string;
    division: string;
    identity: string;
    core_mission: string;
    critical_rules: string;
    workflow: string;
    color?: string;
    source_path?: string;
    meta?: Record<string, unknown>;
}
