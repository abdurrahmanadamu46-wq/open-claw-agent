# 龙虾底座骨架

防风控（stealth + 鼠标轨迹 + Canvas/WebGL 占位）+ 多账号 Cookie 隔离 + 打码平台抽象。

## 模块

| 文件 | 说明 |
|------|------|
| `anti-detect.ts` | `humanLikeMousePath(from, to, steps)` 真实感鼠标路径；`launchStealthBrowser(options)` 需安装 `playwright-extra` + `playwright`；`STEALTH_LAUNCH_ARGS`、`CANVAS_WEBGL_MASK_SCRIPT` 占位。 |
| `cookie-isolation.ts` | `getProfileDir(platformId, accountId)`、`ensureProfileDir()`、`getIsolationUserDataDir(config)`，每账号独立目录，供 Playwright userDataDir。 |
| `captcha-solver.interface.ts` | `CaptchaSolverProvider.solve(imageInput, options)` 抽象；可插拔 2Captcha / 图鉴等。 |
| `captcha-adapters/` | Mock 实现 + 工厂 `getCaptchaSolver()`，env：`CAPTCHA_SOLVER=mock`。 |

## 使用示例

```ts
import { humanLikeMousePath, ensureProfileDir, getCaptchaSolver } from './index.js';

const path = humanLikeMousePath({ x: 0, y: 0 }, { x: 100, y: 50 }, 10);
const userDataDir = ensureProfileDir('douyin', 'acc-001');
const solver = getCaptchaSolver();
const { text } = await solver.solve('https://example.com/captcha.png');
```

## 真实浏览器（可选）

```bash
npm install playwright-extra playwright
```

之后可调用 `launchStealthBrowser({ headless: true })`；未安装时调用会抛错提示。

## 测试

```bash
CAPTCHA_SOLVER=mock npm run test:lobster
```
