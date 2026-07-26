// 一次性：裁剪长期累积、拖垮 saveDb 的日志型集合（accountSnapshots 67MB / jobRuns / jobLocks 等）。
// 保留最近 N 条（按时间戳），jobLocks 按锁标识去重只留最新。须在主服务停机时运行。
// 破坏性/停机脚本守卫：必须显式 CONFIRM_PRUNE_COLLECTIONS=true 才执行（对齐 migrate-tenant-resources 的防呆基线）。
if (process.env.CONFIRM_PRUNE_COLLECTIONS !== "true") {
  console.error("此脚本会写入/清理生产数据且须停机运行。确认后用 CONFIRM_PRUNE_COLLECTIONS=true node scripts/pruneCollections.mjs 执行。");
  process.exit(1);
}
import { loadDb, saveDb } from "../server/store.mjs";

const db = loadDb();
const ts = (o) => new Date(o?.createdAt || o?.at || o?.startedAt || o?.finishedAt || o?.updatedAt || o?.acquiredAt || 0).getTime() || 0;
const keepRecent = (arr, n) => (arr || []).slice().sort((a, b) => ts(b) - ts(a)).slice(0, n);

const caps = {
  accountSnapshots: 300, jobRuns: 500, reconciliationReports: 100, agentRuns: 200,
  agentSteps: 500, agentToolCalls: 500, llmRuns: 300, toolExecutions: 300,
  executionOrders: 800, exchangeOrders: 800, skillRuns: 200, drillRuns: 100,
  eventImpacts: 300, reviewReports: 200, notifications: 300, riskChecks: 500, riskIncidents: 300
};
const before = {};
for (const [name, n] of Object.entries(caps)) {
  if (Array.isArray(db[name]) && db[name].length > n) { before[name] = db[name].length; db[name] = keepRecent(db[name], n); }
}
// jobLocks 应为每个锁一条，累积则按锁标识去重、只留最新。
if (Array.isArray(db.jobLocks)) {
  before.jobLocks = db.jobLocks.length;
  const seen = new Map();
  for (const l of db.jobLocks.slice().sort((a, b) => ts(b) - ts(a))) { const k = l.name || l.resource || l.taskId || l.id || l.key; if (!seen.has(k)) seen.set(k, l); }
  db.jobLocks = [...seen.values()];
}

saveDb(db);
console.log("pruned:", JSON.stringify(before));
console.log("after: accountSnapshots", (db.accountSnapshots || []).length, "jobRuns", (db.jobRuns || []).length, "jobLocks", (db.jobLocks || []).length);
process.exit(0);
