import React from "react";
import { createRoot } from "react-dom/client";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import { KORDYN_V2_PRODUCTION_FIXTURE_JSON } from "./kordyn-v2-production-fixture.js";

const data = parseJsonResponseText(KORDYN_V2_PRODUCTION_FIXTURE_JSON);
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
  connectionError: ""
};

window.__kordynV2BrowserCalls = calls;
createRoot(document.getElementById("root")).render(<KordynV2Root api={api} lang="zh" switchLang={() => {}} />);
window.requestAnimationFrame(() => { window.__kordynV2ShellReady = true; });
