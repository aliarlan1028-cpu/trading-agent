import { agentChatRequestForSurface } from "../../../chatArchive.js";

const cancelled = Object.freeze({ ok: false, cancelled: true });
const invalidInput = Object.freeze({ ok: false, error: "invalid_ai_action_input" });
const unavailableAction = async () => ({ ok: false, error: "action_unavailable" });
const denyConfirmation = async () => false;
const noOp = () => undefined;

const validIdentifier = (value) => typeof value === "string"
  && value.length > 0
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value);

function arrayClassification(value) {
  try { return Array.isArray(value); } catch { return null; }
}

function plainObject(value) {
  if (!value || typeof value !== "object") return false;
  const array = arrayClassification(value);
  if (array !== false) return false;
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

const boundedResultText = (value, maximum = 240) => typeof value === "string"
  && value.length > 0
  && value.length <= maximum
  && !/[\u0000-\u001f\u007f]/u.test(value)
  ? value
  : undefined;

function approvalResultSnapshot(value) {
  if (!value || typeof value !== "object") return Object.freeze({ ok: false, error: "invalid_approval_response" });
  const snapshot = {};
  if (typeof value.ok === "boolean") snapshot.ok = value.ok;
  for (const key of ["error", "message"]) {
    const text = boundedResultText(value[key]);
    if (text !== undefined) snapshot[key] = text;
  }
  if (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) snapshot.httpStatus = value.httpStatus;
  for (const key of ["approvalGranted", "executionSubmitted"]) {
    if (typeof value[key] === "boolean") snapshot[key] = value[key];
  }
  for (const [key, fields] of [
    ["plan", ["id", "status"]],
    ["execution", ["status", "reason"]],
    ["guard", ["label", "fix"]]
  ]) {
    const source = value[key];
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    const projected = {};
    for (const field of fields) {
      const text = boundedResultText(source[field]);
      if (text !== undefined) projected[field] = text;
    }
    if (Object.keys(projected).length) snapshot[key] = Object.freeze(projected);
  }
  return Object.freeze(snapshot);
}

function tagsSnapshot(value) {
  if (arrayClassification(value) !== true) return null;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
  const lengthDescriptor = Object.hasOwn(descriptors, "length") ? descriptors.length : null;
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
  if (!Number.isInteger(length) || length < 0 || length > 32) return null;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length))) {
    return null;
  }
  const snapshot = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    const tag = descriptor.value;
    if (typeof tag !== "string" || tag.length > 80 || tag !== tag.trim() || !tag || /[\u0000-\u001f\u007f]/u.test(tag)) {
      return null;
    }
    snapshot[index] = tag;
  }
  return Object.freeze(snapshot);
}

function memoryPayloadSnapshot(value) {
  if (!plainObject(value)) return null;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
  const allowed = new Set(["layer", "title", "content", "tags", "source"]);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) return null;
  if (keys.some((key) => !("value" in descriptors[key]) || !descriptors[key].enumerable)) return null;
  if (!Object.hasOwn(descriptors, "title") || !Object.hasOwn(descriptors, "content")) return null;
  if (!validRequiredText(descriptors.title.value, { singleLine: true })) return null;
  if (!validRequiredText(descriptors.content.value)) return null;
  const tags = Object.hasOwn(descriptors, "tags") ? tagsSnapshot(descriptors.tags.value) : null;
  if (Object.hasOwn(descriptors, "tags") && tags === null) return null;
  for (const key of ["layer", "source"]) {
    if (Object.hasOwn(descriptors, key) && (!validIdentifier(descriptors[key].value) || descriptors[key].value.length > 64)) {
      return null;
    }
  }
  const snapshot = {};
  for (const key of ["layer", "title", "content", "tags", "source"]) {
    if (!Object.hasOwn(descriptors, key)) continue;
    snapshot[key] = key === "tags" ? tags : descriptors[key].value;
  }
  return Object.freeze(snapshot);
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
  const approvePlan = async (planId) => {
    if (!validIdentifier(planId)) return invalidInput;
    const result = await protect(
      "Approve this trade plan after the server revalidates risk and execution authority?",
      { title: "Approve trade plan" },
      `/api/trade-plans/${encodeURIComponent(planId)}/approve`,
      {}
    );
    return result === cancelled ? result : approvalResultSnapshot(result);
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
  const rememberIntelligence = (payload) => {
    const snapshot = memoryPayloadSnapshot(payload);
    return snapshot ? runAction("/api/agent/memory", snapshot) : invalidInput;
  };
  const refreshEvents = () => runAction("/api/event-sources/refresh", {});
  const readChatSession = (sessionId = "") => {
    if (sessionId !== "" && !validIdentifier(sessionId)) return invalidInput;
    return runAction(agentChatRequestForSurface("dialog", sessionId), {}, "GET");
  };
  const sendChatMessage = (message, sessionId = "") => {
    if (!validRequiredText(message) || (sessionId !== "" && !validIdentifier(sessionId))) return invalidInput;
    return runAction("/api/agent/chat", { message: message.trim(), sessionId });
  };
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
    readChatSession,
    sendChatMessage,
    translatePoster,
    downloadPoster,
    navigate: runNavigate
  });
}
