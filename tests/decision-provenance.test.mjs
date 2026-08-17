import assert from "node:assert/strict";
import test from "node:test";
import { validateLiveDecisionProvenance } from "../server/executionEngine.mjs";
import { createDecisionAuditRecord, decisionAuditHash, normalizedPlanForDecisionAudit } from "../server/decisionAudit.mjs";
import { promptFingerprint } from "../server/secretRedaction.mjs";

function validDecision(plan = null) {
  const modelMessages = [[{ role: "system", content: "rules" }, { role: "user", content: "proposal" }]];
  const dynamicTools = [[{ type: "function", function: { name: "propose_trade_plan", parameters: { type: "object" } } }]];
  const evidence = { bundleId: "evidence-1", hash: "evidence-hash" };
  const primary = {
    gateway: "openrouter", requestedModel: "google/gemini-3.7-flash", actualModel: "google/gemini-3.7-flash",
    actualProvider: "Google AI Studio", actualEndpoint: "google/gemini-3.7-flash", providerAttributionVerified: true,
    systemFingerprint: "gemini-system", responseId: "gemini-response", reasoningEffort: "high"
  };
  const criticMetadata = {
    gateway: "direct", requestedModel: "deepseek-v4-pro", actualModel: "deepseek-v4-pro",
    actualProvider: "deepseek_direct", systemFingerprint: "deepseek-system", thinking: "enabled", reasoningEffort: "max"
  };
  const criticResult = {
    reviewId: "critic-1", verdict: "approve", approved: true, schemaValid: true, severity: "low",
    confidence: 0.9, summary: "approved", objections: [], requiredChecks: []
  };
  const prompt = { version: "agent-chat-v2-dual-model", hash: promptFingerprint("rules") };
  const toolSchema = { version: "agent-tools-v2-dual-model", hash: promptFingerprint(JSON.stringify(dynamicTools)) };
  const cohort = {
    id: "cohort-hash", primaryModel: primary.requestedModel, primaryReasoningEffort: "high",
    criticModel: criticMetadata.requestedModel, criticReasoningEffort: "max",
    promptVersion: prompt.version, toolSchemaVersion: toolSchema.version
  };
  const routingPolicy = { allow_fallbacks: true, require_parameters: true, data_collection: "deny", zdr: true, sort: "throughput", crossModelFallback: false };
  const auditInput = {
    id: "decision-audit-1", agentRunId: "run-1", tradePlanId: "plan-1", modelMessages, dynamicTools,
    geminiOutputs: [{ tool_calls: [{ function: { name: "propose_trade_plan", arguments: "{}" } }] }],
    criticInput: [{ role: "user", content: "review" }],
    criticOutput: { raw: { verdict: "approve" }, normalized: criticResult },
    providerMetadata: { primary: [primary], critic: criticMetadata },
    decisionContext: { prompt, toolSchema, cohort, routingPolicy }, evidence,
    normalizedPlan: normalizedPlanForDecisionAudit(plan || {}), createdAt: "2026-08-17T00:00:00.000Z"
  };
  const auditRecord = createDecisionAuditRecord(auditInput);
  const provenance = {
    primary: structuredClone(primary), critic: { ...structuredClone(criticMetadata), ...structuredClone(criticResult) },
    prompt: structuredClone(prompt), toolSchema: structuredClone(toolSchema), evidence: structuredClone(evidence),
    cohort: structuredClone(cohort), routingPolicy: structuredClone(routingPolicy),
    auditChain: { schemaVersion: auditRecord.schemaVersion, recordId: auditRecord.id, rootHash: auditRecord.rootHash }
  };
  return { provenance, auditRecord, auditInput };
}

function appendPrimaryCall(auditInput, provenance, metadata = provenance.primary) {
  auditInput.modelMessages.push(structuredClone(auditInput.modelMessages.at(-1)));
  auditInput.dynamicTools.push(structuredClone(auditInput.dynamicTools.at(-1)));
  auditInput.geminiOutputs.push(structuredClone(auditInput.geminiOutputs.at(-1)));
  auditInput.providerMetadata.primary.push(structuredClone(metadata));
  const toolHash = promptFingerprint(JSON.stringify(auditInput.dynamicTools));
  auditInput.decisionContext.toolSchema.hash = toolHash;
  provenance.toolSchema.hash = toolHash;
}

function sealAudit(provenance, auditInput) {
  const auditRecord = createDecisionAuditRecord(auditInput);
  provenance.auditChain = { schemaVersion: auditRecord.schemaVersion, recordId: auditRecord.id, rootHash: auditRecord.rootHash };
  return auditRecord;
}

test("live provenance accepts only a complete Gemini/OpenRouter + DeepSeek direct chain", () => {
  const { provenance, auditRecord } = validDecision();
  assert.deepEqual(validateLiveDecisionProvenance(provenance, { auditRecord }), {
    ok: true, primaryValid: true, criticValid: true, auditValid: true, auditReason: null, criticRequired: true
  });
});

