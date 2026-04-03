import { resolveCommanderDecision } from "./commander/engine.js";
import { realisticScenarios } from "./commander/scenarios.js";
import { getDecisionTableInfo } from "./commander/table.js";
import { getRuleStats, resetRuleStats } from "./commander/stats.js";

const tableInfo = getDecisionTableInfo();
resetRuleStats();

console.log("Using decision table:");
console.log(JSON.stringify(tableInfo, null, 2));

for (const scenario of realisticScenarios) {
  const decision = resolveCommanderDecision(scenario.input);

  console.log(`\n=== ${scenario.name} ===`);
  console.log(JSON.stringify(decision, null, 2));
}

console.log("\n=== Rule Stats ===");
console.log(JSON.stringify(getRuleStats(), null, 2));
