# CODEX-PC-01: 龙虾 Prompt 资产库标准化

> **优先级**: P0 | **算力**: 中 | **来源**: `docs/PUACLAW_BORROWING_ANALYSIS.md`
> **依赖**: CODEX-AA-01 (SOUL.md 体系)、CODEX-OCM-01 (技能注册表)
> **关联但不重复**: CODEX-AA-02 管的是**输出格式模板**，本任务管的是**输入 Prompt 模板**
> **涉及文件**: `packages/lobsters/lobster-*/prompts/`、`dragon-senate-saas-v2/lobsters/base_lobster.py`、`dragon-senate-saas-v2/lobster_runner.py`、`dragon-senate-saas-v2/lobster_skill_registry.py`

---

## 背景

PUAClaw (puaclaw/PUAClaw, 2447⭐) 的核心资产是 96 篇标准化 Prompt 模板，每篇都遵循统一的 10 段式结构。虽然 PUAClaw 是娱乐项目，但其 **Prompt 资产标准化管理** 达到了极高水平。

我们的 46 个注册技能目前的 Prompt 散落在 Python 代码的字符串变量中，存在：
1. **不可发现** — Prompt 藏在代码里，非开发者无法查看和修改
2. **无版本管理** — Prompt 变更无追踪，A/B 测试无支撑
3. **无适用场景矩阵** — 同一个 Prompt 不知道适合哪些行业/渠道
4. **无变体管理** — 同一技能在不同场景下应该用不同措辞，但目前只有一版
5. **无风险评估** — 哪些 Prompt 容易触发平台审核、哪些容易引起用户反感，无记录

## 目标

为每只龙虾建立标准化的 **Prompt 资产库**，让 Prompt 成为可管理、可版本化、可 A/B 测试的第一等资产。

## 交付物

### 1. 目录结构

在 `packages/lobsters/lobster-{name}/` 下新增 `prompts/` 目录：

```
packages/lobsters/
├── lobster-inkwriter/
│   ├── role-card.json
│   ├── SOUL.md              ← CODEX-AA-01
│   ├── AGENTS.md             ← CODEX-AA-01
│   └── prompts/              ← 本任务新增
│       ├── prompt-catalog.json   # 模板索引（机器可读）
│       ├── xiaohongshu/          # 按平台分
│       │   ├── product-review.prompt.md
│       │   ├── lifestyle-share.prompt.md
│       │   └── hook-opening.prompt.md
│       ├── douyin/
│       │   ├── script-hook.prompt.md
│       │   └── comment-reply.prompt.md
│       ├── wechat/
│       │   ├── private-chat-opener.prompt.md
│       │   └── follow-up-warm.prompt.md
│       └── generic/              # 通用（不限平台）
│           ├── pain-point-mining.prompt.md
│           └── urgency-copy.prompt.md
├── lobster-echoer/
│   └── prompts/
│       ├── prompt-catalog.json
│       ├── positive-comment/
│       │   ├── gratitude-reply.prompt.md
│       │   └── lead-capture.prompt.md
│       ├── negative-comment/
│       │   ├── empathy-defuse.prompt.md
│       │   └── redirect-dm.prompt.md
│       └── dm-conversation/
│           ├── first-touch.prompt.md
│           ├── need-discovery.prompt.md
│           └── wechat-bridge.prompt.md
├── lobster-followup/
│   └── prompts/
│       ├── prompt-catalog.json
│       ├── reactivation/
│       │   ├── gentle-reminder.prompt.md
│       │   ├── value-add-share.prompt.md
│       │   └── urgency-last-chance.prompt.md
│       └── closing/
│           ├── trial-offer.prompt.md
│           └── objection-handling.prompt.md
... (每只龙虾类似)
```

### 2. 单个 Prompt 模板文件标准 (`.prompt.md`)

每个 `.prompt.md` 文件遵循以下 **8 段式结构**（借鉴 PUAClaw 10 段式，去掉不适用的 2 段）：

