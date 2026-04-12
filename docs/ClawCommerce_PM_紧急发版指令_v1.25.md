# ClawCommerce PM 紧急发版指令 v1.25

## 龙虾池一号客户交付作战计划 (VIP White-Glove Deployment)

**目标：** 一号客户电脑连上总控，**跑出第一条线索**。  
**原则：** P0 only；扫码/Tauri 炫酷 UI 全部让路给「硬编码 + 黑框 + 可执行包」。

---

## 1. 小军：一号客户特供版 (VIP Build)

| 项 | 指令 |
|----|------|
| **鉴权** | **跳过扫码**；Tenant-ID + Device-Token（JWT）写死在 **环境变量或 `.env.vip`**，客户端启动即连。 |
| **界面** | **极简黑框**：仅一行状态——`🟢 龙虾节点已连接云端，等待任务下发...`（连接成功即打印；断线重连自动重打）。 |
| **打包** | **pkg** 打 Windows `.exe`（或 Tauri 默认打包 `.dmg`）；客户**零配置**双击运行。 |

**落地文件：**

- 入口脚本：`scripts/vip-build/vip-lobster-entry.cjs`（CommonJS，便于 pkg）
- 配置模板：`scripts/vip-build/.env.vip.example` → 复制为 `.env.vip` 填真实值（**勿提交 Git**）
- 打包命令：见同目录 `README_VIP_BUILD.md`

---

## 2. 总控绿灯 + 账号预设 (Backend Greenlight)

**执行人：** 小明（后端）为主；小军配合提供 `MACHINE_CODE` 与测试 JWT。

| 项 | 动作 |
|----|------|
| **手动开户** | 生产 PostgreSQL **手动 INSERT** 一号客户租户，PRO 权限，线索配额拉满。 |
| **设备白名单** | **ClientDevice** 表预录入小军写死的 **Device-Token 对应 machine_code**，状态强绑定；WS 一连上即 **ONLINE**。 |
| **死盯日志** | 客户运行几小时内盯 **Sentry + 后台日志**；调度/计费锁异常**后台手动修数据**，**不让客户感知崩溃**。 |

**SQL 模板：** `docs/v1.25_一号客户_手动开户与白名单.sql`（按实际表名改）。  
**JWT：** 与 `backend` 同 `JWT_SECRET` 签发，`payload` 至少含 `tenantId`、`sub`(machine_code)。

---

## 3. 验收标准（今天）

1. 客户双击 `.exe` → 黑框出现 **🟢 已连接**。  
2. 总控侧该设备 **ONLINE**。  
3. 下发一条任务 → 客户端 Ack → **至少一条 client.lead.report** 进库或可观测。

---

## 4. 文档关系

| 文档 |
|------|
| `docs/项目进度与安装就绪_客户版.md` — 对外承诺以「能双击运行的包」为准时，v1.25 即为当前路径 |
| `docs/ClawCommerce_PM_研发协同指令_v1.24.md` — 扫码流延后，VIP 用硬编码替代 |

**版本：** v1.25  
**状态：** 执行中；非 P0 暂停。
