# CODEX-PC-03: AI 协作规范文档

> **优先级**: P1 | **算力**: 低 | **来源**: `docs/PUACLAW_BORROWING_ANALYSIS.md`
> **关联**: 补充 `PROJECT_CONTROL_CENTER.md`（PCC 偏项目状态，本文档偏行为规范）
> **产出文件**: `CODEBASE_AI_SPEC.md`（项目根目录）

---

## 背景

PUAClaw 有一份 10KB 的 `CLAUDE.md`，完整定义了项目的写作风格、角色行为规范、架构决策记录（14 条 ADR）、i18n 策略、文件命名规范。任何 AI 助手读完这份文件就能高质量产出符合项目风格的内容。

我们有 `PROJECT_CONTROL_CENTER.md` 作为项目总控，但它侧重"项目是什么、进展到哪"，缺少"**代码怎么写、龙虾怎么命名、架构决策为什么这样做**"的规范。新的 AI 助手接力时，每次都要重新推断编码风格，产出不一致。

## 目标

创建 `CODEBASE_AI_SPEC.md`，让任何 AI 编码助手在 5 分钟内了解本项目的编码规范、命名约定、架构决策和红线约束。

## 交付物

### `CODEBASE_AI_SPEC.md`

在项目根目录创建，内容包含以下 8 个章节：

