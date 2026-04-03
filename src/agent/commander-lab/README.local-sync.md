# LobsterPool Commander Decision Table v0.1

This workspace contains a code-first baseline for the LobsterPool Commander.

Design goals:

- keep decision policy in data tables instead of burying it in prompts
- keep the runtime deterministic and auditable
- allow future optimization through additional rules, weights, or learned policies
- keep high-risk actions behind explicit approval gates

Structure:

- `src/commander/types.js`: JSDoc types for decision inputs and outputs
- `src/commander/config/decision-table.json`: hot-reloadable decision table
- `src/commander/config/decision-table.schema.json`: JSON Schema for editor/CI validation
- `src/commander/table.js`: JSON loader, path resolution, cache invalidation, and validation
- `src/commander/engine.js`: deterministic decision resolver
- `src/commander/stats.js`: rule hit statistics for future optimization
- `src/commander/scenarios.js`: realistic input scenarios
- `src/index.js`: demo runner

Run:

```bash
npm run demo
```

Optimization path:

- replace simple mission matching with weighted policy selection
- store rule hit-rate and outcome metrics for offline tuning
- plug in a learned lineup scorer before final Commander approval
- split approval gating from routing once the governance layer matures

Hot update:

- edit `src/commander/config/decision-table.json`
- or point `LOBSTERPOOL_COMMANDER_TABLE` to another JSON file
- the loader checks file mtime and automatically reloads on the next decision call

Optimization hooks:

- every override rule now supports `enabled`, `priority`, `weight`, `tags`, and `notes`
- the engine records rule evaluation stats in memory
- `matchedRuleIds` and `appliedRuleIds` are returned per decision
- `getRuleStats()` exposes which rules are actually firing

Sync to the main framework:

- `npm run sync:openclaw` copies this Commander prototype into `F:\openclaw-agent\src\agent\commander-lab`
- `npm run sync:openclaw:run` copies it and immediately runs the synced demo in the target repo
- `npm run sync:openclaw:watch` keeps watching local files and resyncs on change

This keeps the engine stable while making policy changes operational instead of code-driven.
