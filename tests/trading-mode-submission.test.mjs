import assert from "node:assert/strict";
import test from "node:test";
import { applyTradingModeOnce, buildTradingModePayload } from "../src/tradingModeSubmission.js";

test("topbar mode-only payload preserves existing notional and symbol boundaries", () => {
  const payload = buildTradingModePayload("full_auto", {
    acknowledged: true,
    maxNotionalUsdt: 20,
    grayAllowedSymbols: ["BTC/USDT", "ETH/USDT"]
  });
  assert.deepEqual(payload, { requestedMode: "full_auto", acknowledged: true });
  assert.equal(Object.hasOwn(payload, "allowedSymbols"), false);
  assert.equal(Object.hasOwn(payload, "grayAllowedSymbols"), false);
  assert.equal(Object.hasOwn(payload, "maxNotionalUsdt"), false);
});

test("failed trading-mode save keeps the dialog open by withholding the success callback", async () => {
  const lock = { current: false };
  let closed = false;
  const result = await applyTradingModeOnce({
    lock,
    payload: { requestedMode: "full_auto" },
    request: async () => ({ ok: false, error: "live_confirmation_required" }),
    onSuccess: () => { closed = true; }
  });
  assert.equal(result.ok, false);
  assert.equal(closed, false);
  assert.equal(lock.current, false);
});

test("trading-mode submission synchronously rejects a double click", async () => {
  const lock = { current: false };
  let requests = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const first = applyTradingModeOnce({
    lock,
    payload: { requestedMode: "semi_auto" },
    request: async () => { requests += 1; return pending; }
  });
  const duplicate = await applyTradingModeOnce({
    lock,
    payload: { requestedMode: "semi_auto" },
    request: async () => { requests += 1; return { ok: true }; }
  });
  assert.deepEqual(duplicate, { ok: false, error: "request_in_progress", duplicate: true });
  assert.equal(requests, 1);
  finish({ ok: true });
  assert.equal((await first).ok, true);
  assert.equal(lock.current, false);
});
