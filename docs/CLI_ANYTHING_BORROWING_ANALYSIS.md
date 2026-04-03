# CLI-Anything 借鉴分析报告
> 来源：https://github.com/HKUDS/CLI-Anything
> 分析日期：2026-04-02
> 定性：**让任何 GUI 软件对 AI Agent 变成可操作的 CLI 工具框架**

---

## 一、项目全景速览

CLI-Anything 是香港大学数据科学与分析实验室（HKUDS）开发的开源框架，核心使命：
**"Today's Software Serves Humans. Tomorrow's Users will be Agents."**

### 项目规模
- **已覆盖软件**：Blender、ComfyUI、Audacity、Shotcut、Browser、Zoom、Zotero、FreeCAD、DrawIO、RenderDoc、AdGuardHome、VideoCapt ion等 16+ 款
- **测试通过率**：1,839 个测试 100% 通过
- **架构模式**：统一的 `agent-harness` 结构 + `SKILL.md` 技能描述文件 + 双模式 CLI（REPL + 子命令）

### 核心架构三件套
```
每个软件的 agent-harness/
├── cli_anything/<software>/
│   ├── core/              ← 业务逻辑层（状态/操作/会话）
│   ├── utils/
│   │   ├── <software>_backend.py  ← 真实软件调用适配器
│   │   └── repl_skin.py           ← 统一 REPL 界面皮肤
│   ├── skills/
│   │   └── SKILL.md       ← Agent 可读的技能描述（YAML frontmatter）
│   └── tests/
│       ├── test_core.py   ← 单元测试
│       └── test_full_e2e.py ← 端到端测试
└── setup.py
```

---

## 二、7层对比分析

### L1：前端（SaaS 主控台）

| CLI-Anything 有 | 我们有 | 借鉴机会 |
|-----------------|--------|---------|
| CLI-Hub 网页（展示所有已注册 CLI 技能） | `/operations/skills-pool` 技能市场页 | 🔴 **SKILL.md 标准化格式**：用 YAML frontmatter 描述技能触发条件，可直接被 Agent 读取 |
| `registry.json` 技能中心注册表 | `lobster_skill_registry.py` | 🔴 **技能注册表 JSON 标准**：统一的 `name/description/version/command_groups` Schema |
| 技能安装 `cli-anything install <skill>` | 无 | 🟡 技能热安装命令（MVP 阶段可暂缓） |

**最大收获**：SKILL.md 的 YAML frontmatter 格式 → 直接对应我们的龙虾 KB skills.json，可以大幅升级描述标准化程度。

---

### L2：云端大脑（Commander 指挥层）

| CLI-Anything 有 | 我们有 | 借鉴机会 |
|-----------------|--------|---------|
| HARNESS.md 的 7阶段 SOP（分析→设计→实现→测试→技能→发布→优化） | commander KB | 🔴 **将 7阶段 SOP 写入 Commander 的决策模板**，让它在下发执行计划时更系统化 |
| "先 probe/info，再 mutation" 铁律 | 无明确规定 | 🔴 **龙虾执行铁律补充**：先查再改，降低不可逆操作风险 |
| 自动判断用 REPL 还是子命令模式 | 无 | 🟡 ExecutionPlan 增加 `execution_mode: repl/oneshot` 字段 |

---

### L3：9只龙虾（业务执行层）

CLI-Anything 的每个 `core/` 模块和我们的龙虾职责高度对应：

| CLI-Anything 模块 | 对应龙虾 | 借鉴机会 |
|-------------------|---------|---------|
| `core/session.py`（会话管理，JSON 序列化+文件锁） | 所有龙虾 | 🔴 **龙虾会话 JSON 锁定写入**：防止并发写坏状态文件 |
| `core/project.py`（项目状态探测） | Commander | 🔴 **"先 probe 再 mutate" 两段式执行**：probe 阶段输出结构化 JSON，mutation 阶段依赖 probe 结果 |
| `skills/SKILL.md`（每个技能 YAML 前置描述） | 龙虾 KB skills.json | 🔴 **龙虾技能描述 YAML 化**：name/description/triggers/examples 标准字段 |
| `eval/` 目录（每个 CLI 独立评估套件） | 无专门评估模块 | 🟡 **龙虾技能评估套件**：每个技能有标准 eval 任务集，自动化评分 |
| `utils/repl_skin.py`（统一 REPL 皮肤） | 无 | 🟡 龙虾 REPL 调试模式（边缘端交互调试用） |
| `test_full_e2e.py`（端到端测试） | `tests/` 已有少量 | 🟡 每只龙虾标准 E2E 测试套件 |

**针对具体龙虾的改进建议**：