test("live provenance rejects an unrecorded OpenRouter provider or cross-model fallback", () => {
  const { provenance: missingProvider, auditRecord } = validDecision();
  missingProvider.primary.actualProvider = null;
  assert.equal(validateLiveDecisionProvenance(missingProvider, { auditRecord }).primaryValid, false);

  const { provenance: legacyProvider, auditRecord: legacyAudit } = validDecision();
  legacyProvider.primary.providerAttributionVerified = false;
  assert.equal(validateLiveDecisionProvenance(legacyProvider, { auditRecord: legacyAudit }).primaryValid, false);

  const { provenance: fallback, auditRecord: fallbackAudit } = validDecision();
  fallback.routingPolicy.crossModelFallback = true;
  assert.equal(validateLiveDecisionProvenance(fallback, { auditRecord: fallbackAudit }).primaryValid, false);
});

test("live provenance rejects an unapproved provider and an incomplete critic contract", () => {
  const { provenance: wrongProvider, auditRecord } = validDecision();
  wrongProvider.primary.actualProvider = "Unknown Relay";
  assert.equal(validateLiveDecisionProvenance(wrongProvider, { auditRecord }).primaryValid, false);
  for (const mutation of [
    (critic) => { critic.schemaValid = false; },
    (critic) => { critic.confidence = 0; },
    (critic) => { critic.severity = "high"; },
    (critic) => { critic.requiredChecks = ["verify fees"]; }
  ]) {
    const { provenance: candidate, auditRecord: candidateAudit } = validDecision();
    mutation(candidate.critic);
    assert.equal(validateLiveDecisionProvenance(candidate, { auditRecord: candidateAudit }).criticValid, false);
  }
});

test("live provenance rejects a non-DeepSeek critic or missing immutable cohort", () => {
  const { provenance: wrongCritic, auditRecord } = validDecision();
  wrongCritic.critic.actualModel = "some-other-model";
  assert.equal(validateLiveDecisionProvenance(wrongCritic, { auditRecord }).criticValid, false);
  const { provenance: noCohort, auditRecord: noCohortAudit } = validDecision();
  noCohort.cohort = null;
  assert.equal(validateLiveDecisionProvenance(noCohort, { auditRecord: noCohortAudit }).primaryValid, false);
});

test("decision audit chain rejects any changed message, provider, critic output or normalized plan", () => {
  for (const stageName of ["model_messages", "provider_metadata", "deepseek_output", "decision_context", "normalized_plan"]) {
    const { provenance, auditRecord } = validDecision();
    const stage = auditRecord.stages.find((item) => item.name === stageName);
    stage.value = { tampered: stageName };
    assert.equal(validateLiveDecisionProvenance(provenance, { auditRecord }).auditValid, false, `${stageName} mutation must invalidate the chain`);
  }
});

test("news classification hashes and provider metadata are sealed into live supplemental provenance", () => {
  const { provenance, auditInput } = validDecision();
  const supplemental = {
    news: { version: 1, records: [{ evidenceId: "fact_1", inputHash: "a".repeat(64), outputHash: "b".repeat(64), model: "google/gemini-classifier", provider: "Google AI Studio", providerAttributionVerified: true, reasoningEffort: "low" }] }
  };
  auditInput.supplementalContext = structuredClone(supplemental);
  provenance.supplementalContext = structuredClone(supplemental);
  const auditRecord = sealAudit(provenance, auditInput);
  assert.equal(validateLiveDecisionProvenance(provenance, { auditRecord }).ok, true);

  provenance.supplementalContext.news.records[0].outputHash = "c".repeat(64);
  const changed = validateLiveDecisionProvenance(provenance, { auditRecord });
  assert.equal(changed.ok, false);
  assert.equal(changed.auditReason, "decision_audit_supplemental_context_mismatch");
});

test("sealed audit rejection or unknown provider cannot be bypassed with an approved provenance projection", () => {
  for (const mutation of [
    (input) => {
      input.providerMetadata.primary[0].actualProvider = null;
      input.providerMetadata.primary[0].providerAttributionVerified = false;
    },
    (input) => {
      Object.assign(input.criticOutput.normalized, {
        verdict: "reject", approved: false, confidence: 0.2, summary: "unsafe", objections: ["unsafe"]
      });
    }
  ]) {
    const { provenance, auditInput } = validDecision();
    mutation(auditInput);
    const auditRecord = createDecisionAuditRecord(auditInput);
    provenance.auditChain = { schemaVersion: auditRecord.schemaVersion, recordId: auditRecord.id, rootHash: auditRecord.rootHash };
    const result = validateLiveDecisionProvenance(provenance, { auditRecord });
    assert.equal(result.ok, false);
    assert.equal(result.auditValid, false);
  }
});

