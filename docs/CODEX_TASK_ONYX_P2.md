# CODEX TASK: Onyx 借鉴 P2 批次（5项合并）

**优先级：P2**  
**来源：ONYX_BORROWING_ANALYSIS.md P2-1 ～ P2-5**  
**依赖：P1 任务完成后执行**

---

## P2-1：连接器凭证统一管理（ConnectorCredentialStore）

**借鉴自**：`backend/onyx/connectors/credentials_provider.py`  
**落地文件**：`dragon-senate-saas-v2/connector_credential_store.py`

```python
# dragon-senate-saas-v2/connector_credential_store.py

import time
import logging
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

class ConnectorCredentialStore:
    """
    龙虾外部数据源凭证统一管理
    支持：飞书 / 企微 / 钉钉 / Notion / HubSpot OAuth token 加密存储+自动刷新
    """
    SUPPORTED_CONNECTORS = ["feishu", "wecom", "dingtalk", "notion", "hubspot", "lark"]

    def __init__(self, db, encryption_key: str):
        self.db = db
        self.fernet = Fernet(encryption_key.encode() if isinstance(encryption_key, str) else encryption_key)

    def save_credential(self, tenant_id: str, connector: str, cred: dict) -> bool:
        if connector not in self.SUPPORTED_CONNECTORS:
            logger.warning(f"[CredStore] 不支持的连接器: {connector}")
            return False
        encrypted = self.fernet.encrypt(str(cred).encode()).decode()
        self.db.upsert("connector_credentials", {
            "tenant_id": tenant_id, "connector": connector,
            "credential_enc": encrypted, "updated_at": time.time()
        })
        logger.info(f"[CredStore] 凭证已保存 tenant={tenant_id} connector={connector}")
        return True

    def get_credential(self, tenant_id: str, connector: str) -> dict:
        row = self.db.query_one("connector_credentials", where={"tenant_id": tenant_id, "connector": connector})
        if not row:
            return {}
        try:
            import ast
            decrypted = self.fernet.decrypt(row["credential_enc"].encode()).decode()
            return ast.literal_eval(decrypted)
        except Exception as e:
            logger.error(f"[CredStore] 解密失败 connector={connector} err={e}")
            return {}

    def is_token_expired(self, tenant_id: str, connector: str, buffer_seconds: int = 300) -> bool:
        cred = self.get_credential(tenant_id, connector)
        expires_at = cred.get("expires_at", 0)
        return time.time() + buffer_seconds >= expires_at

    def refresh_if_needed(self, tenant_id: str, connector: str, refresh_fn) -> dict:
        if self.is_token_expired(tenant_id, connector):
            logger.info(f"[CredStore] Token 过期，刷新中 tenant={tenant_id} connector={connector}")
            new_cred = refresh_fn(self.get_credential(tenant_id, connector))
            self.save_credential(tenant_id, connector, new_cred)
            return new_cred
        return self.get_credential(tenant_id, connector)
```

**验收**：
- [ ] `save_credential()` 加密存储，`get_credential()` 解密返回
- [ ] `is_token_expired()` 提前 5 分钟预警
- [ ] `refresh_if_needed()` 自动刷新并回写
- [ ] 支持 6 种连接器

---

## P2-2：龙虾内置评测 CLI（LobsterEvalCLI）

**借鉴自**：`backend/onyx/evals/eval_cli.py`  
**落地文件**：`scripts/lobster_eval_cli.py`

