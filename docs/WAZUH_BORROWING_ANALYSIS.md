# Wazuh 借鉴分析报告

**来源项目**：https://github.com/wazuh/wazuh  
**Stars**：15,143 | **Forks**：2,225 | **语言**：C++ + Python  
**定位**：Open Source Security Platform — 统一 XDR + SIEM，端点&云工作负载安全防护  
**分析日期**：2026-04-02

---

## 一、Wazuh 整体架构速览

```
wazuh/
├── src/                        ← C++ 核心引擎
│   ├── engine/                 ← 规则引擎（事件→告警）
│   ├── remoted/                ← Agent 远程通信（类似我们的边缘WSS接收器）
│   ├── logcollector/           ← 日志采集（边缘Agent侧）
│   ├── wazuh_modules/          ← 功能模块（漏洞扫描/安全基线/云监控）
│   ├── wazuh_db/               ← 专用事件数据库
│   ├── syscheckd/              ← 文件完整性监控
│   ├── active-response/        ← 自动响应（检测到威胁→自动执行动作）
│   ├── client-agent/           ← 边缘Agent主进程
│   └── shared_modules/         ← 共享模块（路由/解码/告警）
├── framework/                  ← Python 管理框架
│   └── wazuh/                  ← 集群/Agent/规则集管理
├── api/                        ← RESTful API（Python/aiohttp）
│   └── api/controllers/
│       ├── agent_controller.py    ← Agent 注册/状态/命令下发
│       ├── cluster_controller.py  ← 集群节点管理
│       ├── task_controller.py     ← 异步任务状态查询
│       └── security_controller.py ← RBAC 安全控制
├── ruleset/                    ← 告警规则集
│   ├── mitre/                  ← MITRE ATT&CK 框架映射
│   └── sca/                    ← 安全基线检查（CIS Benchmark）
└── wodles/                     ← 云平台监控插件
    ├── aws/                    ← AWS CloudTrail/S3/Inspector
    ├── azure/                  ← Azure Monitor/Storage
    ├── gcloud/                 ← Google Cloud Pub/Sub
    └── docker-listener/        ← Docker 事件监听
```

---

## 二、逐层对比分析

### 🌐 前端 SaaS 控制台

> Wazuh 本体无前端，配套 Wazuh Dashboard（基于 OpenSearch/Kibana 插件，独立仓库）。
> 核心借鉴点在其 **API 设计模式** 和 **规则集管理理念**。

| Wazuh 功能 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **MITRE ATT&CK 矩阵可视化**（威胁战术/技术/子技术三级分类，热力图展示） | 无行为分类矩阵 | ✅ **P1高价值** — 营销异常行为分类矩阵（仿 MITRE，按漏斗阶段/渠道/行为类型）|
| **SCA 安全基线检查**（合规扫描：通过/失败/不适用 三态，逐项说明） | `CODEX_TASK_SLOWMIST_LOBSTER_REDLINE.md` 已落地 | ⭕ 已落地 |
| **任务状态跟踪页**（`task_controller.py` 异步任务状态查询，进度/节点/错误）| `observability_api.py` 已落地 | ⭕ 已落地 |
| **云平台集成监控面板**（AWS/Azure/GCloud 状态总览） | 无多云监控面板 | ✅ **P2价值** — 边缘节点云环境状态面板 |

### 🧠 云端大脑层（Commander）

| Wazuh 功能 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **规则引擎**（`src/engine/` — 事件→解码→规则匹配→告警，支持自定义规则XML） | 无规则引擎，Commander 只有 LLM 调用 | ✅ **P1高价值** — **龙虾行为规则引擎**：定义触发条件→自动派发任务（不必每次 LLM 判断）|
| **集群管理**（`cluster_controller.py` — 主节点/工作节点，健康检查，任务分发）| `lobster_pool_manager.py` 已落地 | ⭕ 已落地 |
| **主动响应**（`src/active-response/` — 检测到事件→自动执行预定义响应脚本）| 无自动响应机制 | ✅ **P1高价值** — **龙虾自动响应**：catcher 检测到高意向线索→自动触发 followup |
| **漏洞数据库**（CVE 数据库本地化，离线扫描）| 无本地规则库 | ✅ **P2价值** — 营销规则库本地化（行业规则/竞品规则/违禁词库）|

