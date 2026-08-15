import assert from "node:assert/strict";
import test from "node:test";
import { validateLiveDecisionProvenance } from "../server/executionEngine.mjs";

function validProvenance() {
  return {
    primary: {
      gateway: "openrouter",
      requestedModel: "google/gemini-3.7-flash",
      actualModel: "google/gemini-3.7-flash",
      actualProvider: "Google AI Studio",
      reasoningEffort: "high"
    },
    critic: {
      reviewId: "critic-1",
      gateway: "direct",
      requestedModel: "deepseek-v4-pro",
      actualModel: "deepseek-v4-pro",
      actualProvider: "deepseek_direct",
      thinking: "enabled",
      reasoningEffort: "max",
      approved: true
    },
    prompt: { version: "agent-chat-v2-dual-model", hash: "prompt-hash" },
    toolSchema: { version: "agent-tools-v2-dual-model", hash: "tools-hash" },
    evidence: { bundleId: "evidence-1", hash: "evidence-hash" },
    cohort: { id: "cohort-hash" },
    routingPolicy: { crossModelFallback: false }
  };
}

test("live provenance accepts only a complete Gemini/OpenRouter + DeepSeek direct chain", () => {
  assert.deepEqual(validateLiveDecisionProvenance(validProvenance(), { criticRequired: true }), {
    ok: true,
    primaryValid: true,
    criticValid: true,
    criticRequired: true
  });
});

test("live provenance rejects an unrecorded OpenRouter provider or cross-model fallback", () => {
  const missingProvider = validProvenance();
  missingProvider.primary.actualProvider = null;
  assert.equal(validateLiveDecisionProvenance(missingProvider, { criticRequired: true }).primaryValid, false);

  const fallback = validProvenance();
  fallback.routingPolicy.crossModelFallback = true;
  assert.equal(validateLiveDecisionProvenance(fallback, { criticRequired: true }).primaryValid, false);
});

test("live provenance rejects a non-DeepSeek critic or missing immutable cohort", () => {
  const wrongCritic = validProvenance();
  wrongCritic.critic.actualModel = "some-other-model";
  assert.equal(validateLiveDecisionProvenance(wrongCritic, { criticRequired: true }).criticValid, false);

  const noCohort = validProvenance();
  noCohort.cohort = null;
  assert.equal(validateLiveDecisionProvenance(noCohort, { criticRequired: true }).primaryValid, false);
});
