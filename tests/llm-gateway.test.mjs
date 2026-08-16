import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { completeGeminiWebSearch, criticInferencePolicy, extractOpenRouterAttribution, extractOpenRouterProvider, isAllowedGeminiProvider, llmCircuitStatus, normalizeCriticVerdict, normalizeGeminiModel, openRouterProviderPolicy, primaryInferencePolicy, resetLlmCircuits } from "../server/llmGateway.mjs";

test("Gemini model IDs are normalized to the OpenRouter namespace", () => {
  assert.equal(normalizeGeminiModel(), "google/gemini-3.1-pro-preview");
  assert.equal(normalizeGeminiModel("gemini-3.7-flash"), "google/gemini-3.7-flash");
  assert.equal(normalizeGeminiModel("google/gemini-3.6-flash"), "google/gemini-3.6-flash");
});

test("OpenRouter defaults deny data collection and require parameter support", () => {
  const priorZdr = process.env.OPENROUTER_ZDR;
  const priorCollection = process.env.OPENROUTER_DATA_COLLECTION;
  delete process.env.OPENROUTER_ZDR;
  delete process.env.OPENROUTER_DATA_COLLECTION;
  try {
    const policy = openRouterProviderPolicy();
    assert.equal(policy.require_parameters, true);
    assert.equal(policy.data_collection, "deny");
    assert.equal(policy.zdr, true);
  } finally {
    if (priorZdr === undefined) delete process.env.OPENROUTER_ZDR; else process.env.OPENROUTER_ZDR = priorZdr;
    if (priorCollection === undefined) delete process.env.OPENROUTER_DATA_COLLECTION; else process.env.OPENROUTER_DATA_COLLECTION = priorCollection;
  }
});

test("critic approval is fail-closed when objections are present or schema is invalid", () => {
  const complete = { verdict: "approve", severity: "low", confidence: 0.9, objections: ["fee missing"], requiredChecks: [], summary: "reviewed" };
  assert.equal(normalizeCriticVerdict(complete).approved, false);
  const invalid = normalizeCriticVerdict({ verdict: "maybe", confidence: 99 });
  assert.equal(invalid.verdict, "insufficient_evidence");
  assert.equal(invalid.approved, false);
  assert.equal(invalid.confidence, 0);
  assert.equal(invalid.schemaValid, false);
});

test("critic requires every field, sufficient confidence, safe severity, and no extra fields", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/deepseek-critic-completion.json", import.meta.url), "utf8"));
  const fixtureVerdict = JSON.parse(fixture.choices[0].message.content);
  assert.equal(normalizeCriticVerdict(fixtureVerdict).approved, true);
  const valid = { verdict: "approve", severity: "low", confidence: 0.9, objections: [], requiredChecks: [], summary: "all checks passed" };
  assert.equal(normalizeCriticVerdict(valid).approved, true);
  for (const key of Object.keys(valid)) {
    const candidate = { ...valid };
    delete candidate[key];
    assert.equal(normalizeCriticVerdict(candidate).approved, false, `${key} must be required`);
  }
  assert.equal(normalizeCriticVerdict({ ...valid, confidence: 0 }).approved, false);
  assert.equal(normalizeCriticVerdict({ ...valid, severity: "high" }).approved, false);
  assert.equal(normalizeCriticVerdict({ ...valid, extra: true }).approved, false);
  assert.equal(normalizeCriticVerdict({ ...valid, requiredChecks: ["verify funding"] }).approved, false);
});

test("OpenRouter provider metadata parser accepts official-style endpoint metadata and rejects unapproved providers", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/openrouter-chat-completion.json", import.meta.url), "utf8"));
  assert.equal(extractOpenRouterProvider(fixture), "Google AI Studio");
  assert.deepEqual(extractOpenRouterAttribution(fixture), {
    provider: "Google AI Studio",
    endpoint: "google/gemini-3.1-pro-preview",
    strategy: "direct",
    attempt: 1,
    isByok: false,
    verified: true,
    source: "openrouter_metadata"
  });
  assert.equal(extractOpenRouterProvider({ endpoint: { provider_name: "Google AI Studio" } }), "Google AI Studio");
  assert.equal(extractOpenRouterAttribution({ endpoint: { provider_name: "Google AI Studio" } }).verified, false);
  assert.equal(extractOpenRouterAttribution({ openrouter_metadata: { endpoints: { available: [{ provider: "Relay", selected: false }] } } }).provider, null);
  assert.equal(extractOpenRouterProvider({ metadata: { provider: { name: "Google Vertex" } } }), "Google Vertex");
  assert.equal(isAllowedGeminiProvider("Google AI Studio"), true);
  assert.equal(isAllowedGeminiProvider("Unknown Relay"), false);
  assert.equal(isAllowedGeminiProvider("Unknown Google Relay"), false);
  assert.equal(isAllowedGeminiProvider(null), false);
});

test("Gemini web search aborts at the shared LLM timeout and records the circuit failure", async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldTimeout = process.env.LLM_REQUEST_TIMEOUT_MS;
  const oldFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.LLM_REQUEST_TIMEOUT_MS = "20";
  resetLlmCircuits();
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(options.signal.reason || Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  try {
    await assert.rejects(() => completeGeminiWebSearch("test"), (error) => error.code === "llm_request_timeout");
    assert.equal(llmCircuitStatus()["openrouter:gemini_search"].lastError, "llm_request_timeout");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldTimeout === undefined) delete process.env.LLM_REQUEST_TIMEOUT_MS; else process.env.LLM_REQUEST_TIMEOUT_MS = oldTimeout;
    resetLlmCircuits();
  }
});

test("caller cancellation does not increment failures or open the LLM circuit", async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldTimeout = process.env.LLM_REQUEST_TIMEOUT_MS;
  const oldFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.LLM_REQUEST_TIMEOUT_MS = "1000";
  resetLlmCircuits();
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(options.signal.reason || Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  try {
    const controller = new AbortController();
    const pending = completeGeminiWebSearch("cancel me", { signal: controller.signal });
    controller.abort();
    await assert.rejects(() => pending, (error) => error.code === "request_aborted");
    const circuit = llmCircuitStatus()["openrouter:gemini_search"];
    assert.equal(circuit.failures, 0);
    assert.equal(circuit.state, "closed");
    assert.equal(circuit.lastError, null);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldTimeout === undefined) delete process.env.LLM_REQUEST_TIMEOUT_MS; else process.env.LLM_REQUEST_TIMEOUT_MS = oldTimeout;
    resetLlmCircuits();
  }
});

test("DeepSeek critic always uses thinking mode at maximum effort", () => {
  assert.deepEqual(criticInferencePolicy(), { thinking: { type: "enabled" }, reasoning_effort: "max" });
});

test("Gemini primary always uses high reasoning effort", () => {
  assert.deepEqual(primaryInferencePolicy(), { reasoning: { effort: "high" } });
});
