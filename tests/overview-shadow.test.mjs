import assert from "node:assert/strict";
import test from "node:test";
import { compareOverviewShadowFacts, overviewShadowFacts } from "../server/overviewShadow.mjs";

const snapshot = {
  positions: [{ id: "p1", symbol: "BTC/USDT", quantity: .1, side: "long" }],
  orders: [{ id: "open", symbol: "BTC/USDT", status: "partially_filled" }, { id: "done", status: "filled" }],
  system: { killSwitch: false, reduceOnlyMode: true, riskStatus: "风控暂停" },
  portfolio: { totalEquityUsdt: 123.45 },
  performance: { totalPnlUsdt: 7.25 }
};

test("overview shadow compares the five release-critical fact groups", () => {
  const facts = overviewShadowFacts(snapshot);
  assert.equal(compareOverviewShadowFacts(facts, overviewShadowFacts(structuredClone(snapshot))).match, true);
  const changed = structuredClone(snapshot);
  changed.portfolio.totalEquityUsdt = 120;
  changed.orders = [];
  const comparison = compareOverviewShadowFacts(facts, overviewShadowFacts(changed));
  assert.equal(comparison.match, false);
  assert.deepEqual(comparison.mismatches, ["openOrders", "accountEquityUsdt"]);
});
