import { buildControlConfigurationView } from "../../../controlConfigurationView.js";
import { buildOperationsView } from "../../../operationsView.js";
import { buildGovernancePermissions } from "./governancePermissions.js";

const unavailable = "Unavailable";
const list = (value) => Array.isArray(value) ? value : [];
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = (value, fallback = unavailable) => (
  ["string", "number", "boolean"].includes(typeof value) && String(value).trim() ? String(value) : fallback
);

function directBoundary(data, fallback) {
  const system = record(data.system);
  const automation = record(data.automationState);
  const selectedMode = text(
    system.executionMode ?? automation.requestedMode ?? automation.selectedMode ?? fallback.runtime?.requestedMode,
    unavailable
  );
  const effectiveMode = text(
    system.effectiveMode ?? automation.effectiveMode ?? automation.mode ?? fallback.runtime?.mode,
    unavailable
  );
  return {
    selectedMode,
    effectiveMode,
    targetIsEffective: selectedMode !== unavailable && effectiveMode !== unavailable && selectedMode === effectiveMode,
    killSwitch: system.killSwitch === true,
    runtimeStatus: text(automation.runtimeStatus ?? fallback.runtime?.runtimeStatus),
    resumesAutomatically: fallback.runtime?.resumesAutomatically === true,
    blockers: list(fallback.runtime?.blockers),
    mandate: record(fallback.mandate),
    readiness: list(fallback.checks),
    rules: record(fallback.rules),
    events: record(fallback.events),
    incidents: record(fallback.incidents)
  };
}

export function buildGovernanceDomainModel(input = {}, options = {}) {
  const data = record(input);
  let control = {};
  let operations = {};
  try { control = buildControlConfigurationView(data); } catch { control = {}; }
  try { operations = buildOperationsView(data, options); } catch { operations = {}; }
  return {
    boundary: directBoundary(data, control),
    operations,
    eventInputs: {
      sources: list(operations.inputs?.items),
      total: operations.inputs?.total ?? unavailable,
      unhealthy: operations.inputs?.unhealthy ?? unavailable,
      windows: list(control.events?.windows),
      blocking: control.events?.blocking ?? unavailable
    },
    notifications: record(operations.notifications),
    audit: record(operations.audit),
    recovery: record(operations.recovery),
    permissions: buildGovernancePermissions(data),
    source: text(data.source ?? data.lastValidSource),
    asOf: text(data.asOf ?? data.lastValidAt)
  };
}
