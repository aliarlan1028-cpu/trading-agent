const SUCCESS_STATES = new Set(["accepted", "success", "succeeded", "completed", "ok", "resolved", "recorded", "delivered"]);

export function classifyGovernanceActionResult(result) {
  if (!result || typeof result !== "object") return "failed";
  const status = typeof result.status === "string" ? result.status.toLowerCase() : "";
  if (status === "partial" || (Array.isArray(result.failed) && result.failed.length > 0)) return "partial";
  if (result.cancelled === true) return "cancelled";
  if (result.ok === false || result.error) return "failed";
  if (result.ok === true || SUCCESS_STATES.has(status)) return "success";
  return "success";
}
