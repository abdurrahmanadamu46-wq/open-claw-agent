# CODEX TASK: Prompt 版本 Diff 对比视图

**优先级：P2**  
**来源：OPIK_BORROWING_ANALYSIS.md P2-#3（Opik Prompt Diff View）**

---

## 背景

`prompt_registry.py` 已有 prompt 版本管理，但缺少可视化 diff，团队无法快速理解"v2.3 改了哪里"。新增后端 diff API + 前端并排 diff 展示，与 ExperimentRegistry 联动（哪次改动带来了分数提升）。

---

## 实现

```python
# dragon-senate-saas-v2/api_prompt_diff.py

import difflib
from fastapi import APIRouter, Depends

router = APIRouter(prefix="/api/v1/prompts")

@router.get("/{prompt_name}/diff")
async def get_prompt_diff(
    prompt_name: str,
    version_a: str,  # e.g. "v2.2"
    version_b: str,  # e.g. "v2.3"
    ctx=Depends(get_tenant_context),
):
    """返回两个 prompt 版本的 unified diff"""
    text_a = prompt_registry.get(prompt_name, version_a).content.splitlines(keepends=True)
    text_b = prompt_registry.get(prompt_name, version_b).content.splitlines(keepends=True)

    diff = list(difflib.unified_diff(
        text_a, text_b,
        fromfile=f"{prompt_name}@{version_a}",
        tofile=f"{prompt_name}@{version_b}",
        lineterm="",
    ))

    # 解析 diff 为结构化格式（方便前端高亮渲染）
    hunks = _parse_unified_diff(diff)
    return {
        "prompt_name": prompt_name,
        "version_a": version_a,
        "version_b": version_b,
        "hunks": hunks,
        "stats": {
            "added": sum(1 for h in hunks for l in h["lines"] if l["type"] == "add"),
            "removed": sum(1 for h in hunks for l in h["lines"] if l["type"] == "remove"),
        },
    }

def _parse_unified_diff(diff_lines: list[str]) -> list[dict]:
    """将 unified diff 文本解析为结构化 hunk 列表"""
    hunks = []
    current_hunk = None
    for line in diff_lines:
        if line.startswith("@@"):
            if current_hunk:
                hunks.append(current_hunk)
            current_hunk = {"header": line, "lines": []}
        elif current_hunk is not None:
            if line.startswith("+"):
                current_hunk["lines"].append({"type": "add", "content": line[1:]})
            elif line.startswith("-"):
                current_hunk["lines"].append({"type": "remove", "content": line[1:]})
            else:
                current_hunk["lines"].append({"type": "context", "content": line[1:]})
    if current_hunk:
        hunks.append(current_hunk)
    return hunks
```

```typescript
// web/src/components/prompts/PromptDiffView.tsx
export function PromptDiffView({ promptName, versionA, versionB }: Props) {
  const { data } = useQuery({
    queryKey: ["prompt-diff", promptName, versionA, versionB],
    queryFn: () => api.getPromptDiff(promptName, versionA, versionB),
    enabled: !!(versionA && versionB),
  });

  return (
    <div className="font-mono text-sm border rounded overflow-auto max-h-96">
      <div className="flex justify-between px-3 py-2 bg-muted text-xs text-muted-foreground border-b">
        <span className="text-red-500">{versionA}</span>
        <span className="text-muted-foreground">
          -{data?.stats.removed} / +{data?.stats.added}
        </span>
        <span className="text-green-600">{versionB}</span>
      </div>
      {data?.hunks.map((hunk, i) => (
        <div key={i}>
          <div className="px-3 py-1 bg-blue-50 dark:bg-blue-950 text-blue-600 text-xs">{hunk.header}</div>
          {hunk.lines.map((line, j) => (
            <div key={j} className={cn("px-3 py-0.5",
              line.type === "add" && "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200",
              line.type === "remove" && "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200",
            )}>
              <span className="select-none mr-2 opacity-40">
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              {line.content}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

---

## 验收标准

- [ ] `GET /prompts/{name}/diff?version_a=&version_b=`：返回结构化 diff hunks
- [ ] `_parse_unified_diff()`：正确解析 add/remove/context 三种行类型
- [ ] 前端 `PromptDiffView`：绿色新增行 / 红色删除行 / 灰色上下文行
- [ ] 在 Prompt 历史页面集成版本选择器 + 触发 diff
- [ ] 在 ExperimentRegistry 详情页显示关联 prompt diff 链接

---

*Codex Task | 来源：OPIK_BORROWING_ANALYSIS.md P2-#3 | 2026-04-02*
