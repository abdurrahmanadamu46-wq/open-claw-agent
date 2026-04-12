import type { CompetitorData, DraftScript, FinalActionPayload } from './agent-workflow.types';
declare const WorkflowStateAnnotation: import("@langchain/langgraph").AnnotationRoot<{
    tenantId: import("@langchain/langgraph").LastValue<string>;
    rawTaskInput: import("@langchain/langgraph").LastValue<string>;
    competitorData: import("@langchain/langgraph").LastValue<CompetitorData | null>;
    draftScript: import("@langchain/langgraph").LastValue<DraftScript | null>;
    errorLog: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
    directorRetryCount: import("@langchain/langgraph").LastValue<number>;
    finalActionPayload: import("@langchain/langgraph").LastValue<FinalActionPayload | null>;
    validationPassed: import("@langchain/langgraph").LastValue<boolean>;
}>;
export type WorkflowState = typeof WorkflowStateAnnotation.State;
export declare function buildAgentWorkflowGraph(): import("@langchain/langgraph").CompiledStateGraph<{
    tenantId: string;
    rawTaskInput: string;
    competitorData: CompetitorData | null;
    draftScript: DraftScript | null;
    errorLog: string[];
    directorRetryCount: number;
    finalActionPayload: FinalActionPayload | null;
    validationPassed: boolean;
}, {
    tenantId?: string | undefined;
    rawTaskInput?: string | undefined;
    competitorData?: CompetitorData | null | undefined;
    draftScript?: DraftScript | null | undefined;
    errorLog?: string[] | import("@langchain/langgraph").OverwriteValue<string[]> | undefined;
    directorRetryCount?: number | undefined;
    finalActionPayload?: FinalActionPayload | null | undefined;
    validationPassed?: boolean | undefined;
}, "__start__" | "Scout" | "Director" | "Validate" | "IncrementRetry" | "Publish", {
    tenantId: import("@langchain/langgraph").LastValue<string>;
    rawTaskInput: import("@langchain/langgraph").LastValue<string>;
    competitorData: import("@langchain/langgraph").LastValue<CompetitorData | null>;
    draftScript: import("@langchain/langgraph").LastValue<DraftScript | null>;
    errorLog: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
    directorRetryCount: import("@langchain/langgraph").LastValue<number>;
    finalActionPayload: import("@langchain/langgraph").LastValue<FinalActionPayload | null>;
    validationPassed: import("@langchain/langgraph").LastValue<boolean>;
}, {
    tenantId: import("@langchain/langgraph").LastValue<string>;
    rawTaskInput: import("@langchain/langgraph").LastValue<string>;
    competitorData: import("@langchain/langgraph").LastValue<CompetitorData | null>;
    draftScript: import("@langchain/langgraph").LastValue<DraftScript | null>;
    errorLog: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
    directorRetryCount: import("@langchain/langgraph").LastValue<number>;
    finalActionPayload: import("@langchain/langgraph").LastValue<FinalActionPayload | null>;
    validationPassed: import("@langchain/langgraph").LastValue<boolean>;
}, import("@langchain/langgraph").StateDefinition, {
    Scout: Partial<import("@langchain/langgraph").StateType<{
        tenantId: import("@langchain/langgraph").LastValue<string>;
        rawTaskInput: import("@langchain/langgraph").LastValue<string>;
        competitorData: import("@langchain/langgraph").LastValue<CompetitorData | null>;
        draftScript: import("@langchain/langgraph").LastValue<DraftScript | null>;
        errorLog: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
        directorRetryCount: import("@langchain/langgraph").LastValue<number>;
        finalActionPayload: import("@langchain/langgraph").LastValue<FinalActionPayload | null>;
        validationPassed: import("@langchain/langgraph").LastValue<boolean>;
    }>>;
    Director: Partial<import("@langchain/langgraph").StateType<{
        tenantId: import("@langchain/langgraph").LastValue<string>;
        rawTaskInput: import("@langchain/langgraph").LastValue<string>;
        competitorData: import("@langchain/langgraph").LastValue<CompetitorData | null>;
        draftScript: import("@langchain/langgraph").LastValue<DraftScript | null>;
        errorLog: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
        directorRetryCount: import("@langchain/langgraph").LastValue<number>;
        finalActionPayload: import("@langchain/langgraph").LastValue<FinalActionPayload | null>;
        validationPassed: import("@langchain/langgraph").LastValue<boolean>;
    }>>;
    Validate: Partial<import("@langchain/langgraph").StateType<{
        tenantId: import("@langchain/langgraph").LastValue<string>;
        rawTaskInput: import("@langchain/langgraph").LastValue<string>;
        competitorData: import("@langchain/langgraph").LastValue<CompetitorData | null>;
        draftScript: import("@langchain/langgraph").LastValue<DraftScript | null>;
        errorLog: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
        directorRetryCount: import("@langchain/langgraph").LastValue<number>;
        finalActionPayload: import("@langchain/langgraph").LastValue<FinalActionPayload | null>;
        validationPassed: import("@langchain/langgraph").LastValue<boolean>;
    }>>;
    IncrementRetry: Partial<import("@langchain/langgraph").StateType<{
        tenantId: import("@langchain/langgraph").LastValue<string>;
        rawTaskInput: import("@langchain/langgraph").LastValue<string>;
        competitorData: import("@langchain/langgraph").LastValue<CompetitorData | null>;
        draftScript: import("@langchain/langgraph").LastValue<DraftScript | null>;
        errorLog: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
        directorRetryCount: import("@langchain/langgraph").LastValue<number>;
        finalActionPayload: import("@langchain/langgraph").LastValue<FinalActionPayload | null>;
        validationPassed: import("@langchain/langgraph").LastValue<boolean>;
    }>>;
    Publish: Partial<import("@langchain/langgraph").StateType<{
        tenantId: import("@langchain/langgraph").LastValue<string>;
        rawTaskInput: import("@langchain/langgraph").LastValue<string>;
        competitorData: import("@langchain/langgraph").LastValue<CompetitorData | null>;
        draftScript: import("@langchain/langgraph").LastValue<DraftScript | null>;
        errorLog: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
        directorRetryCount: import("@langchain/langgraph").LastValue<number>;
        finalActionPayload: import("@langchain/langgraph").LastValue<FinalActionPayload | null>;
        validationPassed: import("@langchain/langgraph").LastValue<boolean>;
    }>>;
}, unknown, unknown>;
export type CompiledAgentWorkflow = ReturnType<typeof buildAgentWorkflowGraph>;
export {};
