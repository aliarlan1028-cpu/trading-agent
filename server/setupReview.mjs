// Deterministic, role-aware market structure facts for the AI trader.
// The previous implementation called a second LLM inside the main Agent loop,
// adding 35–43 seconds and making BOS/CHoCH an unverifiable opinion. This module
// now computes facts from closed OKX OHLCV; the main Agent remains responsible
// for synthesis, while risk and execution stay unchanged.
import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { appendTrace } from "./store.mjs";
import { analyzeMultiTimeframeStructure } from "./marketStructureFacts.mjs";

const STRUCTURE_ANALYSIS_VERSION = 3;
const LIMITS = Object.freeze({ "1d": 80, "4h": 100, "1h": 140, "15m": 180, "5m": 200 });

export async function analyzeMarketStructure(db, symbol = "BTC/USDT", direction = null, options = {}) {
  db.structureAnalysisCache ||= {};
  const traderRole = ["day_trader", "swing_trader"].includes(options.traderRole) ? options.traderRole : "auto";
  const cacheKey = `v${STRUCTURE_ANALYSIS_VERSION}|${String(symbol).toUpperCase()}|${direction || "neutral"}|${traderRole}`;
  const cached = db.structureAnalysisCache[cacheKey];
  // The day profile includes 5m candles, so the old ten-minute cache could be
  // older than an entire confirmation bar. Closed-candle facts use a short cache.
  const cacheTtlMs = Number(process.env.STRUCTURE_ANALYSIS_CACHE_MS || 2 * 60_000);
  if (cached?.analyzedAt && Date.now() - new Date(cached.analyzedAt).getTime() <= cacheTtlMs) {
    appendTrace(db, "structure_analysis", `${symbol} ${cached.bias || "?"} deterministic_cache_hit`, "ok", 0);
    return { ...cached, cacheHit: true };
  }

  const timeframes = Object.keys(LIMITS);
  const settled = await Promise.allSettled(timeframes.map((timeframe) => getHistoricalKlines(symbol, timeframe, LIMITS[timeframe])));
  const candlesByTf = {};
  const unavailableTimeframes = [];
  for (let index = 0; index < timeframes.length; index += 1) {
    if (settled[index].status === "fulfilled" && settled[index].value?.length) candlesByTf[timeframes[index]] = settled[index].value;
    else unavailableTimeframes.push(timeframes[index]);
  }
  if (!Object.keys(candlesByTf).length) return { available: false, deterministic: true, reason: "无法获取真实闭合K线", unavailableTimeframes };

  const market = (db.markets || []).find((item) => item.symbol === symbol) || {};
  const result = {
    version: STRUCTURE_ANALYSIS_VERSION,
    ...analyzeMultiTimeframeStructure(candlesByTf, { symbol, direction, traderRole: options.traderRole, market }),
    unavailableTimeframes,
    analyzedAt: new Date().toISOString(),
    cacheHit: false
  };
  appendTrace(db, "structure_analysis", `${symbol} ${result.bias || "?"} ${result.selectedRole || "?"} deterministic`, "ok", 0);
  db.structureAnalysisCache[cacheKey] = result;
  const cacheEntries = Object.entries(db.structureAnalysisCache).sort((a, b) => new Date(b[1]?.analyzedAt || 0) - new Date(a[1]?.analyzedAt || 0));
  db.structureAnalysisCache = Object.fromEntries(cacheEntries.slice(0, 100));
  return result;
}
