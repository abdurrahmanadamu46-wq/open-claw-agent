# CODEX TASK: 龙虾职业化 meta_prompt 体系

**来源借鉴**: ClawWork eval/meta_prompts/*.json (44个职业) + clawmode_integration/task_classifier.py  
**优先级**: 🔴 高  
**预计工时**: 3-4h  
**产出目录**: `dragon-senate-saas-v2/profession_meta/`  
**产出文件**: `dragon-senate-saas-v2/task_classifier.py`

---

## 任务背景

ClawWork 有 44 个职业的 meta_prompt JSON，每个 JSON 定义了该职业的工作范围、常见任务类型和质量标准。

我们的龙虾目前只有角色 system prompt（如"你是墨小雅，一个文案达人"），**缺少"当前任务属于哪个职业领域"的上下文注入**。当龙虾执行"分析财务数据"时，它不知道自己应该用财务分析师的专业标准来工作。

---

## 目标

1. 建立 10 个核心职业的 meta_prompt 库（从 ClawWork 44个中选取最相关的）
2. 实现 `task_classifier.py`：给定任务描述，自动选择最匹配的职业 meta_prompt
3. 在 `lobster_runner.py` 中，任务开始前自动注入职业 meta_prompt

---

## 龙虾-职业映射关系

| 龙虾 | 主职业 | 副职业 | ClawWork 对应 |
|------|--------|--------|--------------|
| inkwriter（墨小雅） | 内容创作者 | 新闻记者 | Editors, News_Analysts_Reporters |
| visualizer（影子） | 视觉设计师 | 影视制作 | Film_and_Video_Editors, Producers_and_Directors |
| strategist（苏思） | 战略顾问 | 项目经理 | General_and_Operations_Managers, Project_Management_Specialists |
| abacus（算无遗策） | 财务分析师 | 数据科学家 | Financial_and_Investment_Analysts, Financial_Managers |
| radar（林涛） | 市场研究员 | 销售经理 | Sales_Managers, First-Line_Supervisors_of_Retail_Sales |
| dispatcher（老建） | 运营经理 | 行政主管 | Administrative_Services_Managers, General_and_Operations_Managers |
| echoer（阿声） | 商务助理 | 客服代表 | Customer_Service_Representatives, Order_Clerks |
| catcher（铁狗） | 内容采集员 | 研究员 | Private_Detectives_and_Investigators |
| followup（小催） | 客户关系 | 销售代表 | Sales_Representatives_Wholesale_and_Manufacturing |
| commander（陈指） | 总经理 | 项目督导 | General_and_Operations_Managers, Computer_and_Information_Systems_Managers |

---

## 实现规格

### 职业 meta_prompt 格式

```json
// dragon-senate-saas-v2/profession_meta/content_creator.json
{
  "profession_id": "content_creator",
  "profession_name": "内容创作者 / Content Creator",
  "clawwork_refs": ["Editors", "News_Analysts_Reporters_and_Journalists"],
  
  "role_definition": "你是一名专业的内容创作者，擅长将复杂信息转化为引人入胜的内容。你的工作涵盖撰写文章、脚本、文案、社交媒体内容等多种形式。",
  
  "core_competencies": [
    "受众分析与内容定位",
    "多格式内容撰写（长文/短文/脚本/文案）",
    "SEO 和平台算法理解",
    "品牌声音一致性维护",
    "内容数据分析与优化"
  ],
  
  "common_task_types": [
    "短视频脚本撰写",
    "公众号/博客文章",
    "社交媒体文案",
    "产品描述文案",
    "新闻稿/公告",
    "电子邮件营销",
    "活动策划方案"
  ],
  
  "quality_standards": {
    "accuracy": "信息准确，无事实错误",
    "completeness": "内容完整，覆盖任务要求的所有要点",
    "professionalism": "语言专业，符合行业规范",
    "format": "格式清晰，结构合理，易于阅读",
    "practicality": "产出物可直接使用，无需大幅修改"
  },
  
  "work_standards": [
    "每份内容必须有明确的目标受众定义",
    "标题/钩子必须在前5秒抓住注意力",
    "CTA（行动号召）必须清晰具体",
    "内容长度符合平台最优区间",
    "图文/视频比例建议符合平台算法"
  ],
  
  "evaluation_dimensions": {
    "creativity": {"weight": 0.25, "description": "创意性和原创性"},
    "engagement": {"weight": 0.30, "description": "内容吸引力和传播潜力"},
    "brand_fit": {"weight": 0.20, "description": "品牌调性匹配度"},
    "cta_effectiveness": {"weight": 0.15, "description": "CTA 有效性"},
    "format_quality": {"weight": 0.10, "description": "格式规范程度"}
  }
}
```

### 需要创建的 10 个 meta_prompt 文件

```
dragon-senate-saas-v2/profession_meta/
├── content_creator.json        # inkwriter
├── visual_designer.json        # visualizer
├── strategy_consultant.json    # strategist
├── financial_analyst.json      # abacus
├── market_researcher.json      # radar
├── operations_manager.json     # dispatcher
├── business_assistant.json     # echoer
├── content_hunter.json         # catcher
├── customer_relations.json     # followup
└── executive_director.json     # commander
```

每个文件参考上述格式，内容从 ClawWork 对应的职业 JSON 中提取并中文化。

---

### task_classifier.py

```python
# dragon-senate-saas-v2/task_classifier.py

import json
from pathlib import Path
from typing import Optional

PROFESSION_META_DIR = Path("dragon-senate-saas-v2/profession_meta")

# 龙虾 → 默认职业映射
LOBSTER_DEFAULT_PROFESSION = {
    "inkwriter": "content_creator",
    "visualizer": "visual_designer",
    "strategist": "strategy_consultant",
    "abacus": "financial_analyst",
    "radar": "market_researcher",
    "dispatcher": "operations_manager",
    "echoer": "business_assistant",
    "catcher": "content_hunter",
    "followup": "customer_relations",
    "commander": "executive_director",
}

# 任务关键词 → 职业快速映射（无需 LLM 的本地分类）
KEYWORD_PROFESSION_MAP = {
    "financial_analyst": ["财务", "财报", "ROI", "利润", "资产负债", "现金流", "估值", "投资分析"],
    "content_creator": ["文案", "脚本", "文章", "内容", "博客", "推文", "朋友圈"],
    "visual_designer": ["视觉", "设计", "图片", "海报", "封面", "视频", "剪辑"],
    "strategy_consultant": ["战略", "规划", "方案", "框架", "分析报告", "决策"],
    "market_researcher": ["市场", "竞品", "用户调研", "数据分析", "趋势"],
    "operations_manager": ["运营", "排期", "流程", "协调", "项目管理"],
    "customer_relations": ["客户", "跟进", "回访", "售后", "关系维护"],
}


def classify_task_local(task_description: str) -> str:
    """
    本地关键词快速分类（无 LLM 调用，延迟<10ms）。
    返回 profession_id。
    """
    task_lower = task_description.lower()
    scores = {}
    for profession, keywords in KEYWORD_PROFESSION_MAP.items():
        score = sum(1 for kw in keywords if kw in task_lower)
        if score > 0:
            scores[profession] = score
    
    if scores:
        return max(scores, key=scores.get)
    return "business_assistant"  # 默认兜底


async def classify_task_llm(
    task_description: str,
    available_professions: list[str] = None,
) -> str:
    """
    LLM 精准分类（用于本地分类结果不确定时）。
    """
    if available_professions is None:
        available_professions = list(LOBSTER_DEFAULT_PROFESSION.values())
    
    prompt = f"""
请判断以下任务最适合由哪个职业角色来执行。

任务描述：{task_description}

可选职业：{', '.join(available_professions)}

只返回职业 ID，不要任何解释。
"""
    # 调用 LLM（使用最便宜的模型即可）
    from dragon_senate_saas_v2.provider_registry import call_llm
    result = await call_llm(prompt, model="gpt-4o-mini", max_tokens=20)
    profession = result.strip().lower()
    
    if profession in available_professions:
        return profession
    return "business_assistant"


def load_profession_meta(profession_id: str) -> dict | None:
    """加载职业 meta_prompt JSON"""
    path = PROFESSION_META_DIR / f"{profession_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def get_profession_for_lobster(
    lobster_id: str,
    task_description: str = "",
) -> tuple[str, dict]:
    """
    为龙虾获取职业 meta_prompt。
    
    策略：
    1. 先用本地关键词快速分类
    2. 如果与龙虾默认职业差异大，保留龙虾默认（避免跨界）
    3. 返回 (profession_id, meta_prompt_dict)
    """
    default_profession = LOBSTER_DEFAULT_PROFESSION.get(lobster_id, "business_assistant")
    
    if task_description:
        detected = classify_task_local(task_description)
        # 只在任务类型与龙虾主业相符时使用检测结果
        # 例如：inkwriter 不应该被判定为 financial_analyst
        if detected != default_profession:
            # 保持龙虾本职，但可以用任务关键词补充背景
            profession_id = default_profession
        else:
            profession_id = detected
    else:
        profession_id = default_profession
    
    meta = load_profession_meta(profession_id)
    return profession_id, meta or {}


def build_profession_context(meta: dict) -> str:
    """
    将 meta_prompt 转化为可注入龙虾 system prompt 的字符串。
    """
    if not meta:
        return ""
    
    lines = [
        f"## 当前任务职业背景：{meta.get('profession_name', '')}",
        "",
        meta.get("role_definition", ""),
        "",
        "**核心能力要求**：",
        *[f"- {c}" for c in meta.get("core_competencies", [])],
        "",
        "**工作标准**：",
        *[f"- {s}" for s in meta.get("work_standards", [])],
    ]
    return "\n".join(lines)
```

### 集成到 lobster_runner.py

```python
# lobster_runner.py 中，在龙虾接到任务时
from dragon_senate_saas_v2.task_classifier import get_profession_for_lobster, build_profession_context

async def run_lobster_task(lobster_id: str, task: dict):
    task_description = task.get("description", "")
    
    # 获取职业背景
    profession_id, profession_meta = get_profession_for_lobster(lobster_id, task_description)
    profession_context = build_profession_context(profession_meta)
    
    # 注入到龙虾 system prompt
    enhanced_system_prompt = f"""
{original_system_prompt}

{profession_context}
"""
    # 用增强后的 prompt 运行龙虾...
```

---

## 验收标准

- [ ] 10 个 profession_meta JSON 文件全部创建（内容完整，含 evaluation_dimensions）
- [ ] `classify_task_local` 关键词分类准确率 >80%（用10个测试用例验证）
- [ ] `get_profession_for_lobster` 正确为每只龙虾选择职业背景
- [ ] `build_profession_context` 生成的字符串格式清晰，可直接插入 system prompt
- [ ] lobster_runner 集成后，龙虾执行任务时能看到职业背景上下文
- [ ] 不跨界（inkwriter 不会被注入财务分析师背景）
