# CODEX TASK: Feature Flag 系统 — 龙虾行为热开关 + 灰度发布

**优先级：P1**  
**来源借鉴：Unleash Feature Toggle 核心 + GradualRollout 策略 + SDK 本地缓存**  
**参考分析：`docs/UNLEASH_BORROWING_ANALYSIS.md` 第二节 2.2、2.3**

---

## 背景

当前修改龙虾行为（如启用新技能、升级 Prompt）需要改代码 → 提交 → 部署，全量生效，无法灰度测试。

Unleash 证明了 Feature Flag 模式的价值：拨动开关 → 毫秒级生效 → 无需部署。

---

## 任务目标

新建 `dragon-senate-saas-v2/feature_flags.py`，实现完整的功能开关系统，支持：
1. 龙虾技能开关（无部署热切换）
2. 渐进发布（GradualRollout，按租户哈希分流）
3. 本地缓存（毫秒级 is_enabled()）
4. 紧急熔断开关（全局一键关闭）
5. 多环境隔离（dev/staging/prod）

---

## 一、后端：新建 `dragon-senate-saas-v2/feature_flags.py`

```python
# feature_flags.py
# Feature Flag 系统 — 龙虾行为热开关

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List, Any
import asyncio
import hashlib
import json
from datetime import datetime

# ============================================================
# 数据模型
# ============================================================

class StrategyType(str, Enum):
    ALL = "all"                        # 全量开启（默认）
    GRADUAL_ROLLOUT = "gradualRollout" # 渐进发布
    TENANT_WHITELIST = "tenantWhitelist" # 租户白名单
    LOBSTER_WHITELIST = "lobsterWhitelist" # 龙虾白名单
    EDGE_NODE_TAG = "edgeNodeTag"      # 边缘节点 Tag 匹配

class StickinessType(str, Enum):
    TENANT_ID = "tenant_id"   # 按租户哈希（同一租户一致体验）
    USER_ID = "user_id"       # 按用户哈希
    RANDOM = "random"         # 随机（每次可能不同）

class Environment(str, Enum):
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"

@dataclass
class FlagStrategy:
    """单个发布策略"""
    type: StrategyType
    parameters: dict = field(default_factory=dict)
    # gradualRollout: { "rollout": 10, "stickiness": "tenant_id" }
    # tenantWhitelist: { "tenant_ids": ["t1", "t2"] }
    # edgeNodeTag: { "tags": ["test", "beta"] }

@dataclass
class FlagVariant:
    """A/B 测试变体"""
    name: str             # 变体名称（如 "prompt_v2"）
    weight: int           # 权重（0-1000，总和1000）
    payload: Any = None   # 变体数据（如 prompt 内容）
    enabled: bool = True

@dataclass
class FeatureFlag:
    """功能开关配置"""
    name: str                          # toggle 名称（如 "inkwriter.prompt_v2"）
    enabled: bool                      # 全局开关
    environment: Environment           # 生效环境
    strategies: List[FlagStrategy] = field(default_factory=lambda: [FlagStrategy(type=StrategyType.ALL)])
    variants: List[FlagVariant] = field(default_factory=list)
    description: str = ""
    tags: List[str] = field(default_factory=list)   # 分类标签（如 "lobster", "prompt"）
    tenant_id: Optional[str] = None    # None = 平台级，非None = 租户私有
    created_by: str = ""
    created_at: datetime = None
    updated_at: datetime = None
    
    # 内置预设 toggle 名称（不允许删除）
    BUILTIN_FLAGS = {
        "lobster.pool.all_enabled",          # 全局龙虾紧急熔断
        "lobster.radar.enabled",
        "lobster.strategist.enabled",
        "lobster.inkwriter.enabled",
        "lobster.visualizer.enabled",
        "lobster.dispatcher.enabled",
        "lobster.echoer.enabled",
        "lobster.catcher.enabled",
        "lobster.abacus.enabled",
        "lobster.followup.enabled",
        "lobster.commander.enabled",
    }

@dataclass
class FeatureFlagContext:
    """Feature Flag 评估上下文"""
    tenant_id: str = ""
    user_id: str = ""
    lobster_id: str = ""
    edge_node_id: str = ""
    edge_node_tags: List[str] = field(default_factory=list)
    environment: Environment = Environment.PROD

@dataclass
class Variant:
    """is_enabled() 返回的变体结果"""
    name: str
    enabled: bool
    payload: Any = None

# ============================================================
# 策略评估引擎
# ============================================================

class StrategyEvaluator:
    
    def evaluate(self, strategy: FlagStrategy, ctx: FeatureFlagContext) -> bool:
        if strategy.type == StrategyType.ALL:
            return True
        elif strategy.type == StrategyType.GRADUAL_ROLLOUT:
            return self._gradual_rollout(strategy.parameters, ctx)
        elif strategy.type == StrategyType.TENANT_WHITELIST:
            return ctx.tenant_id in strategy.parameters.get("tenant_ids", [])
        elif strategy.type == StrategyType.LOBSTER_WHITELIST:
            return ctx.lobster_id in strategy.parameters.get("lobster_ids", [])
        elif strategy.type == StrategyType.EDGE_NODE_TAG:
            required_tags = set(strategy.parameters.get("tags", []))
            return bool(required_tags & set(ctx.edge_node_tags))
        return False
    
    def _gradual_rollout(self, params: dict, ctx: FeatureFlagContext) -> bool:
        """
        渐进发布策略
        rollout: 0-100（百分比）
        stickiness: 用哪个字段做哈希（保证同一实体一致体验）
        """
        rollout = int(params.get("rollout", 100))
        stickiness = params.get("stickiness", "tenant_id")
        
        # 获取哈希基准值
        if stickiness == "tenant_id":
            value = ctx.tenant_id
        elif stickiness == "user_id":
            value = ctx.user_id
        else:
            import random
            return random.randint(0, 99) < rollout
        
        # MurmurHash 风格：MD5取前8字节 % 100
        hash_int = int(hashlib.md5(value.encode()).hexdigest()[:8], 16)
        bucket = hash_int % 100
        return bucket < rollout

# ============================================================
# 本地缓存（SDK 模式）
# ============================================================

class FeatureFlagCache:
    """
    本地内存缓存，仿 Unleash SDK
    is_enabled() < 1ms（无 DB/Redis 调用）
    """
    
    def __init__(self):
        self._flags: dict[str, FeatureFlag] = {}
        self._lock = asyncio.Lock()
        self._evaluator = StrategyEvaluator()
        self._last_sync: Optional[datetime] = None
        self._backup_file = "config/feature_flags_backup.json"
    
    async def sync_from_db(self):
        """从 DB 同步最新 flag 配置（定时调用，30s一次）"""
        # 查询当前环境的所有 flag
        # flags = await db.query("SELECT * FROM feature_flags WHERE environment = $1", current_env)
        async with self._lock:
            # self._flags = {f.name: f for f in flags}
            self._last_sync = datetime.now()
        # 同时写入备份文件（cold start 保护）
        await self._write_backup()
    
    async def _write_backup(self):
        """写入 JSON 备份文件"""
        # json.dump(self._flags, open(self._backup_file, 'w'))
        pass
    
    def _load_backup(self):
        """从备份文件恢复（服务器不可用时使用）"""
        # if os.path.exists(self._backup_file):
        #     self._flags = json.load(open(self._backup_file))
        pass
    
    def is_enabled(self, flag_name: str, ctx: FeatureFlagContext) -> bool:
        """
        检查 flag 是否对当前上下文生效
        本地内存查找，< 1ms
        
        规则：
          1. flag 不存在 → False
          2. flag.enabled = False → False（全局关闭）
          3. 逐一评估 strategies，任一返回 True → True
          4. 全部 strategy 返回 False → False
        """
        flag = self._flags.get(flag_name)
        if not flag or not flag.enabled:
            return False
        
        # 环境匹配
        if flag.environment != ctx.environment:
            return False
        
        # 评估策略（任一策略满足即开启）
        for strategy in flag.strategies:
            if self._evaluator.evaluate(strategy, ctx):
                return True
        return False
    
    def get_variant(self, flag_name: str, ctx: FeatureFlagContext) -> Variant:
        """
        获取 A/B 测试变体
        返回：{ name: "prompt_v2", enabled: True, payload: "..." }
        """
        if not self.is_enabled(flag_name, ctx):
            return Variant(name="disabled", enabled=False)
        
        flag = self._flags.get(flag_name)
        if not flag or not flag.variants:
            return Variant(name="control", enabled=True)
        
        # 按权重分桶（总权重1000）
        total_weight = sum(v.weight for v in flag.variants if v.enabled)
        if total_weight == 0:
            return Variant(name="control", enabled=True)
        
        hash_int = int(hashlib.md5(ctx.tenant_id.encode()).hexdigest()[:8], 16)
        bucket = hash_int % total_weight
        
        cumulative = 0
        for variant in flag.variants:
            if not variant.enabled:
                continue
            cumulative += variant.weight
            if bucket < cumulative:
                return Variant(name=variant.name, enabled=True, payload=variant.payload)
        
        return Variant(name="control", enabled=True)
    
    async def invalidate(self, flag_name: str):
        """立即重新加载指定 flag（Webhook 触发）"""
        # 从 DB 重新查询单个 flag，更新 _flags
        pass

# ============================================================
# 全局单例 + 公共接口
# ============================================================

_cache = FeatureFlagCache()

def get_feature_flag_client() -> FeatureFlagCache:
    """FastAPI 依赖注入"""
    return _cache

def ff_is_enabled(flag_name: str, ctx: FeatureFlagContext) -> bool:
    """简化调用接口（龙虾代码中直接使用）"""
    return _cache.is_enabled(flag_name, ctx)

def ff_get_variant(flag_name: str, ctx: FeatureFlagContext) -> Variant:
    """获取变体（Prompt A/B 测试）"""
    return _cache.get_variant(flag_name, ctx)

# ============================================================
# 龙虾专用便捷函数
# ============================================================

def lobster_flag_ctx(tenant_id: str, lobster_id: str, env: str = "prod") -> FeatureFlagContext:
    """龙虾执行时创建 Flag 上下文"""
    return FeatureFlagContext(
        tenant_id=tenant_id,
        lobster_id=lobster_id,
        environment=Environment(env)
    )

# 紧急熔断检查（所有龙虾执行前必须调用）
def is_lobster_globally_enabled(ctx: FeatureFlagContext) -> bool:
    return ff_is_enabled("lobster.pool.all_enabled", ctx)

def is_lobster_enabled(lobster_name: str, ctx: FeatureFlagContext) -> bool:
    """检查指定龙虾是否启用"""
    return (
        is_lobster_globally_enabled(ctx) and
        ff_is_enabled(f"lobster.{lobster_name}.enabled", ctx)
    )
```