```markdown
# {技能名} — {场景名} 🦞🦞🦞

> **Prompt ID**: `inkwriter.xiaohongshu.product-review.v1`
> **版本**: v1.0 | **作者**: system | **最后验证**: 2026-03-31
> **绑定技能**: `inkwriter_copy_generate`
> **效力评级**: ⭐⭐⭐⭐ (4/5)

## 1. 摘要

一句话说明这个 Prompt 的用途和预期效果。

## 2. 规范化模板

\```
你是一位在小红书平台拥有 10 年经验的内容创作专家。

# 任务
为以下产品撰写一篇小红书笔记，要求：
- 标题使用"痛点+解决方案"句式，控制在 20 字以内
- 正文分 3-5 个段落，每段不超过 3 行
- 自然植入 {product_name} 的核心卖点：{selling_points}
- 使用 {tone} 的语调
- 配置 5-8 个标签（含行业热门标签和长尾标签）

# 输入变量
- product_name: {product_name}
- selling_points: {selling_points}
- tone: {tone}
- target_audience: {target_audience}

# 输出格式
## 标题
[标题]

## 正文
[正文]

## 标签
#标签1 #标签2 ...
\```

## 3. 变量说明

| 变量名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| product_name | string | ✅ | - | 产品名称 |
| selling_points | string[] | ✅ | - | 核心卖点列表 |
| tone | enum | ❌ | "亲和专业" | 语调：亲和专业/轻松有趣/严谨权威 |
| target_audience | string | ❌ | "25-35岁女性" | 目标受众画像 |

## 4. 适用场景矩阵

| 行业 | 适用度 | 说明 |
|------|--------|------|
| 美妆护肤 | ⭐⭐⭐⭐⭐ | 最佳场景，转化率最高 |
| 母婴用品 | ⭐⭐⭐⭐ | 适用，需调整语调为"妈妈感" |
| 3C 数码 | ⭐⭐⭐ | 适用，需加重参数对比 |
| B2B 企服 | ⭐⭐ | 不太适合，建议用专业报告体 |

## 5. 变体列表

| 变体 ID | 名称 | 差异点 | 适用场景 |
|---------|------|--------|---------|
| v1-casual | 闺蜜种草体 | 口语化、emoji多、"姐妹们" | 美妆/时尚 |
| v1-expert | 专家测评体 | 数据化、参数对比、"实测" | 3C/家电 |
| v1-story | 故事分享体 | 叙事+转折、"分享一个..." | 健康/教育 |

## 6. 风险与边界

| 风险点 | 级别 | 说明 | 规避方法 |
|--------|------|------|---------|
| 平台违禁词 | 🔴 高 | "最好""第一""治愈"等绝对化用词 | 接入违禁词检查技能 |
| 过度承诺 | 🟡 中 | 功效类描述需加"个人体验" | 模板内置免责提示 |
| 广告痕迹过重 | 🟡 中 | 品牌名出现 3 次以上触发审核 | 限制品牌名出现 ≤2 次 |

## 7. 效果基线

| 指标 | 基线值 | 说明 |
|------|--------|------|
| 首屏停留率 | >60% | 标题+首图组合效果 |
| 完读率 | >40% | 正文结构吸引力 |
| 互动率 | >5% | 评论+收藏+点赞/曝光 |
| 转化率 | >2% | 点击链接/私信/加微信 |

## 8. 版本历史

| 版本 | 日期 | 变更 | 效果变化 |
|------|------|------|---------|
| v1.0 | 2026-03-31 | 初始版本 | 基线 |
```

### 3. `prompt-catalog.json` 索引文件

每只龙虾的 `prompts/prompt-catalog.json`：

```json
{
  "lobster_id": "inkwriter",
  "version": "1.0.0",
  "total_prompts": 20,
  "categories": [
    {
      "category": "xiaohongshu",
      "prompts": [
        {
          "id": "inkwriter.xiaohongshu.product-review.v1",
          "file": "xiaohongshu/product-review.prompt.md",
          "skill_id": "inkwriter_copy_generate",
          "effectiveness_rating": 4,
          "industries": ["beauty", "mother-baby", "3c"],
          "variants": ["v1-casual", "v1-expert", "v1-story"]
        }
      ]
    }
  ]
}
```

### 4. Python 运行时 Prompt 加载器

在 `dragon-senate-saas-v2/` 新增 `prompt_asset_loader.py`：

```python
"""
PromptAssetLoader — 从 packages/lobsters/lobster-*/prompts/ 加载标准化 Prompt 模板
"""
import json
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from pathlib import Path


@dataclass
class PromptTemplate:
    id: str
    file_path: str
    skill_id: str
    effectiveness_rating: int  # 1-5
    industries: List[str] = field(default_factory=list)
    variants: List[str] = field(default_factory=list)
    raw_content: str = ""
    
    def extract_template_block(self) -> str:
        """从 .prompt.md 中提取 '## 2. 规范化模板' 代码块"""
        in_template = False
        in_code = False
        lines = []
        for line in self.raw_content.split("\n"):
            if "## 2." in line and "模板" in line:
                in_template = True
                continue
            if in_template and line.strip().startswith("```") and not in_code:
                in_code = True
                continue
            if in_template and in_code and line.strip().startswith("```"):
                break
            if in_code:
                lines.append(line)
        return "\n".join(lines)
    
    def fill(self, **kwargs) -> str:
        """用变量填充模板"""
        template = self.extract_template_block()
        for k, v in kwargs.items():
            if isinstance(v, list):
                v = ", ".join(str(i) for i in v)
            template = template.replace(f"{{{k}}}", str(v))
        return template


