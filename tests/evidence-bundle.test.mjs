import assert from "node:assert/strict";
import test from "node:test";
import { compactEvidenceForPrompt, evaluateEvidenceReadiness, symbolsForEvidence } from "../server/evidenceBundle.mjs";

test("evidence symbol routing prioritizes explicit symbols and deduplicates mandate scope", () => {
  const symbols = symbolsForEvidence("比较 BTC/USDT 和 ETH-USDT-SWAP", { allowedSymbols: ["BTC/USDT", "SOL/USDT"] }, 3);
  assert.deepEqual(symbols, ["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
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
  assert.match(text, /1H闭合K线 不可用\[/);
  assert.doesNotMatch(text, /1H闭合K线 0 根/);
  assert.match(text, /点差 不可用\/深度 不可用/);
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
