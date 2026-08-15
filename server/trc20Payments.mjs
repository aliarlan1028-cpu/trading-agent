import { isLeaseLostError } from "./leaseSafety.mjs";

export const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_SCALE = 1_000_000;

function microsFromAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * USDT_SCALE);
}

export function allocateUniquePaymentAmount(db, baseAmount) {
  const baseMicros = microsFromAmount(baseAmount);
  if (!baseMicros) throw Object.assign(new Error("Payment amount must be positive"), { status: 400 });
  const active = new Set((db.paymentRequests || [])
    .filter((item) => item.status === "pending")
    .map((item) => microsFromAmount(item.amount))
    .filter(Number.isFinite));
  for (let suffix = 1; suffix <= 999_999; suffix++) {
    const candidate = baseMicros + suffix;
    if (!active.has(candidate)) return Number((candidate / USDT_SCALE).toFixed(6));
  }
  throw Object.assign(new Error("No unique payment amount is available; expire old payment requests first"), { status: 409 });
}

function validTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeTransfer(row, { address, contract }) {
  const txid = String(row?.transaction_id || "").trim();
  const at = validTimestamp(row?.block_timestamp);
  const tokenAddress = String(row?.token_info?.address || row?.contract_address || "");
  const to = String(row?.to || "");
  const valueMicros = Number(row?.value);
  // only_confirmed=true is the API's authoritative finality filter. A defensive
  // explicit false flag or failed result still invalidates the row.
  const explicitlyUnconfirmed = row?.confirmed === false || row?.confirmed === "false";
  const failed = [row?.result, row?.contractRet, row?.status].some((value) =>
    value != null && !["SUCCESS", "SUCESS", "CONFIRMED", "TRUE", "1"].includes(String(value).toUpperCase()));
  if (!txid || !at || explicitlyUnconfirmed || failed) return null;
  if (tokenAddress !== contract || to !== address) return null;
  if (!Number.isSafeInteger(valueMicros) || valueMicros <= 0) return null;
  return {
    txid,
    valueMicros,
    value: valueMicros / USDT_SCALE,
    from: String(row?.from || "") || null,
    to,
    contract,
    at,
    finality: "trongrid_only_confirmed"
  };
}

