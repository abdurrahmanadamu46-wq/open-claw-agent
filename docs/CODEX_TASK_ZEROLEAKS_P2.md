# CODEX TASK: ZeroLeaks P2 — 动态Temperature + 线索特征库 + SDK + 并行评估

**来源**：ZEROLEAKS_BORROWING_ANALYSIS.md  
**优先级**：P2（高价值，计划落地）  
**借鉴自**：ZeroLeaks TemperatureConfig / DefenseFingerprintDB / npm package / ParallelEvaluation / target.ts  
**日期**：2026-04-02

---

## Task 1: 动态 Temperature 控制（升级 prompt_registry.py）

**借鉴**：ZeroLeaks `TemperatureConfig + TemperatureState`（根据攻击阶段自动调整 LLM 温度）

**设计思路**：
- 探索阶段（分析/规划）→ 高 temperature（0.8-1.0），发散思维
- 执行阶段（写消息/发送）→ 低 temperature（0.3-0.5），精准执行
- 评估阶段（判断效果）→ 极低 temperature（0.1-0.2），客观评判

```python
# 升级 dragon-senate-saas-v2/prompt_registry.py

from dataclasses import dataclass

@dataclass
class TemperatureProfile:
    """
    龙虾执行阶段温度配置
    参考 ZeroLeaks TemperatureConfig 设计
    """
    phase: str           # 执行阶段
    temperature: float   # LLM temperature
    top_p: float         # top_p 采样
    rationale: str       # 为什么这个阶段用这个 temperature

# 标准温度配置（参考 ZeroLeaks TemperatureState 设计）
LOBSTER_TEMPERATURE_PROFILES = {
    # 探索/规划阶段：需要创意和发散，高 temperature
    "strategy_planning": TemperatureProfile(
        phase="strategy_planning",
        temperature=0.9,
        top_p=0.95,
        rationale="规划策略需要创意发散，高温度产生多样化策略",
    ),
    "content_brainstorm": TemperatureProfile(
        phase="content_brainstorm",
        temperature=0.85,
        top_p=0.92,
        rationale="头脑风暴内容创意，需要多样性",
    ),
    
    # 写作阶段：需要质量和连贯性，中等 temperature
    "message_writing": TemperatureProfile(
        phase="message_writing",
        temperature=0.6,
        top_p=0.85,
        rationale="写消息需要流畅自然，适中温度保持创意和质量平衡",
    ),
    "content_writing": TemperatureProfile(
        phase="content_writing",
        temperature=0.65,
        top_p=0.88,
        rationale="内容写作需要结构清晰，适中温度",
    ),
    
    # 执行阶段：需要精准，低 temperature
    "task_execution": TemperatureProfile(
        phase="task_execution",
        temperature=0.3,
        top_p=0.75,
        rationale="执行具体任务需要精准，低温度减少随机性",
    ),
    "tool_calling": TemperatureProfile(
        phase="tool_calling",
        temperature=0.1,
        top_p=0.6,
        rationale="工具调用需要格式精准，极低温度",
    ),
    
    # 评估阶段：需要客观，极低 temperature
    "quality_evaluation": TemperatureProfile(
        phase="quality_evaluation",
        temperature=0.15,
        top_p=0.65,
        rationale="质量评估需要客观一致，极低温度",
    ),
    "conversion_assessment": TemperatureProfile(
        phase="conversion_assessment",
        temperature=0.1,
        top_p=0.6,
        rationale="转化状态判断需要确定性，最低温度",
    ),
}

class DynamicTemperatureController:
    """
    动态温度控制器
    根据龙虾当前执行阶段自动选择最优 temperature
    """
    
    def get_temperature(self, phase: str) -> TemperatureProfile:
        """根据执行阶段获取温度配置"""
        return LOBSTER_TEMPERATURE_PROFILES.get(
            phase,
            TemperatureProfile("default", 0.5, 0.8, "默认中等温度")
        )
    
    def build_llm_config(self, phase: str, model: str) -> dict:
        """构建 LLM 调用配置（含动态温度）"""
        profile = self.get_temperature(phase)
        return {
            "model": model,
            "temperature": profile.temperature,
            "top_p": profile.top_p,
            "_phase": phase,  # 记录阶段，用于日志
        }
```

