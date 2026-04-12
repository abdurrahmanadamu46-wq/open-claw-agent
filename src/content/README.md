# ClawCommerce Content - AI 内容产出与二创闭环

## 结构

- **prompt-engine.ts** — Prompt 模板 + RAG：按行业/平台加载 JSON，渲染变量，注入对标内容
- **content-generator.ts** — 调用 LLM 生成二创脚本（文案/视频脚本/混剪指令）
- **browser-orchestrator.ts** — Playwright 真实操作链路（骨架，待接 CDP + human-cursor）
- **anti-detection.ts** — 反检测策略：UA/代理/设备指纹池
- **skills/** — 发帖/点赞/评论/私信等技能（每平台独立，可热加载）
- **templates/** — 按行业分目录的 JSON 模板（版本控制），目标 50+ 行业

## 使用

```ts
import { loadTemplate, render, generateErChuangScript } from './content';
import type { BenchmarkAccount } from './content';

// 加载模板并渲染
const t = loadTemplate('beauty', 'xiaohongshu');
const rendered = render(t!, { benchmark_contents: '...' });

// 生成二创脚本（需注入 LLM adapter）
const script = await generateErChuangScript(
  { industry: 'beauty', platform: 'xiaohongshu', benchmarkAccounts },
  llmAdapter
);
```

## 测试

```bash
npm run test:content
```

## 模板约定

- 路径：`templates/{industry}/default.json` 或 `{platform}_{purpose}.json`
- 字段：version, industry, platform, purpose, systemPrompt, userPrompt, requiredVars, ragContextKey
- 占位符：`{{varName}}`，渲染时由 render() 替换
