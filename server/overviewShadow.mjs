import { isTerminalExchangeOrder } from "./orderStates.mjs";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(8)) : null;
}

function positionFacts(rows = []) {
  return (rows || []).map((row) => ({
    id: row.id || null,
    symbol: row.symbol || null,
    quantity: number(row.quantity ?? row.size ?? row.pos ?? row.qty),
    side: row.side || row.direction || null
  })).sort((a, b) => `${a.symbol}:${a.id}`.localeCompare(`${b.symbol}:${b.id}`));
}

function openOrderFacts(rows = []) {
  return (rows || []).filter((row) => !isTerminalExchangeOrder(row)).map((row) => ({
    id: row.id || row.ordId || null,
    symbol: row.symbol || row.instId || null,
    status: String(row.state ?? row.status ?? "").toLowerCase()
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function overviewShadowFacts(snapshot = {}) {
  return {
    positions: positionFacts(snapshot.positions),
    openOrders: openOrderFacts(snapshot.orders),
    risk: {
      killSwitch: snapshot.system?.killSwitch === true,
      reduceOnlyMode: snapshot.system?.reduceOnlyMode === true,
      riskStatus: snapshot.system?.riskStatus || null
    },
    accountEquityUsdt: number(snapshot.portfolio?.totalEquityUsdt),
    lifecycleNetPnlUsdt: number(snapshot.performance?.totalPnlUsdt)
  };
}

export function compareOverviewShadowFacts(authoritative, candidate) {
  const fields = ["positions", "openOrders", "risk", "accountEquityUsdt", "lifecycleNetPnlUsdt"];
  const mismatches = fields.filter((field) => JSON.stringify(authoritative?.[field]) !== JSON.stringify(candidate?.[field]));
  return { match: mismatches.length === 0, mismatches, authoritative, candidate };
}
