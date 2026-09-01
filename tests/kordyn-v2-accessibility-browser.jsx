import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmHost } from "../src/confirm.jsx";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import { kordynV2AccessibilityFixture } from "./kordyn-v2-long-content-fixture.js";

const query = new URLSearchParams(window.location.search);
const state = query.get("state") || "loaded";
const lang = query.get("lang") === "en" ? "en" : "zh";
const data = parseJsonResponseText(kordynV2AccessibilityFixture(state));
const calls = { actions: [], sections: [] };

window.__kordynV2AccessibilityCalls = calls;
window.__kordynV2AccessibilityFixture = Object.freeze({ state, lang, revision: data.revision });

function BrowserHarness() {
  const api = useMemo(() => ({
    data,
    action: async (endpoint, payload = {}) => {
      calls.actions.push({ endpoint, payload });
      await new Promise((resolve) => window.setTimeout(resolve, 60));
      if (endpoint.endsWith("/approve")) return {
        plan: { id: "plan-plan06-accessibility-approval", status: "approved" },
        approvalGranted: true,
        executionSubmitted: false,
        execution: { status: "risk_recheck_failed", reason: "capacity_changed" },
        message: "Approval consumed; order not submitted."
      };
      if (endpoint.endsWith("/cancel")) return { id: "plan-plan06-accessibility-approval", status: "cancelled" };
      return { ok: false, error: "not_exercised_by_accessibility_gate" };
    },
    ensureSection: async (section, options = {}) => {
      calls.sections.push({ section, force: options.force === true });
      return data;
    },
    notify: () => {},
    connectionError: ""
  }), []);
  return <><KordynV2Root api={api} lang={lang} /><ConfirmHost /></>;
}

createRoot(document.getElementById("root")).render(<BrowserHarness />);
window.__kordynV2AccessibilityReady = true;
