const cancelled = Object.freeze({ ok: false, cancelled: true });
const invalidInput = Object.freeze({ ok: false, error: "invalid_ai_action_input" });
const unavailableAction = async () => ({ ok: false, error: "action_unavailable" });
const denyConfirmation = async () => false;
const noOp = () => undefined;

const validIdentifier = (value) => typeof value === "string"
  && value.length > 0
  && value === value.trim();
const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

export function createAiActions({
  action = unavailableAction,
  confirm = denyConfirmation,
  notify = noOp,
  download = noOp,
  navigate = noOp
} = {}) {
  const runAction = typeof action === "function" ? action : unavailableAction;
  const runConfirm = typeof confirm === "function" ? confirm : denyConfirmation;
  const downloadAction = typeof download === "function" ? download : noOp;
  const navigateAction = typeof navigate === "function" ? navigate : noOp;
  void notify;

  const protect = async (message, options, endpoint, payload) => {
    if (!await runConfirm(message, options)) return cancelled;
    return runAction(endpoint, payload);
  };
  const approvePlan = (planId) => {
    if (!validIdentifier(planId)) return invalidInput;
    return protect(
      "Approve this trade plan after the server revalidates risk and execution authority?",
      { title: "Approve trade plan" },
      `/api/trade-plans/${encodeURIComponent(planId)}/approve`,
      {}
    );
  };

  const rejectPlan = (planId) => {
    if (!validIdentifier(planId)) return invalidInput;
    return protect(
      "Reject and cancel this trade plan?",
      { danger: true, title: "Reject trade plan" },
      `/api/trade-plans/${encodeURIComponent(planId)}/cancel`,
      { reason: "user_rejected" }
    );
  };
  const cancelWatch = (watchId, symbol) => {
    if (!validIdentifier(watchId) || (symbol !== undefined && !validIdentifier(symbol))) return invalidInput;
    return protect(
      `Cancel the ${symbol || watchId} watch? A watch trigger only starts a fresh analysis and never places an order.`,
      { danger: true, title: "Cancel watch" },
      `/api/watch-triggers/${encodeURIComponent(watchId)}/cancel`,
      {}
    );
  };
  const rememberIntelligence = (payload) => plainObject(payload)
    ? runAction("/api/agent/memory", payload)
    : invalidInput;
  const refreshEvents = () => runAction("/api/event-sources/refresh", {});
  const translatePoster = (value) => typeof value === "string" && value.trim()
    ? runAction("/api/posters/translate", { text: value })
    : invalidInput;
  const downloadPoster = (...args) => downloadAction(...args);
  const runNavigate = (...args) => navigateAction(...args);

  return Object.freeze({
    approvePlan,
    rejectPlan,
    cancelWatch,
    rememberIntelligence,
    refreshEvents,
    translatePoster,
    downloadPoster,
    navigate: runNavigate
  });
}
