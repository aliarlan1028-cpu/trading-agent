import React from "react";
import { createRoot } from "react-dom/client";
import { AppFrame, ReleaseUpdateNoticeContent } from "../src/appFrame.jsx";
import { uiConfirm } from "../src/confirm.jsx";
import "../src/styles.css";
import "../src/product-foundation.css";

function AuthenticatedOverlayBrowserHarness() {
  const authenticated = new URLSearchParams(window.location.search).get("scope") !== "public";
  return (
    <AppFrame authenticated={authenticated}>
      <main className="overlayBrowserHarness">
        <button type="button" data-browser-action="confirm" onClick={() => uiConfirm("Font inheritance probe", { title: "Authenticated confirmation" })}>Confirm</button>
        <ReleaseUpdateNoticeContent onRefresh={() => {}} />
      </main>
    </AppFrame>
  );
}

createRoot(document.getElementById("root")).render(<AuthenticatedOverlayBrowserHarness />);
window.__authenticatedOverlayReady = true;
