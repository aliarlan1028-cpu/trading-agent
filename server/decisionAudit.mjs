import crypto from "node:crypto";
import { isAllowedGeminiProvider } from "./llmGateway.mjs";
import { promptFingerprint } from "./secretRedaction.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function decisionAuditHash(value) {
  try {
    const serialized = JSON.stringify(canonical(value));
    return crypto.createHash("sha256").update(serialized === undefined ? "__KORDYN_UNDEFINED__" : serialized).digest("hex");
  } catch {
    return null;
  }
}

export function normalizedPlanForDecisionAudit(plan = {}) {
  const fields = [
    "id", "agentRunId", "agent_run_id", "criticReviewId", "mandateId", "mandate_id", "mandateVersion",
    "exchange", "marketType", "market_type", "symbol", "direction", "strategy", "strategyId",
    "strategyVersionId", "strategyRef", "strategyBlueprintVersionId", "timeframe", "executionMode",
    "entry", "entry_range", "stopLoss", "stop_loss", "takeProfit", "takeProfits", "riskPercent",
    "take_profit", "riskPct", "max_loss_pct", "max_slippage_pct", "reduce_only", "leverage",
    "leveragePolicy", "quantity", "notionalUsdt", "scenarioType", "scenario", "traderRole", "tradingHorizon",
    "triggerSpec", "scenarioStages",
    "triggerConfirmations", "reasoningSummary", "thesis", "invalidation", "analysisBundleId",
    "analysis_bundle_id", "evidenceBundleId", "evidence_bundle_id", "evidenceIds", "knowledgeSkillIds",
    "adoptedTrustedSkillIds", "appliedKnowledge", "reviewLearning", "decisionContext", "smartMoneyAlignment",
    "newsEvidence", "rejectedNewsEventIds", "outOfWhitelist", "oneShotAuth", "schemaWarnings", "source", "createdAt"
  ];
  return Object.fromEntries(fields.filter((field) => plan[field] !== undefined).map((field) => [field, plan[field]]));
}

export function createDecisionAuditRecord(input = {}) {
  const schemaVersion = 2;
  const artifacts = [
    ["model_messages", input.modelMessages || []],
    ["dynamic_tool_definitions", input.dynamicTools || []],
    ["gemini_outputs", input.geminiOutputs || []],
    ["deepseek_input", input.criticInput || []],
    ["deepseek_output", input.criticOutput || null],
    ["provider_metadata", input.providerMetadata || {}],
    ["decision_context", input.decisionContext || {}],
    ["evidence", input.evidence || null],
    ["supplemental_context", input.supplementalContext || null],
    ["normalized_plan", input.normalizedPlan || {}]
  ];
  let previousHash = "GENESIS";
  const stages = artifacts.map(([name, value], index) => {
    const contentHash = decisionAuditHash(value);
    const chainHash = decisionAuditHash({ schemaVersion, index, name, previousHash, contentHash });
    const stage = { index, name, previousHash, contentHash, chainHash, value };
    previousHash = chainHash;
    return stage;
  });
  return {
    id: input.id,
    schemaVersion,
    agentRunId: input.agentRunId || null,
    tradePlanId: input.tradePlanId || null,
    stages,
    rootHash: previousHash,
    createdAt: input.createdAt
  };
}

export function verifyDecisionAuditRecord(record, expectedRootHash, expectedPlan = null) {
  if (!record || ![1, 2].includes(record.schemaVersion) || !Array.isArray(record.stages) || !record.stages.length) {
    return { ok: false, reason: "decision_audit_record_missing" };
  }
  let previousHash = "GENESIS";
  for (let index = 0; index < record.stages.length; index += 1) {
    const stage = record.stages[index];
    const contentHash = stage && typeof stage === "object" ? decisionAuditHash(stage.value) : null;
    if (!stage || typeof stage !== "object" || !contentHash || stage.index !== index
      || stage.previousHash !== previousHash || stage.contentHash !== contentHash) {
      return { ok: false, reason: `decision_audit_stage_invalid:${stage?.name || index}` };
    }
    const chainHash = decisionAuditHash({ schemaVersion: record.schemaVersion, index, name: stage.name, previousHash, contentHash: stage.contentHash });
    if (stage.chainHash !== chainHash) return { ok: false, reason: `decision_audit_chain_invalid:${stage?.name || index}` };
    previousHash = chainHash;
  }
  if (!expectedRootHash || previousHash !== expectedRootHash || record.rootHash !== expectedRootHash) {
    return { ok: false, reason: "decision_audit_root_mismatch" };
  }
  if (expectedPlan) {
    const planStage = record.stages.find((stage) => stage.name === "normalized_plan");
    if (!planStage || planStage.contentHash !== decisionAuditHash(expectedPlan)) {
      return { ok: false, reason: "decision_audit_plan_mismatch" };
    }
  }
  return { ok: true, rootHash: previousHash };
}

