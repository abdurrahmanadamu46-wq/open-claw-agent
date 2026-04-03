# ClawCommerce PM 文档 v1.17 — 商业化破冰：顶级 SaaS Demo 录屏实操 SOP

## 录屏环境要求

- **分辨率**：1080P 或 4K，全屏录制。
- **浏览器**：Chrome 纯净版（隐藏书签栏、隐藏多余插件）。
- **布局**：双屏联动。左侧 60% 前端 UI 控制台，右侧 40% 暗色主题 VS Code 终端或 iTerm2，展示 Agent 实时滚动日志。

---

## 第一幕：极简大盘，直击痛点 (0s - 15s)

**旁白**：「还在雇人手动剪视频、切账号、天天防封号？看看 ClawCommerce 如何用 AI 全自动接管你的获客流水线。」

**操作**：画面停留在 Dashboard；鼠标滑过核心指标卡：今日线索 → 活跃任务 → 节点健康度；在「节点健康度」上停留约 2 秒。

---

## 第二幕：Aha Moment——3 分钟傻瓜式建仓 (15s - 45s)

**旁白**：「不需要懂任何复杂的 Prompt 代码，只需提供对标，选择转化策略，剩下的全部交给底层 Agent 引擎。」

**操作**：点击左侧菜单「新建运营任务」→ 在文本框粘贴 3 个抖音爆款链接 → 策略模板选择「15秒故事带货 (7个分镜)」→ 点击「🚀 立即启动全自动运营」→ 弹出绿色 Toast：「任务已分配至 OpenClaw 节点池」。

---

## 第三幕：硬核秀肌肉——物理隔离与真实调度 (45s - 75s)

**旁白**：「这不是简单的前端动画。在后台，我们企业级的节点池正在动态绕过平台风控，AI 弹性分镜引擎正在逐字重写爆款剧本。」

**操作**：右侧 Terminal 高亮日志示例：
- `[BullMQ] Campaign CAMP_xxx Acquired. Allocating Node...`
- `[Playwright] Stealth mode injected. Bypassing captcha...`
- `[LLM Engine] Validating narrative logic... 7 clips validated perfectly.`

左侧任务列表状态由 PENDING → SCRAPING → GENERATING 自动变化。

---

## 第四幕：印钞机落袋为安——合规的线索回传 (75s - 90s)

**旁白**：「高意向线索秒级捕获。我们采用金融级 AES 链路加密，在保证你获客的同时，100% 满足商业数据的合规审计要求。ClawCommerce，你的全自动生意增长引擎。」

**操作**：进入「线索管理」→ 新线索刷新（意向分 95，脱敏 138****5678）→ 点击「查看完整联系方式」→ 弹窗显示明文，右上角 Toast：「[安全合规] Audit Log Recorded: 解密操作已记录审计日志」。

---

**总时长**：90 秒内一气呵成。

---

## Agent 终端高亮（第三幕）

录屏前在 Agent 环境变量中设置 `DEMO_LOGS=1` 或 `NODE_ENV=staging`，终端会输出带颜色的可读日志：

- `[BullMQ] Campaign xxx Acquired. Allocating Node...`（青色）
- `[Playwright] Stealth mode injected. Bypassing captcha...`（绿色）
- `[LLM Engine] Validating narrative logic... 7 clips validated perfectly.`（黄色）
