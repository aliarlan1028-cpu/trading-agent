import { requestExecutionExit } from "../../../executionExit.js";

const cancelled = Object.freeze({ ok: false, cancelled: true });
const unavailable = Object.freeze({ ok: false, error: "action_unavailable" });
const invalidInput = Object.freeze({ ok: false, error: "invalid_account_action_input" });
const unavailableAction = async () => unavailable;
const denyConfirmation = async () => false;
const unavailableCall = () => unavailable;

const validOpaqueIdentifier = (value) => typeof value === "string"
  && value.length > 0
  && value.length <= 240
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value);

function normalizeWatchlistSymbol(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || /\p{Cc}/u.test(value)) return null;
  const symbol = value.trim().toUpperCase().replace(/-SWAP$/u, "").replace(/-/gu, "/");
  return /^[A-Z0-9]+\/[A-Z0-9]+$/u.test(symbol) ? symbol : null;
}

const manualExitReason = (surface) => surface === "mobile" || surface === "manual_mobile"
  ? "manual_mobile"
  : "manual_ui";

const posterFilename = (executionId) => `closed-trade-${executionId.replace(/[^a-zA-Z0-9._-]+/g, "-")}.png`;

function ownFunction(record, field) {
  if (!record || (typeof record !== "object" && typeof record !== "function")) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function ownValue(record, field) {
  if (!record || (typeof record !== "object" && typeof record !== "function")) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function invoke(run, fallback, ...args) {
  try { return run(...args); } catch { return fallback(); }
}

export function createAccountActions(deps) {
  const action = ownFunction(deps, "action") || unavailableAction;
  const confirm = ownFunction(deps, "confirm") || denyConfirmation;
  const navigate = ownFunction(deps, "navigate") || unavailableCall;
  const download = ownFunction(deps, "download") || unavailableCall;
  const ai = ownValue(deps, "ai");
  const approvePlan = ownFunction(ai, "approvePlan") || unavailableAction;
  const rejectPlan = ownFunction(ai, "rejectPlan") || unavailableAction;
  const runAction = (...args) => invoke(action, unavailableAction, ...args);

  const reconcile = async () => {
    let confirmed = false;
    try {
      confirmed = await confirm(
        "Run account, order, protection, and ledger reconciliation now? The result is written to audit.",
        { title: "Run reconciliation" }
      );
    } catch {
      return cancelled;
    }
    if (confirmed !== true) return cancelled;
    return runAction("/api/reconciler/run", { mode: "manual_ui" });
  };
  const addWatchlist = (input) => {
    const symbol = normalizeWatchlistSymbol(input);
    return symbol ? runAction("/api/watchlist", { symbol }) : invalidInput;
  };
  const removeWatchlist = (input) => {
    const symbol = normalizeWatchlistSymbol(input);
    return symbol ? runAction(`/api/watchlist/${encodeURIComponent(symbol)}`, {}, "DELETE") : invalidInput;
  };
  const exitExecutionOrder = (order, surface = "desktop") => (
    requestExecutionExit(runAction, order, manualExitReason(surface))
  );
  const openReviews = () => invoke(navigate, unavailableCall, "assets", "reviews");
  const downloadClosedTradePoster = (executionId) => validOpaqueIdentifier(executionId)
    ? invoke(
      download,
      unavailableCall,
      `/api/posters/trades/${encodeURIComponent(executionId)}`,
      posterFilename(executionId)
    )
    : invalidInput;

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
