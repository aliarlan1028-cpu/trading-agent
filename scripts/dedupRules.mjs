// 一次性：用 LLM 智能合并规则库中语义重复的待审批草案（阈值冲突取更严格，已批准的保留）。
// 与 /api/knowledge/rules/dedup 同逻辑。须在主服务停机时运行（独占 sqlite）。
import { loadDb, saveDb } from "../server/store.mjs";
import { applyStoredConfigToEnv } from "../server/runtimeConfig.mjs";
import { consolidateRuleProposals } from "../server/knowledgePipeline.mjs";

const db = loadDb();
applyStoredConfigToEnv(db);
const before = (db.knowledge.ruleProposals || []).length;
const r = await consolidateRuleProposals(db);
saveDb(db);
console.log(`dedup: ${before} → ${r.remaining} (removed ${r.removed}, method ${r.method})`);
process.exit(0);
