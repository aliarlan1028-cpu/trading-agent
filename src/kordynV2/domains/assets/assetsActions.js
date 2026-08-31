const cancelled = Object.freeze({ ok: false, cancelled: true });
const unavailable = Object.freeze({ ok: false, error: "action_unavailable" });
const invalidInput = Object.freeze({ ok: false, error: "invalid_assets_action_input" });
const missingOwnerAttestation = Object.freeze({ ok: false, error: "owner_validation_attestation_required" });
const missingOwnerEvidence = Object.freeze({ ok: false, error: "owner_validation_evidence_required" });
const unavailableAction = async () => unavailable;
const denyConfirmation = async () => false;

const LESSON_ACTIONS = new Set(["approve", "observe", "reject", "retire", "reactivate"]);
const IMPROVEMENT_ACTIONS = new Set([
  "accept", "reject", "more_evidence", "start_validation", "verify", "ineffective", "retry_validation", "record_stage"
]);

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

function validIdentifier(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && value === value.trim()
    && !/[\p{White_Space}\p{Cc}]/u.test(value);
}

function validText(value, maxLength = 10_000) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !/\p{Cc}/u.test(value);
}

function validSymbol(value) {
  return typeof value === "string"
    && value.length <= 80
    && /^[A-Za-z0-9]+(?:[/-][A-Za-z0-9]+)+(?:-SWAP)?$/u.test(value);
}

function safeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Object.hasOwn(descriptor, "value")) result[key] = descriptor.value;
    }
    return result;
  } catch {
    return {};
  }
}

function display(value, fallback) {
  return validText(value, 500) ? value.trim() : fallback;
}

function invoke(run, fallback, ...args) {
  try { return run(...args); } catch { return fallback(); }
}

