import { appendAudit, nowIso } from "./store.mjs";
import { normalizeAndValidateMandate } from "./mandatePolicy.mjs";

const ACTIVATABLE = new Set(["draft", "pending_confirmation", "paused", "superseded", "active", "running"]);

function defaultNotionalUsdt(db) {
  const gray = (db.grayReleasePolicies || []).find((item) => item.enabled);
  const value = Number(gray?.maxNotionalUsdt ?? process.env.MAX_LIVE_NOTIONAL_USDT ?? 50);
  return Number.isFinite(value) && value > 0 ? value : 50;
}

function failure(status, error, extra = {}) {
  return { ok: false, status, error, ...extra };
}

export function transitionMandate(db, mandateId, operation, options = {}) {
  const mandate = (db.mandates || []).find((item) => item.id === mandateId);
  if (!mandate) return failure(404, "mandate_not_found");
  const at = options.nowIso?.() || nowIso();
  const actor = options.actor || "MandateLifecycle";
  const audit = options.appendAudit || appendAudit;

  if (operation === "activate") {
    if (!ACTIVATABLE.has(String(mandate.status || ""))) return failure(409, "mandate_state_conflict", { currentStatus: mandate.status });
    const checked = normalizeAndValidateMandate(mandate, { defaultNotionalUsdt: options.defaultNotionalUsdt || defaultNotionalUsdt(db) });
    if (!checked.valid) return failure(400, "mandate_validation_failed", { details: checked.errors });
    Object.assign(mandate, checked.normalized);
    for (const other of db.mandates || []) {
      if (other.id === mandate.id || !["active", "running"].includes(other.status)) continue;
      other.status = "superseded";
      other.supersededAt = at;
      other.supersededByMandateId = mandate.id;
      other.version = Math.max(1, Number(other.version || 1)) + 1;
      other.updatedAt = at;
      audit(db, `旧授权被新激活取代:${other.id}`, other.id, actor);
    }
    mandate.status = "active";
    mandate.version = Math.max(1, Number(mandate.version || 1));
    mandate.activatedAt = at;
    mandate.updatedAt = at;
    audit(db, "激活授权委托", mandate.id, actor);
    return { ok: true, mandate };
  }

  if (operation === "pause") {
    if (mandate.status === "paused") return { ok: true, mandate, idempotent: true };
    if (!["active", "running"].includes(mandate.status)) return failure(409, "mandate_state_conflict", { currentStatus: mandate.status });
    mandate.status = "paused";
    mandate.version = Math.max(1, Number(mandate.version || 1)) + 1;
    mandate.pausedAt = at;
    mandate.updatedAt = at;
    audit(db, "暂停授权委托", mandate.id, actor, "warning");
    return { ok: true, mandate };
  }

  if (operation === "revoke") {
    if (mandate.status === "revoked") return { ok: true, mandate, idempotent: true };
    if (!["draft", "pending_confirmation", "active", "running", "paused", "superseded"].includes(mandate.status)) return failure(409, "mandate_state_conflict", { currentStatus: mandate.status });
    mandate.status = "revoked";
    mandate.version = Math.max(1, Number(mandate.version || 1)) + 1;
    mandate.revokedAt = at;
    mandate.updatedAt = at;
    audit(db, "撤销授权委托", mandate.id, actor, "warning");
    return { ok: true, mandate };
  }

  return failure(400, "unknown_mandate_operation");
}
