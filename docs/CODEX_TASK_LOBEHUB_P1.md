# CODEX TASK: LobeHub P1 — 上下文引擎 + 实时搜索 + 文件加载器 + 建议动作

**来源**：LOBEHUB_BORROWING_ANALYSIS.md  
**优先级**：P1（高价值立即落地）  
**借鉴自**：LobeHub context-engine / builtin-tool-web-browsing / file-loaders / SuggestQuestions  
**日期**：2026-04-02

---

## Task 1: 龙虾上下文引擎（context_engine.py）

**借鉴**：LobeHub `packages/context-engine`（智能选择注入 LLM 的上下文，控制 token 预算）

**核心问题**：龙虾执行时会把完整对话历史、全量角色卡、全量知识库都塞进 prompt，导致：
- token 浪费（大量无关内容）
- LLM 注意力分散（无关信息干扰）
- 成本失控（每次调用 token 费用高）

**设计思路**：
```python
# dragon-senate-saas-v2/context_engine.py（新建）

from dataclasses import dataclass
from typing import Any

@dataclass 
class ContextItem:
    """单个上下文片段"""
    content: str
    source: str           # 来源（history/skill/profile/knowledge）
    relevance_score: float # 与当前任务的相关性（0-1）
    priority: int          # 优先级（1=最高）
    token_count: int       # 估算 token 数
    metadata: dict = None

@dataclass
class ContextBudget:
    """Token 预算配置"""
    max_total_tokens: int = 8000    # 最大总 token
    task_prompt_reserve: int = 1000 # 任务 prompt 预留
    output_reserve: int = 2000      # 输出预留
    
    @property
    def context_budget(self) -> int:
        return self.max_total_tokens - self.task_prompt_reserve - self.output_reserve

class LobsterContextEngine:
    """
    龙虾上下文引擎
    参考 LobeHub context-engine 设计
    按相关性 + 优先级选择最优上下文组合，不超 token 预算
    """
    
    def __init__(self, budget: ContextBudget = None):
        self.budget = budget or ContextBudget()
    
    def build_context(
        self,
        task: str,
        lead_profile: dict,
        conversation_history: list[dict],
        skill_docs: list[dict],
        knowledge_snippets: list[dict],
    ) -> str:
        """
        构建最优上下文
        输入所有可用信息 → 输出精选上下文字符串
        """
        # 1. 收集所有候选上下文片段
        candidates: list[ContextItem] = []
        
        # 线索画像（高优先级，精简为关键字段）
        profile_summary = self._summarize_profile(lead_profile)
        candidates.append(ContextItem(
            content=profile_summary,
            source="lead_profile",
            relevance_score=0.95,  # 线索画像永远高度相关
            priority=1,
            token_count=self._estimate_tokens(profile_summary),
        ))
        
        # 近期对话历史（按时间倒序，取最新N条）
        for i, msg in enumerate(reversed(conversation_history[-10:])):
            score = 0.9 - i * 0.05  # 越新越相关
            content = f"[{msg.get('role','user')}]: {msg.get('content','')}"
            candidates.append(ContextItem(
                content=content,
                source="history",
                relevance_score=max(score, 0.3),
                priority=2,
                token_count=self._estimate_tokens(content),
            ))
        
        # 技能文档（按与任务的相关性打分）
        for skill in skill_docs:
            score = self._compute_relevance(task, skill.get("content", ""))
            candidates.append(ContextItem(
                content=skill.get("content", "")[:500],  # 截断到500字
                source="skill",
                relevance_score=score,
                priority=3,
                token_count=self._estimate_tokens(skill.get("content", "")[:500]),
            ))
        
        # 知识库片段（按相关性）
        for snippet in knowledge_snippets:
            score = self._compute_relevance(task, snippet.get("content", ""))
            if score > 0.4:  # 只加入相关性 > 40% 的
                candidates.append(ContextItem(
                    content=snippet.get("content", "")[:300],
                    source="knowledge",
                    relevance_score=score,
                    priority=4,
                    token_count=self._estimate_tokens(snippet.get("content", "")[:300]),
                ))
        
        # 2. 按优先级 + 相关性排序，在 token 预算内贪心填充
        selected = self._greedy_fill(candidates, self.budget.context_budget)
        
        # 3. 格式化输出
        return self._format_context(selected)
    
    def _greedy_fill(self, candidates: list[ContextItem], budget: int) -> list[ContextItem]:
        """贪心填充：按 priority asc + relevance desc 排序，在预算内选取"""
        sorted_candidates = sorted(
            candidates,
            key=lambda x: (x.priority, -x.relevance_score)
        )
        selected = []
        used_tokens = 0
        for item in sorted_candidates:
            if used_tokens + item.token_count <= budget:
                selected.append(item)
                used_tokens += item.token_count
        return selected
    
    def _summarize_profile(self, profile: dict) -> str:
        """提取线索画像关键字段（不传全量）"""
        key_fields = ["name", "title", "company", "pain_points", "interest_level", "last_interaction"]
        summary = {k: profile.get(k) for k in key_fields if profile.get(k)}
        return "线索信息: " + str(summary)
    
    def _compute_relevance(self, task: str, content: str) -> float:
        """计算任务与内容的相关性（简化版词重叠，实际可用 embedding）"""
        task_words = set(task.lower().split())
        content_words = set(content.lower().split())
        if not task_words:
            return 0.0
        overlap = len(task_words & content_words)
        return min(overlap / len(task_words), 1.0)
    
    def _estimate_tokens(self, text: str) -> int:
        """估算 token 数（中文约 1.5 字符/token，英文约 4 字符/token）"""
        return len(text) // 3
    
    def _format_context(self, items: list[ContextItem]) -> str:
        """格式化上下文字符串"""
        sections = {}
        for item in items:
            sections.setdefault(item.source, []).append(item.content)
        
        parts = []
        source_labels = {
            "lead_profile": "【线索画像】",
            "history": "【近期对话】",
            "skill": "【相关技能】",
            "knowledge": "【知识参考】",
        }
        for source, label in source_labels.items():
            if source in sections:
                parts.append(label)
                parts.extend(sections[source])
        return "\n\n".join(parts)
```

