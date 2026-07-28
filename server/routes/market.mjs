// 行情路由组（大盘/聪明钱 regime、合约清单、公有 K 线带缓存、币种画像）——
// 从 index.mjs 按 registrar 范式迁出。公开数据、免鉴权。klineCache 移入本模块。依赖经 ctx 注入。
export function registerMarketRoutes(app, ctx) {
  const { db, persist, activeMandate, fetchMarketRegime, nowIso, fetchPerpetualInstruments, normalizeSymbol, getHistoricalKlines, fetchTokenProfile } = ctx;
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
      const instruments = await fetchPerpetualInstruments();
      res.json({ instruments, count: instruments.length });
    } catch (error) {
      res.status(500).json({ error: `合约清单获取失败：${error.message}`, instruments: [] });
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
}
