import { workspaceResourceRetainsLastValid } from "../../productShell.jsx";
import { registerAiSupportState } from "./aiSupportProjection.js";

const STATE_MESSAGES = Object.freeze({
  ready: "Current facts are available.",
  not_loaded: "Authoritative facts have not loaded.",
  loading: "Authoritative facts are loading.",
  empty: "No facts are available in the current scope.",
  processing: "The server is processing the request.",
  stale: "Last-valid facts are retained, but must be refreshed before use.",
  degraded: "Last-valid facts are retained while the source is degraded.",
  failed: "Authoritative facts failed to load.",
  forbidden: "The current identity cannot access these facts.",
  disabled: "This action is disabled by the current authoritative state.",
  approval: "This action is waiting for approval.",
  partial: "The server reported a partial outcome.",
  "no-result": "The server has not reported an outcome.",
  "long-content": "The complete authoritative content is available.",
  "large-list": "The complete authoritative list is available."
});

const MISSING_PROVENANCE_MESSAGES = Object.freeze({
  stale: "Data is stale; no last-valid facts with source and time are available.",
  degraded: "The source is degraded; no last-valid facts with source and time are available."
});

const normalizedKind = (resourceState, { error, forbidden } = {}) => {
  const state = typeof resourceState === "string" ? resourceState.trim().toLowerCase() : "not_loaded";
  if (forbidden || state === "forbidden") return "forbidden";
  if (error) return "failed";
  if (["loaded", "ready"].includes(state)) return "ready";
  if (["error", "failed"].includes(state)) return "failed";
  return Object.hasOwn(STATE_MESSAGES, state) ? state : "not_loaded";
};

const PLACEHOLDER = /^(?:unavailable|unknown|none|null|undefined|n\/?a|—|-)$/i;
const provenanceText = (value) => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && !PLACEHOLDER.test(text) ? text : null;
};
const firstProvenance = (...values) => values.map(provenanceText).find(Boolean) || "Unavailable";
const firstTimestamp = (...values) => values
  .map(provenanceText)
  .find((value) => value && Number.isFinite(Date.parse(value))) || "Unavailable";

export function normalizeResourceState(input) {
  const options = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const { resourceState, data, error, forbidden, actionOutcome } = options;
  const kind = normalizedKind(resourceState, { error, forbidden });
  const source = firstProvenance(data?.lastValidSource, data?.source, data?.sourceName);
  const lastValidAt = firstTimestamp(data?.lastValidAt, data?.asOf, data?.updatedAt, data?.createdAt);
  const retainsLastValid = workspaceResourceRetainsLastValid(kind)
    && source !== "Unavailable"
    && lastValidAt !== "Unavailable";
  return registerAiSupportState(Object.freeze({
    kind,
    retainsLastValid,
    message: !retainsLastValid && Object.hasOwn(MISSING_PROVENANCE_MESSAGES, kind)
      ? MISSING_PROVENANCE_MESSAGES[kind]
      : STATE_MESSAGES[kind],
    retryable: ["not_loaded", "loading", "stale", "degraded", "failed"].includes(kind),
    actionOutcome: actionOutcome ?? null,
    source,
    lastValidAt,
    data: data ?? null
  }));
}