```python
# scripts/lobster_eval_cli.py
#!/usr/bin/env python3
"""
龙虾输出质量离线评测 CLI
用法：python lobster_eval_cli.py --lobster radar --dataset datasets/radar_eval.jsonl --judge gpt-4o
"""
import argparse
import json
import sys
import time

def load_dataset(path: str) -> list[dict]:
    cases = []
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return cases

def run_eval(lobster_id: str, dataset_path: str, judge_model: str, sample: int = 0) -> dict:
    cases = load_dataset(dataset_path)
    if sample > 0:
        import random
        cases = random.sample(cases, min(sample, len(cases)))

    results = []
    for i, case in enumerate(cases, 1):
        print(f"  [{i}/{len(cases)}] 评测中...", end='\r')
        # 此处接 llm_quality_judge.py 的 judge 接口
        score = {"case_id": case.get("id", i), "score": 0.0, "reason": "TODO: 接入 judge"}
        results.append(score)
        time.sleep(0.1)

    avg = sum(r["score"] for r in results) / len(results) if results else 0.0
    return {"lobster": lobster_id, "total": len(results), "avg_score": avg, "results": results}

def main():
    parser = argparse.ArgumentParser(description="龙虾输出质量评测 CLI")
    parser.add_argument("--lobster", required=True, choices=[
        "commander","radar","strategist","inkwriter","visualizer",
        "dispatcher","echoer","catcher","abacus","followup"
    ])
    parser.add_argument("--dataset", required=True, help="评测数据集 .jsonl 路径")
    parser.add_argument("--judge", default="gpt-4o", help="裁判模型")
    parser.add_argument("--sample", type=int, default=0, help="抽样数量，0=全量")
    parser.add_argument("--output", default="", help="结果输出文件")
    args = parser.parse_args()

    print(f"🦞 开始评测 lobster={args.lobster} dataset={args.dataset}")
    result = run_eval(args.lobster, args.dataset, args.judge, args.sample)
    print(f"\n✅ 评测完成 | 总数={result['total']} | 平均分={result['avg_score']:.2f}")

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"📄 结果已保存至 {args.output}")

if __name__ == "__main__":
    main()
```

**验收**：
- [ ] `--lobster` 只接受 10 只合法龙虾 ID
- [ ] `--sample` 支持抽样评测
- [ ] `--output` 输出 JSON 报告
- [ ] 集成 `llm_quality_judge.py` 评分逻辑

---

## P2-3：Token 速率限制 UI（QuotaLimitsPage）

**借鉴自**：Onyx `web/src/app/admin/token-rate-limits/`  
**落地位置**：前端 `/operations/quota-limits`

```
页面结构：
  /operations/quota-limits
    ├── 全局配额设置（租户级 Token/天 上限）
    ├── 按龙虾分配配额（每只龙虾独立上限）
    ├── 实时消耗进度条（今日已用 / 总上限）
    ├── 历史消耗趋势图（7天折线）
    └── 超额告警设置（% 阈值 + 通知方式）

API：
  GET  /api/v1/quota/summary?tenant_id=xxx   → 当日各龙虾消耗
  GET  /api/v1/quota/history?days=7          → 历史消耗数据
  PATCH /api/v1/quota/limits                 → 更新配额上限
```

**验收**：
- [ ] 进度条实时刷新（30s 轮询）
- [ ] 龙虾独立配额设置（覆盖全局）
- [ ] 超额时前端显示警告横幅
- [ ] `quota_middleware.py` 联动（超额自动降速）

---

## P2-4：内容来源引用标注（ContentCitation）

**借鉴自**：`backend/onyx/chat/citation_processor.py`  
**落地文件**：`dragon-senate-saas-v2/content_citation.py`