**验收标准**：
- [ ] `prompt_registry.py` 引入 `DynamicTemperatureController`
- [ ] 覆盖 8 种执行阶段的温度配置
- [ ] `lobster_runner.py` 执行时根据当前阶段自动获取温度
- [ ] `llm_call_logger.py` 记录每次调用时的 phase + temperature
- [ ] SaaS 后台可查看各阶段的 temperature 使用分布

---

## Task 2: 线索特征数据库（lead_profile_db.py）

**借鉴**：ZeroLeaks `DefenseFingerprintDatabase`（已知防御系统特征库，自动识别目标在用什么防御）

```python
# dragon-senate-saas-v2/lead_profile_db.py（新建）

LEAD_PROFILE_PATTERNS = {
    # 线索类型模式（参考 DefenseFingerprintDatabase 的特征识别）
    "decision_maker_cto": {
        "profile_id": "decision_maker_cto",
        "name": "技术决策者（CTO/技术总监）",
        "indicators": [
            "GitHub 有活跃提交",
            "LinkedIn 职位含 CTO/VP Engineering/技术总监",
            "回复偏技术细节",
            "问技术架构和集成方式",
        ],
        "engagement_patterns": {
            "preferred_channel": "LinkedIn/邮件",
            "best_contact_time": "工作日上午10-12点",
            "avg_reply_time_hours": 48,
            "response_to_technical": 0.75,  # 对技术内容响应率
            "response_to_generic": 0.15,    # 对通用内容响应率
        },
        "recommended_approach": "技术价值切入，避免过度销售话术",
        "effective_lobsters": ["radar-lintao", "inkwriter-moxiaoya"],
    },
    "budget_owner_cfo": {
        "profile_id": "budget_owner_cfo",
        "name": "预算决策者（CFO/财务总监）",
        "indicators": [
            "职位含 CFO/财务总监/VP Finance",
            "关注 ROI 和成本效益",
            "问价格在前3条回复内",
        ],
        "engagement_patterns": {
            "preferred_channel": "邮件/微信",
            "best_contact_time": "工作日上午9-11点",
            "avg_reply_time_hours": 72,
            "response_to_roi_data": 0.70,
            "response_to_technical": 0.20,
        },
        "recommended_approach": "ROI 数据和成本节省案例先行",
        "effective_lobsters": ["abacus-suanwuyice", "strategist-susi"],
    },
    "passive_researcher": {
        "profile_id": "passive_researcher",
        "name": "被动调研者",
        "indicators": [
            "已读不回超过2次",
            "偶尔打开消息但不回复",
            "下载了资料但未进一步联系",
        ],
        "engagement_patterns": {
            "preferred_channel": "微信（低压力）",
            "best_contact_time": "晚上8-10点",
            "avg_reply_time_hours": 96,
            "response_to_low_pressure": 0.40,
            "response_to_direct_ask": 0.05,
        },
        "recommended_approach": "低压力内容分享，避免直接要求行动",
        "effective_lobsters": ["echoer-asheng", "followup-xiaochui"],
    },
    "active_evaluator": {
        "profile_id": "active_evaluator",
        "name": "主动评估者",
        "indicators": [
            "主动提问多",
            "要求 demo/试用",
            "对比竞品",
            "询问实施细节",
        ],
        "engagement_patterns": {
            "preferred_channel": "任意渠道均可",
            "best_contact_time": "工作时间均可",
            "avg_reply_time_hours": 4,
            "response_rate": 0.85,
        },
        "recommended_approach": "快速响应，提供完整方案和 demo",
        "effective_lobsters": ["dispatcher-laojian", "catcher-tiegou"],
    },
}

class LeadProfileDB:
    """
    线索特征数据库
    参考 ZeroLeaks DefenseFingerprintDatabase 设计
    自动识别线索类型，推荐最优接触策略
    """
    
    def identify_profile(self, lead_data: dict) -> str:
        """
        根据线索数据识别线索类型
        返回 profile_id
        """
        scores = {}
        for profile_id, pattern in LEAD_PROFILE_PATTERNS.items():
            score = self._calculate_match_score(lead_data, pattern["indicators"])
            scores[profile_id] = score
        
        best_match = max(scores.items(), key=lambda x: x[1])
        return best_match[0] if best_match[1] > 0.3 else "unknown"
    
    def get_recommended_approach(self, profile_id: str) -> dict:
        """获取针对该类型线索的推荐接触策略"""
        pattern = LEAD_PROFILE_PATTERNS.get(profile_id)
        if not pattern:
            return {"approach": "通用接触策略", "lobsters": ["dispatcher-laojian"]}
        return {
            "approach": pattern["recommended_approach"],
            "lobsters": pattern["effective_lobsters"],
            "best_time": pattern["engagement_patterns"]["best_contact_time"],
            "preferred_channel": pattern["engagement_patterns"]["preferred_channel"],
        }
    
    def _calculate_match_score(self, lead_data: dict, indicators: list) -> float:
        """计算线索与特征模式的匹配分数"""
        ...
```

