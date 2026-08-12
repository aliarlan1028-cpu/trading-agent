const clamp = (value, low = 0, high = 100) => Math.max(low, Math.min(high, value));

function trend(frame) {
  return frame?.trend?.direction || "unknown";
}

function coverage(view) {
  return [view?.context, view?.structure, view?.confirmation].filter((frame) => frame?.available).length;
}

function scoreDayTrader(view, market = {}) {
  let score = coverage(view) * 10;
  const reasons = [`周期覆盖 ${coverage(view)}/3（1H/15m/5m）`];
  const context = trend(view?.context);
  const structure = trend(view?.structure);
  const confirmation = trend(view?.confirmation);
  if (["up", "down"].includes(structure)) { score += 16; reasons.push("15m 结构方向明确"); }
  else reasons.push("15m 仍为区间或证据不足");
  if (["up", "down"].includes(context) && context === structure) { score += 14; reasons.push("1H 与15m同向"); }
  else if (["up", "down"].includes(context) && ["up", "down"].includes(structure) && context !== structure) { score -= 10; reasons.push("1H 与15m冲突"); }
  if (["up", "down"].includes(confirmation) && confirmation === structure) { score += 12; reasons.push("5m 已出现同向确认"); }
  const volRatio = Number(view?.structure?.regime?.volatilityRatio);
  if (Number.isFinite(volRatio) && volRatio >= 0.65 && volRatio <= 3) { score += 10; reasons.push("15m 波动足以支持日内执行"); }
  else if (Number.isFinite(volRatio) && volRatio < 0.45) { score -= 8; reasons.push("15m 波动收缩，日内空间不足"); }
  const spread = Number(market.spreadBps);
  if (Number.isFinite(spread) && spread <= 3) { score += 8; reasons.push("点差适合短周期执行"); }
  else if (Number.isFinite(spread) && spread > 8) { score -= 15; reasons.push("点差过宽，不适合日内频繁进出"); }
  return { role: "day_trader", score: clamp(Math.round(score)), reasons };
}

function scoreSwingTrader(view, market = {}) {
  let score = coverage(view) * 10;
  const reasons = [`周期覆盖 ${coverage(view)}/3（1D/4H/1H）`];
  const context = trend(view?.context);
  const structure = trend(view?.structure);
  const confirmation = trend(view?.confirmation);
  if (["up", "down"].includes(context)) { score += 14; reasons.push("1D 环境方向明确"); }
  else reasons.push("1D 环境仍为区间或证据不足");
  if (["up", "down"].includes(structure)) { score += 16; reasons.push("4H 结构方向明确"); }
  if (["up", "down"].includes(context) && context === structure) { score += 16; reasons.push("1D 与4H同向"); }
  else if (["up", "down"].includes(context) && ["up", "down"].includes(structure) && context !== structure) { score -= 12; reasons.push("1D 与4H冲突"); }
  if (["up", "down"].includes(confirmation) && confirmation === structure) { score += 8; reasons.push("1H 支持波段方向"); }
  const efficiency = Number(view?.structure?.regime?.directionalEfficiency);
  if (Number.isFinite(efficiency) && efficiency >= 0.25) { score += 10; reasons.push("4H 方向效率支持跨日持有"); }
  if (view?.context?.regime?.transition?.type === "direction_reversal") { score -= 10; reasons.push("1D 正处于方向切换期"); }
  const funding = Math.abs(Number(market.fundingRatePct ?? market.fundingRate));
  if (Number.isFinite(funding) && funding >= 0.05) { score -= 5; reasons.push("资金费率拥挤，波段持有成本/挤压风险上升"); }
  return { role: "swing_trader", score: clamp(Math.round(score)), reasons };
}

export function scoreRoleSuitability(roleViews = {}, market = {}) {
  const day = scoreDayTrader(roleViews.day_trader, market);
  const swing = scoreSwingTrader(roleViews.swing_trader, market);
  const enoughDay = coverage(roleViews.day_trader) === 3;
  const enoughSwing = coverage(roleViews.swing_trader) === 3;
  let recommendation = "insufficient";
  if (enoughDay && enoughSwing) {
    recommendation = Math.abs(day.score - swing.score) < 8
      ? "both"
      : day.score > swing.score ? "day_trader" : "swing_trader";
  } else if (enoughDay) recommendation = "day_trader";
  else if (enoughSwing) recommendation = "swing_trader";
  return {
    version: 1,
    mode: "shadow",
    controlsExecution: false,
    recommendation,
    scores: { day_trader: day, swing_trader: swing },
    guardrail: "角色适配只比较机会持续时间与周期证据，不决定多空，也不修改风险或执行权限。"
  };
}