```
Dispatcher（点兵虾）← 最受益
  借鉴 ComfyUI 的 core/queue.py → 为 ExecutionPlan 增加队列优先级字段
  借鉴 Browser CLI 的 core/session.py → 边缘端 session 文件锁定

Visualizer（幻影虾）← 次受益
  借鉴 ComfyUI CLI 的 core/workflows.py → 图像生成工作流模板管理
  借鉴 ComfyUI CLI 的 core/models.py → 模型选择与版本控制
  借鉴 Shotcut CLI 的 core/export.py → 视频导出参数标准化

Radar（触须虾）← 可借鉴
  借鉴 Zotero CLI 的 core/discovery.py → 信息发现模式（探针→分析→报告）

Inkwriter（吐墨虾）← 可借鉴
  借鉴 Audacity CLI 的 core/effects.py → 内容效果参数化（风格/语气/力度）
```

---

### L2.5：支撑微服务集群

| CLI-Anything 有 | 我们有 | 借鉴机会 |
|-----------------|--------|---------|
| `skill_generator.py`（自动从 harness 提取元数据生成 SKILL.md） | `skill_frontmatter.py` | 🔴 **技能自动生成器**：从龙虾的 Python 函数注释自动生成技能描述 YAML |
| `registry.json`（中央技能注册表，含版本/更新日期） | `lobster_skill_registry.py` | 🟡 注册表加版本控制字段 |
| `.github/scripts/generate_meta_skill.py`（CI 自动生成技能索引） | 无 CI 自动化 | 🟡 CI 自动同步技能注册表 |
| YAML frontmatter 标准（name/description/triggers） | 无统一格式 | 🔴 **龙虾技能 YAML 前置标准**（见 P1 任务） |

---

### 云边调度层

| CLI-Anything 有 | 我们有 | 借鉴机会 |
|-----------------|--------|---------|
| 两段式执行：`probe` → `mutate`（先只读探测，再确认写入） | 边缘直接执行 | 🔴 **ExecutionPlan 增加 dry_run 阶段**：dispatcher 下发前先 probe 确认可行性 |
| `guides/session-locking.md`（文件锁写入防并发）  | 无 | 🔴 **边缘 session 文件锁**：多任务并发时防写坏状态 |
| JSON 输出模式（`--json` flag）让 Agent 可解析 | 任务结果已是 JSON | 🟡 ExecutionPlan 回传结果强制 JSON Schema 校验 |

---

### L3：边缘执行层（edge-runtime）

| CLI-Anything 有 | 我们有 | 借鉴机会 |
|-----------------|--------|---------|
| `utils/<software>_backend.py`（真实软件适配器，含 shutil.which 检测） | `MarionetteExecutor`（Playwright） | 🔴 **边缘软件适配器模式**：将 Playwright 包装成标准 Backend 适配器，增加 `find_browser()` 存活检测 |
| 每个 CLI 包含 `test_core.py` + `test_full_e2e.py` | 边缘端测试不完整 | 🟡 边缘 E2E 自动化测试套件 |
| `guides/mcp-backend.md`（MCP 协议后端集成指南） | `edge-runtime/feature_flag_proxy.py` | 🔴 **边缘 MCP 服务器**（已有 CODEX_TASK_EDGE_MCP_SERVER.md，可借鉴其模式） |
| REPL 模式（stateful 交互会话） | 无边缘 REPL | 🟡 边缘调试 REPL（管理员维护用） |
| ComfyUI CLI 的 `core/queue.py` + `core/models.py` | 无模型管理 | 🔴 **边缘 ComfyUI Adapter 升级**（我们已用 ComfyUI Adapter，可对齐其接口标准） |

---

### SaaS 整体系统

| CLI-Anything 有 | 我们有 | 借鉴机会 |
|-----------------|--------|---------|
| `registry.json`（公开技能中心，社区贡献） | 私有技能注册表 | 🟡 MVP后：开放社区技能市场（OSS版本） |
| `openclaw-skill/SKILL.md`（官方支持 OpenClaw）| 已集成 | ✅ 已有关联，继续深化 |
| `.claude-plugin/marketplace.json`（Claude 插件市场）| 无 | 🟡 接入 Claude 插件生态 |
| 1,839 测试 100% 通过（高覆盖率文化） | 测试覆盖参差不齐 | 🟡 龙虾测试覆盖率专项提升 |

---

## 三、3大核心发现

### 🔴 发现1：SKILL.md YAML 前置标准 → 龙虾技能标准化革命

**CLI-Anything 的 SKILL.md**：
```yaml
---
name: comfyui
description: "ComfyUI workflow automation CLI — queue images, manage models, run workflows"
version: 1.0.0
triggers:
  - "generate image"
  - "run comfyui workflow"
  - "queue prompt"
---
```

**我们目前的 skills.json 片段**：
```json
{"skill_id": "radar_search", "name": "竞品搜索", "description": "..."}
```

