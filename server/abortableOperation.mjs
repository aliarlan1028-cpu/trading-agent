function abortReason(signal, fallbackReason) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error(String(signal?.reason || fallbackReason));
}

function throwIfAborted(signal, fallbackReason) {
  if (signal?.aborted) throw abortReason(signal, fallbackReason);
}

export async function awaitAbortableOperation(operation, signal, fallbackReason = "outbound_aborted") {
  throwIfAborted(signal, fallbackReason);
  if (!signal) return operation();
  let rejectOnAbort;
  const aborted = new Promise((_resolve, reject) => {
    rejectOnAbort = () => reject(abortReason(signal, fallbackReason));
    signal.addEventListener("abort", rejectOnAbort, { once: true });
    if (signal.aborted) rejectOnAbort();
  });
  const pending = Promise.resolve().then(() => {
    throwIfAborted(signal, fallbackReason);
    return operation();
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", rejectOnAbort);
  }
}
