import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const registryPath = path.join(repoRoot, "packages", "lobsters", "registry.json");

const requiredFiles = [
  "package.json",
  "README.md",
  "role-card.json",
  path.join("src", "index.ts"),
  path.join("artifacts"),
  path.join("datasets", "README.md"),
  path.join("datasets", "golden-cases.json"),
  path.join("evals", "README.md"),
  path.join("evals", "scorecard.json"),
  path.join("evals", "sample-output.json"),
  path.join("evals", "failure-patterns.json"),
  path.join("memory-policy", "policy.json"),
  path.join("playbooks", "README.md"),
  path.join("playbooks", "starter-playbook.json"),
  path.join("prompt-kit", "system.prompt.md"),
  path.join("prompt-kit", "user-template.md")
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function validateRoleCard(roleCard) {
  const requiredKeys = [
    "roleId",
    "displayName",
    "zhName",
    "mission",
    "primaryArtifact",
    "inputContract",
    "outputContract",
    "memoryReadScope",
    "memoryWriteScope",
    "evalFocus"
  ];

  return requiredKeys.filter((key) => !roleCard[key]);
}

const registry = readJson(registryPath);
const failures = [];
const summary = [];

for (const entry of registry.packages) {
  const packageDir = path.join(repoRoot, entry.path);
  const missing = requiredFiles.filter(
    (relativePath) => !existsSync(path.join(packageDir, relativePath))
  );
  const roleCardPath = path.join(packageDir, "role-card.json");
  const roleCard = existsSync(roleCardPath) ? readJson(roleCardPath) : null;
  const roleCardIssues = roleCard ? validateRoleCard(roleCard) : ["role-card.json unreadable"];

  if (missing.length || roleCardIssues.length) {
    failures.push({
      packageName: entry.packageName,
      missing,
      roleCardIssues
    });
  } else {
    summary.push({
      packageName: entry.packageName,
      roleId: entry.roleId,
      primaryArtifact: entry.primaryArtifact,
      status: "ok"
    });
  }
}

console.log(
  JSON.stringify(
    {
      validationVersion: "lobster.subprojects.validate.v0.1",
      packageCount: registry.packages.length,
      okCount: summary.length,
      failureCount: failures.length,
      summary,
      failures
    },
    null,
    2
  )
);

if (failures.length) {
  process.exitCode = 1;
}
