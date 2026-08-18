// The application shell must never invent a health state from its visual
// defaults. Normalize the authoritative exchange/runtime facts into the three
// colors used by the connected KORDYN prototype.
export function shellStatusTone(tone = "", ...facts) {
  const value = [tone, ...facts].filter(Boolean).join(" ").toLowerCase();
  if (/danger|critical|error|failed|offline|disconnected|emergency_stopped|\boff\b/.test(value)) return "red";
  if (/warning|warn|neutral|pending|paused|opening_paused|analysis_unavailable|degraded|unknown|not[_ -]?configured/.test(value)) return "amber";
  if (/\bok\b|\bon\b|good|healthy|connected|ready|normal|running|enabled/.test(value)) return "green";
  // Unknown shell health is cautionary, never implicitly healthy.
  return "amber";
}
