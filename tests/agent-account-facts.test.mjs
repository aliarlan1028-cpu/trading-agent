import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { enforceCurrentAccountFacts, sanitizeHistoricalAccountClaims } from "../server/agentChat.mjs";

const originalOkxApiKey = process.env.OKX_API_KEY;
const originalOkxDemo = process.env.OKX_DEMO_TRADING;
const testOkxApiKey = "agent-account-facts-test-key";
const apiKeyFingerprint = crypto.createHash("sha256").update(testOkxApiKey).digest("hex").slice(0, 16);
process.env.OKX_API_KEY = testOkxApiKey;
process.env.OKX_DEMO_TRADING = "false";

test.after(() => {
  if (originalOkxApiKey === undefined) delete process.env.OKX_API_KEY;
  else process.env.OKX_API_KEY = originalOkxApiKey;
  if (originalOkxDemo === undefined) delete process.env.OKX_DEMO_TRADING;
  else process.env.OKX_DEMO_TRADING = originalOkxDemo;
});

function normalizedPosition(row) {
  const contracts = Math.abs(Number(row.pos ?? row.contractSize ?? 0));
  const direction = row.canonicalDirection || (String(row.posSide || "").toLowerCase() === "net"
    ? (Number(row.pos) < 0 ? "short" : "long")
    : row.posSide);
  return {
    ...row,
    canonicalDirection: direction,
    contractSize: contracts,
    ctVal: 0.01,
    coinSize: contracts * 0.01,
    positionQuantityComplete: true
  };
}

function dbWithOkxSnapshot(positions = []) {
  const createdAt = "2026-08-08T05:00:00.000Z";
  return {
    system: { remainingDailyLossUsdt: 6.81, dailyLossCapUsdt: 6.81, dailyLossBudgetStatus: "reconciled" },
    portfolio: { totalEquityUsdt: 34.0558, availableMarginUsdt: 34.0558 },
    exchangeAccounts: [{ id: "acc_okx", exchange: "OKX", readEnabled: true, tradeEnabled: false, apiKeyFingerprint }],
    positions: [{
      exchange: "OKX", source: "exchange_rest", rawSyncedAt: "2026-08-07T05:00:00.000Z",
      symbol: "ADA/USDT", direction: "short", size: 1000, entry: 0.1864, pnl: -100.62
    }],
    accountSnapshots: [{
      exchange: "OKX", accountId: "acc_okx", apiKeyFingerprint, environment: "production", status: "ok", createdAt,
      positions: positions.map(normalizedPosition), openOrders: [], algoOrders: [], openOrdersComplete: true, algoOrdersComplete: true,
      balances: [{ totalEq: "34.0558", details: [{ ccy: "USDT", availEq: "34.0558" }] }]
    }]
  };
}

test("历史上下文会移除旧持仓和余额事实，但保留普通交易经验", () => {
  const input = [
    "持仓：ADA short 开仓 0.1864，浮亏 -100.62 USDT。",
    "经验：低周期逆结构时不要追单。",
    "账户仅 34 USDT，日亏预算剩 6.81 USDT。"
  ].join("\n");
  const result = sanitizeHistoricalAccountClaims(input);
  assert.doesNotMatch(result, /0\.1864|-100\.62|34 USDT|6\.81/);
  assert.match(result, /历史账户状态已省略/);
  assert.match(result, /低周期逆结构/);
});

test("OKX 最新成功快照为空仓时，回复中的旧 ADA 持仓会被确定性更正", () => {
  const db = dbWithOkxSnapshot([]);
  const response = "**持仓**：ADA short 开仓 0.1864，浮亏 -100.62 USDT，日亏预算剩 80.05。";
  const guarded = enforceCurrentAccountFacts(db, response);
  assert.equal(guarded.corrected, true);
  assert.match(guarded.text, /当前持仓：无/);
  assert.doesNotMatch(guarded.text, /0\.1864|-100\.62|80\.05/);
});

test("SQLite 重载顺序混乱时仍按 createdAt 选择最新成功快照", () => {
  const db = dbWithOkxSnapshot([]);
  const newerEmpty = { ...db.accountSnapshots[0], id: "snap_new", createdAt: "2026-08-08T06:00:00.000Z", positions: [] };
  const olderAda = {
    ...db.accountSnapshots[0], id: "snap_old", createdAt: "2026-08-07T06:00:00.000Z",
    positions: [normalizedPosition({ instId: "ADA-USDT-SWAP", pos: "1000", posSide: "short", avgPx: "0.1864", upl: "-100.62" })]
  };
  // 模拟 trading_entities 按 resource_id 而非 createdAt 重载：旧快照故意排第一。
  db.accountSnapshots = [olderAda, newerEmpty];
  db.positions[0].rawSyncedAt = olderAda.createdAt;
  const guarded = enforceCurrentAccountFacts(db, "持仓：ADA short 开仓 0.1864，浮亏 -100.62 USDT。");
  assert.match(guarded.text, /当前持仓：无/);
  assert.match(guarded.text, /2026-08-08T06:00:00.000Z/);
  assert.doesNotMatch(guarded.text, /0\.1864|-100\.62/);
});

test("34 USDT 和剩余日亏额度不会再被推断为没有开仓空间", () => {
  const db = dbWithOkxSnapshot([]);
  const response = "⛔ 账户仅 34 USDT，日亏预算仅剩 6.81 USDT——即使触发也几乎无开仓空间。";
  const guarded = enforceCurrentAccountFacts(db, response);
  assert.equal(guarded.corrected, true);
  assert.match(guarded.text, /可用保证金 34\.0558 USDT/);
  assert.match(guarded.text, /损失上限，不是开仓额度/);
  assert.match(guarded.text, /仍可提交满足最小下单量与风险边界的小额计划/);
  assert.doesNotMatch(guarded.text, /几乎无开仓空间/);
});

test("存在真实 OKX 仓位时，模型写出的旧价格也会被快照数字替换", () => {
  const db = dbWithOkxSnapshot([{ instId: "ADA-USDT-SWAP", pos: "12", posSide: "short", avgPx: "0.222", upl: "1.25" }]);
  const response = "当前持仓：ADA short 开仓 0.1864，浮亏 -100.62 USDT。";
  const guarded = enforceCurrentAccountFacts(db, response);
  assert.match(guarded.text, /ADA\/USDT short/);
  assert.match(guarded.text, /开仓价 0\.222/);
  assert.match(guarded.text, /浮动盈亏 1\.25 USDT/);
  assert.doesNotMatch(guarded.text, /0\.1864|-100\.62/);
});

test("明确标注为历史复盘的仓位描述不会被输出守卫误改", () => {
  const db = dbWithOkxSnapshot([]);
  const response = "历史复盘：当时 ADA short 开仓 0.1864 的错误在于止损过紧。";
  const guarded = enforceCurrentAccountFacts(db, response);
  assert.equal(guarded.corrected, false);
  assert.equal(guarded.text, response);
});

test("账户摘要截断时明确声明未展开仓位仍然存在", () => {
  const positions = Array.from({ length: 9 }, (_, index) => ({
    instId: `COIN${index}-USDT-SWAP`, pos: "1", posSide: "long", avgPx: "10", upl: "0"
  }));
  const guarded = enforceCurrentAccountFacts(
    dbWithOkxSnapshot(positions),
    "当前持仓：COIN0/USDT long，开仓价 1，浮盈 1 USDT。",
  );
  assert.match(guarded.text, /另有 1 个仓位未在摘要展开/);
  assert.match(guarded.text, /不能据此视为不存在/);
});
