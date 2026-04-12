export interface LLMFunctionTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties?: Record<string, {
                type: string;
                description?: string;
            }>;
            required?: string[];
        };
    };
}
export type LLMToolsInput = LLMFunctionTool[];
