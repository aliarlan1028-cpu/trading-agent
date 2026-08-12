// ---------------------------------------------------------------------------
// 全局大盘层 + 聪明钱信号（均为 OKX 免费公开数据，无需密钥）。
//   - 全局大盘：OKX USDT 永续涨跌家数、涨跌中位数、BTC 24h 变化
//   - 聪明钱：OKX 合约大户/散户多空持仓比、主动买卖比、公开 WS 强平事件
// 让 Agent "先判大盘、再看个币"，并用持仓结构近似"大资金心理"。
// 网络走全局 undici 代理（netProxy 已装）。任一源失败都容错（返回 null 字段），绝不阻断决策。
// 交易所净流入流出 / 大额链上转账 / 清算热图需要付费数据源；这里只陈述 OKX 事件数量。
// ---------------------------------------------------------------------------
import { nowIso } from "./store.mjs";
import { toOkxSymbol } from "./exchangeConnector.mjs";
import { getOkxLiquidationSummary } from "./okxLiquidationStream.mjs";

const OKX_BASE = process.env.OKX_BASE_URL || "https://www.okx.com";
const RUBIK = `${OKX_BASE}/api/v5/rubik/stat/contracts`;

// 永续合约清单缓存（1 小时）——合约上下架不频繁，避免每次打开面板都拉。
let instrumentsCache = { at: 0, list: [] };

function timer(ms = 8000) {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(handle) };
}

async function getJson(url, signal) {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  const payload = await response.json();
  if (String(payload?.code ?? "0") !== "0") throw new Error(`${url} API ${payload?.code}: ${payload?.msg || "unknown error"}`);
  return payload;
}

export function parseContractTakerVolumeRow(row) {
  if (!row) return null;
  const ts = Array.isArray(row) ? row[0] : row.ts;
  const sell = Number(Array.isArray(row) ? row[1] : row.sellVol);
  const buy = Number(Array.isArray(row) ? row[2] : row.buyVol);
  const sourceMs = Number(ts);
  if (!Number.isFinite(sourceMs) || sourceMs <= 0 || !Number.isFinite(buy) || buy < 0 || !Number.isFinite(sell) || sell < 0) return null;
  return { buy, sell, sourceAt: new Date(sourceMs).toISOString() };
}

// ---------------------------------------------------------------------------
// 全局大盘
// ---------------------------------------------------------------------------
export async function fetchGlobalMarket() {
  const clock = timer(9000);
  try {
    const payload = await getJson(`${OKX_BASE}/api/v5/market/tickers?instType=SWAP`, clock.signal);
    const out = { ...summarizeOkxSwapBreadth(payload?.data || []), fetchedAt: nowIso(), source: "OKX" };
    out.interpretation = interpretGlobal(out);
    out.ok = out.instruments > 0;
    return out;
  } finally {
    clock.cancel();
  }
}

export function summarizeOkxSwapBreadth(tickers = []) {
  const changes = [];
  let btcChangePct = null;
  for (const ticker of tickers) {
    const instId = String(ticker?.instId || "").toUpperCase();
    if (!instId.endsWith("-USDT-SWAP")) continue;
    const last = Number(ticker.last);
    const open24h = Number(ticker.open24h);
    if (!Number.isFinite(last) || last <= 0 || !Number.isFinite(open24h) || open24h <= 0) continue;
    const changePct = (last / open24h - 1) * 100;
    changes.push(changePct);
    if (instId === "BTC-USDT-SWAP") btcChangePct = changePct;
  }
  changes.sort((a, b) => a - b);
  const middle = changes.length ? Math.floor(changes.length / 2) : 0;
  const median = !changes.length ? null : changes.length % 2 ? changes[middle] : (changes[middle - 1] + changes[middle]) / 2;
  const advancing = changes.filter((change) => change > 0).length;
  const declining = changes.filter((change) => change < 0).length;
  const breadthPct = changes.length ? advancing / changes.length * 100 : null;
  const bias = breadthPct == null ? "unknown"
    : breadthPct >= 60 && median > 0 ? "risk_on"
    : breadthPct <= 40 && median < 0 ? "risk_off"
    : "mixed";
  return {
    instruments: changes.length,
    advancing,
    declining,
    unchanged: Math.max(0, changes.length - advancing - declining),
    breadthPct: breadthPct == null ? null : Number(breadthPct.toFixed(1)),
    medianChangePct: median == null ? null : Number(median.toFixed(3)),
    btcChangePct: btcChangePct == null ? null : Number(btcChangePct.toFixed(3)),
    bias
  };
}