---

## 二、与 lobster_runner.py 集成

```python
# lobster_runner.py 修改：
from feature_flags import is_lobster_enabled, lobster_flag_ctx, ff_is_enabled

async def run_lobster(lobster_name: str, tenant_id: str, task: dict, ...):
    ctx = lobster_flag_ctx(tenant_id, lobster_name)
    
    # 紧急熔断检查（最先执行）
    if not is_lobster_enabled(lobster_name, ctx):
        logger.warning(f"Lobster {lobster_name} is disabled by feature flag")
        return {"status": "disabled", "reason": "feature_flag"}
    
    # 技能级别开关检查（可选）
    skill_name = task.get("skill")
    if skill_name and not ff_is_enabled(f"lobster.{lobster_name}.skill.{skill_name}", ctx):
        logger.info(f"Skill {skill_name} disabled, using fallback")
        task["skill"] = task.get("fallback_skill", skill_name)
    
    # 正常执行
    ...
```

---

## 三、后端 API

```
GET    /api/v1/feature-flags                    → 列出所有 flag（含状态）
POST   /api/v1/feature-flags                    → 创建新 flag
GET    /api/v1/feature-flags/{name}             → 获取 flag 详情
PUT    /api/v1/feature-flags/{name}             → 更新 flag（立即生效）
DELETE /api/v1/feature-flags/{name}             → 删除 flag（内置flag不可删除）
POST   /api/v1/feature-flags/{name}/enable      → 一键启用
POST   /api/v1/feature-flags/{name}/disable     → 一键禁用（熔断）
POST   /api/v1/feature-flags/{name}/strategies  → 更新策略（灰度配置）
POST   /api/v1/feature-flags/{name}/variants    → 更新变体（A/B配置）
POST   /api/v1/feature-flags/check              → 测试 flag 对指定上下文的结果（调试用）
GET    /api/v1/feature-flags/changelog          → 变更历史
POST   /api/v1/feature-flags/export             → 导出所有 flag 配置
POST   /api/v1/feature-flags/import             → 导入 flag 配置
```

