import { nowIso } from "./store.mjs";

export function resolveRiskIncidents(db, predicate, resolution, actor = "RiskLifecycle") {
  const now = nowIso(), resolved = [];
  for (const incident of db.riskIncidents || []) {
    if (incident.status !== "open" || !predicate(incident)) continue;
    Object.assign(incident, { status: "resolved", resolvedAt: now, resolvedBy: actor, resolution });
    resolved.push(incident.id);
  }
  return resolved;
}

export function reconcileRiskIncidentLifecycle(db, options = {}) {
  const prot = options.protections || db.system?.tradeProtections;
  const degradation = options.degradation || db.system?.operationalDegradation;
  const activePositionIds = new Set((db.positions || [])
    .filter((position) => Number(position.size ?? position.pos ?? position.quantity ?? 0) !== 0)
    .map((position) => position.id));
  const plans = new Map((db.tradePlans || []).map((plan) => [plan.id, plan]));
  const terminal = new Set(["completed", "closed", "cancelled", "expired", "rejected", "risk_rejected", "auto_blocked", "dry_run", "failed"]);
  const resolved = [];
  if (prot?.cooldown?.active === false) resolved.push(...resolveRiskIncidents(db, (i) => i.protectionKey === "cooldown", "consecutive_loss_condition_cleared"));
  if (prot?.drawdown?.active === false) resolved.push(...resolveRiskIncidents(db, (i) => i.protectionKey === "drawdown", "drawdown_condition_cleared"));
  if (degradation?.degraded === false) resolved.push(...resolveRiskIncidents(db, (i) => i.source === "professional_risk_gate", "operational_degradation_recovered"));
  if (Number(db.system?.remainingDailyLossUsdt) > 0) resolved.push(...resolveRiskIncidents(db, (i) => i.source === "accounting" && /日亏损预算耗尽/.test(String(i.title)), "daily_loss_budget_available"));
  if (options.snapshot?.rollingSevenDay?.active === false) resolved.push(...resolveRiskIncidents(db, (i) => /近\s*7\s*日|周亏损/.test(String(i.title)), "rolling_seven_day_condition_cleared"));
  if (options.snapshot?.consecutiveLosses?.active === false) resolved.push(...resolveRiskIncidents(db, (i) => i.protectionKey === "cooldown" || /连续亏损|连亏/.test(String(i.title)), "consecutive_loss_condition_cleared"));
  if (options.snapshot?.drawdownProtection?.active === false) resolved.push(...resolveRiskIncidents(db, (i) => i.protectionKey === "drawdown" || /回撤锁仓/.test(String(i.title)), "drawdown_condition_cleared"));
  resolved.push(...resolveRiskIncidents(db, (i) => String(i.source || "").startsWith("pos_") && !activePositionIds.has(i.source), "position_no_longer_open"));
  resolved.push(...resolveRiskIncidents(db, (i) => String(i.source || "").startsWith("plan_") && terminal.has(String(plans.get(i.source)?.status || "")), "trade_plan_terminal"));
  return [...new Set(resolved)];
}
