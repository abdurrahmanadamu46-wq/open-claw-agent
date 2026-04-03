# CODEX TASK: 龙虾输出 Artifact 渲染器（ArtifactRenderer）

**优先级：P1**  
**来源：OPENWEBUI_BORROWING_ANALYSIS.md P1-1**  
**借鉴自**：Open WebUI `src/lib/components/chat/` — Artifact 内容渲染系统

---

## 背景

当前龙虾输出（inkwriter/strategist/abacus）均以纯 Markdown 文本返回，前端只做基础渲染。
借鉴 Open WebUI 的 Artifact 渲染思路：**自动识别输出类型并渲染为交互式组件**，让龙虾产出「活起来」。

目标效果：
- inkwriter 输出脚本 → **代码块高亮 + 一键复制**
- strategist 输出流程图 → **Mermaid 图实时渲染**
- abacus 输出数据报告 → **内嵌数据表格 + 图表**
- visualizer 输出分镜 → **SVG/HTML 预览区**

---

## 实现方案

### 后端：Artifact 类型标注

```python
# dragon-senate-saas-v2/artifact_classifier.py

import re
from dataclasses import dataclass
from typing import Literal

ArtifactType = Literal[
    "text", "code", "mermaid", "html", "svg", "table_csv",
    "json_data", "markdown_rich", "image_url"
]


@dataclass
class ArtifactBlock:
    artifact_type: ArtifactType
    content: str
    language: str = ""      # code 时的语言
    title: str = ""         # 可选标题
    metadata: dict = None

    def to_dict(self) -> dict:
        return {
            "type": self.artifact_type,
            "content": self.content,
            "language": self.language,
            "title": self.title,
            "metadata": self.metadata or {},
        }


class ArtifactClassifier:
    """
    龙虾输出内容 Artifact 类型识别器
    将 Markdown 输出解析为结构化 Artifact 块列表
    """

    MERMAID_PATTERN = re.compile(r'```mermaid\n(.*?)```', re.DOTALL)
    CODE_PATTERN = re.compile(r'```(\w+)?\n(.*?)```', re.DOTALL)
    HTML_PATTERN = re.compile(r'```html\n(.*?)```', re.DOTALL)
    SVG_PATTERN = re.compile(r'(<svg[\s\S]*?</svg>)', re.IGNORECASE)
    CSV_PATTERN = re.compile(r'```csv\n(.*?)```', re.DOTALL)

    def classify(self, content: str, lobster_id: str = "") -> list[ArtifactBlock]:
        """将龙虾输出拆分为 Artifact 块列表"""
        blocks = []

        # 优先识别 Mermaid
        for m in self.MERMAID_PATTERN.finditer(content):
            blocks.append(ArtifactBlock(
                artifact_type="mermaid",
                content=m.group(1).strip(),
                title="流程图",
            ))

        # HTML 预览
        for m in self.HTML_PATTERN.finditer(content):
            blocks.append(ArtifactBlock(
                artifact_type="html",
                content=m.group(1).strip(),
                title="HTML 预览",
            ))

        # CSV/表格
        for m in self.CSV_PATTERN.finditer(content):
            blocks.append(ArtifactBlock(
                artifact_type="table_csv",
                content=m.group(1).strip(),
                title="数据表格",
            ))

        # SVG
        for m in self.SVG_PATTERN.finditer(content):
            blocks.append(ArtifactBlock(
                artifact_type="svg",
                content=m.group(1).strip(),
                title="图形",
            ))

        # 通用代码块（排除已识别的）
        remaining = self.MERMAID_PATTERN.sub("", content)
        remaining = self.HTML_PATTERN.sub("", remaining)
        remaining = self.CSV_PATTERN.sub("", remaining)
        for m in self.CODE_PATTERN.finditer(remaining):
            lang = m.group(1) or "text"
            if lang not in ("mermaid", "html", "csv", "svg"):
                blocks.append(ArtifactBlock(
                    artifact_type="code",
                    content=m.group(2).strip(),
                    language=lang,
                    title=f"{lang} 代码",
                ))

        # 如果没有特殊块，返回富文本
        if not blocks:
            blocks.append(ArtifactBlock(
                artifact_type="markdown_rich",
                content=content,
            ))

        return blocks

    def enrich_task_output(self, task_output: dict) -> dict:
        """在龙虾任务输出中追加 artifacts 字段"""
        content = task_output.get("content", "")
        lobster_id = task_output.get("lobster_id", "")
        artifacts = [b.to_dict() for b in self.classify(content, lobster_id)]
        return {**task_output, "artifacts": artifacts}
```

### API 集成

```python
# dragon-senate-saas-v2/app.py（在龙虾输出路由中追加）

@router.get("/api/v1/lobster-tasks/{task_id}/artifacts")
async def get_task_artifacts(task_id: str, ctx=Depends(get_tenant_context)):
    """获取任务输出的 Artifact 解析结果"""
    task = await task_store.get(task_id, ctx.tenant_id)
    if not task:
        raise HTTPException(404)
    classifier = ArtifactClassifier()
    return {"task_id": task_id, "artifacts": classifier.enrich_task_output(task)["artifacts"]}
```

### 前端组件结构（TypeScript/React）

```typescript
// src/components/ArtifactRenderer.tsx

interface Artifact {
  type: 'text' | 'code' | 'mermaid' | 'html' | 'svg' | 'table_csv' | 'json_data' | 'markdown_rich' | 'image_url'
  content: string
  language?: string
  title?: string
}

// 各类型渲染策略：
// code       → react-syntax-highlighter + 一键复制按钮
// mermaid    → mermaid.js 渲染 + 导出 PNG
// html       → <iframe sandbox> 安全预览
// svg        → 内联 SVG + 缩放控制
// table_csv  → Papa.parse 解析 → TanStack Table
// markdown_rich → react-markdown + remark-gfm + rehype-katex
// image_url  → <img> + 灯箱
```

### 前端页面集成位置

```
/operations/tasks/[task_id]
  └── 任务输出区
        ├── 原始 Markdown（折叠默认）
        └── Artifact 渲染区（默认展开）
              ├── [代码块] → 语法高亮 + 复制
              ├── [Mermaid] → 图形渲染 + 导出
              └── [表格] → 可排序/可筛选数据表
```

---

## 验收标准

- [ ] `ArtifactClassifier.classify()` 识别 6 种类型（mermaid/html/svg/csv/code/markdown_rich）
- [ ] `enrich_task_output()` 为龙虾输出追加 `artifacts` 字段
- [ ] `GET /api/v1/lobster-tasks/{task_id}/artifacts` API 正常返回
- [ ] 前端 `ArtifactRenderer` 组件正确渲染代码（语法高亮+复制）
- [ ] Mermaid 图渲染（流程图/序列图/甘特图）
- [ ] CSV 表格自动解析为可交互表格
- [ ] HTML 预览在 sandboxed iframe 中运行（安全）

---

*Codex Task | 来源：OPENWEBUI_BORROWING_ANALYSIS.md P1-1 | 2026-04-02*
