export async function fetchWithDeadline(url, init = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive number");

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const operation = String(options.operation || "outbound_request");
  const externalSignal = init.signal;
  if (externalSignal?.aborted) throw externalSignal.reason;

  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal.reason);
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    const error = new Error(`${operation} timed out after ${timeoutMs}ms`);
    error.name = "TimeoutError";
    error.code = "outbound_timeout";
    error.operation = operation;
    error.timeoutMs = timeoutMs;
    controller.abort(error);
  }, timeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return typeof options.consume === "function"
      ? await options.consume(response, controller.signal)
      : response;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}
