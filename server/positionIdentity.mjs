export function canonicalSymbol(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/-SWAP$/, "");
  if (raw.includes("/")) return raw;
  if (raw.includes("-")) return raw.replace("-", "/");
  return raw.endsWith("USDT") ? `${raw.slice(0, -4)}/USDT` : raw;
}

export function canonicalPositionDirection(positionOrValue = {}, signedSize = null) {
  const position = positionOrValue && typeof positionOrValue === "object" ? positionOrValue : {};
  const raw = positionOrValue && typeof positionOrValue === "object"
    ? position.posSide ?? position.direction ?? position.positionSide ?? position.side
    : positionOrValue;
  const normalized = String(raw || "").trim().toLowerCase();
  if (["short", "sell", "空"].includes(normalized)) return "short";
  if (["long", "buy", "多"].includes(normalized)) return "long";
  const signed = Number(signedSize ?? position.pos ?? position.positionAmt ?? position.signedSize);
  if (Number.isFinite(signed) && signed !== 0) return signed < 0 ? "short" : "long";
  return null;
}

export function canonicalPositionKey(position = {}) {
  const symbol = canonicalSymbol(position.symbol || position.instId);
  const direction = canonicalPositionDirection(position);
  return symbol && direction ? `${symbol}|${direction}` : null;
}
