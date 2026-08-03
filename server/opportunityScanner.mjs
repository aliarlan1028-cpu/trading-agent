// 全市场机会发现扫描器:一个 OKX tickers 请求 → 把全部 USDT 永续按多因子打分,收窄到 Top N 候选。
// 定位:这是【筛选器/漏斗】,不是信号——它只负责"从 200+ 币里挑出值得看的几个",
// 具体做不做、怎么做,由 Agent 拿这几个候选去走五视角深分析(get_microstructure / analyze_market_structure)后决定。
// 全部真实 ticker 数据,确定性,无编造。
import { nowIso } from "./store.mjs";

const OKX_BASE = process.env.OKX_BASE_URL || "https://www.okx.com";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// —— 扫描器打分配置:单一事实源,可调,应以回测/寻优为准 ——
// 定性(重要):这套权重与理想回调位是【全市场粗筛漏斗启发式 + 反追涨杀跌纪律 S1】,
// 不是经回测验证的 alpha 模型。它只决定"200+ 币里先看哪几个、以什么顺序看",
// 做不做、怎么做仍由 Agent 拿分解因子(动量/区间位/振幅,已在候选字段透明暴露)走深分析自判。
// 调这些数请以回测为准、勿凭感觉;env 仅供试验,长期应沉淀进策略寻优(见 strategyOptimizer)。
const SCAN = {
  trendWeight: num(process.env.SCAN_TREND_WEIGHT, 45),           // 趋势(动量方向)权重
  pullbackWeight: num(process.env.SCAN_PULLBACK_WEIGHT, 40),     // 顺势回调质量权重(纪律 S1:不摸顶/不追末端)
  volWeight: num(process.env.SCAN_VOL_WEIGHT, 15),              // 振幅(可交易性)权重
  idealPullbackLong: num(process.env.SCAN_IDEAL_PULLBACK_LONG, 0.42),   // 多单理想回调区间位
  idealPullbackShort: num(process.env.SCAN_IDEAL_PULLBACK_SHORT, 0.58), // 空单理想反抽区间位
  pullbackBand: num(process.env.SCAN_PULLBACK_BAND, 0.42),       // 偏离带宽:偏离理想位多远时归零
  trendCap: 30,   // 动量饱和上限(±30% 封顶为满分)
  volCap: 20      // 振幅饱和上限(20% 封顶为满分)
};

// pullbackQuality:入场质量奖励顺势回调——价格从极端位回撤到中段最优;贴极端沿(追末端)与深跌未企稳都归零。
// 这是纪律 S1 的量化落地,不是行情预测;理想位/带宽全部来自上面的 SCAN 配置。
export function pullbackQuality(pos, side) {
  const p = Number(pos);
  if (!Number.isFinite(p)) return 0.5; // 缺区间位:中性,不追不惩
  const ideal = side === "short" ? SCAN.idealPullbackShort : SCAN.idealPullbackLong;
  return clamp(1 - Math.abs(p - ideal) / SCAN.pullbackBand, 0, 1);
}

// 返回 {longScore, shortScore}:趋势强度 + 回调质量 + 振幅,权重见 SCAN 配置(默认 45/40/15,满分 100)。
export function scoreCandidate({ momentum = 0, rangePos = 0.5, volPct = 0 } = {}) {
  const trendLong = clamp(momentum, 0, SCAN.trendCap) / SCAN.trendCap;
  const trendShort = clamp(-momentum, 0, SCAN.trendCap) / SCAN.trendCap;
  const volScore = clamp(volPct, 0, SCAN.volCap) / SCAN.volCap;
  return {
    longScore: trendLong * SCAN.trendWeight + pullbackQuality(rangePos, "long") * SCAN.pullbackWeight + volScore * SCAN.volWeight,
    shortScore: trendShort * SCAN.trendWeight + pullbackQuality(rangePos, "short") * SCAN.pullbackWeight + volScore * SCAN.volWeight
  };
}

// 中性位置事实:只陈述"价格在24h区间的哪、动量强弱",不下"追高/该等回调/别摸顶"这类结论——
// 那是 Agent 结合纪律 S1/S2 自己的判断,扫描器不替它下。原始 rangePos/momentum 也在候选字段里透明可见。
// (_side 保留仅为签名兼容,中性描述不依赖方向。)
export function candidateTag(_side, rangePos, momentum) {
  const p = Number(rangePos), m = Number(momentum);
  const zone = !Number.isFinite(p) ? "区间位未知"
    : p >= 0.8 ? `贴24h上沿(${p.toFixed(2)})`
    : p <= 0.2 ? `贴24h下沿(${p.toFixed(2)})`
    : `24h区间中段(${p.toFixed(2)})`;
  const mo = !Number.isFinite(m) ? "" : m >= 3 ? "·动量偏强" : m <= -3 ? "·动量偏弱" : "·动量平缓";
  return zone + mo;
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
