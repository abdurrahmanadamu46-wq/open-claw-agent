import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const registryPath = path.join(repoRoot, "packages", "lobsters", "registry.json");

const args = process.argv.slice(2);
const roleIndex = args.indexOf("--role");
const outIndex = args.indexOf("--out");
const strict = args.includes("--strict");
const roleFilter = roleIndex >= 0 ? args[roleIndex + 1] : null;
const outPath = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : null;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function safeReadText(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isPlaceholderValue(value) {
  if (typeof value !== "string") return false;

  const normalized = value.toLowerCase();
  return (
    normalized.startsWith("sample_") ||
    normalized.includes("starter goal") ||
    normalized.includes("starter_assumption") ||
    normalized.includes("starter_evidence")
  );
}

function slugifyArtifact(artifactType) {
  return artifactType
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function countPresentKeys(object, keys) {
  return keys.filter((key) => object[key] !== undefined && object[key] !== null && object[key] !== "").length;
}

function evaluatePackage(entry) {
  const packageDir = path.join(repoRoot, entry.path);
  const roleCard = readJson(path.join(packageDir, "role-card.json"));
  const goldenCases = readJson(path.join(packageDir, "datasets", "golden-cases.json"));
  const scorecard = readJson(path.join(packageDir, "evals", "scorecard.json"));
  const sampleOutput = readJson(path.join(packageDir, "evals", "sample-output.json"));
  const failurePatterns = readJson(path.join(packageDir, "evals", "failure-patterns.json"));
  const memoryPolicy = readJson(path.join(packageDir, "memory-policy", "policy.json"));
  const starterPlaybook = readJson(path.join(packageDir, "playbooks", "starter-playbook.json"));
  const systemPrompt = safeReadText(path.join(packageDir, "prompt-kit", "system.prompt.md"));
  const userTemplate = safeReadText(path.join(packageDir, "prompt-kit", "user-template.md"));
  const artifactSchemaPath = path.join(
    packageDir,
    "artifacts",
    `${slugifyArtifact(entry.primaryArtifact)}.schema.json`
  );
  const artifactSchemaExists = existsSync(artifactSchemaPath);

  const outputContract = roleCard.outputContract ?? [];
  const requiredLabels = ["happy_path", "edge_case", "failure_case"];
  const caseLabels = new Set((goldenCases.cases ?? []).map((item) => item.label));
  const labelCoverage = ratio(
    requiredLabels.filter((label) => caseLabels.has(label)).length,
    requiredLabels.length
  );
  const signalCoverage = average(
    (goldenCases.cases ?? []).map((item) => {
      const expectedSignals = item.expectedSignals ?? [];
      const hitCount = expectedSignals.filter((signal) => outputContract.includes(signal)).length;
      return ratio(hitCount, Math.max(outputContract.length, 1));
    })
  );
  const caseDesignScore = average(
    (goldenCases.cases ?? []).map((item) => {
      const mustIncludeCount = (item.mustInclude ?? []).length > 0 ? 1 : 0;
      const mustAvoidCount = (item.mustAvoid ?? []).length > 0 ? 1 : 0;
      return average([mustIncludeCount, mustAvoidCount || 0.5]);
    })
  );
  const datasetScore = clamp(
    average([
      ratio((goldenCases.cases ?? []).length, 3),
      labelCoverage,
      signalCoverage,
      caseDesignScore
    ])
  );

  const sampleOutputCoreFields = [
    "goal",
    "assumptions",
    "evidence",
    "confidence",
    "riskLevel",
    "nextAction"
  ];
  const nonPlaceholderScore = average(
    [...outputContract, ...sampleOutputCoreFields].map((field) =>
      isPlaceholderValue(sampleOutput[field]) ? 0 : 1
    )
  );
  const sampleArtifactScore = clamp(
    average([
      ratio(countPresentKeys(sampleOutput, outputContract), Math.max(outputContract.length, 1)),
      ratio(
        countPresentKeys(sampleOutput, [
          "goal",
          "assumptions",
          "evidence",
          "confidence",
          "riskLevel",
          "nextAction"
        ]),
        6
      ),
      nonPlaceholderScore
    ])
  );

  const promptScore = clamp(
    average([
      systemPrompt.includes(entry.primaryArtifact) ? 1 : 0,
      systemPrompt.includes(roleCard.mission) ? 1 : 0,
      userTemplate.includes(roleCard.displayName) || userTemplate.includes(roleCard.zhName) ? 1 : 0
    ])
  );

  const playbookScore = clamp(
    average([
      ratio((starterPlaybook.steps ?? []).length, 5),
      starterPlaybook.artifactType === entry.primaryArtifact ? 1 : 0
    ])
  );

  const memoryScore = clamp(
    average([
      ratio(
        (memoryPolicy.readScope ?? []).filter((item) => (roleCard.memoryReadScope ?? []).includes(item)).length,
        Math.max((roleCard.memoryReadScope ?? []).length, 1)
      ),
      ratio(
        (memoryPolicy.writeScope ?? []).filter((item) => (roleCard.memoryWriteScope ?? []).includes(item)).length,
        Math.max((roleCard.memoryWriteScope ?? []).length, 1)
      )
    ])
  );

  const scorecardScore = clamp(
    average([
      ratio((scorecard.metrics ?? []).length, Math.max((roleCard.evalFocus ?? []).length, 1)),
      ratio((failurePatterns.patterns ?? []).length, 2),
      artifactSchemaExists ? 1 : 0
    ])
  );

  const readinessScore = Number(
    (
      datasetScore * 0.25 +
      sampleArtifactScore * 0.2 +
      promptScore * 0.15 +
      playbookScore * 0.15 +
      memoryScore * 0.1 +
      scorecardScore * 0.15
    ).toFixed(3)
  );

  const warnings = [];

  if (datasetScore < 0.85) warnings.push("dataset_coverage_low");
  if (sampleArtifactScore < 0.85) warnings.push("sample_artifact_incomplete");
  if (promptScore < 0.85) warnings.push("prompt_kit_needs_work");
  if (readinessScore < 0.8) warnings.push("overall_readiness_below_target");

  return {
    packageName: entry.packageName,
    roleId: entry.roleId,
    primaryArtifact: entry.primaryArtifact,
    readinessScore,
    componentScores: {
      datasetScore: Number(datasetScore.toFixed(3)),
      sampleArtifactScore: Number(sampleArtifactScore.toFixed(3)),
      promptScore: Number(promptScore.toFixed(3)),
      playbookScore: Number(playbookScore.toFixed(3)),
      memoryScore: Number(memoryScore.toFixed(3)),
      scorecardScore: Number(scorecardScore.toFixed(3))
    },
    caseCount: (goldenCases.cases ?? []).length,
    metricCount: (scorecard.metrics ?? []).length,
    warnings
  };
}

const registry = readJson(registryPath);
const selectedPackages = registry.packages.filter((entry) => {
  if (!roleFilter) return true;
  return entry.roleId === roleFilter || entry.packageName.includes(roleFilter);
});

const packages = selectedPackages.map(evaluatePackage);
const averageReadiness = Number(
  average(packages.map((item) => item.readinessScore)).toFixed(3)
);

const report = {
  evalVersion: "lobster.subprojects.eval.v0.1",
  evaluatedAt: new Date().toISOString(),
  packageCount: packages.length,
  averageReadiness,
  packages
};

if (outPath) {
  writeFileSync(outPath, JSON.stringify(report, null, 2));
}

console.log(JSON.stringify(report, null, 2));

if (strict && packages.some((item) => item.readinessScore < 0.8)) {
  process.exitCode = 1;
}