### 🦞 9个龙虾层

| Wazuh 功能 | 对应龙虾 | 借鉴价值 |
|-----------|---------|---------|
| **logcollector**（多来源日志采集：文件/Syslog/Windows事件/命令输出）| radar（信号雷达虾） | ✅ **P1高价值** — radar 多源信号采集标准化（统一格式器，支持10+来源）|
| **syscheckd** 文件完整性监控（哈希比对，变更告警）| catcher（捕手虾） | ✅ **P2价值** — 线索数据完整性校验（关键字段变更检测）|
| **active-response** 脚本（检测到威胁→自动封禁/通知/执行）| followup（追单虾） | ✅ **P1高价值** — followup 自动响应规则（线索评分到阈值→自动发消息）|
| **wazuh_modules** 模块化扩展（每个功能独立模块，可独立启停）| 所有龙虾 | ✅ **P2价值** — 龙虾模块化（每只龙虾独立 enable/disable，不重启系统）|
| **MITRE ATT&CK 映射**（每条告警映射到 MITRE 战术/技术）| strategist（谋士虾） | ✅ **P2价值** — 龙虾任务映射到营销漏斗框架（AIDA/AARRR）|

### 🏗️ L2.5 支撑微服务集群

| Wazuh 功能 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **RESTful API** 设计（`api/api/` — aiohttp 异步，OpenAPI spec，统一错误码，JWT auth）| `app.py` FastAPI 已有 | ⭕ 已落地 |
| **RBAC 安全控制**（`security_controller.py` — 角色/资源/动作三维权限矩阵）| `CODEX_TASK_RESOURCE_RBAC.md` 已落地 | ⭕ 已落地 |
| **规则集热加载**（规则 XML 修改后无需重启，`remoted` 动态推送到 Agent）| `dynamic_config.py` 已落地 | ⭕ 已落地 |
| **wazuh_db 专用事件DB**（高性能 SQLite，边缘事件存储+批量上报，离线缓冲）| `CODEX_TASK_EDGE_TELEMETRY_BUFFER.md` 已落地 | ⭕ 已落地 |
| **任务异步框架**（`task_controller.py` — 长任务异步化，轮询状态，任务超时自动清理）| `task_queue.py` + `lobster_task_waiter.py` 已落地 | ⭕ 已落地 |
| **API 请求日志中间件**（`alogging.py` — 记录每次 API 请求+响应时间+用户+错误）| `llm_call_logger.py` 部分覆盖，API层无 | ✅ **P2价值** — API 请求全量日志（含响应时间，安全审计）|

### 🛰️ 云边调度层

| Wazuh 功能 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **remoted**（Agent 远程通信守护进程：注册/心跳/命令下发/事件上报，多协议）| `wss_receiver.py` + `edge_heartbeat.py` 已落地 | ⭕ 已落地 |
| **Agent 注册协议**（`os_auth/` — 证书+密钥双向认证，防伪造Agent注册）| 无 Agent 认证机制（只有 WSS token）| ✅ **P1高价值** — 边缘节点双向认证（防止伪造边缘节点接入）|
| **集群选主机制**（Master/Worker 节点，主节点故障自动切换）| 无集群高可用 | ✅ **P2价值** — 云端大脑高可用（主备切换）|
| **wodles 云平台插件**（AWS/Azure/GCloud 统一拉取接口，支持独立配置+独立运行）| 无云平台插件体系 | ✅ **P2价值** — 边缘节点云平台数据拉取插件（飞书/钉钉/企微作为 "wodle"）|

### 🖥️ 边缘执行层

| Wazuh 功能 | 我们现状 | 差距/价值 |
|-----------|---------|---------|
| **client-agent**（边缘主进程：多线程，各模块独立守护线程，主进程监控子线程健康）| `marionette_executor.py` + `wss_receiver.py` 已有，但无子线程守护 | ✅ **P1高价值** — 边缘主进程守护框架（每个功能独立线程，主进程监控重启）|
| **active-response 执行器**（接收云端指令→本地执行脚本→返回结果）| Playwright 边缘执行已有，无结构化指令执行器 | ✅ **P1高价值** — 边缘指令执行器（云端下发结构化指令，边缘执行+返回）|
| **logcollector 多源采集**（文件尾读/Syslog/命令执行输出，统一格式化）| 无边缘日志采集 | ✅ **P2价值** — 边缘行为日志采集（Playwright 操作日志→云端分析）|
| **离线缓冲**（Agent 断网时本地缓冲事件，重连后批量上报）| `CODEX_TASK_EDGE_TELEMETRY_BUFFER.md` 已落地 | ⭕ 已落地 |
| **配置管理**（`etc/` — 集中化配置文件，支持每个 Agent 独立配置覆盖）| `dynamic_config.py` 已落地 | ⭕ 已落地 |

