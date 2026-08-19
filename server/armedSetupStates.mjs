export const TERMINAL_ARMED_SETUP_STATES = new Set([
  "completed", "cancelled", "canceled", "expired", "invalidated", "superseded",
  "dry_run", "risk_rejected", "blocked", "execution_failed", "failed", "rejected"
]);

export function isTerminalArmedSetup(rowOrStatus) {
  const status = typeof rowOrStatus === "object" ? rowOrStatus?.status : rowOrStatus;
  return TERMINAL_ARMED_SETUP_STATES.has(String(status || "").toLowerCase());
}
