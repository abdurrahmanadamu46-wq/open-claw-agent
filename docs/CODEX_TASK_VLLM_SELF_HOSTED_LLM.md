# CODEX TASK: vLLM 自建推理层（300席+ 规模化降成本）
**任务ID**: CODEX-VLLM-001  
**优先级**: 🟡 P2（300席以上触发，LLM成本从¥41/席降至¥8/席）  
**依赖文件**: `dragon-senate-saas-v2/provider_registry.py`, `lobster_runner.py`  
**参考项目**: vLLM（https://github.com/vllm-project/vllm）  
**预计工期**: 3天（含 GPU 服务器采购决策分析）  
**触发条件**: 平台托管席位数 ≥ 300席才值得自建

---

## 一、经济账分析（触发条件计算）

```
当前外部 LLM 成本（Claude Sonnet API）：
  每席每月 ≈ ¥41（约 41M tokens × ¥0.001/k）
  300席 = ¥12,300/月 = ¥147,600/年

自建 vLLM（Qwen3-72B 或 DeepSeek-V3）：
  GPU 服务器租金：H100 × 2卡 = ¥28,000/月（阿里云 ECS Bare Metal）
  运维人力：0.5人 = ¥8,000/月
  自建月成本：¥36,000/月（固定成本）
  自建每席成本：¥36,000 / 300席 = ¥120/席/月  ← 还更贵
  
  当席位数达到 1,500席：
    外部成本：¥41 × 1,500 = ¥61,500/月
    自建成本：¥36,000/月（固定不变）
    每席成本：¥36,000 / 1,500 = ¥24/席/月  ← 节省¥17/席

  盈亏平衡点：36,000 / 41 ≈ 878席
  推荐触发点：1,000席（留20%安全边际）

结论：1,000席 之前用 Claude API（灵活无运维），之后启动 vLLM 迁移
```

---

## 二、分阶段部署策略

```
Phase 0（当前 < 300席）：100% Claude API
Phase 1（300~999席）：开始基础设施准备 + Benchmark 测试
Phase 2（1,000席+）：龙虾 LLM 任务 70% 切到 vLLM（标准内容生成）
                     30% 保留 Claude API（高复杂推理、新功能开发）
Phase 3（2,000席+）：vLLM 90%，Claude API 10%（仅兜底）
```

---

## 三、核心配置文件

```yaml
# dragon-senate-saas-v2/vllm_config.yaml
# vLLM 自建推理配置

model:
  name: "Qwen/Qwen3-72B-Instruct"   # 主力模型（商业友好 License）
  fallback: "deepseek-ai/DeepSeek-V3"  # 备用模型
  
server:
  host: "0.0.0.0"
  port: 8000
  tensor_parallel_size: 2            # H100 × 2卡并行
  max_num_seqs: 256                  # 最大并发请求数
  max_model_len: 32768               # 最大上下文长度（32K 够用）
  dtype: "bfloat16"
  gpu_memory_utilization: 0.90
  
performance:
  max_num_batched_tokens: 8192       # 批处理 token 数
  enable_prefix_caching: true        # System Prompt 缓存（节省 40% 重复计算）
  enable_chunked_prefill: true       # 分块预填充（降低延迟方差）
  
routing:
  # 路由到 vLLM 的任务类型（标准化内容生成）
  vllm_tasks:
    - "inkwriter_copywriting"       # 日常文案生成
    - "echoer_comment_reply"        # 评论回复
    - "radar_signal_brief"          # 市场信号简报
    - "followup_script"             # 跟进话术
  
  # 保留 Claude API 的任务类型（高质量要求）
  claude_tasks:
    - "commander_route_plan"        # 复杂路由决策
    - "strategist_campaign"         # 增长策略制定
    - "abacus_performance_report"   # 复杂数据分析
```

---

## 四、路由适配器（接入 provider_registry）

