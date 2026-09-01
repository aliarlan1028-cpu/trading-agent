import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import {
  KORDYN_V2_ADVERSE_HEALTH_FIXTURE_JSON,
  KORDYN_V2_AI_CONTEXT_DEGRADED_FIXTURE_JSON,
  KORDYN_V2_AI_CONTEXT_FORBIDDEN_FIXTURE_JSON,
  KORDYN_V2_AI_CONTEXT_STALE_FIXTURE_JSON,
  KORDYN_V2_ADVERSE_SOURCE_CONTRADICTION_FIXTURE_JSON,
  KORDYN_V2_ATTENTION_BOTH_EMPTY_FIXTURE_JSON,
  KORDYN_V2_ATTENTION_PENDING_ONLY_EMPTY_FIXTURE_JSON,
  KORDYN_V2_ATTENTION_PRESENT_PARTIAL_FIXTURE_JSON,
  KORDYN_V2_ATTENTION_RISK_ONLY_EMPTY_FIXTURE_JSON,
  KORDYN_V2_CONSISTENT_NORMAL_FRESH_FIXTURE_JSON,
  KORDYN_V2_EMPTY_MISSION_FIXTURE_JSON,
  KORDYN_V2_EVIDENCE_REFRESH_INITIAL_FIXTURE_JSON,
  KORDYN_V2_EVIDENCE_REFRESH_NEXT_FIXTURE_JSON,
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
  KORDYN_V2_POSITION_MIRRORS_FIXTURE_JSON,
  KORDYN_V2_POSITION_MIRRORS_RAW_COUNT,
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
  "ai-context-stale": KORDYN_V2_AI_CONTEXT_STALE_FIXTURE_JSON,
  "ai-context-degraded": KORDYN_V2_AI_CONTEXT_DEGRADED_FIXTURE_JSON,
  "ai-context-forbidden": KORDYN_V2_AI_CONTEXT_FORBIDDEN_FIXTURE_JSON,
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
  "position-mirrors": KORDYN_V2_POSITION_MIRRORS_FIXTURE_JSON,
  "evidence-refresh": KORDYN_V2_EVIDENCE_REFRESH_INITIAL_FIXTURE_JSON,
  "evidence-refresh-null": KORDYN_V2_EMPTY_MISSION_FIXTURE_JSON,
  "selection-outside-slice": KORDYN_V2_SELECTION_OUTSIDE_SLICE_FIXTURE_JSON
})[scenario] || KORDYN_V2_PRODUCTION_FIXTURE_JSON;
const data = parseJsonResponseText(fixtureJson);
const refreshedData = ["evidence-refresh", "evidence-refresh-null"].includes(scenario)
  ? parseJsonResponseText(KORDYN_V2_EVIDENCE_REFRESH_NEXT_FIXTURE_JSON)
  : null;
const calls = { actions: 0, reads: 0, actionRequests: [], sections: [] };

window.__kordynV2BrowserCalls = calls;
window.__kordynV2BrowserScenario = scenario;
window.__kordynV2RawPositionMirrorCount = KORDYN_V2_POSITION_MIRRORS_RAW_COUNT;
window.confirm = () => true;

function BrowserHarness() {
  const [browserData, setBrowserData] = useState(data);
  const api = useMemo(() => ({
    data: browserData,
    action: async (endpoint, payload, method = "POST") => {
      if (method === "GET") calls.reads += 1;
      else calls.actions += 1;
      calls.actionRequests.push({ endpoint, payload, method });
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (endpoint === "/api/agent/memory") return { id: "memory-browser-1", stored: true };
      if (endpoint === "/api/event-sources/refresh") return { status: "partial", attempted: 3, succeeded: 2, failed: 1, ingested: 4, reason: "one_source_failed" };
      const watchMatch = endpoint.match(/^\/api\/watch-triggers\/([^/]+)\/cancel$/u);
      if (watchMatch) return { message: "watch cancelled", watch: { id: decodeURIComponent(watchMatch[1]), status: "cancelled" } };
      return { ok: true };
    },
    ensureSection: async (section, options = {}) => {
      calls.sections.push({ section, force: options.force === true });
      return browserData;
    },
    refresh: async () => browserData,
    notify: () => {},
    toast: "",
    busy: false,
    connectionError: scenario === "health-adverse" ? "fixture transport unavailable" : ""
  }), [browserData]);

  useEffect(() => {
    window.__kordynV2ApplyLiveRefresh = refreshedData
      ? () => setBrowserData(refreshedData)
      : null;
    return () => { window.__kordynV2ApplyLiveRefresh = null; };
  }, []);

  return <KordynV2Root api={api} lang="zh" switchLang={() => {}} />;
}

createRoot(document.getElementById("root")).render(<BrowserHarness />);
window.requestAnimationFrame(() => { window.__kordynV2ShellReady = true; });