---

## 三、优先级汇总

### ⭕ 已落地（Codex Task 已生成 = 视为已落地）

| 功能 | 已落地 |
|-----|-------|
| SCA 安全基线检查 | `CODEX_TASK_SLOWMIST_LOBSTER_REDLINE.md` |
| 异步任务状态 | `task_queue.py` + `lobster_task_waiter.py` |
| RBAC 权限控制 | `CODEX_TASK_RESOURCE_RBAC.md` |
| 规则热加载 | `dynamic_config.py` |
| WSS 边缘通信 | `wss_receiver.py` + `edge_heartbeat.py` |
| 离线缓冲 | `CODEX_TASK_EDGE_TELEMETRY_BUFFER.md` |
| 集群调度 | `lobster_pool_manager.py` |

### 🔴 P1（最高价值）

| # | 功能 | 来自 Wazuh | 落地方向 |
|---|------|-----------|---------|
| P1-1 | **龙虾行为规则引擎** | `src/engine/` 规则匹配框架 | `dragon-senate-saas-v2/lobster_rule_engine.py` |
| P1-2 | **龙虾自动响应框架** | `src/active-response/` | `dragon-senate-saas-v2/lobster_auto_responder.py` |
| P1-3 | **边缘主进程守护框架** | `src/client-agent/` 多线程守护 | `edge-runtime/edge_guardian.py` |
| P1-4 | **边缘节点双向认证** | `src/os_auth/` 证书+密钥认证 | `edge-runtime/edge_auth.py` |
| P1-5 | **radar 多源信号采集标准化** | `src/logcollector/` | `dragon-senate-saas-v2/signal_collector.py` |

### 🟡 P2

| # | 功能 | 来自 Wazuh | 落地方向 |
|---|------|-----------|---------|
| P2-1 | **营销行为分类矩阵** | `ruleset/mitre/` MITRE 框架 | 前端漏斗行为矩阵可视化 |
| P2-2 | **云平台插件体系（Wodles 模式）** | `wodles/` | `edge-runtime/wodles/` 飞书/钉钉插件 |
| P2-3 | **集群主备切换** | `cluster_controller.py` | `dragon-senate-saas-v2/cluster_ha.py` |
| P2-4 | **API 请求全量日志** | `api/api/alogging.py` | `dragon-senate-saas-v2/api_access_logger.py` |
| P2-5 | **龙虾模块化独立启停** | `wazuh_modules/` 模块框架 | `dragon-senate-saas-v2/lobster_module_manager.py` |

---

## 四、架构对比总结

```
Wazuh（安全检测响应平台）      我们（营销增长 AI 操作系统）
──────────────────────         ────────────────────────────
检测威胁→自动响应              发现线索→自动跟进
Agent采集日志→规则匹配→告警    边缘采集信号→龙虾处理→产出
多Agent分布式部署              多边缘节点分布式执行
MITRE ATT&CK 威胁分类          营销漏斗 AARRR 行为分类

最大借鉴价值：
  ✅ 规则引擎（条件触发，替代部分LLM判断，降本增效）
  ✅ 自动响应（检测到条件→立即执行，不等人工）
  ✅ 边缘主进程守护（多线程守护，子进程重启保活）
  ✅ 双向认证（边缘节点防伪造）
  ✅ 多源信号采集标准化（radar虾能力大幅提升）

我们独有优势：
  🤖 LLM 驱动（Wazuh 是规则驱动，我们规则+AI双引擎）
  🦞 角色化龙虾（垂直营销场景）
  🌐 Playwright 真实行动力
  📊 多租户SaaS（Wazuh 无多租户）
```

---

*来源：https://github.com/wazuh/wazuh（⭐15.1k）| 分析日期：2026-04-02*
