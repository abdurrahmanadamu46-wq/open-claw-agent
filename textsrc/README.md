# ClawCommerce 顶级 API 缝合怪框架（textsrc）

三大硬仗骨架：**雷达大脑** → **AI 内容工厂** → **龙虾底座**，所有外部能力可插拔，换模型/换 API 仅改配置。

---

## 目录结构

```
textsrc/
├── llm/                    # 大模型抽象层（必先完成）
│   ├── provider.interface.ts
│   ├── structured-output.ts
│   └── adapters/           # deepseek | openai | grok | mock
├── radar-brain/            # 第一场硬仗
│   ├── crawler-task.ts     # 下发给龙虾的爬虫任务
│   ├── asr-provider.interface.ts
│   ├── asr-adapters/
│   └── content-disassembler.ts  # 爆款拆解 Hook/痛点/卖点
├── content-factory/         # 第二场硬仗
│   ├── script-generator.ts # 10/15/30 秒分镜剧本
│   ├── video-renderer.interface.ts
│   ├── renderer-adapters/
│   ├── watermark-remover.interface.ts   # 去水印抽象（合规选项）
│   ├── watermark-remover-adapters/
│   └── pipeline.ts
├── lobster-base/            # 第三场硬仗（吸收 AdsPower 防封锁）
│   ├── anti-detect.ts      # 抹除 webdriver、随机 UA、每账号独立 Proxy
│   ├── cookie-isolation.ts
│   └── captcha-solver.interface.ts + captcha-adapters/
├── full-pipeline.ts         # 统一 Pipeline：雷达 → 工厂 → 产出
└── .env.example
```

---

## 如何切换大模型（一行 env）

所有 LLM 调用走 `getLLMProvider()`，**业务代码零改动**。

| 环境变量 | 说明 |
|----------|------|
| `LLM_PROVIDER` | `deepseek` \| `openai` \| `grok` \| `mock` |
| `DEEPSEEK_API_KEY` | DeepSeek 必填（或 `OPENAI_API_KEY` 兼容） |
| `OPENAI_API_KEY` | OpenAI 必填 |
| `XAI_API_KEY` / `GROK_API_KEY` | Grok 必填 |

**示例**：切到 OpenAI 只需在 `.env` 中写 `LLM_PROVIDER=openai` 并配置 `OPENAI_API_KEY`。

---

## 如何加新 ASR / 视频 / 打码 API

### 新 ASR（如阿里听悟、Whisper）

1. 在 `radar-brain/asr-adapters/` 下新建 `aliyun.adapter.ts`，实现 `ASRProvider` 接口的 `transcribe(input, options?)`。
2. 在 `asr-adapters/index.ts` 的工厂里增加 `case 'aliyun': return new AliyunASRAdapter();`。
3. 在 `.env.example` 中增加 `ASR_PROVIDER=aliyun` 及对应 `ALIYUN_*` 配置说明。

### 新视频渲染（如 HeyGen、腾讯智影）

1. 在 `content-factory/renderer-adapters/` 下新建 `heygen.adapter.ts`，实现 `VideoRendererProvider` 的 `submit(script, options?)` 与可选 `getResult(jobId)`。
2. 在 `renderer-adapters/index.ts` 的工厂里增加 `case 'heygen': return new HeyGenAdapter();`。
3. 配置 `VIDEO_RENDERER=heygen` 及 API Key。

### 新去水印（合规：去除 AI 生成水印）

1. 在 `content-factory/watermark-remover-adapters/` 下新建适配器，实现 `WatermarkRemoverProvider.remove(inputUrl)`，返回无水印资源 URL。
2. 在 `watermark-remover-adapters/index.ts` 的工厂里增加对应 case。
3. 配置 `WATERMARK_REMOVER=mock|internal|第三方`。Pipeline 入参 `removeWatermark: true` 时（如配置向导勾选「去除 AI 生成水印」），渲染得到 mp4 后会调用去水印步骤。

### 新打码平台（如 2Captcha）

1. 在 `lobster-base/captcha-adapters/` 下新建 `2captcha.adapter.ts`，实现 `CaptchaSolverProvider.solve(imageInput, options?)`。
2. 在 `captcha-adapters/index.ts` 中增加对应 case。
3. 配置 `CAPTCHA_SOLVER=2captcha` 及 API Key。

### 龙虾底座：Stealth 与每账号独立 Proxy（吸收 AdsPower）

`launchStealthBrowser`（`lobster-base/anti-detect.ts`）已内置：

- **抹除 webdriver 标记**：通过 `addInitScript` 注入 `STEALTH_WEBDRIVER_MASK_SCRIPT`，等价 puppeteer-extra-plugin-stealth 核心能力。
- **随机化 User-Agent**：可选 `userAgentPool` 或使用内置 `DEFAULT_USER_AGENT_POOL`；也可传 `userAgent` 固定单次。
- **每账号独立 Proxy**：入参 `proxy: { server, username?, password? }`，与 `getIsolationUserDataDir(platformId, accountId)` 一一绑定，实现多账号 100% 物理隔离。

可选安装 `puppeteer-extra-plugin-stealth` 以增强隐藏；未安装时仅依赖内置注入。

---

## 统一 Pipeline 使用方式

```ts
import { runFullPipeline } from './full-pipeline.js';

const result = await runFullPipeline({
  transcript: '这款面膜太好用了...',  // 可选，有则先拆解再融梗
  sellingPoints: ['成分安全', '24小时持妆'],
  durationSeconds: 15,
  productCopy: '双十一直降',
  submitRender: true,
  removeWatermark: true,   // 合规选项：勾选后产出无水印视频
  crawlerTask: {   // 可选，打包后下发给龙虾
    jobId: 'JOB-001',
    platform: 'douyin',
    targetAccountUrl: 'https://v.douyin.com/xxx',
  },
});
// result.viral, result.script, result.renderJobId, result.mp4Url, result.crawlerTaskJson
```

---

## 环境变量总览（.env.example）

见同目录 `.env.example`，涵盖：`LLM_PROVIDER`、`ASR_PROVIDER`、`VIDEO_RENDERER`、`CAPTCHA_SOLVER`、`LOBSTER_PROFILE_ROOT`、Redis 等。复制为 `.env` 后按需填写。

---

## 测试（Mock 模式，无需真实 API）

```bash
# 根目录执行
LLM_PROVIDER=mock npm run test:llm
LLM_PROVIDER=mock npm run test:radar
LLM_PROVIDER=mock VIDEO_RENDERER=mock npm run test:content-factory
CAPTCHA_SOLVER=mock npm run test:lobster
```

---

## Docker 支持

- **textsrc 作为 Node 模块**：由上层（如 Nest 后端）引用，无需单独容器；镜像中复制整仓即可，测试从根目录执行。
- **一键跑 textsrc 单测（Mock）**：项目根目录执行  
  `docker run --rm -v "${PWD}:/app" -w /app node:20-alpine sh -c "npm install && LLM_PROVIDER=mock VIDEO_RENDERER=mock CAPTCHA_SOLVER=mock npm run test:textsrc"`  
  或在已安装依赖的本机执行：`npm run test:textsrc`。
- **Redis + 服务编排**：见项目根目录 `docker-compose.example.yml`，复制为 `docker-compose.yml` 后按需启用 backend / textsrc-test 等服务。
