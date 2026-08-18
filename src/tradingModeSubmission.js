export function buildTradingModePayload(requestedMode, live = {}) {
  return {
    requestedMode,
    acknowledged: Boolean(live.acknowledged)
  };
}

export async function applyTradingModeOnce({ lock, request, payload, onSuccess }) {
  if (lock.current) return { ok: false, error: "request_in_progress", duplicate: true };
  lock.current = true;
  try {
    const result = await request(payload);
    if (result?.ok === false) return result;
    onSuccess?.(result);
    return result ?? { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || "request_failed" };
  } finally {
    lock.current = false;
  }
}