function interpretGlobal(g) {
  const parts = [];
  if (g.breadthPct != null) parts.push(`OKX 永续上涨家数 ${g.breadthPct}%（${g.advancing}/${g.instruments}）`);
  if (g.medianChangePct != null) parts.push(`全市场 24h 涨跌中位数 ${g.medianChangePct >= 0 ? "+" : ""}${g.medianChangePct}%`);
  if (g.btcChangePct != null) parts.push(`BTC 永续 24h ${g.btcChangePct >= 0 ? "+" : ""}${g.btcChangePct}%`);
  if (g.bias && g.bias !== "unknown") parts.push(`广度状态 ${g.bias === "risk_on" ? "偏强" : g.bias === "risk_off" ? "偏弱" : "分化"}`);
  return parts.join("；") || "OKX 全局数据不足";
}

// ---------------------------------------------------------------------------
// 聪明钱：大户/散户多空持仓比、主动买卖比
// ---------------------------------------------------------------------------
export async function fetchSmartMoney(symbol = "BTC/USDT") {
  const out = { symbol, fetchedAt: nowIso() };
  const instId = toOkxSymbol(symbol, "perpetual"); // 如 BTC-USDT-SWAP
  const firstRatio = (settled) => {
    const row = settled.status === "fulfilled" ? settled.value?.data?.[0] : null; // [ts, ratio]
    return row && row[1] != null && Number.isFinite(Number(row[1])) ? Number(Number(row[1]).toFixed(3)) : null;
  };

  // 比率与主动成交走 OKX Rubik；强平走启动时建立的 OKX 官方公开 WebSocket 连续窗口：
  //  - 大户持仓多空比 = 真·聪明钱定位（精英交易员按持仓）
  //  - 大户账户多空比 = 精英交易员按人数
  //  - 全体持仓人数多空比 = 散户/大众定位
  //  - 主动买卖量 = 成交侵略性
  //  - 强平事件 = 只有连续覆盖满 30 分钟才参与，断线或预热不足均视为不可用
  const okx = timer(9000);
  try {
    const [topPos, topAcct, crowd, taker] = await Promise.allSettled([
      getJson(`${RUBIK}/long-short-position-ratio-contract-top-trader?instId=${instId}&period=5m`, okx.signal),
      getJson(`${RUBIK}/long-short-account-ratio-contract-top-trader?instId=${instId}&period=5m`, okx.signal),
      getJson(`${RUBIK}/long-short-account-ratio-contract?instId=${instId}&period=5m`, okx.signal),
      // 必须使用单合约口径。按 ccy 的 taker-volume 会把交割期货等 CONTRACTS
      // 混在一起，不能用于 BTC-USDT-SWAP 这类具体永续合约的 CVD。
      getJson(`${OKX_BASE}/api/v5/rubik/stat/taker-volume-contract?instId=${instId}&period=5m`, okx.signal)
    ]);
    out.topTraderLongShortRatio = firstRatio(topPos);   // 大户持仓多空比（真·聪明钱）
    out.topTraderAccountRatio = firstRatio(topAcct);    // 大户账户多空比
    out.retailLongShortRatio = firstRatio(crowd);       // 全体持仓人数多空比（散户为主）
    if (taker.status === "fulfilled") {
      const row = taker.value?.data?.[0]; // [ts, sellVol, buyVol]
      const parsed = parseContractTakerVolumeRow(row);
      if (parsed) {
        const { buy, sell, sourceAt } = parsed;
        if (sell > 0) out.takerBuySellRatio = Number((buy / sell).toFixed(3));
        out.takerBuyVolume = buy;
        out.takerSellVolume = sell;
        out.takerSourceAt = sourceAt;
        out.takerScope = "OKX_CONTRACT_INSTRUMENT_5M";
        out.takerInstrument = instId;
      }
    }
    const liquidations = getOkxLiquidationSummary(symbol);
    if (liquidations?.completeWindow) out.liquidations = liquidations;
  } catch {
    /* OKX 不可用则跳过 */
  } finally {
    okx.cancel();
  }

  out.interpretation = interpretSmartMoney(out);
  out.ok = out.topTraderLongShortRatio != null || out.retailLongShortRatio != null || out.takerBuySellRatio != null;
  return out;
}