```python
# dragon-senate-saas-v2/content_citation.py

import re
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

@dataclass
class Citation:
    ref_id: str
    source_type: str      # signal / memory / connector / web
    source_name: str      # 账号名/文档名/URL
    created_at: float     # Unix timestamp
    url: Optional[str] = None

class ContentCitationProcessor:
    """
    龙虾产出内容来源引用标注
    
    在 inkwriter/strategist 产出内容中，自动识别 [REF:xxx] 标记
    并替换为可点击的来源引用角标。
    
    格式约定：
      龙虾在 Prompt 中被要求在引用信息时写 [REF:signal_id] 或 [REF:memory_id]
      本处理器解析这些标记并补全来源信息。
    """

    REF_PATTERN = re.compile(r'\[REF:([a-zA-Z0-9_-]+)\]')

    def __init__(self, signal_store, memory_service):
        self.signal_store = signal_store
        self.memory_service = memory_service

    def process(self, content: str, tenant_id: str) -> tuple[str, list[Citation]]:
        """
        返回 (处理后内容, 引用列表)
        处理后内容中 [REF:xxx] 替换为 [^n]（角标形式）
        """
        ref_ids = self.REF_PATTERN.findall(content)
        if not ref_ids:
            return content, []

        citations = []
        ref_map = {}  # ref_id → 角标序号

        for ref_id in dict.fromkeys(ref_ids):  # 去重保序
            citation = self._resolve_citation(ref_id, tenant_id)
            if citation:
                n = len(citations) + 1
                citations.append(citation)
                ref_map[ref_id] = n

        def replace_ref(m):
            ref_id = m.group(1)
            n = ref_map.get(ref_id)
            return f"[^{n}]" if n else ""

        processed = self.REF_PATTERN.sub(replace_ref, content)
        return processed, citations

    def _resolve_citation(self, ref_id: str, tenant_id: str) -> Optional[Citation]:
        # 先查 signal_store
        try:
            signal = self.signal_store.get(ref_id, tenant_id)
            if signal:
                return Citation(
                    ref_id=ref_id, source_type="signal",
                    source_name=signal.get("account_name", ref_id),
                    created_at=signal.get("created_at", 0),
                    url=signal.get("url"),
                )
        except Exception:
            pass
        # 再查 memory
        try:
            mem = self.memory_service.get(ref_id, tenant_id)
            if mem:
                return Citation(
                    ref_id=ref_id, source_type="memory",
                    source_name=mem.get("title", ref_id),
                    created_at=mem.get("created_at", 0),
                )
        except Exception:
            pass
        logger.debug(f"[Citation] 未找到来源 ref_id={ref_id}")
        return None
```

**验收**：
- [ ] `process()` 正确解析 `[REF:xxx]` 并替换为 `[^n]`
- [ ] 来源优先查 signal_store，其次 memory_service
- [ ] 未找到来源时静默跳过（不报错）
- [ ] inkwriter/strategist 的 Prompt 模板中加入 `[REF:xxx]` 引用约定

---

## P2-5：深度研究模式（DeepResearchRunner）

**借鉴自**：`backend/onyx/deep_research/dr_loop.py`  
**落地文件**：`dragon-senate-saas-v2/deep_research_runner.py`