```markdown
# CODEBASE_AI_SPEC — AI 协作规范

> 本文件供 AI 编码助手阅读。与 PROJECT_CONTROL_CENTER.md 互补：
> - PCC = 项目是什么、进展到哪
> - 本文件 = 代码怎么写、为什么这样写

---

## 一、编码风格规范

### Python (dragon-senate-saas-v2/)
- 格式化: black + isort
- 类型注解: 所有公开函数必须有类型注解
- 文档字符串: Google style
- 命名: snake_case，类用 PascalCase
- 异步: 优先 async/await，同步代码用 `run_in_executor`
- 导入顺序: stdlib → third-party → local，之间空行
- 每个模块开头的三引号注释必须包含一句话说明 + 借鉴来源（如有）

### TypeScript (packages/ + src/ + web/)
- 格式化: prettier
- 类型: 严格模式，禁止 `any`（除 API 边界）
- 命名: camelCase 变量/函数，PascalCase 类型/接口，kebab-case 文件名
- 导出: 用 named export，避免 default export（除 Next.js 页面）
- JSON 配置文件: 2 空格缩进，key 用 snake_case

## 二、龙虾命名约定

### canonical_id 规则
- 全小写英文单词，无下划线无连字符
- 对应表: radar / strategist / inkwriter / visualizer / dispatcher / echoer / catcher / abacus / followup
- Commander 的 canonical_id = "commander"

### 文件/目录命名
- Python 模块: `lobsters/{canonical_id}.py`
- TS 包目录: `packages/lobsters/lobster-{canonical_id}/`
- role-card: `packages/lobsters/lobster-{canonical_id}/role-card.json`
- SOUL 文件: `packages/lobsters/lobster-{canonical_id}/SOUL.md`
- Prompt 资产: `packages/lobsters/lobster-{canonical_id}/prompts/`
- 测试文件: `dragon-senate-saas-v2/tests/test_{module_name}.py`

### 技能 ID 规则
- 格式: `{canonical_id}_{skill_verb}_{object}`
- 示例: `radar_web_search`, `inkwriter_copy_generate`, `echoer_reply_generate`
- 全小写 + 下划线分隔

### Prompt 模板 ID 规则
- 格式: `{canonical_id}.{platform}.{scene}.v{version}`
- 示例: `inkwriter.xiaohongshu.product-review.v1`

## 三、架构决策记录 (ADR)

### ADR-001: TS = 设计时真相源，Python = 运行时执行引擎
- **决策**: role-card / workflow-catalog / 行业模板等定义存放在 TS 侧，Python 运行时读取而非硬编码
- **原因**: 前端工程师可以直接编辑 JSON/TS 配置，不需要动 Python 代码
- **影响**: 新增龙虾配置时，先在 packages/lobsters/ 创建，再让 Python 侧读取

### ADR-002: Commander 不替龙虾干活
- **决策**: Commander 只做编排/路由/仲裁，不直接调用 LLM 生成内容
- **原因**: 避免 Commander 成为瓶颈，保持龙虾的专业独立性
- **影响**: Commander 的技能是编排能力（目标拆解/阵容选择/异常处理），不包含业务技能

### ADR-003: HITL 默认
- **决策**: 所有关键动作（发布/私信/线索入库）默认需要人类确认
- **原因**: SaaS 客户的品牌安全优先于效率
- **影响**: 每个龙虾输出都有 approval gate，策略强度 L1-L2 可自动执行的范围有限

### ADR-004: 边缘只执行，不做业务决策
- **决策**: edge-runtime 是"提线木偶"，只接收云端指令执行浏览器操作
- **原因**: 安全隔离，业务逻辑集中在云端便于审计
- **影响**: edge-runtime 不包含 LLM 调用，不解析业务语义

### ADR-005: 审计优先于性能
- **决策**: 所有 LLM 调用、龙虾动作、审批操作都记录审计日志
- **原因**: SaaS 合规要求，客户可追溯每一次 AI 决策
- **影响**: `audit_logger.py` / `lobster_event_bus.py` 是必经路径

### ADR-006: Provider 可插拔
- **决策**: LLM Provider 通过 `provider_registry.py` 动态注册，不硬编码
- **原因**: 客户可能使用不同的 LLM（OpenAI / Claude / 国产大模型）
- **影响**: 龙虾不直接调用 LLM SDK，而是通过 Provider 抽象层

### ADR-007: 技能可插拔
- **决策**: 龙虾技能通过 `lobster_skill_registry.py` 注册，支持运行时启用/禁用
- **原因**: 不同客户需要不同技能组合
- **影响**: 新增技能不需要改龙虾核心代码，只需注册

### ADR-008: Prompt 作为一等资产
- **决策**: Prompt 模板存放在独立文件（`.prompt.md`），不硬编码在 Python 中
- **原因**: Prompt 需要版本管理、A/B 测试、行业适配
- **影响**: `prompt_asset_loader.py` 从文件系统加载，支持热更新

### ADR-009: 策略强度分级
- **决策**: 4 级策略强度（观察→试探→主攻→极限），控制龙虾的自主权和资源上限
- **原因**: 不同业务阶段需要不同的风险偏好
- **影响**: `strategy-intensity-framework.json` 定义每级参数

### ADR-010: WebSocket 长连接 + Webhook 回调 双通道
- **决策**: 边缘端通过 WSS 长连接接收指令，通过 Webhook 回报结果
- **原因**: WSS 适合实时指令，Webhook 适合异步结果
- **影响**: `ws_connection_manager.py` + `lobster_webhook.py`

## 四、禁止操作清单 (Don't List)

1. ❌ 不要在 Python 代码中硬编码 Prompt 字符串（用 prompt_asset_loader）
2. ❌ 不要在龙虾模块中直接调用 LLM SDK（用 provider_registry）
3. ❌ 不要让 Commander 执行业务逻辑（它只编排）
4. ❌ 不要在 edge-runtime 中加入 LLM 调用
5. ❌ 不要跳过 audit_logger 记录关键操作
6. ❌ 不要在 API 返回中暴露 api_key / secret / token
7. ❌ 不要使用 `any` 类型（TS 侧，除 API 边界）
8. ❌ 不要创建新的龙虾目录而不同时创建 role-card.json

## 五、文件创建检查清单

创建新龙虾时必须包含：
- [ ] `packages/lobsters/lobster-{id}/role-card.json`
- [ ] `packages/lobsters/lobster-{id}/SOUL.md`
- [ ] `packages/lobsters/lobster-{id}/AGENTS.md`
- [ ] `packages/lobsters/lobster-{id}/prompts/prompt-catalog.json`
- [ ] `dragon-senate-saas-v2/lobsters/{id}.py`
- [ ] `dragon-senate-saas-v2/tests/test_{id}.py`
- [ ] 在 `lobster_skill_registry.py` 中注册技能
- [ ] 在 `lobsters-registry.json` 中注册

创建新技能时必须包含：
- [ ] 在 `lobster_skill_registry.py` 注册 `LobsterSkill`
- [ ] 至少 1 个 `.prompt.md` 模板文件
- [ ] 更新 `prompt-catalog.json`
- [ ] 在对应龙虾的测试文件中增加测试

## 六、Git 提交规范

格式: `{type}({scope}): {description}`

类型:
- `feat`: 新功能
- `fix`: 修复
- `refactor`: 重构
- `docs`: 文档
- `test`: 测试
- `chore`: 工具/配置

Scope:
- `commander` / `radar` / `strategist` / `inkwriter` / `visualizer` / `dispatcher` / `echoer` / `catcher` / `abacus` / `followup`
- `edge` / `saas` / `web` / `api` / `infra`

示例: `feat(inkwriter): add xiaohongshu prompt templates`

## 七、测试规范

- 每个新 Python 模块必须有对应的 `tests/test_*.py`
- 测试使用 pytest
- Mock 外部依赖（LLM / API / 数据库）
- 覆盖率目标: 核心模块 > 80%

## 八、前端工程师对齐点

当 Python 侧新增以下内容时，前端需要同步：

| Python 变更 | 前端影响 | 对齐文件 |
|------------|---------|---------|
| 新增龙虾 | 龙虾列表/详情页 | role-card.json |
| 新增技能 | 技能管理面板 | lobster_skill_registry.py |
| 新增 Prompt 模板 | Prompt 预览/选择 | prompt-catalog.json |
| 策略强度变更 | 强度级别徽章 | strategy-intensity-framework.json |
| 新增 API 端点 | 前端接口调用 | app.py |
| 输出格式变更 | 工件渲染 | role-card.json → outputFormats |
```

## 约束

- 本文件不超过 15KB（保持可在 5 分钟内通读）
- 不重复 PCC 中已有的项目状态/路线图信息
- ADR 编号从 001 开始连续递增，新增 ADR 追加到末尾
- 任何架构层面的决策变更必须同步更新本文件

## 验收标准

1. `CODEBASE_AI_SPEC.md` 存在于项目根目录
2. 包含完整的 8 个章节
3. ADR 至少 10 条且与实际代码一致
4. "禁止操作清单"至少 8 条
5. "文件创建检查清单"覆盖龙虾和技能两种场景
6. 新的 AI 助手读完本文件 + PCC 后，能在不问人的情况下正确创建一只新龙虾的完整文件集