**Webhook 订阅：**
- flag 变更时，通过 Redis Pub/Sub 通知所有服务实例
- 各实例收到通知后调用 `cache.invalidate(flag_name)`

---

## 四、内置 Feature Flags 初始化

系统启动时写入默认 flag（如不存在）：

```python
DEFAULT_FLAGS = [
    # 龙虾总开关（默认全部启用）
    {"name": "lobster.pool.all_enabled", "enabled": True, "description": "全局龙虾紧急熔断"},
    {"name": "lobster.commander.enabled", "enabled": True},
    {"name": "lobster.radar.enabled", "enabled": True},
    {"name": "lobster.strategist.enabled", "enabled": True},
    {"name": "lobster.inkwriter.enabled", "enabled": True},
    {"name": "lobster.visualizer.enabled", "enabled": True},
    {"name": "lobster.dispatcher.enabled", "enabled": True},
    {"name": "lobster.echoer.enabled", "enabled": True},
    {"name": "lobster.catcher.enabled", "enabled": True},
    {"name": "lobster.abacus.enabled", "enabled": True},
    {"name": "lobster.followup.enabled", "enabled": True},
]
```

---

## 五、TypeScript 类型文件

新建 `web/src/types/feature-flags.ts`：

```typescript
export type StrategyType = 'all' | 'gradualRollout' | 'tenantWhitelist' | 'lobsterWhitelist' | 'edgeNodeTag';
export type Environment = 'dev' | 'staging' | 'prod';

export interface FlagStrategy {
  type: StrategyType;
  parameters: Record<string, unknown>;
}

export interface FlagVariant {
  name: string;
  weight: number;  // 0-1000
  payload?: unknown;
  enabled: boolean;
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  environment: Environment;
  strategies: FlagStrategy[];
  variants: FlagVariant[];
  description?: string;
  tags: string[];
  tenant_id?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FlagCheckResult {
  flag_name: string;
  enabled: boolean;
  variant?: { name: string; payload?: unknown };
  matched_strategy?: FlagStrategy;
}
```

