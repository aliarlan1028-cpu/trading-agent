import { runBuiltInAgentSafetyEval } from "../server/agentSafetyEval.mjs";

const result = runBuiltInAgentSafetyEval();
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exit(1);