// 机械读数:把原始比值按固定阈值分桶,给 Agent 一份客观描述——只陈述"数值落在哪个区间",
// 不含"该做多/主力吸筹/逢高谨慎"这类方向结论或处方(那是 Agent 结合知识自己下的判断)。
// 原始比值同时透明保留在 topTraderLongShortRatio 等字段,Agent 可绕过本读数直接看数。
function interpretSmartMoney(s) {
  const parts = [];
  if (s.topTraderLongShortRatio != null) {
    parts.push(`大户持仓多空比 ${s.topTraderLongShortRatio}（${s.topTraderLongShortRatio > 1.15 ? "偏多" : s.topTraderLongShortRatio < 0.87 ? "偏空" : "中性"}）`);
  }
  if (s.retailLongShortRatio != null) {
    parts.push(`散户账户多空比 ${s.retailLongShortRatio}（${s.retailLongShortRatio > 1.3 ? "多头拥挤" : s.retailLongShortRatio < 0.77 ? "空头拥挤" : "中性"}）`);
  }
  if (s.topTraderLongShortRatio != null && s.retailLongShortRatio != null) {
    if (s.topTraderLongShortRatio > 1.05 && s.retailLongShortRatio < 0.95) parts.push("大户偏多 / 散户偏空（持仓背离）");
    else if (s.topTraderLongShortRatio < 0.95 && s.retailLongShortRatio > 1.05) parts.push("大户偏空 / 散户偏多（持仓背离）");
  }
  if (s.takerBuySellRatio != null) {
    parts.push(`主动买卖比 ${s.takerBuySellRatio}（${s.takerBuySellRatio > 1.05 ? "买盘占优" : s.takerBuySellRatio < 0.95 ? "卖盘占优" : "均衡"}）`);
  }
  if (s.liquidations?.total) {
    const L = s.liquidations;
    const dir = L.dominantSide === "long" ? "多头爆仓为主"
      : L.dominantSide === "short" ? "空头爆仓为主"
      : "多空爆仓均衡";
    parts.push(`近期爆仓 多${L.longLiqCount}/空${L.shortLiqCount} 单，${dir}`);
  }
  return parts.length ? "机械读数（供参考，非结论）：" + parts.join("；") : "聪明钱数据不足（数据源暂不可用）";
}

