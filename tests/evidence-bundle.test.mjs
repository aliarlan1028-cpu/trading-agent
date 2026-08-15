import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { compactAccountEvidence, compactEvidenceForPrompt, evaluateEvidenceReadiness, explicitSymbolsForEvidence, selectBoundOkxSnapshot, symbolsForEvidence } from "../server/evidenceBundle.mjs";

const originalOkxApiKey = process.env.OKX_API_KEY;
const originalOkxDemo = process.env.OKX_DEMO_TRADING;
const testOkxApiKey = "evidence-bundle-test-key";
const apiKeyFingerprint = crypto.createHash("sha256").update(testOkxApiKey).digest("hex").slice(0, 16);
process.env.OKX_API_KEY = testOkxApiKey;
process.env.OKX_DEMO_TRADING = "false";

test.after(() => {
  if (originalOkxApiKey === undefined) delete process.env.OKX_API_KEY;
  else process.env.OKX_API_KEY = originalOkxApiKey;
  if (originalOkxDemo === undefined) delete process.env.OKX_DEMO_TRADING;
  else process.env.OKX_DEMO_TRADING = originalOkxDemo;
});

function boundDb(snapshotOverrides = {}) {
  const snapshot = {
    id: "snap_evidence",
    exchange: "OKX",
    accountId: "acc_okx",
    apiKeyFingerprint,
    environment: "production",
    status: "ok",
    createdAt: new Date().toISOString(),
    totalEquityUsdt: 1000,
    balances: [{ totalEq: "1000", details: [{ ccy: "USDT", availEq: "800" }] }],
    positions: [],
    openOrders: [],
    algoOrders: [],
    openOrdersComplete: true,
    algoOrdersComplete: true,
    ...snapshotOverrides
  };
  return {
    exchangeAccounts: [{ id: "acc_okx", exchange: "OKX", readEnabled: true, tradeEnabled: false, apiKeyFingerprint }],
    accountSnapshots: [snapshot],
    system: { dailyLossBudgetStatus: "reconciled", remainingDailyLossUsdt: 50, dailyLossCapUsdt: 50 },
    portfolio: { todayPnl: 0, unrealizedPnl: 0 },
    snapshot
  };
}

