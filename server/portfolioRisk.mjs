// ---------------------------------------------------------------------------
// 组合级波动率目标仓位管理。
// 思路：让整个组合运行在一个"日度波动预算"内，而不是单笔孤立地控风险。
// - 每个资产按已实现波动率反比定仓（高波动 → 小仓）；
// - 加仓前用相关性感知的组合波动公式，算出不突破预算的最大名义额度。
// 这样相关的主流币同向叠加会被自动压小，避免"三个仓其实是一个 Beta"。
// 数据不足时返回 null，由调用方回退到原有单笔风险定仓（不破坏现有行为）。
// ---------------------------------------------------------------------------

const BARS_PER_DAY = { "1m": 1440, "5m": 288, "15m": 96, "1h": 24, "4h": 6, "1d": 1 };
export const DEFAULT_PORTFOLIO_VOL_PCT = 3; // 组合日度波动预算（%）

function returnsOf(candles, n = 150) {
  const closes = (candles || []).slice(-n).map((c) => Number(c.close)).filter(Number.isFinite);
  const out = [];
  for (let i = 1; i < closes.length; i += 1) out.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  return out;
}

function stdev(arr) {
  if (!arr || arr.length < 2) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (x[i] - mx) * (y[i] - my);
    vx += (x[i] - mx) ** 2;
    vy += (y[i] - my) ** 2;
  }
  const denom = Math.sqrt(vx * vy);
  return denom > 0 ? Math.max(-1, Math.min(1, cov / denom)) : 0;
}

function marketOf(db, symbol) {
  return (db.markets || []).find((m) => m.symbol === String(symbol).toUpperCase());
}

// 资产日度波动率（小数，如 0.04 = 4%/日）
export function dailyVolFraction(market) {
  const rets = returnsOf(market?.candles);
  const s = stdev(rets);
  if (s === null) return null;
  const bpd = BARS_PER_DAY[market?.candlesTimeframe || "1h"] || 24;
  return s * Math.sqrt(bpd);
}

function equityOf(db) {
  const snapshot = (db.accountSnapshots || []).find((item) => item.status === "ok");
  if (snapshot?.exchange === "OKX") {
    const total = Number(snapshot.balances?.[0]?.totalEq);
    if (Number.isFinite(total) && total > 0) return total;
  }
  const fromPortfolio = Number(db.portfolio?.totalEquityUsdt);
  return Number.isFinite(fromPortfolio) && fromPortfolio > 0 ? fromPortfolio : null;
}

function openManagedPositions(db) {
  return (db.positions || []).filter((p) => Number(p.size) > 0 && (p.mark || p.entry));
}

function budgetFraction(mandate) {
  return Math.max(0.5, Number(mandate?.maxPortfolioVolPct || DEFAULT_PORTFOLIO_VOL_PCT)) / 100;
}

// 单资产波动率目标名义额度：让该仓位日度美元波动 = equity * volFraction。
export function volTargetNotional(equity, sigma, volFraction) {
  if (!equity || !sigma || sigma <= 0) return null;
  return equity * volFraction / sigma;
}

// 相关性感知的组合上限：给定已有持仓，求新仓在不突破组合波动预算下的最大名义额度。
export function portfolioCapNotional(db, plan, equity, mandate) {
  if (!equity) return null;
  const candMarket = marketOf(db, plan.symbol);
  const sigmaC = dailyVolFraction(candMarket);
  if (!sigmaC) return null;
  const candReturns = returnsOf(candMarket?.candles);

  const existing = openManagedPositions(db)
    .filter((p) => String(p.symbol).toUpperCase() !== String(plan.symbol).toUpperCase())
    .map((p) => {
      const m = marketOf(db, p.symbol);
      const sigma = dailyVolFraction(m);
      const notional = Number(p.size) * Number(p.mark || p.entry);
      if (!sigma || !Number.isFinite(notional)) return null;
      return { dollarVol: notional * sigma, returns: returnsOf(m?.candles) };
    })
    .filter(Boolean);

  const budgetDollarVol = equity * budgetFraction(mandate);
  // 已有组合美元波动的平方 S = Σ_ij dv_i dv_j ρ_ij
  let S = 0;
  for (let i = 0; i < existing.length; i += 1) {
    for (let j = 0; j < existing.length; j += 1) {
      const rho = i === j ? 1 : correlation(existing[i].returns, existing[j].returns);
      S += existing[i].dollarVol * existing[j].dollarVol * rho;
    }
  }
  // 与新仓的协方差项系数 b = Σ_i ρ_ci dv_i
  let b = 0;
  for (const e of existing) b += correlation(candReturns, e.returns) * e.dollarVol;
  // 解 x² + 2b x + (S - B²) = 0 中的正根 → 新仓允许的美元波动 x
  const disc = b * b - (S - budgetDollarVol * budgetDollarVol);
  if (disc < 0) return 0; // 已达/超预算
  const x = Math.max(0, -b + Math.sqrt(disc));
  return x / sigmaC;
}

// 组合风险快照（供接口/仪表盘展示）
export function buildPortfolioRisk(db, mandate) {
  const equity = equityOf(db);
  const budgetPct = budgetFraction(mandate) * 100;
  const positions = openManagedPositions(db).map((p) => {
    const m = marketOf(db, p.symbol);
    const sigma = dailyVolFraction(m);
    const notional = Number(p.size) * Number(p.mark || p.entry);
    return {
      symbol: p.symbol,
      dailyVolPct: sigma !== null ? Number((sigma * 100).toFixed(2)) : null,
      notionalUsdt: Number.isFinite(notional) ? Number(notional.toFixed(2)) : null,
      dollarVol: sigma !== null && Number.isFinite(notional) ? notional * sigma : null,
      returns: returnsOf(m?.candles)
    };
  });

  // 组合美元波动
  let portfolioVolPct = null;
  const priced = positions.filter((p) => p.dollarVol !== null);
  if (equity && priced.length) {
    let sumSq = 0;
    for (let i = 0; i < priced.length; i += 1) {
      for (let j = 0; j < priced.length; j += 1) {
        const rho = i === j ? 1 : correlation(priced[i].returns, priced[j].returns);
        sumSq += priced[i].dollarVol * priced[j].dollarVol * rho;
      }
    }
    portfolioVolPct = Number(((Math.sqrt(sumSq) / equity) * 100).toFixed(2));
  }

  const correlations = [];
  for (let i = 0; i < priced.length; i += 1) {
    for (let j = i + 1; j < priced.length; j += 1) {
      correlations.push({ pair: `${priced[i].symbol} / ${priced[j].symbol}`, rho: Number(correlation(priced[i].returns, priced[j].returns).toFixed(2)) });
    }
  }

  return {
    equity,
    budgetPct: Number(budgetPct.toFixed(2)),
    portfolioVolPct,
    utilizationPct: portfolioVolPct !== null && budgetPct > 0 ? Number(((portfolioVolPct / budgetPct) * 100).toFixed(0)) : null,
    positions: positions.map(({ returns, dollarVol, ...rest }) => rest),
    correlations: correlations.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho)).slice(0, 5),
    status: equity ? (priced.length ? "ok" : "no_positions") : "no_equity"
  };
}
