const cancelled = Object.freeze({ ok: false, cancelled: true });
const invalidInput = Object.freeze({ ok: false, error: "invalid_ai_action_input" });
const unavailableAction = async () => ({ ok: false, error: "action_unavailable" });
const denyConfirmation = async () => false;
const noOp = () => undefined;

const validIdentifier = (value) => typeof value === "string"
  && value.length > 0
  && value === value.trim()
  && !/[\s\u0000-\u001f\u007f]/u.test(value);

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

const validRequiredText = (value, { singleLine = false } = {}) => typeof value === "string"
  && value.trim().length > 0
  && !(singleLine ? /[\u0000-\u001f\u007f]/u : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u).test(value);

function validTags(value) {
  if (!Array.isArray(value) || value.length > 32) return false;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return false; }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !("value" in descriptor)) return false;
    const tag = descriptor.value;
    if (typeof tag !== "string" || tag.length > 80 || tag !== tag.trim() || !tag || /[\u0000-\u001f\u007f]/u.test(tag)) {
      return false;
    }
  }
  return true;
}

function validMemoryPayload(value) {
  if (!plainObject(value)) return false;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return false; }
  const allowed = new Set(["layer", "title", "content", "tags", "source"]);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) return false;
  if (keys.some((key) => !("value" in descriptors[key]))) return false;
  if (!Object.hasOwn(descriptors, "title") || !Object.hasOwn(descriptors, "content")) return false;
  if (!validRequiredText(descriptors.title.value, { singleLine: true })) return false;
  if (!validRequiredText(descriptors.content.value)) return false;
  if (Object.hasOwn(descriptors, "tags") && !validTags(descriptors.tags.value)) return false;
  for (const key of ["layer", "source"]) {
    if (Object.hasOwn(descriptors, key) && (!validIdentifier(descriptors[key].value) || descriptors[key].value.length > 64)) {
      return false;
    }
  }
  return true;
}

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
  const rememberIntelligence = (payload) => validMemoryPayload(payload)
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
