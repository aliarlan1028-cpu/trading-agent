const HOUR = 3_600_000;
const MAX_EVENTS = 2_000;

const state = {
  connected: false,
  connectedAt: null,
  disconnectedAt: null,
  lastMessageAt: null,
  events: []
};

function displaySymbol(instId) {
  return String(instId || "").toUpperCase().replace(/-SWAP$/, "").replace("-", "/");
}

function prune(now = Date.now()) {
  const cutoff = now - 6 * HOUR;
  state.events = state.events.filter((event) => event.ts >= cutoff).slice(-MAX_EVENTS);
}

export function markOkxLiquidationStreamConnected(connected, at = Date.now()) {
  if (connected) {
    // 每次重连都重新开始连续覆盖窗口；不能把断线前后的空档拼成完整样本。
    if (!state.connected) state.connectedAt = at;
    state.disconnectedAt = null;
  } else {
    state.connectedAt = null;
    state.disconnectedAt = at;
  }
  state.connected = Boolean(connected);
}

export function recordOkxLiquidationMessage(message, receivedAt = Date.now()) {
  const incoming = [];
  for (const group of message?.data || []) {
    const symbol = displaySymbol(group.instId);
    if (!symbol) continue;
    for (const detail of group.details || []) {
      const ts = Number(detail.ts);
      if (!Number.isFinite(ts) || !["long", "short"].includes(detail.posSide)) continue;
      incoming.push({
        key: `${group.instId}:${detail.ts}:${detail.posSide}:${detail.side || ""}:${detail.sz || ""}:${detail.bkPx || ""}`,
        symbol,
        posSide: detail.posSide,
        ts
      });
    }
  }
  if (incoming.length) {
    const known = new Set(state.events.map((event) => event.key));
    for (const event of incoming) if (!known.has(event.key)) state.events.push(event);
  }
  state.lastMessageAt = receivedAt;
  prune(receivedAt);
  return incoming.length;
}

export function getOkxLiquidationSummary(symbol, windowMs = 30 * 60_000, now = Date.now()) {
  prune(now);
  if (!state.connected || !state.connectedAt) return null;
  const normalized = String(symbol || "").toUpperCase();
  const cutoff = now - windowMs;
  const events = state.events.filter((event) => event.symbol === normalized && event.ts >= cutoff && event.ts <= now);
  const completeWindow = state.connectedAt <= cutoff;
  // 尚未覆盖完整窗口且没有事件时，“0”并不是经过观测的完整事实。
  if (!completeWindow && !events.length) return null;
  const longLiqCount = events.filter((event) => event.posSide === "long").length;
  const shortLiqCount = events.filter((event) => event.posSide === "short").length;
  return {
    total: events.length,
    longLiqCount,
    shortLiqCount,
    dominantSide: longLiqCount > shortLiqCount ? "long" : shortLiqCount > longLiqCount ? "short" : "balanced",
    windowMs,
    coverageMs: Math.max(0, now - Math.max(state.connectedAt, cutoff)),
    completeWindow,
    source: "OKX_PUBLIC_WS",
    fetchedAt: new Date(now).toISOString()
  };
}

export function okxLiquidationStreamStatus() {
  return { ...state, events: state.events.length };
}

export function resetOkxLiquidationStreamForTest() {
  state.connected = false;
  state.connectedAt = null;
  state.disconnectedAt = null;
  state.lastMessageAt = null;
  state.events = [];
}
