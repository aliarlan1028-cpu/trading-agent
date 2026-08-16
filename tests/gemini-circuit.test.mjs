import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.GEMINI_MODEL = "google/gemini-3.7-flash";
process.env.GEMINI_RETRY_MAX = "1";
process.env.GEMINI_CIRCUIT_429_MS = "300000";

const { resetLlmCircuits } = await import("../server/llmGateway.mjs");

const {
  geminiSearchCircuitStatus,
  geminiSearchComplete,
  geminiSearchWithEvidence,
  resetGeminiSearchCircuit
} = await import("../server/marketScan.mjs");

test("Gemini 429 立即熔断，后续调用不再发网络请求", async (t) => {
  resetGeminiSearchCircuit();
  resetLlmCircuits();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{"error":{"message":"retry in 30s"}}', { status: 429, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; resetGeminiSearchCircuit(); resetLlmCircuits(); });

  await assert.rejects(() => geminiSearchComplete("test"), /429/);
  assert.equal(geminiSearchCircuitStatus().state, "open");
  await assert.rejects(() => geminiSearchComplete("test again"), /circuit open/);
  assert.equal(calls, 1, "熔断期间不得继续消耗请求与等待时间");
});

test("调用方主动取消 Gemini 搜索不会污染行情搜索熔断器", async (t) => {
  resetGeminiSearchCircuit();
  resetLlmCircuits();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("caller cancelled"), { name: "AbortError" })), { once: true });
  });
  t.after(() => { globalThis.fetch = originalFetch; resetGeminiSearchCircuit(); resetLlmCircuits(); });

  const controller = new AbortController();
  const pending = geminiSearchWithEvidence("cancel obsolete search", { signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, (error) => error.code === "request_aborted");

  const circuit = geminiSearchCircuitStatus();
  assert.equal(circuit.state, "closed");
  assert.equal(circuit.consecutiveFailures, 0);
  assert.equal(circuit.lastError, null);
});
