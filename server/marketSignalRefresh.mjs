import { syncMicrostructure, syncPublicMarketQuiet } from "./exchangeConnector.mjs";
import { fetchSmartMoney } from "./marketSignals.mjs";
import { recordMediumTermSample } from "./mediumTermAnalytics.mjs";

const errorText = (error) => String(error?.message || error).slice(0, 160);

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(String(signal.reason || "market_signal_refresh_aborted"));
}

// 单币种行情刷新必须保持失败域隔离：ticker、微观结构和 Rubik 资金流来自
// 不同接口，其中任一失败都不能阻止另外两个刷新。尤其 REST ticker 被更新的
// WS tick 正常拒绝时，订单簿仍必须继续刷新，否则专业风险闸会被数据管道自锁。
export async function refreshMarketSignalSymbol(db, symbol, dependencies = {}) {
  const signal = dependencies.signal;
  const syncTicker = dependencies.syncTicker || syncPublicMarketQuiet;
  const syncMicro = dependencies.syncMicro || ((database, target, options) => syncMicrostructure(database, "OKX", target, { quiet: true, signal: options?.signal }));
  const syncSmartMoney = dependencies.syncSmartMoney || fetchSmartMoney;
  const recordSample = dependencies.recordSample || recordMediumTermSample;
  const errors = [];
  const warnings = [];
  let ticker = null;
  let micro = null;
  let smart = {};

  try {
    throwIfAborted(signal);
    ticker = await syncTicker(db, symbol, { signal });
  } catch (error) {
    throwIfAborted(signal);
    errors.push({ source: "ticker", error: errorText(error) });
  }
  try {
    throwIfAborted(signal);
    micro = await syncMicro(db, symbol, { signal });
  } catch (error) {
    throwIfAborted(signal);
    errors.push({ source: "microstructure", error: errorText(error) });
  }
  try {
    throwIfAborted(signal);
    smart = await syncSmartMoney(symbol, { signal });
  } catch (error) {
    throwIfAborted(signal);
    warnings.push({ source: "smart_money", error: errorText(error) });
  }

  if (ticker && Number.isFinite(Number(ticker.price)) && Number(ticker.price) > 0) {
    const priceSourceAt = Number.isFinite(Number(ticker.rawTime)) ? Number(ticker.rawTime) : ticker.rawTime || null;
    recordSample(db, {
      // 存储桶与价格事实同源，避免本机时钟或网络延迟把行情错放到相邻5分钟桶。
      symbol, at: priceSourceAt ?? new Date().toISOString(), price: Number(ticker.price),
      priceObservedAt: priceSourceAt ? new Date(priceSourceAt).toISOString() : null,
      openInterest: micro?.openInterest, fundingRatePct: micro?.fundingRatePct,
      spreadBps: micro?.spreadBps, depthUsdt: micro?.depthUsdt,
      oiObservedAt: micro?.sourceTimestamps?.openInterest,
      // fundingTime 是结算时点，不是“当前费率被我们观察到”的时点。
      fundingObservedAt: micro?.observedAt,
      takerBuyVolume: smart?.takerBuyVolume, takerSellVolume: smart?.takerSellVolume,
      flowAt: smart?.takerSourceAt, flowScope: smart?.takerScope,
      sourceAt: { ticker: ticker.rawTime || null, micro: micro?.sourceTimestamps || null, taker: smart?.takerSourceAt || null }
    });
  }

  return {
    complete: Boolean(ticker && micro),
    tickerSynced: Boolean(ticker),
    microSynced: Boolean(micro),
    smartMoneySynced: Boolean(smart && Object.keys(smart).length),
    errors,
    warnings
  };
}
