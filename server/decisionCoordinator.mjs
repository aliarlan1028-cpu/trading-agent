const STATES = Object.freeze(["triggered", "base_facts_ready", "deep_analysis", "proposal", "completed", "failed"]);

export function createDecisionContext(input = {}) {
  const trigger = input.trigger || "manual";
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    mode: "deterministic_coordinator",
    trigger,
    source: input.source || "agent_chat",
    symbols: [...new Set(input.symbols || [])],
    state: "triggered",
    stages: [{ state: "triggered", at: createdAt, detail: input.detail || trigger }],
    guardrails: {
      decidesDirection: false,
      changesRisk: false,
      bypassesExecutionGates: false,
      roleSuitabilityShadowOnly: true
    },
    createdAt
  };
}

export function advanceDecisionContext(context, state, detail = "") {
  if (!context || !STATES.includes(state)) return context;
  const currentIndex = STATES.indexOf(context.state), nextIndex = STATES.indexOf(state);
  if (state !== "failed" && nextIndex < currentIndex) return context;
  const previous = context.stages?.at(-1);
  if (previous?.state === state && previous?.detail === detail) return context;
  context.state = state;
  context.stages ||= [];
  context.stages.push({ state, at: new Date().toISOString(), detail: String(detail || "").slice(0, 240) });
  return context;
}

export function decisionContextForPrompt(context) {
  if (!context) return null;
  return `触发=${context.trigger}；当前阶段=${context.state}；协调器只保证阶段、证据覆盖和审计，不决定多空、不改变风险、不绕过执行闸。`;
}

export function triggerFromPayload(payload = {}) {
  if (["scheduled_patrol", "early_opportunity", "fast_move", "watch_trigger", "news", "manual"].includes(payload.decisionTrigger)) return payload.decisionTrigger;
  return payload.sessionId === "chat_autocycle" ? "scheduled_patrol" : "manual";
}
