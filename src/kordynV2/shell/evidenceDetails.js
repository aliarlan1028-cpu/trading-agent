const unavailable = "Unavailable";
const MAX_DETAIL_ROWS = 12;
const MAX_LABEL_LENGTH = 48;
const MAX_VALUE_LENGTH = 180;

function ownDataValue(container, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(container, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function boundedScalar(value, maximum) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : unavailable;
  if (typeof value !== "string" || !value.trim() || value.length > maximum) return unavailable;
  return value;
}

export function normalizeEvidenceDetails(details) {
  if (!Array.isArray(details)) return Object.freeze([]);
  const length = ownDataValue(details, "length");
  if (!Number.isInteger(length) || length < 0) return Object.freeze([]);
  const normalized = [];
  for (let index = 0; index < Math.min(length, MAX_DETAIL_ROWS); index += 1) {
    const row = ownDataValue(details, String(index));
    if (!Array.isArray(row)) {
      normalized.push(Object.freeze([unavailable, unavailable]));
      continue;
    }
    normalized.push(Object.freeze([
      boundedScalar(ownDataValue(row, "0"), MAX_LABEL_LENGTH),
      boundedScalar(ownDataValue(row, "1"), MAX_VALUE_LENGTH)
    ]));
  }
  return Object.freeze(normalized);
}
