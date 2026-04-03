# CODEX TASK: Provider 动态热重载 — 无重启新增 LLM Provider

**优先级：P1**  
**来源借鉴：Aurogen `providers/providers.py`**  
**参考分析：`docs/AUROGEN_BORROWING_ANALYSIS.md` 第三节 2.3**

---

## 背景

Aurogen 的 Provider 管理支持**配置修改立即生效，无需重启服务**。
我们的 `provider_registry.py` 已有多 Provider 管理和 failover，但新增/修改 Provider 后需要服务重启。
热重载能力可以让运维人员或代理商在 Web 面板直接操作，立即生效。

---

## 任务目标

升级 `provider_registry.py` 支持热重载，并完善前端 Provider 管理面板。

---

## 一、后端：升级 `dragon-senate-saas-v2/provider_registry.py`

### 当前问题

现有 `ProviderRegistry` 在应用启动时加载配置，后续修改需重启。

### 升级要求

```python
# provider_registry.py 升级点

class ProviderRegistry:
    """
    升级：支持运行时热重载
    
    新增方法：
    
    def reload_provider(self, provider_id: str) → bool:
        """
        从配置源（DB 或 JSON）重新加载指定 Provider 配置
        无需重启服务
        线程安全（使用 asyncio.Lock）
        """
    
    def add_provider(self, config: ProviderConfig) → bool:
        """
        运行时动态注册新 Provider
        写入持久化配置
        立即可用于 LLM 路由
        """
    
    def remove_provider(self, provider_id: str) → bool:
        """
        运行时注销 Provider
        从路由中移除，不影响正在进行的调用（等待完成）
        """
    
    def update_provider(self, provider_id: str, updates: dict) → bool:
        """
        运行时更新 Provider 配置（如 API key、模型列表、权重）
        更新后的新请求立即使用新配置
        """
    
    # 已有方法保持不变，兼容现有调用方
    # failover_provider.py 继续正常工作
    ```

### 配置持久化

Provider 配置从内存（应用重启丢失）改为持久化：
- 写入 `dragon-senate-saas-v2/config/providers.json`（或写入 DB）
- 每次 `add/update/remove` 后自动持久化
- 服务重启后从持久化配置恢复，无需重新在 Web 面板配置

### 线程安全

```python
# 使用 asyncio.Lock 保证并发安全
# Provider 列表修改时加锁
# 读操作不加锁（Copy-on-Write 模式）
```

---

## 二、后端 API：升级路由

在现有 `/api/v1/providers/` 路由基础上**补充**：

```
# 已有（保留）：
GET    /api/v1/providers/health       → Provider 健康状态

# 新增：
GET    /api/v1/providers              → 列出所有 Provider（含配置概要，脱敏 API key）
POST   /api/v1/providers              → 注册新 Provider（热生效）
PUT    /api/v1/providers/{id}         → 更新 Provider 配置（热生效）
DELETE /api/v1/providers/{id}         → 注销 Provider（热生效）
POST   /api/v1/providers/{id}/reload  → 强制重新加载配置
POST   /api/v1/providers/{id}/smoke   → 冒烟测试（已有 /llm/router/smoke 合并到这里）
GET    /api/v1/providers/{id}/metrics → 单 Provider 调用指标
```

**API key 安全：**
- `GET /api/v1/providers` 返回的 key 字段做脱敏（显示前4后4，中间星号）
- `POST /api/v1/providers` 写入时加密存储
- 复用现有 RSA 传输加密流程

---

## 三、前端：完善 Provider 管理面板

**现状：** `PROJECT_CONTROL_CENTER.md` 第十节显示 Provider 健康检查前端为 `🟡` 待补。

**目标：** 将 Provider 健康检查页升级为完整的 Provider 管理页。

### 页面位置

```
/settings/model-providers   ← 已有或新建
```

### 页面功能

```
Provider 管理页（/settings/model-providers）
├── Provider 列表
│   ├── 名称 / 类型（OpenAI/Anthropic/本地/自定义）
│   ├── 状态徽章（healthy / degraded / offline）
│   ├── 模型列表（chips 展示）
│   ├── 调用量 / 成功率（mini 图表）
│   └── 操作（编辑 / 冒烟测试 / 禁用 / 删除）
├── 注册新 Provider（右侧抽屉）
│   ├── Provider 类型选择（OpenAI 兼容 / Anthropic / Gemini / 本地）
│   ├── API Key（加密传输，显示脱敏）
│   ├── Base URL（可选，自定义端点）
│   ├── 模型列表配置
│   ├── 优先级/权重（用于 failover 路由）
│   └── 保存（热生效，无需重启提示）
└── Provider 健康监控
    ├── 实时状态刷新（30s 轮询）
    └── 冒烟测试按钮（对应 /smoke API）
```

