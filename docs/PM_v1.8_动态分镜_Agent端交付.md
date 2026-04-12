# ClawCommerce PM v1.8 动态分镜与校验 — Agent 端交付说明

> 研发协同指令 v1.8：弹性语意分镜与动态校验引擎

---

## 一、已完成的 Agent 端调整

### 1. 数据契约（shared/contracts.ts）

- **TEMPLATE_DYNAMIC_RULES** 已与后端约定一致：
  - `10秒爆款短视频`: min_clips 3, max_clips 6
  - `15秒故事带货`: min_clips 5, max_clips 9
  - `30秒深度种草`: min_clips 10, max_clips 18

### 2. Prompt 层语意约束（prompt-engine.ts）

- **getSemanticBoundaryInstructions(industryTemplateId)**：根据模板 ID 返回 `min_clips`/`max_clips` 及语意分镜约束文案。
- **SEMANTIC_BOUNDARY_SYSTEM_FRAGMENT**：可追加到 System Prompt 的固定话术：
  - 根据意群与语意起伏切分画面；
  - 分镜切换必须且只能在标点处（逗号、句号、问号、叹号）；
  - 严禁在完整从句或连贯短语中间切割；
  - 分镜总数在 `{{min_clips}}` 到 `{{max_clips}}` 之间浮动。

### 3. 物理逻辑校验（content-generator.ts）

- **validateClipLogic(clips, charsPerSecond?)**：
  - 按正常语速约 4~5 字/秒计算每条分镜可读字数；
  - 若某分镜 `duration_seconds: 2` 但 `narration` 超过 10 字（默认 5 字/秒），则返回 `valid: false` 及错误文案，例如：「第 X 分镜文案过长，Y秒内无法读完，请重写或拆分」。
- **generateVideoScriptWithClips(industryTemplateId, options)**：
  - 调用 LLM 生成 `{ clips: [{ duration_seconds, narration }] }`；
  - 本地执行 validateClipLogic；
  - **不通过则带错误提示重试，最多 3 次**；
  - 3 次仍不通过则**抛出异常**，由调用方将节点标记为异常挂起。

### 4. 类型（content/types.ts）

- **Clip**：`duration_seconds`, `narration`, `visual_hint?`
- **VideoScriptWithClips**：`clips: Clip[]`, `total_duration_seconds?`

---

## 二、与后端的对齐

- 后端已按 v1.8 放宽：clips 数组长度在对应模板的 [min_clips, max_clips] 区间内即放行。
- Agent 不直接发「未校验」的 clips 给后端：先经 validateClipLogic，通过后再提交；若 3 次重试仍失败则不再提交，节点异常挂起。

---

## 三、使用方式示例

```ts
import { generateVideoScriptWithClips, validateClipLogic } from './content';
import type { Clip } from './content';

// 仅校验
const result = validateClipLogic(clips, 5);
if (!result.valid) console.log(result.errors);

// 生成并校验 + 重试
const script = await generateVideoScriptWithClips('10秒爆款短视频', {
  userPrompt: '根据以下内容生成分镜...',
  llm: myLLM,
});
// script.clips 已通过字数/时长比校验
```
