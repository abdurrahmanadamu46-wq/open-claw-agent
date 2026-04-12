# 雷达大脑骨架

对标账号监控任务下发 + ASR 抽象 + 爆款内容拆解（LLM）。

## 模块

| 文件 | 说明 |
|------|------|
| `crawler-task.ts` | 下发给龙虾节点的爬虫任务：`CompetitorMonitorTask`、`buildCompetitorMonitorTask`、序列化/反序列化。动作：静默滑动、截图、抓链接、抓点赞数等。 |
| `asr-provider.interface.ts` | ASR 抽象接口：`transcribe(input, options)`。可插拔：阿里听悟 / Whisper / 通义听悟（实现后续接入）。 |
| `asr-adapters/` | Mock 实现 + 工厂 `getASRProvider()`，env：`ASR_PROVIDER=mock`。 |
| `content-disassembler.ts` | 调用 LLM 将转录文字拆解为 Hook / 痛点 / 卖点（`ViralDisassembleResult`），依赖 `getLLMProvider()`。 |

## 使用示例

```ts
import { buildCompetitorMonitorTask, serializeCrawlerTask, disassembleViralContent, getASRProvider } from './index.js';

// 打包任务下发给龙虾
const task = buildCompetitorMonitorTask({
  jobId: 'JOB-001',
  platform: 'douyin',
  targetAccountUrl: 'https://v.douyin.com/xxx',
});
const json = serializeCrawlerTask(task); // 通过 WebSocket 发到节点

// 爆款拆解（需 LLM_PROVIDER 已配置）
const result = await disassembleViralContent('这款面膜太好用了...');

// ASR（需 ASR_PROVIDER，当前仅 mock）
const asr = getASRProvider();
const text = await asr.transcribe('https://example.com/audio.mp3');
```

## 测试

```bash
LLM_PROVIDER=mock npm run test:radar
```