// ---------------------------------------------------------------------------
// 全部 OKX USDT 本位永续合约清单——授权、分析和执行使用同一市场。
// ---------------------------------------------------------------------------
export async function fetchPerpetualInstruments() {
  if (instrumentsCache.list.length && Date.now() - instrumentsCache.at < 3600_000) return instrumentsCache.list;
  const map = new Map(); // symbol -> Set(exchange)
  const add = (symbol, exchange) => {
    if (!symbol) return;
    if (!map.has(symbol)) map.set(symbol, new Set());
    map.get(symbol).add(exchange);
  };

  const okx = timer(10000);
  try {
    const res = await getJson(`${OKX_BASE}/api/v5/public/instruments?instType=SWAP`, okx.signal);
    for (const it of res?.data || []) {
      if (it.settleCcy === "USDT" && String(it.instId).endsWith("-USDT-SWAP") && it.state === "live") {
        add(String(it.instId).replace("-SWAP", "").replace("-", "/"), "OKX");
      }
    }
  } catch {
    /* OKX 不可用则跳过 */
  } finally {
    okx.cancel();
  }

  const list = [...map.entries()]
    .map(([symbol, exchanges]) => ({ symbol, exchanges: [...exchanges].sort() }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (list.length) instrumentsCache = { at: Date.now(), list };
  return list.length ? list : instrumentsCache.list;
}

// ---------------------------------------------------------------------------
// 聪明钱择时过滤器：给定聪明钱快照 + 交易方向，判断"是否与聪明钱对齐"。
// 大户同向=加分；散户拥挤=反向指标；主动买卖/爆仓方向=辅助。用作软性择时闸，
// 不硬拦（数据可能缺失/滞后），只给对齐结论与理由，供人工审批与 Agent 参考。
// ---------------------------------------------------------------------------
export function evaluateSmartMoneyAlignment(smartMoney, direction) {
  const dir = String(direction || "").toLowerCase();
  if (!smartMoney?.ok || (dir !== "long" && dir !== "short")) {
    return { alignment: "neutral", score: 0, reasons: ["聪明钱数据不足或方向未知"] };
  }
  const reasons = [];
  let score = 0; // >0 支持该方向，<0 与该方向相悖
  const bias = (v, hi, lo) => (v == null ? 0 : v > hi ? 1 : v < lo ? -1 : 0);
  const forDir = (bullish) => (dir === "long" ? bullish : -bullish);

  const topBias = bias(smartMoney.topTraderLongShortRatio, 1.1, 0.9); // +1 大户偏多
  if (topBias !== 0) {
    const s = forDir(topBias);
    score += s * 2;
    reasons.push(`大户${topBias > 0 ? "偏多" : "偏空"}，${s > 0 ? "与方向一致" : "与方向相悖"}`);
  }
  const retailBias = bias(smartMoney.retailLongShortRatio, 1.3, 0.77);
  if (retailBias !== 0) {
    const s = forDir(-retailBias); // 散户拥挤 → 反向指标
    score += s;
    reasons.push(`散户${retailBias > 0 ? "过度看多" : "过度看空"}（反向指标${s > 0 ? "支持" : "警示"}）`);
  }
  const takerBias = bias(smartMoney.takerBuySellRatio, 1.05, 0.95);
  if (takerBias !== 0) {
    score += forDir(takerBias) * 0.5;
    reasons.push(`主动${takerBias > 0 ? "买盘" : "卖盘"}占优`);
  }
  if (smartMoney.liquidations?.total) {
    const liqBull = smartMoney.liquidations.dominantSide === "short" ? 1 : smartMoney.liquidations.dominantSide === "long" ? -1 : 0;
    if (liqBull !== 0) {
      score += forDir(liqBull) * 0.5;
      reasons.push(`${liqBull > 0 ? "空头" : "多头"}爆仓为主`);
    }
  }
  const alignment = score >= 1.5 ? "favor" : score <= -1.5 ? "caution" : "neutral";
  return { alignment, score: Number(score.toFixed(2)), reasons };
}

// 组合快照：供巡检/UI 一次取全（大盘 + 指定交易对聪明钱）。
export async function fetchMarketRegime(symbol = "BTC/USDT") {
  const [global, smart] = await Promise.all([
    fetchGlobalMarket().catch(() => null),
    fetchSmartMoney(symbol).catch(() => null)
  ]);
  return { global, smartMoney: smart, symbol, fetchedAt: nowIso() };
}