**验收标准**：
- [ ] 新建 `lead_profile_db.py`，内置至少 4 种线索类型
- [ ] `identify_profile()` 自动识别线索类型（返回 profile_id）
- [ ] 每种类型有推荐龙虾 + 最佳接触时间 + 接触策略
- [ ] 雷达（Radar）在分析新线索时自动调用 `identify_profile()`
- [ ] SaaS 后台线索卡片显示识别到的线索类型标签

---

## Task 3: 龙虾 SDK 升级（pip install openclaw）

**借鉴**：ZeroLeaks `npm package`（`bun add zeroleaks`，开发者可直接集成到 TypeScript 项目）

```python
# 升级 dragon-senate-saas-v2/sdk/__init__.py

"""
OpenClaw SDK — 企业级龙虾调用接口
pip install openclaw

用法：
    from openclaw import OpenClawClient
    
    client = OpenClawClient(api_key="oclaw_...")
    
    # 调用单只龙虾
    result = await client.lobster("dispatcher-laojian").run(
        task="分析线索并分配跟进龙虾",
        lead_id="lead_123",
    )
    
    # 启动多轮跟进序列
    sequence = await client.sequences.start(
        lead_id="lead_123",
        sequence_name="cold_outreach_7day",
    )
    
    # 查询线索转化状态
    status = await client.leads.get_conversion_status("lead_123")
"""

import httpx
from dataclasses import dataclass

@dataclass
class OpenClawConfig:
    api_key: str
    base_url: str = "https://api.openclaw.ai/v1"
    timeout: int = 30
    max_retries: int = 3

class LobsterClient:
    def __init__(self, client: "OpenClawClient", lobster_id: str):
        self._client = client
        self._lobster_id = lobster_id
    
    async def run(self, task: str, lead_id: str = None, **kwargs) -> dict:
        """调用指定龙虾执行任务"""
        return await self._client._post(f"/lobsters/{self._lobster_id}/run", {
            "task": task,
            "lead_id": lead_id,
            **kwargs,
        })

class SequenceClient:
    def __init__(self, client: "OpenClawClient"):
        self._client = client
    
    async def start(self, lead_id: str, sequence_name: str) -> dict:
        """启动跟进序列"""
        return await self._client._post("/sequences/start", {
            "lead_id": lead_id,
            "sequence_name": sequence_name,
        })
    
    async def list(self, lead_id: str = None) -> list:
        """列出进行中的序列"""
        params = {"lead_id": lead_id} if lead_id else {}
        return await self._client._get("/sequences", params)

class LeadClient:
    def __init__(self, client: "OpenClawClient"):
        self._client = client
    
    async def get_conversion_status(self, lead_id: str) -> dict:
        """获取线索转化状态"""
        return await self._client._get(f"/leads/{lead_id}/conversion-status")
    
    async def mutate_message(self, message: str, lead_id: str, count: int = 5) -> dict:
        """对成功消息生成变体"""
        return await self._client._post("/messages/mutate", {
            "message": message,
            "lead_id": lead_id,
            "count": count,
        })

class OpenClawClient:
    """
    OpenClaw Python SDK
    参考 ZeroLeaks npm package 的设计，提供简洁的编程接口
    """
    
    def __init__(self, api_key: str, **kwargs):
        self.config = OpenClawConfig(api_key=api_key, **kwargs)
        self._http = httpx.AsyncClient(
            base_url=self.config.base_url,
            headers={"Authorization": f"Bearer {self.config.api_key}"},
            timeout=self.config.timeout,
        )
        self.sequences = SequenceClient(self)
        self.leads = LeadClient(self)
    
    def lobster(self, lobster_id: str) -> LobsterClient:
        """获取指定龙虾的调用客户端"""
        return LobsterClient(self, lobster_id)
    
    async def _post(self, path: str, data: dict) -> dict:
        resp = await self._http.post(path, json=data)
        resp.raise_for_status()
        return resp.json()
    
    async def _get(self, path: str, params: dict = None) -> dict:
        resp = await self._http.get(path, params=params or {})
        resp.raise_for_status()
        return resp.json()
```

