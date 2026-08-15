export function finiteFinancialNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

// OKX 原始 fee 的符号是：负数=平台扣费，正数=返佣。
// 系统持久化统一使用 fee cost：正数=成本，负数=返佣。
export function okxFeeCost(rawFee) {
  return finiteFinancialNumber(rawFee) ? -Number(rawFee) : null;
}

export function recordedFeeCost(row = {}) {
  if (finiteFinancialNumber(row.feeCostUsdt)) return Number(row.feeCostUsdt);
  if (Number(row.feeSchemaVersion) >= 2 && finiteFinancialNumber(row.feeUsdt)) return Number(row.feeUsdt);
  if (String(row.feeSource || "").startsWith("okx_raw") && finiteFinancialNumber(row.rawFee)) return okxFeeCost(row.rawFee);
  // schema v1 的 feeUsdt 在本系统中已定义为正成本；没有明确来源时保留旧语义，
  // 不把历史值猜成 OKX 原始负号。
  return finiteFinancialNumber(row.feeUsdt) ? Number(row.feeUsdt) : null;
}