test("an invalid early Gemini call cannot be hidden behind a valid final call", () => {
  const { provenance, auditInput } = validDecision();
  auditInput.providerMetadata.primary[0] = {
    ...auditInput.providerMetadata.primary[0],
    actualProvider: "Unknown Relay",
    providerAttributionVerified: false,
    reasoningEffort: "low"
  };
  appendPrimaryCall(auditInput, provenance);
  const result = validateLiveDecisionProvenance(provenance, { auditRecord: sealAudit(provenance, auditInput) });
  assert.deepEqual({ ok: result.ok, primaryValid: result.primaryValid, auditValid: result.auditValid, auditReason: result.auditReason }, {
    ok: false,
    primaryValid: true,
    auditValid: false,
    auditReason: "decision_audit_primary_call_invalid:0:provider_invalid"
  });
});

test("every Gemini call enforces gateway, model, attribution and reasoning constraints", () => {
  for (const [mutation, expectedReason] of [
    [(call) => { call.gateway = "direct"; }, "gateway_invalid"],
    [(call) => { call.requestedModel = "openai/gpt-test"; }, "requested_model_invalid"],
    [(call) => { call.actualModel = "openai/gpt-test"; }, "actual_model_invalid"],
    [(call) => { call.providerAttributionVerified = false; }, "provider_attribution_unverified"],
    [(call) => { call.reasoningEffort = "low"; }, "reasoning_effort_invalid"]
  ]) {
    const { provenance, auditInput } = validDecision();
    mutation(auditInput.providerMetadata.primary[0]);
    appendPrimaryCall(auditInput, provenance);
    const result = validateLiveDecisionProvenance(provenance, { auditRecord: sealAudit(provenance, auditInput) });
    assert.equal(result.auditReason, `decision_audit_primary_call_invalid:0:${expectedReason}`);
    assert.equal(result.ok, false);
  }
});

test("missing metadata in the middle of a multi-call Gemini chain fails closed", () => {
  const { provenance, auditInput } = validDecision();
  appendPrimaryCall(auditInput, provenance);
  appendPrimaryCall(auditInput, provenance);
  auditInput.providerMetadata.primary[1] = null;
  const result = validateLiveDecisionProvenance(provenance, { auditRecord: sealAudit(provenance, auditInput) });
  assert.deepEqual({ ok: result.ok, auditValid: result.auditValid, auditReason: result.auditReason }, {
    ok: false,
    auditValid: false,
    auditReason: "decision_audit_primary_call_invalid:1:metadata_missing"
  });
});

test("Gemini messages, tools, outputs and provider metadata must have identical call counts", () => {
  const { provenance, auditInput } = validDecision();
  auditInput.modelMessages.push(structuredClone(auditInput.modelMessages[0]));
  const result = validateLiveDecisionProvenance(provenance, { auditRecord: sealAudit(provenance, auditInput) });
  assert.deepEqual({ ok: result.ok, auditValid: result.auditValid, auditReason: result.auditReason }, {
    ok: false,
    auditValid: false,
    auditReason: "decision_audit_primary_call_count_mismatch"
  });
});

test("prompt, dynamic tools and evidence must match their sealed audit facts", () => {
  for (const mutation of [
    (provenance) => { provenance.prompt.hash = "forged-prompt"; },
    (provenance) => { provenance.toolSchema.hash = "forged-tools"; },
    (provenance) => { provenance.evidence.hash = "forged-evidence"; }
  ]) {
    const { provenance, auditRecord } = validDecision();
    mutation(provenance);
    assert.equal(validateLiveDecisionProvenance(provenance, { auditRecord }).auditValid, false);
  }
});

test("missing provenance and malformed stage values return structured rejection instead of throwing", () => {
  assert.equal(typeof decisionAuditHash(undefined), "string");
  for (const [field, reason] of [
    ["evidence", "decision_audit_evidence_mismatch"],
    ["cohort", "decision_audit_cohort_mismatch"],
    ["routingPolicy", "decision_audit_routing_policy_mismatch"]
  ]) {
    const { provenance, auditRecord } = validDecision();
    delete provenance[field];
    const result = validateLiveDecisionProvenance(provenance, { auditRecord });
    assert.equal(result.ok, false);
    assert.equal(result.auditValid, false);
    assert.equal(result.auditReason, reason);
  }

  for (const mutation of [
    (record) => { delete record.stages.find((stage) => stage.name === "evidence").value; },
    (record) => { record.stages[0] = null; }
  ]) {
    const { provenance, auditRecord } = validDecision();
    mutation(auditRecord);
    const result = validateLiveDecisionProvenance(provenance, { auditRecord });
    assert.equal(result.ok, false);
    assert.equal(result.auditValid, false);
    assert.match(result.auditReason, /^decision_audit_stage_invalid:/);
  }
});

test("execution rejects a plan whose execution material changed after the audit was sealed", () => {
  const plan = { id: "plan-1", symbol: "BTC/USDT", direction: "long", stopLoss: 99, takeProfit: [110], exchange: "OKX", marketType: "perpetual_usdt" };
  const { provenance, auditRecord } = validDecision(plan);
  assert.equal(validateLiveDecisionProvenance(provenance, { auditRecord, plan }).auditValid, true);
  plan.stopLoss = 98;
  assert.equal(validateLiveDecisionProvenance(provenance, { auditRecord, plan }).auditValid, false);
});
