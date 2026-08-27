import { workspaceResourceRetainsLastValid } from "../../productShell.jsx";

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

const normalizedKind = (resourceState, { error, forbidden } = {}) => {
  if (forbidden || String(resourceState || "").toLowerCase() === "forbidden") return "forbidden";
  if (error) return "failed";
  const state = String(resourceState || "not_loaded").toLowerCase();
  if (["loaded", "ready"].includes(state)) return "ready";
  if (["error", "failed"].includes(state)) return "failed";
  return Object.hasOwn(STATE_MESSAGES, state) ? state : "not_loaded";
};

const firstKnown = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

export function normalizeResourceState({ resourceState, data, error, forbidden, actionOutcome } = {}) {
  const kind = normalizedKind(resourceState, { error, forbidden });
  const retainsLastValid = workspaceResourceRetainsLastValid(kind);
  const source = firstKnown(data?.lastValidSource, data?.source, data?.sourceName, "Unavailable");
  const lastValidAt = firstKnown(data?.lastValidAt, data?.asOf, data?.updatedAt, data?.createdAt, "Unavailable");
  return Object.freeze({
    kind,
    retainsLastValid,
    message: STATE_MESSAGES[kind],
    retryable: ["not_loaded", "loading", "stale", "degraded", "failed"].includes(kind),
    actionOutcome: actionOutcome ?? null,
    source,
    lastValidAt,
    data: data ?? null
  });
}
