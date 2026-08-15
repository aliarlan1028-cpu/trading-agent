import crypto from "node:crypto";

const LENS_POLICY_TEXT = Object.freeze({
  require_deterministic_structure: "提出计划前必须取得同交易对、同周期角色的确定性结构证据。",
  require_fresh_evidence: "行情、微观结构、合约规格和账户事实任一不新鲜时不得提出或执行计划。",
  enforce_stop_invalidation: "止损必须位于明确的结构失效位，失效后不得为原判断寻找理由。",
  avoid_chasing_extremes: "价格位于区间极端且盈亏比不足时不得追涨杀跌，应等待结构化回踩或反抽条件。",
  reduce_size_on_conflict: "多源证据冲突但硬条件仍成立时只能降低风险，不得放大仓位。",
  respect_event_blackout: "重大事件静默窗口内禁止新增风险敞口，事件后须刷新事实再评估。",
  preserve_rr: "扣除费用与滑点后的预期盈亏比不足授权阈值时不得提交计划。",
  require_oos_validation: "方向型方法必须经过自动测试、样本外验证和人工批准后才可影响实盘。"
});
const WORKFLOW_STEP_TEXT = Object.freeze({
  sync_facts: "刷新目标交易对的价格与证据包",
  assess_regime: "判断大盘与交易对市场状态",
  analyze_structure: "完成角色对应的多周期确定性结构分析",
  inspect_microstructure: "核对资金费率、盘口与流动性",
  check_event_risk: "核对重大事件与消息证据质量",
  validate_rr: "验证止损、目标和净盈亏比",
  risk_gate: "运行账户、授权和硬风控检查",
  propose_plan: "仅在前述事实均通过后提交结构化计划"
});

export function normalizePromptPolicy(kind, payload = {}) {
  if (kind === "lens") return Object.hasOwn(LENS_POLICY_TEXT, payload.policyCode) ? { policyCode: payload.policyCode } : null;
  if (kind === "workflow") {
    const codes = [...new Set((Array.isArray(payload.stepCodes) ? payload.stepCodes : []).filter((code) => Object.hasOwn(WORKFLOW_STEP_TEXT, code)))].slice(0, 8);
    return codes.length ? { stepCodes: codes } : null;
  }
  return null;
}

