import { uiConfirm } from "../../../confirm.jsx";
import { requestExecutionExit } from "../../../executionExit.js";

const cancelled = Object.freeze({ ok: false, cancelled: true });
const unavailableAction = async () => ({ ok: false, error: "action_unavailable" });
const noOp = () => undefined;

const manualExitReason = (surface) => surface === "mobile" || surface === "manual_mobile"
  ? "manual_mobile"
  : "manual_ui";

const posterFilename = (executionId) => `closed-trade-${String(executionId).replace(/[^a-zA-Z0-9._-]+/g, "-")}.png`;

export function createAccountActions({
  action = unavailableAction,
  confirm = uiConfirm,
  navigate = noOp,
  download = noOp,
  ai = {}
} = {}) {
  const runAction = typeof action === "function" ? action : unavailableAction;
  const runConfirm = typeof confirm === "function" ? confirm : uiConfirm;
  const runNavigate = typeof navigate === "function" ? navigate : noOp;
  const runDownload = typeof download === "function" ? download : noOp;
  const approvePlan = typeof ai.approvePlan === "function" ? ai.approvePlan : unavailableAction;
  const rejectPlan = typeof ai.rejectPlan === "function" ? ai.rejectPlan : unavailableAction;

  const reconcile = async () => {
    if (!await runConfirm(
      "Run account, order, protection, and ledger reconciliation now? The result is written to audit.",
      { title: "Run reconciliation" }
    )) return cancelled;
    return runAction("/api/reconciler/run", { mode: "manual_ui" });
  };
  const addWatchlist = (symbol) => runAction("/api/watchlist", { symbol });
  const removeWatchlist = (symbol) => runAction(`/api/watchlist/${encodeURIComponent(symbol)}`, {}, "DELETE");
  const exitExecutionOrder = (order, surface = "desktop") => (
    requestExecutionExit(runAction, order, manualExitReason(surface))
  );
  const openReviews = () => runNavigate("assets", "reviews");
  const downloadClosedTradePoster = (executionId) => runDownload(
    `/api/posters/trades/${encodeURIComponent(executionId)}`,
    posterFilename(executionId)
  );

  return Object.freeze({
    addWatchlist,
    removeWatchlist,
    reconcile,
    exitExecutionOrder,
    approvePlan,
    rejectPlan,
    openReviews,
    downloadClosedTradePoster
  });
}
