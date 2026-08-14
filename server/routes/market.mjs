// 行情路由组（大盘/聪明钱 regime、合约清单、公有 K 线带缓存、币种画像）——
// 从 index.mjs 按 registrar 范式迁出。公开数据、免鉴权。klineCache 移入本模块。依赖经 ctx 注入。
export function registerMarketRoutes(app, ctx) {
  const { db, persist, activeMandate, fetchMarketRegime, nowIso, fetchPerpetualInstruments, fetchPerpetualInstrumentCatalog, normalizeSymbol, getHistoricalKlines, fetchTokenProfile } = ctx;
  const klineCache = new Map(); // key -> { at, payload }（10s 内存缓存，移动端重复请求即时返回）

  app.get("/api/market/regime", async (_req, res) => {
    try {
      const symbol = activeMandate(db)?.allowedSymbols?.[0] || "BTC/USDT";
      const regime = await fetchMarketRegime(symbol);
      const prev = db.marketRegime || {};
      db.marketRegime = {
        ...regime,
        global: regime.global || prev.global || null,
        smartMoney: regime.smartMoney || prev.smartMoney || null,
        updatedAt: nowIso()
      };
      persist(res, db.marketRegime);
    } catch (error) {
      res.status(500).json({ error: `全局大盘/聪明钱同步失败：${error.message}` });
    }
  });

  app.get("/api/market/instruments", async (_req, res) => {
    try {
      const catalog = fetchPerpetualInstrumentCatalog
        ? await fetchPerpetualInstrumentCatalog()
        : { instruments: await fetchPerpetualInstruments(), sourceStatus: "healthy", asOf: nowIso(), stale: false, source: "OKX" };
      if (catalog.sourceStatus === "failed" || !catalog.instruments?.length) {
        return res.status(503).json({ ...catalog, instruments: [], count: 0, error: `合约清单获取失败：${catalog.error || "OKX 未返回可交易合约"}` });
      }
      res.json({ ...catalog, count: catalog.instruments.length });
    } catch (error) {
      res.status(503).json({ error: `合约清单获取失败：${error.message}`, instruments: [], count: 0, sourceStatus: "failed", asOf: null, stale: false, source: "OKX" });
    }
  });

  app.get("/api/market/klines", async (req, res) => {
    try {
      const symbol = normalizeSymbol(String(req.query.symbol || "BTC/USDT"));
      if (!symbol) return res.status(400).json({ error: "无效的交易对", candles: [] });
      const tf = String(req.query.tf || "1h");
      if (!["5m", "15m", "1h", "4h", "1d"].includes(tf)) return res.status(400).json({ error: "无效的 K 线周期", candles: [] });
      const requestedLimit = Number(req.query.limit || 200);
      const limit = Number.isFinite(requestedLimit) ? Math.max(20, Math.min(requestedLimit, 500)) : 200;
      const key = `${symbol}|${tf}|${limit}`;
      const hit = klineCache.get(key);
      if (hit && Date.now() - hit.at < 10000) { res.json(hit.payload); return; }
      const candles = await getHistoricalKlines(symbol, tf, limit);
      const payload = { symbol, tf, candles: candles || [] };
      if (candles && candles.length) {
        klineCache.set(key, { at: Date.now(), payload });
        while (klineCache.size > 100) klineCache.delete(klineCache.keys().next().value);
      }
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: `K线获取失败：${error.message}`, candles: [] });
    }
  });

  app.get("/api/market/token-profile", async (req, res) => {
    try {
      const profile = await fetchTokenProfile(req.query.symbol || "BTC/USDT", req.query.timeframe || "1h");
      res.json(profile);
    } catch (error) {
      res.status(500).json({ error: `币种画像失败：${error.message}`, ok: false });
    }
  });

  // 公开行情跑马灯:营销页顶栏用的真实数据(OKX SWAP 最新价 + 当日涨跌 + BTC 资金费率/未平仓),
  // 后端代取(不受地区屏蔽、避免前端跨域),15s 内存缓存防打爆 OKX。免鉴权(见 auth 白名单)。
  const TICKER_SYMBOLS = (process.env.TICKER_SYMBOLS || "BTC,ETH,SOL,BNB,XRP,DOGE,ADA,SUI,LINK,AVAX").split(",").map((s) => s.trim()).filter(Boolean);
  const OKX_BASE = process.env.OKX_BASE_URL || "https://www.okx.com";
  let tickerCache = { at: 0, payload: null };
  app.get("/api/public/ticker-bar", async (_req, res) => {
    try {
      if (tickerCache.payload && Date.now() - tickerCache.at < 15000) { res.json(tickerCache.payload); return; }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const [tick, funding, oi] = await Promise.all([
        fetch(`${OKX_BASE}/api/v5/market/tickers?instType=SWAP`, { signal: controller.signal }).then((r) => r.json()),
        fetch(`${OKX_BASE}/api/v5/public/funding-rate?instId=BTC-USDT-SWAP`, { signal: controller.signal }).then((r) => r.json()).catch(() => null),
        fetch(`${OKX_BASE}/api/v5/public/open-interest?instId=BTC-USDT-SWAP`, { signal: controller.signal }).then((r) => r.json()).catch(() => null)
      ]);
      clearTimeout(timer);
      const byId = new Map();
      if (tick && tick.code === "0" && Array.isArray(tick.data)) for (const t of tick.data) byId.set(t.instId, t);
      const items = TICKER_SYMBOLS.map((sym) => {
        const t = byId.get(`${sym}-USDT-SWAP`);
        if (!t) return null;
        const last = Number(t.last), sod = Number(t.sodUtc0);
        const changePct = sod > 0 ? Number((((last - sod) / sod) * 100).toFixed(2)) : 0;
        return { symbol: `${sym}/USDT`, last, changePct };
      }).filter(Boolean);
      const fr = funding?.data?.[0]?.fundingRate;
      const fundingPct = fr !== undefined && fr !== null ? Number((Number(fr) * 100).toFixed(4)) : null;
      const oiCcy = oi?.data?.[0]?.oiCcy;
      const btcOi = oiCcy !== undefined && oiCcy !== null ? Number(oiCcy) : null;
      const payload = { items, fundingPct, btcOi, at: nowIso() };
      if (items.length) tickerCache = { at: Date.now(), payload };
      res.json(payload);
    } catch (error) {
      res.json({ items: [], fundingPct: null, btcOi: null, at: nowIso(), error: String(error.message || error) });
    }
  });
}
