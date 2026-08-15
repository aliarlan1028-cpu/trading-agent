import assert from "node:assert/strict";
import test from "node:test";
import { criticInferencePolicy, normalizeCriticVerdict, normalizeGeminiModel, openRouterProviderPolicy, primaryInferencePolicy } from "../server/llmGateway.mjs";

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
  assert.equal(normalizeCriticVerdict({ verdict: "approve", objections: ["fee missing"], confidence: 0.9 }).approved, false);
  const invalid = normalizeCriticVerdict({ verdict: "maybe", confidence: 99 });
  assert.equal(invalid.verdict, "insufficient_evidence");
  assert.equal(invalid.approved, false);
  assert.equal(invalid.confidence, 1);
});

test("DeepSeek critic always uses thinking mode at maximum effort", () => {
  assert.deepEqual(criticInferencePolicy(), { thinking: { type: "enabled" }, reasoning_effort: "max" });
});

test("Gemini primary always uses high reasoning effort", () => {
  assert.deepEqual(primaryInferencePolicy(), { reasoning: { effort: "high" } });
});
