import { canonicalAiContextRow } from "../domains/ai/aiContextFacts.js";

const unavailable = "Unavailable";
const CONTRACTS = Object.freeze({
  Signal: Object.freeze({ workspaceId: "ai", route: "intelligence", sourceSection: "operationsCenter" }),
  Watch: Object.freeze({ workspaceId: "ai", route: "watch", sourceSection: "chat" }),
  Event: Object.freeze({ workspaceId: "ai", route: "eventsTasks:events", sourceSection: "operationsCenter" })
});
const blockedSourceStates = new Set(["stale", "degraded", "forbidden", "error", "failed", "loading", "not_loaded"]);

const primitiveText = (value, limit = 240) => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized.slice(0, limit) : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? `${value}`.slice(0, limit) : null;
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
};
const text = (value, fallback = unavailable) => primitiveText(value) ?? fallback;
const first = (...values) => values.find((value) => primitiveText(value) !== null);

function sourceStateFor(data, sourceSection) {
  try {
    const state = data && typeof data === "object" ? data.resourceState?.[sourceSection] : null;
    return typeof state === "string" ? state : unavailable;
  } catch {
    return "failed";
  }
}

function candidateMatches(candidate, contract) {
  if (!candidate || typeof candidate !== "object") return false;
  try {
    return (!candidate.workspaceId || candidate.workspaceId === contract.workspaceId)
      && (!candidate.route || candidate.route === contract.route)
      && (!candidate.sourceSection || candidate.sourceSection === contract.sourceSection);
  } catch {
    return false;
  }
}

function rowUnavailable(row) {
  const state = text(first(row.sourceState, row.resourceState), "").toLowerCase();
  const permission = text(first(row.permission, row.permissions, row.requiredPermission), "").toLowerCase();
  return row.stale === true
    || row.isStale === true
    || row.sourceStale === true
    || row.degraded === true
    || row.sourceDegraded === true
    || row.forbidden === true
    || row.permissionDenied === true
    || blockedSourceStates.has(state)
    || ["denied", "forbidden", "revoked", "unauthorized"].includes(permission);
}

export function resolveAiContextObject(data = {}, candidate = null) {
  let type;
  let id;
  try {
    type = candidate?.type;
    id = candidate?.id;
  } catch {
    return null;
  }
  const contract = Object.hasOwn(CONTRACTS, type) ? CONTRACTS[type] : null;
  if (!contract || !candidateMatches(candidate, contract)) return null;
  const sourceState = sourceStateFor(data, contract.sourceSection);
  if (blockedSourceStates.has(sourceState.toLowerCase())) return null;
  const row = canonicalAiContextRow(data, type, id);
  if (!row || rowUnavailable(row)) return null;
  const title = first(row.title, row.shortTitle, row.name, row.analysisTitle, row.displayThesis, row.thesis, row.symbol, row.identity);
  const status = first(row.status, row.state, type === "Event" ? row.impactLabel : type === "Signal" ? "available" : undefined);
  const evidence = first(row.evidenceId, row.updatedAt, row.observedAt, row.publishedAt, row.createdAt, row.id);
  const nextAction = type === "Signal"
    ? "加入 AI 上下文"
    : type === "Watch" && text(first(row.status, row.state), "").toLowerCase() === "active"
      ? "撤销观察哨"
      : type === "Event" ? "查看事件影响" : "只读观察";
  return Object.freeze({
    id: row.id,
    type,
    title: text(title),
    status: text(status),
    route: contract.route,
    workspaceId: contract.workspaceId,
    sourceSection: contract.sourceSection,
    sourceState,
    source: text(first(row.provider, row.sourceName, row.source)),
    version: text(first(row.version, row.revision)),
    permission: text(first(row.permission, row.permissions, row.requiredPermission)),
    risk: text(first(row.risk, row.riskLevel, row.severity, row.impactLabel)),
    evidence: text(evidence),
    nextAction,
    raw: row
  });
}