export function promptArtifactSystemText(kind, item = {}) {
  if (kind === "lens" && item.doctrine === true) return String(item.promptText || "");
  if (kind === "lens") return LENS_POLICY_TEXT[item.structuredPolicy?.policyCode] || "";
  if (kind === "workflow") return (item.structuredPolicy?.stepCodes || []).map((code) => WORKFLOW_STEP_TEXT[code]).filter(Boolean).join(" → ");
  return "";
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function sha(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function promptArtifactFingerprint(kind, item = {}) {
  if (kind === "lens") return sha({ kind, name: item.name || "", structuredPolicy: item.structuredPolicy || null, sourceTitle: item.sourceTitle || "", sourceRef: item.sourceRef || "" });
  if (kind === "workflow") return sha({ kind, name: item.name || "", structuredPolicy: item.structuredPolicy || null, sourceTitle: item.sourceTitle || "", sourceRef: item.sourceRef || "" });
  if (kind === "memory") return sha({ kind, layer: item.layer || "", title: item.title || "", content: item.content || "", tags: Array.isArray(item.tags) ? item.tags : [] });
  if (kind === "knowledge_chunk") return sha({
    kind,
    id: item.id || "",
    tenantId: item.tenantId || "tenant_owner",
    sourceId: item.sourceId || "",
    text: item.text || ""
  });
  return sha({ kind, item });
}

export function approvedPromptArtifact(kind, item = {}) {
  if (kind === "lens" && item.doctrine === true) return item.active === true;
  if (kind === "memory") return false;
  if (!promptArtifactSystemText(kind, item)) return false;
  const current = promptArtifactFingerprint(kind, item);
  return item.active === true
    && item.promptApproval?.status === "approved"
    && item.promptApproval?.fingerprint === current
    && item.contentFingerprint === current;
}

function stateFilePromptFingerprint(name, item = {}) {
  return sha({
    kind: "agent_state_file",
    name: String(name || "").toUpperCase(),
    tenantId: item.tenantId || "tenant_owner",
    content: String(item.content || "")
  });
}

// USER.md / AGENT.md are system-prompt authority, not ordinary memory. Editing
// creates a sealed approval candidate; it does not become active merely because
// text was persisted. This also makes every legacy, unsealed file fail closed.
export function markStateFilePromptDraft(name, item, options = {}) {
  const key = String(name || "").toUpperCase();
  if (!["USER", "AGENT"].includes(key)) return item;
  const fingerprint = stateFilePromptFingerprint(key, item);
  item.promptTrust = "awaiting_independent_approval";
  item.mayEnterSystemPrompt = false;
  item.contentFingerprint = fingerprint;
  item.promptApproval = {
    status: "awaiting_approval",
    requestedFingerprint: fingerprint,
    fingerprint: null,
    requestedAt: new Date().toISOString(),
    requestedBy: options.actor || "Admin",
    requestedByUserId: options.userId || null,
    contentOrigin: "admin_state_editor"
  };
  return item;
}

export function approveStateFilePromptArtifact(name, item, options = {}) {
  const key = String(name || "").toUpperCase();
  if (!["USER", "AGENT"].includes(key)) throw new Error("Only USER.md and AGENT.md are prompt-authority artifacts");
  if (item?.promptApproval?.status !== "awaiting_approval" || item.promptApproval.contentOrigin !== "admin_state_editor") {
    throw new Error("State file has no independently approvable draft");
  }
  const fingerprint = stateFilePromptFingerprint(key, item);
  if (item.promptApproval.requestedFingerprint !== fingerprint || item.contentFingerprint !== fingerprint) {
    throw new Error("State file changed after approval was requested");
  }
  item.promptTrust = "approved_prompt_authority";
  item.mayEnterSystemPrompt = true;
  item.promptApproval = {
    ...item.promptApproval,
    status: "approved",
    fingerprint,
    approvedAt: new Date().toISOString(),
    approvedBy: options.actor || "KnowledgeApprover",
    approvedByUserId: options.userId || null
  };
  return item;
}

export function approvedStateFilePromptArtifact(name, item = {}) {
  const key = String(name || "").toUpperCase();
  if (!["USER", "AGENT"].includes(key)) return false;
  const fingerprint = stateFilePromptFingerprint(key, item);
  return item.promptTrust === "approved_prompt_authority"
    && item.mayEnterSystemPrompt === true
    && item.promptApproval?.status === "approved"
    && item.promptApproval?.fingerprint === fingerprint
    && item.contentFingerprint === fingerprint;
}

export function approvedKnowledgeChunk(item = {}) {
  const current = promptArtifactFingerprint("knowledge_chunk", item);
  return item.promptUse === true
    && item.contentApproval?.status === "approved"
    && item.contentApproval?.fingerprint === current
    && item.contentFingerprint === current;
}

export function markPromptArtifactDraft(kind, item) {
  const fingerprint = promptArtifactFingerprint(kind, item);
  item.active = false;
  item.contentFingerprint = fingerprint;
  item.promptApproval = { status: "awaiting_approval", fingerprint: null, requestedFingerprint: fingerprint, requestedAt: new Date().toISOString() };
  return item;
}

export function approvePromptArtifact(kind, item, actor = "KnowledgeApprover") {
  if (kind === "memory" || !promptArtifactSystemText(kind, item)) throw new Error("Only a supported structured prompt policy can be approved");
  const fingerprint = promptArtifactFingerprint(kind, item);
  item.contentFingerprint = fingerprint;
  item.promptApproval = { status: "approved", fingerprint, requestedFingerprint: fingerprint, approvedAt: new Date().toISOString(), approvedBy: actor };
  item.active = true;
  return item;
}
