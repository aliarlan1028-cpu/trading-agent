// 一次性：把用户提供的经典交易/金融书目按书名批量导入知识库。
// 走真实管道（importKnowledge + parseKnowledgeSource → DeepSeek 生成自有措辞方法论综述 + A/B 蒸馏）。
// 必须在主服务停机时运行（独占 sqlite，避免与运行中进程争锁/被内存态覆盖）。
// 破坏性/停机脚本守卫：必须显式 CONFIRM_BULK_IMPORT_BOOKS=true 才执行（对齐 migrate-tenant-resources 的防呆基线）。
if (process.env.CONFIRM_BULK_IMPORT_BOOKS !== "true") {
  console.error("此脚本会写入/清理生产数据且须停机运行。确认后用 CONFIRM_BULK_IMPORT_BOOKS=true node scripts/bulkImportBooks.mjs 执行。");
  process.exit(1);
}
import { loadDb, saveDb } from "../server/store.mjs";
import { importKnowledge, parseKnowledgeSource } from "../server/knowledgePipeline.mjs";
import { applyStoredConfigToEnv } from "../server/runtimeConfig.mjs";

const BOOKS = [
  { title: "投资心理分析", author: "马丁·普林格", domain: "交易心理", bookFocus: "交易心理、情绪管理与行为纪律，如何把心理规则转成可执行约束" },
  { title: "行为金融与投资心理学", author: "约翰·诺夫辛格", domain: "交易心理", bookFocus: "常见行为偏差（过度自信/处置效应/羊群）及对应的决策纪律与规避规则" },
  { title: "彼得·林奇的成功投资", author: "彼得·林奇", domain: "基本面", bookFocus: "选股与基本面方法；注明用于加密永续合约（带杠杆、短周期）的适用边界" },
  { title: "战胜华尔街", author: "彼得·林奇", domain: "基本面", bookFocus: "选股框架与投资纪律；注明用于加密永续合约的适用边界" },
  { title: "期货市场完全指南", author: "杰克·施瓦格", domain: "技术分析", bookFocus: "期货技术分析、可识别 setup、入场/止损/止盈、仓位与执行规则" },
  { title: "以交易为生", author: "亚历山大·埃尔德", domain: "技术分析", bookFocus: "三重滤网系统、指标用法、仓位管理（2%/6%）与交易心理纪律" },
  { title: "技术分析", author: "马丁·普林格", domain: "技术分析", bookFocus: "趋势、动量、量价关系与技术信号的判定标准" },
  { title: "止损：如何克服贪婪和恐惧", author: "", domain: "风控", bookFocus: "止损纪律、离场标准、如何用规则对抗贪婪与恐惧" },
  { title: "经济学原理（第8版）", author: "曼昆", domain: "宏观", bookFocus: "供需与宏观基础；注明与短周期杠杆交易的关系与适用边界" },
  { title: "风险管理与金融机构", author: "约翰·赫尔", domain: "风控", bookFocus: "风险度量、VaR、杠杆与保证金风控，转化为仓位/杠杆硬约束" },
  { title: "期权、期货及其他衍生品", author: "约翰·赫尔", domain: "风控", bookFocus: "衍生品定价、对冲与杠杆风险；用于加密永续合约的风控适用边界" }
];

const db = loadDb();
applyStoredConfigToEnv(db);

async function importOne(b) {
  const source = await importKnowledge(db, {
    type: "book_title", title: b.title, author: b.author, bookFocus: b.bookFocus,
    domain: b.domain, trustScore: 82, createRuleDraft: true, permission: "仅个人使用"
  });
  const r = await parseKnowledgeSource(db, source.id);
  return `${r.status === "parsed" ? "OK" : ".."} ${b.title} — ${r.status} chunks=${r.chunks || 0} concepts=${r.concepts || 0}${r.source?.error ? " err=" + r.source.error : ""}`;
}

const CONC = 3;
const results = [];
for (let i = 0; i < BOOKS.length; i += CONC) {
  const batch = BOOKS.slice(i, i + CONC);
  const rs = await Promise.all(batch.map((b) => importOne(b).catch((e) => `✗ ${b.title} — ERROR ${e.message}`)));
  results.push(...rs);
  console.log(rs.join("\n"));
}

saveDb(db);
const ok = results.filter((r) => r.startsWith("OK")).length;
console.log(`\n=== DONE: ${ok}/${BOOKS.length} parsed ===`);
console.log(`sources total now: ${(db.knowledge.sources || []).length}, ruleProposals: ${(db.knowledge.ruleProposals || []).length}, hypotheses: ${(db.knowledge.strategyHypotheses || []).length}, concepts: ${(db.knowledge.conceptCards || []).length}`);
process.exit(0);
