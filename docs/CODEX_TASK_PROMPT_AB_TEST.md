# CODEX TASK: Prompt A/B 测试框架 — 基于 Feature Flag Variant 的灰度升级

**优先级：P1**  
**来源借鉴：Unleash Variants（多变体 A/B 测试）+ GradualRollout**  
**参考分析：`docs/UNLEASH_BORROWING_ANALYSIS.md` 第二节 2.2、第五节**

---

## 背景

当前 Prompt 升级策略：直接修改 `prompt_registry.py` → 部署 → 全量生效。

这极其危险：新 Prompt 效果未经验证就全量替换，出问题只能紧急回滚（再次部署）。

借鉴 Unleash Variants 的灰度实验设计，实现 Prompt A/B 测试：新 Prompt 先对 10% 租户生效，观察 `llm_quality_judge` 评分后再决定是否全量放量。

---

## 任务目标

在 `prompt_registry.py` 基础上，集成 Feature Flag Variant 实现 Prompt A/B 测试：
1. 支持同一 Prompt 同时存在 A/B 两个版本
2. 按租户哈希分流（10%→50%→100%）
3. 自动收集实验指标（`llm_quality_judge` 评分对比）
4. 前端展示实验报告

---

## 一、升级 `dragon-senate-saas-v2/prompt_registry.py`

```python
# prompt_registry.py 新增 A/B 测试支持

from feature_flags import ff_get_variant, FeatureFlagContext, Variant

class PromptRegistry:
    """
    Prompt 注册表（A/B 测试版）
    
    新增方法：
      get_prompt_with_ab(lobster, skill, ctx) → (prompt_text, variant_name)
    """
    
    def get_prompt_with_ab(
        self,
        lobster_name: str,
        skill_name: str,
        ctx: FeatureFlagContext
    ) -> tuple[str, str]:
        """
        获取 Prompt（支持 A/B 测试）
        
        返回：(prompt_text, variant_name)
        variant_name 用于后续记录 llm_quality_judge 评分时区分版本
        
        工作流程：
          1. 检查是否有对应的 A/B 测试 flag
             flag_name = f"prompt.{lobster_name}.{skill_name}.experiment"
          2. 如果有 → 获取变体（get_variant）
             变体 payload = prompt 版本号或 prompt 文本
          3. 加载对应版本的 prompt
          4. 如果无 A/B flag → 使用当前默认 prompt（兼容现有逻辑）
        
        示例：
          flag: "prompt.inkwriter.voiceover.experiment"
          variants:
            - name: "v1", weight: 900, payload: "inkwriter_voiceover_v1"
            - name: "v2", weight: 100, payload: "inkwriter_voiceover_v2"
          
          → 10% 租户使用 v2，90% 继续使用 v1
        """
        flag_name = f"prompt.{lobster_name}.{skill_name}.experiment"
        variant: Variant = ff_get_variant(flag_name, ctx)
        
        if variant.enabled and variant.name != "control":
            # A/B 测试中：加载指定变体的 prompt
            prompt_version = variant.payload or variant.name
            prompt_text = self._load_prompt_version(lobster_name, skill_name, prompt_version)
            return prompt_text, variant.name
        else:
            # 控制组：使用当前默认 prompt
            prompt_text = self.get_prompt(lobster_name, skill_name)
            return prompt_text, "control"
    
    def _load_prompt_version(self, lobster: str, skill: str, version: str) -> str:
        """
        加载指定版本的 prompt
        路径：dragon-senate-saas-v2/prompts/{lobster}/{skill}_{version}.md
        """
        from pathlib import Path
        prompt_path = Path(f"prompts/{lobster}/{skill}_{version}.md")
        if prompt_path.exists():
            return prompt_path.read_text(encoding='utf-8')
        else:
            # 降级：使用默认 prompt
            return self.get_prompt(lobster, skill)
```

---

## 二、Prompt 目录结构升级

```
dragon-senate-saas-v2/prompts/
├── inkwriter/
│   ├── voiceover_v1.md    ← 当前版本（控制组）
│   ├── voiceover_v2.md    ← 实验版本（实验组）
│   └── voiceover.md       ← 软链接/别名 → 指向当前稳定版
├── radar/
│   ├── monitor_v1.md
│   └── monitor_v2.md      ← 新竞品分析 Prompt（待实验）
└── ...

版本命名规则：
  {skill}_{version}.md
  version = "v1" | "v2" | "v3" | ...
  当前生产使用的版本通过 feature flag 控制，不再依赖文件名
```

---

## 三、实验指标收集

在 `llm_call_logger.py` 或 `llm_quality_judge.py` 中记录变体信息：

