export interface SwarmMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}
export interface VideoDraft {
    template_type: string;
    scenes: Array<{
        index: number;
        text: string;
        type?: string;
    }>;
    rejection_reason?: string;
}
export interface SwarmState {
    messages: SwarmMessage[];
    current_agent: string;
    video_draft: VideoDraft | null;
}
