// 通知中心路由组（读/标已读 + 飞书/Telegram 状态与测试）—— 从 index.mjs 按 registrar 范式迁出。
export function registerNotificationRoutes(app, ctx) {
  const { db, saveDb, requirePermission, nowIso, larkStatus, telegramStatus, notifyLark, sendTelegramPositionPoster } = ctx;

  app.get("/api/notifications", (_req, res) => res.json((db.notifications || []).slice(0, 50)));

  // 打开通知中心即把未读标为已读（清除未读徽章）
  app.post("/api/notifications/read", (_req, res) => {
    let marked = 0;
    for (const item of db.notifications || []) { if (!item.read) { item.read = true; marked++; } }
    if (marked) saveDb(db);
    res.json({ ok: true, marked });
  });

  app.get("/api/notifications/lark-status", (_req, res) => res.json(larkStatus()));
  app.get("/api/notifications/telegram-status", (_req, res) => res.json(telegramStatus()));

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
    const position = db.positions?.find((item) => Number(item.pnl ?? item.upl ?? item.unrealizedPnl) > 0) || {
      id: "telegram_test_position", exchange: "OKX", symbol: "BTC/USDT", direction: "long",
      size: 0.01, entry: 100000, mark: 103500, leverage: 5, pnl: 35, updatedAt: nowIso()
    };
    const result = await sendTelegramPositionPoster(db, position, { caption: "Telegram 盈利仓位海报测试" });
    saveDb(db);
    res.json({ message: `Telegram 海报：${result.status}`, ...result });
  });
}
