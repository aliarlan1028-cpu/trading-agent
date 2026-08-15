import { uiConfirm } from "./confirm.jsx";
import { t } from "./i18n.js";

export function executionExitAction(order = {}) {
  const status = String(order.status || "").toLowerCase();
  if (["entry_unknown_pending", "entry_pending"].includes(status)) return { intent: "cancel_entry", expectedStatus: status, confirm: false, label: t("撤销入场委托", "Cancel entry order") };
  if (status === "entry_partial") return { intent: "cancel_remainder_and_close_filled", expectedStatus: status, confirm: true, label: t("撤余量并平已成交", "Cancel remainder & close filled") };
  if (["entry_filled", "protecting", "protecting_degraded"].includes(status)) return { intent: "close_position", expectedStatus: status, confirm: true, label: t("市价平仓", "Close at market") };
  return null;
}

function executionIdentity(order = {}) {
  const direction = /short|sell|空/i.test(String(order.direction || order.side || "")) ? t("空", "Short") : t("多", "Long");
  const quantity = order.filledQuantity ?? order.quantity ?? order.size ?? "—";
  return `${order.symbol || "—"} · ${direction} · ${quantity}`;
}

export async function requestExecutionExit(action, order = {}, reason = "manual_ui") {
  const spec = executionExitAction(order);
  if (!spec) return { ok: false, error: "execution_not_actionable" };
  if (spec.confirm) {
    const prompt = spec.intent === "cancel_remainder_and_close_filled"
      ? t(`确认撤销 ${executionIdentity(order)} 的未成交余量，并在撤单由交易所确认后平掉最终已成交数量？撤单期间可能继续成交，系统会以交易所最终累计成交为准。`, `Cancel the unfilled remainder for ${executionIdentity(order)} and close the final filled quantity only after the exchange confirms cancellation? More fills may occur while cancellation is pending; the exchange's final cumulative fill is authoritative.`)
      : t(`确认对 ${executionIdentity(order)} 提交市价平仓？请求被交易所接收后仍需等待账户快照与真实成交明细核算。`, `Submit a market close for ${executionIdentity(order)}? Exchange acceptance is not final; the result remains pending until account snapshots and real fills reconcile.`);
    if (!await uiConfirm(prompt)) return { ok: false, cancelled: true };
  }
  const result = await action(`/api/execution-orders/${order.id}/close`, {
    reason,
    intent: spec.intent,
    expectedStatus: spec.expectedStatus
  });
  if (result?.ok === false && result.httpStatus === 409) {
    await action("/api/execution-orders/poll", {});
    return { ...result, stateChanged: true };
  }
  return result;
}