export async function fetchConfirmedTrc20Transfers({
  address,
  minTimestamp,
  maxTimestamp = Date.now(),
  apiKey = null,
  fetchImpl = globalThis.fetch,
  signal,
  assertLease,
  maxPages = 20
}) {
  const base = new URL(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`);
  base.searchParams.set("only_to", "true");
  base.searchParams.set("only_confirmed", "true");
  base.searchParams.set("limit", "200");
  base.searchParams.set("order_by", "block_timestamp,desc");
  base.searchParams.set("contract_address", USDT_TRC20_CONTRACT);
  base.searchParams.set("min_timestamp", String(Math.max(0, Math.trunc(minTimestamp || 0))));
  base.searchParams.set("max_timestamp", String(Math.trunc(maxTimestamp)));

  const rows = new Map();
  const cursors = new Set();
  let fingerprint = null;
  for (let page = 0; page < maxPages; page++) {
    assertLease?.();
    const url = new URL(base);
    if (fingerprint) url.searchParams.set("fingerprint", fingerprint);
    const response = await fetchImpl(url, {
      headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {},
      signal
    });
    if (!response.ok) return { complete: false, rows: [], error: `TronGrid HTTP ${response.status}`, pages: page + 1 };
    const json = await response.json();
    if (json?.success === false || !Array.isArray(json?.data)) {
      return { complete: false, rows: [], error: "trongrid_invalid_response", pages: page + 1 };
    }
    for (const raw of json.data) {
      const transfer = normalizeTransfer(raw, { address, contract: USDT_TRC20_CONTRACT });
      if (transfer) rows.set(transfer.txid, transfer);
    }
    const next = String(json?.meta?.fingerprint || "").trim();
    if (!next) return { complete: true, rows: [...rows.values()], pages: page + 1 };
    if (next === fingerprint || cursors.has(next)) {
      return { complete: false, rows: [], error: "trongrid_pagination_cursor_repeated", pages: page + 1 };
    }
    cursors.add(next);
    fingerprint = next;
  }
  return { complete: false, rows: [], error: "trongrid_pagination_budget_exhausted", pages: maxPages };
}

function paymentWindow(payment) {
  const createdAt = new Date(payment?.createdAt).getTime();
  const expiresAt = new Date(payment?.expiresAt).getTime();
  return Number.isFinite(createdAt) && Number.isFinite(expiresAt) && expiresAt > createdAt
    ? { createdAt, expiresAt }
    : null;
}

export async function verifyTrc20PaymentIntents(db, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const nowIso = options.nowIso || (() => new Date(nowMs).toISOString());
  let expired = 0;
  for (const payment of db.paymentRequests || []) {
    if (payment.status !== "pending" || !payment.expiresAt || new Date(payment.expiresAt).getTime() > nowMs) continue;
    payment.status = "expired";
    payment.expiredAt = nowIso();
    options.onExpired?.(payment);
    expired++;
  }
  if (expired) options.saveDb?.(db);

  const pending = (db.paymentRequests || []).filter((item) => item.status === "pending");
  const address = options.address;
  if (!address) return { status: "skipped", reason: "no_receive_address", expired };
  if (!pending.length) return { status: "ok", checked: 0, confirmed: 0, expired };

  const windows = pending.map(paymentWindow).filter(Boolean);
  if (!windows.length) return { status: "failed", error: "payment_windows_invalid", checked: 0, confirmed: 0, expired };
  try {
    const fetched = await fetchConfirmedTrc20Transfers({
      address,
      minTimestamp: Math.min(...windows.map((item) => item.createdAt)),
      maxTimestamp: nowMs,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
      assertLease: options.assertLease,
      maxPages: options.maxPages
    });
    if (!fetched.complete) return { status: "failed", error: fetched.error, checked: 0, confirmed: 0, expired, pages: fetched.pages };

    const usedTx = new Set((db.paymentRequests || []).map((item) => item.txid).filter(Boolean));
    const candidatesByPayment = new Map();
    let ambiguous = 0;
    for (const tx of fetched.rows) {
      if (usedTx.has(tx.txid)) continue;
      const candidates = pending.filter((payment) => {
        if (payment.exactAmount !== true) return false;
        const window = paymentWindow(payment);
        return window && tx.at >= window.createdAt && tx.at <= window.expiresAt && microsFromAmount(payment.amount) === tx.valueMicros;
      });
      if (candidates.length !== 1) {
        if (candidates.length > 1) ambiguous++;
        continue;
      }
      const list = candidatesByPayment.get(candidates[0].id) || [];
      list.push(tx);
      candidatesByPayment.set(candidates[0].id, list);
    }

    let confirmed = 0;
    for (const payment of pending) {
      options.assertLease?.();
      const matches = candidatesByPayment.get(payment.id) || [];
      if (matches.length !== 1) {
        if (matches.length > 1) ambiguous++;
        continue;
      }
      const match = matches[0];
      const evidence = {
        txid: match.txid, from: match.from, to: match.to, contract: match.contract,
        amount: match.value, blockTimestamp: match.at, finality: match.finality
      };
      const claim = options.claimTransaction
        ? options.claimTransaction({ txid: match.txid, paymentId: payment.id, tenantId: payment.tenantId || null, evidence })
        : { claimed: !usedTx.has(match.txid) };
      if (!claim?.claimed || (claim.paymentId && claim.paymentId !== payment.id)) continue;
      options.assertLease?.();
      payment.status = "confirmed";
      payment.txid = match.txid;
      payment.confirmedAt = nowIso();
      payment.verifiedOnChain = true;
      payment.chainEvidence = evidence;
      usedTx.add(match.txid);
      await options.onConfirmed?.(payment, evidence);
      confirmed++;
    }
    if (confirmed) options.saveDb?.(db);
    return { status: ambiguous ? "partial" : "ok", checked: fetched.rows.length, confirmed, ambiguous, expired, pages: fetched.pages };
  } catch (error) {
    if (isLeaseLostError(error)) throw error;
    return { status: "failed", error: String(error?.message || error), checked: 0, confirmed: 0, expired };
  }
}
