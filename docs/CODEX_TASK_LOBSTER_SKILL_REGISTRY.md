# CODEX-OCM-01: LobsterSkillRegistry — 龙虾技能注册系统

> ⚠️ **增强提示**: 本任务落地后，需由 **CODEX-HC-03** (`docs/CODEX_TASK_HICLAW_REMAINING.md`) 增强：
> 为每个技能创建 Skill 目录（SKILL.md + Gotchas 陷阱清单 + references/ 按需加载 + scripts/ 可执行脚本）。
> `LobsterSkill` dataclass 新增 `gotchas` / `references` / `scripts` / `skill_dir` 字段。

> **优先级**: P0 | **算力**: 中 | **来源**: OpenClaw Manager 借鉴分析
> **分析文档**: `docs/OPENCLAW_MANAGER_BORROWING_ANALYSIS.md`

---

## 背景

OpenClaw Manager (`miaoxworld/openclaw-manager`, 1481⭐) 有一个成熟的 Skills 插件系统，支持技能的注册/发现/安装/配置/启用/禁用。每个技能有 `config_fields` 定义的可视化配置表单。

当前龙虾系统中，技能绑定是硬编码的 `SKILL_BINDINGS` 字典，无法运行时配置、无法动态扩展、前端无法展示。

## 目标

创建 `LobsterSkillRegistry` 模块，让龙虾的技能变成可插拔、可配置、可发现的插件。

## 交付物

### 1. `dragon-senate-saas-v2/lobster_skill_registry.py`