**验收标准**：
- [ ] `sdk/__init__.py` 实现 `OpenClawClient`
- [ ] 支持三个子客户端：`lobster() / sequences / leads`
- [ ] SDK 有完整的 type hints 和 docstring
- [ ] 有 `examples/` 目录，至少 3 个使用示例
- [ ] 发布到 PyPI（`pip install openclaw`）

---

## Task 4: 并行评估机制（升级 llm_quality_judge.py）

**借鉴**：ZeroLeaks `ParallelEvaluationResult`（多个 Evaluator 并行评估同一结果，取共识）

```python
# 升级 dragon-senate-saas-v2/llm_quality_judge.py

import asyncio
from dataclasses import dataclass

@dataclass
class ParallelEvalResult:
    """
    并行评估结果（参考 ZeroLeaks ParallelEvaluationResult）
    """
    subject: str                  # 被评估的内容（消息/策略/龙虾输出）
    evaluator_results: list[dict] # 每个评估维度的结果
    consensus_score: float        # 共识分数（加权平均）
    consensus_label: str          # 共识标签（excellent/good/fair/poor）
    disagreement_level: float     # 评估者间分歧程度（0=完全一致）
    evaluation_time_ms: int

EVALUATION_DIMENSIONS = [
    {
        "dimension": "relevance",
        "name": "相关性",
        "description": "消息与线索背景/需求的相关程度",
        "weight": 0.25,
    },
    {
        "dimension": "persuasiveness",
        "name": "说服力",
        "description": "消息对线索的说服和引导效果",
        "weight": 0.35,
    },
    {
        "dimension": "naturalness",
        "name": "自然度",
        "description": "消息语言是否自然，不像机器生成",
        "weight": 0.25,
    },
    {
        "dimension": "compliance",
        "name": "合规性",
        "description": "消息是否符合平台规范和法律要求",
        "weight": 0.15,
    },
]

class ParallelQualityJudge:
    """
    并行质量评估器
    参考 ZeroLeaks ParallelEvaluationResult 设计
    多个维度并行评估，取加权共识
    """
    
    def __init__(self, llm_client):
        self.llm = llm_client
    
    async def evaluate(self, content: str, context: dict) -> ParallelEvalResult:
        """
        并行评估消息质量
        所有维度同时评估（asyncio.gather），不串行等待
        """
        start_time = asyncio.get_event_loop().time()
        
        # 并行评估所有维度（参考 ZeroLeaks 并行设计）
        eval_tasks = [
            self._evaluate_dimension(content, context, dim)
            for dim in EVALUATION_DIMENSIONS
        ]
        results = await asyncio.gather(*eval_tasks)
        
        # 计算加权共识分数
        weighted_scores = [
            r["score"] * dim["weight"]
            for r, dim in zip(results, EVALUATION_DIMENSIONS)
        ]
        consensus_score = sum(weighted_scores)
        
        # 计算分歧程度
        scores = [r["score"] for r in results]
        disagreement = max(scores) - min(scores)
        
        elapsed_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
        
        return ParallelEvalResult(
            subject=content[:100],
            evaluator_results=results,
            consensus_score=round(consensus_score, 1),
            consensus_label=self._score_to_label(consensus_score),
            disagreement_level=round(disagreement, 2),
            evaluation_time_ms=elapsed_ms,
        )
    
    async def _evaluate_dimension(self, content: str, context: dict, dimension: dict) -> dict:
        """评估单个维度"""
        prompt = f"""
评估以下消息的{dimension['name']}（{dimension['description']}）。
评分标准：0-100分。只返回JSON格式：{{"score": 85, "reason": "..."}}

消息：{content}
线索背景：{context}
"""
        result = await self.llm.generate(prompt, temperature=0.1)
        return {"dimension": dimension["dimension"], **parse_json(result)}
    
    def _score_to_label(self, score: float) -> str:
        if score >= 85: return "excellent"
        if score >= 70: return "good"
        if score >= 55: return "fair"
        return "poor"
```

**验收标准**：
- [ ] `llm_quality_judge.py` 引入 `ParallelQualityJudge`
- [ ] 4个评估维度并行执行（不串行等待，节省时间）
- [ ] 计算分歧程度（高分歧时报告给运营审核）
- [ ] 分歧 > 30 分时自动标记为"需人工审核"
- [ ] 评估结果入库，可追溯每次龙虾输出的质量分

