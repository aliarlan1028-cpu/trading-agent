// TRC20 USDT 支付路由组（请求/链上核验/回调）—— 从 index.mjs 按 registrar 范式迁出。
// 安全语义保留：回调仅在配置了 PAYMENT_WEBHOOK_SECRET 且签名匹配时才开通订阅，否则只记录。
export function registerPaymentRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, id, nowIso, appendAudit, addMonthsIso, verifyTrc20Payments, activateSubscriptionFromPayment } = ctx;

  app.post("/api/payments/trc20/request", requirePermission("write:mandate"), (req, res) => {
    const plan = (db.subscriptionPlans || []).find((item) => item.id === req.body.planId && item.enabled !== false);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    const address = process.env.TRC20_USDT_RECEIVE_ADDRESS || db.runtimeConfig?.TRC20_USDT_RECEIVE_ADDRESS;
    if (!address) return res.status(503).json({ error: "TRC20_USDT_RECEIVE_ADDRESS is not configured" });
    const payment = {
      id: id("pay"),
      tenantId: req.tenantId || req.user?.tenantId || "tenant_owner",
      userId: req.user?.id,
      planId: plan.id,
      network: "TRON",
      asset: "USDT",
      amount: Number(plan.priceUsdt || 0),
      address,
      status: "pending",
      expiresAt: addMonthsIso(0, 30),
      createdAt: nowIso()
    };
    db.paymentRequests ||= [];
    db.paymentRequests.unshift(payment);
    appendAudit(db, `创建 TRC20 USDT 支付请求：${plan.name}`, payment.id, req.user?.name || db.user.name);
    persist(res, payment);
  });

  app.post("/api/payments/trc20/verify", requirePermission("admin:system"), async (_req, res) => {
    persist(res, await verifyTrc20Payments(db));
  });

  app.post("/api/payments/trc20/webhook", (req, res) => {
    const payload = req.body || {};
    const txid = payload.txid || payload.transactionId || payload.hash;
    const paymentId = payload.paymentId || payload.orderId;
    const event = { id: id("payhook"), provider: payload.provider || "trc20", txid, paymentId, payload, createdAt: nowIso() };
    db.paymentWebhooks ||= [];
    db.paymentWebhooks.unshift(event);
    // 安全：只有配置了 PAYMENT_WEBHOOK_SECRET 且签名匹配，回调才允许开通订阅；
    // 否则只记录回调、不自动开通（真正的开通走 TronGrid 链上核验 payment_verify）。
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    const signatureOk = secret && (req.headers["x-webhook-secret"] === secret || payload.secret === secret);
    const payment = paymentId ? (db.paymentRequests || []).find((item) => item.id === paymentId) : null;
    if (payment && signatureOk && (payload.status === "confirmed" || payload.confirmed === true)) {
      payment.status = "confirmed";
      payment.txid = txid;
      payment.confirmedAt = nowIso();
      payment.verifiedBy = "webhook_signed";
      activateSubscriptionFromPayment(payment);
    }
    appendAudit(db, `收到 TRC20 支付回调：${txid || paymentId || "unknown"}${signatureOk ? "（已验签开通）" : "（未验签，仅记录）"}`, event.id, "PaymentWebhook", signatureOk ? "info" : "warning");
    saveDb(db);
    res.json({ ok: true, activated: Boolean(payment && signatureOk) });
  });
}
