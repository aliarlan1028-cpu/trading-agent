export const OPEN_EXECUTION_STATUS_LIST = Object.freeze([
  "created",
  "submitted",
  "entry_unknown_pending",
  "entry_pending",
  "entry_partial",
  "cancel_pending",
  "cancel_unknown_pending",
  "protection_failure_cancel_pending",
  "entry_filled",
  "protecting",
  "protecting_degraded",
  "close_pending",
  "close_unknown_pending",
  "close_reconciliation_pending",
  "group_close_pending",
  "recovery_pending_reconciliation",
  "emergency_close_pending",
]);

export const OPEN_EXECUTION_STATES = new Set(OPEN_EXECUTION_STATUS_LIST);

// This is deliberately a terminal allow-list. Unknown/new states are treated as
// non-terminal so a deployment can never hide an unresolved execution merely
// because a producer introduced a state the overview did not yet know about.
export const TERMINAL_EXECUTION_STATUS_LIST = Object.freeze([
  "dry_run",
  "account_configuration_conflict",
  "market_facts_rejected",
  "slippage_rejected",
  "instrument_spec_unavailable",
  "submitted_size_below_exchange_minimum",
  "blocked",
  "failed",
  "closed",
  "group_closed",
  "protection_failed",
  "cancelled",
  "canceled",
  "rejected",
  "expired",
  "recovered_compensated",
  "recovered_canceled",
  "recovered_cancelled",
  "recovered_rejected"
]);

export const TERMINAL_EXECUTION_STATES = new Set(TERMINAL_EXECUTION_STATUS_LIST);

export function isTerminalExecution(rowOrStatus) {
  const status = typeof rowOrStatus === "object" ? rowOrStatus?.status : rowOrStatus;
  return TERMINAL_EXECUTION_STATES.has(String(status || "").toLowerCase());
}

export function isNonTerminalExecution(rowOrStatus) {
  return !isTerminalExecution(rowOrStatus);
}

export const IN_FLIGHT_ENTRY_STATES = new Set([
  "created", "submitted", "entry_unknown_pending", "entry_pending", "entry_partial",
  "cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"
]);

export const SAME_SYMBOL_EXPOSURE_STATES = new Set([
  ...IN_FLIGHT_ENTRY_STATES, "entry_filled", "protecting", "protecting_degraded",
  "close_pending", "close_unknown_pending", "close_reconciliation_pending", "group_close_pending"
]);

export const EXIT_PENDING_STATES = new Set([
  "cancel_pending",
  "cancel_unknown_pending",
  "protection_failure_cancel_pending",
  "close_pending",
  "close_unknown_pending",
  "close_reconciliation_pending",
  "group_close_pending",
]);