```python
# llm_call_logger.py 修改：

class LLMCallLogger:
    async def log_call(
        self,
        lobster: str,
        skill: str,
        prompt_text: str,
        response: str,
        quality_score: float,
        variant_name: str = "control",  # 新增：记录 A/B 变体
        tenant_id: str = "",
        ...
    ):
        # 记录时带上 variant_name
        # 这样可以按 variant 分组统计 quality_score
        ...

# 新增：实验统计查询
async def get_experiment_report(
    flag_name: str,
    from_date: str,
    to_date: str
) -> dict:
    """
    返回 A/B 实验报告：
    {
      "flag_name": "prompt.inkwriter.voiceover.experiment",
      "period": {"from": "...", "to": "..."},
      "variants": {
        "v1": {"count": 9000, "avg_quality": 7.2, "p95_latency_ms": 1200},
        "v2": {"count": 1000, "avg_quality": 7.8, "p95_latency_ms": 1100},
        "control": {"count": 0, ...}
      },
      "winner": "v2",  # 评分更高的变体
      "confidence": 0.95  # 统计显著性
    }
    """
```

---

## 四、后端 API

```
# 实验管理
GET    /api/v1/prompt-experiments                          → 所有 Prompt A/B 实验列表
POST   /api/v1/prompt-experiments                          → 创建新实验（创建 flag + variants）
GET    /api/v1/prompt-experiments/{flag_name}/report       → 获取实验报告
POST   /api/v1/prompt-experiments/{flag_name}/promote      → 将胜出变体升级为默认版本
POST   /api/v1/prompt-experiments/{flag_name}/stop         → 停止实验（关闭 flag）

# 实验促进（一键升级）：
POST /api/v1/prompt-experiments/{flag_name}/promote
  body: { winner_variant: "v2" }
  动作：
    1. 将 v2 的 prompt 文件复制/重命名为稳定版
    2. 更新 flag 为 100% rollout（全量）
    3. 记录升级事件到 audit log（LOBSTER_CONFIG_UPDATE）
    4. （可选）旧版本归档
```

---

## 五、前端：实验报告页

```
/operations/experiments   ← 新建
  
  页面内容：
  ├── 实验列表（对应哪个龙虾/技能，当前 rollout%，运行时长）
  ├── 新建实验（选择龙虾 + 技能 + 上传新 prompt + 设置 rollout%）
  └── 实验详情
      ├── 变体对比表格（count/avg_quality/avg_latency）
      ├── 质量评分折线图（按天）
      ├── [升级为默认] 按钮（胜出变体 → 全量发布）
      └── [停止实验] 按钮
```

**TypeScript 类型文件** — 新建 `web/src/types/prompt-experiment.ts`：

```typescript
export interface PromptExperiment {
  flag_name: string;           // "prompt.inkwriter.voiceover.experiment"
  lobster_name: string;
  skill_name: string;
  rollout_percent: number;     // 当前实验组占比
  status: 'running' | 'stopped' | 'promoted';
  started_at: string;
  variants: ExperimentVariant[];
}

export interface ExperimentVariant {
  name: string;                // "v1" | "v2" | "control"
  weight: number;              // 0-1000
  count: number;               // 执行次数
  avg_quality_score: number;   // 平均质量评分（llm_quality_judge）
  avg_latency_ms: number;      // 平均延迟
  is_winner: boolean;
}

export interface ExperimentReport {
  flag_name: string;
  period: { from: string; to: string };
  variants: Record<string, ExperimentVariant>;
  winner?: string;
  confidence?: number;
}
```

---

## 六、Prompt 升级标准流程（SOP）

```
1. 运营/开发 撰写新版 Prompt → 保存到 prompts/{lobster}/{skill}_v2.md
2. 在 /operations/experiments 创建实验
   - 设置实验组 10%（stickiness=tenant_id）
   - 对照组 90% 继续使用 v1
3. 运行 7天 → 观察实验报告
   - avg_quality_score(v2) > avg_quality_score(v1) + 0.3 → 显著改善
   - avg_latency_ms(v2) <= avg_latency_ms(v1) × 1.2 → 延迟可接受
4. 点击 [升级为默认] → v2 全量发布
5. 实验关闭 → v1 文件归档 → 代码清理
```

---

## 七、⚠️ 依赖

此任务依赖 `CODEX_TASK_FEATURE_FLAGS.md` 中的 `feature_flags.py` 已完成（使用其 `ff_get_variant()` 接口）。

---

## 八、验收标准

- [ ] `prompt_registry.py` 新增 `get_prompt_with_ab()` 方法
- [ ] 龙虾 Prompt 目录支持版本文件（`{skill}_v1.md`, `{skill}_v2.md`）
- [ ] `llm_call_logger.py` 记录 `variant_name` 字段
- [ ] `get_experiment_report()` 返回完整对比数据
- [ ] 后端 5个 API 端点通过测试
- [ ] 前端 `/operations/experiments` 页面可用（实验列表 + 报告 + 升级按钮）
- [ ] `web/src/types/prompt-experiment.ts` 类型文件存在
- [ ] `PROJECT_CONTROL_CENTER.md` 已更新

---

*Codex Task | 来源：UNLEASH_BORROWING_ANALYSIS.md P1-#3 | 2026-04-02*
