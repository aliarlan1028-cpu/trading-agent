// 通知中心路由组（读/标已读 + 飞书/Telegram 状态与测试）—— 从 index.mjs 按 registrar 范式迁出。
export function registerNotificationRoutes(app, ctx) {
  const {
    db, saveDb, requirePermission, nowIso, larkStatus, telegramStatus, notifyLark, sendTelegramPositionPoster,
    telegramWatchStatus, queueWatchTelegramEvent, dispatchTelegramWatchOutbox
  } = ctx;

  app.get("/api/notifications", (_req, res) => res.json((db.notifications || []).slice(0, 50)));

  // 标记已读:传 id 只标那一条(通知详情「标记已读」);不传 id 标全部(打开通知中心/「全部已读」清徽章)。
  app.post("/api/notifications/read", (req, res) => {
    const id = req.body?.id;
    let marked = 0;
    for (const item of db.notifications || []) {
      if (id && item.id !== id) continue;
      if (!item.read) { item.read = true; marked++; }
    }
    if (marked) saveDb(db);
    res.json({ ok: true, marked });
  });

  app.get("/api/notifications/lark-status", (_req, res) => res.json(larkStatus()));
  app.get("/api/notifications/telegram-status", (_req, res) => res.json(telegramStatus()));
  app.get("/api/notifications/telegram-watch-status", (_req, res) => res.json(telegramWatchStatus()));

  app.post("/api/notifications/lark-test", requirePermission("admin:security"), async (_req, res) => {
    const result = await notifyLark(db, {
      severity: "info",
      title: "🔔 飞书通知测试",
      body: "如果你在飞书里看到这条消息，说明 AI 交易员的主动通知已打通。",
      fields: [{ label: "来源", value: "AI 交易员" }, { label: "状态", value: "测试" }]
    });
    saveDb(db);
    res.json({ message: `飞书通知：${result.deliveryStatus}`, notification: result });
  });

  app.post("/api/notifications/telegram-test", requirePermission("admin:security"), async (_req, res) => {
    const position = {
      id: "telegram_test_position", exchange: "OKX", symbol: "BTC/USDT", direction: "long",
      size: 0.03, entry: 62000, mark: 64800, leverage: 10, pnl: 84, roiPct: 43.2,
      stopLoss: 60800, takeProfits: [66000], openedAt: new Date(Date.now() - 3.7 * 3600_000).toISOString(),
      updatedAt: nowIso(), isSample: true
    };
    const result = await sendTelegramPositionPoster(db, position, { caption: "SAMPLE · PROFIT POSTER PREVIEW · Simulated data — not a live trade." });
    saveDb(db);
    res.json({ message: `Telegram 海报：${result.status}`, ...result });
  });

  app.post("/api/notifications/telegram-watch-test", requirePermission("admin:security"), async (_req, res) => {
    const watch = {
      id: `watch_test_${Date.now()}`, version: 1, symbol: "BTC/USDT", kind: "price_above", level: 1,
      status: "triggered", priority: "primary", purpose: "confirmation", direction: "long", createdAt: nowIso(), analysisAt: nowIso(),
      thesis: "BTC 1H structure is constructive; the system is monitoring a long scenario, not holding a position.",
      triggerMeaning: "The confirmation level was reached. Re-check structure and order flow before deciding whether a long entry is valid.",
      note: "This test watch requests a fresh analysis only. It never places an order.", triggerPrice: 1, triggeredAt: nowIso(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    };
    db.watchTriggers ||= [];
    db.watchTriggers.unshift(watch);
    let queued;
    try {
      queued = queueWatchTelegramEvent(db, watch, "triggered", { autoAnalyze: true });
    } finally {
      db.watchTriggers = db.watchTriggers.filter((item) => item.id !== watch.id);
    }
    const dispatched = await dispatchTelegramWatchOutbox(db);
    saveDb(db);
    res.json({ message: `Telegram 观察哨测试：${dispatched.status}`, queued: queued.status, dispatched });
  });
}
