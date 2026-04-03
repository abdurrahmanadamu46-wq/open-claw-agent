# ClawCommerce 无头联调作战书 (PM v1.14 - API First)

> 在 UI 接入前，用纯 API 脚本打通「创建任务 → 后端入队 → Agent 执行 → 线索回传 → 列表脱敏」大动脉。

---

## 1. 脚本与命令

| 说明 | 命令 |
|------|------|
| 运行 5 步 E2E | 在项目根目录执行 `npm run e2e` |
| 等价 | `npx tsx scripts/test-e2e.ts` |

依赖：Node 18+（自带 `fetch`）、根目录已安装依赖。首次运行会拉取 `tsx`。

---

## 2. 环境变量

复制 [.env.e2e.example](../.env.e2e.example) 为 `.env`（或合并进现有 `.env`），必填：

| 变量 | 说明 |
|------|------|
| `E2E_API_BASE_URL` | 后端 Base URL（如 `http://localhost:3000`） |
| `E2E_JWT` | 商家端 JWT，用于 `POST/GET /api/v1/*` |
| `E2E_TENANT_ID` | 当前租户 ID，与 JWT 对应，Step 4 内部回传用 |
| `INTERNAL_API_SECRET` | 与后端 `.env` 完全一致，否则 Step 4 会 403 |

---

## 3. 五步流程（脚本自动执行）

| 步骤 | 脚本动作 | 你需要观测 |
|------|----------|------------|
| **Step 1** | `POST /api/v1/campaigns`，极简 payload（10秒爆款 + 1 个抖音链接） | 后端返回 200 + `campaign_id`；后端 BullMQ 终端任务入队 |
| **Step 2** | — | 后端 Processor 消费 job，请求 Agent `POST /internal/campaign/execute` |
| **Step 3** | — | Agent 终端：收到 execute、node-manager 分配节点、状态 → SCRAPING |
| **Step 4** | `POST /api/internal/leads`，带 `x-internal-secret`，Mock 线索（含 Step 1 的 campaign_id） | 后端 200，Lead 落库 |
| **Step 5** | `GET /api/v1/leads` | 列表含该线索，`contact_info` 为 138****5678 脱敏 |

Step 2/3 为「观测项」，不阻塞脚本；Step 1/4/5 任一失败则脚本退出码 1。

---

## 4. 防踩坑

- **跨域与秘钥**：`INTERNAL_API_SECRET` 双端（本脚本请求的后端、后端自身）必须一致。
- **网络**：本地 Docker 时，后端与 Agent 需同网桥，`AGENT_INTERNAL_URL` 在后端能解析到 Agent。
- **JWT**：若未配置 `E2E_JWT`，Step 1/5 可能 401；请向后端要测试 Token 或从前端登录抓包取得。

---

## 5. 通过标准与下一步

- **100% 绿灯**：脚本无报错、Step 1/4/5 全部 [PASS]，再接入 UI；把脚本里的硬编码换成 react-hook-form 即可。
- 跑通后需要：**《向种子用户演示的剧本与录屏 SOP》** 或 **联调中某接口报错排查**，直接回复小丽即可。
