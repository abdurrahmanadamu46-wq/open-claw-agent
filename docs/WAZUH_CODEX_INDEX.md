# Wazuh 借鉴落地索引

**分析日期**：2026-04-02  
**来源**：https://github.com/wazuh/wazuh（⭐15,143）  
**定位**：Open Source Security Platform — C++/Python，统一 XDR + SIEM，端点&云工作负载防护

---

## 生成文件清单

| 文件 | 类型 | 状态 |
|------|------|------|
| `docs/WAZUH_BORROWING_ANALYSIS.md` | 完整分析报告（6层逐层对比）| ✅ 已生成 |
| `docs/CODEX_TASK_LOBSTER_RULE_ENGINE.md` | P1-1+2 Codex Task | ✅ 已生成 |
| `docs/CODEX_TASK_EDGE_GUARDIAN.md` | P1-3+4 Codex Task | ✅ 已生成 |
| `docs/CODEX_TASK_WAZUH_P2.md` | P2 合并 Codex Task（5项）| ✅ 已生成 |

---

## P1 执行顺序（推荐）

```
1. CODEX_TASK_EDGE_GUARDIAN          ← 先稳固边缘层（守护框架+双向认证）
2. CODEX_TASK_LOBSTER_RULE_ENGINE    ← 再建规则引擎（降低LLM调用成本）
```

> **为什么边缘守护先行？**  
> 规则引擎的事件来源（线索评分/信号采集）都来自边缘节点。  
> 边缘层不稳定，规则引擎无法接收到可靠事件。

## P2 执行顺序

```
CODEX_TASK_WAZUH_P2.md 包含：
  P2-1: MarketingFunnelMatrix   ← 营销漏斗行为分类热力图（仿 MITRE ATT&CK）
  P2-2: Wodles 信号插件         ← 飞书/企微/钉钉/抖音 统一 Wodle 插件体系
  P2-3: ApiAccessLogger         ← API 请求全量访问日志（安全审计）
  P2-4: LobsterModuleManager    ← 龙虾按租户独立启停
  P2-5: SignalCollector         ← radar 虾多源信号采集标准化
```

---

## 已跳过项（已落地或我们更好）

| Wazuh 功能 | 跳过原因 |
|-----------|---------|
| SCA 安全基线检查 | `CODEX_TASK_SLOWMIST_LOBSTER_REDLINE.md` 已落地 |
| 异步任务状态查询 | `task_queue.py` + `lobster_task_waiter.py` 已落地 |
| RBAC 三维权限 | `CODEX_TASK_RESOURCE_RBAC.md` 已落地 |
| 规则热加载 | `dynamic_config.py` 已落地 |
| WSS 边缘通信 | `wss_receiver.py` + `edge_heartbeat.py` 已落地 |
| 离线缓冲批量上报 | `CODEX_TASK_EDGE_TELEMETRY_BUFFER.md` 已落地 |
| 集群调度/龙虾池 | `lobster_pool_manager.py` 已落地 |
| 分布式追踪 | `CODEX_TASK_DISTRIBUTED_TRACING.md` 已落地 |

---

## 核心价值总结（与 Open WebUI 对比）

| 维度 | Open WebUI 借鉴 | Wazuh 借鉴 |
|------|---------------|-----------|
| 受益层 | 前端体验 + 龙虾产出质量 | 系统稳定性 + 运营自动化 |
| 核心机制 | Artifact渲染 / 人工反馈 / Pipeline插件 | 规则引擎 / 边缘守护 / 信号标准化 |
| 商业价值 | 提升用户体验和留存 | 降低运营成本和LLM费用 |
| 实现难度 | 中（前端+Python） | 中（Python异步） |
| 优先级建议 | Wazuh P1 优先于 OpenWebUI P2 | 因为基础设施先行 |

---

> **Wazuh 最大启发**：安全系统 ≠ 营销系统，但"**检测→规则→自动响应**"这套方法论完全适用于  
> "**信号检测→龙虾规则→自动派发**"。规则引擎 + 自动响应是我们降低 LLM 调用成本、  
> 实现真正"无人值守自动化营销"的关键基础设施。

---

*更新于 2026-04-02*
