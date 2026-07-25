import { isEventRiskActive } from "./eventRisk.mjs";

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function applyCompiledSignalConstraints(candles, baseSignals, spec = {}) {
  const confirmation = spec.confirmationSpec;
  if (!confirmation || confirmation.type === "none") return baseSignals.slice();
  if (confirmation.type === "volume_above_sma") {
    const period = Math.max(2, Number(confirmation.period || 20));
    return baseSignals.map((signal, index) => {
      if (!signal || index < period) return false;
      const prior = candles.slice(index - period, index).map((bar) => Number(bar.volume)).filter(Number.isFinite);
      const baseline = average(prior);
      return Number.isFinite(baseline) && Number(candles[index]?.volume) > baseline * Number(confirmation.multiplier || 1);
    });
  }
  return baseSignals.map(() => false);
}

export function runtimeInvalidationTriggered(db, skill, symbol) {
  const invalidation = skill?.spec?.invalidationSpec;
  if (!invalidation || invalidation.type === "none") return null;
  if (invalidation.type === "high_impact_event") {
    const threshold = Number(invalidation.minImpact || 80);
    const event = (db.events || []).find((item) =>
      Number(item.impact || 0) >= threshold
      && isEventRiskActive(item)
      && (!item.relatedSymbols?.length || item.relatedSymbols.includes(symbol))
    );
    return event ? { triggered: true, reason: `high_impact_event:${event.id}`, eventId: event.id } : { triggered: false };
  }
  return { triggered: true, reason: "unsupported_invalidation_spec" };
}
