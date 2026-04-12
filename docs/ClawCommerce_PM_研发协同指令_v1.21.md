# ClawCommerce PM 研发协同指令 v1.21

**主题：** Sprint 4 — 龙虾池 C&C 架构重构：**协议先行 / 无头 PoC，拒绝先套壳**  
**决策人：** 小丽（PM）  
**执行：** 小明（后端 C&C）、小军（Agent / lobster-client-poc）

---

## PM 决策（已拍板）

- **协议先行（Protocol First）**：不等待 Tauri/Electron 壳子。  
- **第一阶段只做黑盒 PoC**：`lobster-client-poc.ts`（纯 Node WebSocket Client）跑通后再套壳。  
- **理由：** 小军双线作战；若先做 GUI + 跨平台编译 + 杀软权限，极易在**底层通信未通**时掉进客户端天坑，周期不可控。

---

## Sprint 4 两步走

### 第一阶段：纯 Node.js WebSocket 连通性 PoC

| 角色 | 交付 |
|------|------|
| **小明** | 《C&C WebSocket 协议数据格式规范》已定稿；Gateway 握手 + 心跳 + `server.task.dispatch` + 收 `client.lead.report` |
| **小军** | **不写 Tauri UI**；在现有 Node Agent 上抽出 **`lobster-client-poc.ts`**：连接 / 鉴权 / 心跳 / 收任务 / Playwright 执行 / 回传线索 |

**联调闭环：**  
认证握手 → 心跳维持 → 云端 `server.task.dispatch` → 本地执行 Playwright → `client.lead.report`（结构对齐 `ILeadSubmissionPayload`）。

**成功标准：** 黑框脚本 **稳定不断线**，可 7×24 挂跑不崩溃。

### 第二阶段：套壳与极简 UI（Tauri / Electron）

PoC **100% 稳定** 后，小军再把同一套逻辑塞进 Tauri：扫码绑定、开机自启、静默运行，打包 `.exe` / `.dmg`。

---

## 给小明的时间预期（答复 PM）

| 项 | 说明 |
|----|------|
| **规范已定稿** | `docs/C&C_WebSocket_协议规范_v1.20.md` 已含握手 + JWT + machine_code；**v1.21 补丁**已追加 RPC 事件名、心跳 Ping/Pong、离线阈值、重连补发（见同目录协议文档 §7） |
| **小明本地 Gateway 骨架** | 握手 + 收心跳：**半个工作日内**可挂在本地调试端口 |
| **完整闭环（dispatch + lead.report + 计费锁）** | 按现有 V1.13 悲观锁平移：**1～2 个工作日**（含联调 PoC） |

**结论：** 规范 **现在即可甩给小军** 切分支写 `lobster-client-poc.ts`；小明并行起 Gateway，不必等壳子。

---

## 给小军的行动项

1. 切分支：`feature/lobster-client-poc`（或团队约定命名）。  
2. 只依赖 **`socket.io-client`** + 现有 Playwright 流水线，无 Tauri。  
3. 严格按 **`docs/C&C_WebSocket_协议规范_v1.20.md`** §0～§7 实现事件名与 JSON 字段。  
4. 线索体：**直接复用** 仓库内 `src/shared/contracts.ts` 的 **`ILeadSubmissionPayload`**（WS 里可驼峰或下划线与小明对齐后钉死一版）。

---

**关联文档**

- 协议正文：`docs/C&C_WebSocket_协议规范_v1.20.md`（v1.21 生命周期见 §7）  
- 架构背景：`docs/ClawCommerce_PM_v1.20_龙虾池架构.md`