```python
# dragon-senate-saas-v2/vllm_provider.py
"""
vLLM 自建推理 Provider 适配器
接入 provider_registry.py 的多 Provider 路由框架
"""

import httpx
from typing import Optional

# 哪些龙虾任务类型走 vLLM
VLLM_TASK_TYPES = {
    "inkwriter": ["copywriting", "image_caption", "hashtag"],
    "echoer": ["comment_reply", "dm_reply"],
    "radar": ["signal_brief", "trend_summary"],
    "followup": ["followup_script", "dm_proactive"],
    "catcher": ["lead_score", "dm_script"],
}

# 哪些任务类型必须走 Claude（高质量要求）
CLAUDE_ONLY_TASKS = {
    "commander": ["route_plan", "task_decompose"],
    "strategist": ["campaign_strategy", "growth_plan"],
    "abacus": ["performance_report", "roi_analysis"],
}


class VLLMProvider:
    """
    vLLM 本地推理 Provider
    兼容 OpenAI API 格式（vLLM 原生支持 /v1/chat/completions）
    """
    
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=60.0)
        self._is_available = True
    
    async def chat_complete(
        self,
        messages: list[dict],
        model: str = "Qwen3-72B-Instruct",
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> dict:
        """
        调用 vLLM 推理（OpenAI 兼容格式）
        """
        response = await self.client.post(
            f"{self.base_url}/v1/chat/completions",
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": False,
            }
        )
        response.raise_for_status()
        return response.json()
    
    async def health_check(self) -> bool:
        """健康检查（接入熔断机制）"""
        try:
            resp = await self.client.get(f"{self.base_url}/health", timeout=5.0)
            self._is_available = resp.status_code == 200
        except Exception:
            self._is_available = False
        return self._is_available
    
    @property
    def is_available(self) -> bool:
        return self._is_available


class HybridLLMRouter:
    """
    混合 LLM 路由器
    根据任务类型、席位数、系统负载动态决定用 vLLM 还是 Claude API
    """
    
    def __init__(self):
        self.vllm = VLLMProvider()
        self._total_seats = 0  # 从 saas_billing 动态获取
    
    def should_use_vllm(
        self,
        lobster_name: str,
        task_type: str,
        quality_required: str = "standard",
    ) -> bool:
        """
        决策：该任务用 vLLM 还是 Claude API
        
        规则：
        1. 总席位数 < 1000 → 一律 Claude API
        2. Claude Only 任务 → Claude API
        3. vLLM 不可用（熔断）→ Claude API
        4. 高质量要求（premium）→ Claude API
        5. 其余 → vLLM
        """
        # 席位数不够，不值得用 vLLM
        if self._total_seats < 1000:
            return False
        
        # Claude Only 任务
        if lobster_name in CLAUDE_ONLY_TASKS:
            return False
        
        # vLLM 不可用
        if not self.vllm.is_available:
            return False
        
        # 高质量要求走 Claude
        if quality_required == "premium":
            return False
        
        # 检查是否在 vLLM 任务白名单
        allowed_tasks = VLLM_TASK_TYPES.get(lobster_name, [])
        if task_type in allowed_tasks:
            return True
        
        return False
    
    async def route_and_call(
        self,
        lobster_name: str,
        task_type: str,
        messages: list[dict],
        quality_required: str = "standard",
    ) -> dict:
        """
        路由并调用（自动选择 vLLM 或 Claude）
        """
        use_vllm = self.should_use_vllm(lobster_name, task_type, quality_required)
        
        if use_vllm:
            try:
                result = await self.vllm.chat_complete(messages)
                return {
                    "content": result["choices"][0]["message"]["content"],
                    "provider": "vllm",
                    "model": "Qwen3-72B",
                    "cost_estimate": self._estimate_vllm_cost(result),
                }
            except Exception as e:
                # vLLM 失败时自动 fallback 到 Claude
                pass
        
        # Claude API（兜底）
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic()
        response = await client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            messages=messages,
        )
        return {
            "content": response.content[0].text,
            "provider": "claude",
            "model": "claude-sonnet-4-5",
            "cost_estimate": self._estimate_claude_cost(response),
        }
    
    def _estimate_vllm_cost(self, response: dict) -> float:
        """vLLM 成本估算（基于 GPU 时长）"""
        tokens = response.get("usage", {}).get("total_tokens", 0)
        # H100 × 2卡 月租 ¥28,000，处理能力约 5亿 tokens/月
        cost_per_token = 28000 / 500_000_000
        return round(tokens * cost_per_token, 6)
    
    def _estimate_claude_cost(self, response) -> float:
        """Claude API 成本估算"""
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        # Claude Sonnet 4.5 定价：$3/M input，$15/M output（约 ¥22/M, ¥109/M）
        return round(
            input_tokens * 22 / 1_000_000 + output_tokens * 109 / 1_000_000,
            6
        )


# ─── 成本对比工具 ─────────────────────────────────────────

def vllm_roi_analysis(seat_count: int) -> dict:
    """
    vLLM 自建 ROI 分析
    输入席位数，返回成本对比和建议
    """
    # Claude API 成本
    claude_cost_per_seat = 41  # ¥41/席/月
    claude_monthly = claude_cost_per_seat * seat_count
    
    # vLLM 成本（固定 + 运维）
    gpu_rental = 28_000   # H100 × 2卡月租
    ops_labor = 8_000     # 0.5人运维
    vllm_fixed_monthly = gpu_rental + ops_labor
    vllm_monthly = vllm_fixed_monthly  # 固定成本（不随席位增加）
    vllm_per_seat = vllm_monthly / seat_count if seat_count else 0
    
    # 节省
    monthly_savings = claude_monthly - vllm_monthly
    
    # 盈亏平衡点
    breakeven = vllm_fixed_monthly / claude_cost_per_seat
    
    recommendation = "继续使用 Claude API"
    if seat_count >= 1000:
        recommendation = "🚀 强烈建议启动 vLLM 迁移"
    elif seat_count >= 500:
        recommendation = "⚠️ 开始评估 vLLM（接近盈亏平衡）"
    
    return {
        "seat_count": seat_count,
        "claude_api_monthly": claude_monthly,
        "vllm_monthly_fixed": vllm_monthly,
        "vllm_per_seat": round(vllm_per_seat),
        "monthly_savings": monthly_savings,
        "annual_savings": monthly_savings * 12,
        "breakeven_seats": round(breakeven),
        "recommendation": recommendation,
    }
```

