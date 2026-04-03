# Mender 借鉴分析报告
## https://github.com/mendersoftware/mender

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**

---

## 一、Mender 项目定性

```
Mender（Go，9k+ Star）：IoT/嵌入式设备 OTA 更新管理平台
  核心能力：
    OTA 更新管理     — 远程设备软件/固件升级
    A/B 分区回滚     — 更新失败自动回滚上一版本
    部署分组         — 分批次/灰度推送到设备子集
    设备认证          — mTLS + JWT 设备身份验证
    设备清单          — 全局设备状态列表 + 筛选
    制品管理          — 更新包版本库（Artifacts）
    部署监控          — 实时成功/失败/进度追踪
    Hosted Mender    — SaaS 多租户版本（收费）
```

---

## 二、已落地的能力（略过）

```
CODEX_TASK_DOCKER_ONE_CLICK_DEPLOY.md 已落地：
  ✅ 边缘端部署（Docker Compose）

CODEX_TASK_EDGE_META_CACHE.md 已落地（本次新增）：
  ✅ 边缘离线本地缓存

CODEX_TASK_EDGE_DEVICE_TWIN.md 已落地（本次新增）：
  ✅ 边缘孪生状态对比

CODEX_TASK_SLOWMIST_EDGE_AUDIT.md 已落地：
  ✅ 边缘端审计日志

CODEX_TASK_RESOURCE_RBAC.md 已落地：
  ✅ 设备/资源权限控制
```

---

## 三、Mender 对我们的真实价值

### 核心判断

Mender 专注 **IoT 设备 OTA 升级**，我们的边缘节点是运行 Python 的软件边缘端（非硬件固件），大部分能力不适用。但有 **2个设计**与我们高度相关：

---

### 3.1 边缘层 — 灰度部署分组（Deployment Groups）

**Mender 灰度部署：**
```
部署策略：
  ALL       — 全量推送（所有设备）
  FILTER    — 按标签筛选（地区/版本/类型）
  PHASED    — 阶段性推送：先 10% → 24h观察 → 100%
  
  每次部署记录：
    artifact_version / target_group / start_ts
    success_count / failure_count / pending_count
    自动检测失败率超阈值时暂停部署
```

**对我们的价值：**
```
我们推送边缘端 edge-runtime 新版本时，目前是全量推送（没有灰度）：
  一旦新版本有 bug → 全部边缘节点受影响

借鉴 Mender 灰度策略：
  1. 先推 10% 边缘节点（金丝雀组）
  2. 观察 1小时：失败率 > 5% → 自动暂停 + 告警
  3. 无异常 → 推剩余 90%
  
  实现：dragon-senate-saas-v2/edge_deployment_manager.py
    DeploymentGroup: ALL / CANARY(10%) / PHASED(10%→50%→100%)
    DeploymentRecord: version / group / success/fail count / status
    失败率超阈值 → push pause event → 运营告警
```

**优先级：P1**（线上稳定性关键）

---

### 3.2 边缘层 — A/B 版本回滚

**Mender A/B 回滚：**
```
设备存储两个分区：A（当前）/ B（备用）
升级时写入 B 分区，重启后从 B 启动
如果 B 启动失败（boot count 超限）→ 自动回滚 A

对软件边缘端的类比：
  edge-runtime 保存两个版本：
    current_version/   （运行中）
    backup_version/    （上一个稳定版）
  更新时：backup = current，current = new
  新版本启动失败 → 恢复 backup，上报云端
```

**对我们的价值：**
```
结合 Device Twin（已落地）：
  云端 desired.edge_version = "v2.3.0"
  边缘执行升级：backup("v2.2.0") → 安装 v2.3.0
  v2.3.0 启动失败 → 回滚 v2.2.0 → 上报 actual.edge_version = "v2.2.0"
  云端检测到 desired≠actual → 标记该节点"升级失败"

工程量：轻量（文件复制 + 启动检查）
```

**优先级：P1**（与灰度部署配套，升级安全网）

---

### 3.3 云边调度层 — 制品版本库（Artifact Registry）

**Mender Artifact：**
```
每个更新包是一个 .mender 文件（含版本号/兼容设备列表/校验和）
云端管理所有历史版本
设备查询时只下载自己需要的版本
```

**对我们的价值：**
```
我们已有：
  - skill_registry（技能版本管理）— 已落地
  - edge_meta_cache（本地缓存）— 已落地
  
Mender Artifact 思路对应：
  edge-runtime 安装包版本库（不同版本对应不同边缘类型）
  目前我们直接 git pull 或 pip install 更新，无版本库管理
  
  但：当前规模下 git pull 够用，Artifact Registry 工程量较大
```

**优先级：P3**（边缘节点数量超过50个后再考虑）

---

### 3.4 SaaS 系统 — 设备认证（mTLS + JWT）

**Mender 设备认证：**
```
边缘设备首次接入：
  1. 设备生成 RSA 公私钥对
  2. 发送公钥 + 设备信息到 Mender Server
  3. 管理员审批（或自动白名单）
  4. 服务器签发 JWT token，设备后续携带 token 通信
  
  防止：未授权设备接入（冒充合法边缘节点）
```

**对我们的价值：**
```
我们的边缘节点接入目前使用 API Key（静态），
Mender 设备认证可以升级为：
  边缘节点生成唯一密钥对，首次注册需要管理员审批
  
  但：CODEX_TASK_RESOURCE_RBAC.md 已落地（API Key 级别权限控制）
  Mender 设备 mTLS 认证工程量较大，暂不引入
```

**优先级：P3**（API Key 当前已够用）

---

## 四、对比总结

| 维度 | Mender | 我们 | 胜负 | 行动 |
|-----|--------|------|------|------|
| **灰度部署分组** | ✅ | 全量推送 | **Mender 胜** | **P1** |
| **A/B 版本回滚** | ✅ | 无回滚 | **Mender 胜** | **P1** |
| 制品版本库 | ✅ | git pull | Mender 胜 | P3 |
| 设备认证 mTLS | ✅ | API Key | 平（当前够用）| P3 |
| 边缘离线缓存 | ✅ | ✅ 已落地 | **平** | — |
| 孪生状态对比 | — | ✅ 已落地 | **我们胜** | — |
| AI/LLM 体系 | ❌ | ✅ 深度定制 | **我们胜** | — |
| 多租户 SaaS | ✅（收费）| ✅ 完整免费 | **平** | — |

---

## 五、借鉴清单

### P1 新建 Codex Task（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 1 | **边缘端灰度部署分组**（Canary 10% → 全量，失败率告警暂停）| 1.5天 |
| 2 | **边缘端 A/B 版本回滚**（升级失败自动恢复上一版本）| 1天 |

---

*分析基于 Mender v4.x（2026-04-02）*
