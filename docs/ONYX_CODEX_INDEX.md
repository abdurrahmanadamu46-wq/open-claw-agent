# ONYX 借鉴落地索引

**分析日期**：2026-04-02  
**来源**：https://github.com/onyx-dot-app/onyx（⭐20.4k）  
**定位**：Open Source AI Platform — 企业知识库 + AI Chat + 50+ 数据连接器

---

## 生成文件清单

| 文件 | 类型 | 状态 |
|------|------|------|
| `docs/ONYX_BORROWING_ANALYSIS.md` | 分析报告 | ✅ 已生成 |
| `docs/CODEX_TASK_LOBSTER_CONFIG_CENTER.md` | P1 Codex Task | ✅ 已生成 |
| `docs/CODEX_TASK_EMBED_WIDGET.md` | P1 Codex Task | ✅ 已生成 |
| `docs/CODEX_TASK_QUERY_EXPANDER.md` | P1 Codex Task | ✅ 已生成 |
| `docs/CODEX_TASK_ONYX_P2.md` | P2 合并 Codex Task（5项）| ✅ 已生成 |

---

## P1 任务执行顺序

```
1. CODEX_TASK_LOBSTER_CONFIG_CENTER  ← 龙虾配置中心（一站式配置页）
2. CODEX_TASK_EMBED_WIDGET           ← 嵌入式对话小部件（echoer 接待访客→线索推catcher）
3. CODEX_TASK_QUERY_EXPANDER         ← 查询意图扩展（Commander 分发前扩展子查询）
```

## P2 任务（顺序执行）

```
CODEX_TASK_ONYX_P2.md 包含：
  P2-1: ConnectorCredentialStore   ← 飞书/企微/钉钉 OAuth token 加密存储+自动刷新
  P2-2: LobsterEvalCLI             ← 龙虾输出质量离线评测 CLI
  P2-3: QuotaLimitsPage            ← Token 速率限制管理 UI
  P2-4: ContentCitationProcessor   ← 龙虾产出内容来源引用标注
  P2-5: DeepResearchRunner         ← radar 龙虾深度研究模式（多轮调研→汇总报告）
```

---

## 已跳过项（我们更好）

| 功能 | 跳过原因 |
|------|---------|
| Feature Flag 系统 | 我们 Unleash 方案更完整 |
| 对话上下文压缩 | 我们 lossless 方案已落地 |
| LLM 路由 | 我们 ProviderRegistry + failover 已足够 |
| Celery 后台任务 | BullMQ 更适合我们的 Node.js 生态 |

---

*更新于 2026-04-02*
