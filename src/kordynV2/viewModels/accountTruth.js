import { automationPresentation } from "../../lib.jsx";
import {
  hasJsonResponseProvenance,
  jsonResponseArrayValues,
  projectJsonResponseRecord
} from "../../jsonResponseProvenance.js";
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
const responseRecord = (value) => hasJsonResponseProvenance(value) && !Array.isArray(value);

function responseValue(record, field) {
  if (!responseRecord(record)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function unavailableAccountTruth(mode) {
  return Object.freeze({
    mode,
    equity: unavailable,
    available: unavailable,
    exposure: unavailable,
    freshness: unavailable,
    runtime: unavailable,
    risk: unavailable
  });
}

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
  if (!hasJsonResponseProvenance(position)) return null;
  if (!position || typeof position !== "object" || Array.isArray(position)) return null;
  try {
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
  const sourcePositions = jsonResponseArrayValues(responseValue(data, "positions"));
  if (!sourcePositions) return unavailable;
  const positions = sourcePositions.map(normalizedExposurePosition);
  if (positions.some((position) => position === null)) return unavailable;
  const positionView = buildPositionView({ positions });
  return financialFact(positionView.exposureUsdt);
}

function freshnessFact(data, portfolio) {
  const sourceSnapshots = jsonResponseArrayValues(responseValue(data, "accountSnapshots"));
  const latestSuccessful = sortRecent(
    sourceSnapshots
      ? sourceSnapshots
        .filter((snapshot) => responseRecord(snapshot) && responseValue(snapshot, "status") === "ok")
        .map((snapshot) => projectJsonResponseRecord(snapshot))
      : []
  )[0];
  return fact(responseValue(portfolio, "marginSyncedAt"), responseValue(latestSuccessful, "createdAt"));
}

function runtimeFact(automation, system) {
  const hasRuntimeSource = (automation && typeof automation === "object" && !Array.isArray(automation))
    || (system && typeof system === "object" && !Array.isArray(system) && [
      "killSwitch", "reduceOnlyMode", "autonomyEnabled", "liveTradingEnabled", "requestedOperatingMode"
    ].some((field) => Object.hasOwn(system, field)));
  if (!hasRuntimeSource) return unavailable;
  const presentation = automationPresentation({ automationState: automation, system });
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

function riskFact(system, currentRiskSnapshot, portfolioRisk) {
  const candidateControls = responseValue(currentRiskSnapshot, "controls");
  const controls = responseRecord(candidateControls) ? projectJsonResponseRecord(candidateControls) : null;
  if (controls?.killSwitch === true || system?.killSwitch === true) {
    return fact(controls?.riskStatus, system?.riskStatus, "kill_switch");
  }
  if (controls?.reduceOnly === true || system?.reduceOnlyMode === true) {
    return fact(controls?.riskStatus, system?.riskStatus, "reduce_only");
  }
  return fact(controls?.riskStatus, system?.riskStatus, portfolioRisk?.status);
}

export function buildAccountTruth(data = {}, mode = "full") {
  if (!hasJsonResponseProvenance(data)) return unavailableAccountTruth(mode);
  const portfolioSource = responseValue(data, "portfolio");
  const riskSource = responseValue(data, "portfolioRisk");
  const automationSource = responseValue(data, "automationState");
  const systemSource = responseValue(data, "system");
  const currentRiskSnapshotSource = responseValue(data, "currentRiskSnapshot");
  const portfolio = responseRecord(portfolioSource) ? projectJsonResponseRecord(portfolioSource) : null;
  const risk = responseRecord(riskSource) ? projectJsonResponseRecord(riskSource) : null;
  const automation = responseRecord(automationSource) ? projectJsonResponseRecord(automationSource) : null;
  const system = responseRecord(systemSource) ? projectJsonResponseRecord(systemSource) : null;
  const currentRiskSnapshot = responseRecord(currentRiskSnapshotSource) ? projectJsonResponseRecord(currentRiskSnapshotSource) : null;
  return Object.freeze({
    mode,
    equity: financialFact(responseValue(portfolio, "totalEquityUsdt")),
    available: financialFact(responseValue(portfolio, "availableMarginUsdt")),
    exposure: exposureFact(data),
    freshness: freshnessFact(data, portfolio),
    runtime: runtimeFact(automation, system),
    risk: riskFact(system, currentRiskSnapshot, risk)
  });
}
