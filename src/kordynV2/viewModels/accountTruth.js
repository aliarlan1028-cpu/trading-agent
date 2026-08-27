import { automationPresentation } from "../../lib.jsx";
import { buildPositionView, sortRecent } from "../../viewData.js";

const unavailable = "Unavailable";
const firstKnown = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
const fact = (...values) => firstKnown(...values, unavailable);
const financialFact = (...values) => {
  const value = fact(...values);
  return typeof value === "number" && Number.isFinite(value) ? value : unavailable;
};

const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const positionHasAuthoritativeNotional = (position = {}) => {
  const direct = position.notional ?? position.notionalUsdt ?? position.marketValue;
  if (finiteNumber(direct)) return true;
  const quantity = position.quantity ?? position.size ?? position.pos ?? position.qty;
  if (finiteNumber(quantity) && quantity === 0) return true;
  const mark = position.markPrice ?? position.mark ?? position.price ?? position.entryPrice ?? position.entry;
  return finiteNumber(quantity) && finiteNumber(mark);
};

function exposureFact(data) {
  if (!Array.isArray(data.positions)) return unavailable;
  if (!data.positions.every(positionHasAuthoritativeNotional)) return unavailable;
  const positionView = buildPositionView(data);
  return financialFact(positionView.exposureUsdt);
}

function freshnessFact(data, portfolio) {
  const latestSuccessful = sortRecent(
    Array.isArray(data.accountSnapshots)
      ? data.accountSnapshots.filter((snapshot) => snapshot?.status === "ok")
      : []
  )[0];
  return fact(portfolio.marginSyncedAt, latestSuccessful?.createdAt);
}

function runtimeFact(data) {
  const automation = data.automationState;
  const system = data.system;
  const hasRuntimeSource = (automation && typeof automation === "object" && !Array.isArray(automation))
    || (system && typeof system === "object" && !Array.isArray(system) && [
      "killSwitch", "reduceOnlyMode", "autonomyEnabled", "liveTradingEnabled", "requestedOperatingMode"
    ].some((field) => Object.hasOwn(system, field)));
  if (!hasRuntimeSource) return unavailable;
  const presentation = automationPresentation(data);
  const effectiveMode = system?.killSwitch === true ? "halted" : presentation.mode;
  const effectiveForTarget = {
    full_auto: "full_auto_small",
    semi_auto: "semi_auto",
    observe: "observe"
  }[presentation.targetMode];
  return effectiveMode === effectiveForTarget
    ? effectiveMode
    : `${effectiveMode} · requested ${presentation.targetMode}`;
}

function riskFact(data, portfolioRisk) {
  const controls = data.currentRiskSnapshot?.controls || {};
  if (controls.killSwitch === true || data.system?.killSwitch === true) {
    return fact(controls.riskStatus, data.system?.riskStatus, "kill_switch");
  }
  if (controls.reduceOnly === true || data.system?.reduceOnlyMode === true) {
    return fact(controls.riskStatus, data.system?.riskStatus, "reduce_only");
  }
  return fact(controls.riskStatus, data.system?.riskStatus, portfolioRisk.status);
}

export function buildAccountTruth(data = {}, mode = "full") {
  const portfolio = data.portfolio || {};
  const risk = data.portfolioRisk || {};
  return Object.freeze({
    mode,
    equity: financialFact(portfolio.totalEquityUsdt),
    available: financialFact(portfolio.availableMarginUsdt),
    exposure: exposureFact(data),
    freshness: freshnessFact(data, portfolio),
    runtime: runtimeFact(data),
    risk: riskFact(data, risk)
  });
}
