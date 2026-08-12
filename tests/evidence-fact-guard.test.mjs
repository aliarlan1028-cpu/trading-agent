import assert from "node:assert/strict";
import test from "node:test";
import { enforceEvidenceFacts } from "../server/evidenceFactGuard.mjs";

function fixture(overrides = {}) {
  const entry = (evidenceId, data) => ({ evidenceId, status: "fresh", quality: "passed", fetchedAt: "2026-08-08T06:00:00.000Z", data });
  return {
    account: entry("ev:account", { totalEquityUsdt: 34.0558, availableMarginUsdt: 30.5, positionCount: 0 }),
    global: entry("ev:global", { breadthPct: 62.4, medianChangePct: 0.7, btcChangePct: 1.5 }),
    accounting: entry("ev:accounting", { todayPnlUsdt: -1.2, unrealizedPnlUsdt: 0.8, remainingDailyLossUsdt: 6.81, dailyLossCapUsdt: 10 }),
    symbols: [{
      symbol: "BTC/USDT",
      ticker: entry("ev:ticker", { price: 60000, high24h: 105, low24h: 95, change24hPct: 1.5 }),
      candles: entry("ev:candles", { closedBars: 100, lastClosedPrice: 99 }),
      microstructure: entry("ev:micro", { fundingRatePct: 0.01, openInterest: 123456, spreadBps: 1.2, depthUsdt: 500000, bookImbalancePct: 55 }),
      contractSpec: entry("ev:spec", { ctVal: 0.01, minSz: 0.01, lotSz: 0.01, tickSz: 0.1 }),
      smartMoney: entry("ev:smart", { topTraderLongShortRatio: 1.1, retailLongShortRatio: 0.9, takerBuySellRatio: 1.05 })
    }],
    ...overrides
  };
}

test("core guard deterministically corrects current price and account facts", () => {
  const guarded = enforceEvidenceFacts(fixture(), "BTC/USDT 当前价：58000\n账户净值：99 USDT");
  assert.equal(guarded.corrected, true);
  assert.match(guarded.text, /当前价：60000/);
  assert.match(guarded.text, /账户净值：34\.0558/);
  assert.equal(guarded.violations.length, 2);
  assert.match(guarded.text, /ev:ticker/);
});

test("historical, hypothetical and planned numbers are not treated as current facts", () => {
  const text = "历史复盘：BTC 当时价格 58000。\n计划入场 59000，止损 58000。\n如果现价到 58000 再评估。";
  const guarded = enforceEvidenceFacts(fixture(), text);
  assert.equal(guarded.corrected, false);
  assert.equal(guarded.text, text);
  assert.equal(guarded.shadowViolations.length, 0);
});

test("extended fields are checked in shadow by default and can be hard-enforced", () => {
  const text = "BTC/USDT 当前资金费率：0.2%，OI：999999";
  const shadow = enforceEvidenceFacts(fixture(), text);
  assert.equal(shadow.corrected, false);
  assert.equal(shadow.shadowViolations.length, 2);
  assert.equal(shadow.text, text);

  const enforced = enforceEvidenceFacts(fixture(), text, { mode: "enforce_all" });
  assert.equal(enforced.corrected, true);
  assert.match(enforced.text, /资金费率：0\.01%/);
  assert.match(enforced.text, /OI：123456/);
});

test("stale core evidence removes the unsupported current claim", () => {
  const bundle = fixture();
  bundle.symbols[0].ticker.status = "stale";
  const guarded = enforceEvidenceFacts(bundle, "BTC/USDT 当前价：58000");
  assert.equal(guarded.corrected, true);
  assert.match(guarded.text, /无法确认/);
  assert.doesNotMatch(guarded.text, /58000/);
});

test("rounding inside configured tolerance does not trigger a correction", () => {
  const guarded = enforceEvidenceFacts(fixture(), "BTC/USDT 当前价：59950");
  assert.equal(guarded.corrected, false);
  assert.equal(guarded.violations.length, 0);
});

test("a false empty-position statement is replaced by the private account snapshot", () => {
  const bundle = fixture();
  bundle.account.data.positionCount = 1;
  bundle.account.data.positions = [{ symbol: "ETH/USDT", direction: "short", contracts: 2 }];
  const guarded = enforceEvidenceFacts(bundle, "当前无持仓。");
  assert.equal(guarded.corrected, true);
  assert.match(guarded.text, /当前持仓 1 个/);
  assert.match(guarded.text, /ETH\/USDT short 2张/);
});

