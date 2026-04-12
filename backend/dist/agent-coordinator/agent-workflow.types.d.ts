export interface DraftScriptScene {
    index: number;
    text: string;
    type?: string;
}
export interface DraftScript {
    template_type?: string;
    scenes: DraftScriptScene[];
}
export interface CompetitorData {
    hooks?: string[];
    pain_points?: string[];
    summary?: string;
    [key: string]: unknown;
}
export interface FinalActionPayload {
    job_id: string;
    campaign_id: string;
    action: string;
    steps?: Array<{
        action: string;
        script?: string;
        text?: string;
        selector?: string;
        url?: string;
        context?: Record<string, unknown>;
        timeoutMs?: number;
        [key: string]: unknown;
    }>;
    config?: Record<string, unknown>;
}
export interface AgentWorkflowState {
    tenantId: string;
    rawTaskInput: string;
    competitorData: CompetitorData | null;
    draftScript: DraftScript | null;
    errorLog: string[];
    directorRetryCount: number;
    finalActionPayload: FinalActionPayload | null;
    validationPassed?: boolean;
}
export declare const MAX_DIRECTOR_RETRIES = 3;
