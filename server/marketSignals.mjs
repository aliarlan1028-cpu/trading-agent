// ---------------------------------------------------------------------------
// 全局大盘层 + 聪明钱信号（均为免费公开数据，无需密钥）。
//   - 全局大盘：BTC 主导率、总市值 24h 趋势、恐惧贪婪指数（CoinGecko + alternative.me）
//   - 聪明钱：合约大户/散户多空持仓比、主动买卖比（OKX rubik 主，Binance futures-data 备）
// 让 Agent "先判大盘、再看个币"，并用持仓结构近似"大资金心理"。
// 网络走全局 undici 代理（netProxy 已装）。任一源失败都容错（返回 null 字段），绝不阻断决策。
// 交易所净流入流出 / 大额链上转账 / 清算热图需要付费数据源，留待接入。
// ---------------------------------------------------------------------------
import { nowIso } from "./store.mjs";
import { toOkxSymbol } from "./exchangeConnector.mjs";

const COINGECKO = "https://api.coingecko.com/api/v3";
const FNG = "https://api.alternative.me/fng/?limit=1";
const OKX_BASE = "https://www.okx.com";
const RUBIK = `${OKX_BASE}/api/v5/rubik/stat/contracts`;

function timer(ms = 8000) {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(handle) };
}

async function getJson(url, signal) {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json();
}

// ---------------------------------------------------------------------------
// 全局大盘
// ---------------------------------------------------------------------------
export async function fetchGlobalMarket() {
  const clock = timer(9000);
  try {
    const [global, fng] = await Promise.allSettled([
      getJson(`${COINGECKO}/global`, clock.signal),
      getJson(FNG, clock.signal)
    ]);
    const out = { fetchedAt: nowIso() };
    if (global.status === "fulfilled") {
      const d = global.value?.data || {};
      out.btcDominancePct = d.market_cap_percentage?.btc != null ? Number(Number(d.market_cap_percentage.btc).toFixed(2)) : null;
      out.ethDominancePct = d.market_cap_percentage?.eth != null ? Number(Number(d.market_cap_percentage.eth).toFixed(2)) : null;
      out.totalMcapUsd = d.total_market_cap?.usd != null ? Math.round(d.total_market_cap.usd) : null;
      out.mcap24hChangePct = d.market_cap_change_percentage_24h_usd != null ? Number(Number(d.market_cap_change_percentage_24h_usd).toFixed(2)) : null;
    }
    if (fng.status === "fulfilled") {
      const f = fng.value?.data?.[0];
      if (f) out.fearGreed = { value: Number(f.value), label: f.value_classification };
    }
    out.interpretation = interpretGlobal(out);
    out.ok = out.btcDominancePct != null || out.fearGreed != null;
    return out;
  } finally {
    clock.cancel();
  }
}

function interpretGlobal(g) {
  const parts = [];
  if (g.btcDominancePct != null) parts.push(`BTC 主导率 ${g.btcDominancePct}%`);
  if (g.mcap24hChangePct != null) parts.push(`总市值 24h ${g.mcap24hChangePct >= 0 ? "+" : ""}${g.mcap24hChangePct}%（${g.mcap24hChangePct >= 0 ? "回暖" : "走弱"}）`);
  if (g.fearGreed) parts.push(`情绪 ${g.fearGreed.value}/${g.fearGreed.label}（${g.fearGreed.value <= 25 ? "极度恐惧，往往是反向机会" : g.fearGreed.value >= 75 ? "极度贪婪，注意回撤风险" : "中性"}）`);
  return parts.join("；") || "全局数据不足";
}

