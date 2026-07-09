// 一次性：规范化后合并规则库中的重复草案（已批准的保留），清理批量导入产生的重复。
// 与 /api/knowledge/rules/dedup 同逻辑。须在主服务停机时运行（独占 sqlite）。
import { loadDb, saveDb, appendAudit } from "../server/store.mjs";

const db = loadDb();
const norm = (s) => String(s || "").toLowerCase().replace(/[\s\p{P}]/gu, "");
const seen = new Set();
const kept = [];
const removed = [];
for (const r of db.knowledge.ruleProposals || []) {
  const key = `${norm(r.category)}|${norm(r.name)}|${norm(r.description).slice(0, 40)}`;
  if (r.status === "已批准" || !seen.has(key)) { seen.add(key); kept.push(r); } else removed.push(r.id);
}
db.knowledge.ruleProposals = kept;
if (removed.length) db.riskRules = (db.riskRules || []).filter((r) => !removed.some((id) => r.id === `risk_from_${id}`));
appendAudit(db, `规则库去重（脚本），移除 ${removed.length} 条重复草案`, "rule_dedup", "System");
saveDb(db);
console.log(`dedup: removed ${removed.length}, remaining ${kept.length}`);
process.exit(0);
