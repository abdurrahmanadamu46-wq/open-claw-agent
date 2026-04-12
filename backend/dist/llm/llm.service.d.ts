export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface ChatCompletionOptions {
    model?: string;
    max_tokens?: number;
    temperature?: number;
}
export interface ChatCompletionResult {
    id: string;
    choices: Array<{
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export declare class LlmService {
    private readonly client;
    constructor();
    chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<ChatCompletionResult>;
    chatContent(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string>;
    isConfigured(): boolean;
}