test("derived daily risk budget is a hard-guarded fact, not an LLM estimate", () => {
  const guarded = enforceEvidenceFacts(fixture(), "剩余日亏预算：80.05 USDT");
  assert.equal(guarded.corrected, true);
  assert.match(guarded.text, /6\.81 USDT/);
  assert.match(guarded.text, /ev:accounting/);
});

test("all evidence fields participate in enforce-all validation", () => {
  const text = [
    "BTC/USDT 24h最高价：99999",
    "BTC/USDT 1H闭合K线：10根",
    "BTC/USDT 买盘占比：80%",
    "BTC/USDT tickSz：1",
    "BTC/USDT 大户持仓多空比：2",
    "BTC/USDT 散户账户多空比：2",
    "BTC/USDT 主动买卖比：2",
    "全市场24h涨跌中位数：9%"
  ].join("\n");
  const guarded = enforceEvidenceFacts(fixture(), text, { mode: "enforce_all" });
  assert.equal(guarded.violations.length, 8);
  assert.match(guarded.text, /24h最高价：105/);
  assert.match(guarded.text, /1H闭合K线：100根/);
  assert.match(guarded.text, /买盘占比：55%/);
  assert.match(guarded.text, /tickSz：0\.1/);
  assert.match(guarded.text, /大户持仓多空比：1\.1/);
  assert.match(guarded.text, /散户账户多空比：0\.9/);
  assert.match(guarded.text, /主动买卖比：1\.05/);
  assert.match(guarded.text, /涨跌中位数：0\.7%/);
});

test("a false empty-order statement is replaced by the private snapshot count", () => {
  const bundle = fixture();
  bundle.account.data.openOrderCount = 2;
  const guarded = enforceEvidenceFacts(bundle, "当前无挂单。");
  assert.equal(guarded.corrected, true);
  assert.match(guarded.text, /当前有 2 个未成交挂单/);
});

test("missing numeric evidence is unavailable rather than fabricated as zero", () => {
  const bundle = fixture();
  bundle.account.data.totalEquityUsdt = null;
  const guarded = enforceEvidenceFacts(bundle, "账户净值：99 USDT");
  assert.equal(guarded.corrected, true);
  assert.match(guarded.text, /无法确认/);
  assert.doesNotMatch(guarded.text, /账户净值：0(?:\D|$)/);
});

test("multi-symbol headings scope following price lines to the correct evidence row", () => {
  const btc = fixture().symbols[0];
  const adaEntry = (evidenceId, data) => ({ evidenceId, status: "fresh", quality: "passed", fetchedAt: "2026-08-08T06:00:00.000Z", data });
  const bundle = fixture({
    symbols: [
      btc,
      {
        symbol: "ADA/USDT",
        ticker: adaEntry("ev:ticker:ada", { price: 0.188, high24h: 0.2, low24h: 0.18, change24hPct: -2 }),
        candles: adaEntry("ev:candles:ada", { closedBars: 100, lastClosedPrice: 0.188 }),
        microstructure: adaEntry("ev:micro:ada", {}),
        contractSpec: adaEntry("ev:spec:ada", {}),
        smartMoney: adaEntry("ev:smart:ada", {})
      }
    ]
  });
  const guarded = enforceEvidenceFacts(bundle, "### BTC/USDT\n现价：0.188\n\n### ADA/USDT\n现价：60000");
  assert.match(guarded.text, /### BTC\/USDT\n现价：60000/);
  assert.match(guarded.text, /### ADA\/USDT\n现价：0\.188/);
});

test("single-symbol proposal evidence never rewrites another asset in a multi-asset narrative", () => {
  const adaOnly = fixture({
    symbols: [{ ...fixture().symbols[0], symbol: "ADA/USDT", ticker: { ...fixture().symbols[0].ticker, evidenceId: "ev:ticker:ada", data: { price: 0.188 } } }]
  });
  const text = "### BTC/USDT\n现价：64000\n\n### ADA/USDT\n现价：0.19";
  const guarded = enforceEvidenceFacts(adaOnly, text);
  assert.match(guarded.text, /BTC\/USDT\n现价：64000/);
  assert.match(guarded.text, /ADA\/USDT\n现价：0\.188/);
  assert.doesNotMatch(guarded.text, /BTC\/USDT\n现价：0\.188/);
});
