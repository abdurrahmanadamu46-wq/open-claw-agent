import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const registryPath = path.join(repoRoot, "packages", "lobsters", "registry.json");
const force = process.argv.includes("--force");

const requiredDirs = [
  "artifacts",
  "datasets",
  "evals",
  "memory-policy",
  "playbooks",
  "prompt-kit"
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function toSlug(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function writeIfMissing(filePath, content) {
  ensureDir(path.dirname(filePath));

  if (existsSync(filePath) && !force) {
    return "skipped";
  }

  writeFileSync(filePath, content);
  return "written";
}

function buildArtifactSchema(roleCard, artifactType) {
  const artifactFields = roleCard.outputContract ?? [];
  const properties = {
    goal: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    riskLevel: { type: "string" },
    nextAction: { type: "string" }
  };

  for (const field of artifactFields) {
    properties[field] = { type: "string" };
  }

  return JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `https://lobsterpool.local/schemas/${roleCard.roleId}/${toSlug(artifactType)}.schema.json`,
      title: `${artifactType} Schema`,
      type: "object",
      required: [
        "goal",
        "assumptions",
        "evidence",
        "confidence",
        "riskLevel",
        "nextAction",
        ...artifactFields
      ],
      properties,
      additionalProperties: true
    },
    null,
    2
  );
}

function buildDatasetsReadme(roleCard) {
  return `# ${roleCard.displayName} Datasets

这组数据用于强化 ${roleCard.zhName}。

建议至少维护三类样本：

- happy path
- edge / borderline
- failure / regression

当前评测重点：

${(roleCard.evalFocus ?? []).map((item) => `- ${item}`).join("\n")}
`;
}

function buildGoldenCases(roleCard, artifactType) {
  return JSON.stringify(
    {
      schemaVersion: "lobster.dataset.golden-cases.v0.1",
      roleId: roleCard.roleId,
      primaryArtifact: artifactType,
      cases: [
        {
          id: `${roleCard.roleId}_happy_001`,
          label: "happy_path",
          input: {
            summary: `Baseline happy-path input for ${roleCard.roleId}`
          },
          expectedSignals: roleCard.outputContract ?? []
        },
        {
          id: `${roleCard.roleId}_edge_001`,
          label: "edge_case",
          input: {
            summary: `Boundary-condition input for ${roleCard.roleId}`
          },
          expectedSignals: roleCard.outputContract ?? []
        },
        {
          id: `${roleCard.roleId}_failure_001`,
          label: "failure_case",
          input: {
            summary: `Regression guard input for ${roleCard.roleId}`
          },
          expectedSignals: roleCard.outputContract ?? []
        }
      ]
    },
    null,
    2
  );
}

function buildEvalsReadme(roleCard) {
  return `# ${roleCard.displayName} Evals

这个目录放 ${roleCard.zhName} 的角色专属评测。

最少要覆盖：

- 工件结构正确率
- 角色主目标达成率
- 风险边界控制
- 成本和时延回归
`;
}

function buildScorecard(roleCard, artifactType) {
  const metrics = (roleCard.evalFocus ?? []).map((metric, index) => ({
    id: metric,
    weight: Number((1 / Math.max(roleCard.evalFocus.length, 1)).toFixed(2)),
    order: index + 1
  }));

  return JSON.stringify(
    {
      schemaVersion: "lobster.eval.scorecard.v0.1",
      roleId: roleCard.roleId,
      primaryArtifact: artifactType,
      metrics,
      acceptance: {
        artifactSchemaPassRate: 0.99,
        benchmarkPassRate: 0.9,
        regressionBudgetCeilingRatio: 1.05
      }
    },
    null,
    2
  );
}

function buildSampleOutput(roleCard, artifactType) {
  const output = {
    artifactType,
    goal: `Starter goal for ${roleCard.roleId}`,
    assumptions: ["starter_assumption"],
    evidence: ["starter_evidence"],
    confidence: 0.8,
    riskLevel: "L1",
    nextAction: "handoff"
  };

  for (const field of roleCard.outputContract ?? []) {
    output[field] = `sample_${field}`;
  }

  return JSON.stringify(output, null, 2);
}

function buildFailurePatterns(roleCard) {
  return JSON.stringify(
    {
      schemaVersion: "lobster.eval.failure-patterns.v0.1",
      roleId: roleCard.roleId,
      patterns: [
        {
          id: `${roleCard.roleId}_missing_core_fields`,
          label: "missing_core_fields",
          description: "Primary artifact misses mandatory contract fields."
        },
        {
          id: `${roleCard.roleId}_role_drift`,
          label: "role_drift",
          description: "Output crosses into another lobster's responsibility."
        }
      ]
    },
    null,
    2
  );
}

