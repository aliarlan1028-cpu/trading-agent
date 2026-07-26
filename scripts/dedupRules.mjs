// 一次性：用 LLM 智能合并规则库中语义重复的待审批草案（阈值冲突取更严格，已批准的保留）。
// 与 /api/knowledge/rules/dedup 同逻辑。须在主服务停机时运行（独占 sqlite）。
// 破坏性/停机脚本守卫：必须显式 CONFIRM_DEDUP_RULES=true 才执行（对齐 migrate-tenant-resources 的防呆基线）。
if (process.env.CONFIRM_DEDUP_RULES !== "true") {
  console.error("此脚本会写入/清理生产数据且须停机运行。确认后用 CONFIRM_DEDUP_RULES=true node scripts/dedupRules.mjs 执行。");
  process.exit(1);
}
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
