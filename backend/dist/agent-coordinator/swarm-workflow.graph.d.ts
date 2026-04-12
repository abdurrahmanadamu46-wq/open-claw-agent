import type { SwarmMessage, VideoDraft } from './swarm-workflow.types';
declare const SwarmStateAnnotation: import("@langchain/langgraph").AnnotationRoot<{
    messages: import("@langchain/langgraph").BaseChannel<SwarmMessage[], SwarmMessage[] | import("@langchain/langgraph").OverwriteValue<SwarmMessage[]>, unknown>;
    current_agent: import("@langchain/langgraph").LastValue<string>;
    video_draft: import("@langchain/langgraph").LastValue<VideoDraft | null>;
    audit_passed: import("@langchain/langgraph").LastValue<boolean>;
}>;
export type SwarmWorkflowState = typeof SwarmStateAnnotation.State;
export declare function buildSwarmWorkflowGraph(): import("@langchain/langgraph").CompiledStateGraph<{
    messages: SwarmMessage[];
    current_agent: string;
    video_draft: VideoDraft | null;
    audit_passed: boolean;
}, {
    messages?: SwarmMessage[] | import("@langchain/langgraph").OverwriteValue<SwarmMessage[]> | undefined;
    current_agent?: string | undefined;
    video_draft?: VideoDraft | null | undefined;
    audit_passed?: boolean | undefined;
}, "__start__" | "ViralEngine" | "GoldenWriter" | "RiskAuditor", {
    messages: import("@langchain/langgraph").BaseChannel<SwarmMessage[], SwarmMessage[] | import("@langchain/langgraph").OverwriteValue<SwarmMessage[]>, unknown>;
    current_agent: import("@langchain/langgraph").LastValue<string>;
    video_draft: import("@langchain/langgraph").LastValue<VideoDraft | null>;
    audit_passed: import("@langchain/langgraph").LastValue<boolean>;
}, {
    messages: import("@langchain/langgraph").BaseChannel<SwarmMessage[], SwarmMessage[] | import("@langchain/langgraph").OverwriteValue<SwarmMessage[]>, unknown>;
    current_agent: import("@langchain/langgraph").LastValue<string>;
    video_draft: import("@langchain/langgraph").LastValue<VideoDraft | null>;
    audit_passed: import("@langchain/langgraph").LastValue<boolean>;
}, import("@langchain/langgraph").StateDefinition, {
    ViralEngine: Partial<import("@langchain/langgraph").StateType<{
        messages: import("@langchain/langgraph").BaseChannel<SwarmMessage[], SwarmMessage[] | import("@langchain/langgraph").OverwriteValue<SwarmMessage[]>, unknown>;
        current_agent: import("@langchain/langgraph").LastValue<string>;
        video_draft: import("@langchain/langgraph").LastValue<VideoDraft | null>;
        audit_passed: import("@langchain/langgraph").LastValue<boolean>;
    }>>;
    GoldenWriter: Partial<import("@langchain/langgraph").StateType<{
        messages: import("@langchain/langgraph").BaseChannel<SwarmMessage[], SwarmMessage[] | import("@langchain/langgraph").OverwriteValue<SwarmMessage[]>, unknown>;
        current_agent: import("@langchain/langgraph").LastValue<string>;
        video_draft: import("@langchain/langgraph").LastValue<VideoDraft | null>;
        audit_passed: import("@langchain/langgraph").LastValue<boolean>;
    }>>;
    RiskAuditor: Partial<import("@langchain/langgraph").StateType<{
        messages: import("@langchain/langgraph").BaseChannel<SwarmMessage[], SwarmMessage[] | import("@langchain/langgraph").OverwriteValue<SwarmMessage[]>, unknown>;
        current_agent: import("@langchain/langgraph").LastValue<string>;
        video_draft: import("@langchain/langgraph").LastValue<VideoDraft | null>;
        audit_passed: import("@langchain/langgraph").LastValue<boolean>;
    }>>;
}, unknown, unknown>;
export type CompiledSwarmWorkflow = ReturnType<typeof buildSwarmWorkflowGraph>;
export {};
