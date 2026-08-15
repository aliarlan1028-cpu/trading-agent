import crypto from "node:crypto";
import { issueApplicantAccessToken, sendRegistrationLifecycleEmail, updateRegistrationApplication } from "../publicRegistration.mjs";
import { allocateUniquePaymentAmount } from "../trc20Payments.mjs";

// TRC20 USDT 支付路由组（请求/链上核验/回调）—— 从 index.mjs 按 registrar 范式迁出。
// 安全语义保留：回调仅在配置了 PAYMENT_WEBHOOK_SECRET 且签名匹配时才开通订阅，否则只记录。
export function registerPaymentRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, id, nowIso, appendAudit, addMonthsIso, verifyTrc20Payments, activateSubscriptionFromPayment } = ctx;

  app.post("/api/payments/trc20/request", requirePermission("write:mandate"), (req, res) => {
    const plan = (db.subscriptionPlans || []).find((item) => item.id === req.body.planId && item.enabled !== false);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    const existingSubscription = (db.subscriptions || []).find((item) => item.tenantId === (req.tenantId || req.user?.tenantId || "tenant_owner"));
    if (existingSubscription?.planId && existingSubscription.planId !== plan.id
      && new Date(existingSubscription.currentPeriodEnd).getTime() > Date.now()) {
      return res.status(409).json({ error: "subscription_plan_change_requires_proration", message: "当前套餐仍在有效期内；更换套餐需要明确的折算策略，不能按普通续期静默覆盖。" });
    }
    const address = process.env.TRC20_USDT_RECEIVE_ADDRESS || db.runtimeConfig?.TRC20_USDT_RECEIVE_ADDRESS;
    if (!address) return res.status(503).json({ error: "TRC20_USDT_RECEIVE_ADDRESS is not configured" });
    const payment = {
      id: id("pay"),
      tenantId: req.tenantId || req.user?.tenantId || "tenant_owner",
      userId: req.user?.id,
      planId: plan.id,
      network: "TRON",
      asset: "USDT",
      baseAmount: Number(plan.priceUsdt || 0),
      amount: allocateUniquePaymentAmount(db, Number(plan.priceUsdt || 0)),
      exactAmount: true,
      amountIntentVersion: 1,
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

  app.post("/api/admin/registration/applications/:id/payment", requirePermission("admin:system"), async (req, res) => {
    try {
      const application = (db.registrationApplications || []).find((item) => item.id === req.params.id);
      if (!application) return res.status(404).json({ error: "Registration application not found" });
      const oldPending = (db.paymentRequests || []).find((item) => item.registrationApplicationId === application.id && item.status === "pending");
      if (application.status === "payment_pending" && oldPending && new Date(oldPending.expiresAt).getTime() <= Date.now()) {
        oldPending.status = "expired";
        oldPending.expiredAt = nowIso();
        updateRegistrationApplication(db, application.id, { status: "approved" });
      }
      if (application.status !== "approved") return res.status(409).json({ error: "Application must be approved before requesting payment" });
      const plan = (db.subscriptionPlans || []).find((item) => item.id === (req.body?.planId || application.planId) && item.enabled !== false);
      if (!plan || Number(plan.priceUsdt || 0) <= 0) return res.status(400).json({ error: "A paid enabled plan is required" });
      const address = process.env.TRC20_USDT_RECEIVE_ADDRESS || db.runtimeConfig?.TRC20_USDT_RECEIVE_ADDRESS;
      if (!address) return res.status(503).json({ error: "TRC20_USDT_RECEIVE_ADDRESS is not configured" });
      const existing = (db.paymentRequests || []).find((item) => item.registrationApplicationId === application.id && item.status === "pending" && new Date(item.expiresAt).getTime() > Date.now());
      if (existing) return res.json({ payment: existing, message: "已存在待支付订单" });
      const payment = {
        id: id("pay"),
        registrationApplicationId: application.id,
        planId: plan.id,
        network: "TRON",
        asset: "USDT",
        baseAmount: Number(plan.priceUsdt),
        amount: allocateUniquePaymentAmount(db, Number(plan.priceUsdt)),
        exactAmount: true,
        amountIntentVersion: 1,
        address,
        status: "pending",
        source: "public_onboarding",
        expiresAt: addMonthsIso(0, 2),
        createdAt: nowIso()
      };
      db.paymentRequests ||= [];
      db.paymentRequests.unshift(payment);
      updateRegistrationApplication(db, application.id, { status: "payment_pending" });
      const accessToken = issueApplicantAccessToken(db, application.id);
      const delivery = await sendRegistrationLifecycleEmail(application, "payment_requested", {
        payment: { network: payment.network, asset: payment.asset, amount: payment.amount, address: payment.address, expiresAt: payment.expiresAt }
      }, accessToken);
      appendAudit(db, `创建客户开通支付请求：${payment.id}`, application.id, req.user?.name || db.user.name, "warning");
      persist(res, { payment, emailDelivery: delivery.sent ? "sent" : "manual_delivery_required", message: delivery.sent ? "支付请求已发送到验证邮箱" : "支付请求已创建；邮件服务不可用，请人工安全交付" });
    } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });

  app.post("/api/payments/trc20/verify", requirePermission("admin:system"), async (_req, res) => {
    persist(res, await verifyTrc20Payments(db));
  });

  app.post("/api/payments/trc20/webhook", async (req, res) => {
    const payload = req.body || {};
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    const supplied = String(req.headers["x-webhook-secret"] || "");
    const signatureOk = Boolean(secret) && safeEqual(supplied, secret);
    if (!signatureOk) {
      appendAudit(db, "拒绝未验签的 TRC20 支付回调", "payment_webhook", "PaymentWebhook", "warning");
      return res.status(401).json({ error: "Invalid webhook signature" });
    }
    const txid = payload.txid || payload.transactionId || payload.hash;
    const paymentId = payload.paymentId || payload.orderId;
    const { secret: _discardedSecret, ...safePayload } = payload;
    const event = { id: id("payhook"), provider: payload.provider || "trc20", txid, paymentId, payload: safePayload, createdAt: nowIso() };
    db.paymentWebhooks ||= [];
    db.paymentWebhooks.unshift(event);
    const payment = paymentId ? (db.paymentRequests || []).find((item) => item.id === paymentId) : null;
    // Webhook 只作为“去链上复核”的唤醒信号，绝不相信 payload.confirmed 直接开通。
    await verifyTrc20Payments(db);
    const activated = Boolean(payment && payment.status === "confirmed");
    if (activated) activateSubscriptionFromPayment(payment);
    appendAudit(db, `收到已验签 TRC20 回调并完成链上复核：${txid || paymentId || "unknown"}`, event.id, "PaymentWebhook", activated ? "info" : "warning");
    saveDb(db);
    res.json({ ok: true, activated });
  });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
