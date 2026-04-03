# OpenRemote 借鉴分析报告
## https://github.com/openremote/openremote.git

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**

---

## 一、OpenRemote 项目定性

```
OpenRemote（Java+TypeScript，IoT & Smart Building 平台）：
  定位：企业级 IoT 资产管理 + 规则引擎 + 边缘网关协议栈
  核心能力：
    Asset Model：层级化资产树（物理设备/虚拟资产/区域）
    Rule Engine：JSON 规则 + Groovy 脚本 + Flow 可视化规则
    Protocol Stack：MQTT/HTTP/Modbus/BACnet/Z-Wave 协议适配
    Edge Gateway：边缘网关（Java，断网自治，自动重连）
    Realm（多租户）：每个租户独立资产树 + 规则 + 用户
    Geo Map：资产地理位置可视化（Mapbox）
    Attribute History：属性历史时序数据存储 + 趋势图
    Flow Rules：可视化规则编辑器（Node/Edge 拖拽）
    Notification：推送/邮件/IM 通知（规则触发）
    Docker Compose 一键部署
```

---

## 二、已落地的能力（略过）

```
CODEX_TASK_EDGE_DEVICE_TWIN.md 已落地（KubeEdge 分析中生成）：
  ✅ 边缘设备数字孪生

CODEX_TASK_EDGE_NODE_TAGS.md 已落地：
  ✅ 边缘节点标签管理

CODEX_TASK_ANTFARM_WORKFLOW_ENGINE.md 已落地（AntFarm 分析中生成）：
  ✅ 工作流引擎

CODEX_TASK_TENANT_CONTEXT.md 已落地（Keycloak 分析中生成）：
  ✅ 多租户上下文隔离

CODEX_TASK_ALERT_ENGINE.md 已落地（Grafana 分析中生成）：
  ✅ 告警引擎

dragon-senate-saas-v2/webhook_event_bus.py 已存在：
  ✅ Webhook 事件总线

CODEX_TASK_DOCKER_ONE_CLICK_DEPLOY.md 已落地：
  ✅ Docker 部署

CODEX_TASK_EDGE_WSS_BACKOFF.md 已落地：
  ✅ 边缘断线重连
```

---

## 三、OpenRemote 对我们的真实价值

### 核心判断

OpenRemote 的杀手锏是**层级化资产模型（Asset Tree）**和**可视化规则引擎（Flow Rules）**。与我们的差距精准在于：
1. 我们的边缘节点没有"资产层次结构"——所有边缘节点是平铺的，没有区域/组织层次；
2. 我们的工作流只有 YAML 定义，没有可视化规则编辑器；
3. 我们的龙虾触发机制是手动或定时，缺少**条件触发规则**（"当条件X发生时自动唤醒龙虾Y"）。

---

### 3.1 云边调度层 — 边缘节点层级化管理（Asset Tree）

**OpenRemote Asset Tree：**
```
OpenRemote 的资产树结构：
  Realm（租户）
    └── Building A（区域）
          ├── Floor 1（子区域）
          │     ├── Room 101（空间）
          │     │     └── Sensor-001（设备节点）
          │     └── Room 102
          └── Floor 2
```

**对我们的价值：**
```
我们的边缘节点目前是平铺的：
  边缘节点只有 node_id + tenant_id，没有层次结构
  无法表达："这个区域有3台边缘设备，另一个区域有2台"
  
借鉴 OpenRemote Asset Tree：
  为边缘节点引入"分组/区域"概念：
    EdgeNodeGroup（组）：region / department / project
    EdgeNode（节点）挂在组下
    组支持批量操作（批量派任务、批量升级）
  
  实现：dragon-senate-saas-v2/edge_node_group.py
  前端：边缘节点管理页增加"组"视图（树形展示）
  工程量：1天
```

**优先级：P1**（企业客户必须需求，批量管理多节点时无组织结构无法使用）

---

### 3.2 龙虾层 — 可视化条件触发规则（Flow Rule Engine）

**OpenRemote Flow Rules：**
```
OpenRemote 可视化规则：
  触发器（When）：
    - 时间触发（Cron）
    - 属性变化（设备属性超阈值）
    - Webhook 入站
    - 手动触发
  
  条件（If）：
    - 多个属性条件 AND/OR 组合
    - 时间范围限制
  
  动作（Then）：
    - 发送通知
    - 调用 API
    - 设置属性值
    - 触发另一个规则
```

