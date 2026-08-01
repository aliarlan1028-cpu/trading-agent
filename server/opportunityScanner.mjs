// 全市场机会发现扫描器:一个 OKX tickers 请求 → 把全部 USDT 永续按多因子打分,收窄到 Top N 候选。
// 定位:这是【筛选器/漏斗】,不是信号——它只负责"从 200+ 币里挑出值得看的几个",
// 具体做不做、怎么做,由 Agent 拿这几个候选去走五视角深分析(get_microstructure / analyze_market_structure)后决定。
// 全部真实 ticker 数据,确定性,无编造。
import { nowIso } from "./store.mjs";

const OKX_BASE = process.env.OKX_BASE_URL || "https://www.okx.com";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// opts: { limit(默认8,1-20), direction("long"|"short"|"both"默认both), minQuoteVolUsdt(流动性下限,默认5e6),
//         excludeSymbols(数组,如已持仓/白名单可排除或标注) }
export async function scanOpportunities(db, opts = {}) {
  const limit = Math.max(1, Math.min(20, Number(opts.limit ?? 8)));
  const direction = ["long", "short", "both"].includes(opts.direction) ? opts.direction : "both";
  const minVol = Math.max(0, Number(opts.minQuoteVolUsdt ?? 5_000_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const raw = await fetch(`${OKX_BASE}/api/v5/market/tickers?instType=SWAP`, { signal: controller.signal }).then((r) => r.json());
    if (raw.code !== "0" || !Array.isArray(raw.data)) return { candidates: [], scannedAt: nowIso(), universe: 0, error: raw.msg || "OKX tickers 拉取失败" };

    const whitelist = new Set((opts.whitelist || []).map((s) => String(s).toUpperCase()));
    const scored = [];
    let universe = 0;
    for (const t of raw.data) {
      if (!String(t.instId).endsWith("-USDT-SWAP")) continue;
      const last = Number(t.last), open = Number(t.open24h) || Number(t.sodUtc0), high = Number(t.high24h), low = Number(t.low24h);
      const volUsdt = Number(t.volCcy24h) * last;
      if (![last, open, high, low].every(Number.isFinite) || last <= 0 || open <= 0 || high <= low) continue;
      universe += 1;
      if (volUsdt < minVol) continue; // 流动性下限:滤掉不流动小币,避免冲击成本吃穿

      const momentum = (last - open) / open * 100;          // 24h 涨跌 %
      const rangePos = clamp((last - low) / (high - low), 0, 1); // 0=贴下沿 1=贴上沿
      const volPct = (high - low) / last * 100;              // 24h 振幅 %
      const symbol = String(t.instId).replace("-SWAP", "").replace("-", "/");

      // 方向感知打分(0-100):动量 40 + 区间位置 35 + 振幅 25。做多要动量正+贴上沿;做空反之。
      const volScore = clamp(volPct, 0, 20) / 20 * 25;
      const longScore = clamp(momentum, 0, 30) / 30 * 40 + rangePos * 35 + volScore;
      const shortScore = clamp(-momentum, 0, 30) / 30 * 40 + (1 - rangePos) * 35 + volScore;
      let side, score;
      if (direction === "long") { side = "long"; score = longScore; }
      else if (direction === "short") { side = "short"; score = shortScore; }
      else if (longScore >= shortScore) { side = "long"; score = longScore; }
      else { side = "short"; score = shortScore; }

      const tag = side === "long"
        ? (rangePos >= 0.85 ? "逼近上沿·突破候选" : momentum >= 8 ? "强动量候选" : "偏多候选")
        : (rangePos <= 0.15 ? "贴近下沿·破位候选" : momentum <= -8 ? "强下行候选" : "偏空候选");

      scored.push({
        symbol, side, score: Number(score.toFixed(1)),
        changePct24h: Number(momentum.toFixed(2)),
        rangePos: Number(rangePos.toFixed(2)),
        volatilityPct: Number(volPct.toFixed(1)),
        quoteVolUsdtM: Number((volUsdt / 1e6).toFixed(1)),
        last,
        inWhitelist: whitelist.has(symbol.toUpperCase()),
        tag,
        reason: `24h ${momentum >= 0 ? "+" : ""}${momentum.toFixed(1)}% · 区间位${rangePos.toFixed(2)} · 振幅${volPct.toFixed(1)}% · 成交$${(volUsdt / 1e6).toFixed(0)}M`
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return { candidates: scored.slice(0, limit), scannedAt: nowIso(), universe, filteredByLiquidity: universe - scored.length, direction, minQuoteVolUsdt: minVol };
  } catch (error) {
    return { candidates: [], scannedAt: nowIso(), universe: 0, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}