### TypeScript 类型文件

新建 `web/src/types/provider-registry.ts`：

```typescript
export interface ProviderConfig {
  id: string;
  name: string;
  type: 'openai_compatible' | 'anthropic' | 'gemini' | 'local';
  base_url?: string;
  api_key_masked: string;   // 脱敏后的 key（前4后4）
  models: string[];
  priority: number;          // failover 优先级
  enabled: boolean;
  weight?: number;           // 负载均衡权重
  created_at: string;
  updated_at: string;
}

export interface ProviderHealth {
  id: string;
  status: 'healthy' | 'degraded' | 'offline';
  latency_ms: number;
  success_rate_1h: number;
  total_calls_24h: number;
  last_checked: string;
}

export interface ProviderMetrics {
  id: string;
  calls_by_hour: Array<{ hour: string; count: number; success: number }>;
  avg_latency_ms: number;
  error_rate: number;
}
```

### 前端 API Endpoint

在 `web/src/services/endpoints/ai-subservice.ts` 增加：

```typescript
export const providerEndpoints = {
  list: () => `/api/v1/providers`,
  create: () => `/api/v1/providers`,
  update: (id: string) => `/api/v1/providers/${id}`,
  delete: (id: string) => `/api/v1/providers/${id}`,
  reload: (id: string) => `/api/v1/providers/${id}/reload`,
  smoke: (id: string) => `/api/v1/providers/${id}/smoke`,
  health: () => `/api/v1/providers/health`,
  metrics: (id: string) => `/api/v1/providers/${id}/metrics`,
};
```

---

## 四、⚠️ 覆盖规则（重要）

1. **`/llm/router/status` / `/llm/router/metrics` / `/llm/router/smoke`** 现有路由：
   - 保持兼容，不删除
   - 在 `PROJECT_CONTROL_CENTER.md` 中将其标记为"已迁移到 /api/v1/providers/"
   - 前端新页面统一使用新路由

2. **`PROJECT_CONTROL_CENTER.md` 第十节**中 Provider 健康相关的 `🟡` 标注：
   - 落地后全部改为 `✅`，并更新对应的类型文件和页面路径

---

## 五、PROJECT_CONTROL_CENTER.md 同步更新

完成后更新 `PROJECT_CONTROL_CENTER.md`：

1. **第三节"当前成熟能力"** 更新：
   ```
   ✅ provider_registry.py 支持热重载（无重启新增/更新/删除 Provider）
   ✅ providers.json 持久化配置
   ```

2. **第四节"已完成 API"** 增加：
   ```
   ✅ GET /api/v1/providers
   ✅ POST /api/v1/providers
   ✅ PUT /api/v1/providers/{id}
   ✅ DELETE /api/v1/providers/{id}
   ✅ POST /api/v1/providers/{id}/reload
   ✅ POST /api/v1/providers/{id}/smoke
   ✅ GET /api/v1/providers/{id}/metrics
   ```

3. **第十节"前端对齐索引"** 更新 Provider 行：
   ```
   | Provider 管理 | GET/POST/PUT/DELETE /api/v1/providers | web/src/types/provider-registry.ts | /settings/model-providers | ✅ |
   ```

4. **第七节"已落地借鉴清单"** 增加：
   ```
   | Aurogen | Provider 热重载（无重启生效）| ✅ | provider_registry.py |
   ```

---

## 验收标准

- [ ] 通过 API `POST /api/v1/providers` 注册新 Provider，无需重启即可调用
- [ ] `providers.json` 持久化，服务重启后自动恢复
- [ ] 前端 `/settings/model-providers` 可完整管理 Provider 生命周期
- [ ] API key 在前端展示时已脱敏
- [ ] `web/src/types/provider-registry.ts` 类型文件存在
- [ ] `PROJECT_CONTROL_CENTER.md` 中 Provider 相关 `🟡` 全部改为 `✅`

---

*Codex Task | 来源：AUROGEN_BORROWING_ANALYSIS.md P1-#3 | 2026-04-02*
