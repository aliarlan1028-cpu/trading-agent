// 持仓 UI 视图归一化:把原始 db.positions 变成"给前端用的一行一仓"。
// 背景(审计实锤):同一真实仓在 db 里有两条——execution_engine(引擎自记,带入场理由/planId)
// 与 exchange_rest(交易所同步,带真实 liqPx/杠杆/币量)。/api/overview 此前原样下发 →
// 持仓明细同一仓显示两行,还字段错配:前端读 liquidationPrice/notional/margin/liqDistancePct,
// 而真实字段是 liqPx/(无)/(无)。这里在下发前:①按 symbol+方向合并两行 ②补齐派生字段 ③统一口径。
// 只影响展示;db 两条保留供 reconcileAccount 逐仓对账,互不影响。

const isOpen = (p) => !p.status || p.status === "open";
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// 方向归一化:多/long/buy → "多";空/short/sell → "空"(UI 为中文,统一成中文,含 tone 可判)。
export function canonDirection(d) {
  const s = String(d ?? "").toLowerCase();
  if (s.includes("short") || s.includes("空") || s === "sell") return "空";
  return "多";
}

export function normalizePositionsForUi(positions = []) {
  const groups = new Map();
  for (const p of positions.filter(isOpen)) {
    const key = `${String(p.symbol || "").toUpperCase()}::${canonDirection(p.direction ?? p.posSide)}`;
    const g = groups.get(key) || {};
    if (p.source === "execution_engine") g.engine = p; else g.exchange = p;
    groups.set(key, g);
  }
  const rows = [];
  for (const [, g] of groups) {
    const base = g.engine || g.exchange; // 引擎行作身份(AI托管/入场理由);无引擎则纯手动/外部仓
    const ex = g.exchange || {};
    const eng = g.engine || {};
    const mark = num(base.mark) ?? num(ex.mark) ?? num(eng.mark);
    const coinQty = num(ex.coinSize) ?? num(eng.size) ?? num(base.size); // 交易所 coinSize 权威;引擎 size 即币量
    const leverage = num(ex.leverage) ?? num(eng.leverage);
    const liqPx = num(ex.liqPx) ?? num(eng.liqPx);
    const unrealizedPnl = num(eng.unrealizedPnl) ?? num(ex.unrealizedPnl) ?? num(base.pnl);
    const notional = coinQty !== null && mark !== null ? Math.abs(coinQty * mark) : null;
    const margin = notional !== null && leverage ? notional / leverage : null;
    const liqDistancePct = liqPx !== null && mark ? Math.abs((mark - liqPx) / mark) * 100 : null;
    rows.push({
      ...base,
      source: g.engine ? "execution_engine" : (ex.source || base.source),
      symbol: base.symbol,
      direction: canonDirection(base.direction ?? ex.direction),
      entry: num(base.entry) ?? num(ex.entry),
      mark,
      quantity: coinQty,            // 统一为币量(不再混合约张数/币量)
      leverage,
      unrealizedPnl,
      pnl: unrealizedPnl,
      roiPct: num(ex.roiPct) ?? num(eng.roiPct) ?? base.roiPct, // 交易所杠杆化 ROI 优先
      notional,                     // = 币量 × 标记价(此前前端读 notional 恒缺 → 敞口/分布恒 0)
      margin,                       // = 名义 / 杠杆(此前前端读 margin 恒缺 → 保证金占用恒 —)
      liquidationPrice: liqPx,      // 对齐前端读的字段名(此前读 liquidationPrice、真名 liqPx → 恒 —)
      liqDistancePct,               // 补上(此前缺 → 强平距离恒判"安全")
      exchangePositionKey: ex.exchangePositionKey || base.exchangePositionKey || null
    });
  }
  return rows;
}
