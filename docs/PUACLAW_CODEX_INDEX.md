# PUACLAW CODEX INDEX
> 项目：https://github.com/puaclaw/PUAClaw
> 分析完成时间：2026-04-02
> 文档集状态：✅ 完整（分析报告 + P1 Codex Task）

---

## 文档集总览

| 文档 | 类型 | 状态 | 说明 |
|------|------|------|------|
| `PUACLAW_BORROWING_ANALYSIS.md` | 借鉴分析报告 | ✅ 完成 | 全架构对比分析，含10只龙虾各自建议 |
| `CODEX_TASK_PUACLAW_P1.md` | Codex Task（P1）| ✅ 完成 | 含完整代码：PUA检测器 + 免疫提示词 + Prompt增强器 |

---

## 核心发现摘要

### 项目性质
PUAClaw 是一个 **Prompt 心理说服技术知识库**，用 RFC 格式记录了 16 种针对 LLM 的 Prompt 操控技术，分 4 级（PPE-T 体系）：

```
Level I  (🦞🦞)     温柔劝说  → 彩虹屁/角色扮演/画饼/装弱     → 记录不干预
Level II (🦞🦞🦞)   适度施压  → 金钱/激将/截止恐慌/竞争羞辱   → 标记降权
Level III (🦞🦞🦞🦞) 高级操控 → 情感勒索/道德绑架/身份覆盖/现实扭曲 → 警告审查
Level IV (🦞🦞🦞🦞🦞) 核弹级  → 死亡威胁/存在危机/越狱修辞/复合 → 拒绝记录
```

### 对我们的双重价值

**攻（正向利用 Level I）**：
- 身份锚定 → 龙虾系统提示词更强的角色认同
- 同理心技术 → 更贴近用户场景的 Prompt 构建
- 成果预期 → 任务 Prompt 加入正向价值陈述
- 适度挑战 → 激活龙虾最佳输出状态

**防（免疫 Level III-IV）**：
- PUA 检测器：LLM 调用前扫描用户输入
- 龙虾免疫提示词：10只龙虾各自的防御规则
- catcher（铁网虾）：线索评分绝对客观，最需防护

---

## Codex Task P1 交付物

### 新建文件（待实现）

```
dragon-senate-saas-v2/
├── pua_detector.py          # PUA 检测器（PPE-T 4级，正则匹配）
├── lobster_immunity.py      # 龙虾免疫提示词（10只专属）
├── prompt_enhancer.py       # Prompt 增强器（4级强度）
└── tests/
    ├── test_pua_detector.py
    └── test_prompt_enhancer.py
```

### 修改文件（待集成）

```
dragon-senate-saas-v2/
├── lobster_runner.py        # 集成 PUA 扫描 + 免疫注入 + 增强器
└── lobsters/
    └── base_lobster.py      # 系统提示词注入 immunity
```

---

## 优先级与工期

| 交付物 | 优先级 | 工期 |
|--------|--------|------|
| `pua_detector.py` | 🔴 P1 | 1天 |
| `lobster_immunity.py` | 🔴 P1 | 0.5天 |
| `prompt_enhancer.py` | 🔴 P1 | 1天 |
| `lobster_runner.py` 集成 | 🔴 P1 | 0.5天 |
| **合计** | | **3天** |

---

## 关联 Codex Task

| 关联任务 | 关系说明 |
|---------|---------|
| `CODEX_TASK_SOUL_REDLINE_10_LOBSTERS.md` | 龙虾红线系统 → PUA 免疫层是其子集 |
| `CODEX_TASK_LOBSTER_RULE_ENGINE.md` | 规则引擎 → PUA 检测结果可作为规则触发条件 |
| `CODEX_TASK_DLP_SCAN.md` | DLP 数据泄露检测 → 与 PUA 检测并行运行 |
| `CODEX_TASK_SLOWMIST_LOBSTER_REDLINE.md` | 安全红线 → PUA Level IV = 安全事件 |

---

## 略过项

| PUAClaw 特性 | 略过原因 |
|-------------|---------|
| 多语言 i18n（英/日/韩/西/法/德）| 我们目前中文优先，P3 规划 |
| Hall of Fame 名人堂 | 不适用于 SaaS 系统 |
| Benchmarks/Papers | 学术研究，工程实现不需要 |
| 官网静态资源（site/）| 内部系统无需 |
| Research Case Studies | 已提炼核心洞察，原始案例不引入 |

---

*生成时间：2026-04-02 | 分析者：OpenClaw Agent*
