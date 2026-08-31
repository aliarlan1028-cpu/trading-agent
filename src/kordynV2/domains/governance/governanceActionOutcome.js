const SUCCESS_STATES = new Set(["accepted", "success", "succeeded", "completed", "ok", "resolved", "recorded", "delivered"]);

export function classifyGovernanceActionResult(result) {
  if (!result || typeof result !== "object") return "failed";
  const status = typeof result.status === "string" ? result.status.toLowerCase() : "";
  if (status === "partial" || (Array.isArray(result.failed) && result.failed.length > 0)) return "partial";
  if (result.cancelled === true) return "cancelled";
  if (result.ok === false || result.error) return "failed";
  if (result.ok === true || SUCCESS_STATES.has(status)) return "success";
  if (Array.isArray(result.applied)) return result.applied.length > 0 ? "success" : "failed";
  const deliveryStatus = typeof result.notification?.deliveryStatus === "string" ? result.notification.deliveryStatus.toLowerCase() : "";
  if (SUCCESS_STATES.has(deliveryStatus)) return "success";
  const entityKeys = ["incident", "user", "account", "run", "report", "task", "source", "mandate", "rule", "profile"];
  if (entityKeys.some((key) => result[key] && typeof result[key] === "object")) return "success";
  if (result.result && typeof result.result === "object" && (result.result.id || SUCCESS_STATES.has(String(result.result.status || "").toLowerCase()))) return "success";
  return "failed";
}