function buildMemoryPolicy(roleCard) {
  return JSON.stringify(
    {
      schemaVersion: "lobster.memory-policy.v0.1",
      roleId: roleCard.roleId,
      readScope: roleCard.memoryReadScope ?? [],
      writeScope: roleCard.memoryWriteScope ?? [],
      writePolicy: {
        allowAutoWrite: true,
        requireFeedbackCompileForGlobalPromotion: true
      },
      retentionPolicy: {
        sessionDays: 3,
        missionDays: 14,
        tenantDays: 90
      }
    },
    null,
    2
  );
}

function buildPlaybookReadme(roleCard) {
  return `# ${roleCard.displayName} Playbooks

这里存放 ${roleCard.zhName} 的高质量动作样板。

建议按这三类维护：

- 成功打法
- 常见失败模式
- 特殊行业补丁
`;
}

function buildStarterPlaybook(roleCard, artifactType) {
  return JSON.stringify(
    {
      schemaVersion: "lobster.playbook.v0.1",
      roleId: roleCard.roleId,
      artifactType,
      playbookId: `${roleCard.roleId}_starter`,
      title: `${roleCard.displayName} Starter Playbook`,
      steps: [
        "load_role_card",
        "read_memory_scope",
        "produce_primary_artifact",
        "run_role_eval",
        "write_back_learning_if_valid"
      ]
    },
    null,
    2
  );
}

function buildSystemPrompt(roleCard, artifactType) {
  return `# ${roleCard.displayName} System Prompt Template

角色：${roleCard.zhName}
使命：${roleCard.mission}
主工件：${artifactType}

执行规则：

1. 只围绕本角色职责行动。
2. 严格产出结构化工件，不输出散乱结论。
3. 超出权限时必须升级给 Commander 或治理层。
4. 优先保证稳定和风险边界，再追求表达力与速度。

重点输出字段：

${(roleCard.outputContract ?? []).map((item) => `- ${item}`).join("\n")}
`;
}

function buildUserTemplate(roleCard) {
  return `# ${roleCard.displayName} User Prompt Template

输入摘要：
- mission:
- tenant_context:
- required_artifact:
- constraints:

请以 ${roleCard.zhName} 的岗位视角完成本次任务。
`;
}

function scaffoldPackage(entry) {
  const packageDir = path.join(repoRoot, entry.path);
  const roleCardPath = path.join(packageDir, "role-card.json");
  const roleCard = readJson(roleCardPath);
  const artifactType = entry.primaryArtifact;
  const artifactSchemaName = `${toSlug(artifactType)}.schema.json`;

  for (const dir of requiredDirs) {
    ensureDir(path.join(packageDir, dir));
  }

  const results = [];
  results.push(
    writeIfMissing(
      path.join(packageDir, "artifacts", artifactSchemaName),
      buildArtifactSchema(roleCard, artifactType)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "datasets", "README.md"),
      buildDatasetsReadme(roleCard)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "datasets", "golden-cases.json"),
      buildGoldenCases(roleCard, artifactType)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "evals", "README.md"),
      buildEvalsReadme(roleCard)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "evals", "scorecard.json"),
      buildScorecard(roleCard, artifactType)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "evals", "sample-output.json"),
      buildSampleOutput(roleCard, artifactType)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "evals", "failure-patterns.json"),
      buildFailurePatterns(roleCard)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "memory-policy", "policy.json"),
      buildMemoryPolicy(roleCard)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "playbooks", "README.md"),
      buildPlaybookReadme(roleCard)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "playbooks", "starter-playbook.json"),
      buildStarterPlaybook(roleCard, artifactType)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "prompt-kit", "system.prompt.md"),
      buildSystemPrompt(roleCard, artifactType)
    )
  );
  results.push(
    writeIfMissing(
      path.join(packageDir, "prompt-kit", "user-template.md"),
      buildUserTemplate(roleCard)
    )
  );

  const writtenCount = results.filter((item) => item === "written").length;

  return {
    packageName: entry.packageName,
    roleId: entry.roleId,
    writtenCount,
    skippedCount: results.length - writtenCount
  };
}

const registry = readJson(registryPath);
const summary = registry.packages.map(scaffoldPackage);

console.log(
  JSON.stringify(
    {
      scaffoldVersion: "lobster.subprojects.scaffold.v0.2",
      force,
      packageCount: summary.length,
      summary
    },
    null,
    2
  )
);
