import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAutonomousProfilePreflight } from "../server/productionPreflightPolicy.mjs";

test("a paused autonomous profile remains deployable without resuming trading", () => {
  const result = evaluateAutonomousProfilePreflight({
    autonomousProfile: true,
    professionalRiskMode: true,
    autonomyEnabled: false,
  });

  assert.deepEqual(result.failures, []);
  assert.match(result.warnings[0], /deployment will preserve the pause/);
});

test("professional risk mode remains mandatory for an autonomous profile", () => {
  const result = evaluateAutonomousProfilePreflight({
    autonomousProfile: true,
    professionalRiskMode: false,
    autonomyEnabled: false,
  });

  assert.deepEqual(result.failures, ["Autonomous live trading requires professionalRiskMode"]);
});

test("manual-approval profiles do not inherit autonomous-profile requirements", () => {
  const result = evaluateAutonomousProfilePreflight({
    autonomousProfile: false,
    professionalRiskMode: false,
    autonomyEnabled: false,
  });

  assert.deepEqual(result, { failures: [], warnings: [] });
});
