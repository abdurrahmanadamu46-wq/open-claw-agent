# ClawHub Skill Registry v2.0（龙虾元老院）

本目录提供可直接接入项目的 **9 代理 Skill 配置 + OpenAPI + 类型化接口 + DAG**。

## 文件结构

- `schemas.ts`：给 LLM 注入的 function tools（OpenAI/DeepSeek 兼容）
- `senate-skill-interfaces.ts`：每个 Skill 的 TypeScript 输入输出类型、函数签名、调用示例
- `senate-collaboration.ts`：Tier 划分、执行顺序、DAG、并行组、Top10000 扩展计划
- `lobster-senate.skills.v2.json`：完整配置（代理、技能、输入输出、依赖、扩展策略）
- `lobster-senate.dag.v2.json`：纯 DAG JSON
- `lobster-senate.openapi.v2.json`：Skill Gateway OpenAPI 3.1 Schema

## 安全前置（强制）

```bash
npx clawhub@latest install skill-vetter
clawhub vet <skill-name>
```

建议在执行任何新 skill 前先调用 `skill_vetter`。

批量安装可用：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-clawhub-skills.ps1
```

## 快速接入

```ts
import {
  getClawhubToolsForAgent,
  getUniversalSafetyTool,
  SENATE_MAINLINE_DAG,
  SENATE_TIER_PLAN,
} from './index';

const safety = getUniversalSafetyTool();
const radarTools = getClawhubToolsForAgent('radar');
const strategistTools = getClawhubToolsForAgent('strategist');

console.log(SENATE_TIER_PLAN.intelligence); // ['radar', 'strategist']
console.log(SENATE_MAINLINE_DAG);
```

## Tier 协作链路

1. Intelligence Tier：`radar -> strategist`
2. Content Factory：`ink-writer + visualizer`
3. Orchestration Tier：`dispatcher`
4. Conversion Tier：`echoer -> catcher -> abacus -> follow-up`

## Top10000 热门能力扩展策略

不直接把 10000 条静态写死到仓库，采用动态目录扩展：

- 发现技能：`find-skills`
- 分页：`pageSize=200`, `maxPages=50`
- 上限：`maxSkills=10000`
- 排序：`downloads_stars_desc`
- 安全门：`skill-vetter`

见 `POPULAR_SKILL_CATALOG_PLAN` 与 `lobster-senate.skills.v2.json` 的 `extensibility.unboundedSkillCatalog`。