---

## 六、PROJECT_CONTROL_CENTER.md 同步更新

完成后：

1. **第三节"当前成熟能力"** 增加：
   ```
   ✅ feature_flags.py Feature Flag 系统（龙虾行为热开关 + 灰度发布 + A/B测试）
   ✅ FeatureFlagCache 本地缓存 SDK（< 1ms is_enabled()）
   ✅ GradualRolloutStrategy 渐进发布策略
   ✅ lobster_runner.py 集成 feature flag 熔断检查
   ```

2. **第四节"已完成 API"** 增加：
   ```
   ✅ GET/POST /api/v1/feature-flags
   ✅ PUT/DELETE /api/v1/feature-flags/{name}
   ✅ POST /api/v1/feature-flags/{name}/enable|disable|strategies|variants
   ```

3. **第七节"已落地借鉴清单"** 增加：
   ```
   | Unleash | Feature Flag 系统（龙虾行为热开关 + 灰度发布） | ✅ | feature_flags.py |
   ```

---

## 验收标准

- [ ] `feature_flags.py` 实现完整（FeatureFlag/FeatureFlagCache/StrategyEvaluator）
- [ ] `GradualRolloutStrategy` 按 tenant_id 哈希分桶，同一租户结果一致
- [ ] `is_lobster_enabled()` 正确检查全局熔断 + 龙虾个体开关
- [ ] `lobster_runner.py` 在执行前调用熔断检查
- [ ] 11只龙虾（含 commander）的内置 flag 在系统启动时自动初始化
- [ ] 后端 API 11个端点通过测试
- [ ] `web/src/types/feature-flags.ts` 类型文件存在
- [ ] `PROJECT_CONTROL_CENTER.md` 已更新

---

*Codex Task | 来源：UNLEASH_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