---

## Task 5: IM 渠道统一包装器（升级 lobster_im_channel.py）

**借鉴**：ZeroLeaks `target.ts`（2KB，被测系统统一包装器，隔离 API 差异）

```python
# 升级 dragon-senate-saas-v2/lobster_im_channel.py

from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class IMMessage:
    """统一消息格式（参考 ZeroLeaks target.ts 的统一接口）"""
    content: str
    message_type: str          # text / image / file / card
    recipient_id: str
    channel: str
    metadata: dict = None

@dataclass
class IMSendResult:
    """统一发送结果"""
    success: bool
    message_id: str = None
    channel: str = None
    sent_at: str = None
    error: str = None
    error_code: str = None    # 对应 LobsterFailureReason

class BaseIMChannel(ABC):
    """
    IM 渠道统一基类
    参考 ZeroLeaks target.ts 的包装器模式
    隔离各渠道 API 差异，龙虾只需要调用统一接口
    """
    
    @property
    @abstractmethod
    def channel_name(self) -> str:
        """渠道名称"""
        ...
    
    @abstractmethod
    async def send(self, message: IMMessage) -> IMSendResult:
        """发送消息（统一接口）"""
        ...
    
    @abstractmethod
    async def get_reply(self, message_id: str) -> dict:
        """获取回复"""
        ...
    
    @abstractmethod
    async def check_health(self) -> bool:
        """检查渠道健康状态"""
        ...

class WechatWorkChannel(BaseIMChannel):
    """企业微信渠道"""
    @property
    def channel_name(self): return "wechat_work"
    
    async def send(self, message: IMMessage) -> IMSendResult:
        # 调用企业微信 API
        ...

class FeishuChannel(BaseIMChannel):
    """飞书渠道"""
    @property
    def channel_name(self): return "feishu"
    
    async def send(self, message: IMMessage) -> IMSendResult:
        # 调用飞书 API
        ...

class DingtalkChannel(BaseIMChannel):
    """钉钉渠道"""
    @property
    def channel_name(self): return "dingtalk"
    
    async def send(self, message: IMMessage) -> IMSendResult:
        ...

class IMChannelRouter:
    """
    IM 渠道路由器
    根据线索偏好渠道自动选择发送通道
    """
    
    def __init__(self):
        self.channels = {
            "wechat_work": WechatWorkChannel(),
            "feishu": FeishuChannel(),
            "dingtalk": DingtalkChannel(),
        }
    
    async def send(self, message: IMMessage, fallback_channels: list = None) -> IMSendResult:
        """
        发送消息，支持失败时自动切换备用渠道
        参考 ZeroLeaks 的多目标攻击设计
        """
        primary = self.channels.get(message.channel)
        if not primary:
            raise ValueError(f"未知渠道: {message.channel}")
        
        result = await primary.send(message)
        
        # 主渠道失败，尝试备用渠道
        if not result.success and fallback_channels:
            for fallback in fallback_channels:
                channel = self.channels.get(fallback)
                if channel:
                    fallback_msg = IMMessage(**{**message.__dict__, "channel": fallback})
                    result = await channel.send(fallback_msg)
                    if result.success:
                        break
        
        return result
```

**验收标准**：
- [ ] `lobster_im_channel.py` 重构引入 `BaseIMChannel` 基类
- [ ] 企微/飞书/钉钉 3 个渠道实现统一接口
- [ ] `IMChannelRouter` 支持自动故障切换（主渠道失败→备用渠道）
- [ ] 龙虾执行代码只需调用 `router.send()`，不感知渠道差异
- [ ] 渠道健康检查定时运行，不健康渠道自动降级

---

## 联动关系

```
Task 2 (线索特征库) → 识别线索类型 → 影响
Task 1 (动态温度)：不同线索类型不同执行温度策略

Task 5 (IM渠道路由) → 发送结果 →
Task 4 (并行评估)：评估发出的消息质量

Task 3 (SDK) → 对外暴露
  - 触发 Task 1（执行龙虾）
  - 触发 Task 2（识别线索类型）
  - 查询 Task 4（评估结果）
```

---

*借鉴来源：ZeroLeaks TemperatureConfig + DefenseFingerprintDB + npm SDK + ParallelEval + target.ts | 2026-04-02*