**对我们的价值：**
```
我们的龙虾触发方式单一：
  用户手动发消息 → 龙虾响应
  工作流定时触发
  
  缺少：条件规则触发
    "当租户昨日对话数 < 10 时，自动触发 followup 龙虾发回访消息"
    "当 catcher 连续失败3次时，自动告警 commander 龙虾"
    "当 radar 检测到竞品热点时，自动启动 inkwriter 龙虾生产内容"
  
  借鉴 OpenRemote：
    新增 LobsterTriggerRule（简化版）：
      trigger_type: schedule / event / condition
      condition: { metric: "task_fail_count", op: ">=", value: 3 }
      action: { lobster: "commander", message: "catcher连续失败3次，需介入" }
    
    规则由运营在 SaaS 管理台配置（YAML/JSON 表单）
    规则由后台定时评估（60秒一次）
  
  实现：dragon-senate-saas-v2/lobster_trigger_rules.py
  工程量：1.5天（条件评估 + 管理台配置页）
```

**优先级：P1**（龙虾自动化程度的关键升级，真正实现"龙虾自治"）

---

### 3.3 支撑微服务 — 属性历史时序存储（Attribute History）

**OpenRemote Attribute History：**
```
OpenRemote 为每个资产属性维护完整历史时序：
  - 任意属性的历史值查询
  - 时间范围聚合（min/max/avg/count）
  - 趋势图（前端自动渲染）
  
例：
  GET /api/asset/sensor-001/attribute/temperature/history?from=2026-04-01&to=2026-04-02
  → [{ts: 1711900800, value: 22.5}, ...]
```

**对我们的价值：**
```
我们的龙虾有"实时状态"但没有"历史时序"：
  可以知道当前 inkwriter 的成功率，但无法看到"过去30天趋势"
  
借鉴 OpenRemote：
  为关键龙虾指标维护时序历史：
    每日快照：{date, lobster_name, task_count, success_rate, avg_latency, cost_usd}
    存入 lobster_daily_metrics 表（已有 llm_call_logger 数据，新建聚合任务）
  
  API：GET /api/v1/metrics/lobster/{name}/history?days=30
  
  前端：龙虾详情页增加"30天趋势图"（复用 CODEX_TASK_SHADCN_CHARTS）
  
  实现：dragon-senate-saas-v2/lobster_metrics_history.py
  工程量：0.5天（聚合任务 + API，复用已有数据）
```

**优先级：P2**（价值高，工程量小，复用现有数据）

---

### 3.4 边缘层 — 多协议接入适配层（Protocol Adapter）

**OpenRemote Protocol Stack：**
```
OpenRemote 支持多种设备协议接入：
  MQTT（物联网标准）
  HTTP（RESTful 设备）
  Modbus（工业设备）
  BACnet（楼控设备）
  
每种协议有独立 Adapter，统一转为 Asset 属性变更事件
```

**对我们的价值：**
```
我们的边缘层只支持 WSS（WebSocket）协议，无法接入其他系统：
  无法接收企业内部系统的 HTTP 回调（ERP/CRM 事件）
  无法接收 MQTT 消息（IoT 设备状态变更）
  
借鉴 OpenRemote：
  在边缘层增加简单协议适配层：
    HTTP Adapter：边缘节点暴露 HTTP endpoint，接收第三方 webhook 回调
    MQTT Adapter：边缘节点订阅 MQTT topic，转为边缘任务
  
  实现：edge-runtime/protocol_adapter.py
  工程量：1天（HTTP + MQTT 两个 Adapter）
```

**优先级：P2**（企业集成场景必须，工程量可控）

---

## 四、对比总结

| 维度 | OpenRemote | 我们 | 胜负 | 行动 |
|-----|------------|------|------|------|
| **边缘节点层级管理** | ✅ Asset Tree | 平铺无层次 | OpenRemote 胜 | **P1** |
| **条件触发规则** | ✅ Flow Rules | 仅手动/定时 | OpenRemote 胜 | **P1** |
| **龙虾历史时序** | ✅ Attr History | 只有实时 | OpenRemote 胜 | **P2** |
| **多协议接入** | ✅ MQTT/HTTP | 仅 WSS | OpenRemote 胜 | **P2** |
| 多租户隔离 | ✅ Realm | ✅ 已落地 | 平 | — |
| 告警/通知 | ✅ | ✅ 已落地 | 平 | — |
| AI 龙虾智能 | ❌ | ✅ | 我们胜 | — |
| LLM 集成 | ❌ | ✅ | 我们胜 | — |

---

## 五、借鉴清单

### P1（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 1 | **边缘节点分组/层级管理**（组树视图 + 批量操作）| 1天 |
| 2 | **龙虾条件触发规则**（When/If/Then 规则 + 后台评估）| 1.5天 |

### P2（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 3 | **龙虾历史时序指标**（每日快照 + 30天趋势图）| 0.5天 |
| 4 | **边缘多协议适配**（HTTP Webhook + MQTT 订阅）| 1天 |

---

*分析基于 OpenRemote main 分支（2026-04-02）*
