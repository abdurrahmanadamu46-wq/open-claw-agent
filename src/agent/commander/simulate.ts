import { runMissionBatchSimulation } from './simulator.js';

const report = runMissionBatchSimulation({ forceReload: true });
console.log(JSON.stringify(report, null, 2));
