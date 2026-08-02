// 全市场机会发现扫描器:一个 OKX tickers 请求 → 把全部 USDT 永续按多因子打分,收窄到 Top N 候选。
// 定位:这是【筛选器/漏斗】,不是信号——它只负责"从 200+ 币里挑出值得看的几个",
// 具体做不做、怎么做,由 Agent 拿这几个候选去走五视角深分析(get_microstructure / analyze_market_structure)后决定。
// 全部真实 ticker 数据,确定性,无编造。
import { nowIso } from "./store.mjs";

const OKX_BASE = process.env.OKX_BASE_URL || "https://www.okx.com";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// —— 反追涨杀跌打分(纯函数、可单测)——
// 旧打分:rangePos 越高(贴24h上沿)longScore 越高 → 系统主动挑"已冲到顶"的币做多、"已砸到底"做空,
// 就是买在末端、追涨杀跌,还和自身纪律 S1「顺势回调进场,不摸顶」、S2「不追突破」矛盾。
// 新打分落实纪律:方向仍看动量正负(趋势),但入场质量奖励【顺势回调】——价格从极端位回撤到中段最优;
// 贴极端沿(追高/追空末端)与深跌未企稳(falling knife)都扣分。
// pullbackQuality:long 理想区间位 ~0.42、short ~0.58(留出到对边的空间),偏离越大分越低,极端处归零。
export function pullbackQuality(pos, side) {
  const p = Number(pos);
  if (!Number.isFinite(p)) return 0.5; // 缺区间位:中性,不追不惩
  const ideal = side === "short" ? 0.58 : 0.42;
  return clamp(1 - Math.abs(p - ideal) / 0.42, 0, 1);
}

// 返回 {longScore, shortScore}:趋势强度 45 + 回调质量 40 + 振幅 15(0-100)。
export function scoreCandidate({ momentum = 0, rangePos = 0.5, volPct = 0 } = {}) {
  const trendLong = clamp(momentum, 0, 30) / 30;
  const trendShort = clamp(-momentum, 0, 30) / 30;
  const volScore = clamp(volPct, 0, 20) / 20;
  return {
    longScore: trendLong * 45 + pullbackQuality(rangePos, "long") * 40 + volScore * 15,
    shortScore: trendShort * 45 + pullbackQuality(rangePos, "short") * 40 + volScore * 15
  };
}

// 诚实标签:是顺势回调候选,还是已追高/深跌未企稳的"别追"警示。
export function candidateTag(side, rangePos, momentum) {
  const p = Number(rangePos);
  if (side === "long") {
    if (p >= 0.8) return "已贴上沿·追高风险(等回调)";
    if (p <= 0.15) return "深跌未企稳·falling knife";
    if (momentum > 3 && p <= 0.6) return "顺势回调候选";
    return "偏多观察";
  }
  if (p <= 0.2) return "已贴下沿·追空末端(等反抽)";
  if (p >= 0.85) return "冲高未转弱·别摸顶";
  if (momentum < -3 && p >= 0.4) return "反抽做空候选";
  return "偏空观察";
}

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

      // 反追涨杀跌打分(见 scoreCandidate):方向看动量,入场质量奖励顺势回调、罚追极端。
      const { longScore, shortScore } = scoreCandidate({ momentum, rangePos, volPct });
      let side, score;
      if (direction === "long") { side = "long"; score = longScore; }
      else if (direction === "short") { side = "short"; score = shortScore; }
      else if (longScore >= shortScore) { side = "long"; score = longScore; }
      else { side = "short"; score = shortScore; }

      const tag = candidateTag(side, rangePos, momentum);

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