**验收标准**：
- [ ] 新建 `context_engine.py`，`LobsterContextEngine.build_context()` 可正常调用
- [ ] token 预算控制有效（不超过 `context_budget`）
- [ ] 线索画像始终优先级最高（priority=1）
- [ ] `lobster_runner.py` 执行时调用 `context_engine.build_context()` 替代拼接全量 prompt
- [ ] `llm_call_logger.py` 记录每次 context_token_count（实际使用了多少 token）
- [ ] 测试：相比原来全量 prompt，token 使用量下降 ≥ 30%

---

## Task 2: 龙虾实时网页搜索（web_search_tool.py）

**借鉴**：LobeHub `packages/builtin-tool-web-browsing`（雷达可调用实时搜索获取最新行业动态）

```python
# dragon-senate-saas-v2/web_search_tool.py（新建）

import httpx
from dataclasses import dataclass

@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    published_date: str = None
    source: str = None

@dataclass
class WebSearchConfig:
    """搜索配置"""
    engine: str = "tavily"          # tavily / bing / serper
    max_results: int = 5
    include_raw_content: bool = False
    search_depth: str = "basic"     # basic / advanced
    max_content_length: int = 500   # 每条结果最大字符数

class WebSearchTool:
    """
    龙虾实时网页搜索工具
    参考 LobeHub builtin-tool-web-browsing 设计
    
    主要使用场景（雷达/林桃）：
    - 目标公司最新动态（融资/招聘/产品发布）
    - 行业热门话题（雷达调研背景）
    - 竞品价格/功能变化
    - 关键人物近期公开言论
    """
    
    def __init__(self, config: WebSearchConfig = None, api_key: str = None):
        self.config = config or WebSearchConfig()
        self.api_key = api_key
    
    async def search(self, query: str, context: str = None) -> list[SearchResult]:
        """
        执行搜索
        query: 搜索关键词
        context: 搜索背景（帮助理解搜索意图，用于结果过滤）
        """
        if self.config.engine == "tavily":
            return await self._search_tavily(query)
        elif self.config.engine == "serper":
            return await self._search_serper(query)
        else:
            return await self._search_bing(query)
    
    async def search_company_news(self, company_name: str) -> list[SearchResult]:
        """搜索公司最新动态（雷达专用快捷方法）"""
        query = f"{company_name} 最新动态 融资 产品 招聘 2025 2026"
        results = await self.search(query)
        return self._deduplicate(results)
    
    async def search_person_profile(self, name: str, company: str = None) -> list[SearchResult]:
        """搜索人物公开信息"""
        query = f"{name} {company or ''} LinkedIn 领英 微博 公众号"
        return await self.search(query)
    
    async def search_industry_trend(self, industry: str, topic: str = None) -> list[SearchResult]:
        """搜索行业趋势"""
        query = f"{industry} {topic or '趋势'} 2025 2026 报告 分析"
        return await self.search(query)
    
    async def _search_tavily(self, query: str) -> list[SearchResult]:
        """Tavily 搜索（推荐，专为 AI 优化）"""
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": self.api_key,
                    "query": query,
                    "max_results": self.config.max_results,
                    "search_depth": self.config.search_depth,
                    "include_raw_content": self.config.include_raw_content,
                }
            )
            data = resp.json()
            results = []
            for item in data.get("results", []):
                content = item.get("content", "")[:self.config.max_content_length]
                results.append(SearchResult(
                    title=item.get("title", ""),
                    url=item.get("url", ""),
                    snippet=content,
                    published_date=item.get("published_date"),
                    source="tavily",
                ))
            return results
    
    async def _search_serper(self, query: str) -> list[SearchResult]:
        """Serper 搜索（备用）"""
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": self.api_key},
                json={"q": query, "num": self.config.max_results, "hl": "zh-cn"}
            )
            data = resp.json()
            results = []
            for item in data.get("organic", []):
                results.append(SearchResult(
                    title=item.get("title", ""),
                    url=item.get("link", ""),
                    snippet=item.get("snippet", "")[:self.config.max_content_length],
                    source="serper",
                ))
            return results
    
    def _deduplicate(self, results: list[SearchResult]) -> list[SearchResult]:
        """去重（按 URL）"""
        seen = set()
        unique = []
        for r in results:
            if r.url not in seen:
                seen.add(r.url)
                unique.append(r)
        return unique
    
    def format_for_llm(self, results: list[SearchResult]) -> str:
        """格式化搜索结果供 LLM 消费"""
        if not results:
            return "未找到相关信息。"
        lines = ["以下是最新搜索结果：\n"]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. **{r.title}**")
            lines.append(f"   {r.snippet}")
            if r.published_date:
                lines.append(f"   发布时间：{r.published_date}")
            lines.append(f"   来源：{r.url}\n")
        return "\n".join(lines)
```