```python
"""
LobsterSkillRegistry — 龙虾技能注册系统

借鉴 openclaw-manager 的 SkillDefinition 模型，为龙虾创建可插拔技能注册表。
"""
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
from enum import Enum


class SkillFieldType(str, Enum):
    TEXT = "text"
    PASSWORD = "password"
    SELECT = "select"
    TOGGLE = "toggle"
    NUMBER = "number"
    TEXTAREA = "textarea"


class SkillSource(str, Enum):
    BUILTIN = "builtin"      # 龙虾核心内置技能
    OFFICIAL = "official"    # 官方扩展技能
    COMMUNITY = "community"  # 社区贡献技能
    CUSTOM = "custom"        # 用户自定义技能


@dataclass
class SkillSelectOption:
    value: str
    label: str


@dataclass
class SkillConfigField:
    """技能配置字段定义，驱动前端动态表单生成"""
    key: str
    label: str
    field_type: SkillFieldType = SkillFieldType.TEXT
    required: bool = False
    default_value: Optional[str] = None
    placeholder: Optional[str] = None
    help_text: Optional[str] = None
    options: Optional[List[SkillSelectOption]] = None  # 仅 SELECT 类型使用


@dataclass
class LobsterSkill:
    """龙虾技能定义"""
    id: str                                    # 唯一标识，如 "radar_web_search"
    name: str                                  # 显示名称
    description: str                           # 技能描述
    icon: str = "🔧"                           # Emoji 图标
    source: SkillSource = SkillSource.BUILTIN  # 来源
    version: Optional[str] = None              # 版本号
    author: Optional[str] = None               # 作者
    category: Optional[str] = None             # 分类
    docs_url: Optional[str] = None             # 文档链接
    
    # 绑定的龙虾 ID 列表（空 = 所有龙虾可用）
    bound_lobsters: List[str] = field(default_factory=list)
    
    # 配置
    enabled: bool = True
    config_fields: List[SkillConfigField] = field(default_factory=list)
    config_values: Dict[str, Any] = field(default_factory=dict)
    
    # 执行函数（运行时注入）
    execute_fn: Optional[Callable] = None
    
    def to_api_dict(self) -> Dict[str, Any]:
        """转换为 API 返回格式（不含 execute_fn）"""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "icon": self.icon,
            "source": self.source.value,
            "version": self.version,
            "author": self.author,
            "category": self.category,
            "docs_url": self.docs_url,
            "bound_lobsters": self.bound_lobsters,
            "enabled": self.enabled,
            "config_fields": [
                {
                    "key": f.key,
                    "label": f.label,
                    "field_type": f.field_type.value,
                    "required": f.required,
                    "default_value": f.default_value,
                    "placeholder": f.placeholder,
                    "help_text": f.help_text,
                    "options": [{"value": o.value, "label": o.label} for o in (f.options or [])],
                }
                for f in self.config_fields
            ],
            "config_values": {k: v for k, v in self.config_values.items() if k not in ("api_key", "secret", "token")},
        }


class LobsterSkillRegistry:
    """龙虾技能注册表 — 单例"""
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._skills: Dict[str, LobsterSkill] = {}
        return cls._instance
    
    def register(self, skill: LobsterSkill) -> None:
        """注册一个技能"""
        self._skills[skill.id] = skill
    
    def unregister(self, skill_id: str) -> bool:
        """注销一个技能"""
        return self._skills.pop(skill_id, None) is not None
    
    def get(self, skill_id: str) -> Optional[LobsterSkill]:
        """获取单个技能"""
        return self._skills.get(skill_id)
    
    def get_all(self) -> List[LobsterSkill]:
        """获取所有技能"""
        return list(self._skills.values())
    
    def get_by_lobster(self, lobster_id: str) -> List[LobsterSkill]:
        """获取某只龙虾可用的所有技能"""
        return [
            s for s in self._skills.values()
            if s.enabled and (not s.bound_lobsters or lobster_id in s.bound_lobsters)
        ]
    
    def get_by_source(self, source: SkillSource) -> List[LobsterSkill]:
        """按来源筛选"""
        return [s for s in self._skills.values() if s.source == source]
    
    def get_by_category(self, category: str) -> List[LobsterSkill]:
        """按分类筛选"""
        return [s for s in self._skills.values() if s.category == category]
    
    def configure(self, skill_id: str, config: Dict[str, Any]) -> bool:
        """更新技能配置"""
        skill = self._skills.get(skill_id)
        if not skill:
            return False
        skill.config_values.update(config)
        return True
    
    def enable(self, skill_id: str) -> bool:
        """启用技能"""
        skill = self._skills.get(skill_id)
        if not skill:
            return False
        skill.enabled = True
        return True
    
    def disable(self, skill_id: str) -> bool:
        """禁用技能"""
        skill = self._skills.get(skill_id)
        if not skill:
            return False
        skill.enabled = False
        return True
    
    def search(self, query: str) -> List[LobsterSkill]:
        """搜索技能"""
        q = query.lower()
        return [
            s for s in self._skills.values()
            if q in s.name.lower() or q in s.description.lower() or q in s.id.lower()
        ]
    
    def to_api_list(self, lobster_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """转换为 API 列表格式"""
        skills = self.get_by_lobster(lobster_id) if lobster_id else self.get_all()
        return [s.to_api_dict() for s in skills]


# ============ 内置技能种子注册 ============

def register_builtin_skills(registry: LobsterSkillRegistry):
    """注册所有内置龙虾技能"""
    
    # --- 触须虾技能 ---
    registry.register(LobsterSkill(
        id="radar_web_search",
        name="全网信号搜索",
        description="搜索全网信息，收集行业信号和竞品动态",
        icon="🔍",
        source=SkillSource.BUILTIN,
        category="信号采集",
        bound_lobsters=["radar"],
        config_fields=[
            SkillConfigField(key="search_depth", label="搜索深度", field_type=SkillFieldType.SELECT,
                           options=[SkillSelectOption("shallow", "浅层"), SkillSelectOption("deep", "深层")],
                           default_value="shallow"),
            SkillConfigField(key="max_results", label="最大结果数", field_type=SkillFieldType.NUMBER,
                           default_value="20", placeholder="10-100"),
        ],
    ))
    
    registry.register(LobsterSkill(
        id="radar_trend_analysis",
        name="趋势归纳分析",
        description="从信号中提取趋势、噪音过滤、模式识别",
        icon="📈",
        source=SkillSource.BUILTIN,
        category="信号采集",
        bound_lobsters=["radar"],
    ))
    
    # --- 脑虫虾技能 ---
    registry.register(LobsterSkill(
        id="strategist_goal_decompose",
        name="目标拆解",
        description="将业务目标拆解为可执行的子策略路径",
        icon="🎯",
        source=SkillSource.BUILTIN,
        category="策略规划",
        bound_lobsters=["strategist"],
    ))
    
    # --- 吐墨虾技能 ---
    registry.register(LobsterSkill(
        id="inkwriter_copy_generate",
        name="成交文案生成",
        description="生成行业口吻的成交导向文案",
        icon="✍️",
        source=SkillSource.BUILTIN,
        category="内容生产",
        bound_lobsters=["inkwriter"],
        config_fields=[
            SkillConfigField(key="tone", label="文案风格", field_type=SkillFieldType.SELECT,
                           options=[
                               SkillSelectOption("professional", "专业严谨"),
                               SkillSelectOption("casual", "轻松亲和"),
                               SkillSelectOption("urgent", "紧迫促销"),
                           ],
                           default_value="professional"),
            SkillConfigField(key="max_length", label="最大字数", field_type=SkillFieldType.NUMBER,
                           default_value="500"),
        ],
    ))
    
    # --- 回声虾技能 ---
    registry.register(LobsterSkill(
        id="echoer_reply_generate",
        name="真人感互动回复",
        description="生成真人感回复，情绪承接，互动转化",
        icon="💬",
        source=SkillSource.BUILTIN,
        category="互动",
        bound_lobsters=["echoer"],
        config_fields=[
            SkillConfigField(key="personality", label="回复人设", field_type=SkillFieldType.TEXTAREA,
                           placeholder="描述回复的人设风格..."),
            SkillConfigField(key="emoji_level", label="Emoji 使用程度", field_type=SkillFieldType.SELECT,
                           options=[
                               SkillSelectOption("none", "不使用"),
                               SkillSelectOption("moderate", "适度"),
                               SkillSelectOption("heavy", "大量"),
                           ],
                           default_value="moderate"),
        ],
    ))
    
    # --- 铁网虾技能 ---
    registry.register(LobsterSkill(
        id="catcher_lead_score",
        name="高意向线索识别",
        description="从互动中识别高意向线索，风险过滤，预算判断",
        icon="🎣",
        source=SkillSource.BUILTIN,
        category="线索管理",
        bound_lobsters=["catcher"],
        config_fields=[
            SkillConfigField(key="score_threshold", label="评分阈值", field_type=SkillFieldType.NUMBER,
                           default_value="70", help_text="0-100，高于此值视为高意向"),
        ],
    ))
    
    # --- 金算虾技能 ---
    registry.register(LobsterSkill(
        id="abacus_roi_calc",
        name="ROI 归因计算",
        description="评分、ROI 计算、归因分析、反馈回写",
        icon="💰",
        source=SkillSource.BUILTIN,
        category="数据分析",
        bound_lobsters=["abacus"],
    ))
    
    # --- 回访虾技能 ---
    registry.register(LobsterSkill(
        id="followup_sop_generate",
        name="跟进 SOP 生成",
        description="生成跟进计划、二次激活策略、推进成交",
        icon="📋",
        source=SkillSource.BUILTIN,
        category="客户跟进",
        bound_lobsters=["followup"],
        config_fields=[
            SkillConfigField(key="follow_interval", label="默认跟进间隔(天)", field_type=SkillFieldType.NUMBER,
                           default_value="3"),
            SkillConfigField(key="max_follow_rounds", label="最大跟进轮数", field_type=SkillFieldType.NUMBER,
                           default_value="5"),
        ],
    ))
    
    # --- 点兵虾技能 ---
    registry.register(LobsterSkill(
        id="dispatcher_task_split",
        name="任务拆包分发",
        description="将执行计划拆解为边缘可执行的子任务包",
        icon="📦",
        source=SkillSource.BUILTIN,
        category="调度执行",
        bound_lobsters=["dispatcher"],
    ))
    
    # --- 幻影虾技能 ---
    registry.register(LobsterSkill(
        id="visualizer_storyboard",
        name="分镜脚本生成",
        description="生成视频/图文分镜结构、首屏点击优化",
        icon="🎬",
        source=SkillSource.BUILTIN,
        category="内容生产",
        bound_lobsters=["visualizer"],
    ))


# ============ 模块初始化 ============

def get_skill_registry() -> LobsterSkillRegistry:
    """获取全局技能注册表实例"""
    registry = LobsterSkillRegistry()
    if not registry.get_all():
        register_builtin_skills(registry)
    return registry
```

