import React from "react";
import { createRoot } from "react-dom/client";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import {
  KORDYN_V2_ADVERSE_HEALTH_FIXTURE_JSON,
  KORDYN_V2_ADVERSE_SOURCE_CONTRADICTION_FIXTURE_JSON,
  KORDYN_V2_ATTENTION_BOTH_EMPTY_FIXTURE_JSON,
  KORDYN_V2_ATTENTION_PENDING_ONLY_EMPTY_FIXTURE_JSON,
  KORDYN_V2_ATTENTION_PRESENT_PARTIAL_FIXTURE_JSON,
  KORDYN_V2_ATTENTION_RISK_ONLY_EMPTY_FIXTURE_JSON,
  KORDYN_V2_CONSISTENT_NORMAL_FRESH_FIXTURE_JSON,
  KORDYN_V2_EMPTY_MISSION_FIXTURE_JSON,
  KORDYN_V2_EMERGENCY_STALE_CONTRADICTION_FIXTURE_JSON,
  KORDYN_V2_KILL_NORMAL_CONTRADICTION_FIXTURE_JSON,
  KORDYN_V2_LONG_CONTENT_FIXTURE_JSON,
  KORDYN_V2_MISSING_HEALTH_FIXTURE_JSON,
  KORDYN_V2_MOBILE_DEGRADED_FIXTURE_JSON,
  KORDYN_V2_MOBILE_DISABLED_FIXTURE_JSON,
  KORDYN_V2_MOBILE_FAILED_FIXTURE_JSON,
  KORDYN_V2_MOBILE_FORBIDDEN_FIXTURE_JSON,
  KORDYN_V2_MOBILE_STALE_FIXTURE_JSON,
  KORDYN_V2_NOVEL_HEALTH_FIXTURE_JSON,
  KORDYN_V2_NOVEL_FALSE_CONTRADICTION_FIXTURE_JSON,
  KORDYN_V2_NORMAL_NOVEL_CONTRADICTION_FIXTURE_JSON,
  KORDYN_V2_PENDING_FALSE_CONTRADICTION_FIXTURE_JSON,
  KORDYN_V2_PENDING_HEALTH_FIXTURE_JSON,
  KORDYN_V2_PARTIAL_RECENT_FIXTURE_JSON,
  KORDYN_V2_PRODUCTION_FIXTURE_JSON,
  KORDYN_V2_RECONCILIATION_STALE_CONTRADICTION_FIXTURE_JSON,
  KORDYN_V2_REDUCE_NORMAL_CONTRADICTION_FIXTURE_JSON,
  KORDYN_V2_SELECTION_OUTSIDE_SLICE_FIXTURE_JSON,
  KORDYN_V2_STALE_HEALTH_FIXTURE_JSON,
  KORDYN_V2_UNRESOLVED_ATTENTION_FIXTURE_JSON,
  KORDYN_V2_UNKNOWN_FACTS_FIXTURE_JSON,
  KORDYN_V2_UNKNOWN_HEALTH_FIXTURE_JSON,
  KORDYN_V2_UNKNOWN_QUEUE_FIXTURE_JSON
} from "./kordyn-v2-production-fixture.js";

