export class LeaseLostError extends Error {
  constructor(message = "scheduler_lease_lost") {
    super(message);
    this.name = "LeaseLostError";
    this.code = "scheduler_lease_lost";
  }
}

export function isLeaseLostError(error) {
  return error?.code === "scheduler_lease_lost"
    || String(error?.message || error || "").includes("scheduler_lease_lost")
    || String(error?.message || error || "").includes("scheduler_lease_renewal_failed");
}

export function assertActiveLease(options = {}) {
  if (options.signal?.aborted) throw new LeaseLostError();
  options.assertLease?.();
  if (options.signal?.aborted) throw new LeaseLostError();
  return true;
}
