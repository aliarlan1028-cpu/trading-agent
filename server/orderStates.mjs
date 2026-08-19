export const TERMINAL_EXCHANGE_ORDER_STATUS_LIST = Object.freeze([
  "filled",
  "canceled",
  "cancelled",
  "mmp_canceled",
  "rejected",
  "expired",
  "closed"
]);

export const TERMINAL_EXCHANGE_ORDER_STATES = new Set(TERMINAL_EXCHANGE_ORDER_STATUS_LIST);

// Exchange order states are an external contract. Fail open for presentation:
// an unknown state remains visible until it is explicitly classified terminal.
export function isTerminalExchangeOrder(rowOrStatus) {
  const status = typeof rowOrStatus === "object"
    ? rowOrStatus?.state ?? rowOrStatus?.status
    : rowOrStatus;
  return TERMINAL_EXCHANGE_ORDER_STATES.has(String(status || "").toLowerCase());
}
