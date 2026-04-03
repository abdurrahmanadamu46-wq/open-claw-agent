# CODEX-AA-02: 龙虾输出格式模板系统

> **优先级**: P1 | **算力**: 低 | **来源**: `docs/AWESOME_AGENTS_BORROWING_ANALYSIS.md`
> **依赖**: CODEX-AA-01 (role-card.json 新增 `outputFormats` 字段后本任务消费)
> **涉及文件**: `packages/lobsters/lobster-*/role-card.json`、`dragon-senate-saas-v2/lobsters/base_lobster.py`、`dragon-senate-saas-v2/lobster_runner.py`

---

## 背景

当前龙虾的输出没有标准格式规范。同一只龙虾处理不同场景时，输出风格不一致：有时是纯文本、有时是 JSON、有时是表格。这导致：
1. 下游龙虾解析困难
2. 前端展示无法统一渲染
3. 人类审核效率低

参考 Awesome OpenClaw Agents 中 `competitor-watch` (Scout) 的 4 种报告格式设计：Alert / Weekly Digest / Comparison / Trend Analysis，每种格式都有明确的结构模板。

## 目标

为每只龙虾定义**标准输出格式模板**，让每种工件类型都有对应的结构化输出规范。

## 交付物

### 1. 输出格式类型定义

每只龙虾支持以下 4 种通用格式（可按虾扩展）：

| 格式类型 | 用途 | 结构 |
|---------|------|------|
| `alert` | 实时告警/通知 | 一行摘要 + 影响 + 建议动作 |
| `digest` | 周期性汇总报告 | 标题 + 变化清单表格 + 趋势分析 + 建议 |
| `comparison` | 对比分析 | 多维对比表格 + 结论 |
| `analysis` | 深度分析 | 数据发现 → 趋势解读 → 可执行建议 |

### 2. 每虾格式模板

在 CODEX-AA-01 落地的 `role-card.json` 的 `outputFormats` 字段中，为每虾定制：

#### 触须虾 (radar)
```json
{
  "outputFormats": {
    "alert": "🔔 [{severity}] {event_summary} — 影响: {impact} — 建议: {suggested_action}",
    "digest": "## {period} 信号摘要\n\n| 信号源 | 事件 | 影响级别 | 建议动作 |\n|--------|------|---------|----------|\n{rows}\n\n### 趋势分析\n{trend}\n\n### 下周关注\n{watchlist}",
    "comparison": "## 竞品对比 ({date})\n\n| 维度 | {brand} | {competitor_1} | {competitor_2} |\n|------|---------|---------------|---------------|\n{rows}\n\n**结论**: {conclusion}",
    "analysis": "## 深度分析: {topic}\n\n### 数据发现\n{findings}\n\n### 趋势解读\n{interpretation}\n\n### 可执行建议\n{recommendations}"
  }
}
```

#### 脑虫虾 (strategist)
```json
{
  "outputFormats": {
    "alert": "⚡ 策略调整通知: {change_summary} — 原因: {reason} — 生效时间: {effective}",
    "digest": "## {period} 策略执行报告\n\n| 策略 | 状态 | 预期 KPI | 实际 KPI | 偏差 |\n|------|------|---------|---------|------|\n{rows}\n\n### 下期调整\n{adjustments}",
    "comparison": "## 方案对比\n\n| 维度 | 方案 A | 方案 B | 方案 C |\n|------|--------|--------|--------|\n{rows}\n\n**推荐**: {recommendation}\n**理由**: {rationale}",
    "analysis": "## 策略效果分析\n\n### 核心数据\n{metrics}\n\n### 归因分析\n{attribution}\n\n### 优化建议\n{suggestions}"
  }
}
```

#### 吐墨虾 (inkwriter)
```json
{
  "outputFormats": {
    "alert": "📝 内容更新: {content_type} — 状态: {status} — 下一步: {next}",
    "digest": "## {period} 内容产出报告\n\n| 平台 | 数量 | 类型 | 审核状态 |\n|------|------|------|----------|\n{rows}",
    "comparison": "## 文案版本对比\n\n| 版本 | 风格 | 关键卖点 | 适合平台 |\n|------|------|---------|----------|\n{rows}",
    "analysis": "## 内容效果分析\n\n### 高转化文案特征\n{high_performers}\n\n### 低效文案问题\n{low_performers}\n\n### 优化方向\n{direction}"
  }
}
```

#### 幻影虾 (visualizer)
```json
{
  "outputFormats": {
    "alert": "🎨 视觉素材更新: {asset_type} — 状态: {status}",
    "digest": "## {period} 视觉产出汇总\n\n| 素材类型 | 数量 | 平台 | 状态 |\n|---------|------|------|------|\n{rows}",
    "comparison": "## 视觉方案对比\n\n| 方案 | 风格 | 尺寸 | 适用场景 | 预览 |\n|------|------|------|---------|------|\n{rows}",
    "analysis": "## 视觉效果分析\n\n### 高互动素材特征\n{findings}\n\n### 建议\n{recommendations}"
  }
}
```

