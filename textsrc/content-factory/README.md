# AI 内容工厂骨架

剧本生成（LLM 结构化分镜）+ 视频渲染抽象 + Pipeline。

## 模块

| 文件 | 说明 |
|------|------|
| `script-generator.ts` | 根据时长（10/15/30 秒）生成分镜数（5/7/15），调用 LLM 输出 `ScriptOutput`（scenes + totalDurationSeconds）。支持 `generateScriptFromViral` 从爆款拆解结果生成。 |
| `video-renderer.interface.ts` | 视频渲染抽象：`submit(script)` → jobId，可选 `getResult(jobId)` 轮询 MP4 链接。可插拔 HeyGen / 腾讯智影。 |
| `renderer-adapters/` | Mock 实现 + 工厂 `getVideoRenderer()`，env：`VIDEO_RENDERER=mock`。 |
| `pipeline.ts` | `runContentPipeline(input)`：生成剧本 → 可选提交渲染，返回 script + renderJobId + 可选 mp4Url。 |

## 使用示例

```ts
import { runContentPipeline, generateScript } from './index.js';

const output = await runContentPipeline({
  durationSeconds: 15,
  sellingPoints: ['成分安全', '24小时持妆'],
  viral: { hook: '...', painPoints: [], sellingPoints: ['...'] },
  submitRender: true,
});
console.log(output.script.scenes.length, output.renderJobId, output.mp4Url);
```

## 测试

```bash
LLM_PROVIDER=mock VIDEO_RENDERER=mock npm run test:content-factory
```