test("evidence symbol routing prioritizes explicit symbols and deduplicates mandate scope", () => {
  const symbols = symbolsForEvidence("比较 BTC/USDT 和 ETH-USDT-SWAP", { allowedSymbols: ["BTC/USDT", "SOL/USDT"] }, 3);
  assert.deepEqual(symbols, ["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
});

test("autonomous patrol can route the full whitelist instead of silently truncating after three", () => {
  const text = "授权白名单：BTC/USDT、SUI/USDT、ADA/USDT、DOGE/USDT、XRP/USDT";
  assert.deepEqual(explicitSymbolsForEvidence(text, 8), ["BTC/USDT", "SUI/USDT", "ADA/USDT", "DOGE/USDT", "XRP/USDT"]);
  assert.deepEqual(symbolsForEvidence(text, { allowedSymbols: ["BTC/USDT", "SUI/USDT", "ADA/USDT", "DOGE/USDT", "XRP/USDT"] }, 8), [
    "BTC/USDT", "SUI/USDT", "ADA/USDT", "DOGE/USDT", "XRP/USDT"
  ]);
});

test("critical evidence readiness fails closed while smart money remains supplemental", () => {
  const fresh = { status: "fresh", quality: "passed" };
  const bundle = {
    account: fresh,
    symbols: [{ symbol: "BTC/USDT", ticker: fresh, candles: fresh, microstructure: fresh, contractSpec: fresh, smartMoney: { status: "missing", quality: "unavailable" } }]
  };
  assert.equal(evaluateEvidenceReadiness(bundle, "BTC/USDT", { live: true }).ready, true);
  bundle.symbols[0].ticker.status = "stale";
  const result = evaluateEvidenceReadiness(bundle, "BTC/USDT", { live: true });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("ticker_not_fresh"));
});

test("prompt evidence distinguishes facts from inference and exposes evidence IDs", () => {
  const text = compactEvidenceForPrompt({
    id: "evb1", generatedAt: "2026-08-08T00:00:00.000Z", criticalReady: false, blockers: ["ticker_not_fresh"],
    symbols: [{ symbol: "BTC/USDT", ticker: { status: "stale", evidenceId: "ev:ticker", data: { price: 100 } }, candles: { status: "fresh", quality: "passed", evidenceId: "ev:candles", data: { closedBars: 100 } }, microstructure: { status: "fresh", evidenceId: "ev:micro", data: { spreadBps: 1, depthUsdt: 1000 } }, contractSpec: { quality: "passed", evidenceId: "ev:spec" }, smartMoney: { quality: "unavailable", evidenceId: "ev:smart" } }],
    account: { status: "fresh", quality: "passed", evidenceId: "ev:account", data: { totalEquityUsdt: 34, availableMarginUsdt: 30, positionCount: 0 } }
  });
  assert.match(text, /ev:ticker/);
  assert.match(text, /只能把 fresh\/passed 数据写成当前事实/);
  assert.match(text, /方向、因果、支撑阻力属于推断/);
});

test("prompt evidence labels missing candle and microstructure fields unavailable", () => {
  const missing = { status: "missing", quality: "failed", evidenceId: "ev:missing", data: null };
  const text = compactEvidenceForPrompt({
    id: "evb2", generatedAt: "2026-08-08T00:00:00.000Z", criticalReady: false, blockers: ["closed_candles_not_fresh_or_invalid"],
    symbols: [{ symbol: "BTC/USDT", ticker: missing, candles: missing, microstructure: missing, contractSpec: missing, smartMoney: missing }],
    account: missing,
    accounting: missing
  });
  assert.match(text, /1H闭合K线\[missing\/failed/);
  assert.match(text, /不可用/);
  assert.doesNotMatch(text, /1H闭合K线[^\n]*0 根/);
  assert.match(text, /点差 不可用/);
  assert.match(text, /深度 不可用/);
});

test("bound OKX account evidence preserves net short direction and contracts-to-coin units", () => {
  const { snapshot, ...db } = boundDb({
    positions: [{
      instId: "BTC-USDT-SWAP", posSide: "net", pos: "-2", rawSignedPosition: -2,
      canonicalDirection: "short", contractSize: 2, ctVal: 0.01, coinSize: 0.02,
      positionQuantityComplete: true, avgPx: "60000", markPx: "59000", liqPx: "70000",
      upl: "20", lever: "3", mgnMode: "cross"
    }],
    openOrders: [{ instId: "BTC-USDT-SWAP", ordId: "ord_1", clOrdId: "entry_1", side: "buy", posSide: "net", ordType: "limit", sz: "1", px: "58000", reduceOnly: "false", state: "live" }],
    algoOrders: [{ instId: "BTC-USDT-SWAP", algoId: "algo_1", algoClOrdId: "sl_1", side: "buy", posSide: "net", ordType: "conditional", sz: "2", slTriggerPx: "61000", reduceOnly: "true", state: "live" }]
  });
  db.accountSnapshots = [snapshot];
  const selected = selectBoundOkxSnapshot(db);
  assert.equal(selected.snapshot?.id, "snap_evidence");
  const account = compactAccountEvidence(db, snapshot, Date.now());
  assert.equal(account.quality, "passed");
  assert.deepEqual(account.data.positions.map((row) => [row.direction, row.contracts, row.coinQuantity, row.ctVal]), [["short", 2, 0.02, 0.01]]);
  assert.equal(account.data.openOrders[0].contracts, 1);
  assert.equal(account.data.algoOrders[0].triggerPrice, 61000);
});

test("incomplete private-order pagination fails closed instead of claiming the account is fully known", () => {
  const { snapshot, ...db } = boundDb({ openOrdersComplete: false, algoOrdersComplete: false });
  db.accountSnapshots = [snapshot];
  const account = compactAccountEvidence(db, snapshot, Date.now());
  assert.equal(account.quality, "failed");
  const result = evaluateEvidenceReadiness({
    account,
    symbols: [{
      symbol: "BTC/USDT",
      ticker: { status: "fresh", quality: "passed" },
      candles: { status: "fresh", quality: "passed" },
      microstructure: { status: "fresh", quality: "passed" },
      contractSpec: { status: "fresh", quality: "passed" }
    }]
  }, "BTC/USDT", { live: true });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("account_open_orders_incomplete"));
  assert.ok(result.blockers.includes("account_algo_orders_incomplete"));
});

test("credential or environment mismatch rejects an otherwise fresh OKX snapshot", () => {
  const { snapshot, ...db } = boundDb({ environment: "demo" });
  db.accountSnapshots = [snapshot];
  assert.equal(selectBoundOkxSnapshot(db).reason, "account_snapshot_environment_mismatch");
  snapshot.environment = "production";
  snapshot.apiKeyFingerprint = "wrong-fingerprint";
  assert.equal(selectBoundOkxSnapshot(db).reason, "okx_snapshot_credential_fingerprint_mismatch");
});

test("LLM prompt projection includes decision-critical market, account and protection facts", () => {
  const passed = { status: "fresh", quality: "passed" };
  const text = compactEvidenceForPrompt({
    id: "evb-full", generatedAt: "2026-08-16T00:00:00.000Z", criticalReady: true, blockers: [],
    symbols: [{
      symbol: "BTC/USDT",
      ticker: { ...passed, evidenceId: "ev:ticker", sourceAt: "2026-08-16T00:00:00Z", receivedAt: "2026-08-16T00:00:01Z", data: { price: 60000, high24h: 61000, low24h: 58000, change24hPct: 1.2 } },
      candles: { ...passed, evidenceId: "ev:candles", data: { closedBars: 200, lastClosedAt: "2026-08-15T23:00:00Z", lastClosedPrice: 59900 } },
      microstructure: { ...passed, evidenceId: "ev:micro", data: { fundingRatePct: 0.01, openInterest: 12345, spreadBps: 1.2, depthUsdt: 500000, bookImbalancePct: 54, sourceTimestamps: { book: "2026-08-16T00:00:00Z" } } },
      contractSpec: { ...passed, evidenceId: "ev:spec", data: { ctVal: 0.01, minSz: 1, lotSz: 1, tickSz: 0.1 } },
      smartMoney: { ...passed, evidenceId: "ev:smart", data: { topTraderLongShortRatio: 1.1, retailLongShortRatio: 0.9, takerBuySellRatio: 1.05 } }
    }],
    account: { ...passed, evidenceId: "ev:account", data: {
      accountId: "acc_okx", environment: "production", credentialBound: true,
      totalEquityUsdt: 1000, availableMarginUsdt: 800, positionCount: 1, openOrderCount: 0, algoOrderCount: 20,
      projectedPositionCount: 1, projectedOpenOrderCount: 0, projectedAlgoOrderCount: 1,
      openOrdersComplete: true, algoOrdersComplete: true, positionUnitsComplete: true,
      positions: [{ symbol: "BTC/USDT", direction: "long", coinQuantity: 0.01, contracts: 1, ctVal: 0.01, entryPrice: 59000, markPrice: 60000, liquidationPrice: 40000, leverage: 3, unrealizedPnl: 10, marginMode: "cross" }],
      openOrders: [], algoOrders: [{ symbol: "BTC/USDT", side: "sell", positionSide: "long", orderType: "conditional", triggerPrice: 57000, contracts: 1, reduceOnly: true, state: "live" }]
    } },
    accounting: { ...passed, evidenceId: "ev:accounting", data: { todayPnlUsdt: 10, unrealizedPnlUsdt: 10, remainingDailyLossUsdt: 40, dailyLossCapUsdt: 50, financiallyComplete: true } }
  });
  assert.match(text, /资金费率 0\.01%/);
  assert.match(text, /OI 12345/);
  assert.match(text, /ctVal 0\.01 币\/张/);
  assert.match(text, /0\.01 币 \/ 1 张/);
  assert.match(text, /策略单：BTC\/USDT/);
  assert.match(text, /策略单 1\/20/);
  assert.match(text, /未展示行不能被解释为不存在/);
  assert.match(text, /财务完整=true/);
});

test("中频OI/CVD、BTC Beta、事件波动与组合Beta真实进入Agent证据提示词", () => {
  const passed = { status: "fresh", quality: "passed", evidenceId: "ev:ok", data: {} };
  const text = compactEvidenceForPrompt({
    id: "evb-medium", generatedAt: "2026-08-12T00:00:00.000Z", criticalReady: true, blockers: [],
    symbols: [{
      symbol: "ETH/USDT", ticker: { ...passed, data: { price: 200 } }, candles: { ...passed, data: { closedBars: 200 } },
      microstructure: { ...passed, data: { spreadBps: 2, depthUsdt: 100000 } }, contractSpec: passed, smartMoney: passed,
      mediumTerm: { ...passed, evidenceId: "ev:medium", data: {
        latestAt: "2026-08-12T00:00:00.000Z",
        windows: Object.fromEntries(["15m", "1h", "4h"].map((tf) => [tf, { status: "ok", priceChangePct: 1, oiChangePct: 2, fundingEndPct: 0.01, fundingChangePp: 0.002, leverageState: "long_build", cvd: 300, divergence: "none" }])),
        btcRisk: { "24h": { status: "ok", correlation: 0.8, beta: 1.2 }, "3d": { status: "ok", correlation: 0.75, beta: 1.1 }, "7d": { status: "insufficient" } }
      } }
    }],
    mediumTermEventVolatility: { byType: { CPI: { status: "usable", samples: 8, avgPre1hRealizedVolPct: 0.2, avgPost15mRealizedVolPct: 0.3, avgPost1hRealizedVolPct: 0.7, avgPost4hRealizedVolPct: 1.2, medianPost1hVolExpansionRatio: 2, typicalReaction: "expansion", confidence: "provisional" } } },
    mediumTermPortfolioBtcRisk: { status: "ok", netBtcEquivalentUsdt: 120, grossBtcBetaExposureUsdt: 300, hedgeOffsetPct: 60 },
    account: { ...passed, evidenceId: "ev:account", data: { totalEquityUsdt: 1000, availableMarginUsdt: 800, positionCount: 1 } }
  });
  assert.match(text, /15m:价1%\/OI2%/);
  assert.match(text, /CVD净量300/);
  assert.match(text, /3d相关0\.75\/Beta1\.1/);
  assert.match(text, /CPI:n=8/);
  assert.match(text, /组合BTC Beta敞口\[ok\]/);
});