### 2. `dragon-senate-saas-v2/tests/test_lobster_skill_registry.py`

创建对应的测试文件，覆盖：
- 注册/注销技能
- 按龙虾 ID 筛选
- 配置更新
- 启用/禁用
- 搜索
- API 序列化
- 内置技能种子检查

### 3. `dragon-senate-saas-v2/app.py` 新增 API 端点

在 FastAPI 应用中新增以下端点：
```python
# GET  /api/skills                         — 获取所有技能列表
# GET  /api/skills?lobster_id=radar        — 获取某虾可用技能
# GET  /api/skills/{skill_id}              — 获取单个技能详情
# PUT  /api/skills/{skill_id}/config       — 更新技能配置
# PUT  /api/skills/{skill_id}/enable       — 启用技能
# PUT  /api/skills/{skill_id}/disable      — 禁用技能
```

### 4. 替换旧的 `SKILL_BINDINGS`

在 `dragon-senate-saas-v2/lobsters/shared.py` 或相关文件中，将硬编码的 `SKILL_BINDINGS` 迁移为从 `LobsterSkillRegistry` 读取。

## 技能扩展参考

本任务的内置技能种子仅包含 10 个基础技能。完整的 **46 个技能定义**（含 36 个新增闭环技能）请参考：

📋 **`docs/LOBSTER_CAPABILITY_EXPANSION.md`** — 龙虾能力边界扩展（含完整注册代码片段）

重点新增：
- 幻影虾 7 个新技能（AI 图片生成、数字人视频、视频剪辑等）
- 吐墨虾 4 个新技能（多平台适配、违禁词、私信话术链等）
- 触须虾 6 个新技能（全网热点、竞品追踪等）
- 其他龙虾共 19 个新技能

Codex 落地时应将 `LOBSTER_CAPABILITY_EXPANSION.md` 第四章中的所有技能代码片段合并到 `register_builtin_skills()` 函数中。

## 约束

- 不修改已有龙虾的核心逻辑（`lobsters/*.py`）
- 注册表是补充层，不破坏现有执行流
- 所有 API 返回值中，敏感配置（api_key/secret/token）必须脱敏
- 保持与 `lobster_runner.py` 的 Hook 系统兼容

## 验收标准

1. `python -m pytest dragon-senate-saas-v2/tests/test_lobster_skill_registry.py` 全部通过
2. FastAPI 启动后，`GET /api/skills` 返回 10+ 内置技能
3. `GET /api/skills?lobster_id=radar` 只返回触须虾的技能
4. `PUT /api/skills/{id}/config` 可以更新配置值
5. 旧的 `SKILL_BINDINGS` 被标记为 deprecated 并从注册表读取