**验收标准**：
- [ ] 新建 `web_search_tool.py`，支持 Tavily（主）+ Serper（备用）
- [ ] `search_company_news()` / `search_person_profile()` / `search_industry_trend()` 三个快捷方法
- [ ] 雷达（radar-lintao）的技能中增加 `web_search` 技能调用
- [ ] 搜索结果自动去重，每条结果截断到500字（避免 token 爆炸）
- [ ] `format_for_llm()` 输出可直接注入 LLM prompt
- [ ] 搜索结果入缓存（同一查询24小时内不重复搜索）

---

## Task 3: 龙虾文件加载器（file_loader.py）

**借鉴**：LobeHub `packages/file-loaders`（支持 PDF/Word/Excel/PPT 多格式解析）

```python
# dragon-senate-saas-v2/file_loader.py（新建）

from dataclasses import dataclass
from pathlib import Path

@dataclass
class LoadedFile:
    """解析后的文件内容"""
    filename: str
    file_type: str           # pdf / docx / xlsx / txt
    raw_text: str            # 提取的纯文本
    metadata: dict           # 元数据（页数/作者/创建时间等）
    structured_data: dict = None  # 结构化数据（Excel 表格等）
    extraction_quality: float = 1.0  # 提取质量评分

@dataclass
class BusinessCardExtract:
    """名片信息提取结果"""
    name: str = None
    title: str = None
    company: str = None
    phone: str = None
    email: str = None
    wechat: str = None
    address: str = None
    raw_text: str = None

class LobsterFileLoader:
    """
    龙虾文件加载器
    参考 LobeHub file-loaders 设计
    
    核心业务场景：
    1. 线索发来名片 PDF → 提取联系人信息
    2. 线索发来产品手册 → 雷达自动解析，加工入知识库
    3. 运营上传行业报告 → 算无遗策自动解析生成洞察
    4. Excel 线索名单 → 批量导入解析
    """
    
    SUPPORTED_TYPES = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".txt", ".md"}
    
    async def load(self, file_path: str, file_bytes: bytes = None) -> LoadedFile:
        """
        加载并解析文件
        file_path: 文件路径（或文件名用于判断类型）
        file_bytes: 文件字节内容（可选，优先使用）
        """
        path = Path(file_path)
        ext = path.suffix.lower()
        
        if ext not in self.SUPPORTED_TYPES:
            raise ValueError(f"不支持的文件类型: {ext}，支持: {self.SUPPORTED_TYPES}")
        
        if ext == ".pdf":
            return await self._load_pdf(path, file_bytes)
        elif ext in (".docx", ".doc"):
            return await self._load_docx(path, file_bytes)
        elif ext in (".xlsx", ".xls"):
            return await self._load_excel(path, file_bytes)
        else:
            return await self._load_text(path, file_bytes)
    
    async def extract_business_card(self, file: LoadedFile, llm_client=None) -> BusinessCardExtract:
        """
        从文件中提取名片信息（AI 辅助提取）
        用于：线索发来名片 PDF → 自动提取姓名/职位/公司/联系方式
        """
        if not file.raw_text:
            return BusinessCardExtract(raw_text="")
        
        # 规则提取（快速）
        extract = self._rule_based_extract(file.raw_text)
        
        # 如果提供了 LLM 客户端，用 AI 增强提取
        if llm_client and not self._is_complete(extract):
            extract = await self._ai_extract(file.raw_text, llm_client)
        
        extract.raw_text = file.raw_text
        return extract
    
    async def extract_leads_from_excel(self, file: LoadedFile) -> list[dict]:
        """
        从 Excel 文件批量提取线索
        用于：Excel 线索名单批量导入
        """
        if not file.structured_data:
            return []
        rows = file.structured_data.get("rows", [])
        headers = file.structured_data.get("headers", [])
        return [dict(zip(headers, row)) for row in rows]
    
    async def _load_pdf(self, path: Path, file_bytes: bytes) -> LoadedFile:
        """PDF 解析（使用 pdfminer.six）"""
        try:
            import io
            from pdfminer.high_level import extract_text
            if file_bytes:
                text = extract_text(io.BytesIO(file_bytes))
            else:
                text = extract_text(str(path))
            return LoadedFile(
                filename=path.name,
                file_type="pdf",
                raw_text=text.strip(),
                metadata={"source": str(path)},
            )
        except ImportError:
            return LoadedFile(
                filename=path.name, file_type="pdf",
                raw_text="", metadata={"error": "需要安装 pdfminer.six: pip install pdfminer.six"},
                extraction_quality=0.0,
            )
    
    async def _load_docx(self, path: Path, file_bytes: bytes) -> LoadedFile:
        """Word 文档解析（使用 python-docx）"""
        try:
            import io
            import docx
            if file_bytes:
                doc = docx.Document(io.BytesIO(file_bytes))
            else:
                doc = docx.Document(str(path))
            text = "\n".join(para.text for para in doc.paragraphs if para.text.strip())
            return LoadedFile(
                filename=path.name, file_type="docx",
                raw_text=text, metadata={"paragraphs": len(doc.paragraphs)},
            )
        except ImportError:
            return LoadedFile(
                filename=path.name, file_type="docx",
                raw_text="", metadata={"error": "需要安装 python-docx: pip install python-docx"},
                extraction_quality=0.0,
            )
    
    async def _load_excel(self, path: Path, file_bytes: bytes) -> LoadedFile:
        """Excel 解析（使用 openpyxl）"""
        try:
            import io
            import openpyxl
            if file_bytes:
                wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
            else:
                wb = openpyxl.load_workbook(str(path), data_only=True)
            ws = wb.active
            rows = []
            headers = []
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                clean = [str(cell) if cell is not None else "" for cell in row]
                if i == 0:
                    headers = clean
                else:
                    rows.append(clean)
            text = "\n".join([",".join(row) for row in rows[:50]])  # 前50行文本
            return LoadedFile(
                filename=path.name, file_type="xlsx",
                raw_text=text,
                metadata={"rows": len(rows), "columns": len(headers)},
                structured_data={"headers": headers, "rows": rows},
            )
        except ImportError:
            return LoadedFile(
                filename=path.name, file_type="xlsx",
                raw_text="", metadata={"error": "需要安装 openpyxl: pip install openpyxl"},
                extraction_quality=0.0,
            )
    
    async def _load_text(self, path: Path, file_bytes: bytes) -> LoadedFile:
        if file_bytes:
            text = file_bytes.decode("utf-8", errors="replace")
        else:
            text = path.read_text(encoding="utf-8", errors="replace")
        return LoadedFile(
            filename=path.name, file_type=path.suffix.lstrip("."),
            raw_text=text, metadata={},
        )
    
    def _rule_based_extract(self, text: str) -> BusinessCardExtract:
        """基于正则的名片信息提取"""
        import re
        extract = BusinessCardExtract()
        # 手机
        phone_match = re.search(r"1[3-9]\d{9}", text)
        if phone_match:
            extract.phone = phone_match.group()
        # 邮箱
        email_match = re.search(r"[\w.+-]+@[\w-]+\.\w+", text)
        if email_match:
            extract.email = email_match.group()
        return extract
    
    def _is_complete(self, extract: BusinessCardExtract) -> bool:
        return bool(extract.name and extract.company and (extract.phone or extract.email))
    
    async def _ai_extract(self, text: str, llm_client) -> BusinessCardExtract:
        """AI 增强提取"""
        prompt = f"""从以下文本中提取名片信息，返回JSON：
{{"name": "姓名", "title": "职位", "company": "公司", "phone": "手机", "email": "邮箱", "wechat": "微信"}}

文本：{text[:1000]}
只返回JSON，无需解释。"""
        result = await llm_client.generate(prompt, temperature=0.1)
        try:
            import json
            data = json.loads(result)
            return BusinessCardExtract(**{k: v for k, v in data.items() if hasattr(BusinessCardExtract, k)})
        except Exception:
            return BusinessCardExtract()
```

