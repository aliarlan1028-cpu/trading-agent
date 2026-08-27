import React, { lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppFrame } from "../src/appFrame.jsx";
import { AuthenticatedV2Boundary } from "../src/kordynV2/AuthenticatedV2Boundary.jsx";
import "../src/entry.css";

const RejectedV2Root = lazy(() => Promise.reject(new Error("simulated V2 entry rejection")));
const calls = { api: 0, retry: 0, legacy: 0 };
window.__kordynV2RecoveryCalls = calls;

function CutoverRecoveryHarness() {
  const [legacy, setLegacy] = useState(false);
  if (legacy) {
    return <main data-authenticated-state="legacy-recovery"><h1>Legacy interface</h1></main>;
  }
  return (
    <AppFrame authenticated>
      <AuthenticatedV2Boundary
        lang="en"
        onRetry={() => { calls.retry += 1; }}
        onUseLegacy={() => { calls.legacy += 1; setLegacy(true); }}
      >
        <Suspense fallback={<div role="status">Loading V2</div>}>
          <RejectedV2Root api={{ action: () => { calls.api += 1; } }} />
        </Suspense>
      </AuthenticatedV2Boundary>
    </AppFrame>
  );
}

createRoot(document.getElementById("root")).render(<CutoverRecoveryHarness />);
window.__kordynV2RecoveryHarnessReady = true;
