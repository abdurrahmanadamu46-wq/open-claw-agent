# ClawCommerce LLM 抽象层

所有大模型调用必须走本抽象层，**切换模型只需改 env，零业务改动**。

## 使用方式

```ts
import { getLLMProvider } from './adapters/index.js';

const llm = getLLMProvider();

// 普通对话
const text = await llm.chat([{ role: 'user', content: '你好' }]);

// 强制结构化 JSON（爆款拆解、剧本分镜等）
const schema = { type: 'object', properties: { hook: { type: 'string' }, painPoints: { type: 'array', items: { type: 'string' } } }, required: ['hook', 'painPoints'] };
const result = await llm.structuredJson<{ hook: string; painPoints: string[] }>(
  [{ role: 'user', content: '拆解这段文案：...' }],
  schema
);
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `LLM_PROVIDER` | `deepseek` \| `openai` \| `grok` \| `mock` |
| `DEEPSEEK_API_KEY` | DeepSeek 必填（或 `OPENAI_API_KEY` 兼容） |
| `OPENAI_API_KEY` | OpenAI 必填 |
| `XAI_API_KEY` / `GROK_API_KEY` | Grok 必填 |

详见 `textsrc/.env.example`。

## 测试

```bash
LLM_PROVIDER=mock npm run test:llm
```

Mock 模式下无需任何 API Key，返回固定爆款拆解 JSON。