**验收标准**：
- [ ] 新建 `file_loader.py`，支持 PDF/Word/Excel/TXT
- [ ] `extract_business_card()` 可从 PDF 名片提取联系人信息
- [ ] `extract_leads_from_excel()` 可批量导入 Excel 线索
- [ ] 雷达（radar-lintao）收到文件附件时自动调用 `file_loader.load()`
- [ ] 解析结果存入 `dataset_store` 或 `industry_insight_store`
- [ ] 缺少依赖包时优雅降级（返回 extraction_quality=0 而非崩溃）

---

## Task 4: 龙虾建议动作（suggest_actions.py）

**借鉴**：LobeHub `src/features/SuggestQuestions`（每次 Agent 回复后 AI 生成 3 个建议下一步）

```python
# dragon-senate-saas-v2/suggest_actions.py（新建）

from dataclasses import dataclass

@dataclass
class SuggestedAction:
    """单个建议动作"""
    action_text: str      # 动作描述（运营看到的文字）
    lobster_id: str       # 建议触发的龙虾
    task_hint: str        # 给龙虾的任务提示
    confidence: float     # 建议置信度（0-1）
    action_type: str      # follow_up / analyze / write / dispatch

LOBSTER_CAPABILITIES = {
    "dispatcher-laojian":  "任务分配、龙虾协调",
    "strategist-susi":     "线索分析、策略制定、优先级排序",
    "inkwriter-moxiaoya":  "消息撰写、内容创作",
    "radar-lintao":        "线索调研、行业洞察、公司分析",
    "echoer-asheng":       "破冰触达、关系维护",
    "catcher-tiegou":      "异议处理、需求确认",
    "abacus-suanwuyice":   "数据分析、ROI计算、报价",
    "followup-xiaochui":   "跟进提醒、行动催促",
    "visualizer-shadow":   "可视化报告生成",
}

class LobsterSuggestActions:
    """
    龙虾建议动作生成器
    参考 LobeHub SuggestQuestions 设计
    每次龙虾完成任务后，AI 推荐 3 个下一步操作，运营一键触发
    """
    
    def __init__(self, llm_client):
        self.llm = llm_client
    
    async def generate(
        self,
        completed_task: str,
        completed_by: str,
        task_result: str,
        lead_status: str,
        current_lobsters: list[str] = None,
    ) -> list[SuggestedAction]:
        """
        生成建议动作
        completed_task: 刚完成的任务描述
        completed_by: 完成任务的龙虾
        task_result: 任务执行结果摘要
        lead_status: 当前线索状态
        """
        prompt = f"""
你是OpenClaw龙虾战队的调度助手。
刚完成：{completed_by}执行了「{completed_task}」，结果：{task_result[:300]}
当前线索状态：{lead_status}

请推荐3个最有价值的下一步动作，每个动作必须：
1. 对应一只具体的龙虾（从：{list(LOBSTER_CAPABILITIES.keys())}中选）
2. 有明确的执行目标
3. 逻辑上承接刚完成的任务

返回JSON数组：
[
  {{"action_text": "让XX做YY", "lobster_id": "xxx", "task_hint": "具体任务提示", "action_type": "analyze/write/follow_up/dispatch"}},
  ...
]
只返回JSON。"""
        
        result = await self.llm.generate(prompt, temperature=0.6)
        
        try:
            import json
            actions_data = json.loads(result)
            actions = []
            for i, a in enumerate(actions_data[:3]):
                actions.append(SuggestedAction(
                    action_text=a.get("action_text", ""),
                    lobster_id=a.get("lobster_id", "dispatcher-laojian"),
                    task_hint=a.get("task_hint", ""),
                    confidence=0.9 - i * 0.1,
                    action_type=a.get("action_type", "follow_up"),
                ))
            return actions
        except Exception:
            return self._default_suggestions(completed_by, lead_status)
    
    def _default_suggestions(self, completed_by: str, lead_status: str) -> list[SuggestedAction]:
        """兜底建议（AI 失败时）"""
        return [
            SuggestedAction(
                action_text="让老健分配下一步跟进任务",
                lobster_id="dispatcher-laojian",
                task_hint="根据当前线索状态分配合适的跟进任务",
                confidence=0.7,
                action_type="dispatch",
            ),
            SuggestedAction(
                action_text="让苏思分析线索优先级",
                lobster_id="strategist-susi",
                task_hint="分析当前线索的转化潜力，给出优先级排序",
                confidence=0.65,
                action_type="analyze",
            ),
            SuggestedAction(
                action_text="让小锤设置下次跟进提醒",
                lobster_id="followup-xiaochui",
                task_hint="根据线索状态设置合理的跟进时间节点",
                confidence=0.6,
                action_type="follow_up",
            ),
        ]
```

**验收标准**：
- [ ] 新建 `suggest_actions.py`，`LobsterSuggestActions.generate()` 可正常调用
- [ ] 每次龙虾任务完成后自动调用 `generate()`，返回 3 个建议
- [ ] SaaS 后台在任务结果下方显示建议动作卡片
- [ ] 运营点击建议动作 → 直接触发对应龙虾执行（一键操作）
- [ ] 建议动作有兜底逻辑（AI 失败时返回默认建议）
- [ ] 建议动作的点击率和触发转化率计入 analytics

---

## 联动关系

```
Task 1 (上下文引擎) ← 被所有龙虾调用
  → 优化所有龙虾的 LLM 调用质量和 token 成本

Task 2 (实时搜索) → 雷达使用
  → 搜索结果通过 Task 1 上下文引擎注入 LLM

Task 3 (文件加载器) → 雷达和算无遗策使用
  → 解析结果存入知识库，通过 Task 1 引擎检索

Task 4 (建议动作) → 依赖 Task 1-3 的执行结果
  → 根据龙虾执行结果生成下一步建议
```

---

*借鉴来源：LobeHub context-engine + builtin-tool-web-browsing + file-loaders + SuggestQuestions | 2026-04-02*