function stageValue(record, name) {
  const matches = (record?.stages || []).filter((stage) => stage?.name === name);
  return matches.length === 1 ? matches[0].value : undefined;
}

function sameValue(left, right) {
  if (left === undefined || right === undefined) return false;
  const leftHash = decisionAuditHash(left);
  const rightHash = decisionAuditHash(right);
  return Boolean(leftHash && rightHash && leftHash === rightHash);
}

function pick(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value?.[field] ?? null]));
}

const PRIMARY_ATTRIBUTION_FIELDS = Object.freeze([
  "gateway", "requestedModel", "actualModel", "actualProvider", "actualEndpoint",
  "providerAttributionVerified", "systemFingerprint", "responseId", "reasoningEffort"
]);

const CRITIC_ATTRIBUTION_FIELDS = Object.freeze([
  "reviewId", "gateway", "requestedModel", "actualModel", "actualProvider", "systemFingerprint",
  "thinking", "reasoningEffort", "verdict", "approved", "schemaValid", "severity", "confidence",
  "summary", "objections", "requiredChecks"
]);

function primaryCallConstraintViolation(call) {
  if (!call || typeof call !== "object" || Array.isArray(call)) return "metadata_missing";
  if (call.gateway !== "openrouter") return "gateway_invalid";
  if (!String(call.requestedModel || "").startsWith("google/gemini-")) return "requested_model_invalid";
  if (!String(call.actualModel || "").startsWith("google/gemini-")) return "actual_model_invalid";
  if (!isAllowedGeminiProvider(call.actualProvider)) return "provider_invalid";
  if (call.providerAttributionVerified !== true) return "provider_attribution_unverified";
  if (call.reasoningEffort !== "high") return "reasoning_effort_invalid";
  return null;
}

