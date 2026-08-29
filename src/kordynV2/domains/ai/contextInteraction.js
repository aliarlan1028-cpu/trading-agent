const text = (value) => typeof value === "string" ? value.trim() : "";

export function canonicalContextAttributes(row, type) {
  const id = text(row?.id);
  const canonicalType = text(type);
  if (row?.selectable !== true || !id || !canonicalType) return {};
  return {
    "data-kordyn-v2-object-id": id,
    "data-kordyn-v2-object-type": canonicalType
  };
}

export function contextPresentationAttributes(row, type) {
  const canonical = canonicalContextAttributes(row, type);
  return Object.keys(canonical).length
    ? canonical
    : { "data-kordyn-v2-readonly-fact": "true" };
}

export function runAiContextRowInteraction({ row, type, onInspect, onSelect, candidateFor }) {
  if (typeof onInspect === "function") onInspect(row);
  const attributes = canonicalContextAttributes(row, type);
  if (!attributes["data-kordyn-v2-object-id"] || typeof candidateFor !== "function") return null;
  const candidate = candidateFor(row);
  if (text(candidate?.id) !== attributes["data-kordyn-v2-object-id"] || text(candidate?.type) !== text(type)) return null;
  if (typeof onSelect === "function") onSelect(candidate);
  return candidate;
}