// ---------------------------------------------------------------------------
// 聪明钱：大户/散户多空持仓比、主动买卖比
// ---------------------------------------------------------------------------
export async function fetchSmartMoney(symbol = "BTC/USDT") {
  const out = { symbol, fetchedAt: nowIso() };
  const ccy = String(symbol).split("/")[0].toUpperCase();
  const instId = toOkxSymbol(symbol, "perpetual"); // 如 BTC-USDT-SWAP
  const firstRatio = (settled) => {
    const row = settled.status === "fulfilled" ? settled.value?.data?.[0] : null; // [ts, ratio]
    return row && row[1] != null && Number.isFinite(Number(row[1])) ? Number(Number(row[1]).toFixed(3)) : null;
  };

  // 全部走 OKX rubik（服务器直连可用，无地区屏蔽）：
  //  - 大户持仓多空比 = 真·聪明钱定位（精英交易员按持仓）
  //  - 大户账户多空比 = 精英交易员按人数
  //  - 全体持仓人数多空比 = 散户/大众定位
  //  - 主动买卖量 = 成交侵略性
  const okx = timer(9000);
  try {
    const [topPos, topAcct, crowd, taker] = await Promise.allSettled([
      getJson(`${RUBIK}/long-short-position-ratio-contract-top-trader?instId=${instId}&period=5m`, okx.signal),
      getJson(`${RUBIK}/long-short-account-ratio-contract-top-trader?instId=${instId}&period=5m`, okx.signal),
      getJson(`${RUBIK}/long-short-account-ratio-contract?instId=${instId}&period=5m`, okx.signal),
      getJson(`${OKX_BASE}/api/v5/rubik/stat/taker-volume?ccy=${ccy}&instType=CONTRACTS&period=5m`, okx.signal)
    ]);
    out.topTraderLongShortRatio = firstRatio(topPos);   // 大户持仓多空比（真·聪明钱）
    out.topTraderAccountRatio = firstRatio(topAcct);    // 大户账户多空比
    out.retailLongShortRatio = firstRatio(crowd);       // 全体持仓人数多空比（散户为主）
    if (taker.status === "fulfilled") {
      const row = taker.value?.data?.[0]; // [ts, sellVol, buyVol]
      if (row) {
        const buy = Number(row[2]);
        const sell = Number(row[1]);
        if (sell > 0) out.takerBuySellRatio = Number((buy / sell).toFixed(3));
      }
    }
  } catch {
    /* OKX 不可用则跳过 */
  } finally {
    okx.cancel();
  }

  out.interpretation = interpretSmartMoney(out);
  out.ok = out.topTraderLongShortRatio != null || out.retailLongShortRatio != null || out.takerBuySellRatio != null;
  return out;
}

function interpretSmartMoney(s) {
  const parts = [];
  if (s.topTraderLongShortRatio != null) {
    parts.push(`大户持仓多空比 ${s.topTraderLongShortRatio}（${s.topTraderLongShortRatio > 1.15 ? "大资金偏多" : s.topTraderLongShortRatio < 0.87 ? "大资金偏空" : "大资金中性"}）`);
  }
  if (s.retailLongShortRatio != null) {
    parts.push(`散户账户多空比 ${s.retailLongShortRatio}（${s.retailLongShortRatio > 1.3 ? "散户过度看多" : s.retailLongShortRatio < 0.77 ? "散户过度看空" : "散户中性"}）`);
  }
  if (s.topTraderLongShortRatio != null && s.retailLongShortRatio != null) {
    if (s.topTraderLongShortRatio > 1.05 && s.retailLongShortRatio < 0.95) parts.push("大户偏多 + 散户偏空 → 主力或在吸筹，偏多有利");
    else if (s.topTraderLongShortRatio < 0.95 && s.retailLongShortRatio > 1.05) parts.push("大户偏空 + 散户偏多 → 警惕派发/诱多，逢高谨慎");
  }
  if (s.takerBuySellRatio != null) {
    parts.push(`主动买卖比 ${s.takerBuySellRatio}（${s.takerBuySellRatio > 1.05 ? "主动买盘占优" : s.takerBuySellRatio < 0.95 ? "主动卖盘占优" : "买卖均衡"}）`);
  }
  return parts.join("；") || "聪明钱数据不足（数据源暂不可用）";
}

// 组合快照：供巡检/UI 一次取全（大盘 + 指定交易对聪明钱）。
export async function fetchMarketRegime(symbol = "BTC/USDT") {
  const [global, smart] = await Promise.all([
    fetchGlobalMarket().catch(() => null),
    fetchSmartMoney(symbol).catch(() => null)
  ]);
  return { global, smartMoney: smart, symbol, fetchedAt: nowIso() };
}
