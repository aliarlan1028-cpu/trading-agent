const PROVENANCE_LABELS = Object.freeze({
  "system-native": "System native",
  imported: "Imported",
  "knowledge-derived": "Knowledge derived",
  unknown: "Unavailable"
});
const ALLOWED_KINDS = new Set(Object.keys(PROVENANCE_LABELS));

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value, maxLength = 500) {
  return typeof value === "string" && value.trim() && value.length <= maxLength
    ? value.trim()
    : null;
}

function explicitKind(row) {
  const provenance = record(row?.provenance);
  const kind = text(provenance?.kind, 80);
  return ALLOWED_KINDS.has(kind) ? kind : null;
}

function classifiedKind(row, preferredKind) {
  if (ALLOWED_KINDS.has(preferredKind)) return preferredKind;
  const explicit = explicitKind(row);
  if (explicit) return explicit;
  if (!row) return "unknown";

  const recordType = text(row.recordType, 80)?.toLowerCase();
  const origin = [row.origin, row.source, row.createdBy, row.provider, row.kind, row.type]
    .map((value) => text(value, 300)?.toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (
    row.knowledgeWorkflow === true
    || text(row.methodId, 240)
    || text(row.sourceMethodId, 240)
    || /knowledge|distill|蒸馏|知识/u.test(origin)
  ) return "knowledge-derived";

  if (
    row.native === true
    || ["product", "research"].includes(recordType)
    || row.connector === true
    || /official|system|native|系统|官方/u.test(origin)
  ) return "system-native";

  if (
    row.imported === true
    || /imported|uploaded|github|clawhub|external|导入|上传/u.test(origin)
  ) return "imported";

  return "unknown";
}

export function assetProvenance(value, preferredKind = null) {
  const row = record(value);
  const provenance = record(row?.provenance);
  const kind = classifiedKind(row, preferredKind);
  const source = record(row?.source);
  return {
    kind,
    label: PROVENANCE_LABELS[kind],
    sourceId: text(provenance?.sourceId, 240)
      || text(row?.sourceId, 240)
      || text(row?.knowledgeSourceId, 240)
      || text(source?.id, 240),
    sourceTitle: text(provenance?.sourceTitle, 500)
      || text(row?.sourceTitle, 500)
      || text(source?.title, 500)
      || text(source?.name, 500),
    methodId: text(provenance?.methodId, 240)
      || text(row?.methodId, 240)
      || text(row?.sourceMethodId, 240)
  };
}

export const ASSET_PROVENANCE_KINDS = Object.freeze([...ALLOWED_KINDS]);
