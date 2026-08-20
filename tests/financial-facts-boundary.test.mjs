import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { currentEquityUsdt as compatibilityCurrentEquityUsdt } from "../server/executionEngine.mjs";

const financialFacts = await import("../server/financialFacts.mjs").catch(() => null);
const currentEquityUsdt = financialFacts?.currentEquityUsdt || compatibilityCurrentEquityUsdt;

const snapshot = (overrides = {}) => ({
  id: "snapshot",
  status: "ok",
  exchange: "OKX",
  createdAt: "2026-08-20T00:00:00.000Z",
  balances: [{ totalEq: "100" }],
  ...overrides
});

test("current equity has one financial-facts implementation with execution compatibility", () => {
  assert.ok(financialFacts, "expected the independent financial facts selector to exist");
  assert.equal(compatibilityCurrentEquityUsdt, financialFacts.currentEquityUsdt);
});

test("accounting reads current equity from financial facts instead of executionEngine", () => {
  const accounting = fs.readFileSync(new URL("../server/accounting.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(accounting, /from\s+["']\.\/executionEngine\.mjs["']/);
  assert.match(accounting, /from\s+["']\.\/financialFacts\.mjs["']/);
});

test("financial facts remains independent of accounting, execution, and risk engines", () => {
  assert.ok(financialFacts, "expected the independent financial facts selector to exist");
  const source = fs.readFileSync(new URL("../server/financialFacts.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']\.\/(?:accounting|executionEngine|riskEngine)\.mjs["']/);
});

test("latest successful explicit OKX snapshot equity wins over portfolio and array order", () => {
  const db = {
    portfolio: { totalEquityUsdt: 900 },
    accountSnapshots: [
      snapshot({ id: "older", createdAt: "2026-08-18T00:00:00.000Z", balances: [{ totalEq: "110" }] }),
      snapshot({ id: "failed-newer", status: "error", createdAt: "2026-08-20T02:00:00.000Z", balances: [{ totalEq: "999" }] }),
      snapshot({ id: "binance-newer", exchange: "BINANCE", createdAt: "2026-08-20T01:00:00.000Z", balances: [{ totalEq: "888" }] }),
      snapshot({ id: "latest-okx", createdAt: "2026-08-19T00:00:00.000Z", balances: [{ totalEq: "120.5" }] })
    ]
  };
  assert.equal(currentEquityUsdt(db), 120.5);
});

test("missing account snapshots falls back to positive portfolio equity", () => {
  assert.equal(currentEquityUsdt({ portfolio: { totalEquityUsdt: "42.25" } }), 42.25);
  assert.equal(currentEquityUsdt({ accountSnapshots: [], portfolio: { totalEquityUsdt: 43 } }), 43);
});

test("invalid latest snapshot equity falls back to portfolio rather than an older snapshot", () => {
  for (const totalEq of [undefined, null, "", "not-a-number", "0", "-1"]) {
    const db = {
      portfolio: { totalEquityUsdt: 75 },
      accountSnapshots: [
        snapshot({ id: "older-valid", createdAt: "2026-08-18T00:00:00.000Z", balances: [{ totalEq: "125" }] }),
        snapshot({ id: "latest-invalid", createdAt: "2026-08-19T00:00:00.000Z", balances: [{ totalEq }] })
      ]
    };
    assert.equal(currentEquityUsdt(db), 75, `unexpected result for totalEq=${String(totalEq)}`);
  }
});

test("stale successful snapshot retains its current priority over portfolio", () => {
  const db = {
    portfolio: { totalEquityUsdt: 500 },
    accountSnapshots: [snapshot({ createdAt: "2020-01-01T00:00:00.000Z", balances: [{ totalEq: "250" }] })]
  };
  assert.equal(currentEquityUsdt(db), 250);
});

test("legacy snapshot without an explicit OKX exchange retains portfolio fallback behavior", () => {
  const db = {
    portfolio: { totalEquityUsdt: 80 },
    accountSnapshots: [snapshot({ exchange: undefined, balances: [{ totalEq: "150" }] })]
  };
  assert.equal(currentEquityUsdt(db), 80);
});

test("snapshot compact totalEquityUsdt is not substituted for the existing balances totalEq contract", () => {
  const db = {
    portfolio: { totalEquityUsdt: 70 },
    accountSnapshots: [snapshot({ totalEquityUsdt: 160, balances: [] })]
  };
  assert.equal(currentEquityUsdt(db), 70);
});

test("malformed, zero, and negative portfolio equity remain unavailable", () => {
  for (const totalEquityUsdt of [undefined, null, "", "not-a-number", 0, -1]) {
    assert.equal(
      currentEquityUsdt({ accountSnapshots: [], portfolio: { totalEquityUsdt } }),
      null,
      `unexpected result for totalEquityUsdt=${String(totalEquityUsdt)}`
    );
  }
});
