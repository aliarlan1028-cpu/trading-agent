import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.GEMINI_MODEL = "google/gemini-3.7-flash";
process.env.GEMINI_RETRY_MAX = "1";
process.env.GEMINI_CIRCUIT_429_MS = "300000";

const {
  geminiSearchCircuitStatus,
  geminiSearchComplete,
  resetGeminiSearchCircuit
} = await import("../server/marketScan.mjs");

test("Gemini 429 立即熔断，后续调用不再发网络请求", async (t) => {
  resetGeminiSearchCircuit();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{"error":{"message":"retry in 30s"}}', { status: 429, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; resetGeminiSearchCircuit(); });

  await assert.rejects(() => geminiSearchComplete("test"), /429/);
  assert.equal(geminiSearchCircuitStatus().state, "open");
  await assert.rejects(() => geminiSearchComplete("test again"), /circuit open/);
  assert.equal(calls, 1, "熔断期间不得继续消耗请求与等待时间");
});
