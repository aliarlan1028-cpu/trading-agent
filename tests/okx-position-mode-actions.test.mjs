import assert from "node:assert/strict";
import test from "node:test";

import { executeOkxAction } from "../server/tradeActions.mjs";

process.env.OKX_API_KEY = "test-key";
process.env.OKX_API_SECRET = "test-secret";
process.env.OKX_API_PASSPHRASE = "test-passphrase";

const SPEC = { ctVal: 0.01, lotSz: 1, minSz: 1, tickSz: 0.1 };

function entry(overrides = {}) {
  return {
    symbol: "BTC/USDT", marketType: "perpetual_usdt", quantity: 0.01,
    side: "buy", positionSide: "long", type: "market", clientOrderId: "entry123",
    leverage: 3, tdMode: "isolated", ...overrides
  };
}

function accepted(path) {
  return path.includes("set-leverage")
    ? { code: "0", data: [{}] }
    : { code: "0", data: [{ sCode: "0", ordId: "order1", algoId: "algo1" }] };
}

test("isolated hedge-mode leverage is configured after mode resolution with the exact long/short posSide", async () => {
  for (const [side, positionSide] of [["buy", "long"], ["sell", "short"]]) {
    const events = [];
    const result = await executeOkxAction("place_order", entry({ side, positionSide }), {
      positionMode: async () => { events.push("position_mode"); return "long_short_mode"; },
      contractSpec: async () => SPEC,
      signedRequest: async (path, _method, body) => {
        events.push({ path, body: JSON.parse(body) });
        return accepted(path);
      }
    });
    assert.equal(result.status, "ok");
    assert.equal(events[0], "position_mode");
    assert.equal(events[1].path, "/api/v5/account/set-leverage");
    assert.equal(events[1].body.posSide, positionSide);
    assert.equal(events[2].body.posSide, positionSide);
  }
});

test("net mode and cross hedge mode do not add an invalid posSide to set-leverage", async () => {
  for (const payload of [entry({ tdMode: "isolated" }), entry({ tdMode: "cross" })]) {
    const mode = payload.tdMode === "isolated" ? "net_mode" : "long_short_mode";
    const bodies = [];
    const result = await executeOkxAction("place_order", payload, {
      positionMode: async () => mode,
      contractSpec: async () => SPEC,
      signedRequest: async (path, _method, body) => { bodies.push({ path, body: JSON.parse(body) }); return accepted(path); }
    });
    assert.equal(result.status, "ok");
    assert.equal(Object.hasOwn(bodies[0].body, "posSide"), false);
    assert.equal(bodies[1].body.posSide, mode === "long_short_mode" ? "long" : undefined);
  }
});

test("unknown position mode fails before leverage, entry, close or take-profit writes", async () => {
  const calls = [];
  const dependencies = {
    positionMode: async () => null,
    contractSpec: async () => SPEC,
    signedRequest: async (...args) => { calls.push(args); return accepted(args[0]); }
  };
  const place = await executeOkxAction("place_order", entry(), dependencies);
  const close = await executeOkxAction("close_position", {
    symbol: "BTC/USDT", marketType: "perpetual_usdt", positionSide: "long", tdMode: "isolated"
  }, dependencies);
  const tp = await executeOkxAction("take_profit", {
    symbol: "BTC/USDT", marketType: "perpetual_usdt", positionSide: "long", side: "sell",
    quantity: 0.01, price: 70000
  }, dependencies);
  assert.deepEqual([place.status, close.status, tp.status], ["position_mode_unknown", "position_mode_unknown", "position_mode_unknown"]);
  assert.equal(calls.length, 0);
});
