/**
 * 核心架构重构：按语意断句驱动的动态场景调度
 * 废弃固定分镜数（clips_needed），改为节奏 + 字数上限 + 断句规则；
 * 大模型输出逐句对应的 JSON（spoken_text + visual_prompt），适配器按数组长度与每项内容实现「说一句换一镜」。
 * @module content/VideoGenerationService
 */
/** 单句分镜：一句话 = 一个对象，严格对应配音断句与画面 */
export interface ScriptScene {
    /** 本句配音文案（断句：逗号、句号、感叹号、停顿口） */
    spoken_text: string;
    /** 本句对应的画面描述，供 HeyGen/剪映等生成画面 */
    visual_prompt: string;
    /** 预估这句配音的秒数（可选，用于总时长与适配器） */
    duration_estimate?: number;
}
/** 最终剧本 = 逐句分镜数组，数组长度即镜头数 */
export type FinalScript = ScriptScene[];
/** 节奏模板：不再限制具体数字，只定义节奏与字数上限、切分规则 */
export interface PacingTemplate {
    pacing: 'fast' | 'medium' | 'narrative';
    max_words: number;
    scene_split_rule: string;
}
/** 模板 ID 与节奏配置（对应前端 10秒/15秒/30秒 等） */
export declare const TEMPLATE_MAP: Record<string, PacingTemplate>;
/** LLM 适配：请求 DeepSeek/GPT 时使用的 complete 接口 */
export interface VideoGenLLMAdapter {
    complete(options: {
        system: string;
        user: string;
        model?: string;
    }): Promise<string>;
}
/**
 * 构建「断句驱动」的 System Prompt：强制大模型输出逐句对应结构化 JSON
 */
export declare function buildSystemPromptForPacing(templateKey: string): string;
/**
 * 构建 User Prompt：业务输入（卖点、钩子、痛点、产品文案等）
 */
export declare function buildUserPromptForPacing(input: {
    sellingPoints: string[];
    hook?: string;
    painPoints?: string[];
    productCopy?: string;
    templateKey?: string;
}): string;
/**
 * 从 LLM 原始文本解析出 FinalScript（兼容数组被包在对象里的情况）
 */
export declare function parseFinalScriptFromLLM(raw: string): FinalScript;
/**
 * 生成按语意断句驱动的剧本：调用 LLM，返回 FinalScript
 */
export declare function generateScriptByPacing(templateKey: string, input: {
    sellingPoints: string[];
    hook?: string;
    painPoints?: string[];
    productCopy?: string;
}, llm: VideoGenLLMAdapter, options?: {
    model?: string;
}): Promise<FinalScript>;
/**
 * 将 FinalScript 转为旧版 ScriptOutput 格式，供仍使用 scenes[].text 的渲染适配器使用
 */
export declare function finalScriptToScriptOutput(finalScript: FinalScript): {
    scenes: Array<{
        text: string;
        durationSeconds?: number;
        visual_prompt?: string;
    }>;
    totalDurationSeconds: number;
};
//# sourceMappingURL=VideoGenerationService.d.ts.map