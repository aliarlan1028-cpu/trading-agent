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
const DIRECT_POSITION_FIELDS = ["notional", "notionalUsdt", "marketValue"];
const QUANTITY_POSITION_FIELDS = ["quantity", "size", "pos", "qty"];
const MARK_POSITION_FIELDS = ["markPrice", "mark", "price", "entryPrice", "entry"];

// Node exposes a trap-free Proxy brand check. Browser ECMAScript has no
// equivalent, so browser bundles fall back to the non-coercive checks below.
const intrinsicIsProxy = (() => {
  try {
    const getBuiltinModule = globalThis.process?.getBuiltinModule;
    if (typeof getBuiltinModule !== "function") return null;
    const isProxy = globalThis.process.getBuiltinModule("node:util")?.types?.isProxy;
    return typeof isProxy === "function" ? isProxy : null;
  } catch {
    return null;
  }
})();

function ownFinitePositionValue(position, fields) {
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(position, field);
    if (!descriptor) continue;
    if (!Object.hasOwn(descriptor, "value")) return { valid: false };
    if (descriptor.value === null || descriptor.value === undefined) continue;
    if (!finiteNumber(descriptor.value)) return { valid: false };
    return { valid: true, found: true, value: descriptor.value };
  }
  return { valid: true, found: false, value: undefined };
}

function normalizedExposurePosition(position) {
  if (!position || typeof position !== "object" || Array.isArray(position)) return null;
  try {
    if (intrinsicIsProxy?.(position)) return null;
    const prototype = Object.getPrototypeOf(position);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const direct = ownFinitePositionValue(position, DIRECT_POSITION_FIELDS);
    const quantity = ownFinitePositionValue(position, QUANTITY_POSITION_FIELDS);
    const mark = ownFinitePositionValue(position, MARK_POSITION_FIELDS);
    if (!direct.valid || !quantity.valid || !mark.valid) return null;
    if (direct.found) {
      return { notional: direct.value };
    }
    if (!quantity.found || !mark.found) return null;
    return { quantity: quantity.value, mark: mark.value };
  } catch {
    return null;
  }
}

function exposureFact(data) {
  if (!Array.isArray(data.positions)) return unavailable;
  const positions = data.positions.map(normalizedExposurePosition);
  if (positions.some((position) => position === null)) return unavailable;
  const positionView = buildPositionView({ positions });
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
