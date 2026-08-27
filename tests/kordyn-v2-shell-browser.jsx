import React from "react";
import { createRoot } from "react-dom/client";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import {
  KORDYN_V2_ADVERSE_HEALTH_FIXTURE_JSON,
  KORDYN_V2_EMPTY_MISSION_FIXTURE_JSON,
  KORDYN_V2_PRODUCTION_FIXTURE_JSON,
  KORDYN_V2_UNRESOLVED_ATTENTION_FIXTURE_JSON,
  KORDYN_V2_UNKNOWN_FACTS_FIXTURE_JSON,
  KORDYN_V2_UNKNOWN_HEALTH_FIXTURE_JSON
} from "./kordyn-v2-production-fixture.js";

const scenario = new URLSearchParams(window.location.search).get("scenario") || "default";
const fixtureJson = ({
  "facts-unknown": KORDYN_V2_UNKNOWN_FACTS_FIXTURE_JSON,
  "mission-empty": KORDYN_V2_EMPTY_MISSION_FIXTURE_JSON,
  "health-unknown": KORDYN_V2_UNKNOWN_HEALTH_FIXTURE_JSON,
  "health-adverse": KORDYN_V2_ADVERSE_HEALTH_FIXTURE_JSON,
  "attention-unresolved": KORDYN_V2_UNRESOLVED_ATTENTION_FIXTURE_JSON
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