```python
# dragon-senate-saas-v2/deep_research_runner.py

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

@dataclass
class ResearchPlan:
    topic: str
    sub_tasks: list[dict] = field(default_factory=list)
    max_rounds: int = 3

@dataclass
class ResearchResult:
    topic: str
    summary: str
    findings: list[dict] = field(default_factory=list)
    duration_s: float = 0.0
    rounds_used: int = 0

class DeepResearchRunner:
    """
    深度研究模式 — radar 龙虾多轮自主调研
    
    流程：
      1. 用 LLM 将研究主题拆解为子任务（竞品/趋势/受众/机会）
      2. 并发执行各子任务（调用 radar 技能：网页抓取/平台搜索/信号聚合）
      3. LLM 汇总各子任务结果，判断是否需要追加调研
      4. 最多 max_rounds 轮后强制输出最终报告
    
    适用场景：
      - "帮我深度分析竞品 XX 的内容策略"
      - "调研护肤赛道过去30天的爆款规律"
    """

    def __init__(self, llm_client, radar_lobster, artifact_store):
        self.llm = llm_client
        self.radar = radar_lobster
        self.artifact_store = artifact_store

    async def run(self, topic: str, tenant_id: str, session_id: str,
                  max_rounds: int = 3) -> ResearchResult:
        start = time.time()
        logger.info(f"[DeepResearch] 开始 topic={topic!r:.40} tenant={tenant_id}")

        # Step 1: 拆解研究计划
        plan = await self._plan(topic, tenant_id)
        logger.info(f"[DeepResearch] 计划生成 {len(plan.sub_tasks)} 个子任务")

        all_findings = []
        for round_n in range(1, max_rounds + 1):
            logger.info(f"[DeepResearch] 第 {round_n} 轮调研")

            # Step 2: 并发执行子任务
            tasks = [
                self._execute_subtask(st, tenant_id, session_id)
                for st in plan.sub_tasks
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            findings = [r for r in results if isinstance(r, dict)]
            all_findings.extend(findings)

            # Step 3: 判断是否需要继续
            should_continue = await self._should_continue(topic, all_findings, round_n, tenant_id)
            if not should_continue or round_n == max_rounds:
                break

            # 生成追加调研计划
            plan = await self._refine_plan(topic, all_findings, tenant_id)

        # Step 4: 汇总最终报告
        summary = await self._synthesize(topic, all_findings, tenant_id)

        result = ResearchResult(
            topic=topic,
            summary=summary,
            findings=all_findings,
            duration_s=round(time.time() - start, 1),
            rounds_used=round_n,
        )

        # 存储为 Artifact
        await self.artifact_store.save({
            "type": "deep_research_report",
            "tenant_id": tenant_id,
            "session_id": session_id,
            "topic": topic,
            "summary": summary,
            "findings": all_findings,
        })

        logger.info(f"[DeepResearch] 完成 rounds={round_n} duration={result.duration_s}s")
        return result

    async def _plan(self, topic: str, tenant_id: str) -> ResearchPlan:
        prompt = f"""将以下研究主题拆解为4个并发子任务（JSON）：
主题：{topic}
输出：{{"sub_tasks":[{{"id":"st1","query":"子任务1具体查询"}},...]}}"""
        try:
            raw = await self.llm.complete(prompt=prompt, max_tokens=256,
                                          temperature=0.2, tenant_id=tenant_id,
                                          tag="deep_research_plan")
            import json
            parsed = json.loads(raw)
            return ResearchPlan(topic=topic, sub_tasks=parsed.get("sub_tasks", []))
        except Exception:
            return ResearchPlan(topic=topic, sub_tasks=[{"id": "st1", "query": topic}])

    async def _execute_subtask(self, subtask: dict, tenant_id: str, session_id: str) -> dict:
        try:
            result = await self.radar.search(
                query=subtask["query"],
                tenant_id=tenant_id,
                session_id=session_id,
            )
            return {"subtask_id": subtask["id"], "query": subtask["query"], "data": result}
        except Exception as e:
            logger.warning(f"[DeepResearch] 子任务失败 id={subtask.get('id')} err={e}")
            return {}

    async def _should_continue(self, topic: str, findings: list, round_n: int, tenant_id: str) -> bool:
        if round_n >= 2:
            return False  # 简化：最多2轮
        return True

    async def _refine_plan(self, topic: str, findings: list, tenant_id: str) -> ResearchPlan:
        return ResearchPlan(topic=topic, sub_tasks=[
            {"id": "st_refine", "query": f"{topic} 深入追踪"}
        ])

    async def _synthesize(self, topic: str, findings: list, tenant_id: str) -> str:
        import json
        prompt = f"""基于以下调研结果，撰写一份{topic}的深度分析报告（500字内，中文）：
{json.dumps(findings[:5], ensure_ascii=False, indent=2)}"""
        try:
            return await self.llm.complete(prompt=prompt, max_tokens=800,
                                           temperature=0.4, tenant_id=tenant_id,
                                           tag="deep_research_synthesize")
        except Exception:
            return f"关于"{topic}"的深度调研已完成，共收集 {len(findings)} 条数据。"
```

**验收**：
- [ ] `DeepResearchRunner.run()` 完成拆解→并发执行→汇总全流程
- [ ] 最多 3 轮迭代（`max_rounds` 可配置）
- [ ] 结果自动存入 `artifact_store`（type=`deep_research_report`）
- [ ] `tag="deep_research_*"` 便于 Langfuse 追踪成本
- [ ] Commander 通过 `intent_type=deep_research` 触发本 Runner

---

*Codex Task | 来源：ONYX_BORROWING_ANALYSIS.md P2-1～P2-5 | 2026-04-02*