---

## 五、Docker 部署配置

```yaml
# docker-compose.vllm.yml
version: '3.8'

services:
  vllm:
    image: vllm/vllm-openai:latest
    ports:
      - "8000:8000"
    environment:
      - HUGGING_FACE_HUB_TOKEN=${HF_TOKEN}
    command: >
      --model Qwen/Qwen3-72B-Instruct
      --tensor-parallel-size 2
      --max-num-seqs 256
      --max-model-len 32768
      --enable-prefix-caching
      --dtype bfloat16
      --port 8000
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 2
              capabilities: [gpu]
    volumes:
      - /data/model_cache:/root/.cache/huggingface
    restart: unless-stopped
    
  vllm-health-monitor:
    image: python:3.12-slim
    command: python /scripts/vllm_health_monitor.py
    environment:
      - VLLM_HOST=vllm
      - VLLM_PORT=8000
      - ALERT_WEBHOOK=${FEISHU_WEBHOOK}
    volumes:
      - ./scripts:/scripts
    restart: unless-stopped
```

---

## 六、验收标准

- [ ] `vllm_roi_analysis(300)` 正确返回 "继续使用 Claude API"
- [ ] `vllm_roi_analysis(1000)` 正确返回 "强烈建议启动 vLLM 迁移"
- [ ] `HybridLLMRouter.should_use_vllm()` 正确路由（InkWriter文案→vLLM，Commander路由→Claude）
- [ ] Commander/Strategist/Abacus 任务始终走 Claude（CLAUDE_ONLY_TASKS）
- [ ] vLLM 宕机时自动 fallback 到 Claude（不崩溃）
- [ ] `provider_registry.py` 中新增 vLLM Provider 注册入口
- [ ] Docker Compose 可正常启动 vLLM（含健康检查）
- [ ] 1,000席场景下：月度 LLM 成本从 ¥41,000 → ¥36,000（节省 ¥5,000/月）
