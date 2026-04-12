/**
 * 核心架构重构：按语意断句驱动的动态场景调度
 * 废弃固定分镜数（clips_needed），改为节奏 + 字数上限 + 断句规则；
 * 大模型输出逐句对应的 JSON（spoken_text + visual_prompt），适配器按数组长度与每项内容实现「说一句换一镜」。
 * @module content/VideoGenerationService
 */
/** 模板 ID 与节奏配置（对应前端 10秒/15秒/30秒 等） */
export const TEMPLATE_MAP = {
    '10秒爆款短视频': {
        pacing: 'fast',
        max_words: 45,
        scene_split_rule: '短句切分，遇到逗号或句号即切换画面，制造视觉冲击',
    },
    '15秒故事带货': {
        pacing: 'medium',
        max_words: 70,
        scene_split_rule: '按完整意群切分，画面跟随情绪转折点切换',
    },
    '30秒深度种草': {
        pacing: 'narrative',
        max_words: 140,
        scene_split_rule: '按逻辑段落切分，允许长镜头展示产品细节',
    },
};
const DEFAULT_TEMPLATE_KEY = '15秒故事带货';
/**
 * 构建「断句驱动」的 System Prompt：强制大模型输出逐句对应结构化 JSON
 */
export function buildSystemPromptForPacing(templateKey) {
    const t = TEMPLATE_MAP[templateKey] ?? TEMPLATE_MAP[DEFAULT_TEMPLATE_KEY];
    return `你是一位顶尖的短视频编导。请根据用户选择的节奏模板，写出脚本，并且必须严格按照说话的停顿（断句）将脚本拆分成一个 JSON 数组。

【节奏与约束】
- 节奏：${t.pacing}
- 全片总字数不超过 ${t.max_words} 字。
- 画面切分规则：${t.scene_split_rule}

【输出格式】必须且仅输出一个 JSON 数组，不要 markdown 代码块或其它说明。数组中每个元素对应「一句话」（一个断句），结构为：
{
  "spoken_text": "本句配音文案，如：今天给大家测一款神仙好物，",
  "visual_prompt": "本句对应的画面描述，如：特写：手持产品展示，背景虚化",
  "duration_estimate": 2
}

- spoken_text：一句完整的口播文案，以逗号、句号、感叹号或自然停顿为界，不要在一句话中间切断。
- visual_prompt：该句对应的画面描述（镜头、景别、动作、产品展示方式等），供视频生成引擎使用。
- duration_estimate：可选，预估这句配音的秒数（中文约 4～5 字/秒）。

请直接输出 JSON 数组，例如：[ { "spoken_text": "...", "visual_prompt": "...", "duration_estimate": 2 }, ... ]`;
}
/**
 * 构建 User Prompt：业务输入（卖点、钩子、痛点、产品文案等）
 */
export function buildUserPromptForPacing(input) {
    const t = input.templateKey
        ? (TEMPLATE_MAP[input.templateKey] ?? TEMPLATE_MAP[DEFAULT_TEMPLATE_KEY])
        : TEMPLATE_MAP[DEFAULT_TEMPLATE_KEY];
    const parts = [
        `主推卖点：${input.sellingPoints.join('；')}`,
        input.hook != null ? `钩子（前 3 秒）：${input.hook}` : '',
        input.painPoints?.length ? `痛点：${input.painPoints.join('；')}` : '',
        input.productCopy ? `产品文案：${input.productCopy}` : '',
    ].filter(Boolean);
    return `请根据以下信息，按照「${t.scene_split_rule}」的规则，生成一段短视频脚本。全片总字数不超过 ${t.max_words} 字。每句话对应一个分镜，输出 JSON 数组（每项含 spoken_text、visual_prompt、duration_estimate）。

${parts.join('\n')}`;
}
/**
 * 从 LLM 原始文本解析出 FinalScript（兼容数组被包在对象里的情况）
 */
export function parseFinalScriptFromLLM(raw) {
    const trimmed = raw.trim();
    let data;
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            data = JSON.parse(arrayMatch[0]);
        }
        catch {
            data = null;
        }
    }
    if (!Array.isArray(data)) {
        try {
            const obj = JSON.parse(trimmed);
            data = obj.scenes ?? obj.script ?? obj.clips ?? [];
        }
        catch {
            data = [];
        }
    }
    const list = Array.isArray(data) ? data : [];
    return list
        .filter((item) => item != null && typeof item === 'object')
        .map((item) => ({
        spoken_text: String(item.spoken_text ?? item.narration ?? item.text ?? '').trim(),
        visual_prompt: String(item.visual_prompt ?? item.visual_hint ?? item.visual ?? '').trim(),
        duration_estimate: typeof item.duration_estimate === 'number'
            ? item.duration_estimate
            : typeof item.duration_seconds === 'number'
                ? item.duration_seconds
                : undefined,
    }))
        .filter((s) => s.spoken_text.length > 0);
}
/**
 * 生成按语意断句驱动的剧本：调用 LLM，返回 FinalScript
 */
export async function generateScriptByPacing(templateKey, input, llm, options) {
    const system = buildSystemPromptForPacing(templateKey);
    const user = buildUserPromptForPacing({ ...input, templateKey });
    const raw = await llm.complete({ system, user, model: options?.model });
    const script = parseFinalScriptFromLLM(raw);
    if (script.length === 0) {
        throw new Error('VideoGenerationService: LLM 未返回有效分镜数组，请检查 prompt 与模型输出格式');
    }
    return script;
}
/**
 * 将 FinalScript 转为旧版 ScriptOutput 格式，供仍使用 scenes[].text 的渲染适配器使用
 */
export function finalScriptToScriptOutput(finalScript) {
    const scenes = finalScript.map((s) => ({
        text: s.spoken_text,
        durationSeconds: s.duration_estimate,
        visual_prompt: s.visual_prompt,
    }));
    const totalDurationSeconds = scenes.reduce((sum, s) => sum + (s.durationSeconds ?? 2), 0);
    return { scenes, totalDurationSeconds };
}
//# sourceMappingURL=VideoGenerationService.js.map