class PromptAssetLoader:
    """加载并管理龙虾 Prompt 资产"""
    
    def __init__(self, lobsters_root: str = "packages/lobsters"):
        self._root = Path(lobsters_root)
        self._cache: Dict[str, PromptTemplate] = {}
    
    def load_lobster_prompts(self, lobster_id: str) -> List[PromptTemplate]:
        """加载某只龙虾的所有 Prompt 模板"""
        catalog_path = self._root / f"lobster-{lobster_id}" / "prompts" / "prompt-catalog.json"
        if not catalog_path.exists():
            return []
        
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog = json.load(f)
        
        templates = []
        prompts_dir = catalog_path.parent
        for category in catalog.get("categories", []):
            for p in category.get("prompts", []):
                file_path = prompts_dir / p["file"]
                raw = ""
                if file_path.exists():
                    raw = file_path.read_text(encoding="utf-8")
                
                tpl = PromptTemplate(
                    id=p["id"],
                    file_path=str(file_path),
                    skill_id=p.get("skill_id", ""),
                    effectiveness_rating=p.get("effectiveness_rating", 3),
                    industries=p.get("industries", []),
                    variants=p.get("variants", []),
                    raw_content=raw,
                )
                templates.append(tpl)
                self._cache[tpl.id] = tpl
        
        return templates
    
    def get_prompt(self, prompt_id: str) -> Optional[PromptTemplate]:
        """获取单个 Prompt 模板"""
        return self._cache.get(prompt_id)
    
    def get_by_skill(self, skill_id: str) -> List[PromptTemplate]:
        """按技能 ID 筛选"""
        return [t for t in self._cache.values() if t.skill_id == skill_id]
    
    def get_by_industry(self, industry: str) -> List[PromptTemplate]:
        """按行业筛选"""
        return [t for t in self._cache.values() if industry in t.industries]
    
    def get_best_for(self, skill_id: str, industry: Optional[str] = None) -> Optional[PromptTemplate]:
        """获取某技能+行业下效力评级最高的模板"""
        candidates = self.get_by_skill(skill_id)
        if industry:
            candidates = [t for t in candidates if industry in t.industries] or candidates
        if not candidates:
            return None
        return max(candidates, key=lambda t: t.effectiveness_rating)


# 全局实例
_loader: Optional[PromptAssetLoader] = None

def get_prompt_loader() -> PromptAssetLoader:
    global _loader
    if _loader is None:
        _loader = PromptAssetLoader()
    return _loader
```

### 5. 与 `lobster_runner.py` 的集成点

在 `lobster_runner.py` 的任务执行前，增加 Prompt 资产查找逻辑：

```python
# 在 run_lobster_step() 中
loader = get_prompt_loader()
best_prompt = loader.get_best_for(
    skill_id=current_skill_id,
    industry=state.get("industry_context", {}).get("industry")
)
if best_prompt:
    # 用标准化模板替代硬编码 Prompt
    filled = best_prompt.fill(**task_input)
    # 传入 LLM 调用
```

### 6. 前端对齐

前端工程师需要在以下位置展示 Prompt 资产：

#### 技能详情页
```typescript
// GET /api/skills/{skill_id} 返回值新增 prompt_templates 字段
interface SkillDetail {
  // ...existing fields...
  prompt_templates: {
    id: string;
    file: string;
    effectiveness_rating: number;  // 1-5 星
    industries: string[];
    variants: string[];
  }[];
}
```

#### 策略配置页
- 用户在配置行业时，自动筛选该行业下效力评级最高的 Prompt
- 支持预览 Prompt 模板内容
- 支持选择变体

#### Prompt 管理页（新页面，可后做）
- 路径建议：`/operations/autopilot/prompts`
- 展示所有龙虾的 Prompt 资产
- 支持按龙虾/行业/评级筛选
- 支持在线编辑和版本对比

## 初始交付范围

**第一批只做 3 只最需要 Prompt 资产的龙虾**：

| 龙虾 | 最低 Prompt 数 | 覆盖平台 | 覆盖场景 |
|------|---------------|---------|---------|
| 吐墨虾 inkwriter | 20 | 小红书×5, 抖音×5, 微信×5, 通用×5 | 产品种草/痛点挖掘/限时促销/故事分享 |
| 回声虾 echoer | 15 | 评论回复×5, 私信×5, 引流×5 | 正面互动/负面安抚/意向挖掘/微信引导 |
| 回访虾 followup | 10 | 跟进×5, 成交×5 | 温柔提醒/价值分享/紧迫收尾/异议处理 |

其他 6 只龙虾的 Prompt 资产后续迭代补充。

## 约束

- `.prompt.md` 文件存放在 TS Design-Time 侧（`packages/lobsters/`），遵循"TS = 设计时真相源"原则
- Python 运行时通过 `PromptAssetLoader` 读取，不硬编码
- Prompt 模板中的变量使用 `{variable_name}` 格式，与已有 Python f-string 兼容
- 效力评级初始值由人工设定，后续接入 `lobster_pool_manager.py` 的 step reward 自动校准
- 不删除现有硬编码 Prompt，而是标记 deprecated 并优先使用资产库中的模板

## 验收标准

1. `packages/lobsters/lobster-inkwriter/prompts/` 包含 ≥20 个 `.prompt.md` 文件 + 1 个 `prompt-catalog.json`
2. `packages/lobsters/lobster-echoer/prompts/` 包含 ≥15 个 `.prompt.md` 文件
3. `packages/lobsters/lobster-followup/prompts/` 包含 ≥10 个 `.prompt.md` 文件
4. 每个 `.prompt.md` 文件包含完整的 8 段式结构
5. `prompt_asset_loader.py` 能正确加载并解析所有模板
6. `get_best_for(skill_id, industry)` 返回正确的最佳模板
7. API 端点返回 `prompt_templates` 字段