const scenario = new URLSearchParams(window.location.search).get("scenario") || "default";
const fixtureJson = ({
  "facts-unknown": KORDYN_V2_UNKNOWN_FACTS_FIXTURE_JSON,
  "mission-empty": KORDYN_V2_EMPTY_MISSION_FIXTURE_JSON,
  "health-unknown": KORDYN_V2_UNKNOWN_HEALTH_FIXTURE_JSON,
  "health-adverse": KORDYN_V2_ADVERSE_HEALTH_FIXTURE_JSON,
  "health-stale": KORDYN_V2_STALE_HEALTH_FIXTURE_JSON,
  "health-missing": KORDYN_V2_MISSING_HEALTH_FIXTURE_JSON,
  "health-pending": KORDYN_V2_PENDING_HEALTH_FIXTURE_JSON,
  "health-novel": KORDYN_V2_NOVEL_HEALTH_FIXTURE_JSON,
  "health-kill-normal": KORDYN_V2_KILL_NORMAL_CONTRADICTION_FIXTURE_JSON,
  "health-reduce-normal": KORDYN_V2_REDUCE_NORMAL_CONTRADICTION_FIXTURE_JSON,
  "health-adverse-source-conflict": KORDYN_V2_ADVERSE_SOURCE_CONTRADICTION_FIXTURE_JSON,
  "health-reconciliation-stale": KORDYN_V2_RECONCILIATION_STALE_CONTRADICTION_FIXTURE_JSON,
  "health-emergency-stale": KORDYN_V2_EMERGENCY_STALE_CONTRADICTION_FIXTURE_JSON,
  "health-consistent-normal-fresh": KORDYN_V2_CONSISTENT_NORMAL_FRESH_FIXTURE_JSON,
  "health-pending-false": KORDYN_V2_PENDING_FALSE_CONTRADICTION_FIXTURE_JSON,
  "health-novel-false": KORDYN_V2_NOVEL_FALSE_CONTRADICTION_FIXTURE_JSON,
  "health-normal-novel-conflict": KORDYN_V2_NORMAL_NOVEL_CONTRADICTION_FIXTURE_JSON,
  "support-long-content": KORDYN_V2_LONG_CONTENT_FIXTURE_JSON,
  "mobile-stale": KORDYN_V2_MOBILE_STALE_FIXTURE_JSON,
  "mobile-degraded": KORDYN_V2_MOBILE_DEGRADED_FIXTURE_JSON,
  "mobile-forbidden": KORDYN_V2_MOBILE_FORBIDDEN_FIXTURE_JSON,
  "mobile-disabled": KORDYN_V2_MOBILE_DISABLED_FIXTURE_JSON,
  "mobile-failed": KORDYN_V2_MOBILE_FAILED_FIXTURE_JSON,
  "attention-unresolved": KORDYN_V2_UNRESOLVED_ATTENTION_FIXTURE_JSON,
  "queue-unknown": KORDYN_V2_UNKNOWN_QUEUE_FIXTURE_JSON,
  "attention-pending-only-empty": KORDYN_V2_ATTENTION_PENDING_ONLY_EMPTY_FIXTURE_JSON,
  "attention-risk-only-empty": KORDYN_V2_ATTENTION_RISK_ONLY_EMPTY_FIXTURE_JSON,
  "attention-both-empty": KORDYN_V2_ATTENTION_BOTH_EMPTY_FIXTURE_JSON,
  "attention-present-partial": KORDYN_V2_ATTENTION_PRESENT_PARTIAL_FIXTURE_JSON,
  "recent-partial": KORDYN_V2_PARTIAL_RECENT_FIXTURE_JSON,
  "selection-outside-slice": KORDYN_V2_SELECTION_OUTSIDE_SLICE_FIXTURE_JSON
})[scenario] || KORDYN_V2_PRODUCTION_FIXTURE_JSON;
const data = parseJsonResponseText(fixtureJson);
const calls = { actions: 0, sections: [] };
const api = {
  data,
  action: async () => { calls.actions += 1; return { ok: true }; },
  ensureSection: async (section, options = {}) => {
    calls.sections.push({ section, force: options.force === true });
    return data;
  },
  refresh: async () => data,
  notify: () => {},
  toast: "",
  busy: false,
  connectionError: scenario === "health-adverse" ? "fixture transport unavailable" : ""
};

window.__kordynV2BrowserCalls = calls;
window.__kordynV2BrowserScenario = scenario;
createRoot(document.getElementById("root")).render(<KordynV2Root api={api} lang="zh" switchLang={() => {}} />);
window.requestAnimationFrame(() => { window.__kordynV2ShellReady = true; });
