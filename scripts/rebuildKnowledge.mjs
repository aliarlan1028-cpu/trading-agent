// 一次性：清空知识库派生项，用新管道（交易方法+风控纪律+概念关系）重蒸馏所有来源。
// 保留 sources 本身；未批准的规则/方法/概念/假设全清。须在主服务停机时运行（独占 sqlite）。
import { loadDb, saveDb } from "../server/store.mjs";
import { applyStoredConfigToEnv } from "../server/runtimeConfig.mjs";
import { parseKnowledgeSource } from "../server/knowledgePipeline.mjs";

const db = loadDb();
applyStoredConfigToEnv(db);
db.knowledge ||= {};
db.knowledge.ruleProposals = [];
db.knowledge.strategyHypotheses = [];
db.knowledge.tradingMethods = [];
db.knowledge.conceptCards = [];
db.knowledge.reviewTemplates = [];
db.knowledge.chunks = [];
db.knowledge.documentNodes = [];

const sources = db.knowledge.sources || [];
const CONC = 3;
for (let i = 0; i < sources.length; i += CONC) {
  const batch = sources.slice(i, i + CONC);
  const rs = await Promise.all(batch.map((s) => parseKnowledgeSource(db, s.id).then((r) => `${r.status === "ok" ? "OK" : ".."} ${s.title} — methods=${r.methods || 0} rules=${r.rules || 0} concepts=${r.concepts || 0}`).catch((e) => `xx ${s.title} — ${e.message}`)));
  console.log(rs.join("\n"));
}
saveDb(db);
const k = db.knowledge;
console.log(`\n=== DONE: methods ${(k.tradingMethods || []).length} · rules ${(k.ruleProposals || []).length} · concepts ${(k.conceptCards || []).length} · sources ${sources.length} ===`);
process.exit(0);
