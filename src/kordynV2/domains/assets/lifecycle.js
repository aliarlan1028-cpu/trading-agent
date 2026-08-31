const STAGE_LABELS = Object.freeze({
  unavailable: "Unavailable",
  candidate: "Candidate",
  adopted: "Adopted draft",
  draft: "Draft",
  processing: "Processing",
  validating: "Validating",
  approved: "Approved",
  published: "Published",
  active: "Active",
  disabled: "Disabled",
  degraded: "Degraded",
  failed: "Failed",
  rejected: "Rejected",
  retired: "Retired"
});

const matches = (status, expression) => expression.test(status);

function text(value) {
  return typeof value === "string" && value.trim() && value.length <= 240
    ? value.trim().toLowerCase()
    : "";
}

function lifecycleStatus(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "";
  const lifecycle = row.lifecycle && typeof row.lifecycle === "object" ? row.lifecycle : null;
  const deployment = row.deployment && typeof row.deployment === "object" ? row.deployment : null;
  return text(lifecycle?.stage) || text(row.status) || text(row.state) || text(deployment?.state);
}

function normalizedStage(status) {
  if (!status) return "unavailable";
  if (matches(status, /compile_failed|parse_failed|failed|failure|error|unsupported|失败|错误/u)) return "failed";
  if (matches(status, /rejected|ignored|ineffective|已拒绝|已忽略/u)) return "rejected";
  if (matches(status, /retired|superseded|archived|已退役|已归档/u)) return "retired";
  if (matches(status, /degraded|blocked|historical_rejected|降级|阻断/u)) return "degraded";
  if (matches(status, /disabled|paused|停用|暂停/u)) return "disabled";
  if (matches(status, /live_probation|validated_active|active|trusted|enabled|ready|connected|available_without_key|已启用|已连接/u)) return "active";
  if (matches(status, /published|released|graduated|已发布/u)) return "published";
  if (matches(status, /approved|verified|已批准|已验证/u)) return "approved";
  if (matches(status, /validating|historical_validated|paper_validating|backtest|testing|validation/u)) return "validating";
  if (matches(status, /processing|parsing|queued|indexing|syncing|处理中|解析中/u)) return "processing";
  if (matches(status, /adopted|accepted|已采纳/u)) return "adopted";
  if (matches(status, /draft|compiled|research|草稿/u)) return "draft";
  if (matches(status, /candidate|pending_owner|evidence_accumulating|pending|候选|待处理/u)) return "candidate";
  return "unavailable";
}

export function assetLifecycle(row) {
  const raw = lifecycleStatus(row);
  const stage = normalizedStage(raw);
  return {
    stage,
    label: STAGE_LABELS[stage],
    raw: raw || null,
    terminal: ["rejected", "retired"].includes(stage),
    actionable: !["unavailable", "processing", "retired"].includes(stage)
  };
}

export const ASSET_LIFECYCLE_STAGES = Object.freeze(Object.keys(STAGE_LABELS));
