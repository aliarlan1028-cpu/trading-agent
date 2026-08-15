export const OPEN_EXECUTION_STATUS_LIST = Object.freeze([
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
]);

export const OPEN_EXECUTION_STATES = new Set(OPEN_EXECUTION_STATUS_LIST);

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
