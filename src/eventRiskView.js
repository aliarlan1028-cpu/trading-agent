import { t } from "./i18n.js";

const asList = (value) => Array.isArray(value) ? value : [];

export function eventRiskIdentity(row = {}) {
  return row.id || row.eventId || "";
}

export function eventRiskPhase(row = {}) {
  if (row.phase === "pre_release_blackout" || row.blocking === true) return "blocking";
  if (row.phase === "time_unconfirmed" || row.timePrecision === "date") return "time_unconfirmed";
  if (row.phase === "post_release") return "post_release";
  return "monitoring";
}

export function eventRiskPhaseLabel(row = {}) {
  return {
    blocking: t("公布前静默", "Pre-release blackout"),
    monitoring: t("提前监控", "Monitoring"),
    post_release: t("公布后观察", "Post-release window"),
    time_unconfirmed: t("时间待确认", "Time unconfirmed")
  }[eventRiskPhase(row)];
}

export function eventRiskGateLabel(row = {}) {
  if (row.blocking) return t("阻断新风险", "New risk blocked");
  if (eventRiskPhase(row) === "time_unconfirmed") return t("仅监控 · 不触发分钟硬闸", "Monitor only · no minute gate");
  return t("监控中", "Monitoring");
}

export function eventRiskTimingLabel(row = {}) {
  const phase = eventRiskPhase(row);
  if (phase === "time_unconfirmed") return t("仅日期，不触发分钟级硬闸", "Date only; no minute-level hard gate");
  const delta = Number(row.deltaMs);
  if (!Number.isFinite(delta)) return t("相对时间不可用", "Relative timing unavailable");
  const minutes = Math.round(Math.abs(delta) / 60000);
  if (phase === "post_release") return t(`已公布 ${minutes} 分钟`, `Released ${minutes} min ago`);
  return t(`${minutes} 分钟后`, `In ${minutes} min`);
}

export function eventRiskScopeLabel(row = {}) {
  if (row.marketWide) return t("全市场", "Market-wide");
  const symbols = asList(row.relatedSymbols).filter(Boolean);
  return symbols.length ? symbols.join(" · ") : t("影响范围未提供", "Scope unavailable");
}

export function summarizeEventRiskWindows(value) {
  const windows = asList(value);
  return {
    windows,
    total: windows.length,
    blocking: windows.filter((row) => eventRiskPhase(row) === "blocking").length,
    monitoring: windows.filter((row) => ["monitoring", "post_release"].includes(eventRiskPhase(row))).length,
    timeUnconfirmed: windows.filter((row) => eventRiskPhase(row) === "time_unconfirmed").length
  };
}
