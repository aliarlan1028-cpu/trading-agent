export function evaluateAutonomousProfilePreflight({
  autonomousProfile,
  professionalRiskMode,
  autonomyEnabled,
} = {}) {
  const failures = [];
  const warnings = [];
  if (!autonomousProfile) return { failures, warnings };

  if (professionalRiskMode !== true) {
    failures.push("Autonomous live trading requires professionalRiskMode");
  }

  // A paused autonomy switch is a safe runtime state, not an invalid production
  // configuration. Deployments must preserve that pause instead of forcing the
  // control plane to resume trading merely to pass a release gate.
  if (autonomyEnabled !== true) {
    warnings.push("Autonomous profile is configured, but autonomy is paused; deployment will preserve the pause");
  }

  return { failures, warnings };
}