#### 点兵虾 (dispatcher)
```json
{
  "outputFormats": {
    "alert": "📡 发布状态: {platform}/{account} — {status} — {detail}",
    "digest": "## {period} 发布执行报告\n\n| 平台 | 账号 | 计划发布 | 实际发布 | 成功率 |\n|------|------|---------|---------|--------|\n{rows}",
    "comparison": "## 发布时段效果对比\n\n| 时段 | 发布量 | 平均互动 | 最佳内容 |\n|------|--------|---------|----------|\n{rows}",
    "analysis": "## 发布策略分析\n\n### 最佳发布时段\n{timing}\n\n### 账号轮转效率\n{rotation}\n\n### 建议\n{recommendations}"
  }
}
```

#### 回声虾 (echoer)
```json
{
  "outputFormats": {
    "alert": "💬 高意向评论: [{platform}] {user}: \"{comment}\" — 建议回复: {reply}",
    "digest": "## {period} 互动报告\n\n| 平台 | 新评论 | 已回复 | 私信转化 | 高意向 |\n|------|--------|--------|---------|--------|\n{rows}",
    "comparison": "## 回复策略效果对比\n\n| 策略 | 回复率 | 转化率 | 用户满意度 |\n|------|--------|--------|------------|\n{rows}",
    "analysis": "## 互动分析\n\n### 热门话题\n{topics}\n\n### 用户情感分布\n{sentiment}\n\n### 回复优化建议\n{suggestions}"
  }
}
```

#### 铁网虾 (catcher)
```json
{
  "outputFormats": {
    "alert": "🎯 新线索: [{score}/100] {contact} — 来源: {source} — 意向: {intent}",
    "digest": "## {period} 线索报告\n\n| 来源 | 新线索 | 高分(≥80) | 已入CRM | 去重 |\n|------|--------|-----------|---------|------|\n{rows}",
    "comparison": "## 线索来源质量对比\n\n| 来源 | 线索量 | 平均分 | 转化率 | ROI |\n|------|--------|--------|--------|-----|\n{rows}",
    "analysis": "## 线索质量分析\n\n### 高价值画像\n{profiles}\n\n### 转化瓶颈\n{bottlenecks}\n\n### 建议\n{recommendations}"
  }
}
```

#### 金算虾 (abacus)
```json
{
  "outputFormats": {
    "alert": "📊 KPI 异常: {metric} 偏差 {deviation}% — 原因: {cause} — 建议: {action}",
    "digest": "## {period} 增长复盘\n\n| 指标 | 目标 | 实际 | 达成率 | 环比 |\n|------|------|------|--------|------|\n{rows}\n\n### 归因分析\n{attribution}",
    "comparison": "## 渠道 ROI 对比\n\n| 渠道 | 投入 | 产出 | ROI | 趋势 |\n|------|------|------|-----|------|\n{rows}",
    "analysis": "## 增长策略效果分析\n\n### 核心数据\n{core_metrics}\n\n### 多触点归因\n{attribution}\n\n### 优化建议\n{suggestions}"
  }
}
```

#### 回访虾 (followup)
```json
{
  "outputFormats": {
    "alert": "📞 跟进提醒: {contact} — 上次接触: {last_contact} — 建议: {action}",
    "digest": "## {period} 跟进报告\n\n| 客户 | 触点次数 | 最近状态 | 下次计划 | 预估转化 |\n|------|---------|---------|---------|----------|\n{rows}",
    "comparison": "## 跟进策略效果对比\n\n| 策略 | 客户数 | 转化率 | 平均周期 |\n|------|--------|--------|----------|\n{rows}",
    "analysis": "## 跟进效果分析\n\n### 最佳跟进节奏\n{timing}\n\n### 流失原因\n{churn_reasons}\n\n### 优化建议\n{suggestions}"
  }
}
```

### 3. Python 运行时消费

在 `lobster_runner.py` 中，根据当前任务类型自动选择输出格式：

```python
def select_output_format(lobster: BaseLobster, task_type: str) -> str | None:
    """Select the appropriate output format template for a task type."""
    format_map = {
        "alert": ["risk_event", "threshold_breach", "urgent_notification"],
        "digest": ["weekly_report", "periodic_summary", "daily_recap"],
        "comparison": ["competitor_compare", "ab_test_result", "channel_compare"],
        "analysis": ["deep_analysis", "root_cause", "strategy_review"],
    }
    for fmt, task_types in format_map.items():
        if task_type in task_types:
            return lobster.output_formats.get(fmt)
    return None
```

### 4. 前端对齐

前端工程师需要做的：
- 工件详情页读取 `outputFormats` 字段，按 Markdown 模板渲染
- 在龙虾配置面板中展示 4 种输出格式的预览
- 支持通过 `format` 参数切换不同输出视图

```typescript
// 工件渲染时
const format = artifact.metadata?.format || "analysis";
const template = roleCard.outputFormats?.[format];
if (template) {
  // 用 artifact 数据填充模板变量，渲染为 Markdown
  const rendered = renderTemplate(template, artifact.data);
}
```

---

## 约束

- 格式模板使用 Markdown 语法，支持表格/标题/列表
- 模板变量使用 `{variable_name}` 占位符
- 每种格式的表头字段与对应龙虾的 `outputContract` 对齐
- 不强制所有输出都使用模板——模板是建议格式，LLM 可以适当调整

## 验收标准

1. 9 只龙虾的 `role-card.json` 各包含 `outputFormats` 字段，每个至少 4 种格式
2. `BaseLobster` 的 `output_formats` 属性正确返回格式字典
3. `lobster_runner.py` 包含 `select_output_format()` 函数
4. 前端 `RoleCardExtended` 接口包含 `outputFormats` 字段定义