export function createAssetsActions(deps) {
  const action = ownFunction(deps, "action") || unavailableAction;
  const confirm = ownFunction(deps, "confirm") || denyConfirmation;
  const runAction = (...args) => invoke(action, unavailableAction, ...args);

  const protect = async (message, options, endpoint, payload) => {
    let confirmed = false;
    try { confirmed = await confirm(message, options); } catch { return cancelled; }
    if (confirmed !== true) return cancelled;
    return runAction(endpoint, payload);
  };
  const withId = (id, run) => validIdentifier(id) ? run(encodeURIComponent(id)) : invalidInput;

  const parseSource = (id) => withId(id, (encoded) => runAction(`/api/knowledge/sources/${encoded}/parse-real`, {}));
  const convertSource = (id, name = null) => withId(id, () => protect(
    `Generate supported candidates from knowledge source “${display(name, id)}” (${id})? Candidates remain unpublished until validation and Owner-governed graduation.`,
    { title: "Generate knowledge candidates" },
    "/api/knowledge/convert",
    { sourceId: id }
  ));
  const ignoreCandidate = (id) => withId(id, (encoded) => runAction(`/api/knowledge/candidates/${encoded}/ignore`, {}));
  const adoptCandidate = (id) => withId(id, (encoded) => runAction(`/api/knowledge/candidates/${encoded}/adopt`, {}));
  const approveCandidate = (id, version = null) => withId(id, (encoded) => protect(
    `Approve the current content of candidate ${id} (${display(version, "current version")})? Approval does not bypass registry or runtime validation.`,
    { title: "Approve candidate version" },
    `/api/knowledge/candidates/${encoded}/approve-prompt`,
    {}
  ));
  const compileMethod = (id) => withId(id, (encoded) => runAction(`/api/knowledge/methods/${encoded}/compile`, {}));
  const validateSkill = (id) => withId(id, (encoded) => runAction(`/api/knowledge/skills/${encoded}/validate`, {}));
  const startSkillPaper = (id) => withId(id, (encoded) => runAction(`/api/knowledge/skills/${encoded}/paper`, {}));
  const syncSkills = () => runAction("/api/knowledge/skills/sync", {});
  const approveSkill = (id, version = null) => withId(id, (encoded) => protect(
    `Approve skill ${id} at fingerprint ${display(version, "current fingerprint")} for limited live probation? Existing permission and risk checks remain authoritative.`,
    { title: "Approve skill fingerprint" },
    `/api/knowledge/skills/${encoded}/approve`,
    {}
  ));

  const createStrategyDraft = (prompt) => validText(prompt)
    ? runAction("/api/strategy/studio/drafts", { prompt: prompt.trim() })
    : invalidInput;
  const testStrategyDraft = (id) => withId(id, (encoded) => runAction(`/api/strategy/studio/drafts/${encoded}/tests`, {}));
  const backtestStrategyDraft = (id, symbol) => validSymbol(symbol)
    ? withId(id, (encoded) => runAction(`/api/strategy/studio/drafts/${encoded}/backtest`, { symbol }))
    : invalidInput;
  const publishStrategyDraft = (id, version = null) => withId(id, (encoded) => protect(
    `Publish strategy draft ${id} (${display(version, "current version")}) to the internal registry only after generated tests and every-symbol OOS evidence pass?`,
    { title: "Publish validated strategy" },
    `/api/strategy/studio/drafts/${encoded}/publish`,
    {}
  ));
  const setStrategyEnabled = (id, enabled) => withId(id, (encoded) => protect(
    `${enabled ? "Add" : "Remove"} strategy version ${id} ${enabled ? "to" : "from"} the AI eligible set? Live permission, mandate, and risk checks remain authoritative.`,
    { title: enabled ? "Enable strategy version" : "Disable strategy version" },
    `/api/strategy/market/${encoded}/${enabled ? "enable" : "disable"}`,
    {}
  ));
  const enableStrategy = (id) => setStrategyEnabled(id, true);
  const disableStrategy = (id) => setStrategyEnabled(id, false);

  const setCapabilityEnabled = (id, enabled) => withId(id, (encoded) => protect(
    `${enabled ? "Enable" : "Disable"} capability ${id}? Current grants, permissions, and runtime health remain authoritative.`,
    { title: enabled ? "Enable capability" : "Disable capability" },
    `/api/skills/${encoded}/${enabled ? "enable" : "disable"}`,
    {}
  ));
  const enableCapability = (id) => setCapabilityEnabled(id, true);
  const disableCapability = (id) => setCapabilityEnabled(id, false);

  const decideLesson = (id, command, options = {}) => {
    if (!LESSON_ACTIONS.has(command)) return invalidInput;
    return withId(id, (encoded) => runAction(
      `/api/review/lessons/${encoded}/action`,
      { ...safeObject(options), action: command }
    ));
  };
  const decideImprovement = (id, command, options = {}) => {
    if (!IMPROVEMENT_ACTIONS.has(command)) return invalidInput;
    const payload = safeObject(options);
    if (command === "verify") {
      const evidence = Array.isArray(payload.validationEvidence) ? payload.validationEvidence : [];
      if (payload.ownerAttested !== true) return missingOwnerAttestation;
      if (payload.destination !== "strategy" && evidence.length === 0) return missingOwnerEvidence;
    }
    return withId(id, (encoded) => protect(
      `Apply Owner decision “${command}” to improvement ${id} (${display(payload.version, "current version")})? This records a governed transition and never directly rewrites live strategy, capability, or risk configuration.`,
      { danger: ["reject", "ineffective"].includes(command), title: "Confirm Owner decision" },
      `/api/review/improvements/${encoded}/action`,
      { ...payload, action: command }
    ));
  };
  const startPureForwardSession = (id, symbol) => validSymbol(symbol)
    ? withId(id, (encoded) => runAction(`/api/review/improvements/${encoded}/paper/start`, { symbol }))
    : invalidInput;

  return Object.freeze({
    parseSource,
    convertSource,
    ignoreCandidate,
    adoptCandidate,
    approveCandidate,
    compileMethod,
    validateSkill,
    startSkillPaper,
    syncSkills,
    approveSkill,
    createStrategyDraft,
    testStrategyDraft,
    backtestStrategyDraft,
    publishStrategyDraft,
    enableStrategy,
    disableStrategy,
    enableCapability,
    disableCapability,
    decideLesson,
    decideImprovement,
    startPureForwardSession
  });
}