**借鉴改进**：将 skills.json 升级为 YAML frontmatter 格式，增加 `triggers`（触发词）和 `examples` 字段，让龙虾可以被 Agent 通过自然语言直接调用正确的技能。

---

### 🔴 发现2：probe-then-mutate 两段式执行 → 边缘执行安全升级

**CLI-Anything 铁律**：
```
Phase 1: probe/info commands → 只读，输出 JSON 状态报告
Phase 2: mutation commands  → 写入，依赖 Phase 1 的确认
```

**我们目前**：边缘端收到 ExecutionPlan 直接执行，没有预检阶段。

**借鉴改进**：
```python
# ExecutionPlan 新增字段
{
  "dry_run": true,           # 先 probe 不实际执行
  "probe_result": {...},     # probe 结果回传给 commander 确认
  "confirmed": false         # commander 确认后再实际执行
}
```

---

### 🔴 发现3：统一 Backend 适配器模式 → MarionetteExecutor 标准化

**CLI-Anything 的 utils/<software>_backend.py 模式**：
```python
def find_browser():
    """Find Playwright browser. Raises RuntimeError with install instructions if not found."""
    import shutil
    path = shutil.which("chromium") or shutil.which("chromium-browser")
    if not path:
        raise RuntimeError("Chromium not found. Run: playwright install chromium")
    return path

def navigate_to(url: str, session_file: str) -> dict:
    """Navigate browser. Returns JSON result."""
    browser = find_browser()
    result = subprocess.run([browser, "--headless", url], ...)
    return {"url": url, "status": result.returncode, "method": "playwright-headless"}
```

**我们目前**：MarionetteExecutor 硬编码，无标准检测模式。

**借鉴改进**：将 MarionetteExecutor 改造成符合 CLI-Anything Backend 适配器规范的模块，增加 `find_playwright()`、标准化 JSON 输出格式。

---

## 四、借鉴优先级矩阵

| 优先级 | 内容 | 目标层 | 估时 |
|--------|------|--------|------|
| 🔴 P1 | 龙虾技能 YAML frontmatter 标准化（SKILL.md 对齐） | 龙虾 KB | 1天 |
| 🔴 P1 | ExecutionPlan probe-then-mutate 两段式增强 | 云边调度 | 1天 |
| 🔴 P1 | MarionetteExecutor → Backend 适配器模式重构 | 边缘层 | 1天 |
| 🔴 P1 | ComfyUI Adapter 接口对齐 CLI-Anything comfyui harness | 边缘层 | 0.5天 |
| 🟡 P2 | 龙虾 E2E 自动化测试套件（test_full_e2e 模式） | 龙虾/测试 | 2天 |
| 🟡 P2 | 技能自动生成器（从 Python 函数注释提取） | 支撑微服务 | 1天 |
| 🟡 P3 | 边缘端 REPL 调试模式（管理员维护） | 边缘层 | 2天 |
| 🟡 P3 | 社区技能市场（OSS版，MVP后） | SaaS | 规划中 |

---

## 五、与我们项目的直接关联

CLI-Anything 的 `openclaw-skill/SKILL.md` 文件明确将 OpenClaw 列为官方支持的 Agent，这意味着：

1. **CLI-Anything 已为我们的龙虾准备好工具**：边缘执行层可直接调用任何 CLI-Anything 适配的软件（ComfyUI、Browser、Zoom、Blender等）
2. **技能格式天然兼容**：借鉴其 SKILL.md 标准后，我们的龙虾技能可以无缝被 CLI-Anything 生态调用
3. **共同用户群**：使用 CLI-Anything 的企业用户和 OpenClaw 用户高度重叠

---

## 六、参考文件索引

| 文件 | 路径 | 用途 |
|------|------|------|
| HARNESS.md | `cli-anything-plugin/HARNESS.md` | 7阶段 SOP（核心方法论） |
| skill_generator.py | `cli-anything-plugin/skill_generator.py` | 技能元数据自动提取 |
| repl_skin.py | `cli-anything-plugin/repl_skin.py` | 统一 REPL 皮肤 |
| registry.json | `registry.json` | 技能中心注册表 Schema |
| SKILL.md 模板 | `cli-anything-plugin/templates/SKILL.md.template` | SKILL.md 标准格式 |
| ComfyUI harness | `comfyui/agent-harness/` | 图像生成 CLI（Visualizer 龙虾直接关联） |
| Browser harness | `browser/agent-harness/` | 浏览器 CLI（边缘执行直接关联） |
| openclaw-skill | `openclaw-skill/SKILL.md` | OpenClaw 官方技能文件 |

---

*分析完成 | 2026-04-02 | 下一步：查看 CODEX_TASK_CLI_ANYTHING_P1.md*
