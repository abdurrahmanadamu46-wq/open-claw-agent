# Demo 测试步骤 — 功能与路径

**自测记录**：已在本机执行——释放 3001 端口后运行 `cd web && npm run dev`，用 HTTP 请求逐项验证：`/`、`/login`、`/fleet`、`/missions/manual-publish`、`/agents/cabinet`、`/ai-brain/prompt-lab`、`/demo` 均返回 **200**；页面内容含「边缘算力池」「战术/发布」「数字员工」「RAG」等关键词。风控熔断/客户 B 为前端按租户动态展示，需在浏览器中切到「客户 B」后可见 1 个风控熔断节点。

---

按下列功能逐项在浏览器中打开并验证。**端口说明**：若使用「一键启动.bat」，网页控制台在 **3001**；若希望网页在 3000，请先不启动总控，在 `web` 目录执行 `npm run dev:3000`。下表中 `BASE` = 网页控制台根地址（如 `http://localhost:3001` 或 `http://localhost:3000`）。

---

## 1. 启动方式

**方式 A（推荐）**：双击 **`一键启动.bat`**  
→ 总控 3000、网页 3001，浏览器会打开 `http://localhost:3001`。

**方式 B**：仅网页且要占 3000  
→ 在 `web` 目录执行：`npm run dev:3000`，然后用 `BASE = http://localhost:3000`。

进入 Demo 方式（二选一）：  
- 打开 **BASE/login**，点击 **「一键进入演示（无需账号）」**  
- 或打开 **BASE/demo** / **BASE/demo.html**（若可用）

---

## 2. 功能与路径对照表

| 功能 | 路径 | 验证要点 |
|------|------|----------|
| **边缘算力池 + 技能仓库** | **BASE/fleet** | 见节点列表、租户切换、技能/环境侧栏 |
| **战术狙击发射台** | **BASE/missions/manual-publish** | 可选战役、选节点、发布任务（Mock 可发） |
| **全息数字员工大盘** | **BASE/agents/cabinet** | 数字员工卡片、RAG 语料数、驱遣算力入口 |
| **RAG 私有知识库** | 侧栏「RAG 私有知识库」或 **BASE/ai-brain/prompt-lab** | 语料投喂、Agent 挂载（或 **BASE/arsenal/prompts** 会重定向到此） |
| **风控熔断演示** | **BASE/fleet**，切到 **「客户 B」** | 应看到 **1 个风控熔断节点**（状态为人机接管/平台人脸验证等） |

---

## 3. 风控熔断演示（重点）

1. 打开 **BASE/fleet**（边缘算力池）。
2. 在页面上方租户切换处选择 **「客户 B」**（不要选「客户 A」或「客户 C」）。
3. 在节点列表中应看到 **1 个节点** 为 **风控熔断** 状态（红色/人机接管，原因如「平台人脸验证」）。
4. 可选：点击该节点查看详情；Header 右上角「风控熔断」告警应同步出现。

Mock 数据中该节点为：`node-cd-001`（种草小号A · 小红书美妆号），`tenantId: 'tenant-b'`，`status: 'INTERVENTION_REQUIRED'`。

---

## 4. 快速链接（BASE = http://localhost:3001 时）

- 边缘算力池 + 技能仓库：http://localhost:3001/fleet  
- 战术狙击发射台：http://localhost:3001/missions/manual-publish  
- 全息数字员工大盘：http://localhost:3001/agents/cabinet  
- RAG 私有知识库：http://localhost:3001/ai-brain/prompt-lab（或侧栏「RAG 私有知识库」）  
- 风控熔断：http://localhost:3001/fleet → 切到「客户 B」查看 1 个风控熔断节点  

若网页在 3000，将上述 `3001` 改为 `3000` 即可。

---

## 5. 若部分路径 404

若只有 `/`、`/login` 能打开而 `/fleet` 等 404，多半是 **3001 被其他进程占用**，当前响应的不是本仓库的 Next 应用。处理：在 PowerShell 执行 `Get-NetTCPConnection -LocalPort 3001 | % { Stop-Process -Id $_.OwningProcess -Force }` 释放端口，再在 `web` 目录执行 `npm run dev`，等终端出现 `Local: http://localhost:3001` 后再用上表链接测试。