// A valid hash chain only proves that a record was not changed after sealing. Live
// execution additionally needs to prove that the convenient decisionProvenance
// projection says exactly the same thing as the sealed provider/critic/input facts.
export function verifyDecisionAuditExecutionAttribution(record, provenance) {
  if (record?.schemaVersion !== 2) return { ok: false, reason: "decision_audit_execution_schema_unsupported" };
  const modelMessages = stageValue(record, "model_messages");
  const dynamicTools = stageValue(record, "dynamic_tool_definitions");
  const geminiOutputs = stageValue(record, "gemini_outputs");
  const criticOutput = stageValue(record, "deepseek_output");
  const providerMetadata = stageValue(record, "provider_metadata");
  const decisionContext = stageValue(record, "decision_context");
  const evidence = stageValue(record, "evidence");
  const supplementalContext = stageValue(record, "supplemental_context");
  if (!Array.isArray(modelMessages) || !modelMessages.length) return { ok: false, reason: "decision_audit_model_messages_missing" };
  if (!Array.isArray(dynamicTools) || !dynamicTools.length) return { ok: false, reason: "decision_audit_tool_definitions_missing" };
  if (!Array.isArray(geminiOutputs) || !geminiOutputs.length) return { ok: false, reason: "decision_audit_gemini_outputs_missing" };
  if (!providerMetadata || typeof providerMetadata !== "object" || Array.isArray(providerMetadata)
    || !decisionContext || typeof decisionContext !== "object" || Array.isArray(decisionContext)
    || !evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { ok: false, reason: "decision_audit_execution_facts_missing" };
  }

  const primaryCalls = Array.isArray(providerMetadata.primary) ? providerMetadata.primary : [];
  const callCount = primaryCalls.length;
  if (!callCount || modelMessages.length !== callCount || dynamicTools.length !== callCount || geminiOutputs.length !== callCount) {
    return { ok: false, reason: "decision_audit_primary_call_count_mismatch" };
  }
  for (let index = 0; index < primaryCalls.length; index += 1) {
    const violation = primaryCallConstraintViolation(primaryCalls[index]);
    if (violation) return { ok: false, reason: `decision_audit_primary_call_invalid:${index}:${violation}` };
    if (!Array.isArray(modelMessages[index])) return { ok: false, reason: `decision_audit_model_messages_invalid:${index}` };
    if (!Array.isArray(dynamicTools[index])) return { ok: false, reason: `decision_audit_tool_definitions_invalid:${index}` };
    if (geminiOutputs[index] === undefined || geminiOutputs[index] === null) return { ok: false, reason: `decision_audit_gemini_output_invalid:${index}` };
  }
  const auditedPrimary = primaryCalls.at(-1);
  const auditedCriticMetadata = providerMetadata.critic;
  const auditedCriticResult = criticOutput?.normalized;
  if (!auditedPrimary) return { ok: false, reason: "decision_audit_primary_attribution_missing" };
  if (!auditedCriticMetadata || !auditedCriticResult) return { ok: false, reason: "decision_audit_critic_attribution_missing" };

  const auditedCritic = { ...auditedCriticMetadata, ...auditedCriticResult };
  if (!sameValue(pick(auditedPrimary, PRIMARY_ATTRIBUTION_FIELDS), pick(provenance?.primary, PRIMARY_ATTRIBUTION_FIELDS))) {
    return { ok: false, reason: "decision_audit_primary_attribution_mismatch" };
  }
  if (!sameValue(pick(auditedCritic, CRITIC_ATTRIBUTION_FIELDS), pick(provenance?.critic, CRITIC_ATTRIBUTION_FIELDS))) {
    return { ok: false, reason: "decision_audit_critic_attribution_mismatch" };
  }

  const systemPrompts = modelMessages.map((messages) => Array.isArray(messages)
    ? messages.find((message) => message?.role === "system")?.content
    : null);
  if (systemPrompts.some((prompt) => typeof prompt !== "string")) return { ok: false, reason: "decision_audit_system_prompt_missing" };
  const promptHashes = new Set(systemPrompts.map((prompt) => promptFingerprint(prompt)));
  if (promptHashes.size !== 1 || !sameValue(decisionContext.prompt, provenance?.prompt)
    || decisionContext.prompt?.hash !== [...promptHashes][0]) {
    return { ok: false, reason: "decision_audit_prompt_mismatch" };
  }

  const dynamicToolHash = promptFingerprint(JSON.stringify(dynamicTools));
  if (!sameValue(decisionContext.toolSchema, provenance?.toolSchema)
    || decisionContext.toolSchema?.hash !== dynamicToolHash) {
    return { ok: false, reason: "decision_audit_tool_schema_mismatch" };
  }
  if (!sameValue(evidence, provenance?.evidence)) return { ok: false, reason: "decision_audit_evidence_mismatch" };
  if (supplementalContext != null && !sameValue(supplementalContext, provenance?.supplementalContext)) {
    return { ok: false, reason: "decision_audit_supplemental_context_mismatch" };
  }
  if (!sameValue(decisionContext.cohort, provenance?.cohort)) return { ok: false, reason: "decision_audit_cohort_mismatch" };
  if (!sameValue(decisionContext.routingPolicy, provenance?.routingPolicy)) return { ok: false, reason: "decision_audit_routing_policy_mismatch" };
  return {
    ok: true,
    facts: {
      primary: auditedPrimary,
      critic: auditedCritic,
      prompt: decisionContext.prompt,
      toolSchema: decisionContext.toolSchema,
      evidence,
      supplementalContext: supplementalContext ?? null,
      cohort: decisionContext.cohort,
      routingPolicy: decisionContext.routingPolicy
    }
  };
}
