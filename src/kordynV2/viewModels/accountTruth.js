import {
  hasJsonResponseProvenance,
  jsonResponseArrayValues
} from "../../jsonResponseProvenance.js";
import { buildPositionView } from "../../viewData.js";

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
const EFFECTIVE_RUNTIME_MODES = new Set([
  "halted",
  "reduce_only",
  "paused",
  "analysis_blocked",
  "blocked",
  "live_blocked",
  "full_auto_small",
  "semi_auto",
  "observe"
]);
const REQUESTED_RUNTIME_MODES = new Set(["full_auto", "semi_auto", "observe"]);

const missingRead = () => ({ kind: "missing", value: undefined });
const invalidRead = () => ({ kind: "invalid", value: undefined });
const valueRead = (value) => ({ kind: "value", value });

function responseValue(record, field) {
  if (!responseRecord(record)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function ownDataRead(record, field) {
  if (!responseRecord(record)) return invalidRead();
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  if (!descriptor) return missingRead();
  return Object.hasOwn(descriptor, "value") ? valueRead(descriptor.value) : invalidRead();
}

function nestedRecordRead(record, field) {
  const read = ownDataRead(record, field);
  if (read.kind !== "value" || read.value === null || read.value === undefined) {
    return read.kind === "invalid" ? read : missingRead();
  }
  return responseRecord(read.value) ? read : invalidRead();
}

function optionalStringRead(record, field, supportedValues = null) {
  const read = ownDataRead(record, field);
  if (read.kind !== "value" || read.value === null || read.value === "") {
    return read.kind === "invalid" ? read : missingRead();
  }
  if (typeof read.value !== "string" || (supportedValues && !supportedValues.has(read.value))) {
    return invalidRead();
  }
  return read;
}

function optionalBooleanRead(record, field) {
  const read = ownDataRead(record, field);
  if (read.kind !== "value" || read.value === null || read.value === undefined) {
    return read.kind === "invalid" ? read : missingRead();
  }
  return typeof read.value === "boolean" ? read : invalidRead();
}

function optionalTimestampRead(record, field) {
  const read = optionalStringRead(record, field);
  if (read.kind !== "value") return read;
  const timestamp = Date.parse(read.value);
  return Number.isFinite(timestamp) ? { ...read, timestamp } : invalidRead();
}

function readIsInvalid(...reads) {
  return reads.some((read) => read.kind === "invalid");
}

function unavailableAccountTruth(mode) {
  return Object.freeze({
    mode,
    equity: unavailable,
    available: unavailable,
    exposure: unavailable,
    freshness: unavailable,
    freshnessState: unavailable,
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

function freshnessFact(data, portfolioRead) {
  if (portfolioRead.kind === "invalid") return unavailable;
  if (portfolioRead.kind === "value") {
    const marginSyncedAt = optionalTimestampRead(portfolioRead.value, "marginSyncedAt");
    if (marginSyncedAt.kind === "invalid") return unavailable;
    if (marginSyncedAt.kind === "value") return marginSyncedAt.value;
  }

  const snapshotsRead = ownDataRead(data, "accountSnapshots");
  if (snapshotsRead.kind === "invalid") return unavailable;
  if (snapshotsRead.kind !== "value" || snapshotsRead.value === null) return unavailable;
  const snapshots = jsonResponseArrayValues(snapshotsRead.value);
  if (!snapshots) return unavailable;

  let latestTimestamp = Number.NEGATIVE_INFINITY;
  let latestValue = unavailable;
  for (const snapshot of snapshots) {
    if (!responseRecord(snapshot)) return unavailable;
    const status = optionalStringRead(snapshot, "status");
    if (status.kind === "invalid") return unavailable;
    if (status.kind !== "value" || status.value !== "ok") continue;
    const createdAt = optionalTimestampRead(snapshot, "createdAt");
    if (createdAt.kind !== "value") return unavailable;
    if (createdAt.timestamp > latestTimestamp) {
      latestTimestamp = createdAt.timestamp;
      latestValue = createdAt.value;
    }
  }
  return latestValue;
}

function freshnessStateFact(systemRead, marketStatusRead) {
  if (readIsInvalid(systemRead, marketStatusRead)) return unavailable;
  const systemState = systemRead.kind === "value"
    ? optionalStringRead(systemRead.value, "dataFreshnessState")
    : missingRead();
  const marketState = marketStatusRead.kind === "value"
    ? optionalStringRead(marketStatusRead.value, "dataFreshnessState")
    : missingRead();
  const systemStale = systemRead.kind === "value"
    ? optionalBooleanRead(systemRead.value, "dataStale")
    : missingRead();
  const marketStale = marketStatusRead.kind === "value"
    ? optionalBooleanRead(marketStatusRead.value, "dataStale")
    : missingRead();
  if (readIsInvalid(systemState, marketState, systemStale, marketStale)) return unavailable;
  if (systemState.kind === "value") return systemState.value;
  if (marketState.kind === "value") return marketState.value;
  if (systemStale.kind === "value") return systemStale.value ? "stale" : "fresh";
  if (marketStale.kind === "value") return marketStale.value ? "stale" : "fresh";
  return unavailable;
}

function validBlockerDetails(automation) {
  const detailsRead = ownDataRead(automation, "blockerDetails");
  if (detailsRead.kind === "invalid") return false;
  if (detailsRead.kind === "value" && detailsRead.value !== null) {
    const details = jsonResponseArrayValues(detailsRead.value);
    if (!details) return false;
    for (const detail of details) {
      if (!responseRecord(detail)) return false;
      const label = optionalStringRead(detail, "label");
      if (label.kind === "invalid") return false;
    }
  }

  const blockersRead = ownDataRead(automation, "blockers");
  if (blockersRead.kind === "invalid") return false;
  if (blockersRead.kind === "value" && blockersRead.value !== null) {
    const blockers = jsonResponseArrayValues(blockersRead.value);
    if (!blockers || blockers.some((blocker) => typeof blocker !== "string" || blocker === "")) return false;
  }
  return true;
}

function runtimeFact(automationRead, systemRead) {
  if (readIsInvalid(automationRead, systemRead)) return unavailable;
  if (automationRead.kind !== "value" && systemRead.kind !== "value") return unavailable;

  const automation = automationRead.value;
  const system = systemRead.value;
  const mode = automationRead.kind === "value"
    ? optionalStringRead(automation, "mode", EFFECTIVE_RUNTIME_MODES)
    : missingRead();
  const requestedMode = automationRead.kind === "value"
    ? optionalStringRead(automation, "requestedMode", REQUESTED_RUNTIME_MODES)
    : missingRead();
  const label = automationRead.kind === "value"
    ? optionalStringRead(automation, "label")
    : missingRead();
  const killSwitch = systemRead.kind === "value"
    ? optionalBooleanRead(system, "killSwitch")
    : missingRead();
  const reduceOnlyMode = systemRead.kind === "value"
    ? optionalBooleanRead(system, "reduceOnlyMode")
    : missingRead();
  const autonomyEnabled = systemRead.kind === "value"
    ? optionalBooleanRead(system, "autonomyEnabled")
    : missingRead();
  const liveTradingEnabled = systemRead.kind === "value"
    ? optionalBooleanRead(system, "liveTradingEnabled")
    : missingRead();
  const requestedOperatingMode = systemRead.kind === "value"
    ? optionalStringRead(system, "requestedOperatingMode", REQUESTED_RUNTIME_MODES)
    : missingRead();

  if (
    readIsInvalid(
      mode,
      requestedMode,
      label,
      killSwitch,
      reduceOnlyMode,
      autonomyEnabled,
      liveTradingEnabled,
      requestedOperatingMode
    )
    || (automationRead.kind === "value" && !validBlockerDetails(automation))
  ) {
    return unavailable;
  }

  const hasRuntimeSource = automationRead.kind === "value" || [
    killSwitch,
    reduceOnlyMode,
    autonomyEnabled,
    liveTradingEnabled,
    requestedOperatingMode
  ].some((read) => read.kind === "value");
  if (!hasRuntimeSource) return unavailable;

  const fallbackMode = killSwitch.value === true
    ? "halted"
    : reduceOnlyMode.value === true
      ? "reduce_only"
      : autonomyEnabled.value === false
        ? "paused"
        : liveTradingEnabled.value === true
          ? "semi_auto"
          : "observe";
  const effectiveMode = killSwitch.value === true
    ? "halted"
    : mode.kind === "value"
      ? mode.value
      : fallbackMode;
  const targetMode = requestedMode.kind === "value"
    ? requestedMode.value
    : requestedOperatingMode.kind === "value"
      ? requestedOperatingMode.value
      : effectiveMode === "full_auto_small"
        ? "full_auto"
        : effectiveMode === "semi_auto"
          ? "semi_auto"
          : "observe";
  const effectiveForTarget = {
    full_auto: "full_auto_small",
    semi_auto: "semi_auto",
    observe: "observe"
  }[targetMode];
  return effectiveMode === effectiveForTarget
    ? effectiveMode
    : `${effectiveMode} · requested ${targetMode}`;
}

function riskFact(systemRead, currentRiskSnapshotRead, portfolioRiskRead) {
  if (readIsInvalid(systemRead, currentRiskSnapshotRead, portfolioRiskRead)) return unavailable;

  let controlsRead = missingRead();
  if (currentRiskSnapshotRead.kind === "value") {
    controlsRead = nestedRecordRead(currentRiskSnapshotRead.value, "controls");
  }
  if (controlsRead.kind === "invalid") return unavailable;

  const controls = controlsRead.value;
  const system = systemRead.value;
  const portfolioRisk = portfolioRiskRead.value;
  const controlKillSwitch = controlsRead.kind === "value"
    ? optionalBooleanRead(controls, "killSwitch")
    : missingRead();
  const controlReduceOnly = controlsRead.kind === "value"
    ? optionalBooleanRead(controls, "reduceOnly")
    : missingRead();
  const controlStatus = controlsRead.kind === "value"
    ? optionalStringRead(controls, "riskStatus")
    : missingRead();
  const systemKillSwitch = systemRead.kind === "value"
    ? optionalBooleanRead(system, "killSwitch")
    : missingRead();
  const systemReduceOnly = systemRead.kind === "value"
    ? optionalBooleanRead(system, "reduceOnlyMode")
    : missingRead();
  const systemStatus = systemRead.kind === "value"
    ? optionalStringRead(system, "riskStatus")
    : missingRead();
  const portfolioStatus = portfolioRiskRead.kind === "value"
    ? optionalStringRead(portfolioRisk, "status")
    : missingRead();

  if (readIsInvalid(
    controlKillSwitch,
    controlReduceOnly,
    controlStatus,
    systemKillSwitch,
    systemReduceOnly,
    systemStatus,
    portfolioStatus
  )) {
    return unavailable;
  }

  if (controlKillSwitch.value === true || systemKillSwitch.value === true) {
    return fact(controlStatus.value, systemStatus.value, "kill_switch");
  }
  if (controlReduceOnly.value === true || systemReduceOnly.value === true) {
    return fact(controlStatus.value, systemStatus.value, "reduce_only");
  }
  return fact(controlStatus.value, systemStatus.value, portfolioStatus.value);
}

export function buildAccountTruth(data = {}, mode = "full") {
  if (!hasJsonResponseProvenance(data)) return unavailableAccountTruth(mode);
  const portfolio = nestedRecordRead(data, "portfolio");
  const risk = nestedRecordRead(data, "portfolioRisk");
  const automation = nestedRecordRead(data, "automationState");
  const system = nestedRecordRead(data, "system");
  const marketStatus = nestedRecordRead(data, "marketStatus");
  const currentRiskSnapshot = nestedRecordRead(data, "currentRiskSnapshot");
  return Object.freeze({
    mode,
    equity: financialFact(responseValue(portfolio.value, "totalEquityUsdt")),
    available: financialFact(responseValue(portfolio.value, "availableMarginUsdt")),
    exposure: exposureFact(data),
    freshness: freshnessFact(data, portfolio),
    freshnessState: freshnessStateFact(system, marketStatus),
    runtime: runtimeFact(automation, system),
    risk: riskFact(system, currentRiskSnapshot, risk)
  });
}
